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

async function saveCanon(h, data) {
  await h.worldStore.createWorld({ worldId:'w',title:'合成测试',sourceSha256:sha('source'),sourceBytes:1,
    normalizeVersion:'n',chapterSplitVersion:'c',buildStatus:'ready',createdAt:now(),updatedAt:now() });
  await h.worldStore.saveImportedSource('w',{text:'',encoding:'utf-8',sourceSha256Hex:sha(h.text),sourceByteLength:Buffer.byteLength(h.text),
    normalizeVersion:'n',chapterSplitVersion:'c',splitStrategy:'standard',codePointCount:h.text.length,
    chapters:await h.sourceStore.getChapters('src'),chunks:await h.sourceStore.getChunks('src')},now());
  for (const e of data.entities) await h.worldStore.upsertEntity(e,now());
  for (const f of data.facts) await h.worldStore.saveFact(f,now());
  for (const e of data.events) await h.worldStore.saveEvent(e,now());
}

test('authoritative inference projects new draft roots and inferred places; exact done replay preserves raw cache and canon',async()=>{
  const h=await setup();try{
    const data=canon(20);data.facts[0].status='inference';data.facts[1].status='inference';
    await saveCanon(h,data);
    const evidence={provenanceKind:'explicit',evidenceFactIds:['f-0','f-2']};
    const proposal={skills:[{id:'inferred',name:'合成技能',attribute:'knowledge',...evidence}],
      constraints:[{id:'inferred',name:'合成约束',...evidence}],
      lore:[{id:'inferred',name:'合成资料',text:'有据推断',...evidence},
        {id:'already-inferred',name:'已有推断',text:'保持推断',provenanceKind:'inferred',evidenceFactIds:['f-2']},
        {id:'rule',name:'规则',text:'规则值',provenanceKind:'rule_mapping',evidenceFactIds:['f-0']}],
      actorTemplates:[{id:'inferred',name:'林辰',hp:8,defense:2,...evidence}],
      items:[{id:'inferred',name:'合成物品',...evidence}]};
    let calls=0;
    const input={worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'mapper-test',
      createdAt:now(),incrementalMapping:options(),provider:{async complete(){calls++;return {text:JSON.stringify(proposal),usage:{outputTokens:50}}}}};
    const first=await buildPackageDraftFromCanon(input);
    const cache=h.db.prepare("SELECT * FROM world_jobs WHERE kind='rule_mapping'").all();
    const facts=await h.worldStore.listFacts('w');
    const replay=await buildPackageDraftFromCanon({...input,runId:'cold-recovery',provider:{async complete(){throw Error('must_not_repeat_paid_mapping')}}});
    assert.equal(calls,1);assert.deepEqual(replay.entries,first.entries);
    assert.deepEqual(h.db.prepare("SELECT * FROM world_jobs WHERE kind='rule_mapping'").all(),cache);
    assert.deepEqual(await h.worldStore.listFacts('w'),facts);
    assert.equal(JSON.parse(cache[0].result_json).proposal.actorTemplates[0].provenanceKind,'explicit','raw result retains the model mistake');
    for(const id of ['skill-inferred','constraint-inferred','lore-inferred','npc-inferred','item-inferred','scene-place'])
      assert.equal(replay.entries.find(e=>e.entryId===id).provenance.kind,'inferred',id);
    const actor=replay.entries.find(e=>e.entryId==='npc-inferred');
    for(const p of Object.values(actor.fieldProvenance))assert.equal(p.kind,'rule_mapping');
    assert.equal(replay.entries.find(e=>e.entryId==='lore-already-inferred').provenance.kind,'inferred');
    assert.equal(replay.entries.find(e=>e.entryId==='lore-rule').provenance.kind,'rule_mapping');
    assert.equal(replay.entries.find(e=>e.entryId==='common-guard-template').provenance.kind,'design_fill');
    assert.equal((await h.worldStore.listWorldPackages('w')).length,0);
  }finally{h.db.close()}
});

