/**
 * Bounded R6 live verification for the user's local GLM test profile.
 * Credentials and novel text are process-only. The output contains source
 * fingerprints, counts, budgets and redacted usage only.
 *
 * Usage: npm run build:core && node tools/real-glm-reasoning-closeout.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const D = relative => require(path.join(ROOT, 'dist', relative));
const KEY_FILE = 'C:/Users/anjin/Desktop/Ai工作坊/Test-API/GLM-TEST-KEY.TXT';
const SHORT_NOVEL = 'C:/Users/anjin/Desktop/Ai工作坊/《白篱梦》.TXT';
const LONG_NOVEL = 'C:/Users/anjin/Desktop/Ai工作坊/凡人修仙传.txt';
const MAX_PHYSICAL_REQUESTS = 28;
const OUTPUT_PATH = path.join(ROOT, 'docs/reviews/reasoning-closeout/R6_REAL_GLM_METRICS.json');

const { OpenAICompatibleProvider } = D('application/llm/openAICompatible');
const { MemorySecretStore } = D('application/llm/memorySecretStore');
const { resolveModelCapabilities } = D('application/llm/capabilityResolver');
const { DEFAULT_OUTPUT_DEMANDS, planLlmRequest } = D('application/llm/requestBudgetKernel');
const { reasoningDialectForModel } = D('application/llm/reasoningPolicy');
const { normalizeReasoningTier } = D('application/llm/types');
const { parseStructuredOutput } = D('application/llm/structuredOutput');
const { LedgeredProvider, classifyLlmFailure } = D('application/llm/requestLedger');
const { llmModelProfileFingerprint } = D('application/llm/profileFingerprint');
const { SqliteLlmLedgerStore } = D('infra/sqlite/sqliteLlmLedgerStore');
const { applySqliteMigrations } = D('infra/sqlite/migrations');
const { BUILTIN_MIGRATIONS } = D('infra/sqlite/builtinMigrations');
const { importTxtSource } = D('application/import/txtImport');
const {
  extractOpeningDossier,
  compileProgressiveOpeningPackage,
  openingSourceBudgetForProfile,
} = D('application/worldPackage/progressiveOpening');
const { publishWorldPackage } = D('application/worldPackage/publish');
const { createCampaign } = D('application/campaign/createCampaign');
const { CampaignSession } = D('application/campaign/session');
const { SqliteStoryMemoryStore } = D('application/memory/storyMemoryRepository');
const { SqliteEpisodicStore } = D('application/memory/episodicStore');
const { runStoryMemoryMaintenance } = D('application/memory/storyMemoryMaintenance');
const { SqliteTurnStore } = D('infra/sqlite/sqliteTurnStore');
const { SqliteGameStore } = D('infra/sqlite/sqliteGameStore');
const { SqliteWorldStore } = D('infra/sqlite/sqliteWorldStore');
const { SqliteNarrativeStore } = D('infra/sqlite/sqliteNarrativeStore');
const { estimateTokens } = D('application/context/tokenEstimate');

class SafeFailure extends Error {
  constructor(code) { super(code); this.safeCode = code; }
}

class NodeSqliteAdapter {
  constructor(db) { this.db = db; }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = await work(this); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function createReport() {
  return {
    credential: { loaded: false },
    shortNovel: null,
    longNovel: null,
    directPlanner: [],
    storyTurns: [],
    storyMemory: null,
    longNovelBudgetPressure: null,
    logicalRequests: [],
    ledger: null,
  };
}
const report = createReport();
const physicalCaptures = [];
let physicalCount = 0;
let activeStage = 'initialization';

function readCredentials(keyFile = KEY_FILE, evidence = report) {
  const raw = fs.readFileSync(keyFile, 'utf8');
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([^：:]+)[：:]\s*(.+)$/);
    if (match) values[match[1].trim().toLowerCase()] = match[2].trim();
  }
  const key = values['api key'] ?? values.apikey;
  const endpoint = values['端点'] ?? values.endpoint;
  const model = values['模型'] ?? values.model;
  if (!key || !endpoint || !model) throw new SafeFailure('credential_fields_missing');
  evidence.credential = { loaded: true };
  return { key, endpoint, model };
}

class CapturingFetchTransport {
  async post(request) {
    physicalCount += 1;
    if (physicalCount > MAX_PHYSICAL_REQUESTS) throw new SafeFailure('physical_request_cap');
    let wire = {};
    try {
      const body = JSON.parse(request.body);
      wire = {
        reasoningEffort: body.reasoning_effort ?? null,
        clearThinking: body.thinking?.clear_thinking ?? null,
        maxTokens: Number.isInteger(body.max_tokens) ? body.max_tokens : null,
      };
    } catch { wire = { malformed: true }; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: 'POST', headers: request.headers, body: request.body, signal: controller.signal,
      });
      const responseBody = await response.text();
      physicalCaptures.push({ ...wire, httpStatus: response.status });
      return { status: response.status, body: responseBody };
    } catch (error) {
      physicalCaptures.push({ ...wire, httpStatus: null });
      throw error;
    } finally { clearTimeout(timer); }
  }
}

function usageOnly(usage) {
  return {
    inputTokens: Number.isFinite(usage?.inputTokens) ? usage.inputTokens : null,
    outputTokens: Number.isFinite(usage?.outputTokens) ? usage.outputTokens : null,
    reasoningTokens: Number.isFinite(usage?.reasoningTokens) ? usage.reasoningTokens : null,
    cachedInputTokens: Number.isFinite(usage?.cachedInputTokens) ? usage.cachedInputTokens : null,
    estimated: typeof usage?.estimated === 'boolean' ? usage.estimated : null,
  };
}

function failureOnly(error) {
  const metrics = Array.isArray(error?.requestMetrics) ? error.requestMetrics : [];
  const last = metrics[metrics.length - 1];
  return {
    category: classifyLlmFailure(error),
    errorType: typeof error?.name === 'string' ? error.name : 'unknown',
    httpStatus: Number.isInteger(last?.httpStatus) ? last.httpStatus : null,
    completionState: last?.completionState ?? null,
    physicalAttempts: metrics.length,
  };
}

function profileFor(model, endpoint, tier = 'low') {
  return {
    id: 'glm-closeout', name: 'GLM closeout', endpoint, model,
    keyRef: 'glm.closeout', reasoningTier: tier, reasoningDialect: 'glm',
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: 1_048_576, maxOutputTokens: 131_072, supportsPromptCache: true,
    },
    concurrency: 1, contentOutputTokens: 16_384,
  };
}

function instrumentProvider(rawProvider, profile) {
  return {
    async complete(request) {
      const captureStart = physicalCaptures.length;
      const started = Date.now();
      const tier = normalizeReasoningTier(
        request.reasoningTier ?? profile.reasoningTier ?? request.reasoningEffort ?? profile.reasoningEffort,
      );
      const record = {
        requestKind: request.requestKind ?? null,
        role: request.role,
        reasoningTier: tier,
        reasoningReserveTokens: Number.isInteger(request.reasoningReserveTokens)
          ? request.reasoningReserveTokens : null,
        maxOutputTokens: request.maxOutputTokens,
        logicalRequestId: request.ledger?.logicalRequestId ?? null,
      };
      try {
        const response = await rawProvider.complete(request);
        const wire = physicalCaptures.slice(captureStart);
        const output = {
          ...record,
          durationMs: Date.now() - started,
          contentPresent: response.text.trim().length > 0,
          usage: usageOnly(response.usage),
          wireAttempts: wire,
          outcome: response.requestMetrics?.at(-1)?.outcome ?? 'completed',
        };
        report.logicalRequests.push(output);
        return response;
      } catch (error) {
        const wire = physicalCaptures.slice(captureStart);
        report.logicalRequests.push({
          ...record,
          durationMs: Date.now() - started,
          usage: usageOnly(error?.requestMetrics?.at?.(-1)?.usage),
          wireAttempts: wire,
          failure: failureOnly(error),
        });
        throw error;
      }
    },
  };
}

function sha256Hex(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
function sha256BytesHex(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

async function importNovel(filePath) {
  const bytes = fs.readFileSync(filePath);
  const started = Date.now();
  const parsed = await importTxtSource(new Uint8Array(bytes), { sha256Hex, sha256BytesHex }, {
    decode(raw, encoding) { return new TextDecoder(encoding).decode(raw); },
  });
  return {
    parsed,
    metadata: {
      file: path.basename(filePath),
      sha256: parsed.sourceSha256Hex,
      bytes: bytes.length,
      chapters: parsed.chapters.length,
      codePoints: parsed.codePointCount,
      durationMs: Date.now() - started,
    },
  };
}

async function directPlannerGates(provider, ledgerProvider, capabilities, model) {
  activeStage = 'direct_planner';
  for (const tier of ['low', 'high', 'max']) {
    const system = 'Output one JSON object with keys actionKind and intent. No prose.';
    const user = 'Observe the supplied scene and return actionKind observe with a short intent.';
    const plan = planLlmRequest({
      capabilities,
      requestKind: 'planner',
      estimatedMandatoryInputTokens: estimateTokens(`${system}\n${user}`),
      businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
      reasoningPolicy: { tier, providerDialect: 'glm', model },
    });
    const captureStart = physicalCaptures.length;
    const request = {
      role: 'Planner', system, user,
      maxOutputTokens: plan.wireOutputTokens,
      maxPhysicalRequests: 1,
      jsonMode: true,
      reasoningTier: tier,
      reasoningReserveTokens: plan.reasoningPolicy.reserveTokens,
      reasoningPolicyVersion: plan.reasoningPolicy.policyVersion,
      requestKind: 'planner',
      ledger: { logicalRequestId: `r6:direct-planner:${tier}`, requestKind: 'planner' },
    };
    let result;
    let parseOk = false;
    try {
      const response = await ledgerProvider.complete(request);
      try { parseStructuredOutput(response.text, { label: 'planner response' }); parseOk = true; } catch { /* report shape only */ }
      result = {
        pass: parseOk,
        tier,
        reserveTokens: plan.reasoningPolicy.reserveTokens,
        businessOutputTokens: plan.requestedOutputTokens,
        wireOutputTokens: plan.wireOutputTokens,
        hardInputLimit: plan.envelope.hardInputLimit,
        usage: usageOnly(response.usage),
        durationMs: report.logicalRequests.at(-1)?.durationMs ?? null,
        providerParams: physicalCaptures.slice(captureStart).map(item => ({
          reasoningEffort: item.reasoningEffort,
          clearThinking: item.clearThinking,
          maxTokens: item.maxTokens,
          httpStatus: item.httpStatus,
        })),
      };
      result.pass &&= result.providerParams.length > 0
        && result.providerParams.every(item => item.reasoningEffort === tier
          && item.clearThinking === false && item.maxTokens === plan.wireOutputTokens
          && item.httpStatus >= 200 && item.httpStatus < 300);
    } catch (error) {
      result = {
        pass: false, tier,
        reserveTokens: plan.reasoningPolicy.reserveTokens,
        businessOutputTokens: plan.requestedOutputTokens,
        wireOutputTokens: plan.wireOutputTokens,
        hardInputLimit: plan.envelope.hardInputLimit,
        usage: usageOnly(error?.requestMetrics?.at?.(-1)?.usage),
        failure: failureOnly(error),
        durationMs: report.logicalRequests.at(-1)?.durationMs ?? null,
        providerParams: physicalCaptures.slice(captureStart).map(item => ({
          reasoningEffort: item.reasoningEffort,
          clearThinking: item.clearThinking,
          maxTokens: item.maxTokens,
          httpStatus: item.httpStatus,
        })),
      };
    }
    report.directPlanner.push(result);
  }
}

