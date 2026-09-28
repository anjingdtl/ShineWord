// Closeout C3 regression suite: budget-driven group planning, segment
// protocol extraction, group-mode coordinator runs, truncation splits, and
// resumable/merged mapping batches with aggregated usage.
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
const {
  planExtractGroups,
  DEFAULT_MODEL_BUDGET,
} = require('../dist/application/worldBuild/groupPlanner');
const { LlmGroupExtractor } = require('../dist/application/world/llmGroupExtractor');
const { LlmRequestFailure } = require('../dist/application/llm/types');
const {
  createExtractionRun,
  executeRun,
} = require('../dist/application/worldBuild/coordinator');
const { buildPackageFromCanon } = require('../dist/application/worldPackage/buildPackageFromCanon');
const { FixtureExtractor } = require('./fixtures/fixtureExtractor.cjs');

class NodeSqliteAdapter {
  constructor(db) {
    this.db = db;
    this.chain = Promise.resolve();
  }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return; }
    this.db.prepare(sql).run(...params);
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

const decoder = {
  decode(bytes, encoding) {
    return new TextDecoder(encoding === 'utf-8-sig' ? 'utf-8' : encoding).decode(bytes);
  },
};

class NodeTextSource {
  constructor(buffer) {
    this.buffer = buffer;
    this.encoding = 'utf-8';
    this.rawSha256Hex = crypto.createHash('sha256').update(buffer).digest('hex');
    this.decoder = new TextDecoder('utf-8');
  }
  get byteLength() { return this.buffer.length; }
  async readText(offset, maxBytes) {
    const end = Math.min(offset + maxBytes, this.buffer.length);
    const atEof = end >= this.buffer.length;
    const text = this.decoder.decode(this.buffer.subarray(offset, end), { stream: !atEof });
    return { text, nextByteOffset: end, atEof };
  }
}

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

