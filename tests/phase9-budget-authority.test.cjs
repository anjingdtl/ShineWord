const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createPhysicalBudget, initializeScopedBudgetManifest, createScopedPhysicalBudget } = require('../tools/phase9-budget.cjs');
const { createBudgetedHttpTransport } = require('../tools/phase9-dispatch.cjs');

function tempManifest(t, budget = { spent: 1291, totalPhysicalRequests: 1500 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9-budget-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'manifest.json');
  fs.writeFileSync(filePath, JSON.stringify({ budget }), { mode: 0o600 });
  let seq = 0;
  return { filePath, budget: createPhysicalBudget({ filePath, now: () => `2026-10-09T00:00:${String(seq++).padStart(2, '0')}.000Z`, id: () => `id-${seq++}` }) };
}

test('Phase 9 shared budget reserves before send, accounts once, and keeps unknowns charged', t => {
  const { filePath, budget } = tempManifest(t);
  const reservation = budget.reservePhysicalRequest({ owner: 'host:test', requestKind: 'campaign_plan',
    logicalRequestId: 'campaign-plan:j1', attemptId: 'attempt-1', attemptNo: 1,
    campaignId: 'c1', branchId: 'c1-main', worldId: 'w1', stateVersion: 28, profileFingerprint: 'fp1' });
  let manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(manifest.budget.spent, 1291, 'reservation is not yet a physical send');
  assert.equal(manifest.budget.contractBaseSpent, 1291);
  assert.equal(manifest.budget.hardStop, 1450);
  assert.deepEqual(Object.fromEntries(['owner','requestKind','logicalRequestId','attemptId','attemptNo','campaignId','branchId','worldId','stateVersion','profileFingerprint']
    .map(key => [key, manifest.budget.physicalDispatchAudit[0][key]])), {
    owner: 'host:test', requestKind: 'campaign_plan', logicalRequestId: 'campaign-plan:j1', attemptId: 'attempt-1', attemptNo: 1,
    campaignId: 'c1', branchId: 'c1-main', worldId: 'w1', stateVersion: 28, profileFingerprint: 'fp1',
  });
  budget.markPhysicalRequestDispatched(reservation);
  budget.markPhysicalRequestDispatched(reservation);
  budget.finishPhysicalRequest(reservation, { outcome: 'outcome_unknown', failureClass: 'timeout_unknown' });
  manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(manifest.budget.spent, 1292, 'dispatch and finalization cannot double charge');
  assert.equal(manifest.budget.physicalDispatchAudit[0].status, 'outcome_unknown');
  assert.throws(() => budget.reservePhysicalRequest({ owner: 'host:test', requestKind: 'campaign_plan', attemptId: 'attempt-1' }), /already has a physical dispatch/);
});

test('Phase 9 shared budget releases only known-not-sent reservations and enforces the 1450 hard stop', t => {
  const { filePath, budget } = tempManifest(t);
  const notSent = budget.reservePhysicalRequest({ owner: 'android:test', requestKind: 'planner' });
  budget.finishPhysicalRequest(notSent, { outcome: 'not_sent', failureClass: 'not_sent' });
  let manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(manifest.budget.spent, 1291);
  assert.equal(manifest.budget.physicalDispatchAudit[0].status, 'not_sent');

  manifest.budget.spent = 1449;
  manifest.budget.contractBaseSpent = 1291;
  manifest.budget.hardStop = 1450;
  fs.writeFileSync(filePath, JSON.stringify(manifest));
  const last = budget.reservePhysicalRequest({ owner: 'host:test', requestKind: 'campaign_plan' });
  budget.markPhysicalRequestDispatched(last);
  assert.throws(() => budget.reservePhysicalRequest({ owner: 'android:test', requestKind: 'planner' }), /1450 hard stop/);
  manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(manifest.budget.spent, 1450);
});

test('Phase 9 refuses the historical 1210 manifest and any altered request cap before reservation', t => {
  const old = tempManifest(t, { spent: 1210, totalPhysicalRequests: 1500 });
  assert.throws(() => old.budget.reservePhysicalRequest({ owner: 'host:test' }), /authoritative budget manifest/);
  const wrongCap = tempManifest(t, { spent: 1291, totalPhysicalRequests: 1600 });
  assert.throws(() => wrongCap.budget.reservePhysicalRequest({ owner: 'host:test' }), /authoritative budget manifest/);
});