async function runShortStorySession(input) {
  activeStage = 'short_story_import';
  const { parsed, metadata } = await importNovel(SHORT_NOVEL);
  report.shortNovel = metadata;

  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  const worldStore = new SqliteWorldStore(adapter);
  const ledgerStore = new SqliteLlmLedgerStore(adapter);
  const worldId = 'world-r6-closeout';
  await worldStore.createWorld({
    worldId, title: 'R6 closeout fixture', sourceSha256: metadata.sha256,
    sourceBytes: metadata.bytes, normalizeVersion: parsed.normalizeVersion,
    chapterSplitVersion: parsed.chapterSplitVersion, buildStatus: 'ready',
    createdAt: 'r6', updatedAt: 'r6',
  });
  await worldStore.saveImportedSource(worldId, parsed, 'r6');

  const secrets = new MemorySecretStore();
  await secrets.set('glm.closeout', input.key);
  const profile = profileFor(input.model, input.endpoint, 'low');
  const rawProvider = new OpenAICompatibleProvider(profile, secrets, input.transport, 240_000);
  const provider = instrumentProvider(rawProvider, profile);
  const openingProvider = new LedgeredProvider(provider, ledgerStore, {
    modelProfileFingerprint: llmModelProfileFingerprint(profile),
  });

  activeStage = 'short_story_opening';
  const openingBudget = openingSourceBudgetForProfile(profile, parsed.codePointCount);
  const excerpt = Array.from(parsed.text).slice(0, openingBudget.sourceCodePoints).join('');
  const dossierResult = await extractOpeningDossier({
    provider: openingProvider,
    sourceExcerpt: excerpt,
    budget: openingBudget,
    ledger: {
      logicalRequestId: `world-opening-dossier:${worldId}:${metadata.sha256}`,
      worldId,
    },
  });
  report.opening = {
    requestKind: 'world_extract',
    tier: openingBudget.reasoningTier,
    reserveTokens: openingBudget.reasoningReserveTokens,
    businessOutputTokens: openingBudget.businessOutputTokens,
    wireOutputTokens: openingBudget.maxOutputTokens,
    sourceCodePoints: openingBudget.sourceCodePoints,
    physicalRequests: dossierResult.physicalRequests,
  };
  const compiled = await compileProgressiveOpeningPackage({
    worldStore, sha256Hex, worldId, sourceSha256: metadata.sha256,
    sourceExcerpt: excerpt, sourceEndCodePoint: openingBudget.sourceCodePoints,
    chapters: await worldStore.getChapters(worldId), dossier: dossierResult.dossier,
    requestMetrics: dossierResult.requestMetrics, usage: dossierResult.usage,
    extractionMs: dossierResult.physicalRequests > 0 ? dossierResult.requestMetrics[0]?.durationMs ?? 0 : 0,
    createdAt: new Date().toISOString(),
  });
  const published = await publishWorldPackage({
    worldStore, sha256Hex, worldId, sourceSha256: metadata.sha256,
    mappingVersion: 'r6-closeout-opening-1', entries: compiled.entries,
    sections: compiled.sections, createdAt: new Date().toISOString(),
  });

  activeStage = 'short_story_campaign';
  const campaignId = 'campaign-r6-closeout';
  const created = await createCampaign({
    db: adapter, worldStore, campaignId, title: 'Reasoning closeout', worldId,
    packageRevision: published.manifest.revision,
    anchor: { worldTimeOrder: 0, locationId: 'opening-location' },
    protagonist: {
      actorId: 'actor-r6-player', kind: 'original', name: '旅人',
      attributes: { physique: 2, agility: 3, insight: 2, knowledge: 1, willpower: 1, social: 1 },
      initialSkills: ['observation', 'diplomacy'],
    },
    goal: '观察开篇场景，保留已核实的见闻', createdAt: new Date().toISOString(),
  });

  const turns = new SqliteTurnStore(adapter);
  const game = new SqliteGameStore(adapter);
  const narratives = new SqliteNarrativeStore(adapter);
  const storyMemory = new SqliteStoryMemoryStore(adapter);
  const episodic = new SqliteEpisodicStore(adapter);
  const turnRows = [];
  const intents = [
    '仔细观察开篇场景的环境与动静，记下最显眼的特征。',
    '把刚才观察到的线索整理清楚，留意它与开篇场景的联系。',
    '回想刚才记下的线索，再观察它和眼前环境之间的关系。',
  ];
  const tiers = ['low', 'high', 'max'];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let memoryWasRun = false;
  const maintainMemory = async currentStateVersion => {
    activeStage = 'short_story_memory';
    let priorState = await storyMemory.getState(created.branchId);
    const waitDeadline = Date.now() + 240_000;
    while (priorState?.metadata.status === 'rebuilding' && Date.now() < waitDeadline) {
      await pause(1_000);
      priorState = await storyMemory.getState(created.branchId);
    }
    const capabilities = resolveModelCapabilities({
      declared: {
        contextWindowTokens: profile.capabilities.contextWindow,
        maxOutputTokens: profile.capabilities.maxOutputTokens,
        supportsJsonMode: true, reportsUsage: true, reasoningUsageReported: true,
        supportsPromptCache: true,
      },
      reasoningMode: 'always_on',
    });
    if ((priorState?.throughStateVersion ?? 0) < currentStateVersion) {
      profile.reasoningTier = 'max';
      const memoryProvider = new LedgeredProvider(
        new instrumentProvider(rawProvider, profile), ledgerStore,
        { modelProfileFingerprint: 'r6-glm-story-memory' },
      );
      await runStoryMemoryMaintenance({
        provider: memoryProvider,
        store: storyMemory,
        turnStore: turns,
        branchId: created.branchId,
        currentStateVersion,
        actors: [{ actorId: 'actor-r6-player', name: '旅人' }],
        capabilities,
        reasoningPolicy: { tier: 'max', providerDialect: 'glm', model: profile.model },
      });
    }
    memoryWasRun = true;
  };

  for (let index = 0; index < intents.length; index += 1) {
    activeStage = `short_story_turn_${index + 1}`;
    const tier = tiers[index];
    profile.reasoningTier = tier;
    const turnProvider = new instrumentProvider(rawProvider, profile);
    const session = new CampaignSession({
      db: adapter, turns, game, worldStore, narratives,
      llmLedger: ledgerStore, storyMemory: { store: storyMemory }, episodic: { store: episodic },
    hashProvider: { sha256Hex, sha256BytesHex },
      random: { nextIntInclusive: (min, max) => min + Math.floor(Math.random() * (max - min + 1)) },
    }, turnProvider, profile);
    const wireStart = physicalCaptures.length;
    const started = Date.now();
    const result = await session.playTurn({ campaignId, branchId: created.branchId, intent: intents[index] });
    const planner = session.lastTurnContexts.planner;
    const narrator = session.lastTurnContexts.narrator;
    turnRows.push({
      turn: index + 1,
      tier,
      stateVersion: result.stateVersion,
      plannerContextId: planner?.contextId ?? null,
      narratorContextId: narrator?.contextId ?? null,
      plannerReserveTokens: planner?.reasoning?.reserveTokens ?? null,
      narratorReserveTokens: narrator?.reasoning?.reserveTokens ?? null,
      plannerInputEstimate: planner?.estimatedTokens ?? null,
      narratorInputEstimate: narrator?.estimatedTokens ?? null,
      mandatoryContextIncluded: Boolean(planner?.included.some(item => item.board === 'currentState')),
      storyMemoryIncluded: Boolean(planner?.includedCandidateIds.includes('story-memory-v2')),
      episodicRecallIncluded: Boolean(planner?.includedCandidateIds.includes('episodic-recall')),
      providerRequests: physicalCaptures.slice(wireStart).map(item => ({
        reasoningEffort: item.reasoningEffort,
        clearThinking: item.clearThinking,
        maxTokens: item.maxTokens,
        httpStatus: item.httpStatus,
      })),
      grade: result.grade,
      durationMs: Date.now() - started,
    });
    report.storyTurns.push(turnRows.at(-1));
    await pause(1_200);
    if (index === 1) await maintainMemory(result.stateVersion);
  }

  if (!memoryWasRun) await maintainMemory(turnRows.at(-1).stateVersion);
  const memoryState = await storyMemory.getState(created.branchId);
  const memoryCalls = report.logicalRequests.filter(item =>
    item.requestKind === 'memory_checkpoint' || item.requestKind === 'memory_repair');
  report.storyMemory = {
    status: memoryState?.metadata.status ?? 'missing',
    throughStateVersion: memoryState?.throughStateVersion ?? null,
    selectedTier: memoryCalls.at(-1)?.reasoningTier ?? null,
    reserveTokens: memoryCalls.at(-1)?.reasoningReserveTokens ?? null,
    wireMaxTokens: memoryCalls.at(-1)?.maxOutputTokens ?? null,
    usage: memoryCalls.at(-1)?.usage ?? null,
    episodeRecordCount: (await episodic.listRecords(created.branchId)).length,
  };

  const rows = await adapter.queryAll(
    'SELECT request_kind, status, attempt_no, reasoning_tier, reasoning_reserve_tokens, wire_output_tokens, input_tokens, output_tokens, reasoning_tokens, cached_input_tokens, estimated_usage FROM llm_request_attempts ORDER BY started_at, attempt_no',
  );
  report.ledger = rows.map(row => ({
    requestKind: row.request_kind,
    status: row.status,
    attempt: row.attempt_no,
    reasoningTier: row.reasoning_tier,
    reserveTokens: row.reasoning_reserve_tokens,
    wireOutputTokens: row.wire_output_tokens,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    reasoningTokens: row.reasoning_tokens,
    cachedInputTokens: row.cached_input_tokens,
    estimatedUsage: Boolean(row.estimated_usage),
  }));
}

