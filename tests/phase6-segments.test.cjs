'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { SegmentBuildService, estimateBuildLeadTimeMs, rangesCover } = require('../dist/application/segmentBuild');
const { SqliteSegmentPlanStore } = require('../dist/infra/sqlite/sqliteSegmentPlanStore');
const { PHASE6_SEGMENT_SCHEMA_SQL } = require('../dist/infra/sqlite/phase6SegmentSchema');
const { NodeSqliteAdapter } = require('./helpers/mobileHarness.cjs');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const config=sha('frozen synthetic test config');
const ref=(branchId='b1',stateVersion=0) => ({campaignId:'c',branchId,stateVersion,userCommandId:`cmd-${branchId}-${stateVersion}`});

async function harness() {
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;CREATE TABLE worlds(world_id TEXT PRIMARY KEY);INSERT INTO worlds VALUES (\'w\');');
  db.exec(PHASE6_SEGMENT_SCHEMA_SQL);
  const adapter=new NodeSqliteAdapter(db),store=new SqliteSegmentPlanStore(adapter);
  const texts=new Map(),members=[];
  const addSource=(sourceId,ordinal,length=20000) => {
    const text=Array.from({length},(_,i) => '字句章源'[i%4]).join('');
    texts.set(sourceId,text);
    const normalizedTreeHash=sha(sourceId+text);
    const member={sourceId,sourceOrdinal:ordinal,normalizedTreeHash,codePointCount:length,rawSha256Hex:sha(text),
      chapters:Array.from({length:Math.ceil(length/5000)},(_,i) => ({chapterId:`${sourceId}-${i}`,startCp:i*5000,endCp:Math.min(length,(i+1)*5000),title:`合成章 ${i}`}))};
    members.push(member);return member;
  };
  addSource('src1',1);
  const binding=() => ({sourceSetHash:sha(JSON.stringify(members)),members:members.map(({sourceId,sourceOrdinal,normalizedTreeHash}) => ({sourceId,sourceOrdinal,normalizedTreeHash}))});
  const catalog={async snapshot(worldId){assert.equal(worldId,'w');return {binding:binding(),members:[...members]};},
    async createRange(sourceId,startCp,endCp){const m=members.find(v => v.sourceId===sourceId);if(!m)throw Error('source_deleted');
      return {sourceId,normalizedTreeHash:m.normalizedTreeHash,startCp,endCp,rangeContentHash:sha(Array.from(texts.get(sourceId)).slice(startCp,endCp).join(''))};},
    async readRange(){throw Error('planner must not read full source');},async isBindingCompatible(){return true;}};
  const executions=new Map(),ensures=[],controls=[];
  const executor={async ensureRun(intent){ensures.push(structuredClone(intent)); const ids=intent.ranges.map((_,i) => `${intent.intentId}-run-${i}`);
    for(const runId of ids) if(!executions.has(runId)) executions.set(runId,{runId,phase:'extracting',status:'running',completedUnits:0,failedUnits:0,totalUnits:2,requestOutcome:'none',lastErrorCode:null,retryAt:null,fencingToken:1});
    return {runIds:ids};},async requestControl(runId,kind){controls.push([runId,kind]);},async readExecution(runId){if(!executions.has(runId))throw Error('missing');return executions.get(runId);}};
  const artifacts=[],bindings=new Map();
  const branchContent={async freezeBinding(campaignId,branchId){return bindings.get(branchId) ?? {manifestHash:sha(branchId),contentVersion:1,branchId,stateVersion:0,basePackageRevision:1,deltaIds:[],artifactIds:[]};}};
  const options={store,catalog,executor,artifacts:{async listPublishedArtifacts(){return artifacts;}},branchContent,sha256Hex:sha,now:()=>'2026-10-02T12:00:00.000Z'};
  const service=new SegmentBuildService(options);
  const publish=(segment,coverage=segment.intent.ranges) => {
    const artifact={artifactId:`a${artifacts.length+1}`,worldId:'w',segmentId:segment.intent.segmentId,generation:segment.intent.generation,sourceBinding:segment.intent.sourceBinding,
      coverage,canonSnapshotHash:sha('canon'),contentHash:sha('content'),validationVersion:'test-validation'};artifacts.push(artifact);return artifact;
  };
  return {db,adapter,store,catalog,service,options,addSource,members,binding,executions,ensures,controls,artifacts,bindings,publish,
    range:(start,end,source='src1') => catalog.createRange(source,start,end)};
}

