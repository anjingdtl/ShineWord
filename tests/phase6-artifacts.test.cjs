'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {SqliteSegmentArtifactStore,phase6ArtifactSchema}=require('../dist/infra/sqlite/sqliteSegmentArtifactStore');
const {SegmentPublicationService,verifySegmentArtifact,parseSegmentArtifact,serializeSegmentArtifact,
  resolveLegacyEvidenceRange,resolveLegacyPackageRanges,splitLegacyPublicationRanges,rebindSegmentContentBinding,
  validateSegmentArtifactContent,buildSegmentCitations}=require('../dist/application/segmentPublication');
const {createBaseContentManifest}=require('../dist/application/worldPackage/contentManifest');
const hash=async text=>crypto.createHash('sha256').update(text).digest('hex');
const now='2026-10-02T00:00:00.000Z';
class Db {
  constructor(){this.raw=new DatabaseSync(':memory:');this.chain=Promise.resolve();this.failUpdate=false;}
  async execute(sql,params=[]){if(this.failUpdate&&sql.startsWith('UPDATE snapshots'))throw new Error('injected_write_failure');
    if(!params.length&&sql.includes(';')){this.raw.exec(sql);return 0;}return this.raw.prepare(sql).run(...params).changes;}
  async queryOne(sql,params=[]){return this.raw.prepare(sql).get(...params)??null;}
  async queryAll(sql,params=[]){return this.raw.prepare(sql).all(...params);}
  transaction(work){const run=async()=>{this.raw.exec('BEGIN IMMEDIATE');try{const value=await work(this);this.raw.exec('COMMIT');return value;}
    catch(error){this.raw.exec('ROLLBACK');throw error;}};const next=this.chain.then(run,run);this.chain=next.catch(()=>{});return next;}
}
function lore(id,factIds=[],revision=1){return {entryId:id,kind:'lore',revision,provenance:{kind:factIds.length?'explicit':'design_fill',sourceFactIds:factIds,
  rationale:factIds.length?'原文事实':'规则说明',...(factIds.length?{}:{policyId:'local-rule'})},fieldProvenance:{},visibility:'discoverable',
  dependencyIds:[],definition:{name:id,text:'场景证据'}};}
