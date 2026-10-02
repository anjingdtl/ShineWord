'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const dist=process.env.PHASE6_DIST_DIR??'../dist';
const { BUILTIN_MIGRATIONS } = require(`${dist}/infra/sqlite/builtinMigrations`);
const { SqliteWorldStore } = require(`${dist}/infra/sqlite/sqliteWorldStore`);
const { SqliteSourceStore } = require(`${dist}/infra/sqlite/sqliteSourceStore`);
const { PHASE6_SOURCE_INDEX_SCHEMA } = require(`${dist}/infra/sqlite/phase6SourceIndexSchema`);
const { SqliteSourceIndexStore } = require(`${dist}/infra/sqlite/sqliteSourceIndexStore`);
const { SourceCatalogAdapter, MAX_SOURCE_EVIDENCE_CP } = require(`${dist}/application/sourceIndex/sourceCatalog`);
const { PersistentSourceSearchService } = require(`${dist}/application/sourceIndex/persistentSourceSearch`);
const { LocalSourceSearchService } = require(`${dist}/application/search/localSourceSearch`);
const { importTxtSourceStreaming } = require(`${dist}/application/import/streamingTxtImport`);
const { SOURCE_INDEX_PAGE_CP, PERSISTENT_SOURCE_INDEX_VERSION } = require(`${dist}/application/sourceIndex/types`);
const hashes = { sha256Hex: value => createHash('sha256').update(value,'utf8').digest('hex') };
const h = hashes.sha256Hex;
class Adapter {
  constructor(db) { this.db=db; this.chain=Promise.resolve(); this.failPattern=null; }
  async execute(sql,params=[]) {
    if (this.failPattern?.test(sql)) { this.failPattern=null; throw new Error('fixture_write_failure'); }
    if (!params.length&&sql.includes(';')) { this.db.exec(sql);return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql,params=[]) { return this.db.prepare(sql).get(...params)??null; }
  async queryAll(sql,params=[]) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const run=async () => {this.db.exec('BEGIN IMMEDIATE');try {const value=await work(this);this.db.exec('COMMIT');return value;}
      catch(error) {this.db.exec('ROLLBACK');throw error;} };
    const next=this.chain.then(run,run);this.chain=next.catch(() => {});return next;
  }
}
async function setup(options={}) {
  const raw=new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) raw.exec(migration.sql);
  if (!raw.prepare("SELECT name FROM sqlite_master WHERE name='source_index_sources'").get()) raw.exec(PHASE6_SOURCE_INDEX_SCHEMA);
  const db=new Adapter(raw),sources=new SqliteSourceStore(db),worlds=new SqliteWorldStore(db);
  await worlds.createWorld({worldId:'w',title:'测试',sourceSha256:h('world'),sourceBytes:1,normalizeVersion:'n',
    chapterSplitVersion:'c',buildStatus:'ready',createdAt:'t',updatedAt:'t'});
  const catalog=new SourceCatalogAdapter(sources,worlds,hashes);
  const store=new SqliteSourceIndexStore(db,options.store);
  let entities=[];
  const aliases={async listEntities() {return entities;} };
  let yields=0;
  const service=new PersistentSourceSearchService(catalog,sources,aliases,store,hashes,
    {yieldControl:async () => {yields++;},maxFallbackScanCp:0,...options.service});
  async function source(id,text,ordinal=1,chapters) {
    const points=[...text],count=points.length;
    const manifest={sourceId:id,rawSha256Hex:h(`raw:${id}:${text}`),normalizedTreeHash:h(text),normalizeTreeHashVersion:'tree',byteLength:Buffer.byteLength(text),
      codePointCount:count,encoding:'utf-8',normalizeVersion:'n',chapterSplitVersion:'c',normalizeShardScheme:'shard',splitStrategy:'fallback',
      fileName:`${id}.txt`,title:id,status:'staging',createdAt:'t',updatedAt:'t'};
    await sources.beginStaging(manifest);
    for (let start=0,index=0;start<count;start+=31,index++) await sources.saveShard({sourceId:id,shardIndex:index,startCp:start,endCp:Math.min(count,start+31),text:points.slice(start,start+31).join('')});
    const chapterRows=(chapters??[{chapterId:'ch-1',index:1,title:'第一章',startOffset:0,endOffset:count}])
      .map(chapter => ({...chapter,charCount:chapter.endOffset-chapter.startOffset,contentHash:h(points.slice(chapter.startOffset,chapter.endOffset).join(''))}));
    const chunks=chapterRows.map((chapter,index) => ({chunkId:`chunk-${index+1}`,chapterId:chapter.chapterId,chunkIndex:index,
      startOffset:chapter.startOffset,endOffset:chapter.endOffset,charCount:chapter.charCount,contentHash:chapter.contentHash}));
    await sources.activateSource({manifest,chapters:chapterRows,chunks});
    await worlds.addWorldSource({worldId:'w',sourceId:id,sourceOrdinal:ordinal,rawSha256:manifest.rawSha256Hex,createdAt:'t'});
    return {...manifest,status:'active'};
  }
  const key=manifest => ({sourceId:manifest.sourceId,normalizedTreeHash:manifest.normalizedTreeHash,indexVersion:PERSISTENT_SOURCE_INDEX_VERSION,codePointCount:manifest.codePointCount});
  async function buildScope(ranges) {return {kind:'build_internal',worldId:'w',intentId:'intent',sourceBinding:(await catalog.snapshot('w')).binding,allowedRanges:ranges};}
  return {raw,db,sources,worlds,catalog,store,service,source,key,buildScope,aliases,setEntities:value => {entities=value;},get yields() {return yields;}};
}

