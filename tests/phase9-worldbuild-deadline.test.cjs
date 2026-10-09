'use strict';
// R66 (handoff 2026-10-09): two real-path defects found while resuming the
// bounded CP6400-6800 jail segment after R65.
//
// 1) High-tier world-build passes (world_extract on the API35 device, then
//    world_mapping on this host) both hit the base 300s transport deadline
//    with outcome_unknown, because physicalRequestTimeoutMs only extended
//    campaign_plan. GLM high-tier thinking regularly runs 465-710s here.
// 2) When the paid mapping request ends transport-unknown, the coordinator
//    classifies the wrapped Chinese message as mapping_configuration_required
//    / failed_retryable instead of parking the run in needs_review with the
//    ledger-review message, inviting a resume that misinforms the user.
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
const { createExtractionRun, executeRun } = require('../dist/application/worldBuild/coordinator');
const { physicalRequestTimeoutMs } = require('../dist/application/llm/requestDeadline');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
const { freezeRunConfig, reviveRunConfig, providerProfileFromFrozen, frozenConfigIdentity } = require('../dist/application/worldBuild/runConfig');
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

async function prepareActiveSqliteSource(db, bytes, sourceId) {
  const store = new SqliteSourceStore(new NodeSqliteAdapter(db));
  const source = new NodeTextSource(bytes);
  const now = '2026-10-09T00:00:00.000Z';
  await store.beginStaging({
    sourceId, rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
    codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
    chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
    splitStrategy: 'standard', fileName: 'n.txt', title: null,
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
      normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
      normalizeShardScheme: 'normalize-shard-1', splitStrategy: 'standard',
      fileName: 'n.txt', title: null, status: 'active', createdAt: now, updatedAt: now,
    },
    chapters: result.chapters, chunks: result.chunks,
  });
  return { store };
}

test('elevated world-build passes share the bounded planning operation deadline', () => {
  const base = 300_000;
  // Same contract as campaign_plan: high -> 900s, max -> 1200s, never below base.
  for (const kind of ['world_extract', 'world_mapping', 'world_adjudication', 'timeline', 'registry']) {
    assert.equal(physicalRequestTimeoutMs(base, kind, 'high'), 900_000, `${kind} high`);
    assert.equal(physicalRequestTimeoutMs(base, kind, 'max'), 1_200_000, `${kind} max`);
    assert.equal(physicalRequestTimeoutMs(base, kind, 'low'), base, `${kind} low keeps the short-call base`);
  }
  // Planning behavior stays unchanged.
  assert.equal(physicalRequestTimeoutMs(base, 'campaign_plan', 'high'), 900_000);
  assert.equal(physicalRequestTimeoutMs(base, 'campaign_plan', 'low'), base);
  assert.equal(physicalRequestTimeoutMs(base, 'planner', 'high'), base, 'per-turn kinds keep the base');
  // A longer operator-configured base is still capped at the 1200s bound.
  assert.equal(physicalRequestTimeoutMs(1_500_000, 'world_mapping', 'high'), 1_200_000);
});

test('transport-unknown mapping failure parks the run for ledger review, not as a config failure', async () => {
  const db = setupDb();
  try {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
    const { store: sourceStore } = await prepareActiveSqliteSource(db, bytes, 'src-r66-unknown');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const extractor = new FixtureExtractor({ knownNames: [] });
    await createExtractionRun({ sourceStore, runStore, worldStore }, {
      runId: 'run-r66-unknown', worldId: 'world-r66-unknown', sourceId: 'src-r66-unknown',
      modelFingerprint: 'ep#model', title: 't', extractorVersion: extractor.version,
    });
    const result = await executeRun({
      sourceStore, runStore, worldStore, extractor, sha256Hex: sha.sha256Hex,
      onFinalize: async () => {
        // Exact shape produced by buildPackagePipeline wrapping the shared
        // transport's deadline error on the real CP6400-6800 mapping attempt.
        throw new Error(
          '小说→三宝书映射失败，未发布任何版本：LLM 请求已达到传输时限（300 秒），结果未知，请核对请求账本。。抽取成果已保存，重新构建将从已完成的进度续建。',
        );
      },
    }, 'run-r66-unknown');
    assert.equal(result.completed, false);
    const run = await runStore.getRun('run-r66-unknown');
    assert.equal(run.status, 'needs_review', 'an unknown paid outcome must park for ledger review');
    assert.equal(run.lastErrorCode, 'outcome_unknown');
    assert.match(run.lastErrorMessage, /未知|账本/);
    assert.equal(run.unitsDone, run.unitsTotal, 'the paid extraction is retained');
  } finally {
    db.close();
  }
});

