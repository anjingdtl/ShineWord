// 1M resident build P4 regression suite: rule mappings flow through the
// PRODUCTION extract->commit path (T5) - target resolution, verbatim
// evidence verification, stable idempotent mappingIds in the SAME chunk
// transaction - replays never inflate rows (T4), and honesty gates stay
// tight (T8): tampered quotes are still dropped and evidence-less mappings
// are rejected instead of sneaking in as design_fill.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteSourceStore } = require('../dist/infra/sqlite/sqliteSourceStore');
const { SqliteBuildRunStore } = require('../dist/infra/sqlite/sqliteBuildRunStore');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { importTxtSourceStreaming } = require('../dist/application/import/streamingTxtImport');
const { applyExtraction, ruleMappingIdFor } = require('../dist/application/world/extraction');
const {
  createExtractionRun,
  executeRun,
} = require('../dist/application/worldBuild/coordinator');
const { FixtureExtractor } = require('./fixtures/fixtureExtractor.cjs');

class NodeSqliteAdapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const run = () => {
      this.db.exec('BEGIN IMMEDIATE');
      return work(this).then(
        value => { this.db.exec('COMMIT'); return value; },
        error => { this.db.exec('ROLLBACK'); throw error; },
      );
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
}

const sha = {
  async sha256BytesHex(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); },
  async sha256Hex(input) { return crypto.createHash('sha256').update(input, 'utf8').digest('hex'); },
};

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

const decoderGlobal = new TextDecoder('utf-8');

async function prepareSource(db) {
  const store = new SqliteSourceStore(new NodeSqliteAdapter(db));
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-medium.txt'));
  const source = {
    encoding: 'utf-8',
    rawSha256Hex: crypto.createHash('sha256').update(bytes).digest('hex'),
    get byteLength() { return bytes.length; },
    async readText(offset, maxBytes) {
      const end = Math.min(offset + maxBytes, bytes.length);
      return { text: decoderGlobal.decode(bytes.subarray(offset, end), { stream: end < bytes.length }), nextByteOffset: end, atEof: end >= bytes.length };
    },
  };
  const now = '2026-09-28T12:00:00.000Z';
  await store.beginStaging({
    sourceId: 'src-p4', rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
    codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
    chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
    splitStrategy: 'standard', fileName: 'novel-medium.txt', title: null,
    status: 'staging', createdAt: now, updatedAt: now,
  });
  const result = await importTxtSourceStreaming(source, store, 'src-p4', {
    sha256Hex: sha.sha256Hex, sha256BytesHex: sha.sha256BytesHex,
  });
  await store.activateSource({
    manifest: {
      sourceId: 'src-p4', rawSha256Hex: result.rawSha256Hex, normalizedTreeHash: result.normalizedTreeHash,
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: result.byteLength,
      codePointCount: result.codePointCount, encoding: result.encoding,
      normalizeVersion: result.normalizeVersion, chapterSplitVersion: result.chapterSplitVersion,
      normalizeShardScheme: result.normalizeShardScheme, splitStrategy: result.splitStrategy,
      fileName: 'novel-medium.txt', title: null, status: 'active', createdAt: now, updatedAt: now,
    },
    chapters: result.chapters, chunks: result.chunks,
  });
  return { store, result };
}

function fixtureNames() {
  const small = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-small.json'), 'utf8'));
  const medium = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-medium.json'), 'utf8'));
  const names = new Set();
  for (const fact of [...small.facts, ...medium.facts]) {
    names.add(fact.subject);
    if (typeof fact.value.person === 'string') names.add(fact.value.person);
  }
  return [...names];
}

const WINDOWED_BUDGET = {
  contextWindowTokens: 60_000,
  maxContentOutputTokens: 8_000,
  reasoningReserveTokens: 0,
  reasoningEffort: 'off',
  supportsPromptCache: false,
  reserveTokens: 2_000,
};

/**
 * Production-shaped group extractor over the fixture, additionally proposing
 * ruleMappings of every honesty class: a legit skill mapping citing a real
 * verbatim quote, an unknown-target mapping, and a mapping citing an
 * invented quote that exists nowhere in the book.
 */