test('catalog preserves source-local Unicode coordinates and ordinal mirror IDs across append',async t => {
  const f=await setup();t.after(() => f.raw.close());
  await f.source('s1','李青😀穿过城门。');
  const range=await f.catalog.createRange('s1',2,3);
  assert.equal(await f.catalog.readRange(range),'😀');
  const before=await f.catalog.snapshot('w');
  await f.source('s2','阿青来到别城。',2);
  await f.source('s3','新部记录。',3);
  const after=await f.catalog.snapshot('w');
  assert.deepEqual(after.members.map(member => member.chapters[0].chapterId),['ch-1','s2-ch-1','s3-ch-1']);
  assert.notEqual(after.binding.sourceSetHash,before.binding.sourceSetHash);
  assert.equal(await f.catalog.isBindingCompatible('w',before.binding),true);
  assert.equal(await f.catalog.readRange(range),'😀');
  f.raw.prepare('UPDATE world_sources SET source_ordinal=4 WHERE source_id=?').run('s1');
  assert.equal(await f.catalog.isBindingCompatible('w',before.binding),false);
});

test('catalog rejects staging, fabricated evidence, corrupt shards and unbounded reads',async t => {
  const f=await setup();t.after(() => f.raw.close());
  await f.source('s','李青😀来到市集。');
  const range=await f.catalog.createRange('s',0,4);
  await assert.rejects(() => f.catalog.readRange({...range,rangeContentHash:h('fake')}),/hash_mismatch/);
  await assert.rejects(() => f.catalog.createRange('s',-1,4),/invalid_source_range/);
  await assert.rejects(() => f.catalog.createRange('s',0,1000),/invalid_source_range/);
  f.raw.prepare('UPDATE imported_source_segments SET text=? WHERE source_id=?').run('短','s');
  await assert.rejects(() => f.catalog.readRange(range),/incomplete/);
  f.raw.prepare("UPDATE imported_sources SET status='staging' WHERE source_id=?").run('s');
  await assert.rejects(() => f.catalog.createRange('s',0,1),/not_active/);
  const large=await f.source('large','字'.repeat(MAX_SOURCE_EVIDENCE_CP+1),2);
  await assert.rejects(() => f.catalog.createRange('large',0,large.codePointCount),/bounded_slices/);
});

test('persisted CJK postings survive cold service creation and reuse completed pages',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const manifest=await f.source('s','李青来到城门。\n守卫让李青进入市集。');
  const range=await f.catalog.createRange('s',0,manifest.codePointCount);
  await f.service.ensureIndexed([range]);
  assert.ok(f.yields>0);
  const stats=await f.store.stats();
  assert.ok(stats.postingCount>0);
  let commits=0;
  const coldStore=new SqliteSourceIndexStore(f.db);
  const original=coldStore.commitPage.bind(coldStore);
  coldStore.commitPage=async (...args) => {commits++;return original(...args);};
  const cold=new PersistentSourceSearchService(f.catalog,f.sources,f.aliases,coldStore,hashes,{yieldControl:async () => {},maxFallbackScanCp:0});
  await cold.ensureIndexed([range]);
  const found=await cold.search({worldId:'w',query:'李青城门',scope:await f.buildScope([range])});
  assert.equal(commits,0);
  assert.equal(found.completeness,'complete');
  assert.equal(found.coverage[0].complete,true);
  assert.ok(found.hits.some(hit => hit.text.includes('城门')));
  assert.deepEqual(await f.store.stats(),stats);
});

