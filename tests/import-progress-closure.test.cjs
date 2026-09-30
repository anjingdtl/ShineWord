// Real-device P0-1 regression suite: the import progress state must close.
//
// A 1500-chapter TXT can legally end its LAST reading window at 99%, and the
// old pipeline never emitted anything after `activateSource` - so the UI kept
// rendering "解析中 99%" while the build was actually queued and running.
// These tests drive the REAL mobile import orchestration (sourceImport.ts,
// transpiled) against node:sqlite + the real streaming importer and assert
// the closure contract:
//   读取原文 -> 解析原文 -> 原文解析完成(N章·M块) -> 已创建N个构建组/等待模型处理
// - the FINAL progress event is never `importing` (fresh AND reused sources)
// - no stale "99%" line survives past the parse-finished event
// - a reused source (same bytes) re-emits the same closure
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');

class NodeSqliteAdapter {
  constructor(db) {
    this.db = db;
    this.chain = Promise.resolve();
  }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const run = () => {
      this.db.exec('BEGIN IMMEDIATE');
      return work(this).then(
        value => { this.db.exec('COMMIT'); return value; },
        error => { this.db.exec('ROLLBACK'); throw error; },
      );
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
}

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

const sha = {
  async sha256Hex(input) { return crypto.createHash('sha256').update(input, 'utf8').digest('hex'); },
  sha256BytesHex(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); },
};

class NodeTextSource {
  constructor(buffer) {
    this.buffer = buffer;
    this.encoding = 'utf-8';
    this.rawSha256Hex = crypto.createHash('sha256').update(buffer).digest('hex');
    this.decoder = new TextDecoder('utf-8');
  }
  get byteLength() { return this.buffer.length; }
  async readText(offset, maxBytes) {
    const end = Math.min(offset + maxBytes, this.buffer.length);
    const atEof = end >= this.buffer.length;
    const text = this.decoder.decode(this.buffer.subarray(offset, end), { stream: !atEof });
    return { text, nextByteOffset: end, atEof };
  }
}

const PROFILE = {
  id: 'default', name: 'Default',
  endpoint: 'https://api.example.com/v1', model: 'deepseek-flash', keyRef: 'llm.default',
  capabilities: {
    supportsJson: true, supportsStreaming: false, reportsUsage: true,
    contextWindow: 1_048_576, maxOutputTokens: 393_216, supportsPromptCache: true,
  },
  contentOutputTokens: 16_384, reasoningTier: 'low', reasoningDialect: 'deepseek', concurrency: 3,
};

