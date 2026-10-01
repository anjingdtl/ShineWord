'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '../..');
const { BUILTIN_MIGRATIONS } = require(path.join(root, 'dist/infra/sqlite/builtinMigrations'));
const { applySqliteMigrations } = require(path.join(root, 'dist/infra/sqlite/migrations'));
const { SqliteWorldStore } = require(path.join(root, 'dist/infra/sqlite/sqliteWorldStore'));
const { SqliteBuildRunStore } = require(path.join(root, 'dist/infra/sqlite/sqliteBuildRunStore'));
const { SqliteLlmLedgerStore } = require(path.join(root, 'dist/infra/sqlite/sqliteLlmLedgerStore'));
const { GlobalRateScheduler } = require(path.join(root, 'dist/application/worldBuild/rateScheduler'));

class NodeSqliteAdapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async execute(sql, params = []) {
    if (!params.length && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const run = async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try { const value = await work(this); this.db.exec('COMMIT'); return value; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    };
    const pending = this.chain.then(run, run);
    this.chain = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

function loadMobileModule(relativePath, mocks = {}) {
  const filename = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const nativeRequire = loaded.require.bind(loaded);
  loaded.require = request => {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    const dist = request.match(/^(?:\.\.\/)+src\/(.+)$/);
    return dist ? require(path.join(root, 'dist', dist[1])) : nativeRequire(request);
  };
  loaded._compile(compiled, filename);
  return loaded.exports;
}

class NodeTextSource {
  constructor(buffer) {
    this.buffer = buffer;
    // Match the native BOM / UTF-8-validity sniff without printing source text.
    this.encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le'
      : buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be' : 'utf-8';
    if (this.encoding === 'utf-8') {
      try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
      catch { this.encoding = 'gb18030'; }
    }
    this.rawSha256Hex = crypto.createHash('sha256').update(buffer).digest('hex');
    this.decoder = new TextDecoder(this.encoding);
  }
  get byteLength() { return this.buffer.length; }
  async readText(offset, maxBytes) {
    const end = Math.min(offset + maxBytes, this.buffer.length);
    const atEof = end >= this.buffer.length;
    return { text: this.decoder.decode(this.buffer.subarray(offset, end), { stream: !atEof }), nextByteOffset: end, atEof };
  }
}

const sha = {
  async sha256Hex(input) { return crypto.createHash('sha256').update(input, 'utf8').digest('hex'); },
  sha256BytesHex(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); },
};

async function createMobileHarness({ bytes, coordinator, transport, secrets, serviceStart = async () => false, nativeControl } = {}) {
  const db = new DatabaseSync(':memory:');
  const adapter = new NodeSqliteAdapter(db);
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  const runtime = { db: adapter, worldStore: new SqliteWorldStore(adapter), llmLedger: new SqliteLlmLedgerStore(adapter) };
  const staged = { bytes };
  const defaultTransport = { async post() { throw new Error('unexpected network request'); } };
  const mocks = {
    './database': { getDatabaseRuntime: async () => runtime },
    './llmScheduler': {
      // Fresh unconfigured scheduler per run, mirroring one build execution.
      schedulerForProfile: () => new GlobalRateScheduler({ maxConcurrent: 2 }),
    },
    './nativeCrypto': { nativeSha256: sha, nativeSha256BytesHex: sha.sha256BytesHex },
    './worldImport': { bytesSha: sha },
    './secureKeyStore': { KeychainSecretStore: class { async get(ref) { return secrets ? secrets.get(ref) : 'test-memory-only'; } } },
    './fetchTransport': { FetchHttpTransport: class { post(request) { return (transport ?? defaultTransport).post(request); } } },
    './textSource': {
      async stageUri() { return { path: 'memory-stage', sha256: crypto.createHash('sha256').update(staged.bytes).digest('hex'), byteLength: staged.bytes.length }; },
      async stagedTextSource() { return new NodeTextSource(staged.bytes); },
      async deleteStaged() {},
    },
    './buildServiceBridge': { startBuildService: serviceStart, requestRunControl: nativeControl ?? (async () => false), notifyBuildProgress: async () => true },
  };
  if (coordinator) mocks['../../src/application/worldBuild/coordinator'] = coordinator;
  const sourceImport = loadMobileModule('mobile/src/sourceImport.ts', mocks);
  const watchdog = loadMobileModule('mobile/src/buildWatchdog.ts', { ...mocks, './sourceImport': sourceImport });
  return { db, adapter, runtime, staged, sourceImport, watchdog, runStore: new SqliteBuildRunStore(adapter) };
}

module.exports = { root, NodeSqliteAdapter, NodeTextSource, sha, loadMobileModule, createMobileHarness };
