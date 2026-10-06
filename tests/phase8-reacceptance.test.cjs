'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { NodeSqliteAdapter, sha } = require('./helpers/mobileHarness.cjs');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { RootFrozenMaterialsStore } = require('../dist/application/context/frozenTurnMaterialsStore');
const { compileWorldRuleConfiguration } = require('../dist/application/content/ruleConfigCompiler');
const { compileObservations } = require('../dist/application/memory/storyMemoryObservationCompiler');
const { evaluateCheckpointEligibility } = require('../dist/application/memory/storyMemoryEligibility');
const { emptyStoryMemoryState } = require('../dist/application/memory/storyMemoryTypes');
const { storyMemoryFingerprint } = require('../dist/application/memory/storyMemoryMerger');
const { sha256Hex } = require('../dist/domain/identity/sha256');

test('portable SHA-256 agrees with Node for empty, Unicode, unpaired surrogates and multiple blocks', () => {
  for (const text of ['', 'abc', '放开那个女巫🙂', '\ud800', 'a'.repeat(10000)]) {
    assert.equal(sha256Hex(text), require('node:crypto').createHash('sha256').update(text, 'utf8').digest('hex'));
  }
});

function configuration(overrides = {}) {
  return { schemaVersion: 'world-rule-config-1', worldId: 'review', revision: 1,
    core: { id: 'shineword-core', version: '0.4.0' },
    modules: [{ moduleId: 'resources_conditions', version: '1.0.0', parameters: {} }],
    vocabulary: {}, constraints: [], provenance: [], configHash: '', ...overrides };
}

test('reacceptance: a forged configuration hash is rejected rather than trusted', () => {
  const compiled = compileWorldRuleConfiguration(configuration({ configHash: 'forged' }));
  assert.equal(compiled.ok, false);
  assert.ok(compiled.diagnostics.some(d => d.code === 'configuration_hash_mismatch'));
});

test('reacceptance: disabling skill/exploration/social removes their action capabilities', () => {
  const compiled = compileWorldRuleConfiguration(configuration());
  assert.equal(compiled.ok, true);
  for (const kind of ['skill_check', 'move', 'talk']) {
    assert.equal(compiled.capabilityTable.actionKinds.includes(kind), false, kind);
  }
});

test('reacceptance: an unanchored objective must not enter the accepted memory patch', () => {
  const compiled = compileObservations({ branchId: 'b', evidence: [{ eventId: 'e', turnId: 't',
    stateVersion: 1, eventType: 'committed_turn', payload: {}, publicSummary: '观察广场' }],
    rawObservationText: JSON.stringify({ narrative: { currentObjective: '建立帝国' } }) });
  assert.equal(compiled.accepted, false);
  assert.equal(compiled.advanceCheckpoint, false);
});

test('reacceptance: an unrelated accepted observation cannot hide an omitted critical turn', () => {
  const compiled = compileObservations({ branchId: 'b', evidence: [
    { eventId: 'e1', turnId: 't1', stateVersion: 1, eventType: 'grantItem',
      payload: { actorId: 'pc', itemId: 'key' }, publicSummary: '获得钥匙' },
    { eventId: 'e2', turnId: 't2', stateVersion: 2, eventType: 'committed_turn',
      payload: {}, publicSummary: '休息' }],
    rawObservationText: JSON.stringify({ observations: [
      { kind: 'character', actorId: 'pc', action: 'upsert', evidenceTurnIds: ['t2'] }] }) });
  assert.equal(compiled.advanceCheckpoint, false);
  assert.ok(compiled.diagnostics.some(d => d.code === 'known_change_missing'));
});

test('reacceptance: checkpoint eligibility rejects non-finite and negative coverage', () => {
  for (const through of [NaN, Infinity, -1, 0.5]) {
    const state = emptyStoryMemoryState('b', 'now');
    state.throughStateVersion = through;
    Object.assign(state.metadata, { status: 'clean', fingerprint: 'valid-looking' });
    assert.equal(evaluateCheckpointEligibility({ memoryState: state, branchId: 'b',
      currentStateVersion: 2 }).usable, false, String(through));
  }
});

