const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
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
      async post(input) { sent++; assert.equal(input.timeoutMs, 900000); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
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
  await assert.rejects(postQaHttp({ url: endpoint, body: '{}', headers: {}, timeoutMs: 40 }), /timed out|aborted/);
  assert.equal(sent, 1);
});
