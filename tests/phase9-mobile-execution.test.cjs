const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMobileModule } = require('./helpers/mobileHarness.cjs');
const { fixture } = require('./helpers/phase9CampaignFixture.cjs');
const { OpenAICompatibleProvider, HttpRequestNotSentError } = require('../dist/application/llm/openAICompatible');
const { LedgeredProvider } = require('../dist/application/llm/requestLedger');
const { LlmRequestFailure } = require('../dist/application/llm/types');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { HttpRequestTimeoutError } = require('../dist/application/llm/httpErrors');

const request = { url: 'https://test.invalid/v1/chat/completions', headers: {}, body: '{}', timeoutMs: 900000, requestKind: 'campaign_plan' };
function bridge(acquire, os = 'android') {
  return loadMobileModule('mobile/src/llmExecutionBridge.ts', {
    'react-native': { Platform: { OS: os }, NativeModules: acquire ? { LlmRequestExecution: { acquire } } : {} },
  });
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('planning execution: local QA proxy ports carry durable request identity but provider endpoints do not', async () => {
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': bridge(async () => true) });
  const original = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url, headers: options.headers });
    return { status: 200, headers: new Map([['content-type', 'application/json']]), text: async () => '{}' };
  };
  const identity = { ...request, headers: { 'Content-Type': 'application/json' }, requestKind: 'campaign_plan',
    logicalRequestId: 'campaign-plan:c1:b1', attemptId: 'attempt-123', attemptNo: 2, campaignId: 'c1',
    branchId: 'b1', worldId: 'w1', stateVersion: 28, profileFingerprint: 'sha256:profile' };
  try {
    for (const port of ['18591', '18691']) {
      await new transport.FetchHttpTransport().post({
        ...identity, url: `http://10.0.2.2:${port}/v1/chat/completions`,
      });
    }
    await new transport.FetchHttpTransport().post(identity);
  } finally { global.fetch = original; }
  assert.equal(seen.length, 3);
  for (const item of seen.slice(0, 2)) {
    assert.equal(item.headers['x-phase9-attempt-id'], 'attempt-123');
    assert.equal(item.headers['x-phase9-campaign-id'], 'c1');
    assert.equal(item.headers['x-phase9-branch-id'], 'b1');
    assert.equal(item.headers['x-phase9-state-version'], '28');
    assert.equal(item.headers['x-phase9-profile-fingerprint'], 'sha256:profile');
  }
  assert.equal(Object.keys(seen[2].headers).some(key => key.startsWith('x-phase9-')), false);
});

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
    await assert.rejects(new transport.FetchHttpTransport().post({ ...request, timeoutMs: 15 }), error => {
      assert.ok(error instanceof HttpRequestTimeoutError); assert.equal(error.timeoutMs, 15); return true;
    });
    await b.llmRequestKeepAlive({ token }); assert.equal(aborted, 1);
  } finally { global.fetch = original; }
});

test('planning execution: an early fetch AbortError keeps its network identity and releases protection', async () => {
  let token, calls = 0;
  const b = bridge(async value => { token = value; return true; });
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': b });
  const original = global.fetch, error = Object.assign(Error('response aborted'), { name: 'AbortError' });
  global.fetch = async () => { calls++; return { status: 200, text: async () => { throw error; } }; };
  try {
    await assert.rejects(new transport.FetchHttpTransport().post(request), failure => failure === error);
    await b.llmRequestKeepAlive({ token }); assert.equal(calls, 1);
  } finally { global.fetch = original; }
});

test('planning execution: a fetch body finishing after its elapsed deadline cannot return a trusted late completion', async () => {
  let token;
  const b = bridge(async value => { token = value; return true; });
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': b });
  const original = global.fetch;
  global.fetch = async () => ({ status: 200, text: async () => {
    await new Promise(resolve => setTimeout(resolve, 35)); return '{}';
  } });
  try {
    await assert.rejects(new transport.FetchHttpTransport().post({ ...request, timeoutMs: 10 }), HttpRequestTimeoutError);
    await b.llmRequestKeepAlive({ token });
  } finally { global.fetch = original; }
});

