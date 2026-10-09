const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createQaProxy } = require('../tools/phase9-device-proxy.cjs');
const { initializeScopedBudgetManifest, createScopedPhysicalBudget } = require('../tools/phase9-budget.cjs');
test('Phase9 QA forwards SSE headers and frames once, preserving the real upstream protocol', async t => {
  let reserved = 0;
  const stream = 'data: {"choices":[]}\n\ndata: [DONE]\n\n';
  const upstream = await listen(t, http.createServer(async (req, res) => {
    for await (const _ of req) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(stream.slice(0, 15)); res.end(stream.slice(15));
  }));
  const endpoint = await listen(t, createQaProxy({ endpoint: upstream, reserve() { reserved++; } }));
  const response = await fetch(endpoint + '/chat/completions', { method: 'POST', body: '{}' });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(await response.text(), stream); assert.equal(reserved, 1);
});
const { NodeSqliteAdapter } = require('./helpers/mobileHarness.cjs');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { LedgeredProvider, OutcomeUnknownReplayError } = require('../dist/application/llm/requestLedger');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');

async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('Phase9 emulator proxy binds each request to the shared scoped ledger and forwards stream frames', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9-proxy-scope-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'dispatch-budget.json');
  initializeScopedBudgetManifest({ filePath, scopeId: 'simulator-proxy-integration', capPhysicalRequests: 1,
    inputs: { llm: { endpoint: 'http://placeholder.invalid/v4', model: 'test-model' } } });
  const budget = createScopedPhysicalBudget({ filePath, expectedScopeId: 'simulator-proxy-integration', expectedCapPhysicalRequests: 1 });
  const stream = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
  let sent = 0, authorization = null;
  const upstream = await listen(t, http.createServer(async (req, res) => {
    for await (const _ of req) {} sent++; authorization = req.headers.authorization;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(stream.slice(0, 27)); res.end(stream.slice(27));
  }));
  const metrics = [];
  const endpoint = await listen(t, createQaProxy({ endpoint: upstream, budget, log: metric => metrics.push(metric) }));
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer test-only',
    'x-phase9-request-kind': 'narrator', 'x-phase9-logical-request-id': 'turn:c1:b1',
    'x-phase9-attempt-id': 'attempt-proxy-1', 'x-phase9-attempt-no': '1', 'x-phase9-campaign-id': 'c1',
    'x-phase9-branch-id': 'b1', 'x-phase9-world-id': 'w1', 'x-phase9-state-version': '3',
    'x-phase9-profile-fingerprint': 'sha256:test-profile' };
  const response = await fetch(endpoint + '/chat/completions', { method: 'POST', headers,
    body: JSON.stringify({ model: 'test-model', stream: true, messages: [] }) });
  assert.equal(response.status, 200); assert.equal(await response.text(), stream);
  assert.equal(authorization, 'Bearer test-only');
  let manifest = budget.readManifest();
  assert.equal(manifest.spentPhysicalRequests, 1);
  assert.equal(manifest.physicalDispatchAudit[0].attemptId, 'attempt-proxy-1');
  assert.equal(manifest.physicalDispatchAudit[0].status, 'completed');
  assert.equal(manifest.physicalDispatchAudit[0].httpStatus, 200);
  assert.equal(manifest.physicalDispatchAudit[0].sseFrameCount, 2);
  assert.equal(manifest.physicalDispatchAudit[0].maxSseFrameGapMs >= 0, true);
  assert.equal(metrics.some(metric => metric.streamActivityMonitored === true), true);
  const duplicate = await fetch(endpoint + '/chat/completions', { method: 'POST', headers,
    body: JSON.stringify({ model: 'test-model', messages: [] }) });
  assert.equal(duplicate.status, 429); assert.equal(sent, 1);
  manifest = budget.readManifest();
  assert.equal(manifest.spentPhysicalRequests, 1);
  assert.equal(JSON.stringify(metrics).includes('test-only'), false);
});
test('Phase9 QA upstream disconnect remains outcome_unknown and production SQLite refuses replay', async t => {
  let sent = 0, reserved = 0; const metrics = [];
  const upstream = await listen(t, http.createServer(async (req, res) => {
    for await (const _ of req) {} sent++; res.destroy();
  }));
  const endpoint = await listen(t, createQaProxy({ endpoint: upstream, reserve() { reserved++; }, log: m => metrics.push(m) }));
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const adapter = new NodeSqliteAdapter(db); await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  const store = new SqliteLlmLedgerStore(adapter);
  const profile = { id: 'test', name: 'Test', endpoint, model: 'test', keyRef: 'memory',
    capabilities: { contextWindow: 32000, maxOutputTokens: 4096, supportsJson: true } };
  const inner = new OpenAICompatibleProvider(profile, { async get() { return 'test-only'; } }, {
    async post(request) {
      const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body });
      return { status: response.status, body: await response.text() };
    },
  });
  const provider = new LedgeredProvider(inner, store, { modelProfileFingerprint: 'test' });
  const request = { role: 'Extractor', system: 's', user: 'u', maxOutputTokens: 64,
    ledger: { logicalRequestId: 'qa-disconnect', requestKind: 'world_extract' } };
  await assert.rejects(provider.complete(request));
  const attempt = (await store.listAttempts('qa-disconnect'))[0];
  assert.equal(attempt.status, 'outcome_unknown'); assert.equal(attempt.failureClass, 'network_unknown');
  assert.equal(attempt.httpStatus, null); assert.equal(attempt.inputTokens, null);
  await assert.rejects(provider.complete(request), OutcomeUnknownReplayError);
  assert.equal(sent, 1); assert.equal(reserved, 1);
  assert.equal(metrics[0].failure, 'qa_transport_unknown'); assert.equal(metrics[0].status, null);
  assert.equal(JSON.stringify(metrics).includes('test-only'), false);
});
test('Phase9 QA forwards a real upstream 503 and Retry-After without manufacturing a network result', async t => {
  let sent = 0, reserved = 0; const metrics = [];
  const upstream = await listen(t, http.createServer(async (req, res) => {
    for await (const _ of req) {} sent++;
    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '7' }); res.end('{"error":"unavailable"}');
  }));
  const endpoint = await listen(t, createQaProxy({ endpoint: upstream, reserve() { reserved++; }, log: m => metrics.push(m) }));
  const response = await fetch(endpoint + '/chat/completions', { method: 'POST', body: '{}' });
  assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '7');
  assert.equal(await response.text(), '{"error":"unavailable"}');
  assert.equal(sent, 1); assert.equal(reserved, 1); assert.equal(metrics[0].status, 503);
});
test('Phase9 QA reservation denial sends zero upstream HTTP and reveals no request data', async t => {
  let sent = 0; const metrics = [];
  const upstream = await listen(t, http.createServer((req, res) => { sent++; res.end('{}'); }));
  const endpoint = await listen(t, createQaProxy({ endpoint: upstream, reserve() { throw Error('private detail'); }, log: m => metrics.push(m) }));
  const response = await fetch(endpoint + '/chat/completions', { method: 'POST', body: 'private request' });
  assert.equal(response.status, 429); assert.equal(sent, 0);
  assert.equal(metrics[0].dispatched, false); assert.equal(metrics[0].failure, 'qa_dispatch_denied');
  assert.equal(JSON.stringify(metrics).includes('private'), false);
  assert.equal((await response.text()).includes('private'), false);
});
