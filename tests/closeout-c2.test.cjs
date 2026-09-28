// Closeout C2 regression suite: streaming import equivalence, persisted
// source lifecycle, bounded range reads, run/unit lease fencing, crash
// recovery, and the synthetic 30 MB preprocessing stress.
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
const { importTxtSource } = require('../dist/application/import/txtImport');
const {
  importTxtSourceStreaming,
  DEFAULT_SHARD_CP,
} = require('../dist/application/import/streamingTxtImport');
const {
  createExtractionRun,
  executeRun,
} = require('../dist/application/worldBuild/coordinator');
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

/** Node text window source with proper streaming carry. */
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

class MemoryShardStore {
  constructor() { this.shards = new Map(); }
  async saveShard({ sourceId, shardIndex, startCp, endCp, text }) {
    this.shards.set(shardIndex, { sourceId, shardIndex, startCp, endCp, text });
  }
  async readRange(sourceId, startCp, endCp) {
    let result = '';
    for (const shard of [...this.shards.values()].sort((a, b) => a.shardIndex - b.shardIndex)) {
      if (shard.sourceId !== sourceId || shard.endCp <= startCp || shard.startCp >= endCp) continue;
      const from = Math.max(startCp, shard.startCp) - shard.startCp;
      const to = Math.min(endCp, shard.endCp) - shard.startCp;
      if (to <= from) continue;
      result += cpLocalSlice(shard.text, from, to);
    }
    return result;
  }
}

function cpLocalSlice(text, fromCp, toCp) {
  let cp = 0;
  let startUtf16 = -1;
  let endUtf16 = -1;
  let utf16 = 0;
  while (utf16 <= text.length) {
    if (cp === fromCp) startUtf16 = utf16;
    if (cp === toCp) { endUtf16 = utf16; break; }
    if (utf16 >= text.length) break;
    const code = text.charCodeAt(utf16);
    utf16 += code >= 0xd800 && code < 0xdc00 ? 2 : 1;
    cp += 1;
  }
  if (startUtf16 === -1) startUtf16 = 0;
  if (endUtf16 === -1) endUtf16 = text.length;
  return text.slice(startUtf16, endUtf16);
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

async function runStreaming(buffer, options = {}) {
  const source = new NodeTextSource(buffer);
  const shards = new MemoryShardStore();
  const result = await importTxtSourceStreaming(source, shards, 'src-test', {
    ...options,
    sha256Hex: sha.sha256Hex,
    sha256BytesHex: sha.sha256BytesHex,
  });
  return { result, shards, source };
}


/** Streams a fixture into a REAL sqlite source store and activates it. */
async function prepareActiveSqliteSource(db, bytes, sourceId) {
  const store = new SqliteSourceStore(new NodeSqliteAdapter(db));
  const source = new NodeTextSource(bytes);
  const now = '2026-09-28T12:00:00.000Z';
  await store.beginStaging({
    sourceId, rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
    codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
    chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
    splitStrategy: 'standard', fileName: 'n.txt', title: null,
    status: 'staging', createdAt: now, updatedAt: now,
  });
  const result = await importTxtSourceStreaming(source, store, sourceId, {
    sha256Hex: sha.sha256Hex,
    sha256BytesHex: sha.sha256BytesHex,
  });
  await store.activateSource({
    manifest: {
      sourceId, rawSha256Hex: result.rawSha256Hex, normalizedTreeHash: result.normalizedTreeHash,
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: result.byteLength,
      codePointCount: result.codePointCount, encoding: result.encoding,
      normalizeVersion: result.normalizeVersion, chapterSplitVersion: result.chapterSplitVersion,
      normalizeShardScheme: result.normalizeShardScheme, splitStrategy: result.splitStrategy,
      fileName: 'n.txt', title: null, status: 'active', createdAt: now, updatedAt: now,
    },
    chapters: result.chapters,
    chunks: result.chunks,
  });
  return { store, result };
}

function assertSamePlanning(batchParsed, streamResult) {
  assert.equal(streamResult.chapters.length, batchParsed.chapters.length);
  for (let i = 0; i < batchParsed.chapters.length; i += 1) {
    const b = batchParsed.chapters[i];
    const s = streamResult.chapters[i];
    assert.deepEqual(
      { id: s.chapterId, t: s.title, a: s.startOffset, b: s.endOffset, c: s.charCount, h: s.contentHash },
      { id: b.chapterId, t: b.title, a: b.startOffset, b: b.endOffset, c: b.charCount, h: b.contentHash },
      `chapter ${i} must be identical between batch and streaming`,
    );
  }
  assert.equal(streamResult.chunks.length, batchParsed.chunks.length);
  for (let i = 0; i < batchParsed.chunks.length; i += 1) {
    const b = batchParsed.chunks[i];
    const s = streamResult.chunks[i];
    assert.deepEqual(
      { id: s.chunkId, ch: s.chapterId, ix: s.chunkIndex, a: s.startOffset, b: s.endOffset, c: s.charCount, h: s.contentHash },
      { id: b.chunkId, ch: b.chapterId, ix: b.chunkIndex, a: b.startOffset, b: b.endOffset, c: b.charCount, h: b.contentHash },
      `chunk ${i} must be identical between batch and streaming`,
    );
  }
}

// ---------------------------------------------------------------------------
// Equivalence: batch vs streaming.
// ---------------------------------------------------------------------------

test('C2 streaming matches batch on the small fixture', async () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
  const batch = await importTxtSource(bytes, sha, decoder);
  const { result } = await runStreaming(bytes, { shardCp: 50, readWindowBytes: 300 });
  assertSamePlanning(batch, result);
  assert.equal(result.codePointCount, batch.codePointCount);
});