test('Phase 9 host and Android workers contend on one manifest without losing reservations', async t => {
  const { filePath } = tempManifest(t);
  const modulePath = path.resolve(__dirname, '../tools/phase9-budget.cjs');
  const runOne = index => new Promise((resolve, reject) => {
    const code = `const b=require(${JSON.stringify(modulePath)}).createPhysicalBudget({filePath:${JSON.stringify(filePath)}});`+
      `const r=b.reservePhysicalRequest({owner:${JSON.stringify(index % 2 ? 'android:test' : 'host:test')},`+
      `requestKind:'campaign_plan',attemptId:${JSON.stringify(`attempt-${index}`)}});`+
      `b.markPhysicalRequestDispatched(r);b.finishPhysicalRequest(r,{outcome:'completed',httpStatus:200});`;
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (status, signal) => status === 0 ? resolve() : reject(new Error(`child ${index} failed (${status ?? signal}): ${stderr}`)));
  });
  await Promise.all(Array.from({ length: 8 }, (_, index) => runOne(index)));
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(manifest.budget.spent, 1299);
  assert.equal(manifest.budget.physicalDispatchAudit.length, 8);
  assert.ok(manifest.budget.physicalDispatchAudit.every(row => row.status === 'completed'));
  assert.equal(new Set(manifest.budget.physicalDispatchAudit.map(row => row.attemptId)).size, 8);
});

test('Phase 9 interrupted reservation remains charged against the hard stop after process reconstruction', t => {
  const { filePath, budget } = tempManifest(t, { spent: 1449, totalPhysicalRequests: 1500, contractBaseSpent: 1291, hardStop: 1450 });
  budget.reservePhysicalRequest({ owner: 'host:test', requestKind: 'narrator', attemptId: 'attempt-crash-before-send' });
  const reopened = createPhysicalBudget({ filePath });
  assert.throws(() => reopened.reservePhysicalRequest({ owner: 'android:test', requestKind: 'planner' }), /1450 hard stop/);
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(manifest.budget.spent, 1449);
  assert.equal(manifest.budget.physicalDispatchAudit[0].status, 'reserved');
});

function tempScopedManifest(t, cap = 12, profileFingerprint = 'sha256:profile-safe') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9-scoped-budget-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'dispatch-budget.json');
  const scopeId = 'simulator-longrun-test';
  initializeScopedBudgetManifest({ filePath, scopeId, capPhysicalRequests: cap,
    inputs: { llm: { endpoint: 'https://example.invalid/v4', model: 'test-model' }, profileFingerprint } });
  return { filePath, scopeId, cap, budget: createScopedPhysicalBudget({ filePath, expectedScopeId: scopeId, expectedCapPhysicalRequests: cap }) };
}

function scopedRequest(attemptId, extra = {}) {
  return { owner: 'android:phase9-proxy', requestKind: 'narrator', attemptId,
    logicalRequestId: 'turn:campaign-1:branch-1', campaignId: 'campaign-1', branchId: 'branch-1',
    worldId: 'world-1', stateVersion: 3, profileFingerprint: 'sha256:profile-safe', ...extra };
}

test('scoped simulator budget charges dispatched and unknown requests once; duplicate attempts cannot replay', t => {
  const { filePath, budget, cap, scopeId } = tempScopedManifest(t, 2);
  assert.throws(() => initializeScopedBudgetManifest({ filePath, scopeId, capPhysicalRequests: cap }), /already exists/);
  assert.throws(() => budget.reservePhysicalRequest({ owner: 'android:phase9-proxy', requestKind: 'narrator' }), /attempt identity/);
  assert.throws(() => budget.reservePhysicalRequest(scopedRequest('attempt-wrong-profile', { profileFingerprint: 'sha256:wrong' })), /differs from its pinned identity/);
  const unknown = budget.reservePhysicalRequest(scopedRequest('attempt-unknown'));
  budget.markPhysicalRequestDispatched(unknown);
  budget.markPhysicalRequestDispatched(unknown);
  budget.finishPhysicalRequest(unknown, { outcome: 'outcome_unknown', failureClass: 'timeout_unknown' });
  budget.finishPhysicalRequest(unknown, { outcome: 'outcome_unknown', failureClass: 'timeout_unknown' });
  assert.equal(budget.readManifest().spentPhysicalRequests, 1);
  assert.throws(() => budget.reservePhysicalRequest(scopedRequest('attempt-unknown')), /already has a physical dispatch/);
  const notSent = budget.reservePhysicalRequest(scopedRequest('attempt-preflight'));
  budget.finishPhysicalRequest(notSent, { outcome: 'not_sent' });
  const last = budget.reservePhysicalRequest(scopedRequest('attempt-completed'));
  budget.finishPhysicalRequest(last, { outcome: 'completed', httpStatus: 200, frameCount: 8, maxFrameGapMs: 742 });
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(manifest.spentPhysicalRequests, 2);
  assert.deepEqual(manifest.physicalDispatchAudit.map(row => row.status), ['outcome_unknown', 'not_sent', 'completed']);
  assert.equal(manifest.physicalDispatchAudit[0].attemptId, 'attempt-unknown');
  assert.equal(manifest.physicalDispatchAudit[2].maxSseFrameGapMs, 742);
  assert.equal(JSON.stringify(manifest).includes('Bearer '), false);
});

