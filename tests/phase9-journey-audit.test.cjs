const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'source.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE snapshots(branch_id TEXT,state_version INTEGER,snapshot_json TEXT);
    CREATE TABLE turns(branch_id TEXT,turn_id TEXT,status TEXT,committed_state_version INTEGER,action_contract_json TEXT,effects_json TEXT,outcome_grade TEXT);
    CREATE TABLE branch_events(branch_id TEXT,event_seq INTEGER,state_version INTEGER,event_type TEXT,payload_json TEXT);`);
  const state = (v, extra = {}) => ({ stateVersion:v, actors:{pc:{lifeStatus:'active',conditions:[],locationId:'town'}}, situations:[], ...extra });
  return { db, snapshot(v, extra) { db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('b',v,JSON.stringify(state(v,extra))); },
    turn(id, v, effect = null, kind = 'observe') {
      db.prepare('INSERT INTO turns VALUES(?,?,?,?,?,?,?)').run('b',id,'Committed',v,JSON.stringify({actionKind:kind,actorId:'pc'}),JSON.stringify(effect?[effect]:[]),'success');
      if (effect) db.prepare('INSERT INTO branch_events VALUES(?,?,?,?,?)').run('b',v,v,'recordEvent',JSON.stringify(effect));
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
    h.turn('turn-0004',4,null,'rest');
    const r=h.audit();
    assert.equal(r.submittedPlayerTurns,2); assert.equal(r.candidateMeaningfulDecisions,1);
    assert.deepEqual(r.decisions.map(d=>d.turnId),['turn-0003','turn-0004']);
    assert.equal(r.decisions[1].excluded,'rest');
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
test('incremental journey audit uses full intervening decision history when checking a delayed consequence', t => {
  const h=fixture(t); try {
    const consequence={consequenceId:'c',idempotencyKey:'b:c',createdAtVersion:1,status:'pending'};
    for(let v=0;v<=5;v++)h.snapshot(v,{campaignRuntime:{deferredConsequences:v===0?[]:[v===5?{...consequence,status:'triggered',triggeredAtVersion:5}:consequence]}});
    for(let v=1;v<=5;v++)h.turn('turn-000'+v,v,v===2||v===3?{op:'recordEvent',eventType:'fact'+v,summary:'distinct finding'}:null);
    const r=h.audit(3);
    assert.equal(r.submittedPlayerTurns,2);
    assert.equal(r.consequences[0].interveningCandidateDecisions,2);
    assert.equal(r.consequences[0].meetsDelayCandidate,true);
  } finally { h.db.close(); }
});
