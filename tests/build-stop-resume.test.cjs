// Real-device P0-4 regression suite: pause / resume / recoverable stop.
//
// Covers the state machine the task card drives:
// - running --pause_requested--> paused_user (between units; in-flight result fenced)
// - pause_requested can be REVOKED (resume clears the flag; run continues)
// - paused_user --resume--> running; completed units are never re-paid
// - running --cancel_requested--> stopped_user (recoverable stop)
// - stopped_user stays in the open-task list and resumes without redoing
// - 'resume' control clears BOTH pause and cancel flags (stale flag fix)
// - acquireLease marks any non-terminal run 'running' (no zombie executors)
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
const { createExtractionRun, executeRun } = require('../dist/application/worldBuild/coordinator');
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

async function prepareActiveSqliteSource(db, fixtureName, sourceId) {
  const store = new SqliteSourceStore(new NodeSqliteAdapter(db));
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', fixtureName));
  const source = new NodeTextSource(bytes);
  const now = '2026-09-29T12:00:00.000Z';
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

/** Same group-shape adapter the U04 suite uses (per-chunk fixture extraction). */
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

const BUDGET = {
  contextWindowTokens: 30_000, maxContentOutputTokens: 3_000, reasoningReserveTokens: 0,
  reasoningEffort: 'off', supportsPromptCache: false, reserveTokens: 2_000,
};

test('pause flow: requested -> honored -> resumed; completed units are never re-paid', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-pause');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-p1', worldId: 'w-p1', sourceId: 'src-pause', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget: BUDGET,
      },
    );

    // Pause requested mid-unit -> honored at the unit boundary.
    let pauseClicks = 0;
    const pausingExtractor = {
      version: fixture.version,
      async extract({ segments }) {
        pauseClicks += 1;
        if (pauseClicks === 1) {
          await runStore.requestRunControl('run-p1', 'pause', new Date().toISOString());
        }
        return fixtureGroupFacts(fixture, segments);
      },
    };
    const paused = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture,
      groupExtractor: pausingExtractor,
      sha256Hex: sha.sha256Hex, owner: 'ui', budget: BUDGET,
    }, 'run-p1');
    assert.equal(paused.completed, false);
    const afterPause = await runStore.getRun('run-p1');
    assert.equal(afterPause.status, 'paused_user');
    assert.equal(afterPause.pauseRequested, false, 'honored pause clears its flag');
    const doneAfterPause = afterPause.unitsDone;
    const totalUnits = afterPause.unitsTotal;
    assert.ok(doneAfterPause >= 1, 'the in-flight unit completed before pausing');
    assert.ok(doneAfterPause < totalUnits, 'work remains for the resume');

    // A stale control request must not survive an explicit resume.
    await runStore.requestRunControl('run-p1', 'cancel', new Date().toISOString());
    await runStore.requestRunControl('run-p1', 'resume', new Date().toISOString());
    const cleared = await runStore.getRun('run-p1');
    assert.equal(cleared.pauseRequested, false);
    assert.equal(cleared.cancelRequested, false, "resume clears BOTH flags - stale-flag bug");

    // Resume: only the REMAINING units run; the finished ones replay from the
    // world state (idempotent fast path) without any extractor call.
    let extractCalls = 0;
    const countingExtractor = {
      version: fixture.version,
      async extract({ segments }) {
        extractCalls += 1;
        return fixtureGroupFacts(fixture, segments);
      },
    };
    const resumed = await executeRun({
      sourceStore, runStore, worldStore, extractor: countingExtractor,
      groupExtractor: countingExtractor,
      sha256Hex: sha.sha256Hex, owner: 'ui', budget: BUDGET,
    }, 'run-p1');
    assert.equal(resumed.completed, true, 'resumed run finishes');
    assert.equal(extractCalls, totalUnits - doneAfterPause,
      'exactly the unfinished units hit the model again');
    const finalRun = await runStore.getRun('run-p1');
    assert.equal(finalRun.status, 'completed');
    assert.equal(finalRun.unitsDone, finalRun.unitsTotal);
  } finally {
    db.close();
  }
});

