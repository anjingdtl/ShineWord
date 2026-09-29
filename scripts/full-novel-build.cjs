// Closeout C7 full-novel real-model build harness.
//
// Runs the COMPLETE closeout pipeline against the real configured model:
// streaming import -> persisted shards -> budget group plan -> real LLM group
// extraction (C3 segment protocol) -> atomic per-chunk commits -> mapping ->
// package build. Credentials are read in-process and NEVER printed, logged,
// or persisted; metrics contain only statuses, timings, tokens and counts.
//
// Usage: node scripts/full-novel-build.cjs <novel.txt> <config.txt> <workdir>
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteSourceStore } = require('../dist/infra/sqlite/sqliteSourceStore');
const { SqliteBuildRunStore } = require('../dist/infra/sqlite/sqliteBuildRunStore');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { importTxtSourceStreaming } = require('../dist/application/import/streamingTxtImport');
const { createExtractionRun, executeRun } = require('../dist/application/worldBuild/coordinator');
const { LlmGroupExtractor } = require('../dist/application/world/llmGroupExtractor');
const { LlmChunkExtractor } = require('../dist/application/world/llmExtractor');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
const { buildPackageFromCanon } = require('../dist/application/worldPackage/buildPackageFromCanon');

function parseConfig(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const clean = lines.map(l => {
    if (/^https?:\/\//.test(l)) return l;
    const i = Math.max(l.indexOf('：'), l.indexOf(':'));
    return i > 0 && i < 12 ? l.slice(i + 1).trim() : l;
  });
  const endpoint = clean.find(l => /^https?:\/\//.test(l));
  const key = clean.find(l => l !== endpoint && l.length >= 30 && !/^https?:\/\//.test(l));
  const model = clean.find(l => l !== endpoint && l !== key && /^[\w.\-]+$/.test(l));
  if (!endpoint || !key || !model) throw new Error('config parse failed');
  return { endpoint, key, model };
}

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

const sha = {
  async sha256BytesHex(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); },
  async sha256Hex(input) { return crypto.createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** Verified capability probe: never guess the context window. */
async function probeContextWindow(cfg, log) {
  const filler = '夜色渐深，客栈中的灯火摇曳，旅人们低声交谈。'.repeat(64);
  let accepted = 0;
  for (const targetChars of [16_000, 48_000, 96_000, 160_000, 240_000]) {
    const payload = filler.repeat(Math.ceil(targetChars / filler.length)).slice(0, targetChars);
    try {
      const res = await fetch(cfg.endpoint.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: 'You echo the marker.' },
            { role: 'user', content: payload + '\nMARKER-7391' },
          ],
          max_tokens: 8,
        }),
      });
      if (res.status !== 200) {
        log({ msg: 'window-probe rejected', chars: targetChars, status: res.status });
        break;
      }
      await res.json();
      accepted = targetChars;
      log({ msg: 'window-probe accepted', chars: targetChars });
    } catch (error) {
      log({ msg: 'window-probe error', chars: targetChars, error: error.message });
      break;
    }
  }
  // Conservative usable window: half the largest accepted payload in tokens
  // (CJK ~= 1 token per char, worst case), floored at a safe minimum.
  const contextWindowTokens = Math.max(16_000, Math.floor(accepted / 2));
  return { contextWindowTokens, accepted };
}