async function harness(){
  const db=new Db();await db.execute(`PRAGMA foreign_keys = ON;
  CREATE TABLE worlds(world_id TEXT PRIMARY KEY);
  CREATE TABLE imported_sources(source_id TEXT PRIMARY KEY,normalized_tree_hash TEXT,status TEXT);
  CREATE TABLE world_sources(world_id TEXT,source_id TEXT,source_ordinal INTEGER);
  CREATE TABLE campaigns(campaign_id TEXT PRIMARY KEY,world_id TEXT,package_revision INTEGER,ruleset_id TEXT,ruleset_version TEXT,world_mapping_version TEXT);
  CREATE TABLE branches(branch_id TEXT PRIMARY KEY,campaign_id TEXT,state_version INTEGER);
  CREATE TABLE snapshots(branch_id TEXT,state_version INTEGER,snapshot_json TEXT,PRIMARY KEY(branch_id,state_version));
  CREATE TABLE branch_content_manifests(branch_id TEXT,state_version INTEGER,content_version INTEGER,manifest_hash TEXT,manifest_json TEXT,created_at TEXT);
  CREATE TABLE interaction_operations(operation_id TEXT,branch_id TEXT,status TEXT);`);
  await db.execute('CREATE TABLE turns(branch_id TEXT,status TEXT)');
  await db.execute(phase6ArtifactSchema);await db.execute("INSERT INTO worlds VALUES ('w')");
  const baseHash=await hash('base'),treeHash=await hash('normalized');const base={manifest:{worldId:'w',revision:1,schemaVersion:'world-package-3',
    sourceSha256:await hash('raw'),ruleset:{id:'r',version:'1'},mappingVersion:'mapping-1',contentHash:baseHash,status:'published'},
    entries:[lore('base-rule')],sections:[{book:'player_handbook',sectionKey:'base',title:'基础',entryIds:['base-rule'],position:0}]};
  await db.execute("INSERT INTO campaigns VALUES ('c','w',1,'r','1','mapping-1')");
  for(const branchId of ['b1','b2']){await db.execute('INSERT INTO branches VALUES (?, ?, 0)',[branchId,'c']);
    const manifest=createBaseContentManifest({worldId:'w',branchId,stateVersion:0,basePackage:{revision:1,contentHash:baseHash}});
    const snapshot={branchId,stateVersion:0,actors:{pc:{resources:{hp:10}}},clockMinutes:0,contentManifest:manifest};
    await db.execute('INSERT INTO snapshots VALUES (?,0,?)',[branchId,JSON.stringify(snapshot)]);
    await db.execute('INSERT INTO branch_content_manifests VALUES (?,0,0,?,?,?)',[branchId,baseHash,JSON.stringify(manifest),now]);}
  const text='甲乙丙丁'.repeat(10_000);const texts=new Map([['source-1',text],['source-2',text],['source-3',text]]);
  const members=[1,2,3].map(n=>({sourceId:`source-${n}`,sourceOrdinal:n,normalizedTreeHash:treeHash,rawSha256Hex:'abcdef'.charAt(n-1).repeat(64),
    codePointCount:40_000,chapters:[{chapterId:n===1?'chapter-1':`s${n}-chapter-1`,startCp:0,endCp:40_000,title:`第${n}部`}]}));
  let activeMembers=members.slice(0,1);
  const binding=()=>({sourceSetHash:treeHash,members:activeMembers.map(({sourceId,sourceOrdinal,normalizedTreeHash})=>({sourceId,sourceOrdinal,normalizedTreeHash}))});
  for(const m of members){await db.execute('INSERT INTO imported_sources VALUES (?,?,?)',[m.sourceId,m.normalizedTreeHash,'active']);
    await db.execute('INSERT INTO world_sources VALUES (?,?,?)',['w',m.sourceId,m.sourceOrdinal]);}
  const catalog={async snapshot(){return {binding:binding(),members:activeMembers};},async createRange(sourceId,startCp,endCp){
    const m=activeMembers.find(m=>m.sourceId===sourceId);if(!m||startCp<0||endCp>m.codePointCount||endCp<=startCp)throw new Error('invalid_source_range');
    return {sourceId,normalizedTreeHash:m.normalizedTreeHash,startCp,endCp,rangeContentHash:await hash(texts.get(sourceId).slice(startCp,endCp))};},
    async readRange(r){const m=activeMembers.find(m=>m.sourceId===r.sourceId);const text=texts.get(r.sourceId)?.slice(r.startCp,r.endCp);
      if(!m||m.normalizedTreeHash!==r.normalizedTreeHash||await hash(text)!==r.rangeContentHash)throw new Error('source_changed');return text;},
    async isBindingCompatible(_,b){return b.members.every(old=>activeMembers.some(m=>m.sourceId===old.sourceId&&m.normalizedTreeHash===old.normalizedTreeHash&&m.sourceOrdinal===old.sourceOrdinal));}};
  const fact={worldId:'w',factId:'f1',subjectEntityId:'character-1',predicate:'identity',value:{text:'人物'},status:'explicit',confidence:1,
    validFrom:null,validTo:null,revealAt:null,scope:'world',sources:[{chapterId:'chapter-1',startOffset:0,endOffset:10,quote:text.slice(0,10),quoteSha256:await hash(text.slice(0,10))}]};
  let facts=[fact];let reviews=[];
  const worldStore={async getWorldPackage(w,r){return w==='w'&&r===1?base:null;},async getProgressiveDeltaPackage(){return null;},
    async listFacts(){return facts;},async listEntities(){return [];},async listEvents(){return [];},async listReviewIssues(){return reviews;}};
  const store=new SqliteSegmentArtifactStore(db,hash);const service=new SegmentPublicationService({store,worldStore,sourceCatalog:catalog,sha256Hex:hash,now:()=>now});
  const draft=async(patch={})=>({worldId:'w',segmentId:'seg-1',generation:1,sourceBinding:binding(),coverage:[await catalog.createRange('source-1',0,100)],
    canonSnapshotHash:await hash('canon'),basePackage:{revision:1,contentHash:baseHash},ruleset:{id:'r',version:'1'},mappingVersion:'mapping-1',
    entries:[lore('entry-1',['f1'])],sections:[{book:'gm_guide',sectionKey:'proof',title:'证据',entryIds:['entry-1'],position:1}],createdAt:now,...patch});
  return {db,catalog,store,service,draft,members,base,fact,append(){activeMembers=members;},setFacts(v){facts=v;},setReviews(v){reviews=v;}};
}