test('stop flow: stopped_user keeps units, stays open, resumes and completes', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-medium.txt', 'src-stop');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-s1', worldId: 'w-s1', sourceId: 'src-stop', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget: BUDGET,
      },
    );

    let stopClicks = 0;
    const stoppingExtractor = {
      version: fixture.version,
      async extract({ segments }) {
        stopClicks += 1;
        if (stopClicks === 1) {
          await runStore.requestRunControl('run-s1', 'cancel', new Date().toISOString());
        }
        return fixtureGroupFacts(fixture, segments);
      },
    };
    const stopped = await executeRun({
      sourceStore, runStore, worldStore, extractor: fixture,
      groupExtractor: stoppingExtractor,
      sha256Hex: sha.sha256Hex, owner: 'ui', budget: BUDGET,
    }, 'run-s1');
    assert.equal(stopped.completed, false);

    const afterStop = await runStore.getRun('run-s1');
    assert.equal(afterStop.status, 'stopped_user', 'user stop persists the recoverable stopped_user state');
    assert.equal(afterStop.cancelRequested, false, 'honored stop clears its flag (even with racing workers)');
    const doneAfterStop = afterStop.unitsDone;
    assert.ok(doneAfterStop >= 1, 'already-completed units are preserved');
    assert.ok(doneAfterStop < afterStop.unitsTotal, 'remaining work stays pending (not canceled)');

    // The task-list query keeps stopped runs visible (recoverable, not deleted).
    const openStatuses = (await adapter.queryAll(
      `SELECT status FROM world_build_runs
        WHERE status NOT IN ('completed', 'failed_terminal', 'canceled')`,
    )).map(row => row.status);
    assert.ok(openStatuses.includes('stopped_user'), 'stopped_user stays in the open-task list');

    // listResumableRuns includes it too.
    const resumable = await runStore.listResumableRuns();
    assert.ok(resumable.some(run => run.runId === 'run-s1'));

    // Resume from stopped: finishes exactly the remaining units.
    let extractCalls = 0;
    const countingExtractor = {
      version: fixture.version,
      async extract({ segments }) {
        extractCalls += 1;
        return fixtureGroupFacts(fixture, segments);
      },
    };
    const resumed = await executeRun({
      sourceStore, runStore, worldStore, extractor: countingExtractor,
      groupExtractor: countingExtractor,
      sha256Hex: sha.sha256Hex, owner: 'ui', budget: BUDGET,
    }, 'run-s1');
    assert.equal(resumed.completed, true, 'stopped run resumes to completion');
    assert.equal(extractCalls, afterStop.unitsTotal - doneAfterStop,
      'finished units replay from world state, never re-paid');
    assert.equal((await runStore.getRun('run-s1')).status, 'completed');
  } finally {
    db.close();
  }
});

test('in-process stop signal persists stopped_user; pause signal persists paused_user', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-small.txt', 'src-signal');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    const cases = [
      ['run-sig-stop', true, 'stopped_user'],
      ['run-sig-pause', false, 'paused_user'],
    ];
    for (const [runId, stopRequested, expected] of cases) {
      await createExtractionRun(
        { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
        {
          runId, worldId: `w-${runId}`, sourceId: 'src-signal', modelFingerprint: 'ep#m',
          title: 't', extractorVersion: fixture.version, mode: 'group', budget: BUDGET,
        },
      );
      const signal = { aborted: false, stopRequested };
      const interruptingExtractor = {
        version: fixture.version,
        async extract({ segments }) {
          const result = await fixtureGroupFacts(fixture, segments);
          signal.aborted = true; // interrupt right after this unit's request
          return result;
        },
      };
      const outcome = await executeRun({
        sourceStore, runStore, worldStore, extractor: fixture,
        groupExtractor: interruptingExtractor,
        sha256Hex: sha.sha256Hex, owner: 'ui', budget: BUDGET, signal,
      }, runId);
      assert.equal(outcome.completed, false);
      assert.equal((await runStore.getRun(runId)).status, expected);
    }
  } finally {
    db.close();
  }
});

test('acquireLease marks non-terminal resumable statuses as running (no zombie executors)', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-small.txt', 'src-lease');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-z', worldId: 'w-z', sourceId: 'src-lease', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget: BUDGET,
      },
    );
    await runStore.setRunStatus('run-z', 'paused_user', new Date().toISOString());
    const token = await runStore.acquireLease('run-z', 'owner-x', 60_000, new Date().toISOString());
    assert.ok(token !== null, 'paused_user run can be leased again');
    assert.equal((await runStore.getRun('run-z')).status, 'running',
      'a resumed executor must not keep rendering the paused status');
  } finally {
    db.close();
  }
});

test('two coordinators race a stopped resume - the lease still guarantees one executor', async () => {
  const db = setupDb();
  try {
    const { store: sourceStore } = await prepareActiveSqliteSource(db, 'novel-small.txt', 'src-race');
    const adapter = new NodeSqliteAdapter(db);
    const runStore = new SqliteBuildRunStore(adapter);
    const worldStore = new SqliteWorldStore(adapter);
    const fixture = new FixtureExtractor({ knownNames: fixtureNames() });
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId: 'run-race', worldId: 'w-race', sourceId: 'src-race', modelFingerprint: 'ep#m',
        title: 't', extractorVersion: fixture.version, mode: 'group', budget: BUDGET,
      },
    );
    await runStore.setRunStatus('run-race', 'stopped_user', new Date().toISOString());
    const groupExtractor = {
      version: fixture.version,
      extract: ({ segments }) => fixtureGroupFacts(fixture, segments),
    };
    const makeRunner = owner => executeRun({
      sourceStore, runStore, worldStore, extractor: fixture, groupExtractor,
      sha256Hex: sha.sha256Hex, owner, budget: BUDGET,
    }, 'run-race');
    const [a, b] = await Promise.all([makeRunner('runner-a'), makeRunner('runner-b')]);
    const lost = [a, b].filter(r => r.lostLease).length;
    assert.equal(lost, 1, 'exactly one coordinator loses the lease');
    const run = await runStore.getRun('run-race');
    assert.equal(run.status, 'completed');
    assert.equal(run.unitsDone, run.unitsTotal, 'no unit is double-counted');
  } finally {
    db.close();
  }
});