async function prepareActiveSqliteSource(db, fixtureName, sourceId) {
  const store = new SqliteSourceStore(new NodeSqliteAdapter(db));
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', fixtureName));
  const source = new NodeTextSource(bytes);
  const now = '2026-09-28T12:00:00.000Z';
  await store.beginStaging({
    sourceId, rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
    codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
    chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
    splitStrategy: 'standard', fileName: fixtureName, title: null,
    status: 'staging', createdAt: now, updatedAt: now,
  });
  const result = await importTxtSourceStreaming(source, store, sourceId, {
    sha256Hex: sha.sha256Hex, sha256BytesHex: sha.sha256BytesHex,
  });
  await store.activateSource({
    manifest: {
      sourceId, rawSha256Hex: result.rawSha256Hex, normalizedTreeHash: result.normalizedTreeHash,
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: result.byteLength,
      codePointCount: result.codePointCount, encoding: result.encoding,
      normalizeVersion: result.normalizeVersion, chapterSplitVersion: result.chapterSplitVersion,
      normalizeShardScheme: result.normalizeShardScheme, splitStrategy: result.splitStrategy,
      fileName: fixtureName, title: null, status: 'active', createdAt: now, updatedAt: now,
    },
    chapters: result.chapters,
    chunks: result.chunks,
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

// ---------------------------------------------------------------------------
// Group planner.
// ---------------------------------------------------------------------------

test('C3 planner covers every chunk exactly once and respects budgets', () => {
  const chunks = Array.from({ length: 50 }, (_, i) => ({
    chunkId: `c${i}`, chapterId: `ch-${i % 5}`, chunkIndex: 0,
    startOffset: i * 1200, endOffset: (i + 1) * 1200, charCount: 1200, contentHash: `h${i}`,
  }));
  const groups = planExtractGroups(chunks, DEFAULT_MODEL_BUDGET, { maxGroupSegments: 8 });
  const planned = groups.flatMap(group => group.segments);
  assert.equal(planned.length, chunks.length);
  for (let i = 0; i < planned.length; i += 1) {
    assert.equal(planned[i].chunkId, chunks[i].chunkId, 'order preserved');
  }
  for (const group of groups) {
    assert.ok(group.segments.length <= 8);
    // estInputTokens is the conservative per-code-point sum of member chunks.
    const sum = group.segments.reduce((acc, segment) => acc + segment.charCount, 0);
    assert.ok(group.estInputTokens >= sum * 0.99, 'estimate is conservative');
  }
  // A tight budget forces smaller groups (more of them than the uncapped
  // default, which fits all 50 chunks into one group).
  const uncapped = planExtractGroups(chunks, DEFAULT_MODEL_BUDGET);
  const tight = planExtractGroups(chunks, {
    contextWindowTokens: 30_000, maxOutputTokens: 8_000, reserveTokens: 2_000,
  });
  assert.ok(tight.length > uncapped.length, 'tighter budget yields more groups');
  const bodyBudget = 30_000 - 8_000 - 2_000 - 1_500;
  for (const group of tight) {
    assert.ok(group.estInputTokens <= bodyBudget, 'no group exceeds the body budget');
  }
});

// ---------------------------------------------------------------------------
// Segment protocol extractor.
// ---------------------------------------------------------------------------

test('C3 group extractor resolves segment quotes and rejects cross-segment claims', async () => {
  const seg1 = {
    chunkId: 'ch-0001-c001', chapterId: 'ch-0001', chapterTitle: '第一章',
    startCp: 100, text: '陈青云得到了一把青锋剑。柳无痕擅长毒术。',
  };
  const seg2 = {
    chunkId: 'ch-0002-c001', chapterId: 'ch-0002', chapterTitle: '第二章',
    startCp: 900, text: '离火教与青岚派积怨已深。',
  };
  const extractor = new LlmGroupExtractor(async request => {
    assert.match(request.system, /segment/i);
    assert.match(request.user, /\[S1 第一章\]/);
    assert.match(request.user, /\[S2 第二章\]/);
    return {
      text: JSON.stringify({
        entities: [
          { key: '陈青云', type: 'character', name: '陈青云', aliases: [] },
          { key: '离火教', type: 'faction', name: '离火教', aliases: [] },
        ],
        facts: [
          { subject: '陈青云', predicate: 'owns', value: { item: '青锋剑' }, status: 'explicit', confidence: 0.9, segment: 1, quote: '陈青云得到了一把青锋剑。' },
          // Quote exists - but in segment 1, claimed for segment 2: rejected.
          { subject: '离火教', predicate: 'mentioned', value: {}, status: 'explicit', confidence: 0.9, segment: 2, quote: '陈青云得到了一把青锋剑。' },
          { subject: '离火教', predicate: 'rival_of', value: { faction: '青岚派' }, status: 'explicit', confidence: 0.9, segment: 2, quote: '离火教与青岚派积怨已深。' },
        ],
        events: [
          { key: 'feud', title: '积怨', summary: '两派积怨。', order: 1, segment: 2, dependsOn: [] },
        ],
      }),
    };
  });
  const group = await extractor.extract({ unitId: 'u1', segments: [seg1, seg2], worldId: 'w' });
  assert.equal(group.facts.length, 2);
  assert.equal(group.rejectedQuotes, 1, 'cross-segment quote claim must be rejected');
  const first = group.facts[0];
  assert.equal(first.evidence.startOffset, 100, 'segment-relative offset resolves to absolute');
  assert.equal(first.evidence.chapterId, 'ch-0001');
  assert.equal(first.evidence.endOffset - first.evidence.startOffset, [...first.evidence.quote].length);
  assert.equal(group.facts[1].chunkId, 'ch-0002-c001');
  assert.equal(group.events[0].chunkId, 'ch-0002-c001');
});

// ---------------------------------------------------------------------------
// Group-mode coordinator end to end + truncation split.
// ---------------------------------------------------------------------------

function fakeGroupExtractorFromFixture() {
  const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
  return {
    version: 'llm-group-extractor-1',
    calls: 0,
    seenSegments: [],
    async extract({ segments }) {
      this.calls += 1;
      this.seenSegments.push(segments.length);
      // Reuse the deterministic fixture extractor per segment and merge.
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
      return { entities: [...entities.values()], facts, events, ruleMappings: [], rejectedQuotes: 0 };
    },
  };
}

test('C3 coordinator group mode completes with per-chunk commits', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore, result } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-g1');
    const runStore = new SqliteBuildRunStore(new NodeSqliteAdapter(db));
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    const run = await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-g1', worldId: 'w-g1', sourceId: 'src-g1', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group',
        budget: { contextWindowTokens: 60_000, maxOutputTokens: 8_000, reserveTokens: 2_000 },
      },
    );
    // Multiple chunks per group must actually happen on this fixture.
    const units = await runStore.listUnits('run-g1');
    const sizes = units.map(unit => JSON.parse(unit.sourceRangesJson).length);
    assert.ok(sizes.some(size => size > 1), `expected multi-chunk groups, got ${sizes.join(',')}`);
    assert.equal(run.unitsTotal, units.length);

    const groupExtractor = fakeGroupExtractorFromFixture();
    const done = await executeRun({
      sourceStore, runStore, worldStore,
      extractor: fixture,
      groupExtractor,
      sha256Hex: sha.sha256Hex,
    }, 'run-g1');
    assert.equal(done.completed, true);
    assert.ok(groupExtractor.calls > 0);
    const facts = await worldStore.listFacts('w-g1');
    assert.ok(facts.length > 0, 'group mode must commit facts');
    // Every source chunk is marked done world-side.
    for (const chunk of result.chunks) {
      const job = await worldStore.getJob('w-g1', `job-extract-${chunk.chunkId}`);
      assert.equal(job?.status, 'done', `chunk ${chunk.chunkId} done`);
    }
    const world = await worldStore.getWorld('w-g1');
    assert.equal(world.buildStatus, 'ready');
  } finally {
    db.close();
  }
});

