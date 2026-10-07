const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,candidateModel,NOW}=require('./helpers/phase9CampaignFixture.cjs');
const {parseCampaignPlanCandidate,PROPOSAL_TEXT_LIMITS}=require('../dist/application/campaignPlan/candidateModel');
const {runOpeningPlanJob}=require('../dist/application/campaignPlan/planningService');
const {canonicalJsonOf,sha256HexOf}=require('../dist/application/campaignPlan/hashing');

test('proposal fields: each strict boundary reports its own field and length, without truncating or discarding supplied content',()=>{
  for(const [field,{min,max}] of Object.entries(PROPOSAL_TEXT_LIMITS)){
    for(const length of [min-1,max+1]){
      const model=candidateModel();model.proposal[field]='字'.repeat(length);const before=structuredClone(model),errors=[];
      assert.equal(parseCampaignPlanCandidate(model,errors),null);
      assert.equal(errors.length,1);assert.match(errors[0],new RegExp('proposal\\.'+field+': string of '+min+'\\.\\.'+max));
      assert.deepEqual(model,before);
    }
    for(const length of [min,max]){
      const model=candidateModel();model.proposal[field]='字'.repeat(length);const errors=[];
      const parsed=parseCampaignPlanCandidate(model,errors);assert.deepEqual(errors,[]);assert.equal(parsed.proposal[field],model.proposal[field]);
    }
  }
});

test('proposal fields: a too-long tone repairs in the bounded production job while preserving every other field and the full intent',async()=>{
  const h=await fixture();try{
    const model=candidateModel(),bad=structuredClone(model);bad.proposal.tone='务实建设的低魔开拓感：一砖一瓦地建立信任，在贫穷、教会阴影与王位斗争之间寻找立足之地。';
    assert.ok(bad.proposal.tone.length>40);
    const id='proposal-tone',setup=await h.planStore.getSetup('setup-t'),intent={...setup.intent,setupId:id};
    await h.planStore.upsertSetup({...setup,setupId:id,intent,status:'planning',currentCandidateId:null});
    await h.planStore.insertJob({jobId:id,setupId:id,campaignId:null,branchId:null,jobKind:'opening_plan',triggerReasons:['test'],baseStateVersion:null,basePlanId:null,basePlanRevision:null,
      intentHash:sha256HexOf(canonicalJsonOf(intent)),contentManifestHash:null,knowledgePolicyHash:null,triggerEventRefs:[],status:'queued',leaseOwner:null,leaseExpiresAt:null,fencingToken:0,
      attemptCount:0,nextRetryAt:null,physicalRequestBudget:2,freezeRootId:null,lastError:null,createdAt:NOW,updatedAt:NOW});
    const profile={id:'test',name:'Test',endpoint:'https://example.invalid',model:'test',keyRef:'k',reasoningTier:'low',capabilities:{contextWindow:60000,maxOutputTokens:12000,supportsJson:true}};
    let calls=0;const repaired=structuredClone(bad);repaired.proposal.tone='务实建设';
    const provider={async complete(request){calls++;assert.ok(request.user.includes(intent.rawIntent));assert.match(request.system,/tone 2\.\.40/);
      if(calls===2)assert.match(request.user,/proposal\.tone: string of 2\.\.40/);return {text:JSON.stringify(calls===1?bad:repaired)};}};
    const deps={db:h.adapter,planStore:h.planStore,worldStore:h.worlds,provider,profile},args={anchorTitle:'开篇',playerName:'旅人',protagonistSkills:['skill-observation'],openingGoalSuggestions:[]};
    const result=await runOpeningPlanJob(deps,id,args);assert.equal(result.status,'candidate_ready',JSON.stringify(result));assert.equal(calls,2);
    const saved=await h.planStore.latestCandidateForJob(id),raw=JSON.parse(saved.rawResponseText);
    assert.deepEqual({...raw.proposal,tone:bad.proposal.tone},bad.proposal);assert.equal(saved.repairUsed,true);
    await runOpeningPlanJob(deps,id,args);assert.equal(calls,2);assert.equal((await h.planStore.getSetup(id)).intent.rawIntent,intent.rawIntent);
  }finally{h.db.close();}
});
