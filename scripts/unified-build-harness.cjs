// Unified world build P5 harness: real-model smoke, calibration and the four
// main tests (DS-FULL / DS-PROG / GLM-FULL / GLM-PROG) against PRODUCTION
// core paths - streaming import, chapter batch planning, coordinator lease/
// fencing, group extraction, registry/timeline passes, staged packages and
// the campaign opening. Credentials are parsed in-process and NEVER printed,
// logged, or persisted; metrics carry statuses, timings, token counts and
// sanitized identifiers only.
//
// Usage:
//   node scripts/unified-build-harness.cjs smoke       <config> <workdir>
//   node scripts/unified-build-harness.cjs calibrate   <config> <workdir> <novel>
//   node scripts/unified-build-harness.cjs full        <config> <workdir> <novel> [label]
//   node scripts/unified-build-harness.cjs progressive <config> <workdir> <novel> [label]
//
// Budget caps (env): UNIFIED_MAX_REQUESTS (default 600), UNIFIED_MAX_INPUT_TOKENS
// (default 80_000_000), UNIFIED_MAX_OUTPUT_TOKENS (default 6_000_000),
// UNIFIED_TURNS (progressive opening turns, default 5).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteSourceStore } = require('../dist/infra/sqlite/sqliteSourceStore');
const { SqliteBuildRunStore } = require('../dist/infra/sqlite/sqliteBuildRunStore');
const { SqliteWorldStore } = require('../dist/infra/sqlite/sqliteWorldStore');
const { SqliteStagePlanStore } = require('../dist/infra/sqlite/sqliteStagePlanStore');
const { SqliteTurnStore } = require('../dist/infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { SqliteNarrativeStore } = require('../dist/infra/sqlite/sqliteNarrativeStore');
const { importTxtSourceStreaming } = require('../dist/application/import/streamingTxtImport');
const {
  createExtractionRun,
  executeRun,
  parseUnitRanges,
} = require('../dist/application/worldBuild/coordinator');
const {
  ensureStagePlan,
  queueInitialStages,
  evaluateAndClaimTriggers,
  markStageRunStatus,
  builtStageRanges,
} = require('../dist/application/worldBuild/stageOrchestrator');
const { LlmChunkExtractor } = require('../dist/application/world/llmExtractor');
const { LlmGroupExtractor } = require('../dist/application/world/llmGroupExtractor');
const { buildBookRegistry, registrySummaryFor } = require('../dist/application/world/bookRegistry');
const { runTimelinePass } = require('../dist/application/world/timelinePass');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
const { probeCapabilities } = require('../dist/application/llm/capabilities');
const { modelBudgetFromProfile } = require('../dist/application/worldBuild/profileModelBudget');
const { freezeRunConfig, providerProfileFromFrozen } = require('../dist/application/worldBuild/runConfig');
const { GlobalRateScheduler } = require('../dist/application/worldBuild/rateScheduler');
const { RateScheduledProvider } = require('../dist/application/llm/scheduledProvider');
const { buildPackageFromCanon } = require('../dist/application/worldPackage/buildPackageFromCanon');
const { activatePendingStages } = require('../dist/application/worldPackage/stageActivation');
const { createCampaign } = require('../dist/application/campaign/createCampaign');
const { CampaignSession } = require('../dist/application/campaign/session');

const BUDGET = {
  maxRequests: Number(process.env.UNIFIED_MAX_REQUESTS ?? 600),
  maxInputTokens: Number(process.env.UNIFIED_MAX_INPUT_TOKENS ?? 80_000_000),
  maxOutputTokens: Number(process.env.UNIFIED_MAX_OUTPUT_TOKENS ?? 6_000_000),
  turns: Number(process.env.UNIFIED_TURNS ?? 5),
};

// ---------------------------------------------------------------------------
// Config / secrets
// ---------------------------------------------------------------------------

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
  if (!endpoint || !key) throw new Error('config parse failed (need endpoint + key)');
  return { endpoint, key, model: model ?? null };
}

/** Model discovery when the config omits it - verified against the gateway,
 *  never guessed from the file name (plan §P5 config rules). */
async function resolveModel(cfg, log) {
  if (cfg.model) return cfg.model;
  const base = cfg.endpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
  const res = await fetch(base + '/models', {
    headers: { Authorization: 'Bearer ' + cfg.key },
  });
  if (!res.ok) throw new Error(`gateway /models returned ${res.status}; model not in config`);
  const body = await res.json();
  const ids = (body.data ?? []).map(entry => entry.id).filter(Boolean);
  if (ids.length === 0) throw new Error('gateway /models returned no ids');
  log({ msg: 'model-resolved-from-gateway', count: ids.length });
  return ids[0];
}

