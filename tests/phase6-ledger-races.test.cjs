'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { LedgeredProvider, recoverInterruptedAttempts, OutcomeUnknownReplayError } = require('../dist/application/llm/requestLedger');
const { LlmRequestFailure } = require('../dist/application/llm/types');
const { RateScheduledProvider } = require('../dist/application/llm/scheduledProvider');
const { GlobalRateScheduler, endpointBucketId } = require('../dist/application/worldBuild/rateScheduler');
const { SqliteSchedulerResourceStore } = require('../dist/infra/sqlite/sqliteSchedulerResourceStore');
const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { ReactNativeSqliteAdapter } = require('../dist/infra/sqlite/reactNativeSqliteAdapter');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');

// Both independent providers use the one Android database transaction queue.
// These tests exercise SQL guards, rather than mocking the ledger lifecycle.
class Adapter {
  constructor(db) { this.db = db; this.queue = Promise.resolve(); }
  async execute(sql, params = []) {
    if (!params.length && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  transaction(work) {
    const pending = this.queue.then(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try { const value = await work(this); this.db.exec('COMMIT'); return value; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    });
    this.queue = pending.catch(() => {});
    return pending;
  }
}
async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const adapter = new Adapter(db);
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  return { db, adapter, first: new SqliteLlmLedgerStore(adapter), second: new SqliteLlmLedgerStore(adapter) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function request(logicalRequestId, extra = {}) {
  return { role: 'Extractor', system: 's', user: 'u', maxOutputTokens: 64,
    ledger: { logicalRequestId, requestKind: 'world_extract' }, ...extra };
}
function attempt(logicalRequestId, extra = {}) {
  return { logicalRequestId, requestKind: 'world_extract', modelProfileFingerprint: 'model-a', ...extra };
}
function provider(store, complete, extra = {}) {
  return new LedgeredProvider({ complete }, store, { modelProfileFingerprint: 'model-a', ...extra });
}
function nativeSqlite(db, calls = []) {
  return new ReactNativeSqliteAdapter({ async executeSql(sql, params = []) {
    calls.push(sql);
    let rows = [], rowsAffected = 0;
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) db.exec(sql);
    else {
      const statement = db.prepare(sql);
      if (statement.columns().length) rows = statement.all(...params).map(row => ({ ...row }));
      else rowsAffected = statement.run(...params).changes;
    }
    return [{ rows: { length: rows.length, item: index => rows[index] }, rowsAffected }];
  } });
}

test('Android SQL standalone writes and reads wait outside another owner rollback', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE demo(value TEXT NOT NULL)');
  const calls = [];
  const adapter = new ReactNativeSqliteAdapter({ async executeSql(sql, params = []) {
    calls.push(sql);
    let rows = [], rowsAffected = 0;
    if (/^SELECT /i.test(sql)) rows = db.prepare(sql).all(...params).map(row => ({ ...row }));
    else if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) db.exec(sql);
    else rowsAffected = db.prepare(sql).run(...params).changes;
    return [{ rows: { length: rows.length, item: index => rows[index] }, rowsAffected }];
  } });
  const hold = deferred(), inside = deferred();
  const transaction = adapter.transaction(async tx => {
    await tx.execute('INSERT INTO demo(value) VALUES (?)', ['rolled-back']);
    inside.resolve(); await hold.promise; throw new Error('owner-failed');
  });
  const failed = assert.rejects(transaction, /owner-failed/); await inside.promise;
  let wrote = false, read = false;
  const independent = adapter.execute('INSERT INTO demo(value) VALUES (?)', ['durable'])
    .then(() => { wrote = true; });
  const all = adapter.queryAll('SELECT value FROM demo').then(rows => { read = true; return rows; });
  const one = adapter.queryOne('SELECT value FROM demo');
  await tick(); assert.equal(wrote, false); assert.equal(read, false);
  assert.deepEqual(calls, ['BEGIN IMMEDIATE', 'INSERT INTO demo(value) VALUES (?)']);
  hold.resolve(); await failed; await independent;
  assert.deepEqual(await all, [{ value: 'durable' }]);
  assert.deepEqual(await one, { value: 'durable' });
  assert.deepEqual(calls, ['BEGIN IMMEDIATE', 'INSERT INTO demo(value) VALUES (?)', 'ROLLBACK',
    'INSERT INTO demo(value) VALUES (?)', 'SELECT value FROM demo', 'SELECT value FROM demo']);
});

