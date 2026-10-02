'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {createPhase6MobileHarness}=require('./helpers/phase6MobileHarness.cjs');
const profile={id:'test',name:'test',endpoint:'https://example.invalid/v1',model:'test',keyRef:'k',reasoningTier:'low',concurrency:2,
 capabilities:{supportsJson:true,supportsStreaming:false,reportsUsage:true,contextWindow:60000,maxOutputTokens:12000}};
test('production streaming entry uses bounded segments, persistent index and one existing fenced run; reimport reuses work',async()=>{
 const bytes=Buffer.from('书名与版权说明\n第一章 初抵边境\n'+ '林辰来到旧桥，查看桥头的石阶。'.repeat(1000)+'\n第二章 山门\n'+'山门尚未到达。'.repeat(1000));
 const h=await createPhase6MobileHarness({bytes});try{
  const first=await h.sourceImport.importNovelForOpeningStreaming('memory','synthetic.txt',profile,()=>{});
  assert.equal(first.strategy,'progressive');assert.deepEqual(first.stages,[]);assert.equal(first.runIds.length,1);
  const run=await h.runStore.getRun(first.runIds[0]);const scope=JSON.parse(run.scopeJson);
  assert.equal(scope.startCp,0);assert.equal(scope.endCp,6000);assert.ok(first.codePointCount>scope.endCp*3);
  assert.equal((await h.adapter.queryOne('SELECT COUNT(*) AS n FROM world_stage_plans')).n,0);
  assert.ok((await h.adapter.queryOne('SELECT COUNT(*) AS n FROM source_index_pages')).n>0);
  const again=await h.sourceImport.importNovelForOpeningStreaming('memory','synthetic.txt',profile,()=>{});
  assert.deepEqual(again.runIds,first.runIds);assert.equal(again.reusedSource,true);
  assert.equal((await h.runtime.worldStore.listWorldSources(first.worldId)).length,1);
  const unit=(await h.runStore.listUnits(run.runId))[0];
  const token=await h.runStore.acquireLease(run.runId,'test-owner',30000,new Date().toISOString());
  await h.runStore.completeUnit({unitId:unit.unitId,fencingToken:token,status:'completed',now:new Date().toISOString()});
  await h.runStore.completeUnit({unitId:unit.unitId,fencingToken:token,status:'completed',now:new Date().toISOString()});
  assert.equal((await h.runStore.getRun(run.runId)).unitsDone,1);
 }finally{h.db.close()}
});
test('production partial extraction never publishes empty canon; failed opening has durable diagnosis',async()=>{
 const bytes=Buffer.from('第一章\n'+ '这是没有可验证人物与地点的合成文本。'.repeat(300));let calls=0;
 const h=await createPhase6MobileHarness({bytes,transport:{async post(){calls++;return{status:200,headers:{},body:JSON.stringify({choices:[{message:{content:JSON.stringify({entities:[],facts:[],events:[],ruleMappings:[]})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:50}})}}}});
 try{
  const first=await h.sourceImport.importNovelForOpeningStreaming('memory','synthetic.txt',profile,()=>{});
  const result=await h.sourceImport.runExtraction(first.runIds[0],profile,()=>{});
  assert.equal(result.completed,false);assert.equal(await h.runtime.worldStore.getPublishedPackageRevision(first.worldId),null);
  assert.ok((await h.adapter.queryOne('SELECT COUNT(*) AS n FROM segment_publication_diagnostics')).n>0);
  assert.equal(calls,1,'one exact focused extraction; no separate survey, registry, timeline or paid mapping call');
 }finally{h.db.close()}
});

test('production API switch returns a new frozen segment run and leaves the old config intact',async()=>{
 const h=await createPhase6MobileHarness({bytes:Buffer.from('第一章\n'+'林辰来到旧桥。'.repeat(1200))});try{
  const first=await h.sourceImport.importNovelForOpeningStreaming('memory','synthetic.txt',profile,()=>{}),id=first.runIds[0],before=await h.runStore.getRun(id);
  await h.runStore.setRunStatus(id,'failed_retryable',new Date().toISOString(),'test_known_failure','synthetic');
  const next=await h.sourceImport.useCurrentApiForRun(id,{...profile,id:'next',endpoint:'https://backup.invalid/v1'});
  assert.notEqual(next,id);assert.equal((await h.runStore.getRun(id)).configJson,before.configJson);
  assert.equal(JSON.parse((await h.runStore.getRun(next)).configJson).endpoint,'https://backup.invalid/v1');
  const old=await h.runtime.segmentPlans.findSegmentByRunId(id),fresh=await h.runtime.segmentPlans.findSegmentByRunId(next);
  assert.equal(old.status,'stale');assert.notEqual(old.intent.executionConfigFingerprint,fresh.intent.executionConfigFingerprint);
 }finally{h.db.close()}
});

test('explicit full mode admits only two missing P3 windows, resumes the actual host and honors pause',async()=>{
 const started=[];const h=await createPhase6MobileHarness({bytes:Buffer.from('第一章\n'+'林辰来到旧桥。'.repeat(4000)),moduleMocks:{'./segmentRuntime':{async startSegmentRun(id){started.push(id)}}}});try{
  const first=await h.sourceImport.importNovelForOpeningStreaming('memory','synthetic.txt',profile,()=>{});
  await assert.rejects(h.sourceImport.switchToFullBuild(first.worldId),/开局资料/);
  const bootstrap=(await h.runtime.segmentPlans.listSegments(first.worldId))[0];
  h.runtime.segmentPublication.listPublishedArtifacts=async()=>[{artifactId:'synthetic-certified-opening',worldId:first.worldId,segmentId:bootstrap.intent.segmentId,generation:1,sourceBinding:bootstrap.intent.sourceBinding,coverage:bootstrap.intent.ranges}];
  const ids=await h.sourceImport.switchToFullBuild(first.worldId);assert.equal(ids.length,2);assert.deepEqual(started,ids);
  const windows=(await h.runtime.segmentPlans.listSegments(first.worldId)).filter(s=>s.intent.reason==='user_full');assert.equal(windows.length,2);assert.ok(windows.every(s=>s.intent.priority==='P3'&&s.intent.ranges[0].endCp-s.intent.ranges[0].startCp<=3200));
  assert.deepEqual(await h.sourceImport.switchToFullBuild(first.worldId),[]);assert.equal(started.length,2);
  await h.runtime.segments.setPause(first.worldId,'user');assert.deepEqual(await h.sourceImport.switchToFullBuild(first.worldId),[]);
 }finally{h.db.close()}
});