// ---------------------------------------------------------------------------
// Infra helpers (same shape as the resident/full-novel harnesses)
// ---------------------------------------------------------------------------

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

class FetchTransport {
  async post(request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: 'POST', headers: request.headers, body: request.body, signal: controller.signal,
      });
      const body = await response.text();
      return { status: response.status, body, headers: {} };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('LLM request timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Metered provider stack: physical-request counter + token ledger + hard caps
// ---------------------------------------------------------------------------

function makeMeteredStack(cfg, model, meter, log) {
  const secrets = { store: { 'unified-key': cfg.key }, async set(ref, s) { this.store[ref] = s; }, async get(ref) { return this.store[ref] ?? null; }, async delete(ref) { delete this.store[ref]; } };
  const profile = {
    id: 'unified-harness', name: 'unified-harness',
    endpoint: cfg.endpoint, model, keyRef: 'unified-key',
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: Number(process.env.UNIFIED_CONTEXT_WINDOW ?? 1_048_576),
      maxOutputTokens: Number(process.env.UNIFIED_MAX_OUTPUT ?? 131_072),
      supportsPromptCache: process.env.UNIFIED_NO_CACHE !== '1',
    },
    contentOutputTokens: Number(process.env.UNIFIED_CONTENT_OUTPUT ?? 16_384),
    reasoningReserveTokens: Number(process.env.UNIFIED_REASONING_RESERVE ?? 2_048),
    reasoningEffort: process.env.UNIFIED_REASONING_EFFORT ?? 'low',
    concurrency: Number(process.env.UNIFIED_CONCURRENCY ?? 3),
    rpm: Number(process.env.UNIFIED_RPM ?? 0) || undefined,
    tpm: Number(process.env.UNIFIED_TPM ?? 0) || undefined,
  };
  const scheduler = new GlobalRateScheduler({
    rpm: profile.rpm, tpm: profile.tpm, maxConcurrent: profile.concurrency ?? 3,
  });
  const inner = new OpenAICompatibleProvider(
    profile, secrets, new FetchTransport(), Number(process.env.UNIFIED_TIMEOUT_MS ?? 300_000),
    {
      onPhysicalRequest: metric => {
        meter.requests += 1;
        if (metric.outcome !== 'completed') meter.retryAttempts += 1;
        if (metric.usage) {
          meter.inputTokens += metric.usage.inputTokens ?? 0;
          meter.outputTokens += metric.usage.outputTokens ?? 0;
          meter.reasoningTokens += metric.usage.reasoningTokens ?? 0;
          meter.cachedInputTokens += metric.usage.cachedInputTokens ?? 0;
        } else {
          meter.unavailableUsage += 1;
        }
        log({
          msg: 'physical-request', n: meter.requests,
          outcome: metric.outcome, http: metric.httpStatus, ms: metric.durationMs,
          in: metric.usage?.inputTokens ?? null, out: metric.usage?.outputTokens ?? null,
          reasoning: metric.usage?.reasoningTokens ?? null, cached: metric.usage?.cachedInputTokens ?? null,
        });
        if (meter.requests > BUDGET.maxRequests
          || meter.inputTokens > BUDGET.maxInputTokens
          || meter.outputTokens > BUDGET.maxOutputTokens) {
          meter.budgetExceeded = true;
        }
      },
    },
  );
  const provider = new RateScheduledProvider(inner, scheduler);
  return { provider, scheduler, profile, secrets };
}

function budgetAbortSignal(meter) {
  return {
    get aborted() { return !!meter.budgetExceeded; },
  };
}

// ---------------------------------------------------------------------------
// Import + world setup
// ---------------------------------------------------------------------------

