'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createPhase6MobileHarness } = require('./helpers/phase6MobileHarness.cjs');
const { loadMobileModule } = require('./helpers/mobileHarness.cjs');
const { LedgeredProvider, OutcomeUnknownReplayError } = require('../dist/application/llm/requestLedger');
const profile = { id:'test', name:'test', endpoint:'https://example.invalid/v1', model:'test', keyRef:'k', reasoningTier:'low', concurrency:2,
  capabilities:{ supportsJson:true, supportsStreaming:false, reportsUsage:true, contextWindow:60000, maxOutputTokens:12000 } };
async function setup() {
  let calls = 0;
  const h = await createPhase6MobileHarness({bytes:Buffer.from('第一章 旧桥\n'+'林辰来到旧桥，守桥人问候他。'.repeat(1800)),
    transport:{async post(){calls++;throw new TypeError('Network request failed.')}}});
  const imported = await h.sourceImport.importNovelForOpeningStreaming('memory','synthetic.txt',profile,()=>{});
  const id = imported.runIds[0];
  await h.sourceImport.runExtraction(id,profile,()=>{});
  const unit = (await h.runStore.listUnits(id))[0];
  const logical = `world-extract:${id}:${unit.unitId}:all`;
  const meta = { logicalRequestId:logical, requestKind:'world_extract', worldId:imported.worldId, modelProfileFingerprint:'fp' };
  const ledger = h.runtime.llmLedger;
  const unknown = (await ledger.listAttempts(logical))[0];
  assert.equal(unknown.status,'outcome_unknown');assert.equal(calls,1);
  return {...h,id,unit,logical,meta,ledger,unknown,worldId:imported.worldId,calls:()=>calls};
}
function modules(h) {
  const mocks={'./database':{async getDatabaseRuntime(){return h.runtime}}};
  return {tasks:loadMobileModule('mobile/src/buildTasks.ts',mocks),
    projects:loadMobileModule('mobile/src/projectLibrary.ts',{...mocks,'./worldImport':{},'./runtime':{}})};
}
async function foreignRun(h) {
  const plan = await h.runtime.segmentPlans.getPlan(h.worldId);
  const range = await h.runtime.sourceCatalog.createRange(h.unit.sourceId ?? (await h.runStore.getRun(h.id)).sourceId,6500,7200);
  const records = await h.runtime.segments.requestDemand({worldId:h.worldId,executionConfigFingerprint:plan.executionConfigFingerprint,
    ranges:[range],reason:'near_domain',priority:'P2'});
  await h.runtime.segments.dispatch(h.worldId);
  const segment = (await h.runtime.segmentPlans.listSegments(h.worldId)).find(s=>s.intent.segmentId===records[0].intent.segmentId);
  return segment.runIds[0];
}
function withIds(snapshot,attempts) {
  return {...snapshot,attemptIds:attempts.map(a=>a.attemptId),attempts:attempts.map(a=>({attemptId:a.attemptId,requestKind:a.requestKind,
    startedAt:a.startedAt,wireOutputTokens:a.wireOutputTokens}))};
}
test('legacy world-shared mapping failure recovers its exact job hash without locking completed openings',async()=>{
  const h=await setup();try {
    await h.ledger.acknowledgeBuildReplay(await h.ledger.readBuildReplay(h.id));
    await h.runStore.setRunStatus(h.id,'failed_retryable',new Date().toISOString(),'package_finalize_failed');
    const logical=`world-mapping:${h.worldId}:job-map-${h.worldId}-${'a'.repeat(64)}`;
    const pending=await h.ledger.beginAttempt({...h.meta,logicalRequestId:logical,requestKind:'world_mapping'},Date.now());
    await h.ledger.updateAttempt(pending.attemptId,{status:'outcome_unknown'});
    assert.equal(await h.ledger.readBuildRequestOutcome(h.id,h.worldId),'outcome_unknown');
    assert.deepEqual((await h.ledger.readBuildReplay(h.id)).attemptIds,[pending.attemptId]);
    await assert.rejects(h.sourceImport.useCurrentApiForRun(h.id,{...profile,endpoint:'https://backup.invalid/v1'}),/扣费结果未知/);
    assert.deepEqual([...(await h.ledger.readBuildUnknownRunIds([h.worldId]))],[h.id]);
    await h.runStore.setRunStatus(h.id,'completed',new Date().toISOString());
    assert.equal(await h.ledger.readBuildReplay(h.id),null);
    await h.runStore.setRunStatus(h.id,'failed_retryable',new Date().toISOString(),'package_finalize_failed');
    await h.ledger.acknowledgeBuildReplay(await h.ledger.readBuildReplay(h.id));
    assert.equal(await h.ledger.readBuildRequestOutcome(h.id,h.worldId),'known');
    assert.equal((await h.ledger.listAttempts(logical))[0].status,'outcome_unknown');
  }finally{h.db.close()}
});
test('legacy registry and timeline unknowns require exact run/world/hash and retain separate approvals',async()=>{
  const h=await setup();try {
    await h.ledger.acknowledgeBuildReplay(await h.ledger.readBuildReplay(h.id));
    const expected=[];
    for(const kind of ['registry','timeline']) {
      const valid=await h.ledger.beginAttempt({...h.meta,logicalRequestId:`world-${kind}:${h.id}:${h.worldId}:${'b'.repeat(64)}`,requestKind:kind},Date.now());
      await h.ledger.updateAttempt(valid.attemptId,{status:'outcome_unknown'});expected.push(valid.attemptId);
      for(const logical of [`world-${kind}:${h.id}suffix:${h.worldId}:${'b'.repeat(64)}`,`world-${kind}:${h.id}:other-world:${'b'.repeat(64)}`,`world-${kind}:${h.id}:${h.worldId}:not-a-hash`]) {
        const foreign=await h.ledger.beginAttempt({...h.meta,logicalRequestId:logical,requestKind:kind},Date.now());
        await h.ledger.updateAttempt(foreign.attemptId,{status:'outcome_unknown'});
      }
    }
    assert.deepEqual((await h.ledger.readBuildReplay(h.id)).attemptIds,expected);
    await h.ledger.acknowledgeBuildReplay(await h.ledger.readBuildReplay(h.id));
    assert.equal(await h.ledger.readBuildRequestOutcome(h.id,h.worldId),'known');
  }finally{h.db.close()}
});
test('lease takeover fences atomic renew/release/heartbeat and expired ownership cannot be renewed',async()=>{
  const h=await setup();try {
    const first='2026-10-03T12:00:00.000Z',after='2026-10-03T12:00:02.000Z';
    let old=await h.runStore.acquireLease(h.id,'old-host',1000,first);
    assert.equal(await h.runStore.renewLease(h.id,'old-host',old,1000,after),false);
    const execute=h.adapter.execute.bind(h.adapter);let inject=true;
    h.adapter.execute=async(sql,params)=>{
      if(inject && sql.includes('SET lease_owner = NULL')) {
        inject=false;assert.notEqual(await h.runStore.acquireLease(h.id,'new-host',60000,after),null);
      }
      return execute(sql,params);
    };
    assert.equal(await h.runStore.releaseLease(h.id,'old-host',old,after),false);
    const current=await h.runStore.getRun(h.id);assert.equal(current.leaseOwner,'new-host');assert.ok(current.fencingToken>old);
    assert.equal(await h.runStore.renewLease(h.id,'old-host',old,60000,after),false);
    assert.equal(await h.runStore.heartbeat(h.id,'old-host',after),false);
    assert.equal(await h.runStore.heartbeat(h.id,'new-host',after),true);
    assert.equal((await h.runStore.getRun(h.id)).leaseOwner,'new-host');
    assert.equal(await h.runStore.releaseLease(h.id,'new-host',current.fencingToken,after),true);
  }finally{h.db.close()}
});
async function linkMapping(h,id,logical) {
  const owner=`mapping-${id}`,now=new Date().toISOString();
  const token=await h.runStore.acquireLease(id,owner,60000,now);assert.notEqual(token,null);
  await assert.rejects(h.runStore.recordMappingRequest(id,logical,token-1,now),/fence_lost/);
  await h.runStore.recordMappingRequest(id,logical,token,now);
  await h.runStore.releaseLease(id,owner,token,new Date().toISOString());
}
test('native-style opaque network failure is projected from the ledger, blocks resume/API replacement and never dispatches twice',async()=>{
  const h=await setup();try {
    assert.equal((await h.runStore.listUnits(h.id))[0].errorCode,'outcome_unknown');
    const readiness=await h.runtime.segments.readReadiness({worldId:h.worldId});
    assert.equal(readiness.segments[0].status,'needs_review');assert.equal(readiness.segments[0].lastErrorCode,'outcome_unknown');
    const {tasks,projects}=modules(h), task=(await tasks.listBuildTasksForWorld(h.worldId))[0];
    assert.equal(task.status,'needs_review');assert.deepEqual(task.replayRecovery.attemptIds,[h.unknown.attemptId]);
    assert.equal((await projects.listProjectBuildSummaries([h.worldId])).get(h.worldId).status,'review');
    await assert.rejects(h.sourceImport.resumeRun(h.id),/扣费结果未知/);
    await assert.rejects(h.sourceImport.useCurrentApiForRun(h.id,{...profile,endpoint:'https://backup.invalid/v1'}),/扣费结果未知/);
    await h.sourceImport.runExtraction(h.id,profile,()=>{});assert.equal(h.calls(),1);
    assert.equal((await h.ledger.listAttempts(h.logical)).length,1);
  } finally {h.db.close()}
});
test('an exact approved build retry may dispatch once despite retained unknown metrics, then parks the new unknown',async()=>{
  const h=await setup();try {
    await h.ledger.acknowledgeBuildReplay(await h.ledger.readBuildReplay(h.id));
    await h.sourceImport.resumeRun(h.id);
    await h.sourceImport.runExtraction(h.id,profile,()=>{});
    assert.equal(h.calls(),2,'formal approval permits one new attempt');
    const attempts=await h.ledger.listAttempts(h.logical);
    assert.equal(attempts.length,2);assert.ok(attempts[0].replayApprovedAt>0);
    assert.equal(attempts[1].status,'outcome_unknown');assert.equal(attempts[1].replayApprovedAt,null);
    await h.sourceImport.runExtraction(h.id,profile,()=>{});assert.equal(h.calls(),2);
  }finally{h.db.close()}
});
test('exact approval preserves unknown usage and user pause; it sends nothing and a later interruption needs separate approval',async()=>{
  const h=await setup();try {
    await h.runStore.requestRunControl(h.id,'pause',new Date().toISOString());
    await h.runStore.setRunStatus(h.id,'paused_user',new Date().toISOString());
    const before=await h.runStore.getRun(h.id),snapshot=await h.ledger.readBuildReplay(h.id);
    await h.ledger.acknowledgeBuildReplay(snapshot);
    await h.ledger.acknowledgeBuildReplay(snapshot); // idempotent acknowledgement, no extra dispatch
    assert.deepEqual(await h.runStore.getRun(h.id),before);assert.equal(h.calls(),1);
    const old=(await h.ledger.listAttempts(h.logical))[0];
    assert.equal(old.status,'outcome_unknown');assert.equal(old.inputTokens,null);assert.ok(old.replayApprovedAt>0);
    assert.equal(await h.ledger.readBuildReplay(h.id),null);
    assert.equal(await h.ledger.readBuildRequestOutcome(h.id,h.worldId),'known');
    await h.sourceImport.resumeRun(h.id);
    let sent=0;
    const provider=new LedgeredProvider({async complete(){sent++;return{text:'known result'}}},h.ledger,{modelProfileFingerprint:'fp'});
    const request={role:'WorldExtractor',system:'s',user:'u',maxOutputTokens:100,ledger:h.meta};
    await provider.complete(request);assert.equal(sent,1);
    const next=await h.ledger.beginAttempt(h.meta,Date.now());
    await h.ledger.updateAttempt(next.attemptId,{status:'outcome_unknown'});
    await assert.rejects(provider.complete(request),OutcomeUnknownReplayError);assert.equal(sent,1);
    const later=await h.ledger.readBuildReplay(h.id);assert.deepEqual(later.attemptIds,[next.attemptId]);
    assert.equal((await h.ledger.listAttempts(h.logical))[2].replayApprovedAt,null);
  } finally {h.db.close()}
});
test('approval rejects foreign units, worlds, turn requests and overlapping identifiers atomically',async()=>{
  const h=await setup();try {
    const otherId=await foreignRun(h), otherUnit=(await h.runStore.listUnits(otherId))[0];
    const foreign=await h.ledger.beginAttempt({...h.meta,logicalRequestId:`world-extract:${otherId}:${otherUnit.unitId}:all`},Date.now());
    await h.ledger.updateAttempt(foreign.attemptId,{status:'outcome_unknown'});
    const forged=await h.ledger.beginAttempt({...h.meta,logicalRequestId:`world-extract:${h.id}:foreign-unit:all`},Date.now());
    await h.ledger.updateAttempt(forged.attemptId,{status:'outcome_unknown'});
    const turn=await h.ledger.beginAttempt({...h.meta,logicalRequestId:'planner:branch:turn',requestKind:'planner'},Date.now());
    await h.ledger.updateAttempt(turn.attemptId,{status:'outcome_unknown'});
    const snapshot=await h.ledger.readBuildReplay(h.id);
    assert.deepEqual(snapshot.attemptIds,[h.unknown.attemptId]);
    for(const alien of [foreign,forged,turn]) await assert.rejects(h.ledger.acknowledgeBuildReplay(withIds(snapshot,[h.unknown,alien])),/不属于/);
    await assert.rejects(h.ledger.acknowledgeBuildReplay({...snapshot,worldId:'other-world'}),/不存在/);
    assert.equal((await h.ledger.listAttempts(h.logical))[0].replayApprovedAt,null);
  } finally {h.db.close()}
});
test('approval refuses altered displayed request kind, timestamp and wire budget before any acknowledgement',async()=>{
  const h=await setup();try {
    const snapshot=await h.ledger.readBuildReplay(h.id);
    for(const patch of [{requestKind:'world_mapping'},{startedAt:snapshot.attempts[0].startedAt+1},
      {wireOutputTokens:(snapshot.attempts[0].wireOutputTokens??0)+1}]) {
      await assert.rejects(h.ledger.acknowledgeBuildReplay({...snapshot,attempts:[{...snapshot.attempts[0],...patch}]}),/请求信息已更新/);
      assert.equal((await h.ledger.listAttempts(h.logical))[0].replayApprovedAt,null);
    }
    assert.equal(h.calls(),1);
  }finally{h.db.close()}
});
test('approval fences stale controls/source/model, live leases, sent work and deletion without reviving data',async()=>{
  const h=await setup();try {
    const snapshot=await h.ledger.readBuildReplay(h.id);
    for(const [column,value] of [['fencing_token',snapshot.fencingToken+1],['pause_requested',1],['source_snapshot_hash','changed'],['model_fingerprint','changed']]) {
      const old=(await h.adapter.queryOne(`SELECT ${column} AS value FROM world_build_runs WHERE run_id=?`,[h.id])).value;
      await h.adapter.execute(`UPDATE world_build_runs SET ${column}=? WHERE run_id=?`,[value,h.id]);
      await assert.rejects(h.ledger.acknowledgeBuildReplay(snapshot),/状态已更新/);
      await h.adapter.execute(`UPDATE world_build_runs SET ${column}=? WHERE run_id=?`,[old,h.id]);
    }
    await h.adapter.execute('UPDATE world_build_runs SET lease_owner=?,lease_expires_at=? WHERE run_id=?',['other',new Date(Date.now()+60000).toISOString(),h.id]);
    await assert.rejects(h.ledger.acknowledgeBuildReplay(snapshot),/执行者/);
    await h.adapter.execute('UPDATE world_build_runs SET lease_owner=NULL,lease_expires_at=NULL WHERE run_id=?',[h.id]);
    const next=await h.ledger.beginAttempt({...h.meta,logicalRequestId:`world-extract:${h.id}:${h.unit.unitId}:world`},Date.now());
    await h.ledger.updateAttempt(next.attemptId,{status:'sent'});
    await assert.rejects(h.ledger.acknowledgeBuildReplay(snapshot),/正在发送/);
    await h.ledger.updateAttempt(next.attemptId,{status:'failed'});
    await h.adapter.execute('DELETE FROM worlds WHERE world_id=?',[h.worldId]);
    await assert.rejects(h.ledger.acknowledgeBuildReplay(snapshot),/不存在/);
    assert.equal(await h.ledger.readBuildReplay(h.id),null);
    assert.equal(await h.runtime.worldStore.getWorld(h.worldId),null);
  } finally {h.db.close()}
});
test('shared mapping approval stays world-scoped and an unrelated known call cannot clear an untracked legacy unknown unit',async()=>{
  const h=await setup();try {
    const otherId=await foreignRun(h);
    const logicalMapping=`world-mapping:${h.worldId}:job-shared`;
    await linkMapping(h,h.id,logicalMapping);await linkMapping(h,otherId,logicalMapping);
    await h.runStore.setRunPlanState(otherId,JSON.stringify({bodyTargetRatio:0.12,replanCount:2}),new Date().toISOString());
    assert.deepEqual(JSON.parse((await h.runStore.getRun(otherId)).planStateJson).mappingRequestIds,[logicalMapping]);
    await h.runtime.worldStore.upsertJob({worldId:h.worldId,jobId:'job-shared',kind:'rule_mapping',targetId:null,status:'pending',attempts:1,
      contentHash:'hash',extractorVersion:'m',modelFingerprint:'fp',usageJson:null,resultJson:null,error:null,createdAt:'t',updatedAt:'t'},'t');
    const mapping=await h.ledger.beginAttempt({...h.meta,logicalRequestId:logicalMapping,requestKind:'world_mapping'},Date.now());
    await h.ledger.updateAttempt(mapping.attemptId,{status:'outcome_unknown'});
    assert.equal(await h.ledger.readBuildRequestOutcome(otherId,h.worldId),'outcome_unknown');
    await h.ledger.acknowledgeBuildReplay(await h.ledger.readBuildReplay(h.id));
    assert.equal(await h.ledger.readBuildRequestOutcome(otherId,h.worldId),'known');
    assert.equal((await h.ledger.listAttempts(mapping.logicalRequestId))[0].status,'outcome_unknown');
    const otherUnit=(await h.runStore.listUnits(otherId))[0];
    await h.adapter.execute("UPDATE world_build_units SET status='needs_review',error_code='outcome_unknown' WHERE unit_id=?",[otherUnit.unitId]);
    assert.equal(await h.ledger.readBuildRequestOutcome(otherId,h.worldId),'outcome_unknown');
    assert.equal(await h.ledger.readBuildReplay(otherId),null,'no invented attempt or blanket legacy bypass');
  } finally {h.db.close()}
});
test('an unrelated future mapping unknown leaves the completed opening known and batch projections scope only linked runs',async()=>{
  const h=await setup();try {
    await h.ledger.acknowledgeBuildReplay(await h.ledger.readBuildReplay(h.id));
    await h.runStore.setRunStatus(h.id,'completed',new Date().toISOString());
    const otherId=await foreignRun(h),logical=`world-mapping:${h.worldId}:future-job`;
    await linkMapping(h,otherId,logical);
    const pending=await h.ledger.beginAttempt({...h.meta,logicalRequestId:logical,requestKind:'world_mapping'},Date.now());
    await h.ledger.updateAttempt(pending.attemptId,{status:'outcome_unknown'});
    assert.equal(await h.ledger.readBuildRequestOutcome(h.id,h.worldId),'known');
    assert.equal(await h.ledger.readBuildReplay(h.id),null);
    assert.equal(await h.ledger.readBuildRequestOutcome(otherId,h.worldId),'outcome_unknown');
    assert.deepEqual([...(await h.ledger.readBuildUnknownRunIds([h.worldId]))],[otherId]);
    assert.equal((await modules(h).tasks.listBuildTasksForWorld(h.worldId)).find(t=>t.runId===h.id).status,'completed');
    await h.ledger.acknowledgeBuildReplay(await h.ledger.readBuildReplay(otherId));
    assert.deepEqual([...(await h.ledger.readBuildUnknownRunIds([h.worldId]))],[]);
  } finally {h.db.close()}
});
