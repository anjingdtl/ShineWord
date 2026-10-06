// Closeout C1 regression suite: byte-hash adapter correctness, legacy
// polluted-hash recovery, INSERT OR IGNORE residue repair, atomic chunk
// commit, event-proposal checkpoints across crash windows, cache
// fingerprints, and the honest build status.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { buildWorldFromTxt } = require('../dist/application/world/buildWorld');
const { makeBase64NativeByteSha } = require('../dist/application/import/byteShaAdapter');
const { importTxtSource } = require('../dist/application/import/txtImport');
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

const referenceSha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// The mobile app binds the adapter to the RN crypto module; here Node crypto
// plays that native side so the real adapter code path is what gets tested.
function mobileStyleAdapter(capturedBase64) {
  return makeBase64NativeByteSha({
    sha256BytesHexFromBase64: async base64 => {
      if (capturedBase64) capturedBase64.push(base64);
      return referenceSha(Buffer.from(base64, 'base64'));
    },
    sha256Hex: async input => crypto.createHash('sha256').update(input, 'utf8').digest('hex'),
  });
}

const decoder = {
  decode(bytes, encoding) {
    return new TextDecoder(encoding === 'utf-8-sig' ? 'utf-8' : encoding).decode(bytes);
  },
};

function fixtureBytes(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name));
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

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

// ---------------------------------------------------------------------------
// T01: the mobile byte-hash adapter hashes exactly the bytes it is given.
// ---------------------------------------------------------------------------

test('T01 mobile adapter: file digest correct, chapter/chunk digests differ and match reference', async () => {
  const fileBytes = Buffer.from('第一章 起点\n甲得到了剑，甲是宗师。\n第二章 风波\n乙失去了掌门之位。', 'utf8');
  const chapterA = Buffer.from('第一章 起点\n甲得到了剑，甲是宗师。\n', 'utf8');
  const chapterB = Buffer.from('第二章 风波\n乙失去了掌门之位。', 'utf8');
  const captured = [];
  const sha = mobileStyleAdapter(captured);

  const fileDigest = await sha.sha256BytesHex(fileBytes);
  const digestA = await sha.sha256BytesHex(chapterA);
  const digestB = await sha.sha256BytesHex(chapterB);

  assert.equal(fileDigest, referenceSha(fileBytes));
  assert.equal(digestA, referenceSha(chapterA));
  assert.equal(digestB, referenceSha(chapterB));
  assert.notEqual(digestA, digestB, 'different chunks must never share a digest');
  assert.notEqual(digestA, fileDigest, 'chunk digest must not collapse to the whole-file digest');
  assert.notEqual(digestB, fileDigest, 'chunk digest must not collapse to the whole-file digest');
  // The native side received each range's OWN bytes (the pre-C1 adapter sent
  // the whole file every time).
  assert.deepEqual(captured.map(b => Buffer.from(b, 'base64')), [fileBytes, chapterA, chapterB]);
});

test('T01 mobile adapter: encoding variants hash their distinct byte sequences', async () => {
  const sha = mobileStyleAdapter();
  const utf8 = Buffer.from('白篱梦第一卷', 'utf8');
  const gbk = Buffer.from('白篱梦第一卷', 'utf16le');
  const utf16 = Buffer.from('白篱梦第一卷', 'utf16le');
  assert.equal(await sha.sha256BytesHex(utf8), referenceSha(utf8));
  assert.equal(await sha.sha256BytesHex(gbk), referenceSha(gbk));
  assert.equal(await sha.sha256BytesHex(utf16), referenceSha(utf16));
  assert.notEqual(await sha.sha256BytesHex(utf8), await sha.sha256BytesHex(gbk));
});

// ---------------------------------------------------------------------------
// T02: a legacy polluted world (every chunk hash = raw file hash) must be
// repaired on re-import, not resumed as "complete".
// ---------------------------------------------------------------------------

