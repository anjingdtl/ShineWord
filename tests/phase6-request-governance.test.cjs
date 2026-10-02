'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { GlobalRateScheduler, endpointBucketId, estimateRequestTokens } = require('../dist/application/worldBuild/rateScheduler');
const { RateScheduledProvider, schedulingRoleForRequest } = require('../dist/application/llm/scheduledProvider');
const { RESOURCE_GOVERNANCE_SQL, SqliteSchedulerResourceStore } = require('../dist/infra/sqlite/sqliteSchedulerResourceStore');
const { LlmRequestFailure } = require('../dist/application/llm/types');
const { LedgeredProvider, OutcomeUnknownReplayError } = require('../dist/application/llm/requestLedger');
const { planLlmRequest, DEFAULT_OUTPUT_DEMANDS } = require('../dist/application/llm/requestBudgetKernel');
const { resolveModelCapabilities } = require('../dist/application/llm/capabilityResolver');
const tick = () => new Promise(resolve => setImmediate(resolve));
function controlled(options = {}) {
  let clock = 1_000;
  const sleeps = [];
  const scheduler = new GlobalRateScheduler({ now: () => clock,
    sleep: ms => new Promise(resolve => sleeps.push({ ms, resolve })), ...options });
  return { scheduler, sleeps, advance: ms => { clock += ms; for (const sleep of sleeps.splice(0)) sleep.resolve(); }, clock: () => clock };
}
class Adapter {
  constructor(db) { this.db = db; this.queue = Promise.resolve(); }
  async execute(sql, params = []) { return this.db.prepare(sql).run(...params).changes; }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const next = this.queue.then(async () => { this.db.exec('BEGIN IMMEDIATE');
      try { const result = await work(this); this.db.exec('COMMIT'); return result; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; } });
    this.queue = next.catch(() => {}); return next;
  }
}
function sqlite() {
  const db = new DatabaseSync(':memory:'); db.exec(RESOURCE_GOVERNANCE_SQL);
  return { db, store: new SqliteSchedulerResourceStore(new Adapter(db)) };
}
function request(user = 'u', extra = {}) {
  return { role: 'Extractor', system: 's', user, maxOutputTokens: 64, ...extra };
}

test('M6 explicit queue prefers P0 > P1 > P2 > P3 and FIFO is stable', async () => {
  const { scheduler } = controlled({ maxConcurrent: 1 });
  const first = await scheduler.acquire(100, { priority: 'P0' });
  const order = [];
  const pending = ['P3', 'P2', 'P1', 'P0'].map(priority => scheduler.acquire(100,
    { priority, logicalTaskId: priority }).then(lease => { order.push(priority); return lease; }));
  await tick(); assert.equal(scheduler.stats().queued, 4);
  await first.release();
  for (const index of [3, 2, 1, 0]) { const lease = await pending[index]; await lease.release(); }
  assert.deepEqual(order, ['P0', 'P1', 'P2', 'P3']);
  const blocker = await scheduler.acquire(1, { priority: 'P0' });
  const fifo = [];
  const queue = Array.from({ length: 12 }, (_, index) => scheduler.acquire(1, { priority: 'P1' })
    .then(async lease => { fifo.push(index); await lease.release(); }));
  await blocker.release(); await Promise.all(queue);
  assert.deepEqual(fifo, Array.from({ length: 12 }, (_, index) => index));
});

test('M6 cancellation, project deletion, deadline and urgent promotion affect only unsent work', async () => {
  const controls = controlled({ maxConcurrent: 1 }); const { scheduler } = controls;
  const blocker = await scheduler.acquire(10);
  const abort = new AbortController();
  const cancelled = scheduler.acquire(10, { priority: 'P3', logicalTaskId: 'cancel', signal: abort.signal });
  const cancelledAssertion = assert.rejects(cancelled, error => error.code === 'cancelled');
  abort.abort(); await cancelledAssertion;
  const deleted = scheduler.acquire(10, { priority: 'P3', logicalTaskId: 'delete', worldId: 'world' });
  const deletedAssertion = assert.rejects(deleted, error => error.code === 'cancelled');
  assert.equal(scheduler.cancelWorld('world'), 1); await deletedAssertion;
  const expired = scheduler.acquire(10, { priority: 'P3', queueDeadlineAt: new Date(1_010).toISOString() });
  const expiration = assert.rejects(expired, error => error.code === 'deadline');
  await tick(); controls.advance(11); await expiration;
  const order = [];
  const background = scheduler.acquire(10, { priority: 'P3', logicalTaskId: 'urgent' }).then(lease => { order.push('urgent'); return lease; });
  const near = scheduler.acquire(10, { priority: 'P2' }).then(lease => { order.push('near'); return lease; });
  assert.equal(scheduler.promote('urgent', 'P1'), 1);
  assert.equal(scheduler.stats().inFlight, 1, 'sent request retains its slot');
  await blocker.release(); await (await background).release(); await (await near).release();
  assert.deepEqual(order, ['urgent', 'near']);
  await assert.rejects(scheduler.acquire(10, { worldId: 'world' }), error => error.code === 'cancelled');
});

