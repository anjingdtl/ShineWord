const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,candidateModel,NOW}=require('./helpers/phase9CampaignFixture.cjs');
const {loadMobileModule,sha}=require('./helpers/mobileHarness.cjs');
const {GlobalRateScheduler}=require('../dist/application/worldBuild/rateScheduler');
const {SqliteLlmLedgerStore}=require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const {SqliteStoryMemoryStore}=require('../dist/application/memory/storyMemoryRepository');
const {SqliteGameStore}=require('../dist/infra/sqlite/sqliteGameStore');
const {SqliteNarrativeStore}=require('../dist/infra/sqlite/sqliteNarrativeStore');
const {readBoundCampaignArtifacts}=require('../dist/application/campaignPlan/boundArtifacts');
const {forkBranch}=require('../dist/application/branch/fork');
const {loadCampaignContentCatalog}=require('../dist/application/campaign/contentCatalog');
const {buildPlayUiProjection}=require('../dist/application/campaign/playProjection');
const {SqliteSegmentArtifactStore}=require('../dist/infra/sqlite/sqliteSegmentArtifactStore');
const {SegmentPublicationService}=require('../dist/application/segmentPublication/service');
function model(){
 const m=candidateModel();m.clues=[{clueId:'testimony',title:'林凡核实的证词',text:'货箱是在入夜前由陌生车队卸下，林凡愿意指认车辆。',
  sourceEntryIds:['tpl-lin','lore-crates'],provenance:{kind:'design_fill',sourceFactIds:[],rationale:'当前现场的战役线索'}}];
 for(const grade of ['success','full_success'])m.firstSituation.methods[1].outcomes[grade].effects.push({template:'grant_knowledge',entryId:'testimony'});
 return m;
}
function mobile(h){
 let calls=0;
 const runtime={db:h.adapter,turns:h.turns,game:new SqliteGameStore(h.adapter),worldStore:h.worlds,
  narratives:new SqliteNarrativeStore(h.adapter),llmLedger:new SqliteLlmLedgerStore(h.adapter),storyMemory:new SqliteStoryMemoryStore(h.adapter)};
 const api=loadMobileModule('mobile/src/runtime.ts',{
  './database':{getDatabaseRuntime:async()=>runtime},
  './nativeCrypto':{nativeSha256:sha,createNativeRandomBytes:()=>({nextByte(){throw Error('Read path requested RNG')}})},
  './llmScheduler':{schedulerForProfile:()=>new GlobalRateScheduler({maxConcurrent:1}),setSchedulerActivity(){}},
  './secureKeyStore':{KeychainSecretStore:class{async get(){throw Error('Read path requested credentials')}}},
  './fetchTransport':{FetchHttpTransport:class{async post(){calls++;throw Error('Read path dispatched HTTP')}}},
  './llmExecutionBridge':{acquirePlanningExecution:async()=>{throw Error('Read path acquired execution')}},
  './profileStore':{},
 });
 const projection=loadMobileModule('mobile/src/playProjection.ts',{'./runtime':api,'./database':{getDatabaseRuntime:async()=>runtime},'./nativeCrypto':{nativeSha256:sha}});
 return {api,projection,get calls(){return calls}};
}
async function context(h){const state=await h.turns.getState(h.branchId);const artifacts=await readBoundCampaignArtifacts(h.adapter,h.campaignId,state.campaignContentBinding);
 const summary=await h.session.getSummary(h.campaignId,h.branchId);return {state,artifacts,clue:artifacts[0].clues[0],input:{worldId:summary.worldId,packageRevision:summary.packageRevision,campaignId:h.campaignId,branchId:h.branchId}};}

test('mobile world book resolves a committed campaign clue body from the same owned archive, without revealing it on an unaware fork',async()=>{
 const h=await fixture({model:model()});
 try{
  const {input,clue}=await context(h),m=mobile(h);
  const worldBefore=h.db.prepare('SELECT * FROM world_packages ORDER BY revision').all();
  const archivesBefore=h.db.prepare('SELECT * FROM campaign_content_artifacts ORDER BY artifact_id').all();
  await forkBranch({db:h.adapter,turnStore:h.turns,gameStore:new SqliteGameStore(h.adapter),sourceBranchId:h.branchId,targetBranchId:'book-sibling',campaignId:h.campaignId,forkTurnId:null,createdAt:NOW});
  const before=await m.api.getWorldBookProjection(input);assert.ok(!before.entries.some(e=>e.entryId===clue.entryId));
  await h.session.playTurn({campaignId:h.campaignId,branchId:h.branchId,intent:'向林凡打听青石巷最近的情况'});
  const known=await m.api.getWorldBookProjection(input);const entry=known.entries.find(e=>e.entryId===clue.entryId);
  assert.equal(entry?.definition.text,clue.definition.text);
  assert.ok(known.sections.some(s=>s.book==='player_handbook'&&s.entryIds.includes(clue.entryId)));
  const sibling=await m.api.getWorldBookProjection({...input,branchId:'book-sibling'});
  assert.ok(!sibling.entries.some(e=>e.entryId===clue.entryId));assert.ok(!sibling.sections.some(s=>s.entryIds.includes(clue.entryId)));
  const worldOnly=await m.api.getWorldBookProjection({worldId:input.worldId,packageRevision:input.packageRevision});
  assert.ok(!worldOnly.entries.some(e=>e.entryId===clue.entryId));
  assert.deepEqual(h.db.prepare('SELECT * FROM world_packages ORDER BY revision').all(),worldBefore);
  assert.deepEqual(h.db.prepare('SELECT * FROM campaign_content_artifacts ORDER BY artifact_id').all(),archivesBefore);assert.equal(m.calls,0);
 }finally{h.db.close()}
});

