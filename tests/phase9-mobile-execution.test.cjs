const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMobileModule } = require('./helpers/mobileHarness.cjs');
const { fixture } = require('./helpers/phase9CampaignFixture.cjs');
const { OpenAICompatibleProvider, HttpRequestNotSentError } = require('../dist/application/llm/openAICompatible');
const { LedgeredProvider } = require('../dist/application/llm/requestLedger');
const { LlmRequestFailure } = require('../dist/application/llm/types');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');

const request = { url: 'https://test.invalid/v1/chat/completions', headers: {}, body: '{}', timeoutMs: 900000, requestKind: 'campaign_plan' };
function bridge(acquire, os = 'android') {
  return loadMobileModule('mobile/src/llmExecutionBridge.ts', {
    'react-native': { Platform: { OS: os }, NativeModules: acquire ? { LlmRequestExecution: { acquire } } : {} },
  });
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('planning execution: concurrent headless keep-alives never dispatch and only their own completed request releases them', async () => {
  const tokens = [], b = bridge(async (token, timeoutMs) => { tokens.push(token); assert.equal(timeoutMs, 900000); return true; });
  const a = await b.acquireLlmExecution(request), c = await b.acquireLlmExecution(request);
  let aDone = false, cDone = false;
  const pa = b.llmRequestKeepAlive({ token: tokens[0] }).then(() => { aDone = true; });
  const pc = b.llmRequestKeepAlive({ token: tokens[1] }).then(() => { cDone = true; });
  assert.notEqual(tokens[0], tokens[1]); assert.equal(aDone, false); assert.equal(cDone, false);
  a(); a(); await pa; assert.equal(aDone, true); assert.equal(cDone, false);
  c(); await pc; assert.equal(cDone, true);
  await b.llmRequestKeepAlive({ token: 'orphaned-token' });
});

test('planning execution: native denial releases the semaphore, rejects before HTTP and ledger records zero known usage', async () => {
  const h = await fixture(); let calls = 0, token;
  try {
    const b = bridge(async value => { token = value; throw Error('Native service rejected'); });
    const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': b });
    const original = global.fetch; global.fetch = async () => { calls++; throw Error('unexpected HTTP'); };
    try {
      const p = { ...h.session.profile, endpoint: request.url, keyRef: 'test' };
      const store = new SqliteLlmLedgerStore(h.adapter);
      const provider = new LedgeredProvider(new OpenAICompatibleProvider(p, { async get() { return 'test-secret'; } }, new transport.FetchHttpTransport()), store,
        { modelProfileFingerprint: 'execution-test' });
      await assert.rejects(provider.complete({ role: 'WorldMapper', system: 's', user: 'u', maxOutputTokens: 512,
        maxPhysicalRequests: 1, requestKind: 'campaign_plan', ledger: { logicalRequestId: 'execution-denied', requestKind: 'campaign_plan' } }), LlmRequestFailure);
      const attempt = (await store.listAttempts('execution-denied'))[0];
      assert.equal(attempt.status, 'failed'); assert.equal(attempt.failureClass, 'network_connect');
      assert.equal(attempt.inputTokens, 0); assert.equal(attempt.outputTokens, 0); assert.equal(calls, 0);
      await b.llmRequestKeepAlive({ token });
    } finally { global.fetch = original; }
  } finally { h.db.close(); }
});

test('planning execution: every Android planning tier requires protection, other request kinds and iOS retain their transport', async () => {
  const missing = bridge();
  for (const timeoutMs of [300000, 900000, 1200000]) await assert.rejects(missing.acquireLlmExecution({ ...request, timeoutMs }), HttpRequestNotSentError);
  for (const timeoutMs of [0, 1200001, NaN]) await assert.rejects(missing.acquireLlmExecution({ ...request, timeoutMs }), HttpRequestNotSentError);
  (await missing.acquireLlmExecution({ ...request, requestKind: 'narrator' }))();
  (await bridge(null, 'ios').acquireLlmExecution(request))();
});

test('planning execution: the job lifetime survives its physical request completing and neither token carries job data', async () => {
  const scopes = [], b = bridge(async (token, timeoutMs) => { scopes.push({ token, timeoutMs }); return true; });
  const jobRelease = await b.acquirePlanningExecution();
  const physicalRelease = await b.acquireLlmExecution(request);
  assert.deepEqual(scopes.map(s => s.timeoutMs), [2700000, 900000]);
  assert.ok(scopes.every(s => /^llm-[a-z0-9]+-\d+$/.test(s.token)));
  let jobFinished = false;
  const jobTask = b.llmRequestKeepAlive({ token: scopes[0].token }).then(() => { jobFinished = true; });
  const physicalTask = b.llmRequestKeepAlive({ token: scopes[1].token });
  physicalRelease(); await physicalTask; assert.equal(jobFinished, false);
  jobRelease(); await jobTask; assert.equal(jobFinished, true);
  await assert.rejects(bridge().acquirePlanningExecution(), HttpRequestNotSentError);
  (await bridge(null, 'ios').acquirePlanningExecution())();
});

test('planning execution: transport waits for foreground acknowledgment and protects the complete response body', async () => {
  const ack = deferred(), body = deferred(); let sent = 0, token;
  const b = bridge(async value => { token = value; return ack.promise; });
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': b });
  const original = global.fetch; global.fetch = async () => { sent++; return { status: 200, headers: new Map(), text: () => body.promise }; };
  try {
    const output = new transport.FetchHttpTransport().post(request);
    await Promise.resolve(); assert.equal(sent, 0);
    ack.resolve(true);
    let released = false; const keeper = b.llmRequestKeepAlive({ token }).then(() => { released = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(sent, 1); assert.equal(released, false);
    body.resolve('完整响应'); assert.equal((await output).body, '完整响应'); await keeper; assert.equal(released, true);
  } finally { global.fetch = original; }
});

test('planning execution: an interrupted response releases protection without replaying or returning a partial body', async () => {
  let token, calls = 0;
  const b = bridge(async value => { token = value; return true; });
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': b });
  const original = global.fetch; global.fetch = async () => { calls++; return { status: 200, text: async () => { throw Error('response connection lost'); } }; };
  try {
    await assert.rejects(new transport.FetchHttpTransport().post(request), /connection lost/);
    await b.llmRequestKeepAlive({ token }); assert.equal(calls, 1);
  } finally { global.fetch = original; }
});

test('planning execution: the request deadline aborts an unfinished body and releases the headless task', async () => {
  let token, aborted = 0;
  const b = bridge(async value => { token = value; return true; });
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': b });
  const original = global.fetch;
  global.fetch = async (_url, options) => ({ status: 200, text: () => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { aborted++; reject(Error('body interrupted')); }, { once: true });
  }) });
  try {
    await assert.rejects(new transport.FetchHttpTransport().post({ ...request, timeoutMs: 15 }), /timed out/);
    await b.llmRequestKeepAlive({ token }); assert.equal(aborted, 1);
  } finally { global.fetch = original; }
});