test('M6 aging remains below P0 and blocked aged background yields to interaction', async () => {
  const controls = controlled({ maxConcurrent: 2, agingMs: 1_000 }); const { scheduler } = controls;
  scheduler.setActivity({ playing: true, interactiveTokenReserve: 100 });
  const background = await scheduler.acquire(10, { priority: 'P2' });
  const abort = new AbortController();
  const old = scheduler.acquire(10, { priority: 'P3', signal: abort.signal });
  const cancelled = assert.rejects(old, error => error.code === 'cancelled');
  await tick(); controls.advance(10_000); await tick();
  const foreground = await scheduler.acquire(10, { priority: 'P0' });
  assert.equal(scheduler.stats().backgroundInFlight, 1);
  assert.equal(scheduler.stats().inFlight, 2);
  abort.abort(); await cancelled;
  await foreground.release(); await background.release();
});

test('M6 concurrency 1/2/4 conservatively reserves interaction capacity while playing', async () => {
  for (const concurrency of [1, 2, 4]) {
    const { scheduler } = controlled({ maxConcurrent: concurrency });
    scheduler.setActivity({ playing: true, interactiveTokenReserve: 100 });
    const abort = new AbortController(); let granted = false;
    const pending = scheduler.acquire(10, { priority: 'P2', expectedDurationMs: 1_000, signal: abort.signal })
      .then(lease => { granted = true; return lease; });
    const foreground = await scheduler.acquire(100, { priority: 'P0' }); await tick();
    if (concurrency === 1) {
      assert.equal(granted, false);
      const cancelled = assert.rejects(pending, error => error.code === 'cancelled'); abort.abort(); await cancelled;
    } else {
      const background = await pending;
      assert.equal(scheduler.stats().backgroundInFlight, 1);
      const secondAbort = new AbortController(); const second = scheduler.acquire(10, { priority: 'P3', signal: secondAbort.signal });
      const cancelled = assert.rejects(second, error => error.code === 'cancelled'); await tick();
      assert.equal(scheduler.stats().backgroundInFlight, 1); secondAbort.abort(); await cancelled;
      await background.release();
    }
    await foreground.release();
  }
  const { scheduler } = controlled({ maxConcurrent: 1 });
  scheduler.setActivity({ playing: true, allowShortBackground: true, interactiveTokenReserve: 100 });
  const short = await scheduler.acquire(10, { priority: 'P2', expectedDurationMs: 900 }); await short.release();
});

test('M6 RPM and TPM reserve enough headroom for one actual turn request', async () => {
  const { scheduler } = controlled({ maxConcurrent: 4, rpm: 4, tpm: 1_000 });
  scheduler.setActivity({ playing: true, interactiveTokenReserve: 700 });
  const first = await scheduler.acquire(200, { priority: 'P2' }); await first.release();
  const abort = new AbortController(); const pending = scheduler.acquire(200, { priority: 'P2', signal: abort.signal });
  const cancelled = assert.rejects(pending, error => error.code === 'cancelled');
  await tick(); assert.equal(scheduler.stats().totalAcquired, 1);
  const turn = await scheduler.acquire(700, { priority: 'P0' });
  assert.equal(scheduler.stats().windowTokens, 900); assert.equal(scheduler.stats().windowRequests, 2);
  abort.abort(); await cancelled; await turn.release();
  await assert.rejects(scheduler.acquire(1_001), error => error.code === 'quota_infeasible');
});