test('play knowledge projection exposes the lore body only after actual player discovery',async()=>{
 const h=await fixture({model:model()});
 try{
  const {clue}=await context(h),m=mobile(h);
  assert.ok(!(await m.projection.getPlayUiProjection(h.campaignId,h.branchId)).discoveries.some(d=>d.entryId===clue.entryId));
  await h.session.playTurn({campaignId:h.campaignId,branchId:h.branchId,intent:'向林凡打听青石巷最近的情况'});
  const discovery=(await m.projection.getPlayUiProjection(h.campaignId,h.branchId)).discoveries.find(d=>d.entryId===clue.entryId);
  assert.equal(discovery?.body,clue.definition.text);assert.equal(discovery.title,clue.definition.title);
 }finally{h.db.close()}
});

test('a branch with an adopted campaign binding and absent optional world manifest still uses the campaign authority catalog',async()=>{
 const h=await fixture({model:model()});
 try{
  const {state,clue,input}=await context(h);
  const entries=await h.session.loadPackageEntries(input.worldId,input.packageRevision,{campaignId:h.campaignId,state:{...state,contentManifest:undefined}});
  assert.ok(entries.some(e=>e.entryId===clue.entryId));
 }finally{h.db.close()}
});

test('both mobile readers reject a corrupt campaign archive instead of silently falling back to the world package',async()=>{
 const h=await fixture({model:model()});
 try{
  const {input,artifacts}=await context(h),m=mobile(h);
  const altered=structuredClone(artifacts[0]);altered.clues[0].definition.text='CORRUPT_SECRET';
  h.db.prepare('UPDATE campaign_content_artifacts SET artifact_json=? WHERE artifact_id=?').run(JSON.stringify(altered),altered.artifactId);
  await assert.rejects(m.api.getWorldBookProjection(input),/哈希不符/);
  await assert.rejects(m.projection.getPlayUiProjection(h.campaignId,h.branchId),/哈希不符/);
  assert.equal(m.calls,0);
 }finally{h.db.close()}
});

test('knowledge bodies respect player ownership, lore kind and GM visibility even when a discovery row exists',async()=>{
 const h=await fixture({model:model()});
 try{
  const summary=await h.session.getSummary(h.campaignId,h.branchId);
  const playerId=summary.cards.find(card=>card.controller==='player').actorId;
  const base=(await h.worlds.getWorldPackage(summary.worldId,summary.packageRevision)).entries[0];
  const entries=[['known','lore','discoverable'],['other-player','lore','discoverable'],['gm-secret','lore','gm'],['non-lore','situation','public']]
   .map(([entryId,kind,visibility])=>({...base,entryId,kind,visibility,definition:{title:entryId,text:entryId+' BODY'}}));
  const state={...summary.state,discoveries:entries.map(e=>({entryId:e.entryId,actorId:e.entryId==='other-player'?'someone-else':playerId,knownVia:'told',knownAtStateVersion:0,sourceTurnId:'test'}))};
  const view=buildPlayUiProjection({...summary,campaignId:h.campaignId,branchId:h.branchId,state,entries});
  assert.equal(view.discoveries.find(d=>d.entryId==='known').body,'known BODY');
  assert.ok(!view.discoveries.some(d=>d.entryId==='other-player'));
  assert.ok(!JSON.stringify(view).includes('gm-secret BODY'));assert.ok(!JSON.stringify(view).includes('non-lore BODY'));
 }finally{h.db.close()}
});

test('the real segment owner and adopted campaign archive compose together; an absent owner is an error',async()=>{
 const h=await fixture({model:model()});
 try{
  const {state,input,clue}=await context(h);
  const publication=new SegmentPublicationService({store:new SqliteSegmentArtifactStore(h.adapter,sha.sha256Hex),worldStore:h.worlds,sourceCatalog:{},sha256Hex:sha.sha256Hex});
  const binding=await publication.freezeBinding(h.campaignId,h.branchId);
  const opts={db:h.adapter,worldStore:h.worlds,sha256Hex:sha.sha256Hex,worldId:input.worldId,packageRevision:input.packageRevision,
   branch:{campaignId:h.campaignId,state:{...state,segmentContentBinding:binding}}};
  const catalog=await loadCampaignContentCatalog({...opts,segmentContent:publication});
  assert.ok(catalog.entries.some(e=>e.entryId===clue.entryId));assert.ok(catalog.entries.some(e=>e.entryId==='tpl-lin'));
  assert.ok(catalog.sections.some(s=>s.entryIds.includes(clue.entryId)));
  await assert.rejects(loadCampaignContentCatalog(opts),/Segment content owner is unavailable/);
  await assert.rejects(loadCampaignContentCatalog({...opts,segmentContent:publication,branch:{campaignId:'foreign',state:opts.branch.state}}),/missing_branch|哈希不符/);
 }finally{h.db.close()}
});