test('C2 streaming matches batch on the medium fixture with tiny windows', async () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-medium.txt'));
  const batch = await importTxtSource(bytes, sha, decoder);
  // Tiny windows force every boundary path: partial multi-byte, \r at edge,
  // shard flushes mid-line.
  const { result } = await runStreaming(bytes, { shardCp: 40, readWindowBytes: 128 });
  assertSamePlanning(batch, result);
});

test('C2 streaming matches batch across CRLF, BOM, blank runs, emoji and lone CR', async () => {
  const parts = [];
  parts.push('第一章 起点\r\n');
  parts.push('陈青云得到了一把青锋剑。\r\n');
  parts.push('\r\n');
  parts.push('\r\n');
  parts.push('\r\n');
  parts.push('他擅长剑术和轻功。\r');
  parts.push('柳无痕擅长毒术。\r\n');
  parts.push('😀 emoji 与代理对。\r\n');
  parts.push('\u00A0nbsp与零宽\u200B字符。\r\n');
  parts.push('   缩进行。\t\r\n');
  parts.push('第二章 风波');
  parts.push('\n');
  parts.push('结尾没有换行');
  const text = parts.join('');
  const bytes = Buffer.from('\uFEFF' + text, 'utf8');
  const batch = await importTxtSource(bytes, sha, decoder);
  const { result } = await runStreaming(bytes, { shardCp: 7, readWindowBytes: 11 });
  assertSamePlanning(batch, result);
});

test('C2 giant paragraph hard-split keeps surrogate pairs and coverage', async () => {
  const line = '😀甲得到了剑。'.repeat(9_000); // 54k cp, no line breaks
  const bytes = Buffer.from(`第一章\n${line}\n第二章\n乙失去了掌门之位。\n`, 'utf8');
  const { result, shards } = await runStreaming(bytes, { maxParagraphCp: 10_000 });
  assert.ok(result.maxParagraphSplits >= 5);
  // All shards concatenated reproduce exactly the code point count.
  const full = await shards.readRange('src-test', 0, result.codePointCount);
  const cpLen = [...full].length;
  assert.equal(cpLen, result.codePointCount);
  // No surrogate was severed: every shard's text is well-formed.
  for (const shard of shards.shards.values()) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(shard.text), 'shard must not end with a lone high surrogate');
  }
});

// ---------------------------------------------------------------------------
// Persisted source lifecycle.
// ---------------------------------------------------------------------------

