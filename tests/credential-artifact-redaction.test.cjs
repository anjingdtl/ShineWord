const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReport, readCredentials, writeReport } = require('../tools/real-glm-reasoning-closeout.cjs');

test('the real GLM harness writes only credential loaded state from a fake credential file', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shineword-credential-fixture-'));
  const credentialPath = path.join(directory, 'fake-credential.txt');
  const outputPath = path.join(directory, 'artifact.json');
  t.after(() => {
    for (const file of [credentialPath, outputPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  });
  const fakeKey = 'unit-only-fake-key-never-sent';
  const content = `API Key: ${fakeKey}\nendpoint: https://example.invalid/v1\nmodel: glm-fixture\n`;
  fs.writeFileSync(credentialPath, content);
  const evidence = createReport();
  assert.deepEqual(evidence.credential, { loaded: false });
  const credentials = readCredentials(credentialPath, evidence);
  assert.equal(credentials.key, fakeKey);
  assert.equal(credentials.model, 'glm-fixture');
  // Corpus identity is useful and must survive credential redaction.
  const corpus = { file: 'fixture-novel.txt', sha256: 'fixture-corpus-digest', bytes: 42 };
  evidence.shortNovel = corpus;
  await writeReport(outputPath, evidence);
  const serialized = fs.readFileSync(outputPath, 'utf8');
  const artifact = JSON.parse(serialized);
  assert.deepEqual(artifact.credential, { loaded: true });
  assert.equal(Object.hasOwn(artifact, 'credentialFile'), false);
  assert.equal(serialized.includes(fakeKey), false);
  assert.equal(serialized.includes(crypto.createHash('sha256').update(content).digest('hex')), false);
  assert.equal(serialized.includes(JSON.stringify(credentialPath).slice(1, -1)), false);
  assert.equal(serialized.includes(JSON.stringify(directory).slice(1, -1)), false);
  assert.equal(serialized.includes(path.basename(credentialPath)), false);
  assert.equal(serialized.includes(`"bytes": ${Buffer.byteLength(content)}`), false);
  assert.equal(serialized.includes('keyLength'), false);
  assert.equal(serialized.includes('credentialSource'), false);
  assert.deepEqual(artifact.shortNovel, corpus);
  assert.equal(artifact.physicalRequestCount, 0, 'fixture writes no live API requests');
});

test('incomplete fake credentials remain unloaded and cannot add file metadata to evidence', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shineword-credential-missing-'));
  const credentialPath = path.join(directory, 'missing-key.txt');
  const outputPath = path.join(directory, 'artifact.json');
  t.after(() => {
    for (const file of [credentialPath, outputPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  });
  fs.writeFileSync(credentialPath, 'model: glm-fixture\n');
  const evidence = createReport();
  assert.throws(() => readCredentials(credentialPath, evidence), error => error.safeCode === 'credential_fields_missing');
  await writeReport(outputPath, evidence);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')).credential, { loaded: false });
});

test('historical real GLM metrics retain budgets, usage and corpus SHA but no credential fingerprint', () => {
  const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/reviews/reasoning-closeout/R6_REAL_GLM_METRICS.json'), 'utf8'));
  assert.deepEqual(artifact.credential, { loaded: true });
  assert.equal(Object.hasOwn(artifact, 'credentialFile'), false);
  assert.match(artifact.shortNovel.sha256, /^[a-f0-9]{64}$/);
  assert.match(artifact.longNovel.sha256, /^[a-f0-9]{64}$/);
  assert.ok(artifact.directPlanner.length > 0);
  assert.ok(artifact.storyTurns.length > 0);
  assert.ok(artifact.directPlanner.every(gate => gate.usage && gate.providerParams && gate.durationMs >= 0));
});