async function importNovel(adapter, novelPath, sourceId, log) {
  const sourceStore = new SqliteSourceStore(adapter);
  const bytes = fs.readFileSync(novelSafe(novelPath));
  const source = new NodeTextSource(bytes);
  const now = new Date().toISOString();
  await sourceStore.beginStaging({
    sourceId, rawSha256Hex: source.rawSha256Hex, normalizedTreeHash: '',
    normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: bytes.length,
    codePointCount: 0, encoding: 'utf-8', normalizeVersion: 'normalize-1',
    chapterSplitVersion: 'chapter-split-1', normalizeShardScheme: 'normalize-shard-1',
    splitStrategy: 'standard', fileName: path.basename(novelPath), title: null,
    status: 'staging', createdAt: now, updatedAt: now,
  });
  const result = await importTxtSourceStreaming(source, sourceStore, sourceId, {
    sha256Hex: sha.sha256Hex, sha256BytesHex: sha.sha256BytesHex,
  });
  await sourceStore.activateSource({
    manifest: {
      sourceId, rawSha256Hex: result.rawSha256Hex, normalizedTreeHash: result.normalizedTreeHash,
      normalizeTreeHashVersion: 'normalize-hash-shard-tree-1', byteLength: result.byteLength,
      codePointCount: result.codePointCount, encoding: result.encoding,
      normalizeVersion: result.normalizeVersion, chapterSplitVersion: result.chapterSplitVersion,
      normalizeShardScheme: result.normalizeShardScheme, splitStrategy: result.splitStrategy,
      fileName: path.basename(novelPath), title: null, status: 'active', createdAt: now, updatedAt: now,
    },
    chapters: result.chapters, chunks: result.chunks,
  });
  log({
    msg: 'import-done', ms: 0, bytes: result.byteLength, codePoints: result.codePointCount,
    chapters: result.chapters.length, chunks: result.chunks.length, rawSha256: source.rawSha256Hex.toUpperCase(),
  });
  return { sourceStore, result };
}

function novelSafe(novelPath) {
  if (fs.existsSync(novelPath)) return novelPath;
  const desktop = path.join('C:', 'Users', 'Administrator', 'Desktop', 'AIstudio', path.basename(novelPath));
  if (fs.existsSync(desktop)) return desktop;
  throw new Error('novel file not found: ' + novelPath);
}

// ---------------------------------------------------------------------------
// Stage execution (production coordinator + stage finalize)
// ---------------------------------------------------------------------------