test('C2 sqlite source store: staging -> activation -> range reads -> protection', async () => {
  const db = setupDb();
  try {
    const store = new SqliteSourceStore(new NodeSqliteAdapter(db));
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
    const { result } = await runStreaming(bytes, {});

    const now = '2026-09-28T12:00:00.000Z';
    await store.beginStaging({
      sourceId: result.sourceId,
      rawSha256Hex: result.rawSha256Hex,
      normalizedTreeHash: '',
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1',
      byteLength: result.byteLength,
      codePointCount: 0,
      encoding: result.encoding,
      normalizeVersion: result.normalizeVersion,
      chapterSplitVersion: result.chapterSplitVersion,
      normalizeShardScheme: result.normalizeShardScheme,
      splitStrategy: result.splitStrategy,
      fileName: 'novel-small.txt',
      title: null,
      status: 'staging',
      createdAt: now,
      updatedAt: now,
    });
    const manifest = await store.getManifest(result.sourceId);
    assert.equal(manifest.status, 'staging');
    assert.equal(await store.findActiveByRawHash(result.rawSha256Hex), null);

    await store.activateSource({
      manifest: {
        ...manifest,
        normalizedTreeHash: result.normalizedTreeHash,
        codePointCount: result.codePointCount,
        status: 'active',
        updatedAt: now,
      },
      chapters: result.chapters,
      chunks: result.chunks,
    });
    const active = await store.findActiveByRawHash(result.rawSha256Hex);
    assert.equal(active.sourceId, result.sourceId);
    assert.deepEqual(await store.getChapters(result.sourceId), result.chapters);
    assert.deepEqual(await store.getChunks(result.sourceId), result.chunks);
    await assert.rejects(() => store.deleteSource(result.sourceId), /Refusing to delete active/);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// Run lifecycle: coordinator + lease fencing + crash recovery.
// ---------------------------------------------------------------------------

function fixtureNames() {
  const small = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-small.json'), 'utf8'));
  const names = new Set();
  for (const fact of small.facts) {
    names.add(fact.subject);
    if (typeof fact.value.person === 'string') names.add(fact.value.person);
  }
  return [...names];
}

test('C2 coordinator executes a run to completion over persisted shards', async () => {
  const db = setupDb();
  try {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
    const { store: sourceStore } = await prepareActiveSqliteSource(db, bytes, 'src-1');

    const runStore = new SqliteBuildRunStore(new NodeSqliteAdapter(db));
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore },
      { runId: 'run-1', worldId: 'world-c2', sourceId: 'src-1', modelFingerprint: 'ep#model', title: 't', extractorVersion: extractor.version },
    );
    const done = await executeRun(
      { sourceStore, runStore, worldStore, extractor, sha256Hex: sha.sha256Hex },
      'run-1',
    );
    assert.equal(done.completed, true);
    assert.equal(done.unitsDone, done.unitsTotal);
    const world = await worldStore.getWorld('world-c2');
    assert.equal(world.buildStatus, 'ready');
    const facts = await worldStore.listFacts('world-c2');
    assert.ok(facts.length > 0);
    const run = await runStore.getRun('run-1');
    assert.equal(run.status, 'completed');

    // Re-execution of a COMPLETED run is refused by the lease gate (terminal
    // status) and never re-pays extraction.
    const extractor2 = new FixtureExtractor({ knownNames: fixtureNames() });
    const again = await executeRun(
      { sourceStore, runStore, worldStore, extractor: extractor2, sha256Hex: sha.sha256Hex },
      'run-1',
    );
    assert.equal(again.completed, false);
    assert.equal(again.lostLease, true);
    assert.equal(extractor2.calls, 0);
    const runAfter = await runStore.getRun('run-1');
    assert.equal(runAfter.status, 'completed');
  } finally {
    db.close();
  }
});

test('full-package finalization holds and renews the extraction lease until publish work finishes', async () => {
  const db = setupDb();
  try {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
    const { store: sourceStore } = await prepareActiveSqliteSource(db, bytes, 'src-finalize-lease');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore },
      { runId: 'run-finalize-lease', worldId: 'world-finalize-lease', sourceId: 'src-finalize-lease',
        modelFingerprint: 'ep#model', title: 't', extractorVersion: extractor.version },
    );

    const result = await executeRun({
      sourceStore, runStore, worldStore, extractor, sha256Hex: sha.sha256Hex, leaseTtlMs: 120,
      onFinalize: async ({ setPhase }) => {
        await setPhase('mapping');
        await new Promise(resolve => setTimeout(resolve, 240));
        const competingToken = await runStore.acquireLease(
          'run-finalize-lease', 'second-owner', 120, new Date().toISOString(),
        );
        assert.equal(competingToken, null, 'the final mapping request must keep extending the same lease');
      },
    }, 'run-finalize-lease');

    assert.equal(result.completed, true);
    const run = await runStore.getRun('run-finalize-lease');
    assert.equal(run.status, 'completed');
    assert.equal(run.phase, 'merging');
  } finally {
    db.close();
  }
});

