/**
 * Version metadata consistency gate (docs/VERSIONING.md).
 * Exit 1 on any mismatch. Used by `npm run verify:version`.
 *
 * Checks: root package.json, mobile package.json + lockfile (both version
 * slots), build.gradle versionName/versionCode formula, the latest
 * CHANGELOG release entry, and the README current-version badge.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function readText(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fail(message) {
  console.error(`[verify:version] ${message}`);
  process.exit(1);
}

const pkg = readJson('package.json');
const mobilePkg = readJson('mobile/package.json');
const mobileLock = readJson('mobile/package-lock.json');
const gradle = readText('mobile/android/app/build.gradle');
const changelog = readText('CHANGELOG.md');
const readme = readText('README.md');

const version = String(pkg.version || '');
const parts = version.split('.').map(Number);
if (parts.length !== 3 || parts.some(n => !Number.isInteger(n) || n < 0)) {
  fail(`package.json.version must be major.minor.patch, got: ${version}`);
}
const [major, minor, patch] = parts;
const baseVersionCode = major * 1_000_000 + minor * 10_000 + patch * 100;

// --- unified version across packages ---------------------------------------
if (mobilePkg.version !== version) {
  fail(`mobile/package.json.version=${mobilePkg.version} !== package.json=${version}`);
}
if (mobileLock.version !== version) {
  fail(`mobile/package-lock.json.version=${mobileLock.version} !== ${version}`);
}
const lockRoot = mobileLock.packages && mobileLock.packages[''];
if (!lockRoot || lockRoot.version !== version) {
  fail(`mobile/package-lock.json.packages[""].version=${lockRoot?.version} !== ${version}`);
}

// --- build.gradle versionName / versionCode --------------------------------
const versionNameMatch = gradle.match(/versionName\s+["']([^"']+)["']/);
if (!versionNameMatch) fail('build.gradle versionName not found');
if (versionNameMatch[1] !== version) {
  fail(`build.gradle versionName=${versionNameMatch[1]} !== ${version}`);
}
const versionCodeMatch = gradle.match(/versionCode\s+(\d+)/);
if (!versionCodeMatch) fail('build.gradle versionCode not found');
const versionCode = Number(versionCodeMatch[1]);
const build = versionCode - baseVersionCode;
if (build < 0 || build > 99) {
  fail(`build.gradle versionCode=${versionCode} does not match the formula ` +
    `${major}*1000000+${minor}*10000+${patch}*100+build(0-99) => expected base ${baseVersionCode}`);
}

// --- CHANGELOG carries the released entry -----------------------------------
const changelogEntry = `## [${version}] -`;
if (!changelog.includes(changelogEntry)) {
  fail(`CHANGELOG.md is missing a '${changelogEntry} <date>' entry for ${version}`);
}

// --- README current-version references --------------------------------------
if (!readme.includes(`V${version}`)) {
  fail(`README.md does not reference the current version V${version}`);
}
if (!readme.includes(`versionCode ${versionCode}`) && !readme.includes(`versionCode=${versionCode}`)) {
  fail(`README.md does not reference versionCode ${versionCode}`);
}
if (!readme.includes('ShineHe')) {
  fail('README.md does not credit the author ShineHe');
}

console.log(`[verify:version] OK version=${version} versionCode=${versionCode} (build ${build})`);