test('frozen run configs preserve SSE capability; legacy configs keep their buffered identity', async () => {
  const streamingProfile = { id: 'p', name: 'P', endpoint: 'https://example.invalid/v1', model: 'glm-5.3-flash', keyRef: 'k',
    reasoningTier: 'high', capabilities: { contextWindow: 1048576, maxOutputTokens: 65536, supportsJson: true, supportsStreaming: true } };
  const bufferedProfile = { ...streamingProfile, capabilities: { ...streamingProfile.capabilities, supportsStreaming: false } };
  const budget = { contextWindowTokens: 1048576, maxContentOutputTokens: 6000, reasoningReserveTokens: 16384,
    reasoningTier: 'high', reasoningDialect: 'glm', supportsPromptCache: true };
  const streaming = freezeRunConfig(streamingProfile, budget);
  const buffered = freezeRunConfig(bufferedProfile, budget);
  assert.equal(streaming.supportsStreaming, true, 'streaming capability is frozen');
  assert.equal(buffered.supportsStreaming, undefined, 'non-streaming profiles freeze nothing');
  const revivedStreaming = reviveRunConfig(JSON.stringify(streaming));
  const revivedBuffered = reviveRunConfig(JSON.stringify(buffered));
  assert.equal(revivedStreaming.supportsStreaming, true, 'revive keeps the capability');
  assert.equal(providerProfileFromFrozen(revivedStreaming).capabilities.supportsStreaming, true);
  assert.equal(revivedBuffered.supportsStreaming, undefined);
  assert.equal(providerProfileFromFrozen(revivedBuffered).capabilities.supportsStreaming, false, 'legacy buffered identity survives');
  // Transport mode never invalidates paid extraction checkpoints.
  assert.equal(frozenConfigIdentity(revivedStreaming), frozenConfigIdentity(revivedBuffered));
  // End-to-end: a provider built from the revived streaming frozen profile
  // actually puts SSE on the wire for an elevated world-build pass.
  let wire;
  const provider = new OpenAICompatibleProvider(providerProfileFromFrozen(revivedStreaming),
    { async get() { return 'sk-test-key-1234567890abcdef'; } }, { async post(r) {
      wire = JSON.parse(r.body);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'x',
        choices: [{ index: 0, message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
    } }, 300000);
  await provider.complete({ role: 'WorldMapper', system: 's', user: 'u', maxOutputTokens: 6000,
    jsonMode: true, requestKind: 'world_mapping', maxPhysicalRequests: 1 });
  assert.equal(wire.stream, true, 'frozen streaming config streams the mapping request');
});

test('elevated world-build passes request SSE delivery when the profile streams', async () => {
  const profile = { id: 'r66', name: 'R66', endpoint: 'https://example.invalid/v1', model: 'glm-5.3-flash', keyRef: 'k',
    reasoningTier: 'high', capabilities: { contextWindow: 1048576, maxOutputTokens: 65536, supportsJson: true, supportsStreaming: true } };
  const event = data => 'data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n';
  const chunk = (delta, finish_reason = null) => ({ id: 's1', choices: [{ index: 0, delta, finish_reason }] });
  const usage = { prompt_tokens: 5, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 4 } };
  const body = event(chunk({ reasoning_content: 't' })) + event(chunk({ content: '{"ok":1}' }))
    + event({ ...chunk({}, 'stop'), usage }) + event('[DONE]');
  const wireFor = async (patch, p = profile) => {
    let wire;
    const provider = new OpenAICompatibleProvider(p, { async get() { return 'k'; } }, { async post(r) {
      wire = JSON.parse(r.body); return { status: 200, headers: { 'content-type': 'text/event-stream' }, body };
    } }, 300000);
    await provider.complete({ role: 'WorldMapper', system: 's', user: 'u', maxOutputTokens: 18288, maxPhysicalRequests: 1, ...patch });
    return wire;
  };
  // Real failure shape: buffered world_mapping through the gateway died
  // server-side at ~300s while the same tier streamed to completion.
  assert.equal((await wireFor({ requestKind: 'world_mapping' })).stream, true, 'world_mapping high streams');
  assert.equal((await wireFor({ requestKind: 'world_extract' })).stream, true, 'world_extract high streams');
  assert.equal((await wireFor({ requestKind: 'campaign_plan' })).stream, true, 'planning keeps streaming');
  assert.equal((await wireFor({ requestKind: 'world_mapping', reasoningTier: 'low' })).stream, false, 'low tier stays buffered');
  assert.equal((await wireFor({ requestKind: 'world_mapping' }, { ...profile,
    capabilities: { ...profile.capabilities, supportsStreaming: false } })).stream, false, 'non-streaming profile stays buffered');
  assert.equal((await wireFor({ requestKind: 'narrator' })).stream, false, 'per-turn kinds stay buffered');
});

test('a mid-request network disconnect carries the unknown-outcome phrase; a proven not-sent does not', async () => {
  const profile = { id: 'r66b', name: 'R66b', endpoint: 'https://example.invalid/v1', model: 'glm-5.3-flash', keyRef: 'k',
    reasoningTier: 'high', capabilities: { contextWindow: 1048576, maxOutputTokens: 65536, supportsJson: true, supportsStreaming: false } };
  const withTransport = transport => new OpenAICompatibleProvider(profile, { async get() { return 'sk-test-key-1234567890abcdef'; } }, transport, 300000);
  // Real attempt #2 shape: upstream closed the connection ("socket hang up")
  // after the request was sent - outcome unknown, must say so.
  await assert.rejects(withTransport({ async post() { throw new Error('socket hang up'); } })
    .complete({ role: 'WorldMapper', system: 's', user: 'u', maxOutputTokens: 100, requestKind: 'world_mapping', maxPhysicalRequests: 1 }),
    e => { assert.match(e.message, /socket hang up/); assert.match(e.message, /结果未知，请核对请求账本/); return true; });
  // Structured not-sent evidence keeps the clean network message.
  await assert.rejects(withTransport({ async post() { const err = new Error('connect ECONNREFUSED 127.0.0.1:443'); err.code = 'ECONNREFUSED'; throw err; } })
    .complete({ role: 'WorldMapper', system: 's', user: 'u', maxOutputTokens: 100, requestKind: 'world_mapping', maxPhysicalRequests: 1 }),
    e => { assert.equal(e.message.includes('结果未知'), false); return true; });
});

test('a wrapped socket-hang-up mapping failure parks the run for ledger review', async () => {
  const db = setupDb();
  try {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
    const { store: sourceStore } = await prepareActiveSqliteSource(db, bytes, 'src-r66-hangup');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const extractor = new FixtureExtractor({ knownNames: [] });
    await createExtractionRun({ sourceStore, runStore, worldStore }, {
      runId: 'run-r66-hangup', worldId: 'world-r66-hangup', sourceId: 'src-r66-hangup',
      modelFingerprint: 'ep#model', title: 't', extractorVersion: extractor.version,
    });
    await executeRun({
      sourceStore, runStore, worldStore, extractor, sha256Hex: sha.sha256Hex,
      onFinalize: async () => {
        throw new Error('小说→三宝书映射失败，未发布任何版本：socket hang up；请求结果未知，请核对请求账本。。抽取成果已保存，重新构建将从已完成的进度续建。');
      },
    }, 'run-r66-hangup');
    const run = await runStore.getRun('run-r66-hangup');
    assert.equal(run.status, 'needs_review');
    assert.equal(run.lastErrorCode, 'outcome_unknown');
  } finally {
    db.close();
  }
});

test('a known mapping configuration failure keeps its retryable classification', async () => {
  const db = setupDb();
  try {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
    const { store: sourceStore } = await prepareActiveSqliteSource(db, bytes, 'src-r66-known');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const extractor = new FixtureExtractor({ knownNames: [] });
    await createExtractionRun({ sourceStore, runStore, worldStore }, {
      runId: 'run-r66-known', worldId: 'world-r66-known', sourceId: 'src-r66-known',
      modelFingerprint: 'ep#model', title: 't', extractorVersion: extractor.version,
    });
    await executeRun({
      sourceStore, runStore, worldStore, extractor, sha256Hex: sha.sha256Hex,
      onFinalize: async () => {
        throw new Error('小说→三宝书映射失败，未发布任何版本：HTTP 401 unauthorized。抽取成果已保存，重新构建将从已完成的进度续建。');
      },
    }, 'run-r66-known');
    const run = await runStore.getRun('run-r66-known');
    assert.equal(run.status, 'failed_retryable', 'a known explicit rejection stays retryable');
    assert.equal(run.lastErrorCode, 'mapping_configuration_required');
  } finally {
    db.close();
  }
});
