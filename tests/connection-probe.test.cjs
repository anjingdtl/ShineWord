// Real-device P0-3 regression suite: the API connection probe.
//
// The probe reuses the PRODUCTION OpenAI-compatible pipeline (same provider
// class, same reasoning-parameter shaping) against a scripted transport, and
// must classify every failure class the UI promises to distinguish. Secrets
// are asserted to never leak into results.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const SOURCE = path.resolve(__dirname, '../mobile/src/connectionProbe.ts');

function loadProbe() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const probeModule = new Module(SOURCE, module);
  probeModule.filename = SOURCE;
  probeModule.paths = Module._nodeModulePaths(path.dirname(SOURCE));
  const nativeRequire = probeModule.require.bind(probeModule);
  probeModule.require = request => {
    if (request.includes('application/llm/openAICompatible')) {
      return require('../dist/application/llm/openAICompatible');
    }
    if (request.includes('application/llm/types')) {
      return require('../dist/application/llm/types');
    }
    if (request.includes('application/llm/reasoningPolicy')) {
      return require('../dist/application/llm/reasoningPolicy');
    }
    return nativeRequire(request);
  };
  probeModule._compile(compiled, SOURCE);
  return probeModule.exports;
}

/** Scripted transport: serves queued responses or thrown errors, captures bodies. */
function scriptedTransport(script) {
  const calls = [];
  return {
    calls,
    async post(request) {
      calls.push({ url: request.url, headers: request.headers, body: JSON.parse(request.body) });
      const step = script[calls.length - 1];
      if (!step) throw new Error('unexpected extra request');
      if (step.throw) throw step.throw;
      return {
        status: step.status ?? 200,
        body: JSON.stringify(step.body ?? {}),
        timings: { completeResponseMs: 123 },
      };
    },
  };
}

function okBody(text) {
  return { id: 'resp-1', choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 9, completion_tokens: 5 } };
}

const KEY = 'sk-test-SECRETvalue123456';

function memoryKeyStore(key) {
  return {
    async set() {}, async get() { return key; }, async delete() {},
  };
}

function baseInput(overrides = {}) {
  return {
    endpoint: 'https://api.example.com/v1',
    model: 'deepseek-flash',
    reasoningTier: 'low',
    apiKey: KEY,
    keyRef: 'llm.default',
    secretStore: memoryKeyStore(null),
    transport: scriptedTransport([{ body: okBody('连接成功') }]),
    ...overrides,
  };
}

test('success: real pipeline, tier params on the wire, timing reported', async () => {
  const { probeConnection } = loadProbe();
  const transport = scriptedTransport([{ body: okBody('连接成功') }]);
  const result = await probeConnection(baseInput({ transport }));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'success');
  assert.equal(typeof result.durationMs, 'number');
  // Same wire contract as production: /chat/completions, bearer key, model,
  // reasoning params shaped by the deepseek dialect for the selected tier.
  const call = transport.calls[0];
  assert.ok(call.url.endsWith('/chat/completions'));
  assert.equal(call.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(call.body.model, 'deepseek-flash');
  assert.deepEqual(call.body.thinking, { type: 'enabled' });
  assert.equal(call.body.reasoning_effort, 'low');
  assert.ok(Number.isInteger(call.body.max_tokens));
  assert.ok(call.body.max_tokens <= 2_048, 'probe keeps the completion tiny');
  assert.ok(call.body.messages[0].role === 'system' && call.body.messages[1].role === 'user');
});

test('glm dialect sends reasoning_effort + clear_thinking (tier never disabled)', async () => {
  const { probeConnection } = loadProbe();
  const transport = scriptedTransport([{ body: okBody('连接成功') }]);
  const result = await probeConnection(baseInput({
    model: 'glm-5.3-flash', reasoningDialect: 'glm', reasoningTier: 'high', transport,
  }));
  assert.equal(result.outcome, 'success');
  const body = transport.calls[0].body;
  assert.equal(body.reasoning_effort, 'high');
  assert.deepEqual(body.thinking, { clear_thinking: false });
});

test('401/403 classify as unauthorized (API key invalid)', async () => {
  const { probeConnection } = loadProbe();
  for (const status of [401, 403]) {
    const result = await probeConnection(baseInput({
      transport: scriptedTransport([{ status, body: { error: { message: 'bad key' } } }]),
    }));
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'unauthorized', `HTTP ${status}`);
    assert.ok(result.message.includes('API Key'));
  }
});

test('404 classifies as endpoint/model path error', async () => {
  const { probeConnection } = loadProbe();
  const result = await probeConnection(baseInput({
    transport: scriptedTransport([{ status: 404, body: { error: { message: 'no route' } } }]),
  }));
  assert.equal(result.outcome, 'not_found');
  assert.ok(result.message.includes('404'));
});

test('400 with an unsupported-reasoning message classifies as reasoning_unsupported', async () => {
  const { probeConnection } = loadProbe();
  const result = await probeConnection(baseInput({
    transport: scriptedTransport([{
      status: 400,
      body: { error: { message: 'Extra inputs are not permitted: reasoning_effort is unknown field' } },
    }]),
  }));
  assert.equal(result.outcome, 'reasoning_unsupported');
  assert.ok(result.message.includes('思考参数'));
});

