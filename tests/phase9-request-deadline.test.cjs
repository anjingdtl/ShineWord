const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { OpenAICompatibleProvider, HttpRequestTimeoutError } = require('../dist/application/llm/openAICompatible');
const { LedgeredProvider, OutcomeUnknownReplayError } = require('../dist/application/llm/requestLedger');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { fixture } = require('./helpers/phase9CampaignFixture.cjs');
const { postQaHttp } = require('../tools/phase9-http.cjs');
const profile = { id: 'deadline', name: 'Deadline', endpoint: 'https://example.invalid/v1', model: 'model', keyRef: 'test',
  reasoningTier: 'high', capabilities: { contextWindow: 65536, maxOutputTokens: 32768, supportsJson: true } };
const request = { role: 'WorldMapper', system: 's', user: 'u', maxOutputTokens: 24576, requestKind: 'campaign_plan' };

test('request deadline: planning uses the frozen request tier; short calls retain their configured deadline', async () => {
  for (const [patch, expected] of [
    [{ reasoningTier: 'high' }, 900000], [{ reasoningTier: 'max' }, 1200000],
    [{ reasoningTier: 'low' }, 300000], [{}, 900000],
    [{ requestKind: 'narrator', reasoningTier: 'high' }, 300000],
    [{ requestKind: 'opening_goal', reasoningTier: 'max' }, 300000],
  ]) {
    let received;
    await new OpenAICompatibleProvider(profile, { async get() { return 'test-only'; } }, {
      async post(input) { received = input; return { status: 200, body: '{"choices":[{"message":{"content":"{}"}}]}' }; }
    }, 300000).complete({ ...request, ...patch });
    assert.equal(received.timeoutMs, expected, JSON.stringify(patch));
    const body = JSON.parse(received.body);
    assert.equal(body.max_tokens, 24576);
    assert.equal(body.stream, false);
  }
});

test('request deadline: a high-planning timeout stays unknown and never automatically dispatches a second request', async () => {
  const h = await fixture();
  try {
    let sent = 0;
    const store = new SqliteLlmLedgerStore(h.adapter);
    const inner = new OpenAICompatibleProvider(profile, { async get() { return 'test-only'; } }, {
      async post(input) { sent++; assert.equal(input.timeoutMs, 900000); throw new HttpRequestTimeoutError(input.timeoutMs); }
    }, 300000);
    const provider = new LedgeredProvider(inner, store, { modelProfileFingerprint: 'deadline' });
    const input = { ...request, ledger: { logicalRequestId: 'high-timeout', requestKind: 'campaign_plan' } };
    await assert.rejects(provider.complete(input), /900 秒/);
    const [attempt] = await store.listAttempts('high-timeout');
    assert.equal(attempt.status, 'outcome_unknown'); assert.equal(attempt.failureClass, 'timeout_unknown');
    await assert.rejects(provider.complete(input), OutcomeUnknownReplayError);
    assert.equal(sent, 1);
  } finally { h.db.close(); }
});

test('early response aborts remain network unknown, never invent the configured deadline or retry', async () => {
  for (const error of [Object.assign(new Error('aborted'), { name: 'AbortError' }),
    Object.assign(new Error('QA HTTP response aborted'), { code: 'ECONNRESET' })]) {
    const h = await fixture();
    try {
      let sent = 0;
      const store = new SqliteLlmLedgerStore(h.adapter);
      const inner = new OpenAICompatibleProvider(profile, { async get() { return 'test-only'; } }, {
        async post() { sent++; throw error; }
      }, 300000);
      const provider = new LedgeredProvider(inner, store, { modelProfileFingerprint: 'deadline' });
      const input = { ...request, ledger: { logicalRequestId: 'early-abort', requestKind: 'campaign_plan' } };
      await assert.rejects(provider.complete(input), failure => {
        assert.doesNotMatch(failure.message, /900|超时|思维链/);
        assert.equal(failure.requestMetrics[0].errorCategory, 'network');
        assert.equal(failure.requestMetrics[0].dispatchState, 'unknown');
        return true;
      });
      const [attempt] = await store.listAttempts('early-abort');
      assert.equal(attempt.status, 'outcome_unknown'); assert.equal(attempt.failureClass, 'network_unknown');
      assert.equal(attempt.estimatedUsage, 1); assert.equal(attempt.reasoningTokens, null);
      await assert.rejects(provider.complete(input), OutcomeUnknownReplayError);
      assert.equal(sent, 1);
    } finally { h.db.close(); }
  }
});

