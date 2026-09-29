// 1M resident build P3 regression suite: Pass 0 whole-book entity registry
// (plan §4.3) - one bounded request over the byte-stable prefix, entity
// seeds via upsertEntity, checkpoint idempotency, summary injection into
// resident scope instructions, and degradation on registry failure.
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
const {
  buildBookRegistry,
  registrySummaryFor,
  registryJobId,
  BOOK_REGISTRY_VERSION,
  REGISTRY_MAX_OUTPUT_TOKENS,
} = require('../dist/application/world/bookRegistry');
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

async function prepareWorld(db) {
  const store = new SqliteSourceStore(new NodeSqliteAdapter(db));
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
  const decoder = new TextDecoder('utf-8');
  const source = {
    encoding: 'utf-8',
    rawSha256Hex: crypto.createHash('sha256').update(bytes).digest('hex'),
    get byteLength() { return bytes.length; },
    async readText(offset, maxBytes) {
      const end = Math.min(offset + maxBytes, bytes.length);
      return { text: decoder.decode(bytes.subarray(offset, end), { stream: end < bytes.length }), nextByteOffset: end, atEof: end >= bytes.length };
    },
  };
  const now = '2026-09-28T12:00:00.000Z';
  await store.beginStaging({
    sourceId: 'src-p3', rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
    codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
    chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
    splitStrategy: 'standard', fileName: 'novel-small.txt', title: null,
    status: 'staging', createdAt: now, updatedAt: now,
  });
  const result = await importTxtSourceStreaming(source, store, 'src-p3', {
    sha256Hex: sha.sha256Hex, sha256BytesHex: sha.sha256BytesHex,
  });
  await store.activateSource({
    manifest: {
      sourceId: 'src-p3', rawSha256Hex: result.rawSha256Hex, normalizedTreeHash: result.normalizedTreeHash,
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: result.byteLength,
      codePointCount: result.codePointCount, encoding: result.encoding,
      normalizeVersion: result.normalizeVersion, chapterSplitVersion: result.chapterSplitVersion,
      normalizeShardScheme: result.normalizeShardScheme, splitStrategy: result.splitStrategy,
      fileName: 'novel-small.txt', title: null, status: 'active', createdAt: now, updatedAt: now,
    },
    chapters: result.chapters, chunks: result.chunks,
  });
  const sharedAdapter = new NodeSqliteAdapter(db);
  return {
    sourceStore: store,
    runStore: new SqliteBuildRunStore(sharedAdapter),
    worldStore: new SqliteWorldStore(sharedAdapter),
  };
}

const REGISTRY_JSON = JSON.stringify({
  entities: [
    { key: '陈青云', type: 'character', name: '陈青云', aliases: ['青云'] },
    { key: '离火教', type: 'faction', name: '离火教', aliases: [] },
    { key: '青岚派', type: 'faction', name: '青岚派', aliases: [] },
    { key: '', type: 'character', name: 'dropped' },
    { key: 'bad-type', type: 'planet', name: 'dropped' },
  ],
});