test('cross-batch identical definitions union inference honestly; differing same-revision definitions require review',async()=>{
  for(const incompatible of [false,true]){
    const h=await setup();try{
      const data=canon(801);data.facts[800].status='inference';await saveCanon(h,data);
      let calls=0;
      const input={worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'mapper-test',createdAt:now(),
        provider:{async complete(){const later=++calls===2;const common={id:'shared',name:'合成条目',provenanceKind:'explicit',evidenceFactIds:[later?'f-800':'f-0']};
          const description=incompatible&&later?'不同定义':'相同定义';
          return {text:JSON.stringify({skills:[{...common,attribute:'knowledge',description}],constraints:[],
            lore:[{...common,text:description}],actorTemplates:[{...common,hp:8,defense:2,description,
              attributes:later?{agility:2,knowledge:1}:{knowledge:1,agility:2}}],
            items:[{...common,description}]})};}}};
      const first=await buildPackageDraftFromCanon(input);
      const raw=h.db.prepare("SELECT * FROM world_jobs WHERE kind='rule_mapping' ORDER BY job_id").all();
      const replay=await buildPackageDraftFromCanon({...input,provider:{async complete(){throw Error('must_reuse_batches')}}});
      assert.equal(calls,2);assert.deepEqual(replay.entries,first.entries);
      assert.deepEqual(h.db.prepare("SELECT * FROM world_jobs WHERE kind='rule_mapping' ORDER BY job_id").all(),raw);
      for(const id of ['skill-shared','lore-shared','npc-shared','item-shared']){
        const p=replay.entries.find(e=>e.entryId===id).provenance;
        assert.deepEqual(p.sourceFactIds,incompatible?['f-0']:['f-0','f-800']);
        assert.equal(p.kind,incompatible?'explicit':'inferred');
      }
      const reviews=await h.worldStore.listReviewIssues('w','open');
      assert.equal(reviews.filter(r=>r.issueId.startsWith('invalid-proposal-conflict-')).length,incompatible?4:0);
    }finally{h.db.close()}
  }
});

test('recovered extraction uses current fenced units, not historical failure attempts',async()=>{
  const h=await setup();try{
    const {isRunExtractionComplete}=load('application/worldBuild/buildProgress');
    await createExtractionRun({...h,sha256Hex:sha,now}, {runId:'retry-count',worldId:'w',sourceId:'src',modelFingerprint:'m',title:'合成测试',extractorVersion:'e',scope:{startCp:0,endCp:100}});
    const [unit]=await h.runStore.listUnits('retry-count');
    const token=await h.runStore.acquireLease('retry-count','owner',30000,now());
    await h.runStore.completeUnit({unitId:unit.unitId,fencingToken:token,status:'failed_retryable',now:now()});
    assert.equal(isRunExtractionComplete(await h.runStore.getRun('retry-count'),await h.runStore.listUnits('retry-count')),false);
    await h.runStore.completeUnit({unitId:unit.unitId,fencingToken:token,status:'completed',now:now()});
    const recovered=await h.runStore.getRun('retry-count');assert.equal(recovered.unitsFailed,1);
    const units=await h.runStore.listUnits('retry-count');assert.equal(isRunExtractionComplete(recovered,units),true);
    assert.equal(isRunExtractionComplete(recovered,[]),false);
    assert.equal(isRunExtractionComplete(recovered,[{status:'needs_review'}]),false);
    assert.equal(isRunExtractionComplete({...recovered,unitsTotal:0,unitsDone:0},[]),false);
    assert.equal(await h.runStore.completeUnit({unitId:unit.unitId,fencingToken:token+1,status:'completed',now:now()}),false);
    assert.equal((await h.runStore.getRun('retry-count')).unitsDone,1);
  }finally{h.db.close()}
});