test('immutable content addressing, strict bounds and source/hash tamper rejection',async()=>{
  const h=await harness();try{const input=await h.draft();const a=await h.service.publishArtifact(input);
    assert.equal(await verifySegmentArtifact(a,hash),true);assert.equal(a.citations[0].ranges[0].sourceId,'source-1');
    assert.equal((await h.service.publishArtifact({...input,createdAt:'2026-10-03T00:00:00Z'})).artifactId,a.artifactId);
    assert.equal((await h.store.listPublishedArtifacts('w')).length,1);
    await assert.rejects(parseSegmentArtifact(serializeSegmentArtifact({...a,entries:[{...a.entries[0],visibility:'public'}]}),hash),/invalid_artifact/);
    await assert.rejects(h.service.publishArtifact(await h.draft({coverage:[await h.catalog.createRange('source-1',0,12_001)]})),/invalid_artifact_structure/);
    const old=[{startCodePoint:0,endCodePoint:100,contentSha256:'a'.repeat(64)}];
    await assert.rejects(h.service.publishArtifact(await h.draft({coverage:old})),/source_changed/);
    const diagnostics=await h.db.queryAll('SELECT error_codes_json FROM segment_publication_diagnostics');assert.equal(diagnostics.length>=2,true);
  }finally{h.db.raw.close();}
});

test('world ready remains independent from each branch adoption, state/manifest/interaction fences',async()=>{
  const h=await harness();try{const a=await h.service.publishArtifact(await h.draft());const b1=await h.service.freezeBinding('c','b1');
    assert.deepEqual(b1.artifactIds,[]);assert.deepEqual((await h.service.freezeBinding('c','b2')).artifactIds,[]);
    const adopt=(branchId,patch={})=>h.service.adoptAtSafeBoundary({campaignId:'c',branchId,expectedStateVersion:0,expectedManifestHash:b1.manifestHash,artifactIds:[a.artifactId],...patch});
    assert.equal((await adopt('b1',{expectedStateVersion:1})).reason,'state_changed');
    assert.equal((await adopt('b1',{expectedManifestHash:'0'.repeat(64)})).reason,'manifest_changed');
    await h.db.execute("INSERT INTO interaction_operations VALUES ('op','b1','running')");
    assert.equal((await adopt('b1')).status,'pending');assert.equal((await h.service.freezeBinding('c','b1')).artifactIds.length,0);
    await h.db.execute("DELETE FROM interaction_operations");const receipt=await adopt('b1');assert.equal(receipt.status,'adopted');
    assert.equal(receipt.binding.manifestHash,b1.manifestHash);assert.equal(receipt.binding.artifactIds.length,1);assert.ok(receipt.binding.artifactManifestHash);
    assert.equal((await adopt('b1')).reason,'manifest_changed');
    assert.equal((await adopt('b1',{expectedManifestHash:receipt.binding.artifactManifestHash})).reason,'already_adopted');
    assert.equal((await h.service.freezeBinding('c','b2')).artifactIds.length,0);assert.equal((await adopt('b2')).status,'adopted');
    const snap=JSON.parse((await h.db.queryOne("SELECT snapshot_json FROM snapshots WHERE branch_id = 'b1'")).snapshot_json);
    assert.deepEqual(snap.actors,{pc:{resources:{hp:10}}});assert.equal(snap.clockMinutes,0);
    const catalog=await h.service.loadEffectiveCatalog({campaignId:'c',branchId:'b1'});assert.equal(catalog.entries.length,2);
  }finally{h.db.raw.close();}
});

test('publication/adoption rollback, branch deletion and late results never resurrect projects',async()=>{
  const h=await harness();try{const a=await h.service.publishArtifact(await h.draft());const initial=await h.service.freezeBinding('c','b1');h.db.failUpdate=true;
    await assert.rejects(h.service.adoptAtSafeBoundary({campaignId:'c',branchId:'b1',expectedStateVersion:0,expectedManifestHash:initial.manifestHash,artifactIds:[a.artifactId]}),/injected/);
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM branch_segment_artifact_manifests')).n,0);h.db.failUpdate=false;
    assert.equal((await h.service.freezeBinding('c','b1')).artifactIds.length,0);
    await h.db.execute("DELETE FROM worlds WHERE world_id = 'w'");
    await assert.rejects(h.service.publishArtifact(await h.draft({segmentId:'late'})),/FOREIGN KEY/);
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM world_segment_artifacts')).n,0);
    assert.equal((await h.db.queryOne('SELECT COUNT(*) n FROM worlds')).n,0);
  }finally{h.db.raw.close();}
});

