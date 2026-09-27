const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { applySqliteMigrations, BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { buildWorldFromTxt } = require('../dist/application/world/buildWorld');
const { CodePointOffsetIndex } = require('../dist/domain/world/textOffsets');
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
  // Serializes overlapping logical transactions the same way the React Native
  // adapter does, so concurrent workers observe committed state.
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
  async sha256BytesHex(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
  },
  async sha256Hex(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

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

test('world build pipeline persists immutable source, entities and evidenced facts', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const store = new SqliteWorldStore(adapter);
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    const bytes = fixtureBytes('novel-small.txt');

    const result = await buildWorldFromTxt({
      worldId: 'world-small',
      title: '雨夜旧宅·小世界',
      bytes,
      store,
      sha,
      decoder,
      extractor,
      concurrency: 2,
    });

    assert.equal(result.entityCount > 0, true);
    assert.equal(result.failedChunks.length, 0);
    assert.equal(result.factCounts.conflict, 0);

    const world = await store.getWorld('world-small');
    assert.equal(world.buildStatus, 'ready');
    assert.equal(world.sourceSha256, crypto.createHash('sha256').update(bytes).digest('hex'));

    const chapters = await store.getChapters('world-small');
    assert.equal(chapters.length, 4);
    const chunks = await store.getChunks('world-small');
    assert.equal(chunks.length, result.parsed.chunks.length);
    assert.ok(chunks.every(chunk => chunk.extractionStatus === 'extracted'));

    const facts = await store.listFacts('world-small');
    assert.ok(facts.length >= 15, `expected >= 15 facts, got ${facts.length}`);

    // Every fact source must resolve verbatim at its declared span.
    const parsedText = result.parsed.text;
    const index = new CodePointOffsetIndex(parsedText);
    for (const fact of facts) {
      assert.ok(fact.sources.length >= 1, `fact ${fact.factId} has no source`);
      for (const source of fact.sources) {
        const sliced = index.slice(source.startOffset, source.endOffset);
        assert.equal(sliced, source.quote);
        assert.equal(
          source.quoteSha256,
          crypto.createHash('sha256').update(source.quote, 'utf8').digest('hex'),
        );
      }
      assert.ok(fact.status === 'explicit' || fact.status === 'conflict' || fact.status === 'speculation');
    }

    // Annotated quote coverage: every annotated fact's quote found in source.
    const annotations = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-small.json'), 'utf8'));
    for (const annotation of annotations.facts) {
      assert.ok(parsedText.includes(annotation.quote), `missing quote: ${annotation.quote}`);
    }
  } finally {
    db.close();
  }
});

test('fixture extractor recall reaches the 90% exit bar on annotated small novel', async () => {
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    const result = await buildWorldFromTxt({
      worldId: 'world-recall',
      title: 'recall',
      bytes: fixtureBytes('novel-small.txt'),
      store,
      sha,
      decoder,
      extractor,
    });

    const facts = await store.listFacts('world-recall');
    const annotations = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-small.json'), 'utf8'));
    // Match by (subjectName, predicate, serialized value).
    const entities = await store.listEntities('world-recall');
    const nameById = new Map(entities.map(e => [e.entityId, e.name]));
    const extractedKeys = new Set(facts.map(fact =>
      `${nameById.get(fact.subjectEntityId)}|${fact.predicate}|${JSON.stringify(fact.value)}`));

    let hits = 0;
    const misses = [];
    for (const annotation of annotations.facts) {
      const key = `${annotation.subject}|${annotation.predicate}|${JSON.stringify(annotation.value)}`;
      if (extractedKeys.has(key)) hits += 1;
      else misses.push(key);
    }
    const recall = hits / annotations.facts.length;
    assert.ok(
      recall >= 0.9,
      `recall ${(recall * 100).toFixed(1)}% below 90% bar; misses: ${misses.join(' ; ')}`,
    );
    void result;
  } finally {
    db.close();
  }
});

test('medium novel pipeline extracts 200+ annotated facts with evidence', async () => {
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const extractor = new FixtureExtractor({ knownNames: fixtureNames() });
    const result = await buildWorldFromTxt({
      worldId: 'world-medium',
      title: 'medium',
      bytes: fixtureBytes('novel-medium.txt'),
      store,
      sha,
      decoder,
      extractor,
      concurrency: 2,
      importOptions: { targetChunkCodePoints: 800 },
    });

    const facts = await store.listFacts('world-medium');
    assert.ok(facts.length >= 200, `expected >= 200 facts, got ${facts.length}`);
    assert.equal(result.failedChunks.length, 0);

    const events = await store.listEvents('world-medium');
    assert.equal(events.length, 2);
    const started = events.find(e => e.eventId.includes('lunjian-started'));
    assert.deepEqual(started.dependsOnEventIds, [events.find(e => e.eventId.includes('lunjian-announced')).eventId]);

    // Event dependency invalidation: after the anchor event everything later pends.
    const anchor = events.find(e => e.eventId.includes('lunjian-announced'));
    // Divergence overlay is branch-scoped: the shared canon_events rows stay
    // 'canon' and another branch/world view is unaffected.
    const pendingCount = await store.markEventsPendingAfter('world-medium', anchor.eventId, 'branch-a');
    assert.equal(pendingCount, 1);
    const after = await store.listEvents('world-medium', 'branch-a');
    assert.equal(after.find(e => e.eventId.includes('lunjian-started')).status, 'pending');

    const shared = await store.listEvents('world-medium');
    assert.equal(shared.find(e => e.eventId.includes('lunjian-started')).status, 'canon',
      'shared canon must not be rewritten by a branch divergence');
    const otherBranch = await store.listEvents('world-medium', 'branch-b');
    assert.equal(otherBranch.find(e => e.eventId.includes('lunjian-started')).status, 'canon',
      'a second branch is not polluted by the first branch divergence');
    const canonRow = db.prepare("SELECT status FROM canon_events WHERE event_id LIKE '%lunjian-started%'").get();
    assert.equal(canonRow.status, 'canon', 'canon_events.status is never rewritten');
  } finally {
    db.close();
  }
});

