const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { NodeSqliteAdapter } = require('./helpers/mobileHarness.cjs');
const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { LedgeredProvider, OutcomeUnknownReplayError } = require('../dist/application/llm/requestLedger');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const adapter = new NodeSqliteAdapter(db);
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  return new SqliteLlmLedgerStore(adapter);
}
function request(extra = {}) {
  return { role: 'Planner', system: 'protocol', user: 'frozen input', maxOutputTokens: 64,
    ledger: { logicalRequestId: 'planner:cloud-review:turn', requestKind: 'planner', physicalAttemptLimit: 2 }, ...extra };
}
const options = { modelProfileFingerprint: 'cloud-review' };

test('ledger success persists the observed HTTP status and complete usage through the shared adapter', async t => {
  const store = await fixture(t);
  const inner = new OpenAICompatibleProvider({ id: 'p', endpoint: 'https://fixture.invalid/v1', model: 'generic',
    keyRef: 'fixture', capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, maxOutputTokens: 64 } },
  { async get() { return 'fixture-only'; } }, { async post() {
    return { status: 201, headers: {}, body: JSON.stringify({ id: 'observed-id',
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 } } }) };
  } });
  const response = await new LedgeredProvider(inner, store, options).complete(request());
  const [attempt] = await store.listAttempts(request().ledger.logicalRequestId);
  assert.equal(response.requestMetrics[0].httpStatus, 201);
  assert.equal(attempt.httpStatus, 201, 'persist observation, never synthesize HTTP 200');
  assert.equal(attempt.providerRequestId, 'observed-id');
  assert.equal(attempt.estimatedUsage, 0);
  assert.equal(attempt.reasoningTokens, 2);
});

test('ledger success without provider telemetry retains unknown HTTP and usage instead of declaring trusted usage', async t => {
  const store = await fixture(t);
  await new LedgeredProvider({ async complete() { return { text: 'ok' }; } }, store, options).complete(request());
  const [attempt] = await store.listAttempts(request().ledger.logicalRequestId);
  assert.equal(attempt.httpStatus, null);
  assert.equal(attempt.inputTokens, null);
  assert.equal(attempt.reasoningTokens, null);
  assert.equal(attempt.estimatedUsage, 1);
});

test('durable response reuse distinguishes appended message contents and preserves exact-request reuse after restart', async t => {
  const store = await fixture(t);
  let dispatches = 0;
  const inner = { async complete(input) { dispatches++; return { text: input.followUpUserMessages.join('|') }; } };
  const first = new LedgeredProvider(inner, store, options);
  assert.equal((await first.complete(request({ followUpUserMessages: ['route A'] }))).text, 'route A');
  const restarted = new LedgeredProvider(inner, store, options);
  assert.equal((await restarted.complete(request({ followUpUserMessages: ['route B'] }))).text, 'route B');
  assert.equal((await restarted.complete(request({ followUpUserMessages: ['route B'] }))).text, 'route B');
  assert.equal(dispatches, 2, 'different payload dispatches once; identical retained request dispatches zero times');
  const attempts = await store.listAttempts(request().ledger.logicalRequestId);
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0].requestFingerprint, attempts[1].requestFingerprint);
});

test('appended message order is part of response identity', async t => {
  const store = await fixture(t);
  const inner = { async complete(input) { return { text: input.followUpUserMessages.join('|') }; } };
  const provider = new LedgeredProvider(inner, store, options);
  await provider.complete(request({ followUpUserMessages: ['A', 'B'] }));
  assert.equal((await provider.complete(request({ followUpUserMessages: ['B', 'A'] }))).text, 'B|A');
});

test('an empty append list preserves the existing buffered request identity and zero-dispatch recovery', async t => {
  const store = await fixture(t);
  let dispatches = 0;
  const provider = new LedgeredProvider({ async complete() { dispatches++; return { text: 'retained' }; } }, store, options);
  await provider.complete(request());
  assert.equal((await provider.complete(request({ followUpUserMessages: [] }))).text, 'retained');
  assert.equal(dispatches, 1);
});

test('unknown paid outcome still blocks reuse of a preceding succeeded response', async t => {
  const store = await fixture(t);
  let dispatches = 0;
  const provider = new LedgeredProvider({ async complete() { dispatches++; return { text: 'retained' }; } }, store, options);
  await provider.complete(request());
  const unknown = await store.beginAttempt({ logicalRequestId: request().ledger.logicalRequestId,
    requestKind: 'planner', modelProfileFingerprint: options.modelProfileFingerprint }, 2);
  await store.updateAttempt(unknown.attemptId, { status: 'outcome_unknown' });
  await assert.rejects(provider.complete(request()), OutcomeUnknownReplayError);
  assert.equal(dispatches, 1);
});