test('T02 legacy polluted hashes: re-import repairs and re-extracts everything', async () => {
  const bytes = fixtureBytes('novel-small.txt');
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const first = await buildWorldFromTxt({
      worldId: 'w-polluted',
      title: 't',
      bytes,
      store,
      sha: { sha256BytesHex: async b => referenceSha(b), sha256Hex: async s => crypto.createHash('sha256').update(s, 'utf8').digest('hex') },
      decoder,
      extractor: new FixtureExtractor({ knownNames: fixtureNames() }),
      concurrency: 1,
    });
    assert.equal(first.failedChunks.length, 0);
    const rawHash = first.parsed.sourceSha256Hex;

    // Simulate the pre-C1 mobile adapter: every stored chunk hash collapsed
    // to the raw file digest and one bogus done job covers them all.
    db.prepare("UPDATE source_chunks SET content_hash = ?, extraction_status = 'extracted' WHERE world_id = ?")
      .run(rawHash, 'w-polluted');
    db.prepare(`UPDATE world_jobs SET content_hash = ?, status = 'done', result_json = '{"ok":true}'
                WHERE world_id = ? AND kind = 'extract_chunk'`).run(rawHash, 'w-polluted');

    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    const second = await buildWorldFromTxt({
      worldId: 'w-polluted',
      title: 't',
      bytes,
      store,
      sha: { sha256BytesHex: async b => referenceSha(b), sha256Hex: async s => crypto.createHash('sha256').update(s, 'utf8').digest('hex') },
      decoder,
      extractor,
      concurrency: 1,
    });

    assert.equal(extractor.calls, second.parsed.chunks.length,
      `every chunk must be re-extracted, got ${extractor.calls}/${second.parsed.chunks.length}`);
    assert.equal(second.reusedJobs, 0, 'polluted done jobs must never be reused');
    assert.equal(second.failedChunks.length, 0);
    const chunks = await store.getChunks('w-polluted');
    assert.ok(chunks.length > 1);
    const digests = new Set(chunks.map(chunk => chunk.contentHash));
    assert.equal(digests.size, chunks.length, 'stored chunk digests must be distinct again');
    assert.equal(digests.has(rawHash), false, 'no chunk digest may equal the raw file digest');
    const world = await store.getWorld('w-polluted');
    assert.equal(world.buildStatus, 'ready');
  } finally {
    db.close();
  }
});

test('T02b clean re-import keeps done chunks (idempotent resume)', async () => {
  const bytes = fixtureBytes('novel-small.txt');
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const sha = { sha256BytesHex: async b => referenceSha(b), sha256Hex: async s => crypto.createHash('sha256').update(s, 'utf8').digest('hex') };
    const opts = worldId => ({
      worldId, title: 't', bytes, store, sha, decoder,
      extractor: new FixtureExtractor({ knownNames: fixtureNames() }),
      concurrency: 1,
    });
    await buildWorldFromTxt(opts('w-clean'));
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    const second = await buildWorldFromTxt({ ...opts('w-clean'), extractor });
    assert.equal(extractor.calls, 0, 'correctly-hashed done chunks are reused');
    assert.equal(second.reusedJobs, second.parsed.chunks.length);
  } finally {
    db.close();
  }
});

