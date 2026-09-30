/**
 * Generates mobile/src/version.json from mobile/package.json (VERSIONING.md).
 * Run by `npm run prebuild` inside mobile/ before every apk build; the file
 * is GENERATED - never edit it by hand.
 */
const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');
const pkg = require(path.join(mobileRoot, 'package.json'));

const parts = String(pkg.version).split('.').map(Number);
if (parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0)) {
  throw new Error(`mobile/package.json version must be major.minor.patch: ${pkg.version}`);
}
const [major, minor, patch] = parts;
const baseVersionCode = major * 1_000_000 + minor * 10_000 + patch * 100;

// Build suffix contract (VERSIONING.md §2): explicit 0-99 env wins; otherwise 0.
const explicit = process.env.SHINE_WRITER_BUILD_NUMBER;
let build = 0;
if (explicit !== undefined) {
  const parsed = Number(explicit);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 99) {
    throw new Error(`SHINE_WRITER_BUILD_NUMBER must be an integer 0-99, got: ${explicit}`);
  }
  build = parsed;
}

const versionJson = {
  versionName: `V${pkg.version}`,
  versionCode: baseVersionCode + build,
  buildTime: new Date().toISOString(),
};

const outPath = path.join(mobileRoot, 'src', 'version.json');
fs.writeFileSync(outPath, JSON.stringify(versionJson, null, 2) + '\n');
console.log(`[prebuild] src/version.json -> ${versionJson.versionName} / ${versionJson.versionCode}`);