test('reacceptance: memory fingerprints include actual mood, relations and evidence content', () => {
  const patch = { schemaVersion: 3, range: { fromStateVersion: 0, toStateVersion: 1 },
    characterUpdates: [{ actorId: 'pc', emotionalState: '平静', evidenceTurnIds: ['t1'] }],
    relationshipUpdates: [], conflictChanges: [], threadChanges: [],
    foreshadowingChanges: [], completedBeats: [] };
  const changed = structuredClone(patch);
  changed.characterUpdates[0].emotionalState = '恐惧';
  assert.notEqual(storyMemoryFingerprint('seed', 'p', patch), storyMemoryFingerprint('seed', 'p', changed));
});

test('reacceptance: durable freeze retains identity and rejects a different branch payload', async () => {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) db.exec(migration.sql);
  const store = new RootFrozenMaterialsStore(new NodeSqliteAdapter(db), sha);
  const root = { campaignId: 'campaign', branchId: 'branch', turnId: 'turn',
    logicalRequestId: 'turn:context', role: 'turn', stage: 'context_bundle', attempt: 1,
    payload: { stateBaseline: { branchId: 'branch', expectedStateVersion: 0 },
      capabilitiesFingerprint: 'verified' }, createdAt: 'now' };
  await store.saveRootSnapshot(root);
  const loaded = await store.loadRootSnapshot('branch', 'turn', 'turn:context');
  assert.equal(loaded.campaignId, 'campaign');
  assert.equal(loaded.role, 'turn');
  await assert.rejects(store.saveRootSnapshot({ ...root,
    payload: { ...root.payload, stateBaseline: { branchId: 'other', expectedStateVersion: 0 } } }),
    /branch|identity|frozen|mismatch/i);
  db.close();
});


const {createMobileHarness}=require('./helpers/mobileHarness.cjs');
const rulesRuntime=require('../dist/application/content/runtimeRules');
async function ruleCampaign(preset='fantasy',custom) {
  const h=await createMobileHarness();
  const worldId='reaccept-world';
  await h.runtime.worldStore.createWorld({worldId,title:'验收世界',sourceSha256:'a'.repeat(64),sourceBytes:1,normalizeVersion:'n',chapterSplitVersion:'c',buildStatus:'ready',createdAt:'now',updatedAt:'now'});
  const configuration=custom??rulesRuntime.createWorldRuleConfiguration(worldId,1,preset);
  const entries=[{entryId:'scene-square',kind:'scene',revision:0,visibility:'public',dependencyIds:[],fieldProvenance:{},provenance:{kind:'design_fill',sourceFactIds:[],rationale:'验收夹具'},definition:{name:'广场',description:'广场',locationId:'square',zones:[{zoneId:'center',name:'中央',cover:false,exits:[]}],actors:[],visibleItems:[],hazards:[],clues:[]}}];
  const {publishWorldPackage}=require('../dist/application/worldPackage/publish');
  const published=await publishWorldPackage({worldStore:h.runtime.worldStore,sha256Hex:sha.sha256Hex,worldId,sourceSha256:'a'.repeat(64),mappingVersion:'m',entries,sections:[],ruleConfiguration:configuration,createdAt:'now'});
  await require('../dist/application/campaign/createCampaign').createCampaign({db:h.adapter,worldStore:h.runtime.worldStore,campaignId:'c',title:'验收',worldId,packageRevision:1,
    anchor:{worldTimeOrder:1,locationId:'square'},protagonist:{actorId:'pc',kind:'original',name:'旅人',attributes:{physique:1,agility:1,insight:2,knowledge:1,willpower:1,social:1},initialSkills:[]},goal:'观察广场',createdAt:'now'});
  const turns=new (require('../dist/infra/sqlite/sqliteTurnStore').SqliteTurnStore)(h.adapter);
  return {...h,published,turns};
}

test('production publication, campaign and SQLite read preserve three distinct module selections',async()=>{
 for(const preset of ['fantasy','suspense','daily']){
  const h=await ruleCampaign(preset);try{
   const state=await h.turns.getState('c-main');
   assert.equal(state.ruleConfiguration.configHash,h.published.manifest.ruleConfiguration.configHash);
   assert.equal(state.ruleConfiguration.modules.some(m=>m.moduleId==='combat_zones'),preset==='fantasy');
   assert.equal(state.ruleConfiguration.modules.some(m=>m.moduleId==='pressure_track'),preset==='suspense');
   if(preset==='suspense')assert.equal(state.pressureTracks.tension.level,0);
   const current=await h.runtime.worldStore.getWorldPackage('reaccept-world',1);
   assert.equal(await require('../dist/application/worldPackage/validate').computePackageContentHash(current.entries,current.sections,sha.sha256Hex),current.manifest.contentHash);
  }finally{h.db.close()}
 }
});