function mappingGroupExtractor() {
  const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
  return {
    version: 'llm-group-extractor-1',
    calls: 0,
    async extract({ segments }) {
      this.calls += 1;
      const entities = new Map();
      const facts = [];
      const events = [];
      for (const segment of segments) {
        const perChunk = await fixture.extract({
          chunk: {
            chunkId: segment.chunkId, chapterId: segment.chapterId, chunkIndex: 0,
            startOffset: segment.startCp, endOffset: segment.startCp + [...segment.text].length,
            charCount: [...segment.text].length, contentHash: 'x',
          },
          chunkText: segment.text,
          worldId: 'w',
        });
        for (const entity of perChunk.entities) entities.set(entity.entityKey, entity);
        for (const fact of perChunk.facts) facts.push({ ...fact, chunkId: segment.chunkId });
        for (const event of perChunk.events) events.push({ ...event, chunkId: segment.chunkId });
      }
      // Deterministic verbatim fact at the head of the FIRST segment: the
      // quote and span are real, so checkEvidence must accept it and the
      // verified-evidence mapping below must survive.
      const head = segments[0];
      const cpLen = Math.min(12, [...head.text].length);
      const quote = [...head.text].slice(0, cpLen).join('');
      entities.set('陈青云', { entityKey: '陈青云', type: 'character', name: '陈青云' });
      facts.unshift({
        subjectKey: '陈青云', predicate: 'signature', value: { note: 'deterministic head fact' },
        status: 'explicit', confidence: 1,
        evidence: {
          chapterId: head.chapterId,
          startOffset: head.startCp,
          endOffset: head.startCp + cpLen,
          quote,
        },
        chunkId: head.chunkId,
      });
      return {
        entities: [...entities.values()],
        facts,
        events,
        ruleMappings: [
          { targetKey: '陈青云', mappingKind: 'skill', mapping: { skillId: 'sword', rank: 'trained' }, evidenceRefs: [quote] },
          { targetKey: '陈青云', mappingKind: 'skill', mapping: { skillId: 'shadow-step' }, evidenceRefs: ['这句引文在书里根本不存在。'] },
          { targetKey: '神秘未见者', mappingKind: 'attribute', mapping: { attribute: 'physique' }, evidenceRefs: [quote] },
          { targetKey: '柳无痕', mappingKind: 'power_tier', mapping: { tier: 'enhanced' }, evidenceRefs: [] },
        ],
        rejectedQuotes: 0,
      };
    },
  };
}

test('T5 ruleMappings land through the production extract->commit path with honest rejection', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareSource(db);
    const sharedAdapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(sharedAdapter);
    const worldStore = new SqliteWorldStore(sharedAdapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-p4', worldId: 'w-p4', sourceId: 'src-p4', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group',
        budget: WINDOWED_BUDGET,
      },
    );
    const groupExtractor = mappingGroupExtractor();
    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 'p4', budget: WINDOWED_BUDGET,
    }, 'run-p4');
    assert.equal(done.completed, true);

    // Facts committed normally - a rejected mapping never blocks its chunk.
    const facts = await worldStore.listFacts('w-p4');
    assert.ok(facts.length > 0, 'facts commit despite rejected mappings');

    // Exactly ONE mapping survived: the one citing a real verbatim quote with
    // a known target. Unknown target / invented quote / empty evidence are
    // all rejected (never stored as design_fill or explicit stand-ins).
    const mappings = await worldStore.listRuleMappings('w-p4');
    assert.equal(mappings.length, 1, `expected 1 verified mapping, got ${JSON.stringify(mappings.map(m => m.mappingId))}`);
    const mapping = mappings[0];
    assert.equal(mapping.targetEntityId, 'ent-w-p4-陈青云');
    assert.equal(mapping.mappingKind, 'skill');
    assert.equal(mapping.status, 'active');
    assert.equal(mapping.rulesetVersion, '0.2.0');
    assert.deepEqual(mapping.mapping, { skillId: 'sword', rank: 'trained' });
    assert.equal(mapping.evidenceRefs.length, 1);
    // Stable idempotent identity derived from world+target+kind+token.
    assert.equal(mapping.mappingId, ruleMappingIdFor('w-p4', mapping.targetEntityId, 'skill', { skillId: 'sword', rank: 'trained' }));
  } finally {
    db.close();
  }
});