async function runLongNovelPressure() {
  activeStage = 'long_novel_local_pressure';
  const { parsed, metadata } = await importNovel(LONG_NOVEL);
  report.longNovel = metadata;
  const capabilities = resolveModelCapabilities({
    declared: {
      contextWindowTokens: 1_048_576, maxOutputTokens: 131_072,
      supportsJsonMode: true, reportsUsage: true, supportsPromptCache: true,
    },
    reasoningMode: 'always_on',
  });
  const sourceTokenDemand = estimateTokens(parsed.text);
  const plans = ['low', 'max'].map(tier => planLlmRequest({
    capabilities,
    requestKind: 'world_extract',
    estimatedMandatoryInputTokens: 80_000,
    businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.world_extract,
    contextDemands: [{
      id: 'long-novel-source-evidence', board: 'sourceEvidence',
      requirement: 'optional', priority: 40, relevance: 1,
      estimatedTokens: sourceTokenDemand, minTokens: 0,
      targetTokens: sourceTokenDemand, clipMode: 'text',
    }],
    reasoningPolicy: { tier, providerDialect: 'glm', model: 'glm-5.3-flash' },
  }));
  const optionalAllocation = plans.map(plan =>
    plan.allocation?.allocations.find(item => item.id === 'long-novel-source-evidence')?.allocated ?? 0,
  );
  report.longNovelBudgetPressure = {
    sourceTokenDemand,
    lowHardInputTokens: plans[0].envelope.hardInputLimit,
    maxHardInputTokens: plans[1].envelope.hardInputLimit,
    lowOptionalInputTokens: optionalAllocation[0],
    maxOptionalInputTokens: optionalAllocation[1],
    maxShrankOptional: optionalAllocation[1] < optionalAllocation[0],
    mandatoryInputTokens: 80_000,
  };
}