test('portable rule hash survives local world-id rebinding but detects a parameter change',()=>{
 const original=rulesRuntime.createWorldRuleConfiguration('world-a',1,'suspense');
 const {computeWorldRuleConfigurationHash}=require('../dist/application/content/ruleConfigCompiler');
 assert.equal(computeWorldRuleConfigurationHash({...original,worldId:'world-b'}),original.configHash);
 const modified=JSON.parse(JSON.stringify(original));modified.modules.find(m=>m.moduleId==='pressure_track').parameters.maxLevel=7;
 assert.notEqual(computeWorldRuleConfigurationHash(modified),original.configHash);
});

test('engine pressure deltas pass the production contract gate; model-authored deltas are refused',async()=>{
 const h=await ruleCampaign('suspense');try{
  const state=await h.turns.getState('c-main');
  const {compileProposal}=require('../dist/application/game/v2Compile');
  const card=JSON.parse((await h.adapter.queryOne("SELECT card_json FROM actor_cards WHERE branch_id='c-main' AND actor_id='pc'")).card_json);
  const action=compileProposal({proposal:{proposalVersion:'2.0',turnId:'t',expectedStateVersion:0,actorId:'pc',actionKind:'skill_check',skillId:'investigate',difficultyBand:'normal',intent:'调查',evidenceIds:[]},actingCard:card,cards:[card],catalog:{investigate:{name:'调查',description:'调查',attribute:'insight',allowUntrained:true,requirements:[],powerTier:'ordinary',usage:'knowledge'}},abilities:new Map(),scenes:[],state});
  const {validateActionContract}=require('../dist/domain/turns/contracts');
  assert.deepEqual(validateActionContract(action.contract,'engine'),[]);
  assert.ok(validateActionContract(action.contract,'planner').some(e=>e.includes('raisePressure')));
  const failed=require('../dist/domain/state/effects').applyEffects(state,action.contract.outcomes.severe_failure.effects,0);
  assert.equal(failed.pressureTracks.tension.level,2);
  const config=JSON.parse(JSON.stringify(state.ruleConfiguration));config.modules.find(m=>m.moduleId==='skill_actions').parameters.untrainedPolicy='forbid';config.configHash='';state.ruleConfiguration=config;
  assert.throws(()=>compileProposal({...action,proposal:{proposalVersion:'2.0',turnId:'t',expectedStateVersion:0,actorId:'pc',actionKind:'skill_check',skillId:'investigate',difficultyBand:'normal',intent:'调查',evidenceIds:[]},actingCard:card,cards:[card],catalog:{investigate:{name:'调查',attribute:'insight',allowUntrained:true}},abilities:new Map(),scenes:[],state}),/未|trained|技能/i);
 }finally{h.db.close()}
});

