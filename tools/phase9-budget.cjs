/** Shared, persistent physical-dispatch cap for private Phase 9 QA drivers. */
const fs = require('node:fs');
const path = require('node:path');
const manifestPath = path.resolve(__dirname, '../.tmp/phase9/test-manifest.json');
function updateManifest(update) {
  const lockPath = `${manifestPath}.lock`;
  let lock;
  for (let i = 0; i < 200; i++) {
    try { lock = fs.openSync(lockPath, 'wx'); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); }
  }
  if (lock === undefined) throw new Error('QA manifest lock unavailable; refusing dispatch');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    update(manifest);
    const temporary = `${manifestPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2));
    fs.renameSync(temporary, manifestPath);
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}
function reservePhysicalRequest(owner) {
  updateManifest(manifest => {
    if (!Number.isInteger(manifest.budget.spent) || !Number.isInteger(manifest.budget.totalPhysicalRequests)) throw new Error('Invalid QA budget manifest');
    if (manifest.budget.spent >= manifest.budget.totalPhysicalRequests) throw new Error('Phase 9 shared physical request budget exhausted before dispatch');
    manifest.budget.spent++;
    manifest.budget.lastReservation = { owner, at: new Date().toISOString() };
  });
}
module.exports = { reservePhysicalRequest, updateManifest, manifestPath };