test('M6 individual leases settle out of order without mutating another reservation', async () => {
  const { scheduler } = controlled({ maxConcurrent: 4 });
  const first = await scheduler.acquire(1_000); const second = await scheduler.acquire(2_000);
  await first.settle({ inputTokens: 80, outputTokens: 20, reasoningTokens: 10, estimated: false });
  assert.equal(scheduler.stats().windowTokens, 2_100);
  await second.settle({ inputTokens: 120, outputTokens: 80, reasoningTokens: 40, estimated: false });
  assert.equal(scheduler.stats().windowTokens, 300);
  await first.release(); await second.release(); await first.release();
  assert.equal(scheduler.stats().inFlight, 0);
  const estimated = await scheduler.acquire(500);
  await estimated.settle({ inputTokens: 1, outputTokens: 1, estimated: true });
  assert.equal(scheduler.stats().windowTokens, 800); await estimated.release();
});

test('M6 endpoint identity shares models/profiles and excludes endpoint secrets', () => {
  assert.equal(endpointBucketId('https://example.com/v1/'), endpointBucketId('https://example.com/v1/chat/completions'));
  assert.equal(endpointBucketId('https://u:p@example.com/v1?api_key=secret'), endpointBucketId('https://example.com/v1'));
  assert.doesNotMatch(endpointBucketId('https://u:p@example.com/v1?api_key=secret'), /secret|example|u:p/);
  const { scheduler } = controlled({ rpm: 10, tpm: 1_000, maxConcurrent: 4 });
  scheduler.constrain({ rpm: 5, tpm: 500, maxConcurrent: 2 });
  scheduler.constrain({ rpm: 100, tpm: 10_000, maxConcurrent: 4 });
  assert.deepEqual([scheduler.stats().rpm, scheduler.stats().tpm, scheduler.stats().maxConcurrent], [5, 500, 2]);
});

test('M6 durable admission is atomic across independent JS hosts and restores sent resource debt', async () => {
  const { db, store } = sqlite();
  const one = controlled({ maxConcurrent: 1, endpointBucketId: 'endpoint:test', resourceStore: store });
  const two = controlled({ maxConcurrent: 1, endpointBucketId: 'endpoint:test', resourceStore: store });
  const first = await one.scheduler.acquire(300, { priority: 'P0', logicalTaskId: 'sent' });
  const abort = new AbortController();
  const second = two.scheduler.acquire(300, { priority: 'P0', logicalTaskId: 'other', signal: abort.signal });
  const cancelled = assert.rejects(second, error => error.code === 'cancelled');
  await tick();
  assert.equal(two.scheduler.stats().inFlight, 1);
  assert.equal(two.scheduler.stats().windowTokens, 300, 'restart does not reset sent reservations');
  const stored = JSON.parse(db.prepare('SELECT state_json FROM llm_resource_buckets').get().state_json);
  assert.equal(stored.reservations.filter(entry => entry.active).length, 1);
  assert.equal(stored.queue.length, 1);
  abort.abort(); await cancelled; await first.release(); await two.scheduler.flush(); db.close();
});

test('M6 durable Retry-After survives restart; corrupt bucket fails closed', async () => {
  const { db, store } = sqlite();
  const one = controlled({ endpointBucketId: 'bucket', resourceStore: store });
  one.scheduler.noteRateLimited({ retryAfterMs: 45_000 }); await one.scheduler.flush();
  const two = controlled({ endpointBucketId: 'bucket', resourceStore: store });
  const pending = two.scheduler.acquire(10, { priority: 'P0' }); await tick();
  assert.equal(two.scheduler.stats().retryAfterUntil, 46_000);
  two.advance(45_000); const lease = await pending; await lease.release();
  db.prepare('UPDATE llm_resource_buckets SET state_json = ?').run('{}');
  const broken = controlled({ endpointBucketId: 'bucket', resourceStore: store });
  await assert.rejects(broken.scheduler.acquire(10), /Invalid persisted LLM resource bucket/); db.close();
});