test('Pass 0 registry: one bounded request, entity seeds, idempotent checkpoint', async () => {
  const db = setupDb();
  try {
    const { worldStore } = await prepareWorld(db);
    await worldStore.createWorld({
      worldId: 'w-p3', title: 't', sourceSha256: 'x', sourceBytes: 1,
      normalizeVersion: 'normalize-1', chapterSplitVersion: 'chapter-split-1',
      buildStatus: 'extracting', createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
    });
    let calls = 0;
    let seenRequest = null;
    const registry = await buildBookRegistry({
      worldStore,
      complete: async request => {
        calls += 1;
        seenRequest = request;
        return { text: REGISTRY_JSON };
      },
      segmentBody: '[S1 第一章]\n全书正文……',
      worldId: 'w-p3',
      modelFingerprint: 'ep#m',
      createdAt: '2026-09-29T00:00:00.000Z',
      contentHash: 'book-hash-1',
    });
    assert.equal(calls, 1);
    assert.equal(seenRequest.maxOutputTokens, REGISTRY_MAX_OUTPUT_TOKENS, 'output stays <= 8k (plan §4.3)');
    assert.equal(seenRequest.reasoningEffort, 'high', 'registry runs the hard-thinking profile');
    assert.equal(seenRequest.role, 'WorldMapper');
    assert.equal(registry.reused, false);
    assert.equal(registry.entities.length, 3, 'malformed entries dropped');

    // Entity seeds landed through upsertEntity.
    const entities = await worldStore.listEntities('w-p3');
    assert.equal(entities.length, 3);
    assert.ok(entities.some(entity => entity.name === '陈青云'));

    // Checkpoint: a second build with the SAME content hash reuses without
    // paying another request; a different hash re-requests.
    const again = await buildBookRegistry({
      worldStore,
      complete: async () => { calls += 1; return { text: REGISTRY_JSON }; },
      segmentBody: '[S1 第一章]\n全书正文……',
      worldId: 'w-p3',
      modelFingerprint: 'ep#m',
      createdAt: '2026-09-29T00:01:00.000Z',
      contentHash: 'book-hash-1',
    });
    assert.equal(again.reused, true);
    assert.equal(calls, 1, 'no second request for the same book');
    assert.equal(again.entities.length, 3);

    const job = await worldStore.getJob('w-p3', registryJobId('w-p3'));
    assert.equal(job.status, 'done');
    assert.equal(job.extractorVersion, BOOK_REGISTRY_VERSION);
    assert.equal(job.contentHash, 'book-hash-1');
  } finally {
    db.close();
  }
});

test('registry summary is compact, deterministic and bounded', () => {
  const entities = Array.from({ length: 100 }, (_, i) => ({
    entityKey: `k${i}`, type: 'character', name: `k${i}`, aliases: [],
  }));
  const summary = registrySummaryFor(entities);
  const parts = summary.split('，');
  assert.equal(parts.length, 80, 'bounded at 80 entries');
  assert.equal(parts[0], 'k0:character');
  assert.equal(registrySummaryFor([]), '');
});

test('resident run injects the registry summary into every scope instruction', async () => {
  const db = setupDb();
  try {
    const { sourceStore, runStore, worldStore } = await prepareWorld(db);
    const fixture = new FixtureExtractor({ knownNames: ['陈青云'] });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-p3a', worldId: 'w-p3a', sourceId: 'src-p3', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'resident',
        budget: {
          contextWindowTokens: 1_048_576, maxContentOutputTokens: 16_384,
          reasoningReserveTokens: 2_048, reasoningEffort: 'low',
          supportsPromptCache: true, reserveTokens: 2_000,
        },
      },
    );
    const requests = [];
    const groupExtractor = new LlmGroupExtractor(async request => {
      requests.push(request);
      return { text: JSON.stringify({ entities: [], facts: [], events: [] }) };
    });
    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 'p3a',
      buildRegistry: async () => '陈青云:character，离火教:faction',
    }, 'run-p3a');
    assert.equal(done.completed, true);
    assert.ok(requests.length >= 1);
    for (const request of requests) {
      assert.match(request.followUpUserMessages[0], /陈青云:character，离火教:faction/);
      assert.match(request.followUpUserMessages[0], /注册表/);
    }
  } finally {
    db.close();
  }
});

test('registry failure degrades to a registry-free resident run', async () => {
  const db = setupDb();
  try {
    const { sourceStore, runStore, worldStore } = await prepareWorld(db);
    const fixture = new FixtureExtractor({ knownNames: ['陈青云'] });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-p3b', worldId: 'w-p3b', sourceId: 'src-p3', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'resident',
        budget: {
          contextWindowTokens: 1_048_576, maxContentOutputTokens: 16_384,
          reasoningReserveTokens: 2_048, reasoningEffort: 'low',
          supportsPromptCache: true, reserveTokens: 2_000,
        },
      },
    );
    const requests = [];
    const groupExtractor = new LlmGroupExtractor(async request => {
      requests.push(request);
      return { text: JSON.stringify({ entities: [], facts: [], events: [] }) };
    });
    const done = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 'p3b',
      buildRegistry: async () => { throw new Error('registry endpoint down'); },
    }, 'run-p3b');
    assert.equal(done.completed, true, 'the registry is an enhancement, never a gate');
    for (const request of requests) {
      assert.doesNotMatch(request.followUpUserMessages[0], /注册表中已有的 key/);
    }
  } finally {
    db.close();
  }
});