test('aliases update separately from stable postings and retain canonical recall',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const manifest=await f.source('s','李青来到城门。\n李青买下火把。');
  const range=await f.catalog.createRange('s',0,manifest.codePointCount);
  await f.service.ensureIndexed([range]);
  f.setEntities([{entityId:'e',name:'李青',aliases:['阿青']}]);
  let found=await f.service.search({worldId:'w',query:'阿青',scope:await f.buildScope([range])});
  assert.ok(found.hits.length>0);
  const before=await f.store.stats();
  f.setEntities([{entityId:'e',name:'李青',aliases:['青少侠']}]);
  found=await f.service.search({worldId:'w',query:'青少侠',scope:await f.buildScope([range])});
  assert.ok(found.hits.length>0);
  assert.deepEqual(await f.store.stats(),before);
  found=await f.service.search({worldId:'w',query:'阿青',scope:await f.buildScope([range])});
  assert.equal(found.hits.length,0);
});

test('empty partial index explicitly reports incomplete coverage and small gap scan does not claim full indexing',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const manifest=await f.source('s','李青在此。\n未整理的山洞记录。');
  const range=await f.catalog.createRange('s',0,manifest.codePointCount),scope=await f.buildScope([range]);
  const found=await f.service.search({worldId:'w',query:'山洞',scope});
  assert.deepEqual(found.hits,[]);
  assert.equal(found.completeness,'partial');
  assert.equal(found.coverage[0].complete,false);
  assert.equal(found.coverage[0].lastCheckpoint,0);
  const scanning=new PersistentSourceSearchService(f.catalog,f.sources,f.aliases,f.store,hashes,{maxFallbackScanCp:8192,yieldControl:async () => {}});
  const scanned=await scanning.search({worldId:'w',query:'山洞',scope});
  assert.ok(scanned.hits.some(hit => hit.text.includes('山洞')));
  assert.equal(scanned.completeness,'partial');
  assert.equal((await f.store.stats()).pageCount,0);
});

test('foreground range clipping cannot leak a future suffix or infer absence from index coverage',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const known='李青停留城门。',future='未来秘钥藏在山洞。';
  const manifest=await f.source('s',known+future);
  const all=await f.catalog.createRange('s',0,manifest.codePointCount),visible=await f.catalog.createRange('s',0,[...known].length);
  await f.service.ensureIndexed([all]);
  const scope={kind:'player_known',branchId:'b',stateVersion:5,knowledgeSnapshotHash:h('known'),contentManifestHash:h('manifest'),allowedRanges:[visible]};
  await assert.rejects(() => f.service.search({worldId:'w',query:'城门',scope}),/player_scope_denied/);
  let current=true;
  const authorized=new PersistentSourceSearchService(f.catalog,f.sources,f.aliases,f.store,hashes,
    {maxFallbackScanCp:0,authorizePlayerScope:async ({scope}) => current&&scope.branchId==='b'&&scope.stateVersion===5});
  const found=await authorized.search({worldId:'w',query:'城门',scope});
  assert.equal(found.hits[0].text,known);
  assert.equal(found.hits[0].range.endCp,[...known].length);
  assert.equal(found.completeness,'complete');
  const forbidden=await authorized.search({worldId:'w',query:'山洞秘钥',scope});
  assert.equal(forbidden.hits.length,0);
  current=false;
  await assert.rejects(() => authorized.search({worldId:'w',query:'城门',scope}),/player_scope_denied/);
  await assert.rejects(() => authorized.search({worldId:'w',query:'城门',scope:{...scope,branchId:'other'}}),/player_scope_denied/);
});