test('M6 default role mapping covers all old requests and styles use a distinct budget kind', () => {
  const expected = { planner: 'P0', narrator: 'P0', memory_checkpoint: 'P3', memory_repair: 'P3',
    world_extract: 'P3', world_mapping: 'P3', world_adjudication: 'P3', timeline: 'P3',
    registry: 'P3', summarizer: 'P3', opening_goal: 'P1', style_analyzer: 'P3' };
  for (const [requestKind, priority] of Object.entries(expected)) assert.equal(schedulingRoleForRequest(request('u', { requestKind })).priority, priority);
  assert.equal(schedulingRoleForRequest(request()).priority, 'P3');
  const plan = planLlmRequest({ capabilities: resolveModelCapabilities({ declared: {
    contextWindowTokens: 32_000, maxOutputTokens: 8_000, supportsJsonMode: true }, reasoningMode: 'always_on' }),
    requestKind: 'style_analyzer', estimatedMandatoryInputTokens: 300,
    businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.style_analyzer,
    reasoningPolicy: { tier: 'low', providerDialect: 'generic', model: 'test' } });
  assert.equal(plan.requestKind, 'style_analyzer');
  assert.equal(plan.wireOutputTokens, plan.requestedOutputTokens + plan.reasoningPolicy.reserveTokens);
  assert.equal(estimateRequestTokens(request('你好', { maxOutputTokens: plan.wireOutputTokens })),
    estimateRequestTokens(request('你好', { maxOutputTokens: 0 })) + plan.wireOutputTokens);
});

test('M6 queued cancellation has no sent ledger row, withLedger orders dispatch after admission', async () => {
  const { scheduler } = controlled({ maxConcurrent: 1 });
  const sent = await scheduler.acquire(10);
  const records = [];
  const store = {
    async listAttempts() { return []; },
    async beginAttempt(input) { const row = { ...input, attemptId: 'a', status: 'prepared' }; records.push(row); return row; },
    async updateAttempt(id, patch) { Object.assign(records.find(row => row.attemptId === id), patch); },
  };
  const provider = new RateScheduledProvider({ async complete() { return { text: 'ok' }; } }, scheduler)
    .withLedger(store, { modelProfileFingerprint: 'test' });
  const abort = new AbortController();
  const pending = provider.complete(request('u', { queueSignal: abort.signal,
    ledger: { logicalRequestId: 'queued', requestKind: 'world_extract' } }));
  const cancelled = assert.rejects(pending, error => error.code === 'cancelled');
  await tick(); assert.equal(records.length, 0); abort.abort(); await cancelled;
  await sent.release();
  await provider.complete(request('u', { ledger: { logicalRequestId: 'done', requestKind: 'world_extract' } }));
  assert.equal(records.length, 1); assert.equal(records[0].status, 'succeeded');
});

test('M6 legacy reasoning-only retries reacquire each physical request without expanding frozen wire ceiling', async () => {
  const { scheduler } = controlled({ maxConcurrent: 1 });
  let calls = 0; const metrics = [{ attempt: 1, durationMs: 1, httpStatus: 200, outcome: 'reasoning_only',
    completionState: 'reasoning_only', usage: { inputTokens: 10, outputTokens: 20, estimated: false } }];
  const provider = new RateScheduledProvider({ async complete(input) {
    assert.equal(input.maxPhysicalRequests, 1); assert.equal(input.maxOutputTokens, 64);
    calls += 1; if (calls < 3) throw new LlmRequestFailure('reasoning only', metrics);
    return { text: 'ok', usage: { inputTokens: 10, outputTokens: 5, estimated: false },
      requestMetrics: [{ ...metrics[0], outcome: 'completed' }] };
  } }, scheduler);
  const result = await provider.complete(request());
  assert.equal(calls, 3); assert.equal(scheduler.stats().totalAcquired, 3);
  assert.equal(scheduler.stats().windowTokens, 75); assert.equal(result.usage.outputTokens, 45);
  assert.deepEqual(result.requestMetrics.map(metric => metric.attempt), [1, 2, 3]);
  calls = 0;
  await assert.rejects(provider.complete(request('u', { maxPhysicalRequests: 1 })), /reasoning only/);
  assert.equal(calls, 1, 'app-owned recovery is never duplicated by the wrapper');
});

test('M6 outcome_unknown never reaches physical dispatch or replays automatically', async () => {
  const { scheduler } = controlled({ maxConcurrent: 1 }); let calls = 0;
  const provider = new RateScheduledProvider(new LedgeredProvider({ async complete() { calls += 1; return { text: 'bad' }; } },
    { async listAttempts() { return [{ status: 'outcome_unknown' }]; } }, { modelProfileFingerprint: 'test' }), scheduler);
  await assert.rejects(provider.complete(request('u', { ledger: { logicalRequestId: 'unknown', requestKind: 'world_extract' } })), OutcomeUnknownReplayError);
  assert.equal(calls, 0); assert.equal(scheduler.stats().inFlight, 0);
});