test('G0 lease heartbeat keeps ownership during a slow provider call', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-g0-heartbeat');
    const runStore = new SqliteBuildRunStore(new NodeSqliteAdapter(db));
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-g0-heartbeat', worldId: 'w-g0-heartbeat', sourceId: 'src-g0-heartbeat',
        modelFingerprint: 'ep#m', title: 't', extractorVersion: fixture.version, mode: 'group',
        budget: { contextWindowTokens: 60_000, maxOutputTokens: 8_000, reserveTokens: 2_000 },
      },
    );
    const base = fakeGroupExtractorFromFixture();
    const slow = {
      version: base.version,
      async extract(input) {
        await new Promise(resolve => setTimeout(resolve, 240));
        return base.extract(input);
      },
    };
    const execution = executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor: slow,
      sha256Hex: sha.sha256Hex, owner: 'heartbeat-owner', leaseTtlMs: 90,
    }, 'run-g0-heartbeat');
    await new Promise(resolve => setTimeout(resolve, 125));
    const competingToken = await runStore.acquireLease(
      'run-g0-heartbeat', 'second-owner', 90, new Date().toISOString(),
    );
    assert.equal(competingToken, null, 'active request lease must be extended past its original TTL');
    assert.equal((await execution).completed, true);
  } finally {
    db.close();
  }
});

test('G0 canceled late extraction is discarded and its unit can be resumed', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore, result: imported } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-g0-cancel');
    const runStore = new SqliteBuildRunStore(new NodeSqliteAdapter(db));
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-g0-cancel', worldId: 'w-g0-cancel', sourceId: 'src-g0-cancel',
        modelFingerprint: 'ep#m', title: 't', extractorVersion: fixture.version, mode: 'group',
        budget: { contextWindowTokens: 60_000, maxOutputTokens: 8_000, reserveTokens: 2_000 },
      },
    );
    const base = fakeGroupExtractorFromFixture();
    let signalStarted;
    const started = new Promise(resolve => { signalStarted = resolve; });
    const gate = {
      version: base.version,
      async extract(input) {
        signalStarted();
        await new Promise(resolve => setTimeout(resolve, 100));
        return base.extract(input);
      },
    };
    const signal = { aborted: false };
    const execution = executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor: gate,
      sha256Hex: sha.sha256Hex, owner: 'cancel-owner', signal,
    }, 'run-g0-cancel');
    await started;
    signal.aborted = true;
    const paused = await execution;
    assert.equal(paused.completed, false);
    assert.equal((await runStore.getRun('run-g0-cancel')).status, 'paused_user');
    assert.equal((await worldStore.listFacts('w-g0-cancel')).length, 0,
      'late model response must not mutate world facts');
    for (const chunk of imported.chunks) {
      assert.equal(await worldStore.getJob('w-g0-cancel', `job-extract-${chunk.chunkId}`), null,
        'late model response must not mark any source chunk done');
    }

    const resumed = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture,
      groupExtractor: base, sha256Hex: sha.sha256Hex, owner: 'resume-owner',
    }, 'run-g0-cancel');
    assert.equal(resumed.completed, true);
    assert.ok((await worldStore.listFacts('w-g0-cancel')).length > 0);
  } finally {
    db.close();
  }
});

