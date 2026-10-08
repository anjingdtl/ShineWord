'use strict';

const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {BUILTIN_MIGRATIONS}=require('../../dist/infra/sqlite/builtinMigrations');
const {SqliteWorldStore}=require('../../dist/infra/sqlite/sqliteWorldStore');
const {SqliteSourceStore}=require('../../dist/infra/sqlite/sqliteSourceStore');
const {SqliteSegmentArtifactStore}=require('../../dist/infra/sqlite/sqliteSegmentArtifactStore');
const {SourceCatalogAdapter}=require('../../dist/application/sourceIndex/sourceCatalog');
const {SegmentPublicationService,validateSegmentArtifactContent,buildSegmentCitations}=require('../../dist/application/segmentPublication');
const {compileProgressiveOpeningPackage}=require('../../dist/application/worldPackage/progressiveOpening');
const {createCampaign}=require('../../dist/application/campaign/createCampaign');
const {publishUserRequestedSourceLookupDelta}=require('../../dist/application/worldPackage/progressiveDelta');
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
module.exports={fixture,lore,sha,now};
