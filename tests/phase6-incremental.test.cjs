'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const output = process.env.PHASE6_DIST || path.resolve(__dirname, '../dist');
const load = name => require(path.join(output, name));
const { selectCanonSubset, mergeIncrementalEntries, sourceIdForChapter } = load('application/incrementalMapping/canonSelection');
const { buildPackageDraftFromCanon } = load('application/worldPackage/buildPackageFromCanon');
const { BUILTIN_MIGRATIONS } = load('infra/sqlite/builtinMigrations');
const { SqliteSourceStore } = load('infra/sqlite/sqliteSourceStore');
const { SqliteBuildRunStore } = load('infra/sqlite/sqliteBuildRunStore');
const { SqliteWorldStore } = load('infra/sqlite/sqliteWorldStore');
const { createExtractionRun, executeRun, parseUnitRanges } = load('application/worldBuild/coordinator');
const sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const now = () => '2026-10-02T12:00:00.000Z';

class Adapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  async execute(sql, params = []) { if (!params.length && sql.includes(';')) { this.db.exec(sql); return 0; } return this.db.prepare(sql).run(...params).changes; }
  transaction(work) {
    const run = async () => { this.db.exec('BEGIN IMMEDIATE'); try { const result = await work(this); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } };
    const result = this.chain.then(run, run); this.chain = result.then(() => undefined, () => undefined); return result;
  }
}
async function setup() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) db.exec(migration.sql);
  const adapter = new Adapter(db);
  const sourceStore = new SqliteSourceStore(adapter), runStore = new SqliteBuildRunStore(adapter), worldStore = new SqliteWorldStore(adapter);
  const text = '林辰抵达旧桥。'.repeat(300);
  const manifest = { sourceId: 'src', rawSha256Hex: sha(text), normalizedTreeHash: sha('normalized'),
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: Buffer.byteLength(text), codePointCount: text.length,
    encoding: 'utf-8', normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
    normalizeShardScheme: 'normalize-shard-1', splitStrategy: 'standard', fileName: 'synthetic.txt', title: '合成故障样本',
    status: 'active', createdAt: now(), updatedAt: now() };
  await sourceStore.beginStaging({ ...manifest, status: 'staging' });
  await sourceStore.saveShard({ sourceId: 'src', shardIndex: 0, startCp: 0, endCp: text.length, text });
  const chapters = [{ chapterId: 'ch-1', index: 1, title: '第一章', startOffset: 0, endOffset: text.length, charCount: text.length, contentHash: sha(text) }];
  const chunks = [];
  for (let start = 0; start < text.length; start += 800) chunks.push({ chunkId: `c-${start / 800}`, chapterId: 'ch-1', chunkIndex: start / 800,
    startOffset: start, endOffset: Math.min(start + 800, text.length), charCount: Math.min(800, text.length - start), contentHash: sha(text.slice(start, start + 800)) });
  await sourceStore.activateSource({ manifest, chapters, chunks });
  return { db, adapter, sourceStore, runStore, worldStore, text };
}
const binding = { sourceSetHash: sha('binding'), members: [{ sourceId: 'src', sourceOrdinal: 1, normalizedTreeHash: sha('normalized') }] };
const range = { sourceId: 'src', normalizedTreeHash: sha('normalized'), startCp: 0, endCp: 1000, rangeContentHash: sha('range') };
function entity(id, type, name = id) { return { worldId: 'w', entityId: id, type, name, firstSeenChapterId: 'ch-1', aliases: [] }; }
function fact(id, subject, value = {}, start = 10, chapterId = 'ch-1') {
  return { worldId: 'w', factId: id, subjectEntityId: subject, predicate: id, value, status: 'explicit', confidence: 1,
    validFrom: null, validTo: null, revealAt: null, scope: 'world',
    sources: [{ chapterId, startOffset: start, endOffset: start + 2, quote: '旧桥', quoteSha256: sha('旧桥') }] };
}
function canon(count = 200) {
  return { entities: [entity('hero', 'character', '林辰'), entity('place', 'location', '旧桥')],
    facts: Array.from({ length: count }, (_, i) => fact(`f-${i}`, i % 2 ? 'place' : 'hero')),
    events: [{ worldId: 'w', eventId: 'event-1', title: '林辰抵达旧桥', summary: '抵达', worldTimeOrder: 1,
      narrativeChapterId: 'ch-1', validFrom: null, validTo: null, status: 'canon', dependsOnEventIds: [] }] };
}
function options(kind = 'opening', extra = {}) { return { kind, ranges: [range], sourceBinding: binding, executionConfigFingerprint: 'frozen-model-low', ...extra }; }
function entry(id, facts, deps = []) { return { entryId: id, kind: 'lore', revision: 1, provenance: { kind: 'explicit', sourceFactIds: facts, rationale: '测试证据' },
  visibility: 'public', dependencyIds: deps, definition: { name: id, title: id, text: '已发布描述' } }; }

