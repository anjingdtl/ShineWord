const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
const { LedgeredProvider, OutcomeUnknownReplayError } = require('../dist/application/llm/requestLedger');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { fixture } = require('./helpers/phase9CampaignFixture.cjs');
const { llmModelProfileFingerprint } = require('../dist/application/llm/profileFingerprint');
const { stableFingerprint } = require('../dist/application/llm/requestPlan');
const profile = { id: 'stream', name: 'Stream', endpoint: 'https://example.invalid/v1', model: 'glm-5.3-flash', keyRef: 'test',
  reasoningTier: 'high', capabilities: { contextWindow: 65536, maxOutputTokens: 32768, supportsJson: true, supportsStreaming: true } };
const request = { role: 'WorldMapper', system: 's', user: 'u', maxOutputTokens: 24576, requestKind: 'campaign_plan', maxPhysicalRequests: 1 };
const event = data => 'data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n';
const chunk = (delta, finish_reason = null) => ({ id: 'stream-1', choices: [{ index: 0, delta, finish_reason }] });
const usage = { prompt_tokens: 7, completion_tokens: 19, completion_tokens_details: { reasoning_tokens: 12 } };
const good = () => ': heartbeat\n\n' + event(chunk({ reasoning_content: 'private-thinking' }))
  + event(chunk({ content: '{"text":"' })) + event(chunk({ content: '验收"}' }))
  + event({ ...chunk({}, 'stop'), usage }) + event('[DONE]');
function provider(body, capture = () => {}, p = profile) {
  return new OpenAICompatibleProvider(p, { async get() { return 'test-only'; } }, { async post(r) {
    capture(JSON.parse(r.body)); return { status: 200, headers: { 'content-type': 'text/event-stream' }, body };
  } }, 300000);
}
test('planning stream: streamed profiles have a distinct recovery identity; historical buffered fingerprints remain compatible', () => {
  const buffered = { ...profile, capabilities: { ...profile.capabilities, supportsStreaming: false } };
  const historical = stableFingerprint({ profileId: buffered.id, endpointFingerprint: stableFingerprint(buffered.endpoint),
    model: buffered.model, contextWindow: 65536, maxOutputTokens: 32768, reasoningDialect: 'glm' });
  assert.equal(llmModelProfileFingerprint(buffered), historical);
  assert.notEqual(llmModelProfileFingerprint(profile), historical);
});
test('planning stream: high-tier planning receives SSE but exposes only complete business text with final usage', async () => {
  let wire;
  const output = await provider(good().replaceAll('\n', '\r\n'), r => { wire = r; }).complete(request);
  assert.equal(wire.stream, true); assert.equal(wire.reasoning_effort, 'high'); assert.equal(wire.max_tokens, 24576);
  assert.equal(output.text, '{"text":"验收"}'); assert.equal(output.requestId, 'stream-1');
  assert.equal(output.usage.reasoningTokens, 12); assert.equal(output.usage.outputTokens, 19);
  assert.equal(JSON.stringify(output).includes('private-thinking'), false);
});
test('planning stream: a missing terminal event is unknown even when partial business text is valid JSON', async () => {
  const h = await fixture();
  try {
    let calls = 0;
    const inner = provider(good().replace(event('[DONE]'), ''), () => { calls++; });
    const store = new SqliteLlmLedgerStore(h.adapter), ledger = new LedgeredProvider(inner, store, { modelProfileFingerprint: 'stream' });
    const input = { ...request, ledger: { logicalRequestId: 'incomplete-stream', requestKind: 'campaign_plan' } };
    await assert.rejects(ledger.complete(input), /完整响应未接收/);
    const attempt = (await store.listAttempts('incomplete-stream'))[0];
    assert.equal(attempt.status, 'outcome_unknown');
    assert.equal(attempt.failureClass, 'network_unknown');
    assert.equal(attempt.outputTokens, null);
    await assert.rejects(ledger.complete(input), OutcomeUnknownReplayError); assert.equal(calls, 1);
  } finally { h.db.close(); }
});
test('planning stream: complete length termination rejects a truncated plan and preserves reported usage', async () => {
  await assert.rejects(provider(event({ ...chunk({ content: '{}' }, 'length'), usage }) + event('[DONE]')).complete(request), e => {
    assert.match(e.message, /finish_reason=length/); assert.equal(e.requestMetrics[0].usage.reasoningTokens, 12); return true;
  });
});
test('planning stream: terminal reasoning-only data never becomes business text or triggers an extra physical call', async () => {
  let calls = 0;
  await assert.rejects(provider(event({ ...chunk({ reasoning_content: '{"fake":true}' }, 'stop'), usage }) + event('[DONE]'), () => { calls++; }).complete(request), /reasoning|思考|正文/);
  assert.equal(calls, 1);
});
test('planning stream: low tier, short calls and profiles without streaming keep buffered requests', async () => {
  for (const [patch, p] of [[{ reasoningTier: 'low' }, profile], [{ requestKind: 'narrator' }, profile], [{}, { ...profile, capabilities: { ...profile.capabilities, supportsStreaming: false } }]]) {
    let wire; await provider(good(), r => { wire = r; }, p).complete({ ...request, ...patch }); assert.equal(wire.stream, false);
  }
});
test('planning stream: malformed complete frames and data after DONE never publish a partial plan', async () => {
  for (const body of [event('{invalid') + event('[DONE]'), good() + event(chunk({ content: 'injected' })), event(chunk({ content: '{}' })) + event('[DONE]')]) {
    await assert.rejects(provider(body).complete(request));
  }
});
