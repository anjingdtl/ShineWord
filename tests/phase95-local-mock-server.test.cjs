const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(url, child) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`mock server exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`mock server health check failed: ${lastError?.message ?? 'not ready'}`);
}

test('campaign-plan mock stays within the imported opening scope', async () => {
  const port = await unusedPort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shineword-phase95-mock-'));
  const logPath = path.join(tempDir, 'redacted-requests.jsonl');
  const serverPath = path.join(__dirname, 'helpers', 'phase95LocalMockServer.cjs');
  const child = spawn(process.execPath, [serverPath, logPath], {
    env: { ...process.env, PHASE95_MOCK_PORT: String(port) },
    stdio: 'ignore',
  });

  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`, child);
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-phase9-request-kind': 'campaign_plan' },
      body: JSON.stringify({ model: 'synthetic', messages: [{ role: 'user', content: '{}' }] }),
    });
    assert.equal(response.status, 200);
    const wire = await response.json();
    const candidate = JSON.parse(wire.choices[0].message.content);
    assert.deepEqual(candidate.rewards, [], 'the imported opening has no scoped knowledge reward');
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('local mock can hold a Narrator response without storing request content', async () => {
  const port = await unusedPort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shineword-phase95-held-narrator-'));
  const logPath = path.join(tempDir, 'redacted-requests.jsonl');
  const serverPath = path.join(__dirname, 'helpers', 'phase95LocalMockServer.cjs');
  const child = spawn(process.execPath, [serverPath, logPath], {
    env: { ...process.env, PHASE95_MOCK_PORT: String(port), PHASE95_HOLD_NARRATOR: '1' },
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}/v1/chat/completions`;

  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`, child);
    const planner = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-phase9-request-kind': 'planner' },
      body: JSON.stringify({ model: 'synthetic', messages: [
        { role: 'system', content: 'ShineWord Planner (V2)' },
        { role: 'user', content: JSON.stringify({ turnId: 'turn-device-fault', expectedStateVersion: 4, playerIntent: '观察' }) },
      ] }),
    });
    assert.equal(planner.status, 200);

    const abort = new AbortController();
    const pendingNarrator = fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-phase9-request-kind': 'narrator' },
      body: JSON.stringify({ model: 'synthetic', messages: [
        { role: 'system', content: 'You are ShineWord Narrator' },
        { role: 'user', content: JSON.stringify({ turnId: 'turn-device-fault', outcomeGrade: 'success' }) },
      ] }),
      signal: abort.signal,
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    abort.abort();
    await assert.rejects(pendingNarrator, error => error.name === 'AbortError');

    const rows = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const held = rows.find(row => row.requestKind === 'narrator');
    assert.ok(held);
    assert.equal(held.status, 'held');
    assert.equal(held.requestBodyStored, false);
    assert.equal(held.authorizationLogged, false);
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
