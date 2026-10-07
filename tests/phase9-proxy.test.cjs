const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { createQaProxy } = require('../tools/phase9-device-proxy.cjs');
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