test('preparation failure survives cold projection and needs an explicit local retry',async () => {
  const h=await harness();const opening=await h.service.ensureBootstrap({worldId:'w',executionConfigFingerprint:config});
  const ensure=h.options.executor.ensureRun;let calls=0;
  h.options.executor.ensureRun=async()=>{calls++;throw Error('batch coverage rejected');};
  await assert.rejects(h.service.dispatch('w'),/batch coverage rejected/);
  const cold=new SegmentBuildService(h.options);
  const failed=await cold.readReadiness({worldId:'w'});
  assert.equal(failed.segments[0].status,'failed_retryable');
  assert.equal(failed.segments[0].lastErrorCode,'execution_prepare_failed');
  assert.equal(failed.diagnostics[0].code,'execution_prepare_failed');
  await cold.dispatch('w');assert.equal(calls,1);assert.equal(h.executions.size,0);
  assert.equal(await cold.retryPreparation('w',opening.intent.segmentId),true);
  h.options.executor.ensureRun=ensure;await cold.dispatch('w');
  assert.equal(h.executions.size,1);assert.equal(h.ensures[0].intentId,opening.intent.intentId);h.db.close();
});

test('preparation retry respects user pause and never approves an unknown sent run',async () => {
  const h=await harness();const opening=await h.service.ensureBootstrap({worldId:'w',executionConfigFingerprint:config});
  const ensure=h.options.executor.ensureRun;
  h.options.executor.ensureRun=async()=>{await h.service.setPause('w','user');throw Error('local preparation failed');};
  await assert.rejects(h.service.dispatch('w'),/local preparation failed/);
  assert.equal((await h.service.readReadiness({worldId:'w'})).pauseReason,'user');
  assert.equal(await h.service.retryPreparation('w',opening.intent.segmentId),false);
  await h.service.resume('w');assert.equal(await h.service.retryPreparation('w',opening.intent.segmentId),true);
  h.options.executor.ensureRun=ensure;await h.service.dispatch('w');
  const [segment]=await h.store.listSegments('w');h.executions.get(segment.runIds[0]).requestOutcome='outcome_unknown';
  assert.equal(await h.service.retryPreparation('w',opening.intent.segmentId),false);
  const calls=h.ensures.length;await h.service.dispatch('w');assert.equal(h.ensures.length,calls);h.db.close();
});

test('late preparation failure cannot revive a deleted project',async () => {
  const h=await harness();await h.service.ensureBootstrap({worldId:'w',executionConfigFingerprint:config});
  h.options.executor.ensureRun=async()=>{h.db.prepare('DELETE FROM worlds WHERE world_id=?').run('w');throw Error('project removed while preparing');};
  await assert.rejects(h.service.dispatch('w'),/project removed/);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM world_segments').get().n,0);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM worlds').get().n,0);h.db.close();
});

test('bootstrap is one small bounded logical range; completed runs alone never mean ready',async () => {
  const h=await harness();const opening=await h.service.ensureBootstrap({worldId:'w',executionConfigFingerprint:config});
  assert.equal(opening.intent.ranges[0].endCp,3200);assert.equal(opening.intent.reason,'bootstrap');assert.equal(opening.intent.priority,'P1');
  await h.service.dispatch('w');const [segment]=await h.store.listSegments('w');
  assert.equal((await h.service.findSegmentByRunId(segment.runIds[0])).intent.segmentId,segment.intent.segmentId);
  for(const id of segment.runIds) Object.assign(h.executions.get(id),{status:'completed',phase:'publishing',completedUnits:2});
  assert.equal((await h.service.readReadiness({worldId:'w'})).segments[0].status,'validating');
  h.publish(segment,[await h.range(0,1600)]);
  const partial=await h.service.readReadiness({worldId:'w'});assert.equal(partial.segments[0].status,'validating');assert.equal(partial.segments[0].publishedCoverage.length,1);
  h.publish(segment,[await h.range(1600,3200)]);assert.equal((await h.service.readReadiness({worldId:'w'})).segments[0].status,'ready');h.db.close();
});