function novelBytes() {
  // Chaptered fixture prose the streaming importer can actually split.
  const lines = [];
  for (let chapter = 1; chapter <= 6; chapter += 1) {
    lines.push(`第${chapter}章 试炼`);
    for (let paragraph = 1; paragraph <= 8; paragraph += 1) {
      lines.push(`林凡来到第${chapter}层石殿，持有一枚玉符。他擅长剑法和身法。`);
      lines.push(`苏轻语居住在云隐峰，与林凡是同门。`);
    }
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

function loadSourceImport(adapter) {
  const filename = path.resolve(__dirname, '../mobile/src/sourceImport.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const mobileModule = new Module(filename, module);
  mobileModule.filename = filename;
  mobileModule.paths = Module._nodeModulePaths(path.dirname(filename));

  const staged = { bytes: null };
  const textSourceMock = {
    stageUri: async (uri, prefix) => {
      const bytes = staged.bytes;
      return {
        path: `/staged/${prefix}`,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length,
        _uri: uri,
      };
    },
    stagedTextSource: async info => new NodeTextSource(staged.bytes),
    deleteStaged: async () => undefined,
  };

  const nativeRequire = mobileModule.require.bind(mobileModule);
  mobileModule.require = request => {
    if (request === './textSource') return textSourceMock;
    if (request === './nativeCrypto') {
      return { nativeSha256: { sha256Hex: sha.sha256Hex }, nativeSha256BytesHex: sha.sha256BytesHex };
    }
    if (request === './secureKeyStore') {
      return { KeychainSecretStore: class { async get() { return 'test-key'; } async set() {} async delete() {} } };
    }
    if (request === './fetchTransport') {
      return { FetchHttpTransport: class { async post() { throw new Error('no network in tests'); } } };
    }
    if (request === './database') {
      return { getDatabaseRuntime: async () => ({ db: adapter, worldStore: new SqliteWorldStore(adapter), llmLedger: null }) };
    }
    if (request === './buildServiceBridge') {
      return {
        startBuildService: async () => true,
        requestRunControl: async () => true,
        notifyBuildProgress: async () => true,
      };
    }
    if (request === './worldImport') {
      return { bytesSha: { sha256BytesHex: sha.sha256BytesHex } };
    }
    const distMatch = request.match(/^(?:\.\.\/)+src\/(.+)$/);
    if (distMatch) return require(path.join('../dist', distMatch[1]));
    return nativeRequire(request);
  };
  mobileModule._compile(compiled, filename);
  return { api: mobileModule.exports, staged };
}

test('fresh import closes the progress state: parse-finished then queued-for-model (never importing 99%)', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const { api, staged } = loadSourceImport(adapter);
    staged.bytes = novelBytes();
    const events = [];
    const summary = await api.importNovelUnified(
      'novel://first', '测试小说.txt', PROFILE, 'progressive',
      progress => events.push(progress),
    );
    assert.ok(summary.chapterCount > 0, 'chapters were actually parsed');
    assert.ok(summary.chunkCount > 0);
    assert.ok(summary.runIds.length >= 1, 'a build run was queued');

    const messages = events.map(event => event.message ?? '');
    assert.ok(messages.some(m => m.startsWith('解析中') || m.includes('读取并解析')),
      'reading/parse progress was reported during the scan');
    const finishedAt = messages.findIndex(m => m.startsWith('原文解析完成'));
    assert.ok(finishedAt !== -1, 'the parse-finished closure event exists');
    assert.ok(messages[finishedAt].includes(`${summary.chapterCount} 章`), 'closure reports real chapter count');
    assert.ok(messages[finishedAt].includes(`${summary.chunkCount} 块`), 'closure reports real chunk count');

    const last = events[events.length - 1];
    assert.notEqual(last.phase, 'importing',
      'the FINAL progress event must leave the importing state (UI renders this)');
    assert.equal(last.phase, 'extracting');
    assert.ok(last.message.includes('已创建'), 'the final event announces the queued build groups');
    assert.ok(typeof last.chunksTotal === 'number' && last.chunksTotal > 0,
      'the queued counter travels with the closure event');

    // No stale percentage line survives past the parse-finished event.
    for (let i = finishedAt; i < messages.length; i += 1) {
      assert.ok(!/解析中\s*\d+%/.test(messages[i]), `stale percentage leaked: ${messages[i]}`);
    }
  } finally {
    db.close();
  }
});

test('reused source (same bytes re-imported) closes identically - no stale 99%', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const { api, staged } = loadSourceImport(adapter);
    staged.bytes = novelBytes();

    const first = [];
    await api.importNovelUnified('novel://same', '测试小说.txt', PROFILE, 'progressive',
      progress => first.push(progress));
    const second = [];
    const summary = await api.importNovelUnified('novel://same', '测试小说.txt', PROFILE, 'progressive',
      progress => second.push(progress));

    assert.equal(summary.reusedSource, true, 'the fast path hit the existing active source');
    const messages = second.map(event => event.message ?? '');
    assert.ok(messages.some(m => m.startsWith('原文解析完成')),
      'reused import also emits the parse-finished closure');
    const last = second[second.length - 1];
    assert.notEqual(last.phase, 'importing', 'reused import must not get stuck rendering importing');
    assert.equal(last.phase, 'extracting');
    for (const message of messages) {
      assert.ok(!/解析中\s*9\d%/.test(message) || messages.indexOf(message) < messages.findIndex(m => m.startsWith('原文解析完成')),
        'a late 9x% reading line outlived the closure');
    }
  } finally {
    db.close();
  }
});

test('full-build mode closes with queued-for-model too (legacy streaming path parity)', async () => {
  const db = setupDb();
  try {
    const adapter = new NodeSqliteAdapter(db);
    const { api, staged } = loadSourceImport(adapter);
    staged.bytes = novelBytes();
    const events = [];
    const summary = await api.importNovelStreaming('novel://full', '测试小说.txt', PROFILE,
      progress => events.push(progress));
    assert.ok(summary.runId, 'full streaming path created its run');
    const last = events[events.length - 1];
    assert.notEqual(last.phase, 'importing');
    assert.equal(last.phase, 'extracting');
    assert.ok(last.message.includes('已创建'));
    assert.ok((last.chunksTotal ?? 0) > 0, 'unit count is attached');
  } finally {
    db.close();
  }
});