test('planning execution: Android fetch transport counts complete SSE frames across byte chunks and decodes UTF-8', async () => {
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': bridge(async () => true) });
  const original = global.fetch;
  const source = Buffer.from('data: {"text":"世界"}\r\n\r\ndata: [DONE]\r\n\r\n', 'utf8');
  const split = source.indexOf(Buffer.from('世')) + 1; // split a multibyte UTF-8 character
  const chunks = [source.subarray(0, split), source.subarray(split, split + 14), source.subarray(split + 14)];
  global.fetch = async () => ({ status: 200, headers: new Map([['content-type', 'text/event-stream']]),
    body: { getReader: () => ({ async read() {
      const value = chunks.shift();
      return value ? { done: false, value: new Uint8Array(value) } : { done: true };
    } }) },
  });
  try {
    const result = await new transport.FetchHttpTransport().post({ ...request, timeoutMs: 1000, streamActivityTimeoutMs: 100 });
    assert.equal(result.body, source.toString('utf8'));
    assert.equal(result.timings.streamFrameCount, 2);
    assert.equal(result.timings.streamActivityMonitored, true);
    assert.notEqual(result.timings.firstStreamFrameMs, null);
  } finally { global.fetch = original; }
});

test('planning execution: Android SSE idle deadline ignores chunks without a complete frame', async () => {
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': bridge(async () => true) });
  const original = global.fetch;
  global.fetch = async (_url, options) => ({ status: 200, headers: new Map([['content-type', 'text/event-stream']]),
    body: { getReader: () => {
      let first = true;
      return { read() {
        if (first) { first = false; return Promise.resolve({ done: false, value: Buffer.concat([Buffer.from('data: partial'), Buffer.from([10])]) }); }
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('reader aborted')), { once: true }));
      } };
    } },
  });
  try {
    await assert.rejects(new transport.FetchHttpTransport().post({ ...request, timeoutMs: 1000, streamActivityTimeoutMs: 25 }), error => {
      assert.ok(error instanceof HttpRequestTimeoutError);
      assert.equal(error.deadlineKind, 'sse_idle');
      return true;
    });
  } finally { global.fetch = original; }
});