test('multisource noncontinuous demands share world work, elevate priority and keep each branch adoption independent',async () => {
  const h=await harness();h.addSource('src2',2);
  const ranges=[await h.range(100,200),await h.range(900,1000),await h.range(50,250,'src2')];
  const [first]=await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges,reason:'buffer',demandRef:ref('b1')});
  const [second]=await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[...ranges].reverse(),reason:'action_dependency',demandRef:ref('b2')});
  assert.equal(first.intent.segmentId,second.intent.segmentId);assert.equal(second.intent.priority,'P1');assert.equal(second.intent.demandRefs.length,2);
  assert.equal(second.intent.ranges.length,3);assert.equal(rangesCover([await h.range(100,1000)],second.intent.ranges),false);
  await h.service.dispatch('w');assert.equal(h.ensures.length,1);assert.equal((await h.store.listSegments('w'))[0].runIds.length,3);
  const artifact=h.publish(second);h.bindings.set('b1',{manifestHash:sha('b1'),contentVersion:2,branchId:'b1',stateVersion:1,basePackageRevision:1,deltaIds:[],artifactIds:[artifact.artifactId]});
  const a=await h.service.readReadiness({worldId:'w',campaignId:'c',branchId:'b1'}),b=await h.service.readReadiness({worldId:'w',campaignId:'c',branchId:'b2'});
  assert.equal(a.segments[0].status,'ready');assert.equal(a.branchArtifacts[0].status,'adopted');assert.equal(a.unmetDemandIds.length,0);
  assert.equal(b.branchArtifacts[0].status,'pending_adoption');assert.equal(b.unmetDemandIds.length,1);h.db.close();
});

test('append source preserves existing fingerprint and IDs; replacing referenced source makes projection stale',async () => {
  const h=await harness();const range=await h.range(0,1000);
  const [before]=await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[range],reason:'buffer'});
  h.addSource('src2',2);const [after]=await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[range],reason:'action_dependency'});
  assert.equal(before.intent.segmentId,after.intent.segmentId);assert.equal((await h.store.listSegments('w')).length,1);
  h.members[0].normalizedTreeHash=sha('replacement');assert.equal((await h.service.readReadiness({worldId:'w'})).segments[0].status,'stale');h.db.close();
});

test('overlaps and adjacent ranges merge without inventing continuous coverage and only missing gaps become work',async () => {
  const h=await harness();await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[await h.range(0,1000)],reason:'near_domain'});
  const records=await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[await h.range(500,1500),await h.range(1500,2000),await h.range(4000,4100)],reason:'action_dependency',demandRef:ref()});
  assert.equal(records.length,2);assert.deepEqual(records[1].intent.ranges.map(v=>[v.startCp,v.endCp]),[[1000,2000],[4000,4100]]);
  assert.equal(records[0].intent.ranges[0].endCp,1000);assert.equal(records[0].intent.priority,'P1');h.db.close();
});

test('competing planners deduplicate overlapping work transactionally and executor ensure remains idempotent',async () => {
  const h=await harness();const other=new SegmentBuildService(h.options);
  const ranges=[[await h.range(0,1000)],[await h.range(500,1500)]];
  await Promise.all([h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:ranges[0],reason:'buffer',demandRef:ref('b1')}),
    other.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:ranges[1],reason:'action_dependency',demandRef:ref('b2')})]);
  const segments=await h.store.listSegments('w');assert.equal(segments.length,2);
  const covered=segments.flatMap(s=>s.intent.ranges).sort((a,b)=>a.startCp-b.startCp);assert.equal(covered[0].endCp,covered[1].startCp);
  await Promise.all([h.service.dispatch('w'),other.dispatch('w')]);assert.equal(h.executions.size,2);h.db.close();
});

test('near-domain buffer stops at two, staying in scene does not scan the book, pause and budget stop admission',async () => {
  const h=await harness();const input={worldId:'w',executionConfigFingerprint:config,currentRanges:[await h.range(0,3200)],demandRef:ref()};
  const candidates=await h.service.prepareRecent(input);assert.equal(candidates.length,2);
  assert.deepEqual(candidates.map(s=>s.intent.ranges.map(r=>[r.startCp,r.endCp])),[[[3200,5000]],[[5000,10000]]]);
  for(let i=0;i<10;i++) assert.equal((await h.service.prepareRecent({...input,demandRef:ref('b1',i)})).length,0);
  assert.equal((await h.store.listSegments('w')).length,2);
  await h.service.setPause('w','user');assert.equal((await h.service.dispatch('w')).length,0);assert.equal((await h.service.prepareRecent({...input,dependencyRanges:[await h.range(12000,12100)]})).length,0);
  await h.service.resume('w');assert.equal((await h.service.prepareRecent({...input,budgetAllowed:false})).length,0);assert.equal((await h.service.prepareRecent({...input,lifecycleAllowed:false})).length,0);h.db.close();
});

