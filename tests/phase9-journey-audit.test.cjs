const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { fixture: productionFixture, candidateModel } = require('./helpers/phase9CampaignFixture.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'source.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE snapshots(branch_id TEXT,state_version INTEGER,snapshot_json TEXT);
    CREATE TABLE turns(branch_id TEXT,turn_id TEXT,status TEXT,committed_state_version INTEGER,action_contract_json TEXT,effects_json TEXT,outcome_grade TEXT);
    CREATE TABLE branch_events(branch_id TEXT,event_seq INTEGER,turn_id TEXT,state_version INTEGER,event_type TEXT,payload_json TEXT);`);
  const state = (v, extra = {}) => ({ stateVersion:v, actors:{pc:{lifeStatus:'active',conditions:[],locationId:'town'}}, situations:[], ...extra });
  return { db, snapshot(v, extra) { db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('b',v,JSON.stringify(state(v,extra))); },
    turn(id, v, effect = null, kind = 'observe', persistEvent = true) {
      db.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?,?)').run('b',id,'Committed',v,JSON.stringify({actionKind:kind,actorId:'pc'}),JSON.stringify(effect?[effect]:[]),'success');
      if (effect && persistEvent) this.event(id,v,'recordEvent',effect);
    },
    event(id,v,type,payload) {
      const seq=db.prepare('SELECT COALESCE(MAX(event_seq),0)+1 AS next FROM branch_events WHERE branch_id=?').get('b').next;
      db.prepare('INSERT INTO branch_events VALUES(?,?,?,?,?,?)').run('b',seq,id,v,type,JSON.stringify(payload));
    },
    audit(after) {
      const output=path.join(dir,'report.json');
      cp.execFileSync(process.execPath,[path.resolve(__dirname,'../tools/phase9-journey-audit.cjs'),file,'b',output,...(after===undefined?[]:[String(after)])]);
      return JSON.parse(fs.readFileSync(output,'utf8'));
    } };
}
test('journey audit excludes opening adoption and production system commits from submitted player totals', t => {
  const h=fixture(t); try {
    for(let v=0;v<=4;v++)h.snapshot(v);
    h.turn('b:adoption',0); h.turn('system-scene_actors-000001',1);
    h.turn('b:manage-replan:2',2); h.turn('turn-0003',3,{op:'recordEvent',eventType:'fact',summary:'first finding'});
    h.turn('turn-0004',4,{op:'recordEvent',eventType:'rest_event',summary:'rested'},'rest');
    const r=h.audit();
    assert.equal(r.submittedPlayerTurns,2); assert.equal(r.candidateMeaningfulDecisions,1);
    assert.deepEqual(r.decisions.map(d=>d.turnId),['turn-0003','turn-0004']);
    assert.equal(r.decisions[1].excluded,'rest');
    assert.equal(r.decisions[1].evidenceStatus,'complete');
    assert.equal(r.decisions[1].eventEvidenceStatus,'complete');
    assert.equal(r.evidenceStatus,'complete');
  } finally { h.db.close(); }
});
test('journey audit recognizes nested durable recordEvent types and does not count the same fact twice', t => {
  const h=fixture(t); try {
    for(let v=0;v<=2;v++)h.snapshot(v);
    const effect={op:'recordEvent',eventType:'fact',summary:'same finding'};
    h.turn('turn-0001',1,effect);h.turn('turn-0002',2,effect);
    const r=h.audit();
    assert.equal(r.candidateMeaningfulDecisions,1);
    assert.equal(r.decisions[1].candidateMeaningful,false);
    assert.deepEqual(r.decisions[1].changes,[]);
  } finally { h.db.close(); }
});

test('journey audit marks a missing committed event row unknown instead of inferring it from the action effects', t => {
  const h=fixture(t); try {
    h.snapshot(0); h.snapshot(1);
    h.turn('turn-missing-event',1,{op:'recordEvent',eventType:'fact',summary:'unpersisted finding'},'observe',false);
    const r=h.audit();
    assert.equal(r.decisions[0].eventEvidenceStatus,'incomplete');
    assert.equal(r.decisions[0].evidenceStatus,'unknown');
    assert.equal(r.decisions[0].candidateMeaningful,false);
    assert.equal(r.decisions[0].excluded,'committed event evidence incomplete');
  } finally { h.db.close(); }
});
test('journey audit does not bind a same-version event from a different turn', t => {
  const h=fixture(t); try {
    h.snapshot(0); h.snapshot(1);
    const effect={op:'recordEvent',eventType:'fact',summary:'same version, wrong turn'};
    h.turn('turn-missing-event',1,effect,'observe',false);
    h.event('other-turn',1,'recordEvent',effect);
    const r=h.audit();
    assert.equal(r.decisions[0].eventEvidenceStatus,'incomplete');
    assert.equal(r.decisions[0].evidenceStatus,'unknown');
    assert.equal(r.decisions[0].candidateMeaningful,false);
  } finally { h.db.close(); }
});
test('journey audit keeps a rest with missing event evidence UNKNOWN', t => {
  const h=fixture(t); try {
    h.snapshot(0); h.snapshot(1);
    h.turn('rest-with-missing-event',1,{op:'recordEvent',eventType:'rest_event',summary:'unpersisted rest'},'rest',false);
    const r=h.audit();
    assert.equal(r.decisions[0].excluded,'rest');
    assert.equal(r.decisions[0].eventEvidenceStatus,'incomplete');
    assert.equal(r.decisions[0].evidenceStatus,'unknown');
    assert.equal(r.evidenceStatus,'unknown');
  } finally { h.db.close(); }
});
test('journey audit returns UNKNOWN when the requested branch has no snapshots', t => {
  const h=fixture(t); try {
    h.turn('turn-without-snapshots',1);
    const r=h.audit();
    assert.equal(r.evidenceStatus,'unknown');
    assert.equal(r.headVersion,null);
    assert.equal(r.decisions[0].evidenceStatus,'unknown');
    assert.equal(r.decisions[0].candidateMeaningful,false);
  } finally { h.db.close(); }
});
test('journey audit returns UNKNOWN when a player decision lacks a contiguous before snapshot', t => {
  const h=fixture(t); try {
    h.snapshot(0); h.snapshot(2);
    h.turn('turn-with-snapshot-gap',2,{op:'recordEvent',eventType:'fact',summary:'gap finding'});
    const r=h.audit();
    assert.equal(r.evidenceStatus,'unknown');
    assert.equal(r.decisions[0].beforeVersion,0);
    assert.equal(r.decisions[0].afterVersion,2);
    assert.equal(r.decisions[0].evidenceStatus,'unknown');
    assert.equal(r.decisions[0].candidateMeaningful,false);
    assert.equal(r.decisions[0].excluded,'snapshot evidence incomplete');
  } finally { h.db.close(); }
});
test('journey audit reports UNKNOWN when a consequence identity changes across snapshots', t => {
  const h=fixture(t); try {
    h.snapshot(0);
    h.snapshot(1,{campaignRuntime:{deferredConsequences:[{consequenceId:'c',idempotencyKey:'b:c-old',createdAtVersion:1,status:'pending'}]}});
    h.snapshot(2,{campaignRuntime:{deferredConsequences:[{consequenceId:'c',idempotencyKey:'b:c-new',createdAtVersion:1,status:'pending'}]}});
    const r=h.audit();
    assert.equal(r.consequenceIdentityChanged,true);
    assert.equal(r.evidenceStatus,'unknown');
    assert.equal(r.consequences.length,2,'do not merge or reinterpret different identities');
  } finally { h.db.close(); }
});
test('incremental journey audit uses full intervening history and separates cancellation from application', t => {
  const h=fixture(t); try {
    const consequence={consequenceId:'c',idempotencyKey:'b:c',createdAtVersion:1,sourceTurnId:'turn-0001',status:'pending'};
    const cancelled={consequenceId:'cancelled',idempotencyKey:'b:cancelled',createdAtVersion:1,sourceTurnId:'turn-0001',status:'pending'};
    for(let v=0;v<=5;v++)h.snapshot(v,{campaignRuntime:{deferredConsequences:v===0?[]:[
      v===5?{...consequence,status:'triggered',triggeredAtVersion:5}:consequence,
      v===5?{...cancelled,status:'cancelled',cancelledAtVersion:5}:cancelled,
    ]}});
    for(let v=1;v<=5;v++)h.turn('turn-000'+v,v,v===2||v===3?{op:'recordEvent',eventType:'fact'+v,summary:'distinct finding'}:null);
    h.event('turn-0001',1,'campaign_consequence_scheduled',{consequenceId:'c'});
    h.event('turn-0005',5,'campaign_consequence_triggered',{consequenceId:'c'});
    h.event('turn-0001',1,'campaign_consequence_scheduled',{consequenceId:'cancelled'});
    h.event('turn-0005',5,'campaign_consequence_cancelled',{consequenceId:'cancelled',reason:'trigger_node_retired'});
    const r=h.audit(3);
    const full=h.audit();
    assert.equal(r.submittedPlayerTurns,2);
    assert.equal(r.consequences.length,2,'triggered and cancelled obligations remain separate lifecycle records');
    const triggered=r.consequences.find(item=>item.idempotencyKey==='b:c');
    const cancelledRow=r.consequences.find(item=>item.idempotencyKey==='b:cancelled');
    assert.equal(triggered.status,'triggered');
    assert.equal(triggered.interveningCandidateDecisions,2);
    assert.equal(triggered.meetsDelayCandidate,true);
    assert.equal(triggered.downstreamConsumerEvidence,'not_tracked');
    assert.equal(triggered.causalChainClosed,false);
    assert.equal(cancelledRow.status,'cancelled');
    assert.equal(cancelledRow.applicationStatus,'not_applied_cancelled');
    assert.equal(cancelledRow.cancellationEventEvidence,true);
    assert.deepEqual(r.consequences.map(item=>[item.idempotencyKey,item.interveningCandidateDecisions]),
      full.consequences.map(item=>[item.idempotencyKey,item.interveningCandidateDecisions]),'incremental and full delay context agree');
  } finally { h.db.close(); }
});

test('journey audit reports one final discharged lifecycle when trigger and application share a commit', t => {
  const h=fixture(t); try {
    h.snapshot(0);
    h.snapshot(1,{campaignRuntime:{deferredConsequences:[{consequenceId:'c',idempotencyKey:'b:c',sourceTurnId:'turn-0001',createdAtVersion:1,
      status:'discharged',triggeredAtVersion:1,dischargedAtVersion:1}]}});
    h.turn('turn-0001',1);
    h.event('turn-0001',1,'campaign_consequence_scheduled',{consequenceId:'c'});
    h.event('turn-0001',1,'campaign_consequence_triggered',{consequenceId:'c'});
    h.event('turn-0001',1,'campaign_consequence_discharged',{consequenceId:'c'});
    const r=h.audit();
    assert.equal(r.consequences.length,1);
    assert.equal(r.consequences[0].status,'discharged');
    assert.equal(r.consequences[0].applicationStatus,'applied');
    assert.equal(r.consequences[0].scheduleEventEvidence,true);
    assert.equal(r.consequences[0].triggerEventEvidence,true);
    assert.equal(r.consequences[0].applicationEventEvidence,true);
    assert.equal(r.consequences[0].downstreamConsumerEvidence,'not_tracked');
    assert.equal(r.consequences[0].causalChainClosed,false);
    assert.equal(r.consequences[0].lifecycleEvidence,'complete','schedule, trigger and application versions can share one commit');
    assert.equal(r.consequences[0].meetsDelayCandidate,false,'a same-commit lifecycle has no intervening player decisions');
  } finally { h.db.close(); }
});

test('production Session SQLite discharge is recognized once by the read-only journey audit', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phase9-production-audit-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'production.sqlite');
  const output=path.join(dir,'audit.json');
  const model=candidateModel();
  for (const outcome of Object.values(model.firstSituation.methods.find(method=>method.methodId==='ask-lin').outcomes)) {
    outcome.effects.push({template:'record_event',eventType:'audit_production_fact',summary:'生产提交事件证据'});
  }
  const h=await productionFixture({dbPath:file,model});
  try {
    await h.session.playTurn({campaignId:h.campaignId,branchId:h.branchId,intent:'向林凡打听青石巷最近的情况'});
    const state=await h.turns.getState(h.branchId);
    const consequence=state.campaignRuntime.deferredConsequences.find(c=>c.consequenceId==='lin-favor');
    assert.ok(consequence,'production settlement scheduled the consequence');
    assert.equal(consequence.status,'discharged','the consequence triggered and applied inside the same committed turn');
    assert.equal(consequence.triggeredAtVersion,consequence.dischargedAtVersion);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM branch_events WHERE branch_id=? AND event_type='campaign_consequence_discharged'").get(h.branchId).n,1);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM branch_events WHERE branch_id=? AND event_type='lin_called_in_favor'").get(h.branchId).n,1);
    const before=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    cp.execFileSync(process.execPath,[path.resolve(__dirname,'../tools/phase9-journey-audit.cjs'),file,h.branchId,output],{stdio:'pipe'});
    const report=JSON.parse(fs.readFileSync(output,'utf8'));
    assert.equal(report.evidenceStatus,'complete');
    assert.equal(report.decisions[0].eventEvidenceStatus,'complete','an effect is corroborated by its persisted branch event');
    assert.ok(report.decisions[0].changes.includes('new.committed_event'));
    const audited=report.consequences.filter(c=>c.idempotencyKey===consequence.idempotencyKey);
    assert.equal(audited.length,1,'one idempotency identity appears once despite multiple snapshots');
    assert.equal(audited[0].status,'discharged');
    assert.equal(audited[0].createdAtVersion,consequence.createdAtVersion);
    assert.equal(audited[0].triggeredAtVersion,consequence.triggeredAtVersion);
    assert.equal(audited[0].dischargedAtVersion,consequence.dischargedAtVersion);
    assert.equal(audited[0].applicationStatus,'applied');
    assert.equal(audited[0].scheduleEventEvidence,true);
    assert.equal(audited[0].triggerEventEvidence,true);
    assert.equal(audited[0].applicationEventEvidence,true);
    assert.equal(audited[0].scheduleTurnId,consequence.sourceTurnId);
    assert.ok(audited[0].triggerTurnId);
    assert.equal(audited[0].downstreamConsumerEvidence,'not_tracked');
    const after=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(after,before,'the read-only audit does not change the production test database bytes');
  } finally { h.db.close(); }
});
test('journey audit retains discharged delayed consequences and reports their terminal state', t => {
  const h=fixture(t); try {
    const consequence={consequenceId:'c',idempotencyKey:'b:c',sourceTurnId:'turn-0001',createdAtVersion:1,status:'pending'};
    for(let v=0;v<=4;v++)h.snapshot(v,{campaignRuntime:{deferredConsequences:v===0?[]:v<4?[consequence]:[{...consequence,status:'discharged',triggeredAtVersion:4,dischargedAtVersion:4}]}});
    h.turn('turn-0001',1,null);h.turn('turn-0002',2,{op:'recordEvent',eventType:'fact2'});
    h.turn('turn-0003',3,{op:'recordEvent',eventType:'fact3'});h.turn('turn-0004',4,null);
    h.event('turn-0001',1,'campaign_consequence_scheduled',{consequenceId:'c'});
    h.event('turn-0004',4,'campaign_consequence_triggered',{consequenceId:'c'});
    h.event('turn-0004',4,'campaign_consequence_discharged',{consequenceId:'c'});
    const r=h.audit();
    assert.equal(r.consequences.length,1);
    assert.equal(r.consequences[0].status,'discharged');
    assert.equal(r.consequences[0].dischargedAtVersion,4);
    assert.equal(r.consequences[0].lifecycleEvidence,'complete','a delayed discharge needs schedule, trigger and discharge evidence');
    assert.equal(r.consequences[0].interveningCandidateDecisions,2);
    assert.equal(r.consequences[0].meetsDelayCandidate,true);
  } finally { h.db.close(); }
});
test('journey audit counts a durable player location change without requiring a method reference', t => {
  const h=fixture(t); try {
    h.snapshot(0);h.snapshot(1,{actors:{pc:{lifeStatus:'active',conditions:[],locationId:'border-town'}}});
    h.turn('turn-0001',1,{op:'changeLocation',actorId:'pc',locationId:'border-town'},'move');
    const r=h.audit();
    assert.equal(r.candidateMeaningfulDecisions,1);
    assert.ok(r.decisions[0].changes.includes('actor.location'));
  } finally { h.db.close(); }
});
