// 1M resident build P2 regression suite: resident-mode request prefixes are
// byte-stable across units (T2), concurrent workers stay idempotent (T4),
// reasoning_only triggers a reserve-bump retry before any split (T6), and a
// cache-incapable model degrades resident to windowed with a recorded
// reason (T7).
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
const { LlmGroupExtractor } = require('../dist/application/world/llmGroupExtractor');
const { LlmRequestFailure } = require('../dist/application/llm/types');
const {
  createExtractionRun,
  executeRun,
  assessResidentViability,
  capWorkersByTpm,
  nextReasoningReserve,
  RESIDENT_DEGRADED_NO_CACHE,
  RESIDENT_DEGRADED_TOO_LARGE,
} = require('../dist/application/worldBuild/coordinator');
const { FixtureExtractor } = require('./fixtures/fixtureExtractor.cjs');

class NodeSqliteAdapter {
  constructor(db) {
    this.db = db;
    this.chain = Promise.resolve();
  }
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

class NodeTextSource {
  constructor(buffer, encoding = 'utf-8') {
    this.buffer = buffer;
    this.encoding = encoding;
    this.rawSha256Hex = crypto.createHash('sha256').update(buffer).digest('hex');
    this.decoder = new TextDecoder(encoding === 'utf-8-sig' || encoding === 'utf-8' ? 'utf-8' : encoding);
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

/** 1M-class resident-viable budget over the small fixtures (plan §3.1). */
const RESIDENT_BUDGET = {
  contextWindowTokens: 1_048_576,
  maxContentOutputTokens: 16_384,
  reasoningReserveTokens: 2_048,
  reasoningEffort: 'low',
  supportsPromptCache: true,
  reserveTokens: 2_000,
};

const WINDOWED_BUDGET = {
  contextWindowTokens: 60_000,
  maxContentOutputTokens: 8_000,
  reasoningReserveTokens: 0,
  reasoningEffort: 'off',
  supportsPromptCache: false,
  reserveTokens: 2_000,
};

function fixtureGroupExtractor() {
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
      return { entities: [...entities.values()], facts, events, ruleMappings: [], rejectedQuotes: 0 };
    },
  };
}

test('T2 resident mode: messages[0] and messages[1] are byte-identical across all units', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-t2');
    const sharedAdapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(sharedAdapter);
    const worldStore = new SqliteWorldStore(sharedAdapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    const run = await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-t2', worldId: 'w-t2', sourceId: 'src-t2', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'resident',
        budget: RESIDENT_BUDGET,
      },
    );
    assert.equal(run.planVersion, 'plan-resident-1');
    assert.ok((await runStore.listUnits('run-t2')).length >= 2, 'the small novel plans several resident units');

    const requests = [];
    const groupExtractor = new LlmGroupExtractor(async request => {
      requests.push(request);
      return { text: JSON.stringify({ entities: [], facts: [], events: [] }) };
    }, RESIDENT_BUDGET.maxContentOutputTokens + RESIDENT_BUDGET.reasoningReserveTokens);

    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 't2', budget: RESIDENT_BUDGET,
    }, 'run-t2');
    assert.equal(done.completed, true);
    assert.ok(requests.length >= 2, 'resident run issued per-unit requests');

    // T2 core: the cacheable prefix [system, whole-book user] is BYTE-stable
    // across every unit; only the scope instruction (messages[2]) varies.
    const first = requests[0];
    assert.equal(first.followUpUserMessages.length, 1);
    assert.equal(first.followUpUserMessages[0].length > 0, true);
    for (const request of requests.slice(1)) {
      assert.equal(request.system, first.system, 'resident system prompt is byte-stable');
      assert.equal(request.user, first.user, 'resident whole-book message is byte-stable');
      assert.notEqual(request.followUpUserMessages[0], first.followUpUserMessages[0],
        'each unit carries its own scope instruction');
    }
    assert.equal(done.unitsTotal, requests.length, 'one request per resident unit');
  } finally {
    db.close();
  }
});

test('T4 two workers extract each unit exactly once and commit each chunk once', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore, result: imported } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-t4');
    const sharedAdapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(sharedAdapter);
    const worldStore = new SqliteWorldStore(sharedAdapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-t4', worldId: 'w-t4', sourceId: 'src-t4', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group',
        budget: WINDOWED_BUDGET,
      },
    );
    const groupExtractor = fixtureGroupExtractor();
    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 't4', concurrency: 2, budget: WINDOWED_BUDGET,
    }, 'run-t4');
    assert.equal(done.completed, true);
    assert.equal(done.unitsDone, done.unitsTotal);

    // Exactly one physical extraction per planned unit despite 2 workers.
    const units = await runStore.listUnits('run-t4');
    assert.equal(groupExtractor.calls, units.filter(u => u.parentUnitId === null).length);

    // Every chunk committed exactly once: one done job, attempts === 1.
    for (const chunk of imported.chunks) {
      const job = await worldStore.getJob('w-t4', `job-extract-${chunk.chunkId}`);
      assert.equal(job?.status, 'done', `chunk ${chunk.chunkId} done`);
      assert.equal(job.attempts, 1, `chunk ${chunk.chunkId} committed exactly once`);
    }
    // No duplicated fact rows.
    const facts = await worldStore.listFacts('w-t4');
    const factIds = new Set(facts.map(fact => fact.factId));
    assert.equal(factIds.size, facts.length, 'no duplicate fact ids from concurrent commits');
    const run = await runStore.getRun('run-t4');
    assert.equal(run.unitsDone, run.unitsTotal, 'no double counting under concurrency');
  } finally {
    db.close();
  }
});