test('latency estimates are conservative for sparse samples and urgent side dependencies bypass speculative buffer limit',async () => {
  assert.equal(estimateBuildLeadTimeMs([100]),120000);assert.equal(estimateBuildLeadTimeMs([200000]),200000);
  assert.equal(estimateBuildLeadTimeMs([10,20,30,40,50,60,70,80,90,100]),90);
  const h=await harness();const input={worldId:'w',executionConfigFingerprint:config,currentRanges:[await h.range(0,3200)],demandRef:ref()};
  await h.service.prepareRecent(input);
  const work=await h.service.prepareRecent({...input,dependencyRanges:[await h.range(16000,17000)],higherPriorityPending:true});
  assert.equal(work.length,1);assert.equal(work[0].intent.priority,'P1');assert.equal(work[0].intent.reason,'action_dependency');h.db.close();
});

test('unknown remote outcomes block ready and are never retried by planner; lost execution is explicit',async () => {
  const h=await harness();const opening=await h.service.ensureBootstrap({worldId:'w',executionConfigFingerprint:config});await h.service.dispatch('w');
  const [segment]=await h.store.listSegments('w');h.publish(segment);const run=h.executions.get(segment.runIds[0]);run.requestOutcome='outcome_unknown';
  const readiness=await h.service.readReadiness({worldId:'w'});assert.equal(readiness.segments[0].status,'needs_review');assert.equal(readiness.diagnostics[0].code,'outcome_unknown');
  const calls=h.ensures.length;await h.service.dispatch('w');assert.equal(h.ensures.length,calls);
  h.executions.delete(segment.runIds[0]);h.artifacts.length=0;assert.equal((await h.service.readReadiness({worldId:'w'})).segments[0].lastErrorCode,'execution_projection_unavailable');h.db.close();
});

test('canceling a branch demand keeps shared work; deleting world cascades and late projections cannot resurrect it',async () => {
  const h=await harness();const range=await h.range(0,1000);
  const [segment]=await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[range],reason:'buffer',demandRef:ref('b1')});
  await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[range],reason:'buffer',demandRef:ref('b2')});
  const demands=await h.store.listDemands('w');await h.service.cancelDemand(demands.find(d=>d.ref.branchId==='b1').demandId);
  assert.equal((await h.store.listSegments('w'))[0].status,'planned');
  await h.service.cancelDemand(demands.find(d=>d.ref.branchId==='b2').demandId);assert.equal((await h.store.listSegments('w'))[0].status,'canceled');
  assert.equal(await h.store.saveProjection({...segment,status:'planned'}),false);assert.equal((await h.store.listSegments('w'))[0].status,'canceled');
  const [resumed]=await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[range],reason:'action_dependency',demandRef:ref('b1',1)});
  assert.equal(resumed.status,'planned');
  h.db.exec("DELETE FROM worlds WHERE world_id='w'");assert.equal(await h.store.saveProjection(segment),false);assert.equal(await h.store.attachRuns(segment.intent.segmentId,1,['late-run'],'later'),false);
  assert.equal((await h.store.listSegments('w')).length,0);assert.equal((await h.store.listDemands('w')).length,0);h.db.close();
});

test('measured lead time triggers the second candidate without consuming by turn count; network wait is projected',async () => {
  const h=await harness();const first=await h.range(3200,5000),second=await h.range(5000,10000);
  const input={worldId:'w',executionConfigFingerprint:config,currentRanges:[await h.range(0,3200)],demandRef:ref()};
  assert.equal((await h.service.prepareRecent({...input,candidateRanges:[[first]]})).length,1);
  const now=Date.parse(h.options.now());
  assert.equal((await h.service.prepareRecent({...input,candidateRanges:[[second]],expectedNeedAtMs:now+300000,latencySamplesMs:[100000]})).length,0);
  assert.equal((await h.service.prepareRecent({...input,candidateRanges:[[second]],expectedNeedAtMs:now+60000,latencySamplesMs:[100000]})).length,1);
  await h.service.dispatch('w');const [segment]=await h.store.listSegments('w');Object.assign(h.executions.get(segment.runIds[0]),{status:'waiting_network',retryAt:'2026-10-02T12:01:00.000Z'});
  const view=await h.service.readReadiness({worldId:'w'});assert.equal(view.pauseReason,'network');assert.equal(view.diagnostics[0].retryAt,'2026-10-02T12:01:00.000Z');h.db.close();
});