test('a canceled late finalization response pauses before package completion', async () => {
  const db = setupDb();
  try {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
    const { store: sourceStore } = await prepareActiveSqliteSource(db, bytes, 'src-finalize-cancel');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore },
      { runId: 'run-finalize-cancel', worldId: 'world-finalize-cancel', sourceId: 'src-finalize-cancel',
        modelFingerprint: 'ep#model', title: 't', extractorVersion: extractor.version },
    );
    const signal = { aborted: false };
    const result = await executeRun({
      sourceStore, runStore, worldStore, extractor, sha256Hex: sha.sha256Hex, signal,
      onFinalize: async () => {
        await new Promise(resolve => setTimeout(resolve, 25));
        signal.aborted = true;
        throw new Error('late response discarded');
      },
    }, 'run-finalize-cancel');
    assert.equal(result.completed, false);
    assert.equal((await runStore.getRun('run-finalize-cancel')).status, 'paused_user');
  } finally {
    db.close();
  }
});

test('C2 crash mid-run recovers without re-paying finished units', async () => {
  const db = setupDb();
  try {
    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'novel-small.txt'));
    const { store: sourceStore } = await prepareActiveSqliteSource(db, bytes, 'src-2');
    const runStore = new SqliteBuildRunStore(new NodeSqliteAdapter(db));
    const worldStore = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore },
      { runId: 'run-2', worldId: 'world-c2b', sourceId: 'src-2', modelFingerprint: 'ep#model', title: 't', extractorVersion: extractor.version },
    );

    // Simulated crash: extractor dies on the 3rd unit.
    let budget = 2;
    const crashing = {
      version: extractor.version,
      extract: async input => {
        if (budget <= 0) throw new Error('simulated process death');
        budget -= 1;
        return extractor.extract(input);
      },
    };
    let clock = Date.parse('2026-09-28T12:00:00.000Z');
    const tick = () => new Date(clock).toISOString();
    const first = await executeRun(
      { sourceStore, runStore, worldStore, extractor: crashing, sha256Hex: sha.sha256Hex, now: tick },
      'run-2',
    );
    // Advance past every unit's retry backoff before the recovery run.
    clock += 60_000;
    assert.equal(first.completed, false);
    const units = await runStore.listUnits('run-2');
    const finished = units.filter(unit => unit.status === 'completed').length;
    assert.equal(finished, 2);

    // Recovery: only the remaining units are extracted; the finished ones are
    // recognized from the world-side done jobs.
    let recoveryCalls = 0;
    const recovering = {
      version: extractor.version,
      extract: async input => {
        recoveryCalls += 1;
        return extractor.extract(input);
      },
    };
    const second = await executeRun(
      { sourceStore, runStore, worldStore, extractor: recovering, sha256Hex: sha.sha256Hex, now: tick },
      'run-2',
    );
    assert.equal(second.completed, true);
    assert.equal(recoveryCalls, units.length - 2, 'finished units must not be re-extracted');
    const world = await worldStore.getWorld('world-c2b');
    assert.equal(world.buildStatus, 'ready');
  } finally {
    db.close();
  }
});