test('T6 reasoning_only bumps the reserve once before any split (mock)', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-t6');
    const sharedAdapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(sharedAdapter);
    const worldStore = new SqliteWorldStore(sharedAdapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-t6', worldId: 'w-t6', sourceId: 'src-t6', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group',
        budget: { ...WINDOWED_BUDGET, reasoningReserveTokens: 2_048 },
      },
    );

    // The inner group extractor fails the FIRST unit with a reasoning_only
    // completion, then succeeds with the SAME scope at a bumped budget.
    const inner = fixtureGroupExtractor();
    let reasoningOnlyFired = false;
    const calls = [];
    const groupExtractor = {
      version: inner.version,
      async extract(input) {
        calls.push(input.maxOutputTokens);
        if (!reasoningOnlyFired) {
          reasoningOnlyFired = true;
          throw new LlmRequestFailure('模型只输出了思维链，未产生正文。', [{
            attempt: 3, durationMs: 1000, httpStatus: 200, outcome: 'reasoning_only',
            completionState: 'reasoning_only',
          }]);
        }
        return inner.extract(input);
      },
    };

    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 't6',
      budget: { ...WINDOWED_BUDGET, reasoningReserveTokens: 2_048 },
    }, 'run-t6');

    assert.equal(reasoningOnlyFired, true, 'the mock fired the reasoning_only path');
    // Exactly ONE retry ran at the bumped budget: content 8000 + the next
    // ladder reserve (2048 -> 4096) = 12096; every other call used the
    // extractor default (undefined). One extra call in total.
    const planned = (await runStore.listUnits('run-t6')).filter(u => u.parentUnitId === null).length;
    assert.equal(calls.length, planned + 1, 'exactly one extra physical call for the bump retry');
    const bumped = 8_000 + nextReasoningReserve(2_048);
    assert.equal(calls.filter(value => value === bumped).length, 1, `one retry at ${bumped}`);
    assert.equal(done.completed, true, 'the bumped retry completed the unit');
    const units = await runStore.listUnits('run-t6');
    assert.equal(units.filter(unit => unit.parentUnitId !== null).length, 0,
      'no split happened for a reasoning_only failure');
    for (const unit of units) assert.equal(unit.status, 'completed');
  } finally {
    db.close();
  }
});

test('T7 resident degrades to windowed without prompt-cache support and records why', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-small.txt', 'src-t7');
    const sharedAdapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(sharedAdapter);
    const worldStore = new SqliteWorldStore(sharedAdapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    const run = await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-t7', worldId: 'w-t7', sourceId: 'src-t7', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'resident',
        budget: { ...RESIDENT_BUDGET, supportsPromptCache: false },
      },
    );
    assert.equal(run.planVersion, 'plan-group-1', 'degraded to the windowed plan');
    assert.equal(run.lastErrorCode, RESIDENT_DEGRADED_NO_CACHE);
    assert.match(run.lastErrorMessage ?? '', /前缀缓存/);

    const groupExtractor = fixtureGroupExtractor();
    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 't7', budget: { ...RESIDENT_BUDGET, supportsPromptCache: false },
    }, 'run-t7');
    assert.equal(done.completed, true, 'the windowed fallback completes the run');
    // The windowed path used extract(), never a resident request.
    assert.equal(groupExtractor.calls > 0, true);
  } finally {
    db.close();
  }
});

test('resident viability: oversized books degrade with the window-ratio reason', () => {
  const chunks = Array.from({ length: 900 }, (_, i) => ({
    chunkId: `c${i}`, chapterId: 'ch', chunkIndex: i,
    startOffset: i * 1_200, endOffset: (i + 1) * 1_200, charCount: 1_200, contentHash: 'h',
  }));
  // 900 x 1200 = 1.08M cp > 1M x 0.85.
  const tooLarge = assessResidentViability(chunks, RESIDENT_BUDGET);
  assert.equal(tooLarge.viable, false);
  assert.equal(tooLarge.code, RESIDENT_DEGRADED_TOO_LARGE);

  const fits = assessResidentViability(chunks.slice(0, 500), RESIDENT_BUDGET);
  assert.equal(fits.viable, true);

  const noBudget = assessResidentViability(chunks.slice(0, 10), undefined);
  assert.equal(noBudget.viable, false);
});

test('TPM scheduling conservatively caps workers (cached traffic counts in full)', () => {
  assert.equal(capWorkersByTpm(3, undefined, 1_000_000), 3, 'no TPM info keeps the requested workers');
  assert.equal(capWorkersByTpm(3, 3_000_000, 1_000_000), 2, '3M TPM x 0.7 / 1M prompt = 2 workers');
  assert.equal(capWorkersByTpm(4, 3_000_000, 1_000_000), 2);
  assert.equal(capWorkersByTpm(3, 1_000_000, 1_000_000), 1, '1M TPM x 0.7 / 1M prompt = 1 worker');
  assert.equal(capWorkersByTpm(9, undefined, 100), 4, 'requested workers cap at 4');
});