test('T4 replaying a full run over the same world never inflates world_rule_mappings', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareSource(db);
    const sharedAdapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(sharedAdapter);
    const worldStore = new SqliteWorldStore(sharedAdapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-p4a', worldId: 'w-p4a', sourceId: 'src-p4', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group',
        budget: WINDOWED_BUDGET,
      },
    );
    const first = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor: mappingGroupExtractor(),
      sha256Hex: sha.sha256Hex, owner: 'p4a', budget: WINDOWED_BUDGET,
    }, 'run-p4a');
    assert.equal(first.completed, true);
    const afterFirst = await worldStore.listRuleMappings('w-p4a');

    // A different model fingerprint forces real re-extraction over the SAME
    // world (the C1 fast path will not fire), replaying every mapping commit.
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-p4b', worldId: 'w-p4a', sourceId: 'src-p4', modelFingerprint: 'ep#other-model',
        title: 't', extractorVersion: fixture.version, mode: 'group',
        budget: WINDOWED_BUDGET,
      },
    );
    const second = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor: mappingGroupExtractor(),
      sha256Hex: sha.sha256Hex, owner: 'p4b', budget: WINDOWED_BUDGET,
    }, 'run-p4b');
    assert.equal(second.completed, true);
    const afterSecond = await worldStore.listRuleMappings('w-p4a');

    assert.equal(afterSecond.length, afterFirst.length, 'duplicate mapping commits are idempotent');
    const ids = afterSecond.map(m => m.mappingId);
    assert.equal(new Set(ids).size, ids.length, 'no duplicate rows');
  } finally {
    db.close();
  }
});

test('T8 honesty: tampered quotes are still dropped and mappings need real evidence', async () => {
  const chapters = [{ chapterId: 'ch-1', title: '第一章', startOffset: 0, endOffset: 40 }];
  const source = {
    chapters,
    async sliceRange(start, end) { return '陈青云得到了一把青锋剑，剑光如秋水。'.slice(start, end); },
  };
  const extraction = {
    entities: [{ entityKey: '陈青云', type: 'character', name: '陈青云', aliases: [] }],
    facts: [
      {
        subjectKey: '陈青云', predicate: 'owns', value: { item: '青锋剑' },
        status: 'explicit', confidence: 0.9,
        evidence: { chapterId: 'ch-1', startOffset: 0, endOffset: 8, quote: '陈青云得到了一把' },
      },
      {
        // Tampered: the span does not reproduce the quote verbatim.
        subjectKey: '陈青云', predicate: 'fake', value: {},
        status: 'explicit', confidence: 0.9,
        evidence: { chapterId: 'ch-1', startOffset: 0, endOffset: 6, quote: '陈青云得到了一把青锋剑' },
      },
    ],
    events: [],
    ruleMappings: [
      // Evidence quote matches the VERIFIED fact only.
      { targetKey: '陈青云', mappingKind: 'skill', mapping: { skillId: 'sword' }, evidenceRefs: ['陈青云得到了一把'] },
      // Cites the tampered fact's quote - must be rejected.
      { targetKey: '陈青云', mappingKind: 'attribute', mapping: { attribute: 'agility' }, evidenceRefs: ['陈青云得到了一把青锋剑'] },
    ],
  };
  const resolved = await applyExtraction({
    worldId: 'w-t8', source, extraction,
    createdAt: '2026-09-29T00:00:00.000Z',
    sha256Hex: sha.sha256Hex,
  });
  assert.equal(resolved.facts.length, 1, 'checkEvidence still drops the tampered-span fact');
  assert.equal(resolved.ruleMappings.length, 1, 'only the verified-evidence mapping survives');
  assert.equal(resolved.ruleMappings[0].mappingKind, 'skill');
  assert.ok(resolved.rejected.some(issue => issue.kind === 'evidence'), 'tamper surfaced as an evidence issue');
  assert.ok(resolved.rejected.some(issue => issue.kind === 'rule_mapping'), 'unverified mapping surfaced as a rule_mapping issue');
});

// ---------------------------------------------------------------------------
// WorldMapper V2 (plan P4): resident whole-book vision.
// ---------------------------------------------------------------------------

const { buildPackageFromCanon } = require('../dist/application/worldPackage/buildPackageFromCanon');

const MAP_PROPOSAL_V2 = {
  skills: [{
    id: 'swim', name: '凫水', description: '水中行动', attribute: 'agility',
    allowUntrained: true, requirements: [], powerTier: 'ordinary',
    provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '原著提到擅长水性。',
  }],
  ruleMappings: [
    { target: '陈青云', kind: 'skill', mapping: { skillId: 'swim', rank: 'trained' }, evidenceFactIds: ['fact-0'] },
    { target: '陈青云', kind: 'skill', mapping: { skillId: 'ghost' }, evidenceFactIds: ['fact-does-not-exist'] },
    { target: '未见之人', kind: 'attribute', mapping: { attribute: 'physique' }, evidenceFactIds: ['fact-0'] },
    { target: '柳无痕', kind: 'resource', mapping: { resource: 'qi' }, evidenceFactIds: [] },
  ],
};