test('player permission recheck rejects results that became stale during asynchronous lookup',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const manifest=await f.source('s','李青来到城门。');
  const range=await f.catalog.createRange('s',0,manifest.codePointCount);await f.service.ensureIndexed([range]);
  let checks=0;
  const service=new PersistentSourceSearchService(f.catalog,f.sources,f.aliases,f.store,hashes,{maxFallbackScanCp:0,
    authorizePlayerScope:async () => ++checks===1});
  const scope={kind:'player_known',branchId:'b',stateVersion:0,knowledgeSnapshotHash:h('k'),contentManifestHash:h('m'),allowedRanges:[range]};
  await assert.rejects(() => service.search({worldId:'w',query:'李青',scope}),/player_scope_changed/);
  assert.equal(checks,2);
});

test('multi-source retrieval preserves identities, mirrors, and snapshot membership boundaries',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const one=await f.source('s1','第一部李青在城门。'),old=(await f.catalog.snapshot('w')).binding;
  const two=await f.source('s2','第二部李青在山洞。',2);
  const r1=await f.catalog.createRange('s1',0,one.codePointCount),r2=await f.catalog.createRange('s2',0,two.codePointCount);
  await f.service.ensureIndexed([r1,r2]);
  const found=await f.service.search({worldId:'w',query:'山洞',scope:await f.buildScope([r1,r2])});
  assert.equal(found.hits.length,1);
  assert.equal(found.hits[0].range.sourceId,'s2');
  assert.equal(found.hits[0].chapterId,'s2-ch-1');
  await assert.rejects(() => f.service.search({worldId:'w',query:'山洞',scope:{kind:'build_internal',worldId:'w',intentId:'i',sourceBinding:old,allowedRanges:[r2]}}),/binding_invalid/);
  const compatible=await f.service.search({worldId:'w',query:'城门',scope:{kind:'build_internal',worldId:'w',intentId:'i',sourceBinding:old,allowedRanges:[r1]}});
  assert.equal(compatible.hits[0].range.sourceId,'s1');
});

test('partial bootstrap indexing persists a contiguous checkpoint without indexing distant pages',async t => {
  const f=await setup({service:{maxPagesPerPass:1}});t.after(() => f.raw.close());
  const text='李青城门。'+'风'.repeat(SOURCE_INDEX_PAGE_CP*2)+'山洞';
  const manifest=await f.source('s',text);
  const opening=await f.catalog.createRange('s',0,64),all=await f.catalog.createRange('s',0,manifest.codePointCount);
  await f.service.ensureIndexed([opening]);
  let coverage=await f.store.coverage(f.key(manifest));
  assert.equal(coverage.lastCheckpoint,SOURCE_INDEX_PAGE_CP);
  assert.equal(coverage.complete,false);
  assert.equal((await f.store.stats()).pageCount,1);
  const distant=await f.service.search({worldId:'w',query:'山洞',scope:await f.buildScope([all])});
  assert.equal(distant.completeness,'partial');
  assert.equal(distant.hits.length,0);
  await f.service.ensureIndexed([all]);
  coverage=await f.store.coverage(f.key(manifest));
  assert.equal(coverage.lastCheckpoint,SOURCE_INDEX_PAGE_CP*2);
});

test('postings count damage invalidates only derived pages and rebuilds from intact source',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const manifest=await f.source('s','李青在城门。\n山洞通向市集。');
  const range=await f.catalog.createRange('s',0,manifest.codePointCount);await f.service.ensureIndexed([range]);
  f.raw.exec('DELETE FROM source_index_postings WHERE rowid IN (SELECT rowid FROM source_index_postings LIMIT 1)');
  let coverage=await f.store.coverage(f.key(manifest));
  assert.equal(coverage.corrupt,true);assert.equal(coverage.complete,false);assert.deepEqual(coverage.indexedRanges,[]);
  assert.equal(await f.catalog.readRange(range),'李青在城门。\n山洞通向市集。');
  assert.ok(await f.worlds.getWorld('w'));
  await f.service.ensureIndexed([range]);
  coverage=await f.store.coverage(f.key(manifest));
  assert.equal(coverage.corrupt,false);assert.equal(coverage.complete,true);
  assert.ok((await f.service.search({worldId:'w',query:'山洞',scope:await f.buildScope([range])})).hits.length>0);
});

test('paragraph evidence fingerprint corruption fails closed before output and remains visibly partial',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const manifest=await f.source('s','李青在城门。');const range=await f.catalog.createRange('s',0,manifest.codePointCount);
  await f.service.ensureIndexed([range]);
  f.raw.prepare('UPDATE source_index_paragraphs SET content_hash=?').run(h('tampered'));
  const result=await f.service.search({worldId:'w',query:'李青',scope:await f.buildScope([range])});
  assert.equal(result.hits.length,0);assert.equal(result.completeness,'partial');assert.equal(result.coverage[0].corrupt,true);
});