async function writeReport(outputPath = OUTPUT_PATH, evidence = report) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  evidence.physicalRequestCount = physicalCount;
  evidence.physicalRequestLimit = MAX_PHYSICAL_REQUESTS;
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2));
}

async function main() {
  const { key, endpoint, model } = readCredentials();
  const secrets = new MemorySecretStore();
  await secrets.set('glm.closeout', key);
  const profile = profileFor(model, endpoint);
  const transport = new CapturingFetchTransport();
  const rawProvider = new OpenAICompatibleProvider(profile, secrets, transport, 240_000);
  const provider = instrumentProvider(rawProvider, profile);
  const adapter = new NodeSqliteAdapter(new DatabaseSync(':memory:'));
  await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS);
  const ledgerStore = new SqliteLlmLedgerStore(adapter);
  const ledgerProvider = new LedgeredProvider(provider, ledgerStore, { modelProfileFingerprint: 'r6-glm-test' });
  const capabilities = resolveModelCapabilities({
    declared: {
      contextWindowTokens: profile.capabilities.contextWindow,
      maxOutputTokens: profile.capabilities.maxOutputTokens,
      supportsJsonMode: true, reportsUsage: true, reasoningUsageReported: true,
      supportsPromptCache: true,
    },
    reasoningMode: 'always_on',
  });

  await directPlannerGates(provider, ledgerProvider, capabilities, model);
  await runShortStorySession({ key, endpoint, model, transport });
  await runLongNovelPressure();

  const directTiers = ['low', 'high', 'max'];
  const directTierMappingPass = directTiers.every((tier, index) => {
    const gate = report.directPlanner[index];
    return gate?.tier === tier && gate.providerParams?.length > 0
      && gate.providerParams.every(item => item.reasoningEffort === tier
        && item.clearThinking === false && item.maxTokens === gate.wireOutputTokens
        && item.httpStatus >= 200 && item.httpStatus < 300);
  });
  const expectedTurnTiers = ['low', 'high', 'max'];
  const storyTierSwitchPass = report.storyTurns.length === expectedTurnTiers.length
    && report.storyTurns.every((turn, index) => turn.tier === expectedTurnTiers[index]
      && turn.plannerContextId && turn.narratorContextId
      && turn.plannerReserveTokens > turn.narratorReserveTokens
      && turn.narratorInputEstimate < turn.plannerInputEstimate
      && turn.providerRequests.length >= 2
      && turn.providerRequests.every(item => item.reasoningEffort === turn.tier
        && item.clearThinking === false && item.httpStatus >= 200 && item.httpStatus < 300));
  const storyMemoryPass = report.storyMemory?.status === 'clean'
    && report.storyMemory.throughStateVersion >= 2
    && ['high', 'max'].includes(report.storyMemory.selectedTier)
    && report.storyMemory.reserveTokens >= (report.storyMemory.selectedTier === 'max' ? 12_288 : 4_096)
    && report.ledger?.some(row => row.requestKind === 'memory_checkpoint'
      && row.status === 'succeeded' && row.reasoningTier === report.storyMemory.selectedTier);
  const progressiveOpeningGovernancePass = report.opening?.tier === 'low'
    && report.opening.reserveTokens >= 2_048
    && report.opening.wireOutputTokens === report.opening.businessOutputTokens + report.opening.reserveTokens
    && report.ledger?.some(row => row.requestKind === 'world_extract'
      && row.status === 'succeeded' && row.reasoningTier === report.opening.tier
      && row.reserveTokens === report.opening.reserveTokens
      && row.wireOutputTokens === report.opening.wireOutputTokens);
  const episodicRecallPass = report.storyTurns.at(-1)?.episodicRecallIncluded === true
    && (report.storyMemory?.episodeRecordCount ?? 0) >= 2;
  const longPressurePass = report.longNovelBudgetPressure?.maxShrankOptional === true
    && report.longNovelBudgetPressure.maxHardInputTokens < report.longNovelBudgetPressure.lowHardInputTokens;
  report.acceptance = {
    directPlannerProviderTiers: directTierMappingPass,
    shortStoryTurnTierSwitchAndNarratorBudget: storyTierSwitchPass,
    storyMemoryKernelLedgerMaxTier: storyMemoryPass,
    progressiveOpeningKernelLedger: progressiveOpeningGovernancePass,
    episodicRecallInPlannerContext: episodicRecallPass,
    longNovelMaxTierOptionalContextShrink: longPressurePass,
  };
  await writeReport();
  console.log(`R6 GLM live gates recorded: ${path.relative(ROOT, OUTPUT_PATH)}; physicalRequests=${physicalCount}`);
  if (Object.values(report.acceptance).some(value => value !== true)) process.exitCode = 1;
}

// Importing the fixture seams never loads local credentials or runs live gates.
module.exports = { createReport, readCredentials, writeReport };

if (require.main === module) {
  main().catch(async error => {
    const code = error?.safeCode ?? error?.errorCode
      ?? (typeof error?.code === 'string' ? error.code : 'unexpected_failure');
    report.failure = {
      stage: activeStage,
      code: /^[A-Za-z0-9_:]+$/.test(code) ? code : 'unexpected_failure',
      errorType: typeof error?.name === 'string' ? error.name : 'unknown',
    };
    try { await writeReport(); } catch { /* report failure contains no source or credential */ }
    console.error(`R6 GLM verification stopped: stage=${activeStage} code=${report.failure.code}`);
    process.exitCode = 1;
  });
}