function mapperFact(worldId, factId, subject, predicate, value) {
  return {
    worldId, factId, subjectEntityId: subject, predicate, value, status: 'explicit',
    confidence: 0.9, validFrom: null, validTo: null, revealAt: null, scope: 'canon', sources: [],
  };
}

async function seedWorldForMapper(worldStore, worldId, factCount) {
  await worldStore.createWorld({
    worldId, title: 't', sourceSha256: 'b'.repeat(64), sourceBytes: 1,
    normalizeVersion: 'n', chapterSplitVersion: 'c', buildStatus: 'ready',
    createdAt: 't', updatedAt: 't',
  });
  await worldStore.upsertEntity({
    worldId, entityId: 'chen', type: 'character', name: '陈青云',
    firstSeenChapterId: null, aliases: [],
  }, 't');
  for (let i = 0; i < factCount; i += 1) {
    const value = i === 0 ? { level: '熟练' } : { n: i };
    const predicate = i === 0 ? 'skill_swim' : `detail_${i}`;
    await worldStore.saveFact(mapperFact(worldId, `fact-${i}`, 'chen', predicate, value), 't');
  }
}

test('WorldMapper V2: resident maps all facts in ONE whole-book request and lands verified ruleMappings', async () => {
  const db = setupDb();
  try {
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    await seedWorldForMapper(worldStore, 'w-v2', 801);
    let calls = 0;
    let lastPrompt = '';
    const provider = {
      async complete(request) {
        calls += 1;
        lastPrompt = request.user;
        return {
          text: JSON.stringify(MAP_PROPOSAL_V2),
          usage: { inputTokens: 100, outputTokens: 40, estimated: false },
        };
      },
    };
    const result = await buildPackageFromCanon({
      worldStore, provider, sha256Hex: sha.sha256Hex, resident: true,
      worldId: 'w-v2', sourceSha256: 'b'.repeat(64), mappingVersion: 'mv-v2',
      createdAt: 't',
    });
    // The 800-fact truncation is LIFTED: one request carries all 801 facts
    // (windowed batching would need two).
    assert.equal(calls, 1, 'resident maps in a single whole-book request');
    assert.ok(lastPrompt.includes('fact-800'), 'the last fact rides the single resident batch');
    assert.ok(lastPrompt.includes('陈青云'), 'full entity context travels with the mapping');
    assert.equal(result.manifest.status, 'published');

    // Exactly the evidence-verified mapping survived; unknown targets,
    // unknown fact ids and empty evidence are rejected (T8 discipline).
    const mappings = await worldStore.listRuleMappings('w-v2');
    assert.equal(mappings.length, 1, JSON.stringify(mappings.map(m => m.mappingId)));
    assert.equal(mappings[0].targetEntityId, 'chen');
    assert.equal(mappings[0].mappingKind, 'skill');
    assert.equal(mappings[0].status, 'active');
    assert.equal(mappings[0].rulesetVersion, '0.2.0');
    assert.deepEqual(mappings[0].evidenceRefs, ['fact-0']);

    // The mapped skill still passed the unchanged cleanSkill/validate gates.
    const swim = result.entries.find(entry => entry.entryId === 'skill-swim');
    assert.ok(swim, 'cleaned skill entry published');
    assert.equal(swim.provenance.kind, 'explicit');
    assert.deepEqual(swim.provenance.sourceFactIds, ['fact-0']);
  } finally {
    db.close();
  }
});

test('WorldMapper windowed path is untouched: >800 facts still batch', async () => {
  const db = setupDb();
  try {
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    await seedWorldForMapper(worldStore, 'w-v2w', 801);
    let calls = 0;
    const provider = {
      async complete() {
        calls += 1;
        return { text: JSON.stringify(MAP_PROPOSAL_V2), usage: null };
      },
    };
    const result = await buildPackageFromCanon({
      worldStore, provider, sha256Hex: sha.sha256Hex,
      worldId: 'w-v2w', sourceSha256: 'b'.repeat(64), mappingVersion: 'mv-v2w',
      createdAt: 't',
    });
    assert.equal(calls, 2, 'windowed keeps the 800-fact batched path');
    assert.equal(result.manifest.status, 'published');
  } finally {
    db.close();
  }
});
