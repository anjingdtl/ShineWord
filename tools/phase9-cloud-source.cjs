/** Local real-source preparation. No provider, RNG, build or candidate calls. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { NodeSqliteAdapter } = require('../tests/helpers/mobileHarness.cjs');
const { installBaselineSchema } = require('../dist/application/project/dbBaseline');
const { SqliteSourceStore } = require('../dist/infra/sqlite/sqliteSourceStore');
const { importTxtSourceStreaming } = require('../dist/application/import/streamingTxtImport');
const { normalizeText } = require('../dist/application/import/txtImport');
const { codeIdentity } = require('./phase9-identity.cjs');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function fileDigest(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

class FileTextSource {
  constructor(file, rawSha256Hex) {
    this.file = file;
    this.rawSha256Hex = rawSha256Hex;
    this.byteLength = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const probe = Buffer.alloc(Math.min(this.byteLength, 65536));
    try { fs.readSync(fd, probe, 0, probe.length, 0); }
    finally { fs.closeSync(fd); }
    this.encoding = probe[0] === 0xff && probe[1] === 0xfe ? 'utf-16le'
      : probe[0] === 0xfe && probe[1] === 0xff ? 'utf-16be' : 'utf-8';
    if (this.encoding === 'utf-8') {
      // A probe ending within a UTF-8 code point is not evidence of GB18030.
      try { new TextDecoder('utf-8', { fatal: true }).decode(probe, { stream: probe.length < this.byteLength }); }
      catch { this.encoding = 'gb18030'; }
    }
    this.decoder = new TextDecoder(this.encoding, { fatal: true });
    this.nextOffset = 0;
  }
  async readText(offset, maxBytes) {
    if (offset !== this.nextOffset) throw Error('Non-sequential streaming text read');
    const length = Math.min(maxBytes, this.byteLength - offset);
    const handle = await fs.promises.open(this.file, 'r');
    const buffer = Buffer.alloc(length);
    let bytesRead;
    try { ({ bytesRead } = await handle.read(buffer, 0, length, offset)); }
    finally { await handle.close(); }
    if (bytesRead !== length) throw Error('Source changed during import');
    this.nextOffset = offset + bytesRead;
    const atEof = this.nextOffset === this.byteLength;
    return { text: this.decoder.decode(buffer, { stream: !atEof }), nextByteOffset: this.nextOffset, atEof };
  }
}

async function prepare(input, privateDirectory) {
  if (!input) throw Error('Usage: node tools/phase9-cloud-source.cjs <real TXT> [private directory]');
  privateDirectory = path.resolve(privateDirectory ?? path.join(__dirname, '../.tmp/phase9/cloud-source'));
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  const rawSha256Hex = await fileDigest(input);
  const retained = path.join(privateDirectory, `raw-${rawSha256Hex.slice(0, 16)}.txt`);
  if (fs.existsSync(retained)) {
    if (await fileDigest(retained) !== rawSha256Hex) throw Error('Retained source identity mismatch; refusing overwrite');
  } else {
    fs.copyFileSync(input, retained, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(retained, 0o600);
    if (await fileDigest(retained) !== rawSha256Hex) throw Error('Staged copy hash mismatch');
  }
  const source = new FileTextSource(retained, rawSha256Hex);
  const database = path.join(privateDirectory, 'source.sqlite');
  const db = new DatabaseSync(database);
  const adapter = new NodeSqliteAdapter(db);
  const store = new SqliteSourceStore(adapter);
  let sourceId, reused = false, splits = null;
  try {
    await installBaselineSchema(adapter); // Refuses legacy or partial schemas.
    const existing = await store.findActiveByRawHash(rawSha256Hex);
    if (existing) { sourceId = existing.sourceId; reused = true; }
    else {
      sourceId = `src-cloud-${rawSha256Hex.slice(0, 16)}`;
      if (await store.getManifest(sourceId)) throw Error('Incomplete source exists; audit it before recovery, never clear it');
      const now = new Date().toISOString();
      const manifest = { sourceId, rawSha256Hex, normalizedTreeHash: '',
        normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: source.byteLength,
        codePointCount: 0, encoding: source.encoding, normalizeVersion: 'normalize-1',
        chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
        splitStrategy: 'standard', fileName: path.basename(input), title: path.basename(input).replace(/\.txt$/i, ''),
        status: 'staging', createdAt: now, updatedAt: now };
      await store.beginStaging(manifest);
      const imported = await importTxtSourceStreaming(source, store, sourceId, {
        sha256Hex: async text => digest(Buffer.from(text, 'utf8')),
        sha256BytesHex: async bytes => digest(bytes),
      });
      splits = imported.maxParagraphSplits;
      await store.activateSource({ manifest: { ...manifest, ...{
        normalizedTreeHash: imported.normalizedTreeHash, codePointCount: imported.codePointCount,
        splitStrategy: imported.splitStrategy, status: 'active', updatedAt: new Date().toISOString(),
      } }, chapters: imported.chapters, chunks: imported.chunks });
    }
  } finally { db.close(); }
  // Cold read and independently compare the complete real source. This is a
  // functional verification, never a memory or performance benchmark.
  const cold = new DatabaseSync(database, { readOnly: true });
  let evidence;
  try {
    if (cold.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('Source SQLite integrity failure');
    const coldStore = new SqliteSourceStore(new NodeSqliteAdapter(cold));
    const manifest = await coldStore.getManifest(sourceId);
    if (manifest?.status !== 'active' || manifest.rawSha256Hex !== rawSha256Hex) throw Error('Cold source manifest mismatch');
    const shards = cold.prepare('SELECT start_cp,end_cp,text FROM imported_source_segments WHERE source_id=? ORDER BY shard_index').all(sourceId);
    let cursor = 0;
    for (const shard of shards) {
      if (shard.start_cp !== cursor || [...shard.text].length !== shard.end_cp - shard.start_cp) throw Error('Incomplete shard coverage');
      cursor = shard.end_cp;
    }
    if (cursor !== manifest.codePointCount) throw Error('Manifest/shard range mismatch');
    const treeHash = digest(Buffer.from(shards.map(s => digest(Buffer.from(s.text, 'utf8'))).join(''), 'utf8'));
    if (treeHash !== manifest.normalizedTreeHash) throw Error('Cold normalized tree hash mismatch');
    const expected = normalizeText(new TextDecoder(manifest.encoding, { fatal: true }).decode(fs.readFileSync(retained)));
    const normalizedSha256 = digest(Buffer.from(shards.map(s => s.text).join(''), 'utf8'));
    if (normalizedSha256 !== digest(Buffer.from(expected, 'utf8'))) throw Error('Full source differs from production batch normalization');
    const chapters = await coldStore.getChapters(sourceId), chunks = await coldStore.getChunks(sourceId);
    for (const record of [...chapters, ...chunks]) {
      const text = await coldStore.readRange(sourceId, record.startOffset, record.endOffset);
      if (digest(Buffer.from(text, 'utf8')) !== record.contentHash) throw Error('Cold chapter/chunk digest mismatch');
    }
    evidence = { schema: 'phase9-cloud-source-evidence-1', at: new Date().toISOString(), sourceId,
      database, rawFile: retained, rawSha256Hex, bytes: source.byteLength, encoding: manifest.encoding,
      codePointCount: manifest.codePointCount, normalizedTreeHash: manifest.normalizedTreeHash,
      normalizedSha256, splitStrategy: manifest.splitStrategy, shards: shards.length,
      chapters: chapters.length, chunks: chunks.length, recordsHashVerified: chapters.length + chunks.length,
      paragraphSplits: splits, reusedSource: reused, integrityCheck: 'ok', completeSourceComparison: true, treeHashVerified: true,
      sourceIdentity: codeIdentity().productionSourcesHash,
      cloudModelRequests: cold.prepare('SELECT COUNT(*) n FROM llm_request_attempts').get().n,
      worldPackages: cold.prepare('SELECT COUNT(*) n FROM world_packages').get().n,
      canonFacts: cold.prepare('SELECT COUNT(*) n FROM canon_facts').get().n,
      acceptanceCredit: 'source_import_only; no build, candidate, adoption, journey or UI credit' };
  } finally { cold.close(); }
  if (await fileDigest(retained) !== rawSha256Hex) throw Error('Retained bytes changed during verification');
  evidence.qaDriverSha256 = digest(fs.readFileSync(__filename));
  fs.writeFileSync(path.join(privateDirectory, 'source-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}

module.exports = { prepare, FileTextSource };
if (require.main === module) prepare(...process.argv.slice(2)).then(value => console.log(JSON.stringify(value, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
