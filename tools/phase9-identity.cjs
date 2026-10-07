const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function codeIdentity() {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.(tsx?|js)$/.test(file)) files.push(file);
    }
  }
  walk('src'); walk('mobile/src');
  // v3 also includes the version metadata actually bundled into the UI.
  // Native sources/resources and build inputs are included. Generated bundles,
  // local SDK/signing properties and credentials are deliberately excluded.
  const nativeFiles = cp.execFileSync('git', ['ls-files', 'mobile/android'], { cwd: root, encoding: 'utf8' })
    .trim().split(/\r?\n/).filter(Boolean);
  files.push(...nativeFiles, ...[
    'mobile/scripts/build-apk.js', 'mobile/App.tsx', 'mobile/index.js', 'mobile/src/version.json',
    'mobile/app.json', 'mobile/babel.config.js', 'mobile/metro.config.js',
    'package.json', 'package-lock.json', 'tsconfig.json',
    'mobile/package.json', 'mobile/package-lock.json', 'mobile/tsconfig.json',
  ].filter(file => fs.existsSync(path.join(root, file))));
  const fileHashes = Object.fromEntries(files.sort().map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
  const apk = path.join(root, 'dist/apk/debug/ShineWord-V1.0.0-debug.apk');
  return { identityScopeVersion: 3, head: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    productionSourcesHash: hash(JSON.stringify(fileHashes)), fileHashes,
    ...(fs.existsSync(apk) ? { apkSha256: hash(fs.readFileSync(apk)), apkBytes: fs.statSync(apk).size } : {}) };
}
module.exports = { codeIdentity };
if (require.main === module) console.log(JSON.stringify(codeIdentity(), null, 2));