test('malformed ranges/config and damaged persisted contracts are rejected rather than guessed into legacy tasks',async () => {
  const h=await harness();const valid=await h.range(0,1000);
  await assert.rejects(h.service.requestDemand({worldId:'w',executionConfigFingerprint:'x',ranges:[valid],reason:'bootstrap'}),/invalid_execution_config/);
  await assert.rejects(h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[{...valid,endCp:30000}],reason:'bootstrap'}),/invalid_source_range/);
  await assert.rejects(h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[{...valid,rangeContentHash:sha('wrong')}],reason:'bootstrap'}),/range_content_changed/);
  await h.service.ensureBootstrap({worldId:'w',executionConfigFingerprint:config});h.db.exec("UPDATE world_segments SET intent_json='{}'");
  await assert.rejects(h.store.listSegments('w'),/invalid_persisted_segment/);h.db.close();
});

test('explicit API replacement freezes prior intent, refuses unknown or live calls and preserves both branch demands',async()=>{
 const h=await harness();try {
  const [old]=await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[await h.range(0,1000)],reason:'action_dependency',demandRef:ref('b1')});
  await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:old.intent.ranges,reason:'action_dependency',demandRef:ref('b2')});
  await h.service.dispatch('w');const saved=(await h.store.listSegments('w'))[0],run=h.executions.get(saved.runIds[0]),next=sha('new frozen API');
  await assert.rejects(h.service.replaceStoppedExecution({worldId:'w',segmentId:old.intent.segmentId,executionConfigFingerprint:next}),/segment_still_running/);
  Object.assign(run,{status:'needs_review',requestOutcome:'outcome_unknown'});
  await assert.rejects(h.service.replaceStoppedExecution({worldId:'w',segmentId:old.intent.segmentId,executionConfigFingerprint:next}),/ledger_confirmation/);
  assert.equal((await h.store.listSegments('w')).length,1);assert.equal((await h.store.listDemands('w')).filter(d=>d.active).length,2);
  Object.assign(run,{status:'failed_retryable',requestOutcome:'known_failed'});
  const replacements=await h.service.replaceStoppedExecution({worldId:'w',segmentId:old.intent.segmentId,executionConfigFingerprint:next});
  assert.ok(replacements.every(s=>s.intent.segmentId!==old.intent.segmentId&&s.intent.executionConfigFingerprint===next));
  await h.service.dispatch('w');const records=await h.store.listSegments('w'),prior=records.find(s=>s.intent.segmentId===old.intent.segmentId),fresh=records.find(s=>s.intent.segmentId!==old.intent.segmentId);
  assert.equal(prior.status,'stale');assert.equal(prior.intent.executionConfigFingerprint,config);assert.equal(fresh.intent.demandRefs.length,2);
  assert.deepEqual((await h.store.listDemands('w')).filter(d=>d.active).map(d=>d.ref.branchId).sort(),['b1','b2']);
  assert.equal(h.ensures.filter(i=>i.segmentId===old.intent.segmentId).length,1);
  assert.equal(await h.store.saveProjection({...prior,status:'mapping'}),false);
 }finally{h.db.close()}
});

test('rewind/advanced state releases obsolete demand refs; a second branch keeps the shared sent work alive',async()=>{
 const h=await harness();try{
  const range=await h.range(3200,6400);
  await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[range],reason:'action_dependency',demandRef:ref('b1')});
  await h.service.requestDemand({worldId:'w',executionConfigFingerprint:config,ranges:[range],reason:'action_dependency',demandRef:ref('b2')});
  await h.service.dispatch('w');
  await h.service.releaseStaleBranchDemands({worldId:'w',campaignId:'c',branchId:'b1',stateVersion:1});
  assert.deepEqual(h.controls,[]);assert.deepEqual((await h.store.listSegments('w'))[0].intent.demandRefs.map(r=>r.branchId),['b2']);
  await h.service.releaseStaleBranchDemands({worldId:'w',campaignId:'c',branchId:'b2',stateVersion:null});
  assert.equal(h.controls.length,1);assert.equal(h.controls[0][1],'cancel');assert.deepEqual((await h.store.listSegments('w'))[0].intent.demandRefs,[]);
 }finally{h.db.close()}
});