test('M4 opening maps bounded real facts and entity/event reference closure; retains 20-fact gate', () => {
  const input = canon();
  const selected = selectCanonSubset({ ...input, options: options() });
  assert.equal(selected.facts.length, 20);
  assert.deepEqual(selected.diagnostics, []);
  assert.equal(selected.events.length, 1);
  assert.equal(selected.entities.length, 2);
  const short = selectCanonSubset({ ...canon(19), options: options() });
  assert.ok(short.diagnostics.some(message => message.includes('19/20')));
  const unresolved = canon(); unresolved.events[0].dependsOnEventIds = ['missing-event'];
  assert.ok(selectCanonSubset({ ...unresolved, options: options() }).diagnostics.some(message => message.includes('missing-event')));
  input.facts[0].value = { companion: 'missing', targetEntityId: 'ent-missing' };
  assert.ok(selectCanonSubset({ ...input, options: options() }).diagnostics.some(message => message.includes('ent-missing')));
});

test('M4 source-local multi-part ranges preserve mirror IDs and do not select same-offset other sources', () => {
  const multi = { ...binding, members: [...binding.members, { sourceId: 'part2', sourceOrdinal: 2, normalizedTreeHash: sha('part2') }, { sourceId: 'part10', sourceOrdinal: 10, normalizedTreeHash: sha('part10') }] };
  assert.equal(sourceIdForChapter('s10-ch-1', multi), 'part10');
  const selected = selectCanonSubset({ facts: [fact('old', 'hero'), fact('new', 'hero', {}, 10, 's2-ch-1')], entities: [entity('hero', 'character')], events: [],
    options: options('incremental', { sourceBinding: multi, ranges: [{ ...range, sourceId: 'part2', normalizedTreeHash: sha('part2') }] }) });
  assert.deepEqual(selected.facts.map(f => f.factId), ['new']);
});

test('M4 changed facts expand affected-entry dependencies but keep unrelated immutable mappings', () => {
  const original = [{...entry('hero-card', ['old']),kind:'actor_template'}, entry('action', [], ['hero-card']), entry('unrelated', ['other']), entry('historical-lore', ['old'])];
  const selected = selectCanonSubset({ entities: [entity('hero', 'character'), entity('other-actor', 'character')],
    facts: [fact('old', 'hero'), fact('new', 'hero'), fact('other', 'other-actor')], events: [],
    options: options('incremental', { previousEntries: original, delta: { worldId: 'w', factIds: ['new'], entityIds: [], eventIds: [], canonSnapshotHash: sha('delta'), executionConfigFingerprint: 'frozen-model-low' } }) });
  assert.deepEqual(selected.affectedEntryIds.sort(), ['action', 'hero-card']);
  assert.ok(!selected.affectedEntryIds.includes('historical-lore'),'a new identity fact does not rewrite historical fact lore');
  assert.deepEqual(selected.facts.map(f => f.factId).sort(), ['new', 'old']);
  const updated = entry('hero-card', ['old', 'new']); updated.definition.text = '增量修订';
  const merged = mergeIncrementalEntries(original, [updated, { ...entry('unrelated', ['other']), definition: { text: '禁止改写' } }], selected.affectedEntryIds);
  assert.equal(original[0].definition.text, '已发布描述');
  assert.equal(merged.find(e => e.entryId === 'unrelated').definition.text, '已发布描述');
  assert.equal(merged.find(e => e.entryId === 'hero-card').definition.text, '增量修订');
  assert.throws(() => mergeIncrementalEntries([], [entry('dangling', [], ['absent'])], []), /闭包缺失/);
});