test('scoped simulator budget pins immutable cap and scope id across reconstruction', t => {
  const { filePath, budget, scopeId, cap } = tempScopedManifest(t, 3);
  assert.equal(budget.updateManifest, undefined, 'scoped callers cannot rewrite the cap, spent count, or audit');
  budget.reservePhysicalRequest(scopedRequest('attempt-1'));
  assert.throws(() => createScopedPhysicalBudget({ filePath, expectedScopeId: scopeId, expectedCapPhysicalRequests: cap + 1 }), /cap differs/);
  assert.throws(() => createScopedPhysicalBudget({ filePath, expectedScopeId: 'different-scope', expectedCapPhysicalRequests: cap }), /id differs/);
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  manifest.capPhysicalRequests++;
  fs.writeFileSync(filePath, JSON.stringify(manifest));
  assert.throws(() => createScopedPhysicalBudget({ filePath, expectedScopeId: scopeId, expectedCapPhysicalRequests: cap }), /cap differs/);
});

test('host and emulator proxy processes share one scoped simulator budget under concurrent dispatch', async t => {
  const { filePath, scopeId, cap } = tempScopedManifest(t, 8);
  const modulePath = path.resolve(__dirname, '../tools/phase9-budget.cjs');
  const runOne = index => new Promise((resolve, reject) => {
    const code = `const b=require(${JSON.stringify(modulePath)});`+
      `const r=b.reservePhysicalRequest({owner:${JSON.stringify(index % 2 ? 'android:phase9-proxy' : 'host:phase9')},`+
      `requestKind:'narrator',attemptId:${JSON.stringify(`shared-attempt-${index}`)},profileFingerprint:'sha256:profile-safe'});`+
      `b.markPhysicalRequestDispatched(r);b.finishPhysicalRequest(r,{outcome:'completed',httpStatus:200});`;
    const child = spawn(process.execPath, ['-e', code], { env: { ...process.env,
      PHASE9_BUDGET_SCOPE_FILE: filePath, PHASE9_BUDGET_SCOPE_CAP: String(cap), PHASE9_BUDGET_SCOPE_ID: scopeId },
      stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (status, signal) => status === 0 ? resolve() : reject(new Error(`child ${index} failed (${status ?? signal}): ${stderr}`)));
  });
  await Promise.all(Array.from({ length: cap }, (_, index) => runOne(index)));
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(manifest.spentPhysicalRequests, cap);
  assert.equal(manifest.physicalDispatchAudit.length, cap);
  assert.ok(manifest.physicalDispatchAudit.every(row => row.status === 'completed'));
  assert.equal(new Set(manifest.physicalDispatchAudit.map(row => row.attemptId)).size, cap);
});

test('host HTTP adapter reserves and reconciles through the same scoped simulator authority', async t => {
  const { budget } = tempScopedManifest(t, 1, 'sha256:host-profile');
  const upstream = http.createServer(async (req, res) => {
    for await (const _ of req) {}
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections(); }));
  const transport = createBudgetedHttpTransport({ owner: 'host:phase9-live-run', budget });
  const response = await transport.post({ url: `http://127.0.0.1:${upstream.address().port}/chat/completions`,
    headers: { 'Content-Type': 'application/json' }, body: '{}', timeoutMs: 1000, requestKind: 'campaign_plan',
    logicalRequestId: 'plan:c1:b1', attemptId: 'host-attempt-1', attemptNo: 1,
    campaignId: 'c1', branchId: 'b1', worldId: 'w1', stateVersion: 3, profileFingerprint: 'sha256:host-profile' });
  assert.equal(response.status, 200); assert.equal(response.body, '{"ok":true}');
  const manifest = budget.readManifest();
  assert.equal(manifest.spentPhysicalRequests, 1);
  assert.equal(manifest.physicalDispatchAudit[0].attemptId, 'host-attempt-1');
  assert.equal(manifest.physicalDispatchAudit[0].status, 'completed');
});