test('plain 400 classifies as bad_request', async () => {
  const { probeConnection } = loadProbe();
  const result = await probeConnection(baseInput({
    transport: scriptedTransport([{ status: 400, body: { error: { message: 'invalid payload' } } }]),
  }));
  assert.equal(result.outcome, 'bad_request');
});

test('429 classifies as rate limiting', async () => {
  const { probeConnection } = loadProbe();
  const result = await probeConnection(baseInput({
    transport: scriptedTransport([{ status: 429, body: { error: { message: 'slow down' } } }]),
  }));
  assert.equal(result.outcome, 'rate_limited');
});

test('5xx classifies as server error', async () => {
  const { probeConnection } = loadProbe();
  const result = await probeConnection(baseInput({
    transport: scriptedTransport([{ status: 503, body: { error: { message: 'overloaded' } } }]),
  }));
  assert.equal(result.outcome, 'server_error');
});

test('transport abort maps to timeout; generic throw maps to network error', async () => {
  const { probeConnection } = loadProbe();
  const timeout = await probeConnection(baseInput({
    transport: scriptedTransport([{ throw: Object.assign(new Error('LLM request timed out.'), { name: 'AbortError' }) }]),
  }));
  assert.equal(timeout.outcome, 'timeout');

  const network = await probeConnection(baseInput({
    transport: scriptedTransport([{ throw: new TypeError('fetch failed') }]),
  }));
  assert.equal(network.outcome, 'network_error');
});

test('non-JSON 200 body classifies as invalid_response', async () => {
  const { probeConnection } = loadProbe();
  const transport = {
    async post() {
      return { status: 200, body: '<html>gateway login</html>', timings: {} };
    },
  };
  const result = await probeConnection(baseInput({ transport }));
  assert.equal(result.outcome, 'invalid_response');
});

test('reasoning-only completion is NOT full success', async () => {
  const { probeConnection } = loadProbe();
  const result = await probeConnection(baseInput({
    transport: scriptedTransport([{
      body: {
        id: 'r',
        choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'thinking...' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2048 },
      },
    }]),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'reasoning_only');
});

test('form key lives in memory only: absent key + empty keystore -> missing_key', async () => {
  const { probeConnection } = loadProbe();
  let transportCalled = false;
  const transport = {
    async post() { transportCalled = true; return { status: 200, body: '{}', timings: {} }; },
  };
  const result = await probeConnection(baseInput({
    apiKey: null, secretStore: memoryKeyStore(null), transport,
  }));
  assert.equal(result.outcome, 'missing_key');
  assert.equal(transportCalled, false, 'no request without a key');
});

test('empty form key falls back to the stored Keychain key', async () => {
  const { probeConnection } = loadProbe();
  const transport = scriptedTransport([{ body: okBody('连接成功') }]);
  const result = await probeConnection(baseInput({
    apiKey: null, secretStore: memoryKeyStore('sk-stored-key-999'), transport,
  }));
  assert.equal(result.outcome, 'success');
  assert.equal(transport.calls[0].headers.Authorization, 'Bearer sk-stored-key-999');
});

test('HTTPS-violating endpoints never reach the network', async () => {
  const { probeConnection } = loadProbe();
  let transportCalled = false;
  const transport = {
    async post() { transportCalled = true; return { status: 200, body: '{}', timings: {} }; },
  };
  const result = await probeConnection(baseInput({
    endpoint: 'http://api.example.com/v1', transport,
  }));
  assert.equal(result.outcome, 'invalid_endpoint');
  assert.equal(transportCalled, false);
});

test('dialect "unsupported" refuses to send (same policy as production)', async () => {
  const { probeConnection } = loadProbe();
  let transportCalled = false;
  const transport = {
    async post() { transportCalled = true; return { status: 200, body: '{}', timings: {} }; },
  };
  const result = await probeConnection(baseInput({
    reasoningDialect: 'unsupported', transport,
  }));
  assert.equal(result.outcome, 'reasoning_unsupported');
  assert.equal(transportCalled, false);
});

test('the API key never appears in any probe output', async () => {
  const { probeConnection } = loadProbe();
  const outcomes = [];
  const scripts = [
    [{ status: 401, body: { error: { message: `key ${KEY} rejected` } } }],
    [{ status: 500, body: { error: { message: `boom with ${KEY}` } } }],
    [{ throw: new TypeError(`fetch to https://x with ${KEY} failed`) }],
    [{ body: okBody('连接成功') }],
  ];
  for (const script of scripts) {
    const result = await probeConnection(baseInput({
      transport: scriptedTransport(script),
    }));
    outcomes.push(result);
  }
  for (const result of outcomes) {
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(KEY), `probe result leaks the key: ${serialized}`);
    assert.ok(!serialized.includes('Bearer'), 'probe result leaks the auth header');
  }
});

test('empty endpoint/model is invalid_input without any request', async () => {
  const { probeConnection } = loadProbe();
  let transportCalled = false;
  const transport = {
    async post() { transportCalled = true; return { status: 200, body: '{}', timings: {} }; },
  };
  for (const partial of [{ endpoint: '', model: 'm' }, { endpoint: 'https://x/v1', model: '' }]) {
    const result = await probeConnection(baseInput({ ...partial, transport }));
    assert.equal(result.outcome, 'invalid_input');
  }
  assert.equal(transportCalled, false);
});
