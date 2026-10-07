const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,candidateModel}=require('./helpers/phase9CampaignFixture.cjs');
const {actorReferenceInScope}=require('../dist/domain/campaignPlan/actorReferences');
const {assessMethod}=require('../dist/application/guidance/candidates');
const {SqliteGuidanceStore}=require('../dist/infra/sqlite/sqliteGuidanceStore');

test('actor references: template-backed NPC aliases share the existing scope, unknown aliases stay rejected',()=>{
  const scope={openingActorIds:new Set(['pc']),openingTemplateIds:new Set(['tpl-lin'])};
  for(const id of ['pc','tpl-lin','npc-tpl-lin'])assert.equal(actorReferenceInScope(id,scope),true);
  for(const id of ['npc-invented','npc-npc-tpl-lin',null,[]])assert.equal(actorReferenceInScope(id,scope),false);
});

test('actor references: relationship preparation consumes the same directed snapshot relation through template or actual actor identity',async()=>{
  const h=await fixture();try{
    const state=structuredClone(await h.turns.getState(h.branchId)),cards=state.cards.map(row=>row.card);
    const pc=cards.find(c=>c.actorId==='pc'),npc=cards.find(c=>c.templateId==='tpl-lin');
    const candidate=await h.planStore.getCandidate('cand-t'),situation=candidate.artifact.situations[0],method=structuredClone(situation.definition.methods[1]);
    state.relationships=[{fromActorId:'pc',toActorId:npc.actorId,closeness:14}];
    const context={state,playerCard:pc,cardsByName:new Map(cards.map(c=>[c.actorId,c])),entries:(await h.worlds.getWorldPackage('w',1)).entries,
      situationStatuses:new Map(state.situations.map(s=>[s.situationId,s])),causalWorldTimeOrder:1};
    for(const relationshipTo of ['tpl-lin',npc.actorId]){
      method.requires={relationshipTo,minCloseness:14};assert.equal(assessMethod(situation.entryId,method,context).eligible,true);
      method.requires.minCloseness=15;assert.equal(assessMethod(situation.entryId,method,context).eligible,false);
    }
    method.requires={relationshipTo:'tpl-lin',minCloseness:14};state.relationships=[{fromActorId:npc.actorId,toActorId:'pc',closeness:14}];
    assert.equal(assessMethod(situation.entryId,method,context).eligible,false,'reverse relation is not player closeness');
  }finally{h.db.close();}
});

test('actor references: prompt-listed NPC target compiles and binds the same frozen method for selected and free-text production turns',async()=>{
  let selected;
  for(const click of [true,false]){
    const model=candidateModel();model.firstSituation.methods[1].firstStep.targetEntryId='npc-tpl-lin';
    const h=await fixture({model});try{
      h.session.deps.guidance=new SqliteGuidanceStore(h.adapter);
      const candidate=await h.planStore.getCandidate('cand-t'),original=structuredClone(candidate.artifact);
      const method=original.situations[0].definition.methods[1];
      const guide=await h.session.ensureDecisionPointGuidance({campaignId:h.campaignId,branchId:h.branchId,sourceTurnId:'test',localOnly:true});
      const step=guide.steps.find(s=>s.methodId===method.methodId);assert.equal(step.availability,'available');
      const result=await h.session.playTurn({campaignId:h.campaignId,branchId:h.branchId,intent:click?method.firstStep.intent:'请'+method.firstStep.intent,
        ...(click?{guidanceChoice:{decisionPoint:guide.decisionPoint,candidateRef:step.candidateRef}}:{})});
      const row=h.db.prepare("SELECT action_contract_json FROM turns WHERE branch_id=? AND committed_state_version=? AND status='Committed'").get(h.branchId,result.stateVersion);
      const contract=JSON.parse(row.action_contract_json);assert.equal(contract.targetId,'npc-tpl-lin');assert.equal(contract.methodRef.methodId,method.methodId);
      if(click)selected=contract.methodRef;else assert.deepEqual(contract.methodRef,selected);
      assert.deepEqual((await h.planStore.getCandidate('cand-t')).artifact,original);
    }finally{h.db.close();}
  }
});