test('planning execution: React Native XHR renews the SSE idle deadline only after complete frames', async () => {
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': bridge(async () => true) });
  const originalFetch = global.fetch, originalXhr = global.XMLHttpRequest;
  let dispatched = 0, lastXhr;
  class FakeXhr {
    static HEADERS_RECEIVED = 2;
    static LOADING = 3;
    static DONE = 4;
    constructor() { this.readyState = 0; this.responseText = ''; this.status = 200; this.headers = {}; this.timers = []; this.aborted = false; lastXhr = this; }
    open(method, url, async) { this.opened = { method, url, async }; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    getAllResponseHeaders() { return 'Content-Type: text/event-stream\r\nX-Queue-Time-Ms: 12\r\n'; }
    emit(text, state = FakeXhr.LOADING) {
      this.responseText += text;
      this.readyState = state;
      this.onreadystatechange?.();
      this.onprogress?.();
    }
    send(body) {
      dispatched += 1;
      this.sentBody = body;
      this.readyState = FakeXhr.HEADERS_RECEIVED;
      this.onreadystatechange?.();
      for (const [delay, text] of [
        [35, 'data: one\r\n'], [70, '\r\n'], [140, 'data: two\r\n\r\n'], [150, ''],
      ]) this.timers.push(setTimeout(() => {
        if (this.aborted) return;
        if (delay === 150) {
          this.readyState = FakeXhr.DONE;
          this.onreadystatechange?.();
          this.onload?.();
        } else this.emit(text);
      }, delay));
    }
    abort() {
      this.aborted = true;
      for (const timer of this.timers) clearTimeout(timer);
      this.onabort?.();
    }
  }
  global.fetch = async () => { throw Error('stream request must use incremental XHR'); };
  global.XMLHttpRequest = FakeXhr;
  try {
    const result = await new transport.FetchHttpTransport().post({
      ...request, url: 'http://10.0.2.2:18591/v1/chat/completions', headers: { 'Content-Type': 'application/json' },
      attemptId: 'attempt-xhr-123', campaignId: 'campaign-xhr-123', branchId: 'branch-xhr-123', stateVersion: 28,
      timeoutMs: 1000, streamActivityTimeoutMs: 90,
    });
    assert.equal(dispatched, 1);
    assert.equal(result.body, 'data: one\r\n\r\ndata: two\r\n\r\n');
    assert.equal(result.status, 200);
    assert.equal(result.timings.streamFrameCount, 2);
    assert.equal(result.timings.streamActivityMonitored, true);
    assert.equal(result.timings.providerQueueMs, 12);
    assert.equal(lastXhr.headers['x-phase9-attempt-id'], 'attempt-xhr-123');
    assert.equal(lastXhr.headers['x-phase9-campaign-id'], 'campaign-xhr-123');
    assert.equal(lastXhr.headers['x-phase9-branch-id'], 'branch-xhr-123');
    assert.equal(lastXhr.headers['x-phase9-state-version'], '28');
  } finally {
    global.fetch = originalFetch;
    if (originalXhr === undefined) delete global.XMLHttpRequest; else global.XMLHttpRequest = originalXhr;
  }
});

test('planning execution: React Native XHR partial SSE progress cannot hide an idle deadline', async () => {
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': bridge(async () => true) });
  const originalFetch = global.fetch, originalXhr = global.XMLHttpRequest;
  let dispatched = 0, aborted = 0;
  class FakeXhr {
    static HEADERS_RECEIVED = 2;
    static LOADING = 3;
    static DONE = 4;
    constructor() { this.readyState = 0; this.responseText = ''; this.status = 200; this.timers = []; }
    open() {}
    setRequestHeader() {}
    getAllResponseHeaders() { return 'Content-Type: text/event-stream\r\n'; }
    send() {
      dispatched += 1;
      this.readyState = FakeXhr.HEADERS_RECEIVED;
      this.onreadystatechange?.();
      const emitPartial = count => {
        this.timers.push(setTimeout(() => {
          if (this.aborted) return;
          this.responseText += `data: partial-${count}\n`;
          this.readyState = FakeXhr.LOADING;
          this.onreadystatechange?.();
          this.onprogress?.();
          emitPartial(count + 1);
        }, 15));
      };
      emitPartial(1);
    }
    abort() {
      this.aborted = true;
      aborted += 1;
      for (const timer of this.timers) clearTimeout(timer);
      this.onabort?.();
    }
  }
  global.fetch = async () => { throw Error('stream request must use incremental XHR'); };
  global.XMLHttpRequest = FakeXhr;
  try {
    await assert.rejects(new transport.FetchHttpTransport().post({
      ...request, timeoutMs: 1000, streamActivityTimeoutMs: 75,
    }), error => {
      assert.ok(error instanceof HttpRequestTimeoutError);
      assert.equal(error.deadlineKind, 'sse_idle');
      return true;
    });
    assert.equal(dispatched, 1);
    assert.equal(aborted, 1);
  } finally {
    global.fetch = originalFetch;
    if (originalXhr === undefined) delete global.XMLHttpRequest; else global.XMLHttpRequest = originalXhr;
  }
});

test('planning execution: React Native XHR reports status-zero completion as a network failure', async () => {
  const transport = loadMobileModule('mobile/src/fetchTransport.ts', { './llmExecutionBridge': bridge(async () => true) });
  const originalFetch = global.fetch, originalXhr = global.XMLHttpRequest;
  class FakeXhr {
    static HEADERS_RECEIVED = 2;
    static LOADING = 3;
    static DONE = 4;
    constructor() { this.readyState = 0; this.responseText = ''; this.status = 0; }
    open() {}
    setRequestHeader() {}
    getAllResponseHeaders() { return ''; }
    send() {
      this.readyState = FakeXhr.DONE;
      this.onreadystatechange?.();
      this.onerror?.();
    }
    abort() { this.onabort?.(); }
  }
  global.fetch = async () => { throw Error('stream request must use incremental XHR'); };
  global.XMLHttpRequest = FakeXhr;
  try {
    await assert.rejects(new transport.FetchHttpTransport().post({
      ...request, timeoutMs: 1000, streamActivityTimeoutMs: 100,
    }), error => error instanceof TypeError && /Network request failed/.test(error.message));
  } finally {
    global.fetch = originalFetch;
    if (originalXhr === undefined) delete global.XMLHttpRequest; else global.XMLHttpRequest = originalXhr;
  }
});