test('M4 scope clips partial storage chunks; exact retry reuses checkpoint without whole-chunk claims', async () => {
  const h = await setup();
  try {
    let calls = 0;
    const extractor = { version: 'test-extractor-1', async extract(input) {
      calls++; assert.equal(input.chunkText, h.text.slice(9, 90));
      assert.equal(input.chunk.startOffset, 9); assert.equal(input.chunk.endOffset, 90);
      return { entities: [], facts: [], events: [], ruleMappings: [] };
    } };
    const deps = { ...h, sha256Hex: sha, now, extractor };
    await createExtractionRun(deps, { runId: 'partial-1', worldId: 'w', sourceId: 'src', modelFingerprint: 'model', title: '测试', extractorVersion: extractor.version, scope: { startCp: 9, endCp: 90 } });
    const units = await h.runStore.listUnits('partial-1');
    assert.deepEqual(parseUnitRanges(units[0].sourceRangesJson).ranges.map(r => [r.startCp, r.endCp]), [[9, 90]]);
    assert.equal((await executeRun(deps, 'partial-1')).completed, true);
    assert.equal((await h.worldStore.getChunks('w'))[0].extractionStatus, 'pending');
    await createExtractionRun(deps, { runId: 'partial-2', worldId: 'w', sourceId: 'src', modelFingerprint: 'model', title: '测试', extractorVersion: extractor.version, scope: { startCp: 9, endCp: 90 } });
    assert.equal((await executeRun(deps, 'partial-2')).completed, true);
    assert.equal(calls, 1);
  } finally { h.db.close(); }
});

test('M4 fencing loss/project deletion prevents every canon, checkpoint and chunk-status write', async () => {
  for (const mode of ['fence', 'delete']) {
    const h = await setup();
    try {
      const original = h.worldStore.commitChunkResult.bind(h.worldStore);
      h.worldStore.commitChunkResult = async input => {
        if (mode === 'fence') h.db.prepare('UPDATE world_build_runs SET fencing_token = fencing_token + 1 WHERE run_id = ?').run('r');
        else h.db.prepare('DELETE FROM worlds WHERE world_id = ?').run('w');
        return original(input);
      };
      const extractor = { version: 'test-extractor-1', async extract() { return { entities: [ { entityKey: 'hero', type: 'character', name: '林辰' } ], facts: [], events: [], ruleMappings: [] }; } };
      const deps = { ...h, sha256Hex: sha, now, extractor };
      await createExtractionRun(deps, { runId: 'r', worldId: 'w', sourceId: 'src', modelFingerprint: 'model', title: '测试', extractorVersion: extractor.version });
      const result = await executeRun(deps, 'r');
      assert.equal(result.lostLease, true);
      assert.equal((await h.worldStore.listEntities('w')).length, 0);
      assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM world_jobs WHERE world_id = 'w'").get().n, 0);
    } finally { h.db.close(); }
  }
});

