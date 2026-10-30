/**
 * Final-closeout V1.1.1 supplemental security tests (R1).
 *
 * Pins the remaining dispatch-boundary privacy contracts not covered by
 * tests/phase9-proxy.test.cjs:
 *   1. A scoped-budget hard-cap denial at the QA proxy forwards ZERO upstream
 *      HTTP, charges nothing, and persists/returns no request material.
 *   2. Every rejection path (model drift, stream misconfiguration, hard cap)
 *      keeps request bodies out of both the durable audit manifest and the
 *      proxy log metrics.
 * The existing strict assertions in phase9-proxy.test.cjs stay untouched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createQaProxy } = require('../tools/phase9-device-proxy.cjs');
const { initializeScopedBudgetManifest, createScopedPhysicalBudget } = require('../tools/phase9-budget.cjs');

async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('final-closeout: scoped hard-cap denial sends zero upstream HTTP, charges nothing, leaks nothing', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'closeout-cap-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'dispatch-budget.json');
  initializeScopedBudgetManifest({ filePath, scopeId: 'closeout-hard-cap', capPhysicalRequests: 1,
    inputs: { llm: { endpoint: 'http://placeholder.invalid/v1', model: 'test-model' } } });
  const budget = createScopedPhysicalBudget({ filePath, expectedScopeId: 'closeout-hard-cap', expectedCapPhysicalRequests: 1 });
  const firstReservation = budget.reservePhysicalRequest({ owner: 'closeout-cap-test', requestKind: 'narrator',
    attemptId: 'attempt-closeout-cap-seed', attemptNo: 1, profileFingerprint: 'sha256:closeout-cap-seed' });
  budget.markPhysicalRequestDispatched(firstReservation);
  budget.finishPhysicalRequest(firstReservation, { outcome: 'completed', httpStatus: 200 });
  // The scope is now at its cap: any further reserve must refuse.

  let sent = 0;
  const upstream = await listen(t, http.createServer((req, res) => { sent += 1; res.end('{}'); }));
  const metrics = [];
  const endpoint = await listen(t, createQaProxy({ endpoint: upstream, expectedModel: 'test-model',
    capabilities: { supportsStreaming: true }, budget, log: metric => metrics.push(metric) }));

  const SECRET_BODY = 'CLOSEOUT-SECRET-REQUEST-BODY-MARKER';
  const response = await fetch(endpoint + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer CLOSEOUT-SECRET-KEY-MARKER',
      'x-phase9-request-kind': 'narrator', 'x-phase9-attempt-id': 'attempt-closeout-cap' },
    body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: SECRET_BODY }] }),
  });
  assert.equal(response.status, 429);
  assert.equal(sent, 0, 'hard-cap denial must not reach upstream');

  const manifest = budget.readManifest();
  assert.equal(manifest.spentPhysicalRequests, 1, 'cap denial must not charge the ledger again');
  assert.deepEqual(manifest.physicalDispatchAudit.map(row => row.status), ['completed']);

  const responseBody = await response.text();
  assert.equal(responseBody.includes(SECRET_BODY), false, 'denial response must not echo the request body');
  assert.equal(responseBody.includes('CLOSEOUT-SECRET-KEY-MARKER'), false, 'denial response must not echo the credential');

  const manifestText = fs.readFileSync(filePath, 'utf8');
  assert.equal(manifestText.includes(SECRET_BODY), false, 'audit manifest must not persist request bodies');
  assert.equal(manifestText.includes('CLOSEOUT-SECRET-KEY-MARKER'), false, 'audit manifest must not persist credentials');
  assert.equal(JSON.stringify(metrics).includes(SECRET_BODY), false, 'proxy log metrics must not contain request bodies');
  assert.equal(JSON.stringify(metrics).includes('CLOSEOUT-SECRET-KEY-MARKER'), false, 'proxy log metrics must not contain credentials');
});

test('final-closeout: pre-dispatch proxy rejections keep bodies out of the durable audit and logs', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'closeout-fence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'dispatch-budget.json');
  initializeScopedBudgetManifest({ filePath, scopeId: 'closeout-fence', capPhysicalRequests: 5,
    inputs: { llm: { endpoint: 'http://placeholder.invalid/v1', model: 'test-model', capabilities: { supportsStreaming: false } },
      profileFingerprint: 'sha256:closeout-profile' } });
  const budget = createScopedPhysicalBudget({ filePath, expectedScopeId: 'closeout-fence', expectedCapPhysicalRequests: 5 });
  let sent = 0;
  const upstream = await listen(t, http.createServer((req, res) => { sent += 1; res.end('{}'); }));
  const metrics = [];
  const endpoint = await listen(t, createQaProxy({ endpoint: upstream, expectedModel: 'test-model',
    capabilities: { supportsStreaming: false }, budget, log: metric => metrics.push(metric) }));
  const makeHeaders = attemptId => ({ 'Content-Type': 'application/json',
    'x-phase9-request-kind': 'narrator', 'x-phase9-attempt-id': attemptId,
    'x-phase9-profile-fingerprint': 'sha256:closeout-profile' });

  const drift = await fetch(endpoint + '/chat/completions', { method: 'POST', headers: makeHeaders('a-drift'),
    body: JSON.stringify({ model: 'other-model', messages: [{ role: 'user', content: 'CLOSEOUT-DRIFT-MARKER' }] }) });
  assert.equal(drift.status, 400);
  const streamMismatch = await fetch(endpoint + '/chat/completions', { method: 'POST', headers: makeHeaders('a-stream'),
    body: JSON.stringify({ model: 'test-model', stream: true, messages: [{ role: 'user', content: 'CLOSEOUT-STREAM-MARKER' }] }) });
  assert.equal(streamMismatch.status, 400);
  assert.equal(sent, 0, 'pre-dispatch rejections must not reach upstream');
  assert.deepEqual(budget.readManifest().physicalDispatchAudit.map(row => row.status), ['not_sent', 'not_sent']);

  const driftBody = await drift.text();
  const streamBody = await streamMismatch.text();
  const manifestText = fs.readFileSync(filePath, 'utf8');
  for (const marker of ['CLOSEOUT-DRIFT-MARKER', 'CLOSEOUT-STREAM-MARKER']) {
    assert.equal(manifestText.includes(marker), false, `audit manifest must not persist ${marker}`);
    assert.equal(JSON.stringify(metrics).includes(marker), false, `proxy metrics must not contain ${marker}`);
    assert.equal(driftBody.includes(marker), false, `rejection responses must not echo ${marker}`);
    assert.equal(streamBody.includes(marker), false, `rejection responses must not echo ${marker}`);
  }
});