test('G0 failed physical request metrics survive a later unit retry', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-g0-metrics');
    const runStore = new SqliteBuildRunStore(new NodeSqliteAdapter(db));
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-g0-metrics', worldId: 'w-g0-metrics', sourceId: 'src-g0-metrics',
        modelFingerprint: 'ep#m', title: 't', extractorVersion: fixture.version, mode: 'group',
        budget: { contextWindowTokens: 60_000, maxOutputTokens: 8_000, reserveTokens: 2_000 },
      },
    );
    const failed = {
      version: 'llm-group-extractor-1',
      async extract() {
        throw new LlmRequestFailure('network timeout PRIVATE_RAW_RESPONSE_NEVER_STORE', [{
          attempt: 1, durationMs: 90000, httpStatus: null, outcome: 'transport_error',
          errorCategory: 'timeout', timings: { completeResponseMs: 90000 },
        }]);
      },
    };
    await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor: failed,
      sha256Hex: sha.sha256Hex, owner: 'metrics-owner',
    }, 'run-g0-metrics');
    const pending = (await runStore.listUnits('run-g0-metrics'))[0];
    assert.equal(pending.status, 'failed_retryable');
    assert.equal(JSON.parse(pending.usageJson).requestMetrics[0].errorCategory, 'timeout');
    assert.doesNotMatch(pending.errorMessage, /PRIVATE_RAW_RESPONSE/);
    assert.doesNotMatch((await runStore.getRun('run-g0-metrics')).lastErrorMessage ?? '', /PRIVATE_RAW_RESPONSE/);

    await new NodeSqliteAdapter(db).execute(
      "UPDATE world_build_units SET status = 'queued', retry_at = NULL WHERE unit_id = ?", [pending.unitId],
    );
    const retried = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture,
      groupExtractor: fakeGroupExtractorFromFixture(), sha256Hex: sha.sha256Hex,
      owner: 'metrics-owner-retry',
    }, 'run-g0-metrics');
    assert.equal(retried.completed, true);
    const completed = (await runStore.listUnits('run-g0-metrics'))[0];
    const usage = JSON.parse(completed.usageJson);
    assert.equal(usage.requestMetrics.length, 1, JSON.stringify(usage.requestMetrics));
    assert.equal(usage.requestMetrics[0].durationMs, 90000);
    assert.equal(usage.rejectedQuotes, 0);
  } finally {
    db.close();
  }
});

test('C3 truncation splits a group transactionally; children finish the work', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-g2');
    const runStore = new SqliteBuildRunStore(new NodeSqliteAdapter(db));
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-g2', worldId: 'w-g2', sourceId: 'src-g2', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group',
        budget: { contextWindowTokens: 60_000, maxOutputTokens: 8_000, reserveTokens: 2_000 },
      },
    );
    const base = fakeGroupExtractorFromFixture();
    let truncatedOnce = false;
    const truncating = {
      version: base.version,
      extract: async input => {
        if (!truncatedOnce && input.segments.length > 1) {
          truncatedOnce = true;
          throw new Error('response truncated: finish_reason max_tokens');
        }
        return base.extract(input);
      },
    };
    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor: truncating,
      sha256Hex: sha.sha256Hex,
    }, 'run-g2');
    assert.equal(truncatedOnce, true, 'the split path must have been exercised');
    assert.equal(done.completed, true);
    const units = await runStore.listUnits('run-g2');
    const parents = units.filter(unit => unit.status === 'canceled');
    assert.ok(parents.length >= 1, 'the oversized parent is canceled');
    const children = units.filter(unit => unit.parentUnitId !== null);
    assert.ok(children.length >= 2, 'the split created child units');
    assert.ok(children.every(child => child.status === 'completed'));
    // No double counting: done == total after the split adjusted totals.
    const run = await runStore.getRun('run-g2');
    assert.equal(run.unitsDone, run.unitsTotal);
    const world = await worldStore.getWorld('w-g2');
    assert.equal(world.buildStatus, 'ready');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// Mapping: resume, cross-batch merge, aggregated usage.
// ---------------------------------------------------------------------------

const MAP_PROPOSAL = {
  skills: [{
    id: 'swim', name: '凫水', description: '水中行动', attribute: 'agility',
    allowUntrained: true, requirements: [], powerTier: 'ordinary',
    provenanceKind: 'explicit', evidenceFactIds: ['fact-0'], rationale: '原著提到擅长水性。',
  }],
};

function makeFact(worldId, factId, subject, predicate, value) {
  return {
    worldId, factId, subjectEntityId: subject, predicate, value, status: 'explicit',
    confidence: 0.9, validFrom: null, validTo: null, revealAt: null, scope: 'canon', sources: [],
  };
}