test('split and calibrated replanning retain canceled audit rows without blocking completed effective work',async()=>{
  const {isRunExtractionComplete}=load('application/worldBuild/buildProgress');
  for(const mode of ['split','replan']){
    const h=await setup();try{
      const runId=`effective-${mode}`;
      await createExtractionRun({...h,sha256Hex:sha,now},{runId,worldId:'w',sourceId:'src',modelFingerprint:'m',title:'合成测试',extractorVersion:'e',scope:{startCp:0,endCp:100}});
      const [parent]=await h.runStore.listUnits(runId);
      const token=await h.runStore.acquireLease(runId,'owner',30000,now());
      const children=[0,1].map(i=>({...parent,unitId:`${parent.unitId}-${i}`,inputHash:sha(`${parent.inputHash}-${i}`),unitIndex:i+1,status:'queued',attempts:0}));
      const replaced=mode==='split'
        ? await h.runStore.replaceUnitWithChildren({unitId:parent.unitId,fencingToken:token,children,now:now()})
        : await h.runStore.replaceUnclaimedUnits({runId,fencingToken:token,units:children,now:now()});
      assert.equal(replaced,true);assert.equal((await h.runStore.getRun(runId)).unitsTotal,2);
      const check=async()=>isRunExtractionComplete(await h.runStore.getRun(runId),await h.runStore.listUnits(runId));
      assert.equal(await check(),false);
      await h.runStore.completeUnit({unitId:children[0].unitId,fencingToken:token,status:'completed',now:now()});
      assert.equal(await check(),false,'one unfinished child cannot be hidden by a canceled parent');
      await h.runStore.completeUnit({unitId:children[1].unitId,fencingToken:token,status:'completed',now:now()});
      assert.equal(await check(),true);
      const units=await h.runStore.listUnits(runId);
      assert.equal(units.length,3);assert.equal(units.find(u=>u.unitId===parent.unitId).status,'canceled');
      assert.equal(isRunExtractionComplete({...await h.runStore.getRun(runId),unitsDone:1},units),false);
      assert.equal(isRunExtractionComplete({...await h.runStore.getRun(runId),unitsTotal:3},units),false);
    }finally{h.db.close()}
  }
});

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
    const getJob=h.worldStore.getJob.bind(h.worldStore);let stale=true;
    const saved=h.db.prepare("SELECT * FROM world_jobs WHERE kind='rule_mapping'").get();
    h.worldStore.getJob=async(world,id)=>{if(stale && id===saved.job_id){stale=false;return null;}return getJob(world,id)};
    await buildPackageDraftFromCanon({...input,runId:'stale-observer'});
    assert.equal(calls,1,'atomic preparation returns a concurrently completed proposal rather than sending again');
    assert.deepEqual(h.db.prepare('SELECT * FROM world_jobs WHERE job_id=?').get(saved.job_id),saved,'done payload and usage remain immutable to stale pending writes');
    h.worldStore.getJob=getJob;
    await buildPackageDraftFromCanon({ ...input, incrementalMapping: options('opening', { executionConfigFingerprint: 'changed-reasoning-high' }) });
    assert.equal(calls, 2, 'frozen model/reasoning change invalidates exact proposal');
  } finally { h.db.close(); }
});

test('compatible done checkpoints retain proposal/usage through stale pending writes; changed configuration stays writable',async()=>{
  const h=await setup();try {
    await h.worldStore.createWorld({worldId:'w',title:'测试',sourceSha256:sha('source'),sourceBytes:1,normalizeVersion:'n',chapterSplitVersion:'c',buildStatus:'ready',createdAt:now(),updatedAt:now()});
    const done={worldId:'w',jobId:'shared',kind:'rule_mapping',targetId:null,status:'done',attempts:1,contentHash:'hash',extractorVersion:'mapper-1',modelFingerprint:'fp',usageJson:'{"output":40}',resultJson:'{"proposal":{"lore":[]}}',error:null,createdAt:now(),updatedAt:now()};
    await h.worldStore.upsertJob(done,now());
    const pending={...done,status:'pending',attempts:2,usageJson:null,resultJson:null};
    await h.worldStore.upsertJob(pending,now());assert.deepEqual(await h.worldStore.getJob('w','shared'),done);
    assert.deepEqual(await h.worldStore.prepareMappingJob(pending,now()),done);
    const changed={...pending,contentHash:'changed'};
    assert.equal((await h.worldStore.prepareMappingJob(changed,now())).status,'pending');
    assert.equal((await h.worldStore.getJob('w','shared')).contentHash,'changed');
  }finally{h.db.close()}
});

