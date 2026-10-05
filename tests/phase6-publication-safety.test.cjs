'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {BUILTIN_MIGRATIONS}=require('../dist/infra/sqlite/builtinMigrations');
const {SqliteWorldStore}=require('../dist/infra/sqlite/sqliteWorldStore');
const {SqliteSourceStore}=require('../dist/infra/sqlite/sqliteSourceStore');
const {SqliteSegmentArtifactStore}=require('../dist/infra/sqlite/sqliteSegmentArtifactStore');
const {SourceCatalogAdapter}=require('../dist/application/sourceIndex/sourceCatalog');
const {SegmentPublicationService,validateSegmentArtifactContent,buildSegmentCitations}=require('../dist/application/segmentPublication');
const {compileProgressiveOpeningPackage}=require('../dist/application/worldPackage/progressiveOpening');
const {createCampaign}=require('../dist/application/campaign/createCampaign');
const {publishUserRequestedSourceLookupDelta}=require('../dist/application/worldPackage/progressiveDelta');
const sha={sha256Hex:value=>createHash('sha256').update(value,'utf8').digest('hex')};
const now='2026-10-02T00:00:00.000Z';
class Db {
  constructor(){this.raw=new DatabaseSync(':memory:');this.chain=Promise.resolve();this.inTransaction=false;this.failSnapshot=false;}
  async execute(sql,params=[]){if(this.failSnapshot&&sql.startsWith('UPDATE snapshots'))throw new Error('injected_snapshot_failure');
    return this.raw.prepare(sql).run(...params).changes;}
  async queryOne(sql,params=[]){return this.raw.prepare(sql).get(...params)??null;}
  async queryAll(sql,params=[]){return this.raw.prepare(sql).all(...params);}
  transaction(work){const run=async()=>{const before=this.beforeTransaction;this.beforeTransaction=null;if(before)await before();
    this.raw.exec('BEGIN IMMEDIATE');this.inTransaction=true;
    try{const value=await work(this);this.raw.exec('COMMIT');return value;}
    catch(error){this.raw.exec('ROLLBACK');throw error;}finally{this.inTransaction=false;}};
    const next=this.chain.then(run,run);this.chain=next.catch(()=>{});return next;}
}
function lore(id,factIds=[]){return {entryId:id,kind:'lore',revision:1,provenance:{kind:factIds.length?'explicit':'design_fill',
  sourceFactIds:factIds,rationale:'已验证的测试证据'},fieldProvenance:{},visibility:'discoverable',dependencyIds:[],definition:{name:id,text:'证据'}};}
