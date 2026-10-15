/**
 * Create an isolated UI-test save and its matching portable world archive
 * from the current production fixture/export code. No private novel is read.
 * Usage: node tests/helpers/phase95SyntheticArchiveGenerator.cjs <save.json> <world.zip>
 */
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { fixture } = require('./phase9CampaignFixture.cjs');
const { exportSave } = require('../../dist/application/export/saveFile.js');
const { encodeWorldPackageArchive } = require('../../dist/application/export/worldPackageArchive.js');
const { sha } = require('./mobileHarness.cjs');

async function writeArtifact(path, bytes) {
  await fs.writeFile(path, bytes, { flag: 'wx' });
  return {
    bytes: Buffer.byteLength(bytes),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

async function requireUnusedOutput(path) {
  try {
    await fs.access(path);
    throw new Error('Refusing to overwrite an existing synthetic output file.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

(async () => {
  const [savePath, worldPath] = process.argv.slice(2);
  if (!savePath || !worldPath) throw new Error('Provide output paths for both the save JSON and world ZIP.');
  await requireUnusedOutput(savePath);
  await requireUnusedOutput(worldPath);
  const h = await fixture();
  try {
    const pkgRevision = await h.worlds.getPublishedPackageRevision('w');
    if (pkgRevision === null) throw new Error('Synthetic fixture has no published world package.');
    const pkg = await h.worlds.getWorldPackage('w', pkgRevision);
    const world = await h.worlds.getWorld('w');
    if (!pkg || !world) throw new Error('Synthetic fixture world/package is missing.');

    const save = await exportSave({
      db: h.adapter, sha256Hex: sha.sha256Hex,
      campaignId: h.campaignId, branchId: h.branchId,
      createdAt: '2026-10-16T00:00:00.000Z',
    });
    const archive = await encodeWorldPackageArchive({ title: 'Phase 9.5 synthetic QA world', ...pkg }, sha.sha256Hex);
    const saveInfo = await writeArtifact(savePath, save.json);
    const worldInfo = await writeArtifact(worldPath, archive);
    console.log(JSON.stringify({
      mode: 'synthetic-only',
      save: { ...saveInfo, schemaVersion: save.save.manifest.schemaVersion },
      world: { ...worldInfo, archiveSchema: 'shineword-world-archive-5', packageContentHash: pkg.manifest.contentHash },
      campaignId: h.campaignId,
      branchId: h.branchId,
      worldId: world.worldId,
      packageRevision: pkg.manifest.revision,
    }));
  } finally {
    h.db.close();
  }
})().catch(error => {
  process.stderr.write(`${error.stack || String(error)}\n`);
  process.exitCode = 1;
});
