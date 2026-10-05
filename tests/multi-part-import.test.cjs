// Multi-part import (product ask 2026-10-01 #2): a project accepts a second
// book; part 2 mirrors world-side chapters/chunks with the `s2-` prefix and
// globally continuing chapter indexes, extraction runs idempotently per
// source, and world ids never collide across parts.
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
    const run = async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try { const value = await work(this); this.db.exec('COMMIT'); return value; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    };
    const pending = this.chain.then(run, run);
    this.chain = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

const sha = {
  async sha256Hex(input) { return crypto.createHash('sha256').update(input, 'utf8').digest('hex'); },
  async sha256BytesHex(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); },
};

function setupDb(untilVersion = Infinity) {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    if (migration.version > untilVersion) break;
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

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
    return {
      text: this.decoder.decode(this.buffer.subarray(offset, end), { stream: !atEof }),
      nextByteOffset: end, atEof,
    };
  }
}

async function activateFixtureSource(db, fixtureName, sourceId) {
  const store = new SqliteSourceStore(new NodeSqliteAdapter(db));
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', fixtureName));
  const source = new NodeTextSource(bytes);
  const now = '2026-10-01T15:00:00.000Z';
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
      fileName: fixtureName, title: fixtureName, status: 'active', createdAt: now, updatedAt: now,
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

const BUDGET = {
  contextWindowTokens: 30_000, maxContentOutputTokens: 3_000, reasoningReserveTokens: 0,
  reasoningEffort: 'low', supportsPromptCache: false, reserveTokens: 2_000,
};

test('current source catalog belongs to the single fresh schema', () => {
  const db = setupDb();
  try { assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='world_sources'").get()); }
  finally { db.close(); }
});


test('part 2 mirrors with s2- prefix and continuing chapter indexes; both runs complete', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    const worldId = 'world-multi-part';

    const part1 = await activateFixtureSource(db, 'novel-small.txt', 'src-part1');
    const part2 = await activateFixtureSource(db, 'novel-medium.txt', 'src-part2');
    assert.notEqual(part1.result.chapters.length, 0);
    assert.notEqual(part2.result.chapters.length, 0);

    await createExtractionRun(
      { sourceStore: part1.store, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-p1', worldId, sourceId: 'src-part1', modelFingerprint: 'ep#m',
        title: '两部曲', extractorVersion: fixture.version, mode: 'group', budget: BUDGET,
      },
    );
    await createExtractionRun(
      { sourceStore: part2.store, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-p2', worldId, sourceId: 'src-part2', modelFingerprint: 'ep#m',
        title: '两部曲', extractorVersion: fixture.version, mode: 'group', budget: BUDGET,
      },
    );

    // Membership: two parts, ordinals 1 and 2, in import order.
    const memberships = await worldStore.listWorldSources(worldId);
    assert.equal(memberships.length, 2);
    assert.equal(memberships[0].sourceOrdinal, 1);
    assert.equal(memberships[0].sourceId, 'src-part1');
    assert.equal(memberships[1].sourceOrdinal, 2);
    assert.equal(memberships[1].sourceId, 'src-part2');
    assert.equal((await worldStore.findWorldOfSource('src-part2')).worldId, worldId);

    // World-side mirror: part 1 native ids, part 2 prefixed + continuing index.
    const chapters = await worldStore.getChapters(worldId);
    const part1Chapters = chapters.filter(chapter => !chapter.chapterId.startsWith('s2-'));
    const part2Chapters = chapters.filter(chapter => chapter.chapterId.startsWith('s2-'));
    assert.equal(part1Chapters.length, part1.result.chapters.length, 'part 1 keeps native ids');
    assert.equal(part2Chapters.length, part2.result.chapters.length, 'part 2 fully mirrored');
    const indexes = chapters.map(chapter => chapter.index);
    assert.deepEqual([...indexes].sort((a, b) => a - b), indexes,
      'chapter indexes continue globally without collision');
    const maxPart1Index = Math.max(...part1Chapters.map(chapter => chapter.index));
    for (const chapter of part2Chapters) {
      assert.ok(chapter.index > maxPart1Index, 'part 2 indexes come after part 1');
    }

    // Both runs execute to completion over the fixture extractor with no
    // cross-part id collisions (world_jobs PKs stay unique).
    const groupExtractor = {
      version: fixture.version,
      async extract({ segments }) {
        const entities = new Map(); const facts = []; const events = [];
        for (const segment of segments) {
          const perChunk = await fixture.extract({
            chunk: {
              chunkId: segment.chunkId, chapterId: segment.chapterId, chunkIndex: 0,
              startOffset: segment.startCp, endOffset: segment.startCp + [...segment.text].length,
              charCount: [...segment.text].length, contentHash: 'x',
            },
            chunkText: segment.text, worldId,
          });
          for (const entity of perChunk.entities) entities.set(entity.entityKey, entity);
          for (const fact of perChunk.facts) facts.push({ ...fact, chunkId: segment.chunkId });
          for (const event of perChunk.events) events.push({ ...event, chunkId: segment.chunkId });
        }
        return { entities: [...entities.values()], facts, events, ruleMappings: [], rejectedQuotes: 0 };
      },
    };
    const done1 = await executeRun({
      sourceStore: part1.store, runStore, worldStore,
      extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 'mp1', budget: BUDGET,
    }, 'run-p1');
    assert.equal(done1.completed, true, 'part 1 run completes');
    const done2 = await executeRun({
      sourceStore: part2.store, runStore, worldStore,
      extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 'mp2', budget: BUDGET,
    }, 'run-p2');
    assert.equal(done2.completed, true, 'part 2 run completes');

    // Chunk jobs: every world-side chunk has a done extraction job, and part
    // 2's jobs are keyed by the prefixed ids (no overlap with part 1).
    const jobRows = db.prepare(
      "SELECT job_id FROM world_jobs WHERE world_id = ? AND status = 'done'",
    ).all(worldId);
    const doneJobIds = new Set(jobRows.map(row => row.job_id));
    for (const chapter of part2Chapters) {
      assert.ok(
        [...doneJobIds].some(id => id.includes(chapter.chapterId)),
        `a done job references mirrored chapter ${chapter.chapterId}`,
      );
    }
    const dup = db.prepare(
      `SELECT chapter_id, COUNT(*) c FROM source_chapters WHERE world_id = ? GROUP BY chapter_id HAVING c > 1`,
    ).all(worldId);
    assert.equal(dup.length, 0, 'no duplicate world chapter ids across parts');
  } finally {
    db.close();
  }
});

test('re-registering the same source keeps its ordinal and does not re-mirror', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    const part1 = await activateFixtureSource(db, 'novel-small.txt', 'src-part1');
    await createExtractionRun(
      { sourceStore: part1.store, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-a', worldId: 'world-idem', sourceId: 'src-part1', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget: BUDGET,
      },
    );
    const chaptersAfterFirst = (await worldStore.getChapters('world-idem')).length;
    await createExtractionRun(
      { sourceStore: part1.store, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-b', worldId: 'world-idem', sourceId: 'src-part1', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget: BUDGET,
      },
    );
    const memberships = await worldStore.listWorldSources('world-idem');
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0].sourceOrdinal, 1);
    assert.equal((await worldStore.getChapters('world-idem')).length, chaptersAfterFirst,
      'mirror rows unchanged by re-registration');
  } finally {
    db.close();
  }
});