test('Android SQL cold turn commit probes old schema tables through its transaction reader', { timeout: 3000 }, async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const adapter = nativeSqlite(db);
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  await adapter.execute(`INSERT INTO branches(branch_id,campaign_id,state_version,created_at)
    VALUES('cold-branch','cold-campaign',12,'test')`);
  const old = { branchId: 'cold-branch', stateVersion: 12, clockSeconds: 0, clockMinutes: 0,
    actors: {}, itemOwners: {}, encounters: [] };
  await adapter.execute(`INSERT INTO snapshots(branch_id,state_version,snapshot_json,state_hash,created_at)
    VALUES(?,?,?,NULL,'test')`, [old.branchId, old.stateVersion, JSON.stringify(old)]);
  // Deliberately do not call getState before commit: none of the schema cache
  // probes have been warmed outside this actual native-adapter transaction.
  const store = new SqliteTurnStore(adapter);
  const next = { ...old, stateVersion: 13 };
  const committed = await store.commitAtomic({ branchId: old.branchId, turnId: 'cold-turn', expectedStateVersion: 12,
    nextState: next, actionContractJson: '{}', actionContractHash: 'test',
    committedTurn: { branchId: old.branchId, turnId: 'cold-turn', previousStateVersion: 12, stateVersion: 13,
      outcomeGrade: 'success', publicSummary: 'cold transaction committed', effects: [], committedAt: 'test' } });
  assert.equal(committed.stateVersion, 13);
  assert.equal((await store.getState(old.branchId)).stateVersion, 13);
});

test('M6 two providers sharing SQL cannot dispatch the same logical request twice', async t => {
  const { first, second, db } = await fixture(t);
  const started = deferred(), finish = deferred(); let calls = 0;
  const one = provider(first, async () => { calls += 1; started.resolve(); await finish.promise; return { text: 'ok' }; });
  const two = provider(second, async () => { calls += 1; return { text: 'duplicate' }; });
  const pending = one.complete(request('same-logical'));
  const duplicate = assert.rejects(two.complete(request('same-logical')), /logical_request_in_flight/);
  await started.promise; await duplicate;
  assert.equal(calls, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM llm_request_attempts').get().n, 1);
  assert.equal((await second.listAttempts('same-logical'))[0].status, 'sent');
  finish.resolve(); await pending;
  assert.equal((await first.listAttempts('same-logical'))[0].status, 'succeeded');
});

test('M6 sent process exit remains unknown across a new model or endpoint selection', async t => {
  const { first, second } = await fixture(t);
  const sent = await first.beginAttempt(attempt('killed-after-sent'), 10);
  await first.updateAttempt(sent.attemptId, { status: 'sent' });
  await recoverInterruptedAttempts(second, () => 20);
  let calls = 0;
  const switched = provider(second, async () => { calls += 1; return { text: 'wrong' }; }, { modelProfileFingerprint: 'new-api-model' });
  await assert.rejects(switched.complete(request('killed-after-sent')), OutcomeUnknownReplayError);
  const rows = await first.listAttempts('killed-after-sent');
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'outcome_unknown');
  assert.equal(rows[0].inputTokens, null); assert.equal(rows[0].outputTokens, null);
  assert.equal(calls, 0);
});

test('M6 timeout after sent is unknown and blocks a second physical request', async t => {
  const { first } = await fixture(t); let calls = 0;
  const failure = new LlmRequestFailure('client timeout', [{ attempt: 1, durationMs: 3000,
    httpStatus: null, outcome: 'transport_error', errorCategory: 'timeout' }]);
  const timed = provider(first, async () => { calls += 1; throw failure; });
  await assert.rejects(timed.complete(request('timeout')), /client timeout/);
  const row = (await first.listAttempts('timeout'))[0];
  assert.equal(row.status, 'outcome_unknown'); assert.equal(row.failureClass, 'timeout_unknown');
  assert.equal(row.inputTokens, null); assert.equal(row.estimatedUsage, 1);
  await assert.rejects(timed.complete(request('timeout')), OutcomeUnknownReplayError);
  assert.equal(calls, 1);
});

test('M6 old network metrics without dispatch evidence fail closed instead of guessing no charge', async t => {
  const { first } = await fixture(t); let calls = 0;
  const disconnected = provider(first, async () => { calls += 1;
    throw new LlmRequestFailure('connection dropped after sending', [{ attempt: 1, durationMs: 2000,
      httpStatus: null, outcome: 'transport_error', errorCategory: 'network' }]);
  });
  await assert.rejects(disconnected.complete(request('legacy-disconnect')), /connection dropped/);
  const row = (await first.listAttempts('legacy-disconnect'))[0];
  assert.equal(row.status, 'outcome_unknown'); assert.equal(row.failureClass, 'network_unknown');
  assert.equal(row.inputTokens, null);
  await assert.rejects(disconnected.complete(request('legacy-disconnect')), OutcomeUnknownReplayError);
  assert.equal(calls, 1);
});

