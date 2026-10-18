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