test('explicit multi-source mirror coordinates, append compatibility and ambiguous legacy identity rejection',async()=>{
  const h=await harness();try{const old=await h.service.publishArtifact(await h.draft());h.append();
    const r2=await resolveLegacyEvidenceRange(h.catalog,h.members,{chapterId:'s2-chapter-1',startCodePoint:0,endCodePoint:10,contentSha256:h.fact.sources[0].quoteSha256});
    const r3=await resolveLegacyEvidenceRange(h.catalog,h.members,{chapterId:'s3-chapter-1',startCodePoint:0,endCodePoint:10,contentSha256:h.fact.sources[0].quoteSha256});
    assert.equal(r2.sourceId,'source-2');assert.equal(r3.sourceId,'source-3');assert.equal(r2.startCp,0);
    await assert.rejects(resolveLegacyEvidenceRange(h.catalog,h.members,{chapterId:'s2-s2-chapter-1',startCodePoint:0,endCodePoint:10,contentSha256:h.fact.sources[0].quoteSha256}),/ambiguous/);
    const ranges=await resolveLegacyPackageRanges(h.catalog,'w',h.members[1].rawSha256Hex,[{startCodePoint:0,endCodePoint:10,contentSha256:r2.rangeContentHash}]);assert.equal(ranges[0].sourceId,'source-2');
    await assert.rejects(resolveLegacyPackageRanges(h.catalog,'w','0'.repeat(64),[{startCodePoint:0,endCodePoint:10,contentSha256:r2.rangeContentHash}]),/ambiguous/);
    h.setFacts([h.fact,{...h.fact,factId:'f2',sources:[{...h.fact.sources[0],chapterId:'s2-chapter-1'}]}]);
    const a=await h.service.publishArtifact(await h.draft({segmentId:'multi',entries:[lore('multi-entry',['f1','f2'])],sections:[],coverage:[await h.catalog.createRange('source-1',0,100),await h.catalog.createRange('source-2',0,100)]}));
    assert.deepEqual(a.citations[0].ranges.map(r=>r.sourceId),['source-1','source-2']);
    const b=await h.service.freezeBinding('c','b1');assert.equal((await h.service.adoptAtSafeBoundary({campaignId:'c',branchId:'b1',expectedStateVersion:0,expectedManifestHash:b.manifestHash,artifactIds:[old.artifactId]})).status,'adopted');
    const units=await splitLegacyPublicationRanges(h.catalog,[await h.catalog.createRange('source-1',0,25_000)]);assert.deepEqual(units.map(u=>u.reduce((n,r)=>n+r.endCp-r.startCp,0)),[12_000,12_000,1000]);
    await assert.rejects(splitLegacyPublicationRanges(h.catalog,[r2,r3]),/single_source/);
  }finally{h.db.raw.close();}
});

test('source conflicts, unknown blockers, missing closure and forged provenance remain rejected',async()=>{
  const h=await harness();try{h.setFacts([{...h.fact,status:'inference'}]);await assert.rejects(h.service.publishArtifact(await h.draft()),/inference_disguised_as_explicit/);
    h.setFacts([h.fact,{...h.fact,factId:'conflict',status:'conflict'}]);await assert.rejects(h.service.publishArtifact(await h.draft()),/canon_conflict_in_scope/);
    h.setFacts([h.fact]);h.setReviews([{issueId:'legacy-global',severity:'blocking',detailJson:'{}'}]);await assert.rejects(h.service.publishArtifact(await h.draft()),/blocking_review/);
    h.setReviews([]);const entry=lore('broken',['f1']);entry.dependencyIds=['missing'];await assert.rejects(h.service.publishArtifact(await h.draft({entries:[entry]})),/dangling dependency/);
    const unsafe=lore('unsafe');unsafe.provenance.kind='user_override';await assert.rejects(h.service.publishArtifact(await h.draft({entries:[unsafe]})),/invalid_artifact_structure/);
    assert.equal((await h.store.listPublishedArtifacts('w')).length,0);
  }finally{h.db.raw.close();}
});

