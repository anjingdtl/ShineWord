/** One-use loopback bridge: config file -> Android secure field -> Keychain. */
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PORT = 18592;
const COMPONENT = 'com.shineword.qa.secret/com.shineword.qa.secret.PrivateSecretInput';

function readCredential(keyFile) {
  const fields = {};
  for (const line of fs.readFileSync(keyFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^：:]+)[：:]\s*(.+)$/);
    if (match) fields[match[1].trim()] = match[2].trim();
  }
  const value = fields['api key'] ?? fields['apiKey'] ?? fields['API Key'] ?? fields.key ?? fields['\u5bc6\u94a5'];
  if (!value) throw new Error('credential_unavailable');
  return value;
}

function runAdb(serial, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('adb', ['-s', serial, ...args], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error('adb_failed')));
  });
}

async function main() {
  const [serial, keyFile] = process.argv.slice(2);
  if (!serial || !keyFile) throw new Error('usage: node tools/phase9-secret-bridge.cjs <serial> <credential-file>');
  let credential = readCredential(keyFile);
  let token = crypto.randomBytes(32).toString('hex');
  let consumed = false;
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/one-use-secret') { res.writeHead(404).end(); return; }
    if (consumed || !token || req.headers['x-qa-one-time-token'] !== token) { res.writeHead(410).end(); return; }
    consumed = true;
    const payload = Buffer.from(credential, 'utf8');
    credential = '';
    token = null;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': payload.length });
    res.end(payload, () => payload.fill(0));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  try {
    await runAdb(serial, ['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
    const result = await runAdb(serial, ['shell', 'am', 'instrument', '-w', '-e', 'bridgeUrl', `http://127.0.0.1:${PORT}/one-use-secret`,
      '-e', 'token', token, COMPONENT]);
    if (!consumed || !/INSTRUMENTATION_RESULT: credentialSaved=true/.test(result)
      || !/INSTRUMENTATION_CODE: 0/.test(result)) throw new Error('credential_save_unconfirmed');
    process.stdout.write('credentialSaved=true; credentialStoredByAppKeychain=true; bridgeConsumed=true\n');
  } finally {
    credential = '';
    token = null;
    await runAdb(serial, ['reverse', '--remove', `tcp:${PORT}`]).catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  // Keep failure output free of request headers, input values, and credentials.
  process.stderr.write(`credentialSaved=false; reason=${/adb/.test(error.message) ? 'adb_failed' : error.message.includes('credential') ? 'credential_or_save_unconfirmed' : 'bridge_failed'}\n`);
  process.exitCode = 1;
});
