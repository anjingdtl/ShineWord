'use strict';
/**
 * Real-LLM minimal smoke for the planner-v2 extraction chain (task §38).
 *
 * Chain under test: TXT subset -> streaming source -> planner-v2 batches ->
 * REAL provider extraction -> evidence commit -> playability gate -> (when
 * the gate passes) Opening Package mapping+publish.
 *
 * Safety rails:
 *   - the smoke novel is a SMALL chapter subset of the reference book;
 *   - a hard request cap (default 6) stops the run before it overspends;
 *   - the API key is read from the local key file into memory ONLY: never
 *     printed, never written to any output artifact;
 *   - outputs are sanitized counters (no prose, no secrets).
 *
 * Usage: node scripts/llm-smoke.cjs --provider glm|deepseek --key-file <path>
 *            --novel <path> [--encoding utf-8|gb18030] [--chapters 12]
 *            [--max-input-bytes 262144] [--cap 6] [--json out.json]
 * Offline import only: add --dry-extract and omit --key-file. This path never
 * contacts a provider and logs only chapter/segment counts and lengths.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const { importTxtSourceStreaming } = require(path.join(root, 'dist/application/import/streamingTxtImport'));
const { SqliteSourceStore } = require(path.join(root, 'dist/infra/sqlite/sqliteSourceStore'));
const { SqliteBuildRunStore } = require(path.join(root, 'dist/infra/sqlite/sqliteBuildRunStore'));
const { SqliteWorldStore } = require(path.join(root, 'dist/infra/sqlite/sqliteWorldStore'));
const { BUILTIN_MIGRATIONS } = require(path.join(root, 'dist/infra/sqlite/builtinMigrations'));
const { createExtractionRun, executeRun } = require(path.join(root, 'dist/application/worldBuild/coordinator'));
const { LlmGroupExtractor } = require(path.join(root, 'dist/application/world/llmGroupExtractor'));
const { OpenAICompatibleProvider } = require(path.join(root, 'dist/application/llm/openAICompatible'));
const { evaluatePlayabilityGate } = require(path.join(root, 'dist/application/worldPackage/playabilityGate'));
const { buildPackageFromCanon } = require(path.join(root, 'dist/application/worldPackage/buildPackageFromCanon'));
const { modelBudgetFromProfile } = require(path.join(root, 'dist/application/worldBuild/profileModelBudget'));
const { sliceNovelBytes } = require(path.join(__dirname, 'lib/smokeNovel.cjs'));

const argv = process.argv.slice(2);
const providerIdx = argv.indexOf('--provider');
const chaptersIdx = argv.indexOf('--chapters');
const capIdx = argv.indexOf('--cap');
const jsonIdx = argv.indexOf('--json');
const encodingIdx = argv.indexOf('--encoding');
const maxBytesIdx = argv.indexOf('--max-input-bytes');
const providerName = providerIdx >= 0 ? argv[providerIdx + 1] : 'glm';
const chapterTarget = chaptersIdx >= 0 ? Number(argv[chaptersIdx + 1]) : 12;
const requestCap = capIdx >= 0 ? Number(argv[capIdx + 1]) : 6;
const sourceEncoding = encodingIdx >= 0 ? argv[encodingIdx + 1] : 'utf-8';
const maxInputBytes = maxBytesIdx >= 0 ? Number(argv[maxBytesIdx + 1]) : 256 * 1024;
const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : null;
const dryExtract = argv.includes('--dry-extract');

// Local key/novel paths are NEVER baked into the script: pass them in.
//   node scripts/llm-smoke.cjs --provider glm --key-file <glm-key.txt> \
//     --novel <path-to-txt> [--encoding gb18030] [--chapters 12] [--cap 6]
const keyFileIdx = argv.indexOf('--key-file');
const novelIdx = argv.indexOf('--novel');
const KEY_FILE = keyFileIdx >= 0 ? argv[keyFileIdx + 1] : null;
const NOVEL = novelIdx >= 0 ? argv[novelIdx + 1] : null;

function readKeyConfig(file) {
  const text = fs.readFileSync(file, 'utf8');
  const endpoint = text.match(/https?:\/\/[^\s]+/)?.[0];
  const key = text.match(/key[：:]\s*([A-Za-z0-9._-]+)/i)?.[1]
    ?? text.match(/^sk-[A-Za-z0-9._-]+$/m)?.[0];
  // Model: a labelled "model：" line, else the one bare identifier line that
  // is NOT the key and contains a dash (deepseek-v4-flash, GLM-5.3-Flash...).
  let model = text.match(/model[：:]\s*([A-Za-z0-9._-]+)/i)?.[1];
  if (!model) {
    for (const line of text.split(String.fromCharCode(10))) {
      const candidate = line.trim();
      if (!candidate || candidate === key || candidate.startsWith('http') || candidate.startsWith('sk-')) continue;
      if (/^[A-Za-z][A-Za-z0-9._-]*$/.test(candidate) && candidate.includes('-')) {
        model = candidate;
        break;
      }
    }
  }
  if (!endpoint || !key || !model) throw new Error(`Key file ${file} is missing endpoint/key/model fields.`);
  return { endpoint, key, model };
}

class Adapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
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

const DEBUG_RESPONSE = argv.includes('--debug-response');
class NodeFetchTransport {
  async post(request) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: 'POST', headers: request.headers, body: request.body, signal: controller.signal,
      });
      const body = await response.text();
      if (DEBUG_RESPONSE) {
        const debugPath = path.join(os.tmpdir(), `shineword-smoke-debug-${Date.now()}.json`);
        fs.writeFileSync(debugPath, JSON.stringify({
          url: request.url,
          requestLength: request.body ? request.body.length : 0,
          requestHead: request.body ? request.body.slice(0, 600) : '',
          status: response.status,
          bodyHead: body.slice(0, 1200),
        }, null, 2), 'utf8');
        console.error('debug response written:', debugPath);
      }
      return {
        status: response.status,
        headers: {},
        body,
        timings: { completeResponseMs: Date.now() - startedAt },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

const sha = {
  sha256Hex: async input => crypto.createHash('sha256').update(input).digest('hex'),
  sha256BytesHex: bytes => crypto.createHash('sha256').update(bytes).digest('hex'),
};

async function main() {
  if (!NOVEL) throw new Error('Missing --novel <path> (never hardcoded).');
  if (!dryExtract && !KEY_FILE) throw new Error('Missing --key-file <path> (never hardcoded).');
  if (!Number.isSafeInteger(chapterTarget) || chapterTarget < 1) throw new Error('--chapters must be a positive integer.');
  if (!Number.isSafeInteger(requestCap) || requestCap < 1) throw new Error('--cap must be a positive integer.');
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) throw new Error('--max-input-bytes must be a positive integer.');
  if (!fs.existsSync(NOVEL)) throw new Error(`Reference novel not found: ${NOVEL}`);
  const sample = sliceNovelBytes(fs.readFileSync(NOVEL), chapterTarget, sourceEncoding, maxInputBytes);
  const smokeBytes = sample.bytes;
  const keyConfig = dryExtract
    ? { endpoint: 'http://127.0.0.1/mock', key: 'dry-extract-only', model: 'dry-extract-only' }
    : readKeyConfig(KEY_FILE);

  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  const adapter = new Adapter(db);
  const sourceStore = new SqliteSourceStore(adapter);
  const runStore = new SqliteBuildRunStore(adapter);
  const worldStore = new SqliteWorldStore(adapter);
  const now = '2026-10-01T00:00:00.000Z';
  const sourceId = `src-smoke-${providerName}`;

  // Streaming import (the same path the app uses): shards are persisted to
  // SQLite, so the coordinator's readRange returns real text.
  const textSource = {
    buffer: smokeBytes, encoding: 'utf-8', byteLength: smokeBytes.length,
    rawSha256Hex: sha.sha256BytesHex(smokeBytes),
    decoder: new TextDecoder('utf-8'),
    async readText(offset, maxBytes) {
      const end = Math.min(offset + maxBytes, smokeBytes.length);
      const text = this.decoder.decode(smokeBytes.subarray(offset, end), { stream: end < smokeBytes.length });
      return { text, nextByteOffset: end, atEof: end >= smokeBytes.length };
    },
  };
  await sourceStore.beginStaging({
    sourceId, rawSha256Hex: textSource.rawSha256Hex, normalizedTreeHash: '',
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: smokeBytes.length,
    codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
    chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
    splitStrategy: 'standard', fileName: 'smoke.txt', title: null,
    status: 'staging', createdAt: now, updatedAt: now,
  });
  const parsed = await importTxtSourceStreaming(textSource, sourceStore, sourceId, {
    sha256Hex: sha.sha256Hex, sha256BytesHex: sha.sha256BytesHex,
  });
  await sourceStore.activateSource({
    manifest: {
      sourceId, rawSha256Hex: parsed.rawSha256Hex, normalizedTreeHash: parsed.normalizedTreeHash,
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: parsed.byteLength,
      codePointCount: parsed.codePointCount, encoding: parsed.encoding,
      normalizeVersion: parsed.normalizeVersion, chapterSplitVersion: parsed.chapterSplitVersion,
      normalizeShardScheme: parsed.normalizeShardScheme, splitStrategy: parsed.splitStrategy,
      fileName: 'smoke.txt', title: 'smoke', status: 'active', createdAt: now, updatedAt: now,
    },
    chapters: parsed.chapters, chunks: parsed.chunks,
  });

  // Provider capabilities declared conservatively per provider family.
  const caps = providerName === 'glm'
    ? { contextWindow: 200_000, maxOutputTokens: 32_768, contentOutputTokens: 12_000, tier: 'low' }
    : { contextWindow: 128_000, maxOutputTokens: 16_384, contentOutputTokens: 10_000, tier: 'low' };
  const profile = {
    id: `smoke-${providerName}`, name: `smoke-${providerName}`,
    endpoint: keyConfig.endpoint, model: keyConfig.model, keyRef: 'smoke',
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: caps.contextWindow, maxOutputTokens: caps.maxOutputTokens,
      supportsPromptCache: providerName === 'glm',
    },
    reasoningTier: caps.tier,
    contentOutputTokens: caps.contentOutputTokens,
    concurrency: 1,
  };
  const secretStore = { get: async ref => (ref === 'smoke' ? keyConfig.key : null) };
  const requestLog = [];
  let providerRequests = 0;
  const capSignal = { aborted: false, stopRequested: true };
  const baseProvider = new OpenAICompatibleProvider(profile, secretStore, new NodeFetchTransport(), 240_000);
  const countingComplete = async request => {
    providerRequests += 1;
    if (providerRequests > requestCap) {
      capSignal.aborted = true;
      throw new Error('Smoke request cap exceeded - aborting before more spend.');
    }
    const startedAt = Date.now();
    const response = await baseProvider.complete(request);
    const metric = (response.requestMetrics ?? []).slice(-1)[0];
    requestLog.push({
      n: providerRequests,
      outcome: metric?.outcome ?? 'unknown',
      httpStatus: metric?.httpStatus ?? null,
      durationMs: metric?.durationMs ?? Date.now() - startedAt,
      inputTokens: metric?.usage?.inputTokens ?? null,
      outputTokens: metric?.usage?.outputTokens ?? null,
      reasoningTokens: metric?.usage?.reasoningTokens ?? null,
      cachedInputTokens: metric?.usage?.cachedInputTokens ?? null,
    });
    return response;
  };

  // Production budget resolution: the per-dialect reasoning policy decides
  // the reserve (e.g. DeepSeek thinking models get a large reserve), exactly
  // like the app does. Never hand-roll this in business code.
  const budget = modelBudgetFromProfile(profile);
  const extractor = {
    version: 'smoke-single-1',
    extract: async () => { throw new Error('single-chunk path not expected in smoke'); },
  };
  const groupExtractor = new LlmGroupExtractor(countingComplete, budget.maxContentOutputTokens, caps.tier);

  const worldId = `w-smoke-${providerName}`;
  const runId = `run-smoke-${providerName}`;
  const run = await createExtractionRun(
    { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
    {
      runId, worldId, sourceId, modelFingerprint: `${keyConfig.endpoint}#${keyConfig.model}`,
      title: 'smoke', extractorVersion: extractor.version, mode: 'group', budget,
    },
  );
  if (dryExtract) {
    const probeGroupExtractor = {
      version: 'probe-1',
      async extract(input) {
        console.error('DRY EXTRACT PREFLIGHT:', JSON.stringify({
          encoding: sample.sourceEncoding,
          sourceBytes: sample.sourceBytes,
          sampleBytes: smokeBytes.length,
          chapters: sample.chapterCount,
          parsedChapters: parsed.chapters.length,
          segments: input.segments.length,
          segmentChars: input.segments.map(seg => seg.text.length),
        }));
        return { entities: [], facts: [], events: [], ruleMappings: [], rejectedQuotes: 0 };
      },
    };
    await executeRun({
      sourceStore, runStore, worldStore, extractor, groupExtractor: probeGroupExtractor,
      sha256Hex: sha.sha256Hex, owner: 'probe', concurrency: 1, budget,
    }, runId);
    console.log('probe done');
    db.close();
    return;
  }

  const extractStarted = Date.now();
  const extractResult = await executeRun(
    {
      sourceStore, runStore, worldStore, extractor, groupExtractor,
      sha256Hex: sha.sha256Hex, owner: 'smoke', concurrency: 1, budget,
      signal: capSignal,
    },
    runId,
  );
  const extractMs = Date.now() - extractStarted;

  // Gate + committed canon.
  const [entities, facts, events, proposals] = await Promise.all([
    worldStore.listEntities(worldId),
    worldStore.listFacts(worldId),
    worldStore.listEvents(worldId),
    worldStore.listEventProposals(worldId),
  ]);
  const gate = evaluatePlayabilityGate({
    entities, facts,
    eventCount: events.filter(e => e.status === 'canon').length + proposals.length,
    openBlockingReviewIssues: 0,
  });

  let packageRevision = null;
  let mappingRequests = 0;
  if (gate.playable && providerRequests < requestCap) {
    try {
      const pkg = await buildPackageFromCanon({
        requirePlayableOpening: true,
        worldStore,
        provider: {
          complete: async request => {
            mappingRequests += 1;
            return countingComplete({
              role: 'WorldMapper', system: request.system, user: request.user,
              maxOutputTokens: request.maxOutputTokens ?? 6_000, jsonMode: true,
            });
          },
        },
        sha256Hex: sha.sha256Hex,
        worldId, runId,
        sourceSha256: parsed.rawSha256Hex,
        mappingVersion: `smoke-mapper-1#${keyConfig.model}`,
        createdAt: new Date().toISOString(),
      });
      packageRevision = pkg.manifest.revision;
    } catch (error) {
      packageRevision = `failed: ${String(error.message).slice(0, 120)}`;
    }
  }

  const report = {
    provider: providerName,
    model: keyConfig.model,
    inputEncoding: sample.sourceEncoding,
    smokeInputBytes: smokeBytes.length,
    smokeChapters: parsed.chapters.length,
    smokeCodePoints: parsed.codePointCount,
    storageChunks: parsed.chunks.length,
    batchesPlanned: run.unitsTotal,
    planVersion: run.planVersion,
    extractCompleted: extractResult.completed,
    unitsDone: extractResult.unitsDone,
    unitsFailed: extractResult.unitsFailed,
    extractDurationMs: extractMs,
    providerRequests: providerRequests,
    requests: requestLog,
    entities: entities.length,
    facts: facts.length,
    events: events.length + proposals.length,
    gatePlayable: gate.playable,
    gateReasons: gate.reasons,
    packageRevision,
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, text, 'utf8');
  }
  db.close();
}

main().catch(error => {
  console.error('SMOKE FAILED:', error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) {
    console.error(error.stack.split(String.fromCharCode(10)).slice(0, 8).join(String.fromCharCode(10)));
  }
  process.exit(1);
});