test('mapping interruption retains its exact existing checkpoint identity before any proposal or publication',async()=>{
  const h=await setup();try {
    await h.worldStore.createWorld({worldId:'w',title:'测试',sourceSha256:sha('source'),sourceBytes:1,normalizeVersion:'n',chapterSplitVersion:'c',buildStatus:'ready',createdAt:now(),updatedAt:now()});
    await h.worldStore.saveImportedSource('w',{text:'',encoding:'utf-8',sourceSha256Hex:sha(h.text),sourceByteLength:Buffer.byteLength(h.text),normalizeVersion:'n',chapterSplitVersion:'c',splitStrategy:'standard',codePointCount:h.text.length,chapters:await h.sourceStore.getChapters('src'),chunks:await h.sourceStore.getChunks('src')},now());
    const data=canon(20);for(const e of data.entities)await h.worldStore.upsertEntity(e,now());
    for(const f of data.facts)await h.worldStore.saveFact(f,now());for(const e of data.events)await h.worldStore.saveEvent(e,now());
    let identity;
    await assert.rejects(buildPackageDraftFromCanon({worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'mapper-test',createdAt:now(),requirePlayableOpening:true,incrementalMapping:options(),
      provider:{async complete(request){identity=request.logicalRequestId.split(':').slice(2).join(':');
        const job=await h.worldStore.getJob('w',identity);assert.equal(job.status,'pending');assert.equal(job.resultJson,null);
        throw new Error('synthetic_sent_disconnect');}}}),/synthetic_sent_disconnect/);
    assert.equal((await h.worldStore.getJob('w',identity)).status,'pending');
    assert.equal((await h.worldStore.listWorldPackages('w')).length,0);
  } finally {h.db.close()}
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
    await assert.rejects(buildPackageDraftFromCanon(input),/Canon blocking conflict/);assert.equal(calls,0);
    const issue=(await h.worldStore.listReviewIssues('w','open')).find(i=>i.issueId==='canon-conflict');
    assert.equal(issue.kind,'canon_conflict');assert.equal(issue.severity,'blocking');assert.deepEqual(JSON.parse(issue.detailJson).factIds,['conflict']);
    await assert.rejects(h.worldStore.resolveReviewIssue('w','canon-conflict','waived'),/逐条核对/);
    await h.worldStore.resolveCanonFactConflict('w','conflict','unverified');
    const recovered=await buildPackageDraftFromCanon(input);assert.equal(calls,0);assert.equal(recovered.selection.facts.length,24);
    assert.ok(!recovered.entries.some(e=>e.provenance.sourceFactIds.includes('conflict')),'unverified evidence never becomes playable content');
  }finally{h.db.close()}
});
test('review writer rolls back guard side effects and creates no blocker after a fence rejection',async()=>{
  const h=await setup();try {
    await h.worldStore.createWorld({worldId:'w',title:'测试',sourceSha256:sha('source'),sourceBytes:1,normalizeVersion:'n',chapterSplitVersion:'c',buildStatus:'ready',createdAt:now(),updatedAt:now()});
    await assert.rejects(h.worldStore.saveReviewIssue({worldId:'w',issueId:'canon-conflict',kind:'canon_conflict',severity:'blocking',detailJson:'{"factIds":["conflict"]}',createdAt:now()},
      async tx=>{await tx.execute('UPDATE worlds SET title=? WHERE world_id=?',['late change','w']);throw Error('synthetic_fence_lost')}),/synthetic_fence_lost/);
    assert.equal((await h.worldStore.getWorld('w')).title,'测试');
    assert.equal((await h.worldStore.listReviewIssues('w','open')).length,0);
    await assert.rejects(h.worldStore.saveReviewIssue({worldId:'w',issueId:'canon-conflict',kind:'canon_conflict',severity:'blocking',detailJson:'{"factIds":["already-resolved"]}',createdAt:now(),canonConflictFactIds:['already-resolved']}),/canon_conflict_changed/);
    assert.equal((await h.worldStore.listReviewIssues('w','open')).length,0,'stale resolved facts cannot reopen a blocking review');
    assert.equal((await h.worldStore.listWorldPackages('w')).length,0);
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

test('scoped publication preserves inferred named-item evidence without promoting restraint or borrowing out-of-range facts',async()=>{
 const h=await setup();try{
  await h.worldStore.createWorld({worldId:'w',title:'测试',sourceSha256:sha('source'),sourceBytes:1,normalizeVersion:'n',chapterSplitVersion:'c',buildStatus:'ready',createdAt:now(),updatedAt:now()});
  await h.worldStore.saveImportedSource('w',{text:'',encoding:'utf-8',sourceSha256Hex:sha(h.text),sourceByteLength:Buffer.byteLength(h.text),normalizeVersion:'n',chapterSplitVersion:'c',splitStrategy:'standard',codePointCount:h.text.length,chapters:await h.sourceStore.getChapters('src'),chunks:await h.sourceStore.getChunks('src')},now());
  const data=canon(24),item=entity('ent-lock','item','神罚之锁');
  data.facts[0].predicate='current_location';data.facts[0].value={location:'旧桥'};
  data.entities.push(item);
  const restraint={...fact('restraint','hero',{item:'神罚之锁'}),status:'inference',confidence:0.85,
   sources:[{chapterId:'ch-1',startOffset:30,endOffset:42,quote:'即使她被神罚之锁困住',quoteSha256:sha('即使她被神罚之锁困住')}]};
  data.facts.push(restraint);
  for(const e of data.entities)await h.worldStore.upsertEntity(e,now());
  for(const f of data.facts)await h.worldStore.saveFact(f,now());
  for(const e of data.events)await h.worldStore.saveEvent(e,now());
  let calls=0;const input={worldStore:h.worldStore,provider:{async complete(){calls++;throw Error('Unexpected paid mapping');}},sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'local',mappingMode:'startup_local',createdAt:now(),requirePlayableOpening:true,incrementalMapping:options('opening',{openingFactLimit:40})};
  const draft=await buildPackageDraftFromCanon(input);
  const mention=draft.selection.facts.find(f=>f.subjectEntityId===item.entityId);
  assert.ok(mention,'quoted item dependency closes despite inferred restraint');
  assert.equal(mention.status,'inference');assert.equal(mention.confidence,0.85);
  assert.deepEqual(mention.value,{mention:'神罚之锁'});
  assert.equal((await h.worldStore.listFacts('w')).find(f=>f.factId==='restraint').status,'inference');
  assert.equal(calls,0);assert.equal((await h.worldStore.listWorldPackages('w')).length,0);
  const narrower={...input,incrementalMapping:options('incremental',{ranges:[{...range,startCp:20,endCp:28}]})};
  await assert.rejects(buildPackageDraftFromCanon(narrower),/缺少当前开局可用的地点证据/);
  assert.equal(calls,0,'no out-of-range inference becomes paid mapping context');
 }finally{h.db.close()}
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

test('user pause landing mid-flight mapping keeps the settled batch checkpoint; resume replays cache without a repeat paid call',async()=>{
 const h=await setup();try{
  const data=canon(20);await saveCanon(h,data);
  const evidence={provenanceKind:'explicit',evidenceFactIds:['f-0','f-2']};
  const proposal={skills:[{id:'s',name:'合成技能',attribute:'knowledge',...evidence}],
   constraints:[],lore:[{id:'l',name:'合成资料',text:'已发布描述',...evidence}],actorTemplates:[],items:[]};
  let calls=0;let signalArrived;const inFlight=new Promise(r=>signalArrived=r);
  const signal={aborted:false};
  const input={worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'mapper-pause',
   createdAt:now(),incrementalMapping:options(),signal,
   provider:{async complete(){calls++;signalArrived();await new Promise(r=>setTimeout(r,25));return {text:JSON.stringify(proposal),usage:{outputTokens:50}}}}};
  const attempt=buildPackageDraftFromCanon(input);
  await inFlight;signal.aborted=true;
  await assert.rejects(attempt,/canceled/);
  const job=h.db.prepare("SELECT * FROM world_jobs WHERE kind='rule_mapping'").get();
  assert.ok(job,'mapping job row exists');
  assert.equal(job.status,'done','a fully received, ledger-settled response must reach its done cache before the pause');
  assert.ok(JSON.parse(job.result_json).proposal);
  const resumed=await buildPackageDraftFromCanon({...input,runId:'pause-resume',signal:{aborted:false},
   provider:{async complete(){throw Error('must_not_repeat_paid_mapping')}}});
  assert.equal(calls,1,'resume replays the done cache; exactly one paid mapping call across pause/resume');
  assert.ok(resumed.entries.length>0);
 }finally{h.db.close()}
});

test('stale fence landing mid-flight mapping keeps the settled batch checkpoint; resume replays cache',async()=>{
 const h=await setup();try{
  const data=canon(20);await saveCanon(h,data);
  const evidence={provenanceKind:'explicit',evidenceFactIds:['f-0','f-2']};
  const proposal={skills:[],constraints:[],lore:[{id:'l',name:'合成资料',text:'已发布描述',...evidence}],actorTemplates:[],items:[]};
  let calls=0;let signalArrived;const inFlight=new Promise(r=>signalArrived=r);
  const input={worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'mapper-stale',
   createdAt:now(),incrementalMapping:options(),
   assertCurrent:async()=>{if(stale)throw Error('stale_segment_execution');},
   provider:{async complete(){calls++;signalArrived();await new Promise(r=>setTimeout(r,25));return {text:JSON.stringify(proposal),usage:{outputTokens:50}}}}};
  let stale=false;
  const attempt=buildPackageDraftFromCanon(input);
  await inFlight;stale=true;
  await assert.rejects(attempt,/stale_segment_execution/);
  const job=h.db.prepare("SELECT * FROM world_jobs WHERE kind='rule_mapping'").get();
  assert.equal(job.status,'done','the lease check runs at the batch boundary, after the checkpoint write');
  assert.ok(JSON.parse(job.result_json).proposal);
  const resumed=await buildPackageDraftFromCanon({...input,runId:'stale-resume',assertCurrent:async()=>{},
   provider:{async complete(){throw Error('must_not_repeat_paid_mapping');}}});
  assert.equal(calls,1);assert.ok(resumed.entries.length>0);
 }finally{h.db.close()}
});

function closureSituation(id, locationId, participantIds) {
  return {id,title:'旧桥上的新问题',summary:'桥头出现了新的动静。',gmBrief:'仅使用已核验的人物与资料。',locationId,participantIds,
    activation:{kind:'world_time_at_least',order:1},provenanceKind:'design_fill',evidenceFactIds:['f-0'],methods:[
      {id:'look',title:'检查现场',goal:'了解变化',firstStep:{intent:'查看桥头现场',actionKind:'observe'},requires:{}},
      {id:'ask',title:'询问来往的人',goal:'了解消息',firstStep:{intent:'询问来往的人最近的情况',actionKind:'talk'},requires:{}}]};
}

test('world closure: invalid merged predecessor definitions cannot retire an otherwise resolved-looking situation issue', async () => {
  const h=await setup();
  try {
    await saveCanon(h,canon(20)); const id='situation-dangling-situation-final-gate';
    await h.worldStore.saveReviewIssue({worldId:'w',issueId:id,kind:'situation_dangling_reference',severity:'major',detailJson:'{}',createdAt:now()});
    const invalid=entry('skill-invalid',[],[]); invalid.kind='skill'; invalid.definition={name:'无效技能',attribute:'unsupported',allowUntrained:'not-boolean'};
    await assert.rejects(buildPackageDraftFromCanon({worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'closure-final-gate',createdAt:now(),
      incrementalMapping:options('incremental',{previousEntries:[invalid]}),provider:{async complete(){return {text:JSON.stringify({situations:[closureSituation('final-gate','旧桥',[])]})}}}}),/校验失败/);
    assert.equal((await h.worldStore.listReviewIssues('w','all')).find(i=>i.issueId===id).status,'open');
  }finally{h.db.close();}
});

test('world closure: an unknown location remains dangling and cannot fall back to the default scene',async()=>{
  const h=await setup();
  try{
    await saveCanon(h,canon(20));
    const draft=await buildPackageDraftFromCanon({worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'closure-unknown-location',createdAt:now(),incrementalMapping:options(),
      provider:{async complete(){return {text:JSON.stringify({situations:[closureSituation('absent','不存在的地点',[])]})}}}});
    assert.equal(draft.entries.some(e=>e.entryId==='situation-absent'),false);
    const issue=(await h.worldStore.listReviewIssues('w')).find(i=>i.issueId==='situation-dangling-situation-absent');
    assert.ok(issue); assert.ok(JSON.parse(issue.detailJson).dangling.includes('不存在的地点'));
  }finally{h.db.close();}
});

test('world closure: an incremental actor keeps a real immutable predecessor item in its loot references',async()=>{
  const h=await setup();
  try{
    await saveCanon(h,canon(20));
    const base=await buildPackageDraftFromCanon({worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'closure-loot-old',createdAt:now(),incrementalMapping:options(),
      provider:{async complete(){return {text:JSON.stringify({items:[{id:'old-token',name:'旧信物',provenanceKind:'rule_mapping',evidenceFactIds:['f-1']}]})}}}});
    const draft=await buildPackageDraftFromCanon({worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'closure-loot-new',createdAt:now(),incrementalMapping:options('incremental',{previousEntries:base.entries}),
      provider:{async complete(){return {text:JSON.stringify({actorTemplates:[{id:'new-hero',name:'林辰',hp:8,defense:2,lootItemIds:['item-old-token'],provenanceKind:'rule_mapping',evidenceFactIds:['f-0']}]})}}}});
    const actor=draft.entries.find(e=>e.entryId==='npc-new-hero'); assert.deepEqual(actor.definition.lootItemIds,['item-old-token']);
    assert.ok(actor.dependencyIds.includes('item-old-token'));
    assert.equal((await h.worldStore.listReviewIssues('w')).some(i=>i.issueId.includes('template_loot')),false);
  }finally{h.db.close();}
});

test('world closure: an unknown required knowledge gate is rejected instead of silently removed', async () => {
  const h = await setup();
  try {
    await saveCanon(h,canon(20));
    const raw=closureSituation('unknown-gate','scene-place',[]); raw.methods[0].requires={knowledgeEntryId:'lore-not-published'};
    const draft=await buildPackageDraftFromCanon({worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'closure-required',createdAt:now(),incrementalMapping:options(),
      provider:{async complete(){return {text:JSON.stringify({situations:[raw]})}}}});
    assert.equal(draft.entries.some(e=>e.entryId==='situation-unknown-gate'),false);
    assert.ok((await h.worldStore.listReviewIssues('w')).some(i=>i.detailJson.includes('requires unknown knowledge')));
  } finally {h.db.close();}
});

test('world closure: a stale dependency issue remains open when the run loses authority before the validated draft is admitted', async () => {
  const h=await setup();
  try {
    await saveCanon(h,canon(20));
    const id='situation-dangling-situation-fenced';
    await h.worldStore.saveReviewIssue({worldId:'w',issueId:id,kind:'situation_dangling_reference',severity:'major',detailJson:'{}',createdAt:now()});
    let responseReceived=false;
    await assert.rejects(buildPackageDraftFromCanon({worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'closure-fenced',createdAt:now(),incrementalMapping:options(),
      assertCurrent:async()=>{if(responseReceived)throw Error('fence expired');},provider:{async complete(){responseReceived=true;return {text:JSON.stringify({situations:[closureSituation('fenced','旧桥',[])]})}}}}),/fence expired/);
    assert.equal((await h.worldStore.listReviewIssues('w','all')).find(i=>i.issueId===id).status,'open');
  } finally {h.db.close();}
});

test('world closure: a canonical location name resolves to its scene dependency without rewriting runtime location', async () => {
  const h = await setup();
  try {
    await saveCanon(h, canon(20));
    const input = { worldStore:h.worldStore, sha256Hex:sha, worldId:'w', sourceSha256:sha('source'), mappingVersion:'closure-location', createdAt:now(), incrementalMapping:options(),
      provider:{async complete(){return {text:JSON.stringify({situations:[closureSituation('old-bridge','旧桥',[])]})}}} };
    const draft = await buildPackageDraftFromCanon(input);
    const situation = draft.entries.find(e => e.entryId === 'situation-old-bridge');
    assert.ok(situation, 'an evidenced scene exists for the runtime location name');
    assert.equal(situation.definition.locationId, '旧桥');
    assert.ok(situation.dependencyIds.includes('scene-place'));
    assert.equal(situation.dependencyIds.includes('旧桥'), false);
  } finally { h.db.close(); }
});

for (const ref of ['旧桥', 'place', 'scene-place']) test(`world location references: ${ref} compiles to the same runtime coordinate and certified scene`, async () => {
  const h=await setup();try {
    await saveCanon(h,canon(20));
    const raw=closureSituation('location-identity',ref,[]);
    raw.activation={kind:'all',of:[{kind:'world_time_at_least',order:1},{kind:'actor_at',actorId:'player',locationId:ref}]};
    raw.knowledgeCondition={kind:'actor_at',actorId:'player',locationId:ref};
    raw.methods[0].firstStep={intent:'前往桥头查看现场',actionKind:'move',destinationId:ref};
    const input={worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'location-identity',createdAt:now(),incrementalMapping:options(),
      provider:{async complete(){return {text:JSON.stringify({situations:[raw]})}}}};
    const draft=await buildPackageDraftFromCanon(input),s=draft.entries.find(e=>e.entryId==='situation-location-identity');
    assert.ok(s,'all location spellings must resolve through an evidenced scene');
    assert.equal(s.definition.locationId,'旧桥');
    assert.equal(s.definition.activation.of[1].locationId,'旧桥');
    assert.equal(s.definition.knowledgeCondition.locationId,'旧桥');
    assert.equal(s.definition.methods[0].firstStep.destinationId,'旧桥');
    assert.deepEqual(s.dependencyIds,['scene-place']);
    const {evaluateCondition}=load('domain/situations/conditions');
    assert.deepEqual(evaluateCondition(s.definition.activation,{actorLocation:()=> '旧桥',causalWorldTimeOrder:1}),{value:true,unknown:false});
    assert.equal((await h.worldStore.listReviewIssues('w')).length,0);
    const cache=h.db.prepare("SELECT result_json FROM world_jobs WHERE kind='rule_mapping'").all();
    const again=await buildPackageDraftFromCanon({...input,provider:{async complete(){throw Error('paid mapping must be reused');}}});
    assert.deepEqual(again.entries,draft.entries);
    assert.deepEqual(h.db.prepare("SELECT result_json FROM world_jobs WHERE kind='rule_mapping'").all(),cache);
  } finally {h.db.close();}
});

test('world location references: unknown movement destinations and condition locations keep the situation out of publication',async()=>{
  for(const field of ['movement','condition']){
    const h=await setup();try{
      await saveCanon(h,canon(20));const raw=closureSituation('bad-location','旧桥',[]);
      if(field==='movement')raw.methods[0].firstStep={intent:'前往不存在的地点',actionKind:'move',destinationId:'unproved-place'};
      else raw.activation={kind:'actor_at',actorId:'player',locationId:'unproved-place'};
      const draft=await buildPackageDraftFromCanon({worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'bad-location',createdAt:now(),incrementalMapping:options(),
        provider:{async complete(){return {text:JSON.stringify({situations:[raw]})}}}});
      assert.equal(draft.entries.some(e=>e.entryId==='situation-bad-location'),false);
      const issue=(await h.worldStore.listReviewIssues('w')).find(i=>i.kind==='situation_dangling_reference');
      assert.ok(issue);assert.ok(JSON.parse(issue.detailJson).dangling.includes('unproved-place'));
    } finally {h.db.close();}
  }
});

test('location condition coordinates accept Unicode names while malformed locations and actor identifiers remain invalid',()=>{
  const {validateConditionShape}=load('domain/situations/conditions');
  for(const locationId of ['旧桥','中央广场 一层','ent-bridge']){
    const errors=[];validateConditionShape({kind:'actor_at',actorId:'player',locationId},errors);assert.deepEqual(errors,[]);
  }
  for(const locationId of ['', '  ', null, 4, {}, []]){
    const errors=[];validateConditionShape({kind:'actor_at',actorId:'player',locationId},errors);assert.ok(errors.length);
  }
  const errors=[];validateConditionShape({kind:'actor_at',actorId:'not an actor id',locationId:'旧桥'},errors);
  assert.ok(errors.some(e=>e.includes('actorId')));
});

test('world closure: incremental situations retain certified predecessor actors, skills and knowledge; only the proved stale issue is resolved', async () => {
  const h = await setup();
  try {
    await saveCanon(h, canon(20));
    const first = await buildPackageDraftFromCanon({worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'closure-previous',createdAt:now(),incrementalMapping:options(),
      provider:{async complete(){return {text:JSON.stringify({actorTemplates:[{id:'old-hero',name:'林辰',hp:8,defense:2,provenanceKind:'rule_mapping',evidenceFactIds:['f-1']}],
        skills:[{id:'old-skill',name:'旧桥辨迹',attribute:'insight',provenanceKind:'rule_mapping',evidenceFactIds:['f-1']}],
        lore:[{id:'old-clue',name:'桥头记号',text:'已经查证的记号',provenanceKind:'explicit',evidenceFactIds:['f-1']}]})}}} });
    const previous = first.entries;
    const previousJson = JSON.stringify(previous);
    const raw = closureSituation('return-bridge','旧桥',['hero']);
    raw.methods[0].firstStep = {intent:'辨认桥头的旧记号',actionKind:'skill_check',skillId:'skill-old-skill',targetId:'hero'};
    raw.methods[0].requires = {skillId:'skill-old-skill',knowledgeEntryId:'lore-old-clue'};
    await h.worldStore.saveReviewIssue({worldId:'w',issueId:'situation-dangling-situation-return-bridge',kind:'situation_dangling_reference',severity:'major',detailJson:'{}',createdAt:now()});
    await h.worldStore.saveReviewIssue({worldId:'w',issueId:'situation-dangling-situation-unrelated',kind:'situation_dangling_reference',severity:'major',detailJson:'{}',createdAt:now()});
    const delta = {worldId:'w',factIds:['f-0'],entityIds:[],eventIds:[],canonSnapshotHash:sha('delta'),executionConfigFingerprint:'frozen-model-low'};
    const draft = await buildPackageDraftFromCanon({worldStore:h.worldStore,sha256Hex:sha,worldId:'w',sourceSha256:sha('source'),mappingVersion:'closure-incremental',createdAt:now(),
      incrementalMapping:options('incremental',{previousEntries:previous,delta}),provider:{async complete(){return {text:JSON.stringify({situations:[raw]})}}} });
    const situation = draft.entries.find(e=>e.entryId==='situation-return-bridge');
    assert.ok(situation, 'references to immutable compatible previous entries remain in closure');
    assert.deepEqual(situation.definition.participantEntryIds, ['npc-old-hero']);
    assert.equal(situation.definition.methods[0].firstStep.targetEntryId,'npc-old-hero');
    assert.equal(situation.definition.methods[0].requires.knowledgeEntryId,'lore-old-clue');
    for (const dependency of ['npc-old-hero','skill-old-skill','lore-old-clue','scene-place']) assert.ok(situation.dependencyIds.includes(dependency),dependency);
    const issues = await h.worldStore.listReviewIssues('w','all');
    assert.equal(issues.find(i=>i.issueId==='situation-dangling-situation-return-bridge').status,'resolved');
    assert.equal(issues.find(i=>i.issueId==='situation-dangling-situation-unrelated').status,'open');
    assert.equal(JSON.stringify(previous),previousJson,'no predecessor entry is rewritten');
  } finally { h.db.close(); }
});