function apiProfile() {
  return { id: 'test-only', name: 'test', endpoint: 'https://api.invalid/v1', model: 'test', keyRef: 'key',
    capabilities: { contextWindow: 32000, maxOutputTokens: 4096, supportsJson: true, supportsStreaming: false, reportsUsage: true } };
}
test('M6 structured connection refusal proves no dispatch and permits a bounded retry', async t => {
  const { first } = await fixture(t); let calls = 0;
  const inner = new OpenAICompatibleProvider(apiProfile(), { async get() { return 'memory-test-only'; } }, {
    async post() {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }) });
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 } }) };
    },
  });
  const governed = new LedgeredProvider(inner, first, { modelProfileFingerprint: 'model-a' });
  await assert.rejects(governed.complete(request('refused-before-connect')), error => {
    assert.equal(error.requestMetrics[0].dispatchState, 'not_sent'); return true;
  });
  const noDispatch = (await first.listAttempts('refused-before-connect'))[0];
  assert.equal(noDispatch.status, 'failed'); assert.equal(noDispatch.failureClass, 'network_connect');
  assert.equal(noDispatch.inputTokens, 0); assert.equal(noDispatch.outputTokens, 0); assert.equal(noDispatch.estimatedUsage, 0);
  const response = await governed.complete(request('refused-before-connect'));
  assert.equal(response.requestMetrics[0].dispatchState, 'sent'); assert.equal(calls, 2);
  assert.deepEqual((await first.listAttempts('refused-before-connect')).map(row => row.status), ['failed', 'succeeded']);
});

test('M6 mobile fetch errors and textual refusal claims do not prove that a request was unsent', async t => {
  const { first } = await fixture(t);
  for (const [index, message] of ['Network request failed', 'ECONNREFUSED mentioned without structured cause'].entries()) {
    let calls = 0;
    const inner = new OpenAICompatibleProvider(apiProfile(), { async get() { return 'memory-test-only'; } }, {
      async post() { calls += 1; throw new TypeError(message); },
    });
    const governed = new LedgeredProvider(inner, first, { modelProfileFingerprint: 'model-a' });
    const id = `unknown-fetch-${index}`;
    await assert.rejects(governed.complete(request(id)), error => {
      assert.equal(error.requestMetrics[0].dispatchState, 'unknown'); return true;
    });
    assert.equal((await first.listAttempts(id))[0].status, 'outcome_unknown');
    await assert.rejects(governed.complete(request(id)), OutcomeUnknownReplayError);
    assert.equal(calls, 1);
  }
});

test('M6 transaction rechecks an unknown result appearing after the provider preflight', async t => {
  const { first, second } = await fixture(t);
  let calls = 0;
  const racedStore = {
    async listAttempts(id) {
      const stale = await first.listAttempts(id);
      const sent = await second.beginAttempt(attempt(id), 10);
      await second.updateAttempt(sent.attemptId, { status: 'sent' });
      await recoverInterruptedAttempts(second, () => 20);
      return stale;
    },
    beginAttempt: (...args) => first.beginAttempt(...args),
    updateAttempt: (...args) => first.updateAttempt(...args),
  };
  await assert.rejects(provider(racedStore, async () => { calls += 1; return { text: 'bad' }; })
    .complete(request('preflight-race')), /outcome_unknown_replay_blocked/);
  assert.equal(calls, 0); assert.equal((await first.listAttempts('preflight-race')).length, 1);
});

test('M6 an explicit replay is recorded but does not approve a later unknown attempt', async t => {
  const { first } = await fixture(t);
  const original = await first.beginAttempt(attempt('operator-replay'), 10);
  await first.updateAttempt(original.attemptId, { status: 'sent' });
  await recoverInterruptedAttempts(first, () => 20);
  const replay = await first.beginAttempt(attempt('operator-replay', { allowOutcomeUnknownReplay: true }), 30);
  await first.updateAttempt(replay.attemptId, { status: 'sent' });
  await recoverInterruptedAttempts(first, () => 40);
  const rows = await first.listAttempts('operator-replay');
  assert.deepEqual(rows.map(row => row.status), ['outcome_unknown', 'outcome_unknown']);
  assert.equal(rows[0].replayApprovedAt, 30); assert.equal(rows[1].replayApprovedAt, null);
  await assert.rejects(first.beginAttempt(attempt('operator-replay'), 50), /outcome_unknown_replay_blocked/);
  assert.equal((await first.listAttempts('operator-replay')).length, 2);
});