async function runStage(deps, input) {
  const { db, cfg, model, meter, log, worldId, stageIndex, strategy } = input;
  const adapter = deps.adapter;
  const stageStore = deps.stageStore;
  const runStore = deps.runStore;
  const sourceStore = deps.sourceStore;
  const worldStore = deps.worldStore;
  const { provider, profile } = makeMeteredStack(cfg, model, meter, log);
  const budget = modelBudgetFromProfile(profile);
  const frozen = freezeRunConfig(profile, budget);
  const signal = budgetAbortSignal(meter);
  const planRow = await stageStore.getStagePlanByWorld(worldId);
  const stage = planRow.stages.find(slice => slice.index === stageIndex);

  const runId = input.existingRunId ?? `run-${worldId}-s${stageIndex + 1}-${Date.now().toString(36)}`;
  if (!input.existingRunId) {
    await createExtractionRun(
      { sourceStore, runStore, worldStore, sha256Hex: sha.sha256Hex },
      {
        runId, worldId, sourceId: planRow.sourceId,
        modelFingerprint: `${frozen.endpoint}#${frozen.model}`,
        title: planRow.worldId, extractorVersion: new LlmChunkExtractor(async () => ({ text: '' })).version,
        mode: 'group', budget, config: frozen,
        scope: { startCp: stage.startCp, endCp: stage.endCp },
      },
    );
  }
  await stageStore.setStageStatus({ planId: planRow.planId, stageIndex, status: 'building', runId, now: new Date().toISOString() });

  const startedAt = Date.now();
  const groupExtractor = new LlmGroupExtractor(
    request => provider.complete(request),
    budget.maxContentOutputTokens + budget.reasoningReserveTokens,
    budget.reasoningEffort,
  );
  const chunkExtractor = new LlmChunkExtractor(request => provider.complete(request), budget.reasoningEffort);
  const makeDeps = () => ({
    sourceStore, runStore, worldStore,
    extractor: chunkExtractor, groupExtractor,
    sha256Hex: sha.sha256Hex,
    owner: `harness-${strategy}`,
    signal,
    concurrency: profile.concurrency ?? 3,
    tpmTokensPerMinute: profile.tpm,
    budget,
    buildRegistry: undefined,
    onTimeline: async ({ worldId: wid, contentHash }) => {
      await runTimelinePass({
        worldStore, complete: request => provider.complete(request),
        worldId: wid, modelFingerprint: `${frozen.endpoint}#${frozen.model}`,
        contentHash, createdAt: new Date().toISOString(),
      });
    },
  });
  // A worker exits when every remaining unit has a FUTURE retry_at; resume
  // the run until it truly settles (bounded, same as a headless re-wake).
  let result = await executeRun(makeDeps(), runId);
  for (let resume = 0; resume < 6 && !result.completed && !result.lostLease; resume += 1) {
    const units = await runStore.listUnits(runId);
    const blocked = units.some(unit => unit.status === 'needs_review' || unit.status === 'failed_terminal');
    if (blocked) break;
    const pending = units.filter(unit => ['queued', 'running', 'failed_retryable', 'waiting_network'].includes(unit.status));
    if (pending.length === 0) break;
    const nextRetry = pending
      .map(unit => unit.retryAt ? Date.parse(unit.retryAt) : Date.now())
      .reduce((min, at) => Math.min(min, at), Number.POSITIVE_INFINITY);
    const waitMs = Math.max(0, nextRetry - Date.now()) + 2_000;
    log({ msg: 'stage-resume-wait', stageIndex, resume, waitMs, pending: pending.length });
    await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 120_000)));
    if (signal.aborted) break;
    result = await executeRun(makeDeps(), runId);
  }
  const extractionMs = Date.now() - startedAt;
  log({
    msg: 'stage-extraction-done', stageIndex, runId, completed: result.completed,
    unitsDone: result.unitsDone, unitsTotal: result.unitsTotal, unitsFailed: result.unitsFailed,
    ms: extractionMs, humanWaitMs: input.humanWaitMs ?? 0,
  });
  if (!result.completed) {
    await stageStore.setStageStatus({ planId: planRow.planId, stageIndex, status: 'failed', now: new Date().toISOString() });
    throw new Error(`stage ${stageIndex} extraction incomplete: ${result.unitsDone}/${result.unitsTotal}`);
  }

  // Stage package finalize (same semantics as the mobile path): cumulative
  // prefix, incremental/partial until the whole text is covered.
  const manifest = await sourceStore.getManifest(planRow.sourceId);
  const depsBuilt = deps;
  const built = await builtStageRanges(depsBuilt, worldId);
  const coveredEnd = Math.max(built?.ranges[0]?.endCp ?? 0, stage.endCp);
  const coveredText = await sourceStore.readRange(planRow.sourceId, 0, coveredEnd);
  const coveredHash = await sha.sha256Hex(coveredText);
  const coversWholeText = coveredEnd >= manifest.codePointCount;
  const world = await worldStore.getWorld(worldId);
  const mappingStarted = Date.now();
  const buildResult = await buildPackageFromCanon({
    worldStore,
    provider: {
      complete: async request => provider.complete({ ...request, role: 'WorldMapper', maxOutputTokens: request.maxOutputTokens ?? 16_384 }),
    },
    sha256Hex: sha.sha256Hex,
    worldId, sourceSha256: world.sourceSha256,
    mappingVersion: `mapper-1#${model}`,
    createdAt: new Date().toISOString(),
    stageScope: {
      ranges: [{ startCodePoint: 0, endCodePoint: coveredEnd, contentSha256: coveredHash }],
      coversWholeText,
    },
    sourceCodePointCount: manifest.codePointCount,
    signal,
  });
  await markStageRunStatus(depsBuilt, {
    worldId, stageIndex, status: 'built', packageRevision: buildResult.manifest.revision,
  });
  await markStageRunStatus(depsBuilt, {
    worldId, stageIndex, status: 'pending_activation', packageRevision: buildResult.manifest.revision,
  });
  log({
    msg: 'stage-package-published', stageIndex, revision: buildResult.manifest.revision,
    scope: buildResult.manifest.buildScope.scope, completeness: buildResult.manifest.buildScope.completeness,
    entries: buildResult.entries.length, reviewIssues: buildResult.reviewIssues,
    coveredEnd, codePointCount: manifest.codePointCount, mappingMs: Date.now() - mappingStarted,
  });
  return { runId, buildResult, coveredEnd, extractionMs };
}

// ---------------------------------------------------------------------------
// Opening + turns (progressive S1 playability proof)
// ---------------------------------------------------------------------------

