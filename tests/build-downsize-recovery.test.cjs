// Build-downsize recovery: only known provider rejections may split work.
// An unobservable timeout retains its original identity for review. Input-too-
// large 4xx may shrink the queued source ratio
// (the "构建阶段 0/N 永远无法推进" stall). Also covers provider 400 error text
// capture: sanitized, length-capped, and persisted on the request metric.
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
  createExtractionRun,
  executeRun,
} = require('../dist/application/worldBuild/coordinator');
const { LlmRequestFailure } = require('../dist/application/llm/types');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
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

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

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

async function prepareActiveSqliteSource(db, fixtureName, sourceId) {
  const store = new SqliteSourceStore(new NodeSqliteAdapter(db));
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', fixtureName));
  const source = new NodeTextSource(bytes);
  const now = '2026-10-01T12:00:00.000Z';
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

async function fixtureGroupFacts(fixture, segments) {
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
}

/** Transport-level abort at the 300s cap, shaped exactly like production. */
function timeoutFailure() {
  return new LlmRequestFailure('LLM 请求超时（300 秒）。推理模型的思维链可能需要更长时间。', [
    { attempt: 1, durationMs: 300_029, httpStatus: null, outcome: 'transport_error', errorCategory: 'timeout' },
  ]);
}

/** Deterministic provider rejection: the endpoint's real window is smaller
 * than the declared one, so the identical body can never succeed. */
function contextOverflowFailure() {
  const text = "This model's maximum context length is 131072 tokens. However, you requested 141555 tokens.";
  return new LlmRequestFailure(text, [
    {
      attempt: 1, durationMs: 1_200, httpStatus: 400, outcome: 'http_error',
      errorCategory: 'provider_http', providerErrorText: text,
    },
  ]);
}

const BUDGET = {
  contextWindowTokens: 30_000, maxContentOutputTokens: 3_000, reasoningReserveTokens: 0,
  reasoningEffort: 'low', supportsPromptCache: false, reserveTokens: 2_000,
};

async function runDownsizeScenario(db, makeFailure) {
  const { store: sourceStore, result } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-downsize');
  const adapter = new NodeSqliteAdapter(db);
  const runStore = new SqliteBuildRunStore(adapter);
  const worldStore = new SqliteWorldStore(adapter);
  const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
  await createExtractionRun(
    { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
    {
      runId: 'run-downsize', worldId: 'w-downsize', sourceId: 'src-downsize',
      modelFingerprint: 'ep#m', title: 't', extractorVersion: fixture.version,
      mode: 'group', budget: BUDGET,
    },
  );
  const before = await runStore.listUnits('run-downsize');
  assert.ok(before.length >= 4, 'several batches planned');
  assert.ok(before.every(unit => parseRanges(unit).length > 1), 'multi-slice batches for the split path');

  let failedOnce = false;
  const groupExtractor = {
    version: 'llm-group-extractor-1',
    async extract({ segments }) {
      if (!failedOnce && segments.length > 1) {
        failedOnce = true;
        throw makeFailure();
      }
      return fixtureGroupFacts(fixture, segments);
    },
  };
  const done = await executeRun({
    sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
    sha256Hex: sha.sha256Hex, owner: 'downsize', budget: BUDGET,
  }, 'run-downsize');

  const units = await runStore.listUnits('run-downsize');
  const run = await runStore.getRun('run-downsize');
  const planState = JSON.parse(run.planStateJson);
  const allChunksDone = async () => {
    for (const chunk of result.chunks) {
      const job = await worldStore.getJob('w-downsize', `job-extract-${chunk.chunkId}`);
      if (job?.status !== 'done') return false;
    }
    return true;
  };
  return { done, units, planState, allChunksDone };
}

function parseRanges(unit) {
  const parsed = JSON.parse(unit.sourceRangesJson);
  return Array.isArray(parsed) ? parsed : parsed.ranges;
}

test('timeout retains the original batch and source ratio for unknown-outcome review', async () => {
  const db = setupDb();
  try {
    const { done, units, planState, allChunksDone } = await runDownsizeScenario(db, timeoutFailure);
    assert.equal(done.completed, false);
    assert.ok(units.some(u => u.status === 'needs_review' && u.errorCode === 'outcome_unknown'));
    assert.ok(units.every(u => u.status !== 'canceled' && u.parentUnitId === null), 'no unknown dispatch is replaced by split work');
    assert.equal(planState.sourceRatio, 0.12, 'unknown outcome cannot justify shrinking and redispatching');
    assert.equal(planState.replanCount ?? 0, 0);
    assert.equal(await allChunksDone(), false, 'unfinished coverage remains honest');
  } finally { db.close(); }
});

test('input-too-large 400 splits the batch and the run still completes', async () => {
  const db = setupDb();
  try {
    const { done, units, planState, allChunksDone } = await runDownsizeScenario(db, contextOverflowFailure);
    assert.equal(done.completed, true, 'run completes after context-overflow downsizing');
    assert.ok(units.some(u => u.status === 'canceled'), 'the rejected unit was replaced, not retried as-is');
    assert.ok(units.some(u => u.parentUnitId !== null), 'split children exist');
    assert.equal(planState.sourceRatio, 0.06, 'source ratio stepped down for the tail');
    assert.equal(await allChunksDone(), true, 'every chunk still covered exactly once');
  } finally {
    db.close();
  }
});

test('provider 400 error text is captured, sanitized and surfaced on the metric', async () => {
  const key = 'sk-test-secret-12345678';
  const profile = {
    id: 'default', name: 'GLM', endpoint: 'https://ep.example.com/v1',
    model: 'glm-5.3-flash', keyRef: 'llm.default',
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: 131_072, maxOutputTokens: 8_192,
    },
    reasoningTier: 'low', reasoningDialect: 'glm',
  };
  const secrets = {
    async get() { return key; },
    async set() { throw new Error('unexpected write'); },
  };
  const transport = {
    async post() {
      return {
        status: 400,
        body: JSON.stringify({
          error: { message: `模型生成内容存在不合规风险（${key}），请求已被拒绝。` },
        }),
      };
    },
  };
  const provider = new OpenAICompatibleProvider(profile, secrets, transport, 1_000);
  await assert.rejects(
    provider.complete({ system: 's', user: 'u', maxOutputTokens: 100 }),
    error => {
      assert.ok(error instanceof LlmRequestFailure, 'fails as LlmRequestFailure');
      const metric = error.requestMetrics[error.requestMetrics.length - 1];
      assert.equal(metric.httpStatus, 400);
      assert.ok(metric.providerErrorText.includes('不合规'), 'provider reason captured');
      assert.equal(metric.providerErrorText.includes(key), false, 'credential redacted');
      assert.ok(metric.providerErrorText.length <= 300, 'length-capped for persistence');
      return true;
    },
  );
});

test('content-moderation 400 splits the batch in half; the clean half completes, no tail shrink', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore, result } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-mod');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-mod', worldId: 'w-mod', sourceId: 'src-mod',
        modelFingerprint: 'ep#m', title: 't', extractorVersion: fixture.version,
        mode: 'group', budget: BUDGET,
      },
    );
    const before = await runStore.listUnits('run-mod');
    const target = before.find(unit => parseRanges(unit).length > 2) ?? before[0];

    let moderationFired = false;
    const groupExtractor = {
      version: 'llm-group-extractor-1',
      async extract({ segments, unitId }) {
        // The ORIGINAL target batch trips the filter once; every split child
        // and every other batch extracts cleanly.
        if (!moderationFired && unitId === target.unitId) {
          moderationFired = true;
          const text = '系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示语。';
          throw new LlmRequestFailure(`模型服务请求失败（HTTP 400，unknown）：${text}`, [
            { attempt: 1, durationMs: 900, httpStatus: 400, outcome: 'http_error',
              errorCategory: 'provider_http', providerErrorText: text },
          ]);
        }
        return fixtureGroupFacts(fixture, segments);
      },
    };
    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 'mod', budget: BUDGET,
    }, 'run-mod');

    assert.equal(moderationFired, true, 'the moderation rejection fired');
    assert.equal(done.completed, true, 'run completes after the split');
    const units = await runStore.listUnits('run-mod');
    const children = units.filter(unit => unit.parentUnitId === target.unitId);
    assert.equal(children.length, 2, 'the flagged batch split into exactly two halves');
    assert.ok(children.every(unit => unit.status === 'completed' || unit.status === 'canceled'),
      'both halves done (or superseded by a later calibrated replan)');
    assert.equal(units.find(unit => unit.unitId === target.unitId)?.status, 'canceled',
      'the flagged parent is canceled, never retried');
    assert.ok(!units.some(unit => unit.status === 'needs_review'),
      'no unit needed human review after the downsize');
    const run = await runStore.getRun('run-mod');
    const planState = JSON.parse(run.planStateJson);
    assert.ok((planState.sourceRatio ?? 0.3) >= 0.12,
      'a moderation reject must NOT shrink the queued tail source ratio');
    for (const chunk of result.chunks) {
      const job = await worldStore.getJob('w-mod', `job-extract-${chunk.chunkId}`);
      assert.equal(job?.status, 'done', `coverage preserved for ${chunk.chunkId}`);
    }
  } finally {
    db.close();
  }
});