test('fork and rewind use snapshot refs; missing source permits reading but rejects new adoption',async()=>{
  const h=await harness();try{const a=await h.service.publishArtifact(await h.draft());const initial=await h.service.freezeBinding('c','b1');
    const adopted=await h.service.adoptAtSafeBoundary({campaignId:'c',branchId:'b1',expectedStateVersion:0,expectedManifestHash:initial.manifestHash,artifactIds:[a.artifactId]});
    const binding=rebindSegmentContentBinding(adopted.binding,'b2',0);
    const row=await h.db.queryOne("SELECT snapshot_json FROM snapshots WHERE branch_id = 'b2'");const snapshot=JSON.parse(row.snapshot_json);
    snapshot.segmentContentBinding=binding;await h.db.execute("UPDATE snapshots SET snapshot_json = ? WHERE branch_id = 'b2'",[JSON.stringify(snapshot)]);
    await h.service.restoreBindingProjection({campaignId:'c',branchId:'b2',binding});assert.equal((await h.service.freezeBinding('c','b2')).artifactIds[0],a.artifactId);
    delete snapshot.segmentContentBinding;await h.db.execute("UPDATE snapshots SET snapshot_json = ? WHERE branch_id = 'b2'",[JSON.stringify(snapshot)]);
    // Existing adoption rows cannot override the exact restored snapshot.
    assert.equal((await h.service.freezeBinding('c','b2')).artifactIds.length,0);
    await h.db.execute("UPDATE imported_sources SET status = 'orphaned'");
    const catalog=await h.service.loadEffectiveCatalog({campaignId:'c',branchId:'b1'});assert.equal(catalog.entries.length,2);
    const b2=await h.service.freezeBinding('c','b2');assert.equal((await h.service.adoptAtSafeBoundary({campaignId:'c',branchId:'b2',expectedStateVersion:0,expectedManifestHash:b2.manifestHash,artifactIds:[a.artifactId]})).reason,'source_changed');
  }finally{h.db.raw.close();}
});

test('bootstrap certification reuses exact base definitions, rejects silent edits and preserves dependency artifacts',async()=>{
  const h=await harness();try{
    const certified=await h.service.publishArtifact(await h.draft({segmentId:'bootstrap',entries:h.base.entries,sections:h.base.sections}));
    const b=await h.service.freezeBinding('c','b1');
    const receipt=await h.service.adoptAtSafeBoundary({campaignId:'c',branchId:'b1',expectedStateVersion:0,expectedManifestHash:b.manifestHash,artifactIds:[certified.artifactId]});
    assert.equal(receipt.status,'adopted');assert.equal((await h.service.loadEffectiveCatalog({campaignId:'c',branchId:'b1'})).entries.length,1);
    await assert.rejects(h.service.publishArtifact(await h.draft({entries:[{...h.base.entries[0],definition:{name:'changed'}}]})),/immutable_entry_exists/);
    const a=await h.service.publishArtifact(await h.draft());const dependency=lore('entry-2',['f1']);dependency.dependencyIds=['entry-1'];
    const a2=await h.service.publishArtifact(await h.draft({segmentId:'second',entries:[dependency],sections:[],dependencies:[{artifactId:a.artifactId,contentHash:a.contentHash}]}));
    const b2=await h.service.freezeBinding('c','b2');
    const input={campaignId:'c',branchId:'b2',expectedStateVersion:0,expectedManifestHash:b2.manifestHash,artifactIds:[a2.artifactId]};
    assert.equal((await h.service.adoptAtSafeBoundary(input)).reason,'missing_dependency');
    assert.equal((await h.service.adoptAtSafeBoundary({...input,artifactIds:[a.artifactId,a2.artifactId]})).status,'adopted');
    assert.equal((await h.service.loadEffectiveCatalog({campaignId:'c',branchId:'b2'})).entries.length,3);
  }finally{h.db.raw.close();}
});

test('opening v2 gate retains 20-fact baseline and proves characters, locations, events and action closure',async()=>{
  const h=await harness();try{h.setFacts([h.fact]);
    const a=await h.service.publishArtifact(await h.draft());
    const report=validateSegmentArtifactContent({artifact:a,dependencyEntries:h.base.entries,facts:[h.fact],entities:[],events:[],blockingReviews:[],
      openingRequirements:{requiredEntityIds:['location'],requiredFactIds:['f1'],requiredEventIds:['event'],requiredEntryIds:['scene'],ranges:a.coverage}});
    assert.ok(report.errors.some(e=>e.includes('Canon 事实不足')));assert.ok(report.errors.includes('opening_scene_missing'));
    assert.ok(report.errors.includes('opening_event_missing:event'));assert.ok(report.errors.includes('opening_entry_missing:scene'));
    // A fully classified unrelated later blocker may be left pending, while
    // an issue with unproved scope cannot silently bypass the opening gate.
    const unaffected=validateSegmentArtifactContent({artifact:a,dependencyEntries:h.base.entries,facts:[h.fact],entities:[],events:[],
      blockingReviews:[{issueId:'future',severity:'blocking',scopeProvenComplete:true,entryIds:['future-entry']} ]});assert.deepEqual(unaffected.errors,[]);
    const unknown=validateSegmentArtifactContent({artifact:a,dependencyEntries:h.base.entries,facts:[h.fact],entities:[],events:[],
      blockingReviews:[{issueId:'unclassified',severity:'blocking',entryIds:['future-entry']} ]});assert.ok(unknown.errors.includes('blocking_review:unclassified'));
  }finally{h.db.raw.close();}
});
