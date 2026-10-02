'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadMobileModule,sha}=require('./helpers/mobileHarness.cjs');
const hash='a'.repeat(64);
const range=(startCp,endCp)=>({sourceId:'source',normalizedTreeHash:hash,startCp,endCp,rangeContentHash:'b'.repeat(64)});
const fact=(id,start,end,revealAt=null)=>({worldId:'world',factId:id,subjectEntityId:'forest',predicate:'named_location',value:{location:'旧桥'},
  status:'explicit',confidence:1,validFrom:null,validTo:null,revealAt,scope:'world',
  sources:[{chapterId:'chapter-1',startOffset:start,endOffset:end,quote:'旧桥',quoteSha256:'b'.repeat(64)}]});
function fixture({anchor=0,appState='active',pauseReason=null,adopt='adopted',dependency=false,dependencyReason='action_dependency',unknown=false,
  admission={requestFeasible:true,backgroundBudgetAvailable:true,higherPriorityPending:false,retryAfterUntil:null}}={}){
  const prepared=[],searched=[],started=[];
  const input={worldId:'world',campaignId:'campaign',branchId:'branch',stateVersion:2,locationId:'future-place'};
  const artifact0={artifactId:'a0',worldId:'world',segmentId:'bootstrap',generation:1,coverage:[range(0,3200)]};
  const artifact1={artifactId:'a1',worldId:'world',segmentId:'dependency',generation:1,coverage:[range(3200,6400)]};
  const intent={intentId:'intent',worldId:'world',segmentId:'dependency',generation:1,ranges:[range(3200,6400)],reason:dependencyReason,priority:dependencyReason==='action_dependency'?'P1':'P2',
    demandRefs:[{campaignId:'campaign',branchId:'branch',stateVersion:2}]};
  let currentBinding={campaignId:'campaign',branchId:'branch',stateVersion:2,artifactIds:['a0'],manifestHash:hash,artifactManifestHash:hash};
  const readiness=()=>({worldId:'world',segments:dependency?[{intent,runIds:[],artifactIds:unknown?[]:['a1'],status:unknown?'needs_review':'ready',lastErrorCode:unknown?'outcome_unknown':null}]:[],
    availableArtifacts:dependency&&!unknown?[artifact0,artifact1]:[artifact0],currentBinding,pauseReason,unmetDemandIds:[],diagnostics:[],indexCoverage:[],recentCandidates:[],executingRanges:[]});
  const runtime={db:{async queryOne(){return {world_id:'world',anchor_json:JSON.stringify({worldTimeOrder:anchor}),opening_json:JSON.stringify({protagonistActorId:'player'}),state_version:2}},async queryAll(){return[]}},
    turns:{async getState(){return {stateVersion:2,actors:{player:{locationId:'旧桥'}},party:[{role:'protagonist',actorId:'player'}]}}},
    segmentPlans:{async getPlan(){return{worldId:'world',executionConfigFingerprint:hash,pauseReason}}},
    segmentConfigs:{async get(){return{endpoint:'https://example.invalid',model:'m',keyRef:'k',profileId:'p',profileName:'p',concurrency:2,contextWindowTokens:60000,
      maxOutputTokens:16000,contentOutputTokens:8000,reasoningReserveTokens:1000,reasoningTier:'low',reasoningDialect:'generic'}}},
    segments:{async readReadiness(){return readiness()},async prepareRecent(value){prepared.push(value);return[]},async dispatch(){return[]}},
    segmentPublication:{async adoptAtSafeBoundary(){if(adopt==='adopted')currentBinding={...currentBinding,artifactIds:readiness().availableArtifacts.map(a=>a.artifactId)};return{status:adopt}}},
    segmentArtifacts:{async recordDiagnostic(){throw new Error('unexpected diagnostic')}},
    sourceCatalog:{async snapshot(){return{binding:{sourceSetHash:hash,members:[{sourceId:'source',sourceOrdinal:1,normalizedTreeHash:hash}]},members:[{sourceId:'source',sourceOrdinal:1,normalizedTreeHash:hash,codePointCount:20000}]}},async createRange(sourceId,start,end){return range(start,end)}},
    sourceIndex:{async search(value){searched.push(value);return{hits:[{range:range(3500,3600),text:'未来正文不得进玩家上下文'}],completeness:'partial',coverage:[]}}},
    worldStore:{async listEntities(){return[{entityId:'forest',type:'location',name:'旧桥'},{entityId:'future-place',type:'location',name:'未来王城'}]},
      async listFacts(){return[fact('present',100,180),fact('future',15000,15100,'10'),fact('corrupt-time',17000,17100,'not-a-time')]}},
  };
  const module=loadMobileModule('mobile/src/segmentRuntime.ts',{
    'react-native':{AppState:{currentState:appState}},'./database':{async getDatabaseRuntime(){return runtime}},
    './phase6ExecutionHost':{AndroidSegmentExecutionHost:class{async start(id){started.push(id)}}},'./buildWatchdog':{async startOrResumeBuild(){}},
    './nativeCrypto':{nativeSha256:sha},'./secureKeyStore':{KeychainSecretStore:class{async get(){return'private'}}},
    './sourceImport':{async requestSegmentRunControl(){}},'./llmScheduler':{async readSegmentSchedulingAdmission(){return admission}},
  });
  return{module,runtime,input,prepared,searched,started};
}