test('M4 scoped mapper exact checkpoint covers frozen model configuration and no publication side effects', async () => {
  const h = await setup();
  try {
    await h.worldStore.createWorld({ worldId: 'w', title: '测试', sourceSha256: sha('source'), sourceBytes: 1, normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready', createdAt: now(), updatedAt: now() });
    await h.worldStore.saveImportedSource('w', { text: '', encoding: 'utf-8', sourceSha256Hex: sha(h.text), sourceByteLength: Buffer.byteLength(h.text), normalizeVersion: 'n', chapterSplitVersion: 'c', splitStrategy: 'standard', codePointCount: h.text.length, chapters: await h.sourceStore.getChapters('src'), chunks: await h.sourceStore.getChunks('src') }, now());
    const data = canon();
    for (const e of data.entities) await h.worldStore.upsertEntity(e, now());
    for (const f of data.facts) await h.worldStore.saveFact(f, now());
    for (const e of data.events) await h.worldStore.saveEvent(e, now());
    let calls = 0;
    const provider = { async complete(request) { calls++; assert.equal(JSON.parse(request.user).facts.length, 20); return { text: JSON.stringify({ skills: [], constraints: [], actorTemplates: [], items: [], lore: [] }) }; } };
    const input = { worldStore: h.worldStore, provider, sha256Hex: sha, worldId: 'w', sourceSha256: sha('source'), mappingVersion: 'mapper-test', createdAt: now(), requirePlayableOpening: true, incrementalMapping: options() };
    const first = await buildPackageDraftFromCanon(input);
    assert.equal(first.selection.facts.length, 20);
    assert.equal((await h.worldStore.listWorldPackages('w')).length, 0);
    await buildPackageDraftFromCanon({ ...input, runId: 'different-run' });
    assert.equal(calls, 1, 'world-local exact mapping checkpoint reusable across segment/run identities');
    await buildPackageDraftFromCanon({ ...input, incrementalMapping: options('opening', { executionConfigFingerprint: 'changed-reasoning-high' }) });
    assert.equal(calls, 2, 'frozen model/reasoning change invalidates exact proposal');
  } finally { h.db.close(); }
});

test('90s opening locally compiles evidenced action closure with zero mapper calls and blocks insufficient/conflicting canon', async () => {
  const h = await setup();
  try {
    await h.worldStore.createWorld({ worldId:'w',title:'测试',sourceSha256:sha('source'),sourceBytes:1,normalizeVersion:'n',chapterSplitVersion:'c',buildStatus:'ready',createdAt:now(),updatedAt:now() });
    await h.worldStore.saveImportedSource('w',{text:'',encoding:'utf-8',sourceSha256Hex:sha(h.text),sourceByteLength:Buffer.byteLength(h.text),normalizeVersion:'n',chapterSplitVersion:'c',splitStrategy:'standard',codePointCount:h.text.length,chapters:await h.sourceStore.getChapters('src'),chunks:await h.sourceStore.getChunks('src')},now());
    const data=canon(24); data.facts[0].value={location:'旧桥'};data.facts[0].predicate='current_location';
    for(const e of data.entities)await h.worldStore.upsertEntity(e,now());
    for(const f of data.facts)await h.worldStore.saveFact(f,now());
    for(const e of data.events)await h.worldStore.saveEvent(e,now());
    let calls=0;const input={worldStore:h.worldStore,provider:{async complete(){calls++;throw Error('must_not_dispatch_mapper')}},sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'opening-local-rules-1',mappingMode:'startup_local',createdAt:now(),requirePlayableOpening:true,incrementalMapping:options('opening',{openingFactLimit:40})};
    const draft=await buildPackageDraftFromCanon(input);
    assert.equal(calls,0);assert.equal(draft.selection.facts.length,24);
    const scene=draft.entries[0];assert.equal(scene.kind,'scene');assert.deepEqual(scene.definition.actors,['actor-canon-hero']);
    const actor=draft.entries.find(e=>e.entryId==='actor-canon-hero');assert.equal(actor.provenance.kind,'explicit');assert.equal(actor.fieldProvenance.attributes.kind,'rule_mapping');assert.deepEqual(actor.definition.attacks,[]);assert.deepEqual(actor.definition.skills,{});
    assert.ok(draft.entries.some(e=>e.kind==='lore' && e.provenance.sourceFactIds.includes('f-0')));
    assert.equal((await h.worldStore.listWorldPackages('w')).length,0);
    const bad={...data.facts[0],factId:'conflict',value:{location:'别处'},status:'conflict'};await h.worldStore.saveFact(bad,now());
    await assert.rejects(buildPackageDraftFromCanon(input),/冲突/);assert.equal(calls,0);
  }finally{h.db.close()}
});

test('event self identity does not create a second fact-store dependency; missing external entity and event dependencies still block',()=>{
 const data=canon(24);data.events[0].eventId='evt-w-occurred';data.entities.push(entity('ent-w-occurred','event',data.events[0].title));
 assert.deepEqual(selectCanonSubset({...data,options:options()}).diagnostics,[]);
 data.events[0].dependsOnEventIds=['evt-missing'];assert.ok(selectCanonSubset({...data,options:options()}).diagnostics.some(x=>x.includes('evt-missing')));
 data.facts[0].value={other:'ent-unsupported'};assert.ok(selectCanonSubset({...data,options:options()}).diagnostics.some(x=>x.includes('ent-unsupported')));
});

test('incremental closure reuses only certified compatible old evidence and does not map unrelated old facts',()=>{
 const data=canon(24),fresh={...data.facts[0],factId:'fresh',value:{location:'place'},sources:[{...data.facts[0].sources[0],startOffset:210,endOffset:217}]};
 const old=data.facts.find(f=>f.subjectEntityId==='place');
 const r=(startCp,endCp)=>({...range,startCp,endCp});
 const scoped=options('incremental',{ranges:[r(200,300)],publishedEvidence:[{sourceFactIds:[old.factId],coverage:[r(0,100)]}]});
 const selected=selectCanonSubset({...data,facts:[...data.facts,fresh],options:scoped});
 assert.deepEqual(selected.diagnostics,[]);assert.deepEqual(new Set(selected.facts.map(f=>f.factId)),new Set(['fresh',old.factId]));
 assert.ok(selectCanonSubset({...data,facts:[...data.facts,fresh],options:{...scoped,publishedEvidence:[]}}).diagnostics.some(x=>x.includes('place')));
 assert.ok(selectCanonSubset({...data,facts:[...data.facts,fresh],options:{...scoped,publishedEvidence:[{sourceFactIds:[old.factId],coverage:[{...r(0,100),normalizedTreeHash:sha('changed')}]}]}}).diagnostics.length);
});

test('immutable entry versioning rewrites nested scene/card/item references and keeps prose',()=>{
 const {remapEntryReferences}=load('application/worldPackage/remapEntryReferences');
 const entry={entryId:'scene',kind:'scene',revision:1,dependencyIds:['actor','item'],definition:{name:'场所',description:'原著原句',actors:['actor'],visibleItems:['item'],zones:[{zoneId:'z',exits:[{toSceneId:'scene'}]}]}};
 const mapped=remapEntryReferences(entry,new Map([['scene','scene-new'],['actor','actor-new'],['item','item-new']]));
 assert.equal(mapped.entryId,'scene-new');assert.deepEqual(mapped.definition.actors,['actor-new']);assert.deepEqual(mapped.definition.visibleItems,['item-new']);assert.equal(mapped.definition.zones[0].exits[0].toSceneId,'scene-new');assert.equal(mapped.definition.description,'原著原句');assert.equal(entry.definition.actors[0],'actor');
});

test('completed nested location checkpoint repairs locally with exact quote validation and a transactional fence',async()=>{
 const h=await setup();try{
  await h.worldStore.createWorld({worldId:'w',title:'测试',sourceSha256:sha('source'),sourceBytes:1,normalizeVersion:'n',chapterSplitVersion:'c',buildStatus:'ready',createdAt:now(),updatedAt:now()});
  await h.worldStore.saveImportedSource('w',{text:'',encoding:'utf-8',sourceSha256Hex:sha(h.text),sourceByteLength:Buffer.byteLength(h.text),normalizeVersion:'n',chapterSplitVersion:'c',splitStrategy:'standard',codePointCount:h.text.length,chapters:await h.sourceStore.getChapters('src'),chunks:await h.sourceStore.getChunks('src')},now());
  await h.worldStore.upsertEntity(entity('ent-w-hero','character','林辰'),now());await h.worldStore.upsertEntity(entity('ent-w-place','location','旧桥'),now());
  const group={entities:[{entityKey:'hero',type:'character',name:'林辰',aliases:[]},{entityKey:'place',type:'location',name:'旧桥',aliases:[]}],facts:[{subjectKey:'hero',predicate:'current_location',value:{current_location:{location:'旧桥'}},status:'explicit',confidence:1,chunkId:'c-0',evidence:{chapterId:'ch-1',startOffset:0,endOffset:7,quote:'林辰抵达旧桥。'}}],events:[],ruleMappings:[],rejectedQuotes:0};
  await h.worldStore.upsertJob({worldId:'w',jobId:'job-extract-request-cached',kind:'extract_chunk',targetId:null,status:'done',attempts:1,contentHash:sha('request'),extractorVersion:'parser#snapshot-proof',modelFingerprint:'model',usageJson:'{}',resultJson:JSON.stringify({version:'extraction-request-1',group}),error:null,createdAt:now(),updatedAt:now()},now());
  const {replayCompletedLocationAdapter}=load('application/worldBuild/replayLocationAdapter');
  const input={worldStore:h.worldStore,sourceStore:h.sourceStore,run:{worldId:'w',sourceId:'src',scopeJson:JSON.stringify({startCp:0,endCp:100}),modelFingerprint:'model',sourceSnapshotHash:'snapshot-proof'},sha256Hex:async text=>sha(text),assertCurrent:async()=>{throw Error('stale_fence')}};
  await assert.rejects(replayCompletedLocationAdapter(input),/stale_fence/);assert.equal((await h.worldStore.listFacts('w')).length,0);
  let guards=0;await replayCompletedLocationAdapter({...input,assertCurrent:async tx=>{assert.equal(tx,h.adapter);guards++;}});
  const facts=await h.worldStore.listFacts('w');assert.equal(facts.length,1);assert.deepEqual(facts[0].value,{location:'旧桥'});assert.equal(facts[0].sources[0].quote,group.facts[0].evidence.quote);assert.equal(guards,1);
  await replayCompletedLocationAdapter({...input,assertCurrent:async()=>{}});assert.equal((await h.worldStore.listFacts('w')).length,1);
  assert.equal((await h.worldStore.getJob('w','job-extract-request-cached')).attempts,1);
 }finally{h.db.close()}
});