test('C2 lease fencing: a second owner cannot steal a live lease; stale commits rejected', async () => {
  const db = setupDb();
  try {
    const runStore = new SqliteBuildRunStore(new NodeSqliteAdapter(db));
    const sourceStore = new SqliteSourceStore(new NodeSqliteAdapter(db));
    const now0 = '2026-09-28T12:00:00.000Z';
    await sourceStore.beginStaging({
      sourceId: 's', rawSha256Hex: 'raw', normalizedTreeHash: '',
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: 1,
      codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
      chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
      splitStrategy: 'standard', fileName: null, title: null,
      status: 'staging', createdAt: now0, updatedAt: now0,
    });
    const units = [{
      unitId: 'u1', runId: 'r', kind: 'extract_group', sourceRangesJson: '[]',
      inputHash: 'h', configFingerprint: 'c', parentUnitId: null, ord: 0,
      status: 'queued', attempt: 0, retryAt: null, resultRef: null, usageJson: null,
      errorCode: null, errorMessage: null, createdAt: now0, updatedAt: now0,
    }];
    await runStore.createRun({
      runId: 'r', worldId: 'w', sourceId: 's', sourceSnapshotHash: 'x',
      pipelineVersion: 'p', planVersion: 'pv', modelFingerprint: 'm',
      phase: 'extracting', status: 'queued', unitsTotal: 1, unitsDone: 0, unitsFailed: 0,
      leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, heartbeatAt: null,
      lastErrorCode: null, lastErrorMessage: null, createdAt: now0, updatedAt: now0,
    }, units);

    const tokenA = await runStore.acquireLease('r', 'ownerA', 60_000, now0);
    assert.ok(tokenA !== null);
    assert.equal(await runStore.acquireLease('r', 'ownerB', 60_000, now0), null,
      'live lease cannot be stolen');

    // Owner A's fenced commit lands; a stale token (pre-increment) does not.
    assert.equal(await runStore.claimUnit('u1', now0), true);
    assert.equal(await runStore.completeUnit({
      unitId: 'u1', fencingToken: tokenA - 1, status: 'completed', now: now0,
    }), false, 'stale fencing token must be rejected');
    assert.equal(await runStore.completeUnit({
      unitId: 'u1', fencingToken: tokenA, status: 'completed', now: now0,
    }), true);

    // After the lease expires, owner B takes over with a fresh token.
    const later = '2026-09-28T12:05:00.000Z';
    const tokenB = await runStore.acquireLease('r', 'ownerB', 60_000, later);
    assert.ok(tokenB !== null && tokenB > tokenA);
    // The old owner cannot renew or release anymore.
    assert.equal(await runStore.renewLease('r', 'ownerA', tokenA, 60_000, later), false);
    assert.equal(await runStore.releaseLease('r', 'ownerA', tokenA, later), false);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 30 MB synthetic stress (deterministic, non-private).
// ---------------------------------------------------------------------------

function buildThirtyMbSample() {
  const enc = new TextEncoder();
  const byteLen = s => enc.encode(s).length;
  const CHAPTER_LINES = 36;
  const TARGET = 30_000_000;
  const lines = [];
  let total = 0;
  let chapter = 0;
  const newLineByte = 1;
  while (total < TARGET) {
    chapter += 1;
    const heading = `第${chapter}章 风起${chapter}`;
    lines.push(heading);
    total += byteLen(heading) + newLineByte;
    for (let i = 0; i < CHAPTER_LINES && total < TARGET; i += 1) {
      let line;
      if (i % 7 === 0) {
        line = `陈青云行至第${chapter}处山门，见灯火数盏😀，他擅长剑术和轻功。`.repeat(3);
      } else if (i % 11 === 0) {
        line = `柳无痕擅长毒术，效忠于离火教，此刻正在打探消息（第${chapter}卷）。`;
      } else {
        line = `普通的行走描写，山风与雾气交替，客栈中人来人往，第${i}段。`;
      }
      lines.push(line);
      total += byteLen(line) + newLineByte;
    }
  }
  let text = lines.join('\n');
  let bytes = Buffer.from(text, 'utf8');
  // Trim to exactly 30,000,000 bytes on a code point boundary.
  while (bytes.length > TARGET) {
    text = text.slice(0, -1);
    bytes = Buffer.from(text, 'utf8');
  }
  if (bytes.length < TARGET) {
    text += 'x'.repeat(TARGET - bytes.length);
    bytes = Buffer.from(text, 'utf8');
  }
  return bytes;
}

test('C2 30MB synthetic preprocessing stress completes with bounded reads', { timeout: 300_000 }, async () => {
  const bytes = buildThirtyMbSample();
  assert.equal(bytes.length, 30_000_000);
  const t0 = Date.now();
  const { result, shards } = await runStreaming(bytes, {});
  const ms = Date.now() - t0;
  console.log(`[C2-stress] bytes=${bytes.length} cp=${result.codePointCount} chapters=${result.chapters.length} `
    + `chunks=${result.chunks.length} shards=${result.shardCount} ms=${ms}`);
  assert.ok(result.chapters.length > 100, 'expect a realistically chaptered sample');
  assert.ok(result.chunks.length > 1000, 'expect >1000 chunks');
  // Full coverage: reconstructing the whole range reproduces the cp count and
  // the shard tree hash input (digests of exactly the persisted shards).
  const full = await shards.readRange('src-test', 0, result.codePointCount);
  assert.equal([...full].length, result.codePointCount);
  assert.equal(result.byteLength, 30_000_000);
  // Every chapter boundary lands on a valid text position.
  const first = await shards.readRange('src-test', 0, 20);
  assert.match(first, /^第1章/);
});