test('M6 per-attempt player approval permits only the acknowledged unknown result', async t => {
  const { first, adapter } = await fixture(t);
  for (const id of ['acknowledged', 'other-action']) {
    const sent = await first.beginAttempt(attempt(id), 10);
    await first.updateAttempt(sent.attemptId, { status: 'sent' });
  }
  await recoverInterruptedAttempts(first, () => 20);
  // Same exact-attempt CAS used by the user recovery transaction.
  await adapter.execute(`UPDATE llm_request_attempts SET replay_approved_at = ?
    WHERE attempt_id = ? AND status = 'outcome_unknown'`, [30, 'acknowledged#a1']);
  let calls = 0;
  const approved = provider(first, async () => { calls += 1; return { text: 'recovered' }; });
  await approved.complete(request('acknowledged'));
  await assert.rejects(approved.complete(request('other-action')), OutcomeUnknownReplayError);
  assert.equal(calls, 1);
  assert.deepEqual((await first.listAttempts('acknowledged')).map(row => row.status), ['outcome_unknown', 'succeeded']);
});

test('M6 recovery cannot overwrite a completed result or dispatch a recovered prepared row', async t => {
  const { first, adapter } = await fixture(t);
  const prepared = await first.beginAttempt(attempt('prepared-at-exit'), 10);
  await recoverInterruptedAttempts(first, () => 20);
  await assert.rejects(first.updateAttempt(prepared.attemptId, { status: 'sent' }), /logical_request_dispatch_fenced/);
  const done = await first.beginAttempt(attempt('recovery-settle-race'), 10);
  await first.updateAttempt(done.attemptId, { status: 'sent' });
  const racedRecovery = {
    async listInterruptedAttemptIds() {
      const ids = await first.listInterruptedAttemptIds();
      await first.updateAttempt(done.attemptId, { status: 'succeeded', inputTokens: 12, outputTokens: 5 });
      return ids;
    },
    updateAttempt: (...args) => first.updateAttempt(...args),
  };
  await recoverInterruptedAttempts(racedRecovery, () => 30);
  const settled = (await first.listAttempts('recovery-settle-race'))[0];
  assert.equal(settled.status, 'succeeded'); assert.equal(settled.inputTokens, 12);
  assert.equal((await adapter.queryOne('SELECT COUNT(*) AS n FROM llm_request_attempts')).n, 2);
});

test('M6 actual SQL ledger records 429 and Retry-After delays the next admission', async t => {
  const { first, adapter } = await fixture(t); let now = 1000, calls = 0;
  const sleeps = [];
  const scheduler = new GlobalRateScheduler({ maxConcurrent: 1, endpointBucketId: endpointBucketId('https://api.invalid/v1'),
    resourceStore: new SqliteSchedulerResourceStore(adapter), now: () => now,
    sleep: ms => new Promise(resolve => sleeps.push({ ms, resolve })) });
  const governed = new RateScheduledProvider({ async complete() {
    calls += 1;
    if (calls === 1) throw new LlmRequestFailure('429', [{ attempt: 1, durationMs: 1, httpStatus: 429,
      outcome: 'http_error', errorCategory: 'provider_http', retryAfterMs: 45000 }]);
    return { text: 'ok' };
  } }, scheduler).withLedger(first, { modelProfileFingerprint: 'model-a' });
  await assert.rejects(governed.complete(request('rate-limited')), /429/);
  const row = (await first.listAttempts('rate-limited'))[0];
  assert.equal(row.status, 'failed'); assert.equal(row.failureClass, 'http_rate_limit'); assert.equal(row.httpStatus, 429);
  const pending = governed.complete(request('rate-limited')); await tick();
  assert.equal(calls, 1); assert.equal((await first.listAttempts('rate-limited')).length, 1);
  assert.equal(scheduler.stats().retryAfterUntil, 46000);
  now = 46000; for (const sleep of sleeps.splice(0)) sleep.resolve();
  await pending; assert.equal(calls, 2);
  assert.deepEqual((await first.listAttempts('rate-limited')).map(attempt => attempt.status), ['failed', 'succeeded']);
});

test('M6 queued project deletion never creates a physical ledger attempt', async t => {
  const { first, adapter } = await fixture(t); let calls = 0;
  const scheduler = new GlobalRateScheduler({ maxConcurrent: 1, endpointBucketId: 'deletion-bucket',
    resourceStore: new SqliteSchedulerResourceStore(adapter) });
  const blocker = await scheduler.acquire(10, { priority: 'P0' });
  const governed = new RateScheduledProvider({ async complete() { calls += 1; return { text: 'bad' }; } }, scheduler)
    .withLedger(first, { modelProfileFingerprint: 'model-a' });
  const pending = governed.complete(request('deleted-before-sent', {
    ledger: { logicalRequestId: 'deleted-before-sent', requestKind: 'world_extract', worldId: 'deleted-world' },
  }));
  const cancelled = assert.rejects(pending, error => error.code === 'cancelled');
  await tick(); assert.equal((await first.listAttempts('deleted-before-sent')).length, 0);
  assert.equal(scheduler.cancelWorld('deleted-world'), 1); await cancelled;
  await blocker.release(); await scheduler.flush();
  assert.equal(calls, 0); assert.equal((await first.listAttempts('deleted-before-sent')).length, 0);
});