test('segment runtime uses the persisted player location and campaign anchor; null/malformed anchors fail closed',async()=>{
  const f=fixture();await f.module.maintainSegmentContent({...f.input,anchorWorldTimeOrder:100});
  assert.equal(f.prepared.length,1);assert.deepEqual(f.prepared[0].currentRanges.map(r=>[r.startCp,r.endCp]),[[100,180]]);
  assert.deepEqual(f.prepared[0].candidateRanges.map(rs=>rs.map(r=>[r.startCp,r.endCp])),[[[3200,6400]],[[6400,9600]]]);
  for(const anchor of [null,'10']){const blocked=fixture({anchor});await blocked.module.maintainSegmentContent(blocked.input);assert.equal(blocked.prepared.length,0)}
});

test('segment runtime connects OS lifecycle and unified quota/priority signals instead of adding background work unconditionally',async()=>{
  const admission={requestFeasible:true,backgroundBudgetAvailable:false,higherPriorityPending:true,retryAfterUntil:Date.now()+60000};
  const f=fixture({appState:'background',admission});await f.module.maintainSegmentContent(f.input);
  assert.equal(f.prepared[0].lifecycleAllowed,false);assert.equal(f.prepared[0].budgetAllowed,false);assert.equal(f.prepared[0].higherPriorityPending,true);
  assert.equal(f.started.length,0);
  const paused=fixture({pauseReason:'user'});await paused.module.maintainSegmentContent(paused.input);assert.equal(paused.prepared[0].lifecycleAllowed,false);
  const infeasible=fixture({admission:{...admission,requestFeasible:false}});
  const held=await infeasible.module.maintainSegmentContent({...infeasible.input,intent:'查看旧桥'});
  assert.equal(held.pending,true);assert.match(held.message,/配额不足/);
  assert.equal(infeasible.prepared[0].budgetAllowed,false);assert.equal(infeasible.started.length,0);
});

test('a submitted action waits for branch adoption and an unknown paid dependency remains pending without a retry',async()=>{
  const waiting=fixture({dependency:true,adopt:'pending'});
  const before=await waiting.module.maintainSegmentContent({...waiting.input,intent:'查看旧桥'});assert.equal(before.pending,true);
  const readyBuffer=fixture({dependency:true,dependencyReason:'buffer',adopt:'pending'});
  assert.equal((await readyBuffer.module.maintainSegmentContent({...readyBuffer.input,intent:'查看旧桥'})).pending,true,
    'a world-ready buffer is still a missing action dependency until adopted by this branch');
  const ready=fixture({dependency:true});assert.equal((await ready.module.maintainSegmentContent({...ready.input,intent:'查看旧桥'})).pending,false);
  const unknown=fixture({dependency:true,unknown:true});const held=await unknown.module.maintainSegmentContent({...unknown.input,intent:'查看旧桥'});
  assert.equal(held.pending,true);assert.match(held.message,/扣费结果未知/);assert.equal(unknown.started.length,0);
  assert.equal(unknown.prepared[0].dependencyRanges[0].startCp,3200,'search hits reuse the stable near-domain window');
  assert.equal(unknown.prepared[0].dependencyRanges[0].endCp,6400);
  assert.equal(unknown.prepared[0].higherPriorityPending,true,'required P1 work cannot also request speculative buffers');
  assert.equal(unknown.searched[0].scope.kind,'build_internal');
});