test('unmarked socket timeouts retain timeout classification without inventing the configured duration', async () => {
  let sent = 0;
  const provider = new OpenAICompatibleProvider(profile, { async get() { return 'test-only'; } }, {
    async post() { sent++; throw Object.assign(new Error('socket ended'), { code: 'ETIMEDOUT' }); }
  }, 300000);
  await assert.rejects(provider.complete(request), error => {
    assert.equal(error.requestMetrics[0].errorCategory, 'timeout');
    assert.doesNotMatch(error.message, /900|思维链/); return true;
  });
  assert.equal(sent, 1);
});

test('a truncated completion envelope returned by native fetch remains unknown and cannot be retried or learned as budget exhaustion', async () => {
  for (const body of ['', ' \n\t', '{', '{"choices":[{"message":{"content":"escaped \\\" { text',
    '{"choices":[{"message":{"content":"{}"}}],"usage":{"completion_tokens":42']) {
    const h = await fixture();
    try {
      let sent = 0;
      const store = new SqliteLlmLedgerStore(h.adapter);
      const provider = new LedgeredProvider(new OpenAICompatibleProvider(profile, { async get() { return 'test-only'; } }, {
        async post() { sent++; return { status: 200, body }; }
      }), store, { modelProfileFingerprint: 'deadline' });
      const input = { ...request, ledger: { logicalRequestId: 'partial-envelope', requestKind: 'campaign_plan' } };
      await assert.rejects(provider.complete(input), error => {
        assert.equal(error.requestMetrics[0].errorCategory, 'network');
        assert.equal(error.requestMetrics[0].dispatchState, 'unknown');
        assert.doesNotMatch(error.message, /900|超时|思维链/); return true;
      });
      const [attempt] = await store.listAttempts('partial-envelope');
      assert.equal(attempt.status, 'outcome_unknown'); assert.equal(attempt.failureClass, 'network_unknown');
      assert.equal(attempt.reasoningTokens, null); assert.equal(attempt.outputTokens, null);
      await assert.rejects(provider.complete(input), OutcomeUnknownReplayError); assert.equal(sent, 1);
    } finally { h.db.close(); }
  }
});

test('complete malformed envelopes retain invalid-response classification without recovering embedded partial content', async () => {
  for (const body of ['not JSON', '{"choices":invalid}', '<html>bad gateway</html>']) {
    const provider = new OpenAICompatibleProvider(profile, { async get() { return 'test-only'; } }, {
      async post() { return { status: 200, body }; }
    });
    await assert.rejects(provider.complete(request), error => {
      assert.equal(error.requestMetrics[0].errorCategory, 'invalid_response'); return true;
    });
  }
});

async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return 'http://127.0.0.1:' + server.address().port;
}
test('QA HTTP deadline covers delayed response headers and complete UTF-8 output', async t => {
  let sent = 0;
  const endpoint = await listen(t, http.createServer(async (req, res) => {
    for await (const _ of req) {} sent++;
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"text":"验收"}'); }, 40);
  }));
  const output = await postQaHttp({ url: endpoint, body: '{}', headers: {}, timeoutMs: 1000 });
  assert.equal(output.status, 200); assert.equal(output.body, '{"text":"验收"}'); assert.equal(sent, 1);
  assert.ok(output.timings.responseHeadersMs >= 30);
});
test('QA HTTP deadline still expires after headers arrive when the response body never completes', async t => {
  let sent = 0;
  const endpoint = await listen(t, http.createServer(async (req, res) => {
    for await (const _ of req) {} sent++;
    res.writeHead(200); res.write('{');
  }));
  await assert.rejects(postQaHttp({ url: endpoint, body: '{}', headers: {}, timeoutMs: 40 }), error => {
    assert.equal(error.code, 'LLM_HTTP_DEADLINE_EXCEEDED'); assert.equal(error.timeoutMs, 40); return true;
  });
  assert.equal(sent, 1);
});

test('QA HTTP early response disconnect is not confused with its full-body deadline', async t => {
  let sent = 0;
  const endpoint = await listen(t, http.createServer(async (req, res) => {
    for await (const _ of req) {} sent++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {');
    setTimeout(() => res.destroy(), 15);
  }));
  await assert.rejects(postQaHttp({ url: endpoint, body: '{}', headers: {}, timeoutMs: 1000 }), error => {
    assert.notEqual(error.code, 'LLM_HTTP_DEADLINE_EXCEEDED'); assert.match(error.message, /abort|reset/i); return true;
  });
  assert.equal(sent, 1);
});