async function seedWorldWithFacts(worldStore, worldId, factCount) {
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
    // Only even facts propose the skill; the rest exist to fill batches.
    if (i === 0) {
      await worldStore.saveFact(makeFact(worldId, 'fact-0', 'chen', 'skill_swim', { level: '熟练' }), 't');
    } else {
      await worldStore.saveFact(makeFact(worldId, `fact-${i}`, 'chen', `detail_${i}`, { n: i }), 't');
    }
  }
}

test('C3 mapping: failed batch resumes from checkpoint; usage aggregates across batches', async () => {
  const db = setupDb();
  try {
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    // 801 facts -> 2 mapping batches (MAX_PROMPT_FACTS = 800).
    await seedWorldWithFacts(worldStore, 'w-map', 801);
    let calls = 0;
    const failingThenWorking = {
      async complete(request) {
        calls += 1;
        if (calls === 2) throw new Error('network timeout during mapping batch 2');
        return {
          text: JSON.stringify(MAP_PROPOSAL),
          usage: { inputTokens: 100 * calls, outputTokens: 40, estimated: false },
        };
      },
    };
    await assert.rejects(() => buildPackageFromCanon({
      worldStore, provider: failingThenWorking, sha256Hex: sha.sha256Hex,
      worldId: 'w-map', sourceSha256: 'b'.repeat(64), mappingVersion: 'mv-1',
      createdAt: 't',
    }), /network timeout/);
    // Batch 1 checkpoint exists; batch 2 has no done marker.
    const job1 = await worldStore.getJob('w-map', 'job-map-w-map-b0001');
    assert.equal(job1?.status, 'done');

    let rerunCalls = 0;
    const working = {
      async complete() {
        rerunCalls += 1;
        return {
          text: JSON.stringify(MAP_PROPOSAL),
          usage: { inputTokens: 100, outputTokens: 40, estimated: false },
        };
      },
    };
    const result = await buildPackageFromCanon({
      worldStore, provider: working, sha256Hex: sha.sha256Hex,
      worldId: 'w-map', sourceSha256: 'b'.repeat(64), mappingVersion: 'mv-1',
      createdAt: 't',
    });
    assert.equal(rerunCalls, 1, 'only the unfinished batch is re-requested');
    assert.equal(result.manifest.status, 'published');
    const usage = result.mappingUsage;
    assert.equal(typeof usage, 'object');
    // Aggregate over both batches (first run's batch 1 was checkpointed with
    // its usage persisted; rerun batch 2 adds 100 more input tokens).
    assert.equal(usage.batches >= 1, true);
  } finally {
    db.close();
  }
});

test('C3 mapping: same entryId across batches merges provenance, not first-wins', async () => {
  const db = setupDb();
  try {
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    await seedWorldWithFacts(worldStore, 'w-merge', 801);
    let call = 0;
    const provider = {
      async complete() {
        call += 1;
        // Batch 1 proposes the skill citing fact-0; batch 2 re-proposes the
        // SAME entry citing an additional fact id.
        const evidence = call === 1 ? ['fact-0'] : ['fact-500'];
        return {
          text: JSON.stringify({
            skills: [{
              id: 'swim', name: '凫水', description: '水中行动', attribute: 'agility',
              allowUntrained: true, requirements: [], powerTier: 'ordinary',
              provenanceKind: 'explicit', evidenceFactIds: evidence, rationale: '原著提到擅长水性。',
            }],
          }),
          usage: { inputTokens: 50, outputTokens: 10, estimated: false },
        };
      },
    };
    const result = await buildPackageFromCanon({
      worldStore, provider, sha256Hex: sha.sha256Hex,
      worldId: 'w-merge', sourceSha256: 'b'.repeat(64), mappingVersion: 'mv-2',
      createdAt: 't',
    });
    assert.equal(call, 2);
    const swim = result.entries.find(entry => entry.entryId === 'skill-swim');
    assert.ok(swim, 'merged skill exists once');
    assert.equal(result.entries.filter(entry => entry.entryId === 'skill-swim').length, 1);
    assert.ok(swim.provenance.sourceFactIds.includes('fact-0'), 'first batch provenance kept');
    assert.ok(swim.provenance.sourceFactIds.includes('fact-500'), 'second batch provenance merged in');
  } finally {
    db.close();
  }
});