async function openCampaignAndPlay(deps, input) {
  const { db, adapter, worldId, packageRevision, model, cfg, meter, log } = input;
  const worldStore = new SqliteWorldStore(adapter);
  const campaignId = `camp-${worldId}-${Date.now().toString(36)}`;
  const events = await worldStore.listEvents(worldId);
  const anchorEvent = events.find(event => event.status === 'canon' && event.worldTimeOrder !== null)
    ?? events.find(event => event.worldTimeOrder !== null);
  const entities = await worldStore.listEntities(worldId);
  const location = entities.find(entity => entity.type === 'location');
  const facts = await worldStore.listFacts(worldId);
  const locationFact = facts.find(fact => location && fact.subjectEntityId === location.entityId);
  const anchor = {
    worldTimeOrder: anchorEvent?.worldTimeOrder ?? 1,
    anchorEventId: anchorEvent?.eventId ?? undefined,
    locationId: locationFact ? (location.name ?? location.entityId) : (entities[0]?.name ?? '开篇之地'),
  };
  await createCampaign({
    db: adapter, worldStore, campaignId, title: `统一构建验证 ${model}`,
    worldId, packageRevision, anchor,
    protagonist: {
      actorId: 'actor-hero', kind: 'original', name: '旅人',
      attributes: { physique: 2, agility: 2, insight: 2, knowledge: 1, willpower: 2, social: 1 },
      initialSkills: [],
    },
    companions: [], goal: '在世界中活下去并弄清所处之地', createdAt: new Date().toISOString(),
  });
  log({ msg: 'campaign-created', campaignId, anchor });

  const { provider, profile } = makeMeteredStack(cfg, model, meter, log);
  const session = new CampaignSession({
    db: adapter,
    turns: new SqliteTurnStore(adapter),
    game: new SqliteGameStore(adapter),
    worldStore,
    narratives: new SqliteNarrativeStore(adapter),
    hashProvider: { sha256Hex: sha.sha256Hex },
    random: () => 0.97,
  }, provider, profile);
  const branchId = campaignId + '-main';
  const turnStats = [];
  for (let i = 0; i < BUDGET.turns; i += 1) {
    const turnStarted = Date.now();
    try {
      const result = await session.submitTurn({
        campaignId, branchId, turnId: `t-${i + 1}`,
        intent: ['观察四周，弄清身在何处。', '向最近的人打听此地的来历。', '小心地探索附近。', '寻找可以落脚的地方。', '整理目前掌握的线索。'][i % 5],
      });
      turnStats.push({ turn: i + 1, ok: true, grade: result.grade ?? null, ms: Date.now() - turnStarted });
    } catch (error) {
      turnStats.push({ turn: i + 1, ok: false, error: String(error.message ?? error).slice(0, 120), ms: Date.now() - turnStarted });
    }
    log({ msg: 'turn', ...(turnStats[turnStats.length - 1]) });
  }
  return { campaignId, branchId, turnStats };
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function smokeMode(configFile, workdir) {
  fs.mkdirSync(workdir, { recursive: true });
  const logFile = path.join(workdir, 'smoke-metrics.jsonl');
  const log = value => fs.appendFileSync(logFile, JSON.stringify(value) + '\n');
  const cfg = parseConfig(configFile);
  const model = await resolveModel(cfg, log);
  log({ msg: 'config-parsed', model, endpointHost: new URL(cfg.endpoint).host });

  // Production probe: JSON mode, usage reporting, prefix cache v2, output
  // ceiling acceptance.
  const transport = new FetchTransport();
  const probe = await probeCapabilities({
    transport,
    endpoint: cfg.endpoint,
    model,
    apiKey: cfg.key,
    timeoutMs: 60_000,
    declaredMaxOutputTokens: 16_384,
  });
  const meter = { requests: 0, retryAttempts: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0, unavailableUsage: 0, budgetExceeded: false };
  const { provider, profile } = makeMeteredStack(cfg, model, meter, log);
  const budget = modelBudgetFromProfile(profile);
  // Dialect + budget smoke: one real extraction-shaped JSON request with a
  // tiny inline passage (original synthetic text, NOT the novel).
  const probePassage = '晨光穿过竹林，练习剑法的少年收势而立。他姓沈，家中世代行医，如今在山中随师父读书练武。';
  const extractor = new LlmGroupExtractor(request => provider.complete(request), budget.maxContentOutputTokens, budget.reasoningEffort);
  const extraction = await extractor.extract({
    unitId: 'smoke-1',
    segments: [{ chunkId: 'ch-0001-c001', chapterId: 'ch-0001', chapterTitle: '第一章', startCp: 0, text: probePassage }],
    worldId: 'w-smoke',
  });
  const summary = {
    mode: 'smoke', model, ts: new Date().toISOString(),
    probe: {
      supportsJson: probe.capabilities.supportsJson,
      reportsUsage: probe.capabilities.reportsUsage,
      supportsPromptCache: probe.capabilities.supportsPromptCache ?? null,
      contextWindowReported: probe.capabilities.contextWindow,
      probes: {
        jsonMode: probe.probes.jsonMode, usage: probe.probes.usage,
        promptCache: probe.probes.promptCache,
        outputCeiling: probe.probes.outputCeiling,
      },
    },
    extraction: {
      entities: extraction.entities.length, facts: extraction.facts.length,
      rejectedQuotes: extraction.rejectedQuotes, evidencesVerified: extraction.facts.length,
    },
    meter,
    budget,
  };
  fs.writeFileSync(path.join(workdir, 'smoke-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ok: true, model, meter: { requests: meter.requests }, probe: summary.probe }));
}

async function calibrateMode(configFile, workdir, novelPath) {
  fs.mkdirSync(workdir, { recursive: true });
  const logFile = path.join(workdir, 'calibration-metrics.jsonl');
  const log = value => fs.appendFileSync(logFile, JSON.stringify(value) + '\n');
  const cfg = parseConfig(configFile);
  const model = await resolveModel(cfg, log);
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
  }
  const adapter = new NodeSqliteAdapter(db);
  const { sourceStore, result } = await importNovel(adapter, novelPath, 'src-cal', log);
  // Representative chapters: one early, one middle - measure output density
  // for batch sizing with the real novel's own style.
  const chapters = result.chapters;
  const picks = [chapters[Math.floor(chapters.length * 0.2)], chapters[Math.floor(chapters.length * 0.5)]].filter(Boolean);
  const meter = { requests: 0, retryAttempts: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0, unavailableUsage: 0, budgetExceeded: false };
  const { provider, profile } = makeMeteredStack(cfg, model, meter, log);
  const budget = modelBudgetFromProfile(profile);
  const extractor = new LlmGroupExtractor(request => provider.complete(request), budget.maxContentOutputTokens, budget.reasoningEffort);
  const densities = [];
  for (const chapter of picks) {
    const text = await sourceStore.readRange('src-cal', chapter.startOffset, chapter.endOffset);
    const started = Date.now();
    const extraction = await extractor.extract({
      unitId: `cal-${chapter.chapterId}`,
      segments: [{ chunkId: `${chapter.chapterId}-x`, chapterId: chapter.chapterId, chapterTitle: chapter.title, startCp: chapter.startOffset, text }],
      worldId: 'w-cal',
    });
    const metrics = extraction.requestMetrics ?? [];
    const last = metrics[metrics.length - 1];
    densities.push({
      chapterId: chapter.chapterId, codePoints: chapter.charCount,
      entities: extraction.entities.length, facts: extraction.facts.length,
      outputTokens: last?.usage?.outputTokens ?? null,
      reasoningTokens: last?.usage?.reasoningTokens ?? null,
      ms: Date.now() - started,
    });
    log({ msg: 'calibration-sample', ...densities[densities.length - 1] });
  }
  const summary = { mode: 'calibrate', model, ts: new Date().toISOString(), densities, meter };
  fs.writeFileSync(path.join(workdir, 'calibration-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ok: true, model, densities }));
}

async function buildMode(mode, configFile, workdir, novelPath, label) {
  fs.mkdirSync(workdir, { recursive: true });
  const logFile = path.join(workdir, 'metrics.jsonl');
  const log = value => fs.appendFileSync(logFile, JSON.stringify(value) + '\n');
  const summaryPath = path.join(workdir, 'summary.json');
  const dbFile = path.join(workdir, 'shineword.db');
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + suffix); } catch {} }

  const cfg = parseConfig(configFile);
  const model = await resolveModel(cfg, log);
  const runStarted = Date.now();
  const db = new DatabaseSync(dbFile);
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) db.exec(statement);
  }
  const adapter = new NodeSqliteAdapter(db);
  const meter = { requests: 0, retryAttempts: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0, unavailableUsage: 0, budgetExceeded: false };
  const events = [];
  const record = entry => { events.push(entry); log(entry); };

  const importStarted = Date.now();
  const worldId = `world-unified-${label ?? mode}`;
  const { sourceStore } = await importNovel(adapter, novelPath, `src-${label ?? mode}`, log);
  const importMs = Date.now() - importStarted;
  const sourceManifest = await sourceStore.getManifest(`src-${label ?? mode}`);

  const stageStore = new SqliteStagePlanStore(adapter);
  const worldStore = new SqliteWorldStore(adapter);
  const now = new Date().toISOString();
  await worldStore.createWorld({
    worldId, title: path.basename(novelPath).replace(/\.txt$/i, ''),
    sourceSha256: sourceManifest.rawSha256Hex, sourceBytes: sourceManifest.byteLength,
    normalizeVersion: sourceManifest.normalizeVersion, chapterSplitVersion: sourceManifest.chapterSplitVersion,
    buildStatus: 'extracting', createdAt: now, updatedAt: now,
  });
  // The world-side chapter/chunk mirror is authoritative for fact evidence
  // FKs; createExtractionRun only mirrors when the world is NEW, so mirror
  // explicitly here (re-imports with an existing world skip it otherwise).
  const chaptersForMirror = await sourceStore.getChapters(`src-${label ?? mode}`);
  const chunksForMirror = await sourceStore.getChunks(`src-${label ?? mode}`);
  await worldStore.saveImportedSource(worldId, {
    encoding: sourceManifest.encoding,
    sourceSha256Hex: sourceManifest.rawSha256Hex,
    sourceByteLength: sourceManifest.byteLength,
    normalizeVersion: sourceManifest.normalizeVersion,
    chapterSplitVersion: sourceManifest.chapterSplitVersion,
    splitStrategy: sourceManifest.splitStrategy,
    text: '',
    codePointCount: sourceManifest.codePointCount,
    chapters: chaptersForMirror,
    chunks: chunksForMirror,
  }, new Date().toISOString());
  const deps = { db, adapter, stageStore, runStore: new SqliteBuildRunStore(adapter), sourceStore, worldStore, sha256Hex: sha.sha256Hex };
  const { plan } = await ensureStagePlan(deps, {
    worldId, sourceId: `src-${label ?? mode}`, strategy: mode === 'full' ? 'full' : 'progressive',
    configFingerprint: `harness#${model}`,
  });
  record({
    msg: 'stage-plan', strategy: plan.strategy, stages: plan.stages.map(stage => ({
      index: stage.index, startCp: stage.startCp, endCp: stage.endCp, ratio: stage.ratio,
    })),
  });

  const stageTimings = [];
  let campaign = null;
  let triggerLog = [];
  let activationLog = [];
  const stagesToBuildNow = mode === 'full' ? plan.stages.map(stage => stage.index) : [plan.stages[0].index];

  for (const stageIndex of stagesToBuildNow) {
    if (meter.budgetExceeded) { record({ msg: 'budget-exceeded', beforeStage: stageIndex }); break; }
    const stageRes = await runStage(deps, { db, cfg, model, meter, log, worldId, stageIndex, strategy: mode });
    stageTimings.push({ stageIndex, extractionMs: stageRes.extractionMs, revision: stageRes.buildResult.manifest.revision });
    if (mode === 'progressive' && stageIndex === 0 && !meter.budgetExceeded) {
      // S1 opening: create the campaign and play a few REAL turns on the S1
      // package (TTFP measured from run start to first committed turn).
      const ttfpStarted = Date.now();
      try {
        campaign = await openCampaignAndPlay({
          db, adapter, worldId, packageRevision: stageRes.buildResult.manifest.revision,
          model, cfg, meter, log,
        }, deps);
        record({
          msg: 's1-opening', campaignId: campaign.campaignId,
          ttfpMs: Date.now() - ttfpStarted + importMs,
          turns: campaign.turnStats,
        });
      } catch (error) {
        record({ msg: 's1-opening-failed', error: String(error.message ?? error).slice(0, 200) });
      }
    }
  }

  if (mode === 'progressive' && !meter.budgetExceeded) {
    // Tracked test-injected triggers (labeled): proximity anchor at the S1
    // boundary releases S2; a dependency span at the S2 boundary releases S3.
    for (const nextStage of plan.stages.filter(stage => stage.index > 0)) {
      if (meter.budgetExceeded) break;
      const outcomes = await evaluateAndClaimTriggers(deps, {
        worldId, title: worldId,
        anchorCp: nextStage.startCp - 1,
        neededRanges: [{ startCp: nextStage.startCp + 1, endCp: nextStage.startCp + 2 }],
        template: {
          extractorVersion: new LlmChunkExtractor(async () => ({ text: '' })).version,
          modelFingerprint: `${cfg.endpoint}#${model}`,
          mode: 'group',
          budget: modelBudgetFromProfile({
            ...providerProfileStub(cfg, model),
          }),
        },
      });
      triggerLog.push({ stageIndex: nextStage.index, outcomes, injected: 'test-action:boundary+dependency' });
      record({ msg: 'stage-trigger', stageIndex: nextStage.index, outcomes });
      const claimed = outcomes.find(outcome => outcome.runId);
      if (claimed?.runId) {
        // Execute the run the orchestrator ALREADY created for this trigger -
        // never a duplicate second run for the same stage.
        const stageRes = await runStage(deps, { db, cfg, model, meter, log, worldId, stageIndex: nextStage.index, strategy: mode, existingRunId: claimed.runId });
        stageTimings.push({ stageIndex: nextStage.index, extractionMs: stageRes.extractionMs, revision: stageRes.buildResult.manifest.revision });
      }
      // Safe-boundary activation after each new stage package.
      if (campaign) {
        const activation = await activatePendingStages(
          { db: adapter, stageStore },
          {
            campaignId: campaign.campaignId, branchId: campaign.branchId,
            stateVersion: 0 + campaign.turnStats.filter(turn => turn.ok).length,
            worldId, now: new Date().toISOString(),
          },
        );
        activationLog.push({ stageIndex: nextStage.index, activation });
        record({ msg: 'stage-activation', stageIndex: nextStage.index, activation });
      }
    }
  }

  // Final verification: whole-source package exists and coverage is complete.
  const packageList = await worldStore.listWorldPackages(worldId);
  const packages = [];
  for (const row of packageList) {
    const pkg = await worldStore.getWorldPackage(worldId, row.revision);
    if (pkg) packages.push(pkg);
  }
  const stageStates = await stageStore.listStageStates((await stageStore.getStagePlanByWorld(worldId)).planId);
  const facts = await worldStore.listFacts(worldId);
  const entities = await worldStore.listEntities(worldId);
  const evidenceAudit = { verified: 0, mismatched: 0 };
  for (const fact of facts) {
    for (const span of fact.sources ?? []) {
      const text = await sourceStore.readRange(`src-${label ?? mode}`, span.startOffset, span.endOffset);
      if (text === span.quote) evidenceAudit.verified += 1; else evidenceAudit.mismatched += 1;
    }
  }
  const summary = {
    mode, model, label: label ?? mode, ts: new Date().toISOString(),
    source: {
      rawSha256: sourceManifest.rawSha256Hex.toUpperCase(),
      bytes: sourceManifest.byteLength, codePoints: sourceManifest.codePointCount,
    },
    stages: plan.stages.map(stage => ({
      ...stage,
      status: stageStates.find(state => state.stageIndex === stage.index)?.status ?? 'untriggered',
    })),
    stageTimings,
    importMs,
    totalActiveMs: Date.now() - runStarted,
    meter,
    budgetCaps: BUDGET,
    campaign: campaign ? { campaignId: campaign.campaignId, turns: campaign.turnStats } : null,
    triggerLog,
    activationLog,
    packages: packages.map(pkg => ({
      revision: pkg.manifest.revision, scope: pkg.manifest.buildScope?.scope ?? null,
      completeness: pkg.manifest.buildScope?.completeness ?? null, entries: pkg.entries.length,
    })),
    content: { facts: facts.length, entities: entities.length, evidenceAudit },
    budgetExceeded: meter.budgetExceeded,
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({
    ok: !meter.budgetExceeded, mode, model, requests: meter.requests,
    stages: summary.stages.map(stage => stage.status), evidenceAudit,
  }));
}