test('atomic page writes roll back a fault and resume without duplicate postings',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const manifest=await f.source('s','李青穿过城门。\n李青进入市集。');const range=await f.catalog.createRange('s',0,manifest.codePointCount);
  f.db.failPattern=/INSERT INTO source_index_postings/;
  await assert.rejects(() => f.service.ensureIndexed([range]),/fixture_write_failure/);
  assert.deepEqual(await f.store.stats(),{pageCount:0,paragraphCount:0,postingCount:0,maxPages:256});
  await f.service.ensureIndexed([range]);const first=await f.store.stats();await f.service.ensureIndexed([range]);
  assert.deepEqual(await f.store.stats(),first);assert.equal((await f.store.coverage(f.key(manifest))).complete,true);
});

test('bounded disk LRU marks evicted coverage partial and never deletes original source',async t => {
  const f=await setup({store:{maxPages:2}});t.after(() => f.raw.close());
  const manifest=await f.source('s','李青'+'风'.repeat(SOURCE_INDEX_PAGE_CP*2));const range=await f.catalog.createRange('s',0,manifest.codePointCount);
  await f.service.ensureIndexed([range]);
  assert.equal((await f.store.stats()).pageCount,2);
  const coverage=await f.store.coverage(f.key(manifest));assert.equal(coverage.complete,false);assert.equal(coverage.lastCheckpoint,0);
  assert.equal(await f.catalog.readRange(range),'李青'+'风'.repeat(SOURCE_INDEX_PAGE_CP*2));
});

test('a replaced/orphaned source and deleted project cannot be revived by late cache writes',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const manifest=await f.source('s','李青来到城门。');const range=await f.catalog.createRange('s',0,manifest.codePointCount);
  const original=f.store.commitPage.bind(f.store);
  f.store.commitPage=async (key,page) => {f.raw.prepare("UPDATE imported_sources SET status='orphaned' WHERE source_id=?").run(key.sourceId);return original(key,page);};
  await assert.rejects(() => f.service.ensureIndexed([range]),/changed_or_deleted/);
  assert.equal((await f.store.stats()).pageCount,0);
  f.raw.exec("DELETE FROM worlds WHERE world_id='w'");
  await assert.rejects(() => f.store.replaceAliases('w',h('aliases'),[{entityId:'e',name:'李青'}]),/world_deleted/);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM source_index_alias_versions').get().n,0);
});

test('existing LocalSourceSearchService actually routes production-shaped calls into persistent backend',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const known='李青在城门。\n',future='未知山洞。';await f.source('s',known+future);
  const local=new LocalSourceSearchService(f.sources,f.aliases,f.service);
  const sourceRanges=[{chapterId:'ch-1',startCodePoint:0,endCodePoint:[...known].length}];
  const found=await local.search({worldId:'w',sourceId:'s',query:'李青',sourceRanges});
  assert.ok(found.passages.length>0);assert.ok(found.passages.every(passage => passage.endCodePoint<=[...known].length));
  assert.equal(found.completeness,'complete');assert.equal(found.result.hasMatches,true);
  const blocked=await local.search({worldId:'w',sourceId:'s',query:'山洞',sourceRanges});assert.equal(blocked.passages.length,0);
  const explicit=await local.search({worldId:'w',sourceId:'s',query:'山洞'});assert.ok(explicit.passages.some(passage => passage.text.includes('山洞')));
  const controller=new AbortController();controller.abort();
  await assert.rejects(() => local.search({worldId:'w',sourceId:'s',query:'李青',signal:controller.signal}),{name:'AbortError'});
});

test('same-chapter adjacent context crosses index pages but remains inside permitted source ranges',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const prefix='风'.repeat(SOURCE_INDEX_PAGE_CP-8)+'\n';
  const text=prefix+'李青城门。\n守卫检查火把。\n未来秘钥。';const manifest=await f.source('s',text);
  const local=new LocalSourceSearchService(f.sources,f.aliases,f.service);
  const end=[...text].length-[...'未来秘钥。'].length;
  const found=await local.search({sourceId:'s',worldId:'w',query:'李青',sourceRanges:[{chapterId:'ch-1',startCodePoint:0,endCodePoint:end}]});
  assert.ok(found.passages.some(passage => passage.text.includes('李青')));
  assert.ok(found.adjacentPrefetch.some(passage => passage.text.includes('守卫')));
  assert.ok(found.adjacentPrefetch.every(passage => passage.endCodePoint<=end&&!passage.text.includes('秘钥')));
  assert.ok(manifest.codePointCount>SOURCE_INDEX_PAGE_CP);
});