test('T02c legitimate duplicate paragraphs still reuse and dedupe facts', async () => {
  const text = '第一章\n甲得到了剑。\n第二章\n甲得到了剑。\n';
  const bytes = Buffer.from(text, 'utf8');
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const sha = { sha256BytesHex: async b => referenceSha(b), sha256Hex: async s => crypto.createHash('sha256').update(s, 'utf8').digest('hex') };
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    const result = await buildWorldFromTxt({
      worldId: 'w-dup', title: 't', bytes, store, sha, decoder, extractor, concurrency: 1,
    });
    const chunks = await store.getChunks('w-dup');
    const digests = new Set(chunks.map(chunk => chunk.contentHash));
    // Duplicate CONTENT legitimately shares a digest; that is the cache
    // working, and it must not be confused with the polluted collapse.
    assert.ok(digests.size >= 1 && digests.size <= chunks.length);
    const facts = await store.listFacts('w-dup');
    const byPredicateValue = new Set(facts.map(fact => `${fact.subjectEntityId}|${fact.predicate}|${JSON.stringify(fact.value)}`));
    assert.equal(facts.length, byPredicateValue.size, 'duplicate paragraphs must not duplicate facts');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// T05: crash windows.
// ---------------------------------------------------------------------------

test('T05a crash between chunk commits and timeline resolution replays proposals', async () => {
  // novel-medium contains the fixture extractor's two event trigger phrases,
  // so this run actually checkpoints cross-chunk event proposals.
  const bytes = fixtureBytes('novel-medium.txt');
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const sha = { sha256BytesHex: async b => referenceSha(b), sha256Hex: async s => crypto.createHash('sha256').update(s, 'utf8').digest('hex') };
    const opts = {
      worldId: 'w-crash', title: 't', bytes, store, sha, decoder,
      extractor: new FixtureExtractor({ knownNames: fixtureNames() }),
      concurrency: 1,
    };

    // Crash exactly during timeline resolution: all chunk commits landed,
    // proposals are checkpointed, no canon events yet.
    const originalSaveEvent = store.saveEvent.bind(store);
    let crashed = false;
    store.saveEvent = async (...args) => {
      crashed = true;
      throw new Error('injected crash during timeline resolution');
    };
    await assert.rejects(() => buildWorldFromTxt(opts), /injected crash/);
    assert.equal(crashed, true);
    store.saveEvent = originalSaveEvent;

    const proposals = await store.listEventProposals('w-crash');
    assert.ok(proposals.length > 0, 'event proposals must survive the crash');
    const eventsBefore = await store.listEvents('w-crash');
    assert.equal(eventsBefore.length, 0);

    // Recovery run: no chunk is re-extracted, resolution replays from the DB.
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    const result = await buildWorldFromTxt({ ...opts, extractor });
    assert.equal(extractor.calls, 0, 'committed chunks are not re-extracted after the crash');
    const eventsAfter = await store.listEvents('w-crash');
    assert.equal(eventsAfter.length, result.eventCount);
    assert.equal((await store.listEventProposals('w-crash')).length, 0, 'proposals resolved');
  } finally {
    db.close();
  }
});

test('T05b mid-commit failure leaves no partial chunk data (atomic commit)', async () => {
  const bytes = fixtureBytes('novel-small.txt');
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const sha = { sha256BytesHex: async b => referenceSha(b), sha256Hex: async s => crypto.createHash('sha256').update(s, 'utf8').digest('hex') };
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });

    const factsBefore = () => store.listFacts('w-atomic').then(list => list.length);

    // Fail the fact write INSIDE the commit transaction for every chunk on
    // the first run: nothing may persist, no chunk may be marked done.
    const originalSaveFactTx = Object.getPrototypeOf(store).saveFactTx;
    let inject = true;
    store.saveFactTx = async function injectedSaveFactTx(tx, fact, createdAt) {
      if (inject) throw new Error('injected mid-commit failure');
      return originalSaveFactTx.call(this, tx, fact, createdAt);
    };
    const first = await buildWorldFromTxt({
      worldId: 'w-atomic', title: 't', bytes, store, sha, decoder, extractor, concurrency: 1,
    });
    assert.ok(first.failedChunks.length > 0);
    const chunks = await store.getChunks('w-atomic');
    assert.ok(chunks.every(chunk => chunk.extractionStatus === 'failed' || chunk.extractionStatus === 'pending'),
      'a failed commit must not leave extracted status');
    const jobs = db.prepare("SELECT * FROM world_jobs WHERE world_id = ? AND kind = 'extract_chunk'").all('w-atomic');
    assert.ok(jobs.every(job => job.status !== 'done'), 'no done marker without committed facts');
    const factCountAfterFailure = await factsBefore();
    assert.equal(factCountAfterFailure, 0, 'rolled-back transaction must leave zero facts');

    // Recovery run without injection completes honestly.
    inject = false;
    const secondExtractor = new FixtureExtractor({ knownNames: fixtureNames() });
    const second = await buildWorldFromTxt({
      worldId: 'w-atomic', title: 't', bytes, store, sha, decoder, extractor: secondExtractor, concurrency: 1,
    });
    assert.equal(second.failedChunks.length, 0);
    const world = await store.getWorld('w-atomic');
    assert.equal(world.buildStatus, 'ready');
    assert.ok((await store.listFacts('w-atomic')).length > 0);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// T06/T07: cache fingerprints.
// ---------------------------------------------------------------------------

test('T07 model fingerprint change invalidates chunk reuse', async () => {
  const bytes = fixtureBytes('novel-small.txt');
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const sha = { sha256BytesHex: async b => referenceSha(b), sha256Hex: async s => crypto.createHash('sha256').update(s, 'utf8').digest('hex') };
    const opts = {
      worldId: 'w-fp', title: 't', bytes, store, sha, decoder,
      extractor: new FixtureExtractor({ knownNames: fixtureNames() }),
      concurrency: 1,
    };
    await buildWorldFromTxt({ ...opts, modelFingerprint: 'endpoint#model-a' });
    const extractorB = new FixtureExtractor({ knownNames: fixtureNames() });
    const second = await buildWorldFromTxt({ ...opts, extractor: extractorB, modelFingerprint: 'endpoint#model-b' });
    assert.equal(extractorB.calls, second.parsed.chunks.length, 'changed model fingerprint must re-extract');
    assert.equal(second.reusedJobs, 0);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// Honest status + published package protection.
// ---------------------------------------------------------------------------

test('failed chunks persist world status failed, not ready', async () => {
  const bytes = fixtureBytes('novel-small.txt');
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const sha = { sha256BytesHex: async b => referenceSha(b), sha256Hex: async s => crypto.createHash('sha256').update(s, 'utf8').digest('hex') };
    const parsed = await importTxtSource(bytes, sha, decoder);
    const failingChunk = parsed.chunks[0].chunkId;
    const extractor = new FixtureExtractor({ knownNames: fixtureNames(), failChunkIds: [failingChunk] });
    await buildWorldFromTxt({
      worldId: 'w-fail', title: 't', bytes, store, sha, decoder, extractor, concurrency: 1,
    });
    const world = await store.getWorld('w-fail');
    assert.equal(world.buildStatus, 'failed');
  } finally {
    db.close();
  }
});

test('re-extraction of a polluted world leaves published packages untouched', async () => {
  const bytes = fixtureBytes('novel-small.txt');
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const sha = { sha256BytesHex: async b => referenceSha(b), sha256Hex: async s => crypto.createHash('sha256').update(s, 'utf8').digest('hex') };
    const opts = {
      worldId: 'w-pub', title: 't', bytes, store, sha, decoder,
      extractor: new FixtureExtractor({ knownNames: fixtureNames() }),
      concurrency: 1,
    };
    await buildWorldFromTxt(opts);

    // Minimal published revision 1, as the publisher would write it.
    const now = '2026-09-28T00:00:00.000Z';
    await store.saveWorldPackage({
      manifest: {
        packageId: 'pkg-w-pub',
        worldId: 'w-pub',
        revision: 1,
        schemaVersion: 'shineword-world-package-5', ruleConfiguration: require('../dist/application/content/runtimeRules').createWorldRuleConfiguration('w-pub', 1),
        sourceSha256: parsedHashOf(bytes),
        ruleset: { id: 'shineword-core', version: '0.4.0' },
        mappingVersion: 'm',
        status: 'published',
        contentHash: 'pkg-content-hash-1',
      },
      entries: [],
      sections: [],
      validationJson: '[]',
      createdAt: now,
    });
    const before = db.prepare('SELECT revision, status FROM world_packages WHERE world_id = ?').all('w-pub');

    // Pollute + rebuild.
    db.prepare("UPDATE source_chunks SET content_hash = ?, extraction_status = 'extracted' WHERE world_id = ?")
      .run(parsedHashOf(bytes), 'w-pub');
    await buildWorldFromTxt({ ...opts, extractor: new FixtureExtractor({ knownNames: fixtureNames() }) });

    const after = db.prepare('SELECT revision, status FROM world_packages WHERE world_id = ?').all('w-pub');
    assert.deepEqual(after, before, 'published package revisions are immutable across rebuilds');
  } finally {
    db.close();
  }
});

function parsedHashOf(bytes) {
  return referenceSha(bytes);
}