function providerProfileStub(cfg, model) {
  return {
    id: 'stub', name: 'stub', endpoint: cfg.endpoint, model, keyRef: 'unified-key',
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: Number(process.env.UNIFIED_CONTEXT_WINDOW ?? 1_048_576),
      maxOutputTokens: Number(process.env.UNIFIED_MAX_OUTPUT ?? 131_072),
      supportsPromptCache: process.env.UNIFIED_NO_CACHE !== '1',
    },
    contentOutputTokens: Number(process.env.UNIFIED_CONTENT_OUTPUT ?? 16_384),
    reasoningReserveTokens: Number(process.env.UNIFIED_REASONING_RESERVE ?? 2_048),
    reasoningEffort: process.env.UNIFIED_REASONING_EFFORT ?? 'low',
  };
}

async function main() {
  const [mode, configFile, workdir, novelPath, label] = process.argv.slice(2);
  if (mode === 'smoke' && configFile && workdir) return await smokeMode(configFile, workdir);
  if (mode === 'calibrate' && configFile && workdir && novelPath) return await calibrateMode(configFile, workdir, novelPath);
  if ((mode === 'full' || mode === 'progressive') && configFile && workdir && novelPath) {
    return await buildMode(mode, configFile, workdir, novelPath, label);
  }
  throw new Error('usage: unified-build-harness.cjs <smoke|calibrate|full|progressive> <config> <workdir> [novel] [label]');
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: String(error.message ?? error).slice(0, 300) }));
  console.error(error.stack);
  process.exitCode = 1;
});