test('failed chunk extraction is recoverable and successful jobs are reused', async () => {
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const bytes = fixtureBytes('novel-small.txt');

    const failing = new FixtureExtractor({
      knownNames: fixtureNames(),
      failChunkIds: ['ch-0002-c001'],
    });
    const first = await buildWorldFromTxt({
      worldId: 'world-resume',
      title: 'resume',
      bytes,
      store,
      sha,
      decoder,
      extractor: failing,
    });
    assert.deepEqual(first.failedChunks, ['ch-0002-c001']);
    const chunksAfterFailure = await store.getChunksByStatus('world-resume', 'failed');
    assert.equal(chunksAfterFailure.length, 1);
    const jobAfterFailure = await store.getJob('world-resume', 'job-extract-ch-0002-c001');
    assert.equal(jobAfterFailure.status, 'failed');
    assert.equal(jobAfterFailure.attempts, 1);

    const healthy = new FixtureExtractor({ knownNames: fixtureNames() });
    const second = await buildWorldFromTxt({
      worldId: 'world-resume',
      title: 'resume',
      bytes,
      store,
      sha,
      decoder,
      extractor: healthy,
    });
    assert.deepEqual(second.failedChunks, []);
    assert.equal(second.reusedJobs, first.parsed.chunks.length - 1);
    assert.equal(healthy.calls, 1, 'only the failed chunk must be re-extracted');

    const chunks = await store.getChunks('world-resume');
    assert.ok(chunks.every(chunk => chunk.extractionStatus === 'extracted'));
  } finally {
    db.close();
  }
});

test('conflicting explicit facts are stored as conflict, never silently overwritten', async () => {
  const db = setupDb();
  try {
    const store = new SqliteWorldStore(new NodeSqliteAdapter(db));
    const createdAt = '2026-09-27T00:00:00.000Z';
    await store.createWorld({
      worldId: 'w',
      title: 't',
      sourceSha256: 'hash',
      sourceBytes: 1,
      normalizeVersion: 'n',
      chapterSplitVersion: 'c',
      buildStatus: 'ready',
      createdAt,
      updatedAt: createdAt,
    });
    await store.upsertEntity({
      worldId: 'w',
      entityId: 'ent-a',
      type: 'character',
      name: '甲',
      firstSeenChapterId: null,
      aliases: [],
    }, createdAt);
    // Fact sources reference source_chapters; provide the chapter row.
    await store.saveImportedSource('w', {
      encoding: 'utf-8',
      sourceSha256Hex: 'hash',
      sourceByteLength: 10,
      normalizeVersion: 'n',
      chapterSplitVersion: 'c',
      splitStrategy: 'standard',
      text: 'quote text here',
      codePointCount: 15,
      chapters: [{
        chapterId: 'ch-0001',
        index: 0,
        title: 'ch',
        startOffset: 0,
        endOffset: 15,
        charCount: 15,
        contentHash: 'chash',
      }],
      chunks: [],
    }, createdAt);

    const base = {
      worldId: 'w',
      subjectEntityId: 'ent-a',
      predicate: 'home_location',
      confidence: 1,
      validFrom: null,
      validTo: null,
      revealAt: null,
      scope: 'world',
      sources: [{
        chapterId: 'ch-0001',
        startOffset: 0,
        endOffset: 4,
        quote: 'quote',
        quoteSha256: 'hash',
      }],
    };
    const first = await store.saveFact({ ...base, factId: 'f1', value: { location: '北方' }, status: 'explicit' }, createdAt);
    const duplicate = await store.saveFact({ ...base, factId: 'f2', value: { location: '北方' }, status: 'explicit' }, createdAt);
    const conflict = await store.saveFact({ ...base, factId: 'f3', value: { location: '南方' }, status: 'explicit' }, createdAt);
    assert.equal(first, 'inserted');
    assert.equal(duplicate, 'duplicate');
    assert.equal(conflict, 'conflict');

    const facts = await store.listFacts('w');
    assert.equal(facts.filter(fact => fact.status === 'conflict').length, 1);
    assert.equal(facts.find(fact => fact.factId === 'f1').value.location, '北方');
  } finally {
    db.close();
  }
});