async function main() {
  const [novelFile, configFile, workdir] = process.argv.slice(2);
  if (!novelFile || !configFile || !workdir) throw new Error('usage: node full-novel-build.cjs <novel> <config> <workdir>');
  fs.mkdirSync(workdir, { recursive: true });
  const metricsPath = path.join(workdir, 'metrics.jsonl');
  const log = value => {
    const entry = typeof value === 'string'
      ? { t: new Date().toISOString(), msg: value }
      : { t: new Date().toISOString(), ...value };
    fs.appendFileSync(metricsPath, JSON.stringify(entry) + '\n');
  };

  const cfg = parseConfig(configFile);
  log({ msg: 'config parsed', model: cfg.model });

  const budget = await probeContextWindow(cfg, log);
  log({ msg: 'budget', contextWindowTokens: budget.contextWindowTokens, verifiedAtChars: budget.accepted });

  const secrets = {
    store: {},
    async set(ref, s) { this.store[ref] = s; },
    async get(ref) { return this.store[ref] ?? null; },
    async delete(ref) { delete this.store[ref]; },
  };
  const keyRef = 'full-build-key';
  await secrets.set(keyRef, cfg.key);
  const profile = {
    id: 'full-build',
    name: 'full-build',
    endpoint: cfg.endpoint,
    model: cfg.model,
    keyRef,
    capabilities: {
      supportsJson: true,
      supportsStreaming: false,
      reportsUsage: true,
      contextWindow: budget.contextWindowTokens,
      maxOutputTokens: 12_000,
    },
  };
  const transport = {
    async post(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await fetch(request.url, {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
        });
        const body = await response.text();
        return { status: response.status, body, headers: {} };
      } catch (error) {
        if (controller.signal.aborted) throw new Error('LLM request timed out.');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
  const provider = new OpenAICompatibleProvider(profile, secrets, transport, 600_000);

  const dbPath = path.join(workdir, 'shineword.db');
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* fresh */ }
  }
  const db = new DatabaseSync(dbPath);
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  const adapter = new NodeSqliteAdapter(db);
  const sourceStore = new SqliteSourceStore(adapter);
  const runStore = new SqliteBuildRunStore(adapter);
  const worldStore = new SqliteWorldStore(adapter);

  // 1) Streaming import.
  const bytes = fs.readFileSync(novelFile);
  const source = new NodeTextSource(bytes);
  const sourceId = 'src-full';
  const t0 = Date.now();
  const now0 = new Date().toISOString();
  await sourceStore.beginStaging({
    sourceId, rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
    codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
    chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
    splitStrategy: 'standard', fileName: path.basename(novelFile), title: null,
    status: 'staging', createdAt: now0, updatedAt: now0,
  });
  const parsed = await importTxtSourceStreaming(source, sourceStore, sourceId, {
    sha256Hex: sha.sha256Hex,
    sha256BytesHex: sha.sha256BytesHex,
  });
  await sourceStore.activateSource({
    manifest: {
      sourceId, rawSha256Hex: parsed.rawSha256Hex, normalizedTreeHash: parsed.normalizedTreeHash,
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: parsed.byteLength,
      codePointCount: parsed.codePointCount, encoding: parsed.encoding,
      normalizeVersion: parsed.normalizeVersion, chapterSplitVersion: parsed.chapterSplitVersion,
      normalizeShardScheme: parsed.normalizeShardScheme, splitStrategy: parsed.splitStrategy,
      fileName: path.basename(novelFile), title: path.basename(novelFile).replace(/\.txt$/i, ''),
      status: 'active', createdAt: now0, updatedAt: now0,
    },
    chapters: parsed.chapters,
    chunks: parsed.chunks,
  });
  log({
    msg: 'import done', ms: Date.now() - t0, bytes: parsed.byteLength,
    cp: parsed.codePointCount, chapters: parsed.chapters.length,
    chunks: parsed.chunks.length, shards: parsed.shardCount,
  });

  // 2) Run + group plan.
  const runId = 'run-full';
  const worldId = 'world-full';
  const groupExtractor = new LlmGroupExtractor(request => provider.complete(request));
  const chunkExtractor = new LlmChunkExtractor(request => provider.complete(request));
  const run = await createExtractionRun(
    { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
    {
      runId, worldId, sourceId,
      modelFingerprint: cfg.endpoint + '#' + cfg.model,
      title: path.basename(novelFile).replace(/\.txt$/i, ''),
      extractorVersion: chunkExtractor.version,
      mode: 'group',
      budget: {
        contextWindowTokens: budget.contextWindowTokens,
        maxOutputTokens: 8_000,
        reserveTokens: 2_000,
      },
    },
  );
  log({ msg: 'run created', units: run.unitsTotal });

  // 3) Execute with the real model.
  const result = await executeRun(
    {
      sourceStore, runStore, worldStore,
      extractor: chunkExtractor,
      groupExtractor,
      sha256Hex: sha.sha256Hex,
      owner: 'full-build',
      leaseTtlMs: 30 * 60_000,
      onUnitDone: info => log({ msg: 'unit', done: info.unitsDone, total: info.unitsTotal }),
    },
    runId,
  );
  log({
    msg: 'extraction finished', completed: result.completed,
    done: result.unitsDone, total: result.unitsTotal, failed: result.unitsFailed,
  });

  const [entities, facts, events] = await Promise.all([
    worldStore.listEntities(worldId),
    worldStore.listFacts(worldId),
    worldStore.listEvents(worldId),
  ]);
  log({ msg: 'extraction totals', entities: entities.length, facts: facts.length, events: events.length });

  // 4) Mapping + package build.
  const world = await worldStore.getWorld(worldId);
  const pkg = await buildPackageFromCanon({
    worldStore,
    provider: {
      complete: async request => provider.complete({ ...request, role: 'WorldMapper', maxOutputTokens: request.maxOutputTokens ?? 6000 }),
    },
    sha256Hex: sha.sha256Hex,
    worldId,
    sourceSha256: world?.sourceSha256 ?? parsed.rawSha256Hex,
    mappingVersion: 'mapper-closeout-1#' + cfg.model,
    createdAt: new Date().toISOString(),
    onProgress: info => log({ msg: 'mapping', detail: info.message ?? '' }),
  });
  log({
    msg: 'package built', revision: pkg.manifest.revision, entries: pkg.entries.length,
    sections: pkg.sections.length, reviewIssues: pkg.reviewIssues, usage: pkg.mappingUsage,
  });

  // 5) Explicit-fact evidence audit against the persisted source.
  let verified = 0;
  let mismatches = 0;
  const explicit = facts.filter(fact => fact.status === 'explicit');
  for (const fact of explicit) {
    const span = fact.sources[0];
    if (!span) { mismatches += 1; continue; }
    const text = await sourceStore.readRange(sourceId, span.startOffset, span.endOffset);
    if (text === span.quote) verified += 1; else mismatches += 1;
  }
  log({ msg: 'evidence audit', explicitFacts: explicit.length, verifiedSpans: verified, mismatches });

  fs.writeFileSync(path.join(workdir, 'summary.json'), JSON.stringify({
    model: cfg.model,
    contextWindowTokens: budget.contextWindowTokens,
    bytes: parsed.byteLength,
    codePoints: parsed.codePointCount,
    chapters: parsed.chapters.length,
    chunks: parsed.chunks.length,
    groups: run.unitsTotal,
    extraction: result,
    entities: entities.length,
    facts: facts.length,
    events: events.length,
    packageRevision: pkg.manifest.revision,
    entries: pkg.entries.length,
    reviewIssues: pkg.reviewIssues,
    evidenceAudit: { explicitFacts: explicit.length, verifiedSpans: verified, mismatches },
  }, null, 2));
  db.close();
  log('ALL DONE');
}

main().catch(error => {
  console.error('BUILD FAILED:', error.message);
  process.exit(1);
});