for (const fixture of [
  {encoding:'utf-8',raw:Buffer.from('第一章 开篇\n李青😀走过城门。'),expected:'第一章 开篇\n李青😀走过城门。'},
  {encoding:'gbk',raw:Buffer.from('b5dad2bbd5c220bfaac6aa0ac0eec7e0d7dfb9fdb3c7c3c5a1a3','hex'),expected:'第一章 开篇\n李青走过城门。'},
]) test(`real streaming ${fixture.encoding} decode integrates source catalog and persistent index`,async t => {
  const f=await setup();t.after(() => f.raw.close());
  const rawHash=createHash('sha256').update(fixture.raw).digest('hex');
  const manifest={sourceId:'stream',rawSha256Hex:rawHash,normalizedTreeHash:'0'.repeat(64),normalizeTreeHashVersion:'tree',
    byteLength:fixture.raw.length,codePointCount:0,encoding:fixture.encoding,normalizeVersion:'n',chapterSplitVersion:'c',normalizeShardScheme:'shard',
    splitStrategy:'fallback',fileName:'fixture.txt',title:'fixture',status:'staging',createdAt:'t',updatedAt:'t'};
  await f.sources.beginStaging(manifest);
  const decoder=new TextDecoder(fixture.encoding);let expectedOffset=0;
  const reader={encoding:fixture.encoding,byteLength:fixture.raw.length,rawSha256Hex:rawHash,
    async readText(offset,maxBytes) {
      assert.equal(offset,expectedOffset);const next=Math.min(fixture.raw.length,offset+maxBytes);expectedOffset=next;
      return {text:decoder.decode(fixture.raw.subarray(offset,next),{stream:next<fixture.raw.length}),nextByteOffset:next,atEof:next===fixture.raw.length};
    }};
  const result=await importTxtSourceStreaming(reader,f.sources,'stream',{...hashes,
    sha256BytesHex:async bytes => createHash('sha256').update(bytes).digest('hex'),readWindowBytes:7,shardCp:13,targetChunkCodePoints:10});
  await f.sources.activateSource({manifest:{...manifest,...result,status:'active'},chapters:result.chapters,chunks:result.chunks});
  await f.worlds.addWorldSource({worldId:'w',sourceId:'stream',sourceOrdinal:1,rawSha256:rawHash,createdAt:'t'});
  const range=await f.catalog.createRange('stream',0,result.codePointCount);
  assert.equal(await f.catalog.readRange(range),fixture.expected);
  const binding=(await f.catalog.snapshot('w')).binding;
  assert.equal(binding.members[0].normalizedTreeHash,result.normalizedTreeHash);
  await f.service.ensureIndexed([range]);
  const found=await f.service.search({worldId:'w',query:'李青城门',scope:await f.buildScope([range])});
  assert.ok(found.hits.some(hit => hit.text.includes('李青')));
  assert.equal(found.completeness,'complete');
});

test('CJK name spanning a storage-page boundary remains searchable without widening player permission',async t => {
  const f=await setup();t.after(() => f.raw.close());
  const manifest=await f.source('s','风'.repeat(SOURCE_INDEX_PAGE_CP-1)+'李青城门。');
  const all=await f.catalog.createRange('s',0,manifest.codePointCount);await f.service.ensureIndexed([all]);
  const found=await f.service.search({worldId:'w',query:'李青',scope:await f.buildScope([all])});
  assert.ok(found.hits.some(hit => hit.text.includes('李青')));
  const visible=await f.catalog.createRange('s',SOURCE_INDEX_PAGE_CP-1,SOURCE_INDEX_PAGE_CP);
  const local=new LocalSourceSearchService(f.sources,f.aliases,f.service);
  const blocked=await local.search({worldId:'w',sourceId:'s',query:'李青',sourceRanges:[{chapterId:'ch-1',startCodePoint:visible.startCp,endCodePoint:visible.endCp}]});
  assert.equal(blocked.passages.length,0);
});
