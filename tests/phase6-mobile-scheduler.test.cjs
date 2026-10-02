'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {loadMobileModule,NodeSqliteAdapter}=require('./helpers/mobileHarness.cjs');
const {SqliteSchedulerResourceStore,RESOURCE_GOVERNANCE_SQL}=require('../dist/infra/sqlite/sqliteSchedulerResourceStore');
const {GlobalRateScheduler,endpointBucketId}=require('../dist/application/worldBuild/rateScheduler');
const profile=(endpoint,concurrency=2)=>({id:'test',name:'test',endpoint,model:'test',keyRef:'k',concurrency,rpm:10,tpm:100,
  capabilities:{supportsJson:true,supportsStreaming:false,reportsUsage:true,contextWindow:10000,maxOutputTokens:2000}});

test('mobile segment admission reads shared foreground pressure, retained token debt and Retry-After',async()=>{
  const db=new DatabaseSync(':memory:');db.exec(RESOURCE_GOVERNANCE_SQL);
  const store=new SqliteSchedulerResourceStore(new NodeSqliteAdapter(db));
  const mobile=loadMobileModule('mobile/src/llmScheduler.ts');mobile.configureSchedulerPersistence(store);
  const p=profile('https://quota-test.invalid/shared');mobile.setPlayScreenActivity(true);
  const remote=new GlobalRateScheduler({endpointBucketId:endpointBucketId(p.endpoint),resourceStore:store,maxConcurrent:2,rpm:10,tpm:100});
  try{
    assert.equal((await mobile.readSegmentSchedulingAdmission(p,60)).backgroundBudgetAvailable,true);
    const foreground=await remote.acquire(20,{priority:'P0',logicalTaskId:'remote-turn'});
    const active=await mobile.readSegmentSchedulingAdmission(p,60);
    assert.equal(active.higherPriorityPending,true);assert.equal(active.backgroundBudgetAvailable,false);assert.equal(active.requestFeasible,true);
    const unknownHorizon=await mobile.readSegmentSchedulingAdmission(p,60,Date.now()+61000);
    assert.equal(unknownHorizon.higherPriorityPending,true,'an unreleased remote request keeps its slot past the minute window');
    assert.equal(unknownHorizon.backgroundBudgetAvailable,false);
    await foreground.release();
    assert.equal((await mobile.readSegmentSchedulingAdmission(p,60)).backgroundBudgetAvailable,false,'20 + 60 exceeds reserved 75-token headroom');
    assert.equal((await mobile.readSegmentSchedulingAdmission(p,60,Date.now()+61000)).backgroundBudgetAvailable,true);
    remote.noteRetryAfter(120000);await remote.flush();
    assert.equal((await mobile.readSegmentSchedulingAdmission(p,10)).backgroundBudgetAvailable,false);
    assert.equal((await mobile.readSegmentSchedulingAdmission(p,101)).requestFeasible,false);
  }finally{mobile.setPlayScreenActivity(false);await remote.flush();await mobile.schedulerForProfile(p).flush();db.close()}
});

test('concurrency one keeps speculative work off the play path while a submitted P1 dependency stays feasible',async()=>{
  const mobile=loadMobileModule('mobile/src/llmScheduler.ts');const p=profile('https://quota-test.invalid/single',1);
  mobile.setPlayScreenActivity(true);
  const playing=await mobile.readSegmentSchedulingAdmission(p,50);
  assert.equal(playing.requestFeasible,true);assert.equal(playing.backgroundBudgetAvailable,false);
  mobile.setPlayScreenActivity(false);
  assert.equal((await mobile.readSegmentSchedulingAdmission(p,50)).backgroundBudgetAvailable,true);
});