async function fixture(){
  const db=new Db();for(const migration of BUILTIN_MIGRATIONS)db.raw.exec(migration.sql);
  db.raw.exec('PRAGMA foreign_keys = ON; CREATE TABLE publication_authority (fence INTEGER, generation INTEGER, expires_at TEXT, canceled INTEGER); CREATE TABLE guard_effect (value TEXT);');
  await db.execute('INSERT INTO publication_authority VALUES (7,1,?,0)',['2099-01-01T00:00:00.000Z']);
  const worldStore=new SqliteWorldStore(db),sourceStore=new SqliteSourceStore(db);
  const text='巷口的灯还亮着。远处传来脚步声。她循声望去。甲在城门，灯火照亮来人。\n后来，白衣客把密信藏在北桥石狮下。';
  const cp=Array.from(text),openingEnd=cp.indexOf('\n'),sourceHash=sha.sha256Hex(text),worldId='world-publication-safety',sourceId='source-publication-safety';
  await worldStore.createWorld({worldId,title:'事务安全测试',sourceSha256:sourceHash,sourceBytes:Buffer.byteLength(text),normalizeVersion:'n1',
    chapterSplitVersion:'c1',buildStatus:'ready',createdAt:now,updatedAt:now});
  const chapter={worldId,chapterId:'opening',index:0,title:'开篇',startOffset:0,endOffset:cp.length,charCount:cp.length,contentHash:sourceHash};
  await worldStore.saveImportedSource(worldId,{encoding:'utf-8',sourceSha256Hex:sourceHash,sourceByteLength:Buffer.byteLength(text),normalizeVersion:'n1',
    chapterSplitVersion:'c1',splitStrategy:'standard',text:'',codePointCount:cp.length,chapters:[chapter],chunks:[]},now);
  const manifest={sourceId,rawSha256Hex:sourceHash,normalizedTreeHash:sourceHash,normalizeTreeHashVersion:'n1',byteLength:Buffer.byteLength(text),
    codePointCount:cp.length,encoding:'utf-8',normalizeVersion:'n1',chapterSplitVersion:'c1',normalizeShardScheme:'test',splitStrategy:'standard',
    fileName:'fixture.txt',title:'fixture',status:'staging',createdAt:now,updatedAt:now};
  await sourceStore.beginStaging(manifest);await sourceStore.saveShard({sourceId,shardIndex:0,startCp:0,endCp:cp.length,text});
  await sourceStore.activateSource({manifest:{...manifest,status:'active'},chapters:[chapter],chunks:[{chunkId:'chunk-proof',chapterId:'opening',chunkIndex:0,
    startOffset:0,endOffset:cp.length,charCount:cp.length,contentHash:sourceHash}]});
  await db.execute('INSERT INTO world_sources(world_id,source_ordinal,source_id,raw_sha256,created_at) VALUES (?,1,?,?,?)',[worldId,sourceId,sourceHash,now]);
  const published=await compileProgressiveOpeningPackage({worldStore,sha256Hex:sha.sha256Hex,worldId,sourceSha256:sourceHash,
    sourceExcerpt:cp.slice(0,openingEnd).join(''),sourceEndCodePoint:openingEnd,chapters:[chapter],
    dossier:{locationName:'青石巷',locationQuote:'巷口的灯还亮着。',setting:'巷口的灯还亮着。',settingQuote:'巷口的灯还亮着。',
      situation:'远处传来脚步声。',situationQuote:'远处传来脚步声。',initialGoal:'确认脚步声的来源。',goalQuote:'她循声望去。',unknowns:['来人身份未知']},
    requestMetrics:[{attempt:1,durationMs:20,httpStatus:200,outcome:'completed'}],usage:{inputTokens:20,outputTokens:20,reasoningTokens:0,estimated:false},
    extractionMs:20,createdAt:now});
  const campaign=await createCampaign({db,worldStore,campaignId:'campaign-safety',title:'事务安全测试',worldId,packageRevision:published.manifest.revision,
    anchor:{worldTimeOrder:1,locationId:'opening-location'},protagonist:{actorId:'player',kind:'original',name:'旅人',
      attributes:{physique:1,agility:1,insight:1,knowledge:1,willpower:1,social:1},initialSkills:['skill-observation']},goal:'确认脚步声来源',createdAt:now});
  const catalog=new SourceCatalogAdapter(sourceStore,worldStore,sha),store=new SqliteSegmentArtifactStore(db,sha.sha256Hex);
  const service=new SegmentPublicationService({store,worldStore,sourceCatalog:catalog,sha256Hex:sha.sha256Hex,now:()=>now});
  const base=await worldStore.getWorldPackage(worldId,published.manifest.revision),binding=(await catalog.snapshot(worldId)).binding;
  const draft=async patch=>({worldId,segmentId:'segment-proof',generation:1,sourceBinding:binding,coverage:[await catalog.createRange(sourceId,0,openingEnd)],
    canonSnapshotHash:sha.sha256Hex('frozen-canon'),basePackage:{revision:base.manifest.revision,contentHash:base.manifest.contentHash},
    ruleset:base.manifest.ruleset,mappingVersion:base.manifest.mappingVersion,entries:base.entries,sections:base.sections,createdAt:now,...patch});
  const leaseGuard=async tx=>{assert.equal(tx,db);assert.equal(db.inTransaction,true);
    const authority=await tx.queryOne('SELECT * FROM publication_authority');
    if(authority.fence!==7||authority.generation!==1||authority.canceled||authority.expires_at<=now)throw new Error('stale_publication_authority');
    await tx.execute("INSERT INTO guard_effect VALUES ('checked')");};
  const lookup=async options=>publishUserRequestedSourceLookupDelta({db,worldStore,sourceStore,sha256Hex:sha.sha256Hex,worldId,branchId:campaign.branchId,
    stateVersion:0,baseRevision:base.manifest.revision,sourceSha256:sourceHash,book:'player_handbook',
    passages:[{chapterId:'opening',chapterTitle:'开篇',startCodePoint:openingEnd+1,endCodePoint:cp.length,text:cp.slice(openingEnd+1).join('')}],
    existingEntryIds:new Set(base.entries.map(entry=>entry.entryId)),createdAt:now,...options});
  const adopt=async()=>{const artifact=await service.publishArtifact(await draft());const frozen=await service.freezeBinding(campaign.campaignId,campaign.branchId);
    return service.adoptAtSafeBoundary({campaignId:campaign.campaignId,branchId:campaign.branchId,expectedStateVersion:0,
      expectedManifestHash:frozen.manifestHash,artifactIds:[artifact.artifactId]});};
  return {db,worldId,sourceId,worldStore,sourceStore,catalog,store,service,base,campaign,draft,leaseGuard,lookup,adopt};
}
test('publication guard executes in the write transaction and fences replaced leases, generations, cancellation and expiry',async()=>{
  for(const update of ['fence = 8','generation = 2','canceled = 1',"expires_at = '2026-10-01T00:00:00.000Z'"]){
    const h=await fixture();try{await h.db.execute(`UPDATE publication_authority SET ${update}`);
      await assert.rejects(h.service.publishArtifact(await h.draft({assertCurrent:h.leaseGuard})),/stale_publication_authority/);
      assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
      assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM segment_publication_diagnostics')).n,1);
    }finally{h.db.raw.close();}}
});
test('publication guard side effects roll back with failure and stale retries cannot bypass the guard through deduplication',async()=>{
  const h=await fixture();try{
    await assert.rejects(h.service.publishArtifact(await h.draft({assertCurrent:async tx=>{await h.leaseGuard(tx);throw new Error('after_fence_fault');}})),/after_fence_fault/);
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM guard_effect')).n,0);
    const artifact=await h.service.publishArtifact(await h.draft({assertCurrent:h.leaseGuard}));
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM guard_effect')).n,1);
    await h.db.execute('UPDATE publication_authority SET fence = 8');
    await assert.rejects(h.service.publishArtifact(await h.draft({assertCurrent:h.leaseGuard})),/stale_publication_authority/);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,1);assert.equal((await h.store.getArtifact(artifact.artifactId)).artifactId,artifact.artifactId);
  }finally{h.db.raw.close();}
});
test('publication rechecks canon evidence and blocking reviews inside its transaction after parallel validation changes',async()=>{
  for(const change of ['conflict','value','review']){const h=await fixture();try{
    const fact=(await h.worldStore.listFacts(h.worldId)).find(f=>f.status==='explicit'&&f.sources.length);
    const draft=await h.draft({entries:[lore('cited-proof',[fact.factId])],sections:[]});
    h.db.beforeTransaction=async()=>{
      if(change==='conflict')await h.db.execute("UPDATE canon_facts SET status = 'conflict' WHERE world_id = ? AND fact_id = ?",[h.worldId,fact.factId]);
      else if(change==='value')await h.db.execute('UPDATE canon_facts SET value_json = ? WHERE world_id = ? AND fact_id = ?',['{"text":"changed after validation"}',h.worldId,fact.factId]);
      else await h.db.execute(`INSERT INTO review_issues (world_id,issue_id,kind,severity,detail_json,status,created_at)
        VALUES (?,'late-blocker','late_review','blocking','{}','open',?)`,[h.worldId,now]);
    };
    await assert.rejects(h.service.publishArtifact(draft),change==='conflict'?/canon_conflict_in_scope/:change==='value'?/canon_evidence_changed/:/blocking_review:late-blocker/);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,0);
  }finally{h.db.raw.close();}}
});
test('legacy lookup rebases the adopted artifact overlay atomically without editing actor state or admitting future facts',async()=>{
  const h=await fixture();try{const adopted=await h.adopt();assert.equal(adopted.status,'adopted');
    const before=JSON.parse((await h.db.queryOne('SELECT snapshot_json FROM snapshots WHERE branch_id = ?',[h.campaign.branchId])).snapshot_json);
    const published=await h.lookup({rebaseLegacyOverlay:(tx,input)=>h.service.rebaseLegacyOverlay(tx,input)});
    assert.equal(published.status,'published');const rebased=published.publication.segmentContentBinding;
    assert.deepEqual(rebased.artifactIds,adopted.binding.artifactIds);assert.notEqual(rebased.manifestHash,adopted.binding.manifestHash);
    assert.notEqual(rebased.artifactManifestHash,adopted.binding.artifactManifestHash);
    const after=JSON.parse((await h.db.queryOne('SELECT snapshot_json FROM snapshots WHERE branch_id = ?',[h.campaign.branchId])).snapshot_json);
    assert.deepEqual(after.actors,before.actors);assert.equal(after.clockMinutes,before.clockMinutes);assert.deepEqual(after.segmentContentBinding,rebased);
    const catalog=await h.service.loadEffectiveCatalog({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId});
    const quote=catalog.entries.find(entry=>published.entryIds.includes(entry.entryId));
    assert.equal(quote.visibility,'discoverable');assert.equal(quote.revealPolicyId,'source-lookup-confirmation');
    assert.equal(quote.provenance.sourceFactIds.length,0);assert.equal((await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId)).artifactManifestHash,rebased.artifactManifestHash);
    await assert.rejects(h.service.loadEffectiveCatalog({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId,
      binding:{...rebased,deltaIds:[]}}),/legacy_binding_changed/);
    await assert.rejects(h.service.loadEffectiveCatalog({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId,
      binding:{...rebased,deltaIds:[...rebased.deltaIds,...rebased.deltaIds]}}),/invalid_artifact_binding/);
  }finally{h.db.raw.close();}
});
test('missing legacy bridge, active interaction, staged turn and snapshot write faults roll back both delta and overlay publication',async()=>{
  for(const failure of ['missing_bridge','interaction','staged_turn','snapshot_fault']){const h=await fixture();try{await h.adopt();
    const before=await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId);
    if(failure==='interaction')await h.db.execute(`INSERT INTO interaction_operations (operation_id,campaign_id,branch_id,operation_kind,status,
      expected_state_version,fence_token,next_step,max_steps,created_at,updated_at)
      VALUES ('op',?,?,'encounter_auto','running',0,1,0,1,?,?)`,[h.campaign.campaignId,h.campaign.branchId,now,now]);
    if(failure==='staged_turn')await h.db.execute(`INSERT INTO turns (branch_id,turn_id,status,expected_state_version,action_contract_json,action_contract_hash,created_at)
      VALUES (?,'turn-pending','Resolved',0,'{}',?,?)`,[h.campaign.branchId,sha.sha256Hex('{}'),now]);
    if(failure==='snapshot_fault')h.db.failSnapshot=true;
    await assert.rejects(h.lookup(failure==='missing_bridge'?{}:{rebaseLegacyOverlay:(tx,input)=>h.service.rebaseLegacyOverlay(tx,input)}),
      failure==='missing_bridge'?/atomic legacy overlay rebase/:['interaction','staged_turn'].includes(failure)?/interaction_running/:/injected_snapshot_failure/);
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM progressive_world_deltas')).n,0);
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM branch_content_manifests')).n,1);
    assert.equal((await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId)).artifactManifestHash,before.artifactManifestHash);
  }finally{h.db.raw.close();}}
});
test('world-ready artifact stays pending during a frozen ordinary turn',async()=>{
  const h=await fixture();try{const artifact=await h.service.publishArtifact(await h.draft());
    const frozen=await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId);
    await h.db.execute(`INSERT INTO turns (branch_id,turn_id,status,expected_state_version,action_contract_json,action_contract_hash,created_at)
      VALUES (?,'turn-frozen','AwaitRoll',0,'{}',?,?)`,[h.campaign.branchId,sha.sha256Hex('{}'),now]);
    const receipt=await h.service.adoptAtSafeBoundary({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId,expectedStateVersion:0,
      expectedManifestHash:frozen.manifestHash,artifactIds:[artifact.artifactId]});
    assert.equal(receipt.status,'pending');assert.equal(receipt.reason,'interaction_running');assert.deepEqual(receipt.binding.artifactIds,[]);
    assert.equal((await h.store.listArtifacts(h.worldId)).length,1);
  }finally{h.db.raw.close();}
});
test('missing ordinary-turn journal fails closed instead of allowing adoption',async()=>{
  const h=await fixture();try{const artifact=await h.service.publishArtifact(await h.draft());
    const frozen=await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId);
    await h.db.execute('DROP TABLE turns');
    await assert.rejects(h.service.adoptAtSafeBoundary({campaignId:h.campaign.campaignId,branchId:h.campaign.branchId,expectedStateVersion:0,
      expectedManifestHash:frozen.manifestHash,artifactIds:[artifact.artifactId]}),/no such table: turns/);
    assert.deepEqual((await h.service.freezeBinding(h.campaign.campaignId,h.campaign.branchId)).artifactIds,[]);
  }finally{h.db.raw.close();}
});
async function playableEvidence(h){
  const quote='甲在城门，灯火照亮来人。',prefix='巷口的灯还亮着。远处传来脚步声。她循声望去。';
  const range=await h.catalog.createRange(h.sourceId,prefix.length,prefix.length+quote.length);
  const sourceText=await h.catalog.readRange(range);
  const entities=[{worldId:h.worldId,entityId:'character-a',type:'character',name:'甲',aliases:[],firstSeenChapterId:'opening'},
    {worldId:h.worldId,entityId:'location-a',type:'location',name:'城门',aliases:[],firstSeenChapterId:'opening'}];
  const facts=Array.from({length:20},(_,i)=>({worldId:h.worldId,factId:`fact-${i}`,subjectEntityId:i===19?'location-a':'character-a',predicate:i===0?'current_location':`detail-${i}`,
    value:i===0?{locationId:'location-a'}:{text:`核验事实 ${i}`},status:'explicit',confidence:1,validFrom:null,validTo:null,revealAt:null,scope:'world',
    sources:[{chapterId:'opening',startOffset:range.startCp,endOffset:range.endCp,quote:sourceText,quoteSha256:range.rangeContentHash}]}));
  const entries=facts.map(f=>lore(`lore-${f.factId}`,[f.factId]));
  entries.push({...lore('npc-a',['fact-0']),kind:'actor_template',provenance:{kind:'rule_mapping',sourceFactIds:['fact-0'],rationale:'有事实依据的规则映射'},
    definition:{name:'甲',category:'human',description:'守门人',hp:10,defense:2,stamina:5,attributes:{},skills:{},attacks:[],abilities:[],behavior:{goal:'守门',morale:'steady',retreatThreshold:0.2},lootPolicy:'none'}});
  entries.push({...lore('scene-a',['fact-19']),kind:'scene',visibility:'public',dependencyIds:['npc-a'],definition:{name:'城门',locationId:'location-a',
    zones:[{zoneId:'gate',name:'城门',cover:false,exits:[]}],actors:['npc-a'],visibleItems:[],hazards:[],clues:[]}});
  const events=[{worldId:h.worldId,eventId:'event-a',title:'有人到来',summary:'来人现身',worldTimeOrder:0,narrativeChapterId:'opening',validFrom:null,
    validTo:null,status:'canon',dependsOnEventIds:[]}];
  const artifact={...await h.draft({entries,sections:[],coverage:[range]}),schemaVersion:'shineword-segment-artifact-1',validationVersion:'segment-validation-1',
    artifactId:'artifact-playable',contentHash:sha.sha256Hex('test-playable'),dependencies:[],citations:await buildSegmentCitations({worldId:h.worldId,entries,facts,
      catalog:h.catalog,sourceBinding:(await h.catalog.snapshot(h.worldId)).binding}),validation:{warnings:[]}};
  const openingRequirements={requiredEntityIds:entities.map(e=>e.entityId),requiredFactIds:facts.map(f=>f.factId),requiredEventIds:['event-a'],
    requiredEntryIds:['scene-a'],ranges:[range]};
  return {artifact,dependencyEntries:[],facts,entities,events,blockingReviews:[],openingRequirements};
}
test('opening accepts unique canonical location names or IDs and rejects unsupported entities, events and generic actors',async()=>{
  const h=await fixture();try{const input=await playableEvidence(h);
    assert.deepEqual(validateSegmentArtifactContent(input).errors,[]);
    const named=structuredClone(input);named.artifact.entries.find(e=>e.kind==='scene').definition.locationId='城门';
    assert.deepEqual(validateSegmentArtifactContent(named).errors,[]);
    const unproven=structuredClone(input);unproven.entities.push({...input.entities[0],entityId:'future-person'});unproven.openingRequirements.requiredEntityIds.push('future-person');
    assert.ok(validateSegmentArtifactContent(unproven).errors.includes('opening_entity_unproven:future-person'));
    const futureEvent=structuredClone(input);futureEvent.events[0].narrativeChapterId='later';
    assert.ok(validateSegmentArtifactContent(futureEvent).errors.includes('opening_event_missing:event-a'));
    const dependent=structuredClone(input);dependent.events[0].dependsOnEventIds=['future-event'];
    assert.ok(validateSegmentArtifactContent(dependent).errors.includes('opening_event_dependency_missing:event-a:future-event'));
    const generic=structuredClone(input),actor=generic.artifact.entries.find(e=>e.kind==='actor_template');
    actor.provenance={kind:'design_fill',sourceFactIds:[],rationale:'通用守卫'};
    generic.artifact.citations.find(c=>c.entryId===actor.entryId).sourceFactIds=[];
    assert.ok(validateSegmentArtifactContent(generic).errors.includes('opening_interaction_missing'));
    const ambiguous=structuredClone(named);ambiguous.entities.push({...input.entities[1],entityId:'other-gate'});
    assert.ok(validateSegmentArtifactContent(ambiguous).errors.includes('opening_location_unproven'));
  }finally{h.db.raw.close();}
});