test('current baseline accepts Android metadata without classifying an empty install as legacy',async()=>{
 const {DatabaseSync}=require('node:sqlite');const {NodeSqliteAdapter}=require('./helpers/mobileHarness.cjs');
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE android_metadata(locale TEXT);');
 try{const installed=await require('../dist/application/project/dbBaseline').installBaselineSchema(new NodeSqliteAdapter(db));assert.deepEqual(installed.appliedVersions,[101]);assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='android_metadata'").get());}finally{db.close()}
});

test('memory observation coverage checks relationship subjects, not just a shared turn id',()=>{
 const compiled=compileObservations({branchId:'b',evidence:[{eventId:'e',turnId:'t',stateVersion:1,eventType:'recordEvent',payload:{eventType:'relationship_changed',payload:{fromActorId:'pc',toActorId:'npc'}},publicSummary:'与阿林建立互信'}],rawObservationText:JSON.stringify({narrative:{currentObjective:'观察广场',evidenceTurnIds:['t']}})});
 assert.equal(compiled.advanceCheckpoint,false);assert.ok(compiled.diagnostics.some(d=>d.code==='known_change_missing'));
});

test('stale memory branch lease rolls back patch, checkpoint, and coverage together',async()=>{
 const h=await ruleCampaign();try{
  const {SqliteStoryMemoryStore}=require('../dist/application/memory/storyMemoryRepository');
  const store=new SqliteStoryMemoryStore(h.adapter),base=emptyStoryMemoryState('c-main','now');await store.saveState(base);
  const patch={schemaVersion:3,evidenceVersions:{t:1},range:{fromStateVersion:0,toStateVersion:1},characterUpdates:[],relationshipUpdates:[],conflictChanges:[],threadChanges:[],foreshadowingChanges:[],completedBeats:[]};
  const next=require('../dist/application/memory/storyMemoryMerger').mergeStoryMemoryPatch(base,{patch,patchId:'p',baseFingerprint:'seed',turnVersions:new Map([['t',1]]),now:'now'});
  await h.adapter.execute("INSERT INTO story_memory_worker_leases VALUES ('c-main','new-owner',2,'2099-01-01')");
  await assert.rejects(()=>store.applyCheckpointAtomically({patchRow:{patchId:'p',fromStateVersion:0,toStateVersion:1,baseFingerprint:'seed',patch},nextState:next,workerFence:{owner:'old-owner',token:1,branchId:'c-main',handoffs:[]}}),/lease|fence/i);
  assert.equal((await store.getState('c-main')).throughStateVersion,0);assert.equal((await store.listPatches('c-main')).length,0);
 }finally{h.db.close()}
});


test('incomplete current baseline is refused without silently repairing or replacing it',async()=>{
 const h=await ruleCampaign();try{
  const baseline=require('../dist/application/project/dbBaseline');
  assert.equal((await baseline.detectLegacyDevelopmentDatabase(h.adapter)).legacy,false);
  await h.adapter.execute('DROP TABLE abandoned_turns');
  assert.equal((await baseline.detectLegacyDevelopmentDatabase(h.adapter)).legacy,true);
  await assert.rejects(()=>baseline.installBaselineSchema(h.adapter),/不完整/);
  assert.equal(await h.adapter.queryOne("SELECT name FROM sqlite_master WHERE name='abandoned_turns'"),null);
  assert.ok(await h.adapter.queryOne("SELECT campaign_id FROM campaigns WHERE campaign_id='c'"));
 }finally{h.db.close()}
});

test('stable save refuses sent/unknown memory requests, but pending unsent coverage remains portable',async()=>{
 const h=await ruleCampaign();try{
  const {exportSave}=require('../dist/application/export/saveFile');
  const options={db:h.adapter,sha256Hex:sha.sha256Hex,campaignId:'c',branchId:'c-main',createdAt:'now'};
  await h.adapter.execute("INSERT INTO llm_request_attempts(attempt_id,logical_request_id,request_kind,branch_id,model_profile_fingerprint,attempt_no,status,started_at) VALUES ('attempt','batch','memory_checkpoint','c-main','model',1,'sent',1)");
  await assert.rejects(()=>exportSave(options),/physical request/);
  await h.adapter.execute("UPDATE llm_request_attempts SET status='outcome_unknown'");
  await assert.rejects(()=>exportSave(options),/unknown/);
  await h.adapter.execute("UPDATE llm_request_attempts SET status='failed'");
  await h.adapter.execute("INSERT INTO frozen_turn_postprocess_outbox(handoff_id,campaign_id,branch_id,turn_id,committed_state_version,public_evidence_hash,has_body,task_schema,status,created_at,updated_at) VALUES ('pending','c','c-main','t',0,'hash',0,'turn-postprocess-handoff-1','running','now','now')");
  await assert.rejects(()=>exportSave(options),/running story-memory/);
  await h.adapter.execute("UPDATE frozen_turn_postprocess_outbox SET status='pending'");
  assert.equal((await exportSave(options)).save.manifest.schemaVersion,'shineword-save-10');
 }finally{h.db.close()}
});


test('paid planner result survives provider reconstruction; changed input and exhausted memory budget do not reset receipts',async()=>{
 const h=await ruleCampaign();try{
  const {LedgeredProvider}=require('../dist/application/llm/requestLedger');
  let http=0;const inner={complete:async()=>{http++;return {text:'paid result'}}};
  const provider=()=>new LedgeredProvider(inner,h.runtime.llmLedger,{modelProfileFingerprint:'model'});
  const request={role:'Planner',system:'s',user:'u',maxOutputTokens:20,ledger:{logicalRequestId:'planner:c-main:t',requestKind:'planner',branchId:'c-main',physicalAttemptLimit:3}};
  assert.equal((await provider().complete(request)).text,'paid result');
  assert.equal((await provider().complete(request)).text,'paid result');assert.equal(http,1);
  await provider().complete({...request,user:'different'});assert.equal(http,2);
  const memory={...request,ledger:{...request.ledger,logicalRequestId:'smp:c-main:0-8',requestKind:'memory_checkpoint'}};
  for(let i=0;i<3;i++)await provider().complete(memory);
  await assert.rejects(()=>provider().complete({...memory,ledger:{...memory.ledger,requestKind:'memory_repair'}}),/physical_budget_exhausted/);
  assert.equal(http,5);assert.equal((await h.runtime.llmLedger.listAttempts('smp:c-main:0-8')).length,3);
 }finally{h.db.close()}
});

test('memory unknown recovery requires exact branch approval and invalidates old worker fencing without erasing its attempt',async()=>{
 const h=await ruleCampaign();try{
  const {LedgeredProvider}=require('../dist/application/llm/requestLedger');let sent=0;
  const provider=new LedgeredProvider({complete:async()=>{sent++;throw new Error('disconnect after dispatch')}},h.runtime.llmLedger,{modelProfileFingerprint:'model'});
  const request={role:'Summarizer',system:'s',user:'u',maxOutputTokens:20,ledger:{logicalRequestId:'smp:c-main:0-8',requestKind:'memory_checkpoint',branchId:'c-main',physicalAttemptLimit:3}};
  await assert.rejects(()=>provider.complete(request),/disconnect/);
  await assert.rejects(()=>provider.complete(request),/unknown/i);assert.equal(sent,1);
  await h.adapter.execute("INSERT INTO story_memory_worker_leases VALUES ('c-main','stale',2,'2099-01-01')");
  await h.adapter.execute("INSERT INTO frozen_turn_postprocess_outbox(handoff_id,campaign_id,branch_id,turn_id,committed_state_version,public_evidence_hash,has_body,task_schema,status,created_at,updated_at) VALUES ('unknown','c','c-main','t',0,'hash',0,'turn-postprocess-handoff-1','outcome_unknown','now','now')");
  const input={campaignId:'c',branchId:'c-main',attemptIds:['smp:c-main:0-8#a1']};
  await assert.rejects(()=>h.runtime.llmLedger.acknowledgeMemoryReplay({...input,campaignId:'wrong'}),/分支/);
  await h.runtime.llmLedger.acknowledgeMemoryReplay(input);
  const attempt=(await h.runtime.llmLedger.listAttempts(request.ledger.logicalRequestId))[0];assert.equal(attempt.status,'outcome_unknown');assert.ok(attempt.replayApprovedAt);
  assert.equal((await h.adapter.queryOne("SELECT fencing_token FROM story_memory_worker_leases WHERE branch_id='c-main'")).fencing_token,3);
  assert.equal((await h.adapter.queryOne("SELECT status FROM frozen_turn_postprocess_outbox WHERE handoff_id='unknown'")).status,'pending');
  const retry=new LedgeredProvider({complete:async()=>{sent++;return {text:'recovered'}}},h.runtime.llmLedger,{modelProfileFingerprint:'model'});
  assert.equal((await retry.complete(request)).text,'recovered');assert.equal(sent,2);
 }finally{h.db.close()}
});


test('milestone-only and disabled growth suppress combat practice settlement as well as narrative practice',async()=>{
 const h=await ruleCampaign('daily');try{
  const {buildTurnSettlement}=require('../dist/application/campaign/session');
  const base={gameStore:new(require('../dist/infra/sqlite/sqliteGameStore').SqliteGameStore)(h.adapter),branchId:'c-main',turnId:'combat-t',encounterId:'combat',actorId:'pc',skillId:'fight',outcomeGrade:'success',stateVersion:1};
  const config=(await h.turns.getState('c-main')).ruleConfiguration;
  assert.equal((await buildTurnSettlement({...base,ruleConfiguration:config})).rewardLedger.length,0);
  assert.equal((await buildTurnSettlement({...base,ruleConfiguration:{...config,modules:config.modules.filter(m=>m.moduleId!=='growth_rest')}})).rewardLedger.length,0);
  assert.equal((await buildTurnSettlement({...base,ruleConfiguration:rulesRuntime.createWorldRuleConfiguration('w',1,'fantasy')})).rewardLedger.length,1);
 }finally{h.db.close()}
});

test('malformed NPC templates fail publication validation before campaign actor construction can crash',()=>{
 const {validateDefinition}=require('../dist/domain/content/types');
 const errors=validateDefinition('actor_template',{name:'阿林',hp:5,defense:1,stamina:5,attributes:{},skills:{},attacks:[],abilities:[]});
 assert.ok(errors.some(e=>e.includes('behavior')));
});


test('Narrator repair is retained across restart; model drift blocks dispatch and original frozen intent stays identical',async()=>{
 const h=await ruleCampaign();try{
  const requests=[];let failSave=true;
  const provider={complete:async request=>{
   requests.push(request);const body=JSON.parse(request.user);
   if(request.role==='Planner')return {text:JSON.stringify({proposalVersion:'2.0',turnId:body.turnId,expectedStateVersion:body.stateVersion??body.expectedStateVersion??0,actorId:'pc',actionKind:'observe',intent:'观察广场的公共环境',evidenceIds:[]})};
   if(!body.repairInstructions)return {text:'{invalid JSON'};
   return {text:JSON.stringify({turnId:body.turnId,outcomeGrade:body.outcomeGrade,text:'你看清了广场，周围十分安静。'})};
  }};
  const baseNarratives=new(require('../dist/infra/sqlite/sqliteNarrativeStore').SqliteNarrativeStore)(h.adapter);
  const narratives=new Proxy(baseNarratives,{get(target,key){if(key==='saveCandidate')return async input=>{if(failSave){failSave=false;throw new Error('injected failure after paid repair')}return target.saveCandidate(input)};const value=target[key];return typeof value==='function'?value.bind(target):value}});
  const deps={db:h.adapter,turns:h.turns,game:new(require('../dist/infra/sqlite/sqliteGameStore').SqliteGameStore)(h.adapter),worldStore:h.runtime.worldStore,narratives,llmLedger:h.runtime.llmLedger,hashProvider:sha,random:{nextIntInclusive:(_m,max)=>max}};
  const profile={endpoint:'https://example.invalid',model:'test',keyRef:'qa',capabilities:{contextWindow:32000,maxOutputTokens:8192,supportsJson:true,reportsUsage:true},reasoningTier:'low'};
  const Session=require('../dist/application/campaign/session').CampaignSession;
  const action={campaignId:'c',branchId:'c-main',intent:'观察广场'};
  await assert.rejects(()=>new Session(deps,provider,profile).playTurn(action),/injected failure/);
  assert.equal(requests.length,3);assert.ok(JSON.parse(requests[2].user).repairInstructions);
  const frozen=(await h.adapter.queryOne("SELECT payload_json FROM frozen_turn_material_roots WHERE branch_id='c-main'")).payload_json;
  await assert.rejects(()=>new Session(deps,provider,{...profile,model:'changed-model'}).playTurn(action),/model mismatch/);
  assert.equal(requests.length,3);
  const recovered=new Session(deps,provider,profile);
  let result;try{result=await recovered.playTurn(action)}catch(error){require('node:fs').writeFileSync('.tmp/phase8-reacceptance-20261005/recovery-wire-diff.json',JSON.stringify(requests,null,2));throw error}assert.equal(result.stateVersion,1);assert.equal(requests.length,3);
  assert.equal((await h.adapter.queryOne("SELECT payload_json FROM frozen_turn_material_roots WHERE branch_id='c-main'")).payload_json,frozen);
  assert.equal((await recovered.playTurn({...action,turnIdOverride:result.turnId})).stateVersion,1);assert.equal(requests.length,3);
  assert.equal((await h.adapter.queryOne("SELECT COUNT(*) n FROM frozen_turn_postprocess_outbox WHERE branch_id='c-main'")).n,1);
 }finally{h.db.close()}
});

test('foreground four-request physical budget is shared by Planner and Narrator and survives reconstruction',async()=>{
 const h=await ruleCampaign();try{
  const {LedgeredProvider}=require('../dist/application/llm/requestLedger');let sent=0;
  const provider=()=>new LedgeredProvider({complete:async()=>{sent++;return {text:'paid'}}},h.runtime.llmLedger,{modelProfileFingerprint:'model'});
  const request=(kind,i)=>({role:kind==='planner'?'Planner':'Narrator',system:'s',user:String(i),maxOutputTokens:20,ledger:{logicalRequestId:kind+':c-main:turn-budget',requestKind:kind,physicalAttemptLimit:3}});
  for(let i=1;i<=2;i++)await provider().complete(request('planner',i));
  for(let i=1;i<=2;i++)await provider().complete(request('narrator',i));
  await assert.rejects(()=>provider().complete(request('narrator',3)),/turn_physical_budget_exhausted/);assert.equal(sent,4);
 }finally{h.db.close()}
});
