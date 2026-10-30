/**
 * Final-closeout real-model short journey (R7-B) on the PUBLISHED real-novel
 * world from the R4 capture DB. Scope `final-closeout-v111-ext1`.
 *
 * Sequence (mirrors the approved C-17 journey shape):
 *   1. zero-request local baseline opening (W3) on the real world
 *   2. L1 local contract + REAL Narrator turn
 *   3. REAL Planner + Narrator turn (planner_required path) — C-12 ratio sample
 *   4. background successor preparation observed
 *   5. offline case: unreachable endpoint → local template degrade (W4c)
 * Credentials stay in memory; artifacts under .tmp/final-closeout/journey/.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const requireP = p => require(path.join(ROOT, p));

const SCOPE_FILE = path.join(ROOT, '.tmp/final-closeout/budget-scope-ext1.json');
const SCOPE_ID = 'final-closeout-v111-ext1';
const CAP = 30;
const KEY_FILE = process.env.CONVERGENCE_KEY_FILE || 'C:/Users/anjin/Desktop/Ai工作坊/Test-API/Minimax-TEST-KEY.txt';
const WORK = path.join(ROOT, '.tmp/final-closeout/journey');
const CAPTURE_DB = path.join(ROOT, '.tmp/final-closeout/capture.sqlite');

function readCredentials() {
  const fields = {};
  for (const line of fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^：:]{1,40})[：:]\s*(.+)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  const endpoint = fields['base_url（OpenAI 兼容）'] || fields['base_url'] || fields.endpoint;
  const model = fields['模型'] || fields.model;
  const key = fields['key'] || fields['api key'] || fields['密钥'];
  if (!endpoint || !model || !key) throw new Error('credential file incomplete');
  return { endpoint: endpoint.replace(/\/+$/, ''), model, key };
}

fs.mkdirSync(path.dirname(SCOPE_FILE), { recursive: true });
const budgetModulePath = require.resolve(path.join(ROOT, 'tools/phase9-budget.cjs'));
const pristine = require(budgetModulePath);
try {
  pristine.initializeScopedBudgetManifest({ filePath: SCOPE_FILE, scopeId: SCOPE_ID, capPhysicalRequests: CAP,
    inputs: { round: 'final-closeout-v111 (extension)', authorized: '2026-10-30 user authorization: increase quota until construction completes',
      note: 'shared extension ledger with the capture driver' } });
} catch (error) { if (!/already exists/.test(String(error?.message))) throw error; }
delete require.cache[budgetModulePath];
process.env.PHASE9_BUDGET_SCOPE_FILE = SCOPE_FILE;
process.env.PHASE9_BUDGET_SCOPE_CAP = String(CAP);
process.env.PHASE9_BUDGET_SCOPE_ID = SCOPE_ID;
const budget = require(budgetModulePath);
const { postQaHttp } = requireP('tools/phase9-http.cjs');

function profileFor(endpoint) {
  return {
    id: 'closeout-journey', name: 'closeout-journey', endpoint, model: 'MiniMax-M3.1-Flash', keyRef: 'memory',
    reasoningTier: 'high', reasoningDialect: 'generic', contentOutputTokens: 16_384,
    capabilities: { supportsJson: false, supportsStreaming: true, reportsUsage: true,
      contextWindow: 1_000_000, maxOutputTokens: 524_288, supportsPromptCache: true },
  };
}

function stubProfile() {
  return { id: 'stub', name: 'stub', endpoint: 'https://stub.invalid/v1', model: 'stub', keyRef: 'stub',
    capabilities: { supportsJson: false, supportsStreaming: false, reportsUsage: false } };
}

const jsonl = path.join(WORK, 'journey.jsonl');
function log(event) { fs.appendFileSync(jsonl, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); }

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const creds = readCredentials();
  const profile = profileFor(creds.endpoint);
  const manifest = budget.readManifest();
  console.log(`[budget] scope=${manifest.scopeId} spent=${manifest.spentPhysicalRequests}/${manifest.capPhysicalRequests}`);

  const transport = { async post(request) {
    const reservationId = budget.reservePhysicalRequest({ owner: 'host:closeout-journey',
      requestKind: request.requestKind || 'android_unknown',
      logicalRequestId: request.logicalRequestId, attemptId: request.attemptId, attemptNo: request.attemptNo,
      profileFingerprint: request.profileFingerprint });
    let dispatched = false;
    try {
      const response = await postQaHttp({
        url: request.url, headers: request.headers, body: request.body,
        timeoutMs: request.timeoutMs ?? 300_000,
        ...(request.streamActivityTimeoutMs ? { streamActivityTimeoutMs: request.streamActivityTimeoutMs } : {}),
        onDispatch: () => { dispatched = true; budget.markPhysicalRequestDispatched(reservationId); },
      });
      budget.finishPhysicalRequest(reservationId, { outcome: 'completed', httpStatus: response.status });
      return { status: response.status, body: response.body, headers: response.headers ?? {} };
    } catch (error) {
      const notSent = error?.name === 'HttpRequestNotSentError';
      budget.finishPhysicalRequest(reservationId, { outcome: notSent ? 'not_sent' : 'outcome_unknown',
        failureClass: notSent ? 'not_sent' : (error?.name || 'unknown') });
      throw error;
    }
  } };

  const { createMobileHarness } = requireP('tests/helpers/mobileHarness.cjs');
  const bytes = fs.readFileSync('C:/Users/anjin/Desktop/Ai工作坊/放开那个女巫.txt');
  const h = await createMobileHarness({ bytes, dbPath: CAPTURE_DB, transport,
    secrets: { async get() { return creds.key; } } });
  try {
    const published = await h.adapter.queryOne('SELECT world_id,revision FROM world_packages ORDER BY revision DESC LIMIT 1');
    if (!published) throw new Error('capture DB has no published world; finish the R4 publication first');
    console.log(`[world] using published ${published.world_id.slice(-8)} r${published.revision}`);
    log({ kind: 'world_reuse', worldId: published.world_id, revision: published.revision });

    const { SqliteCampaignPlanStore } = requireP('dist/infra/sqlite/sqliteCampaignPlanStore');
    const { adoptOpeningPlan } = requireP('dist/application/campaignPlan/adoption');
    const { buildPlanningContext } = requireP('dist/application/campaignPlan/planningService');
    const { buildLocalBaselineModel, localBaselineCandidateIdentity } = requireP('dist/application/campaignPlan/localBaselinePlan');
    const { compileAndValidateCandidate } = requireP('dist/application/campaignPlan/candidateCompile');
    const { frozenPlanJob } = requireP('dist/application/campaignPlan/jobFreeze');
    const { CampaignSession } = requireP('dist/application/campaign/session');
    const { canonicalJsonOf, sha256HexOf } = requireP('dist/application/campaignPlan/hashing');

    const planStore = new SqliteCampaignPlanStore(h.adapter);
    const setupId = `setup-local-${Date.now().toString(36)}`;
    const world = { worldId: published.world_id, revision: published.revision };
    const pkg = await h.runtime.worldStore.getWorldPackage(world.worldId, world.revision);
    const session0 = await new CampaignSession({ db: h.adapter,
      turns: new (requireP('dist/infra/sqlite/sqliteTurnStore').SqliteTurnStore)(h.adapter),
      game: new (requireP('dist/infra/sqlite/sqliteGameStore').SqliteGameStore)(h.adapter),
      worldStore: h.runtime.worldStore,
      narratives: new (requireP('dist/infra/sqlite/sqliteNarrativeStore').SqliteNarrativeStore)(h.adapter),
      guidance: new (requireP('dist/infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(h.adapter),
      hashProvider: { sha256Hex: async t => crypto.createHash('sha256').update(String(t)).digest('hex') },
      random: { nextIntInclusive: (min, max) => min + Math.floor(Math.random() * (max - min + 1)) } },
      (p => new (requireP('dist/application/llm/openAICompatible').OpenAICompatibleProvider)(p, h.secrets, h.transport, 300_000))(stubProfile()), stubProfile());
    const setup = await session0.getWorldSetup(world.worldId);
    const firstAnchor = setup.anchorEvents[0];
    const anchor = { worldTimeOrder: firstAnchor?.worldTimeOrder ?? 1,
      ...(firstAnchor?.eventId ? { anchorEventId: firstAnchor.eventId } : {}),
      locationId: setup.locations[0] ?? '' };
    const intent = {
      schemaVersion: 'campaign-intent-1', setupId, intentRevision: 1,
      rawIntent: '查清眼前事件的来龙去脉，并在镇上站稳脚跟', normalizedIntent: '查清眼前事件的来龙去脉，并在镇上站稳脚跟', goalMode: 'declared',
      protagonistBinding: { actorId: 'actor-player', kind: 'original', name: '罗澜' },
      openingAnchor: anchor, companionBindings: [], lengthPreference: 'medium',
      userConstraints: [], requestedCanonTargets: [], knowledgePolicy: 'anchor_projection',
      sourceCoverageBinding: { worldId: world.worldId, packageRevision: world.revision,
        coverageWorldTimeOrder: anchor.worldTimeOrder, packageContentHash: pkg.manifest.contentHash },
      createdAt: new Date().toISOString(),
    };
    await planStore.upsertSetup({ setupId, worldId: world.worldId, packageRevision: world.revision,
      intent, intentHistory: [intent], currentCandidateId: null, status: 'planning',
      createdAt: intent.createdAt, updatedAt: intent.createdAt });
    await planStore.insertJob({ jobId: `job-${setupId}`, setupId, campaignId: null, branchId: null, jobKind: 'opening_plan',
      triggerReasons: ['user_requested'], baseStateVersion: null, basePlanId: null, basePlanRevision: null,
      intentHash: sha256HexOf(canonicalJsonOf(intent)), contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
      status: 'queued', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 0,
      nextRetryAt: null, physicalRequestBudget: 0, freezeRootId: null, lastError: null,
      createdAt: intent.createdAt, updatedAt: intent.createdAt });
    const { ctx } = await buildPlanningContext({ worldStore: h.runtime.worldStore, intent, protagonistSkills: setup.skills.slice(0, 3).map(s => s.entryId) });
    const model = buildLocalBaselineModel({ ctx, intent, anchorTitle: firstAnchor ? `序${firstAnchor.worldTimeOrder} · ${firstAnchor.title}` : '开局时刻', worldTitle: '放开那个女巫' });
    const frozen = frozenPlanJob(intent, profile, { system: '', user: '' }, ctx);
    const { compiled, errors } = compileAndValidateCandidate(frozen, model, {
      jobId: `job-${setupId}`, setupId, branchId: null, now: () => new Date().toISOString(), committedEvents: [] });
    if (errors.length) throw new Error(`local baseline rejected: ${errors.slice(0, 3).join('; ')}`);
    const candidateId = `job-${setupId}:a1:1`;
    const { rawResponseText, candidateHash } = localBaselineCandidateIdentity(model, compiled.plan, compiled.artifact);
    await planStore.upsertCandidate({ candidateId, jobId: `job-${setupId}`, setupId, attemptGroup: 'a1', attemptNo: 1,
      stage: 'ready', rawResponseRef: 'local-baseline-1', rawResponseText, parseResultJson: JSON.stringify(model),
      validationErrors: [], repairUsed: false, candidateHash, plan: compiled.plan, artifact: compiled.artifact,
      createdAt: intent.createdAt, updatedAt: intent.createdAt });
    await h.adapter.execute("UPDATE campaign_setups SET status='proposal_ready', current_candidate_id=? WHERE setup_id=?", [candidateId, setupId]);
    const adopted = await adoptOpeningPlan({
      db: h.adapter, planStore, setupId, candidateId,
      create: { db: h.adapter, worldStore: h.runtime.worldStore, campaignId: `camp-journey-${Date.now().toString(36)}`,
        title: `收口短旅程 · ${intent.rawIntent.slice(0, 10)}`, worldId: world.worldId, packageRevision: world.revision,
        anchor, protagonist: { actorId: 'actor-player', kind: 'original', name: '罗澜',
          attributes: { physique: 2, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
          initialSkills: setup.skills.slice(0, 3).map(s => s.entryId) },
        companions: [], goal: intent.rawIntent, createdAt: new Date().toISOString() },
    });
    const l1Methods = compiled.artifact.situations[0].definition.methods.map(m => m.methodId);
    console.log(`[local] baseline adopted ${adopted.campaign.campaignId} (0 requests); L1 methods: ${l1Methods.join(', ')}`);
    log({ kind: 'local_baseline', campaignId: adopted.campaign.campaignId, methods: l1Methods, physical: 0 });

    const makeProvider = p => {
      const ledger = new (requireP('dist/infra/sqlite/sqliteLlmLedgerStore').SqliteLlmLedgerStore)(h.adapter);
      const inner = new (requireP('dist/application/llm/openAICompatible').OpenAICompatibleProvider)(p, h.secrets, h.transport, 300_000);
      return new (requireP('dist/application/llm/scheduledProvider').RateScheduledProvider)(
        new (requireP('dist/application/llm/requestLedger').LedgeredProvider)(inner, ledger,
          { modelProfileFingerprint: requireP('dist/application/llm/profileFingerprint').llmModelProfileFingerprint(p) }),
        new (requireP('dist/application/worldBuild/rateScheduler').GlobalRateScheduler)(
          { maxConcurrent: 2, endpointBucketId: requireP('dist/application/worldBuild/rateScheduler').endpointBucketId(p.endpoint) }));
    };
    const makeSession = p => new CampaignSession({ db: h.adapter,
      turns: new (requireP('dist/infra/sqlite/sqliteTurnStore').SqliteTurnStore)(h.adapter),
      game: new (requireP('dist/infra/sqlite/sqliteGameStore').SqliteGameStore)(h.adapter),
      worldStore: h.runtime.worldStore,
      narratives: new (requireP('dist/infra/sqlite/sqliteNarrativeStore').SqliteNarrativeStore)(h.adapter),
      guidance: new (requireP('dist/infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(h.adapter),
      hashProvider: { sha256Hex: async t => crypto.createHash('sha256').update(String(t)).digest('hex') },
      random: { nextIntInclusive: (min, max) => min + Math.floor(Math.random() * (max - min + 1)) } },
      makeProvider(p), p);

    async function physicalCount() {
      const rows = await h.adapter.queryOne('SELECT COUNT(*) AS n FROM llm_request_attempts');
      return Number(rows?.n ?? 0);
    }

    const session = makeSession(profile);
    const campaign = { campaignId: adopted.campaign.campaignId, branchId: adopted.campaign.branchId };
    let plannerDispatches = 0, narratorDispatches = 0, committed = 0;
    for (let i = 0; i < 2 && committed < 2; i += 1) {
      const guidance = await session.ensureDecisionPointGuidance({ campaignId: campaign.campaignId,
        branchId: campaign.branchId, sourceTurnId: 'qa-current', localOnly: true });
      const step = guidance?.steps.find(s => s.availability === 'available');
      const before = await physicalCount();
      const started = Date.now();
      const result = await session.playTurn({ campaignId: campaign.campaignId, branchId: campaign.branchId,
        intent: step ? step.firstStepIntent : '观察周围的情况',
        ...(step ? { guidanceChoice: { decisionPoint: guidance.decisionPoint, candidateRef: step.candidateRef } } : {}) });
      const physical = await physicalCount() - before;
      const kinds = await h.adapter.queryAll('SELECT request_kind FROM llm_request_attempts WHERE rowid > (SELECT MAX(rowid)-(?) FROM llm_request_attempts)', [physical]);
      plannerDispatches += kinds.filter(k => k.request_kind === 'planner').length;
      narratorDispatches += kinds.filter(k => k.request_kind === 'narrator').length;
      committed += 1;
      const degraded = String(result.text).startsWith('（本地叙事）');
      console.log(`[turn ${committed}] grade=${result.grade} ${Date.now() - started}ms physical=${physical} localTemplate=${degraded}`);
      log({ kind: 'turn', index: committed, turnId: result.turnId, grade: result.grade, ms: Date.now() - started, physical, degraded });
    }
    console.log(`[routing] committed=${committed} planner=${plannerDispatches} narrator=${narratorDispatches}`);
    log({ kind: 'routing_sample', committed, planner: plannerDispatches, narrator: narratorDispatches });

    // Offline degrade: unreachable endpoint → local template (W4c), 0 requests.
    const offlineSession = makeSession(profileFor('http://127.0.0.1:1/v1'));
    const guidance = await offlineSession.ensureDecisionPointGuidance({ campaignId: campaign.campaignId,
      branchId: campaign.branchId, sourceTurnId: 'qa-current', localOnly: true });
    const step = guidance?.steps.find(s => s.availability === 'available');
    const before = await physicalCount();
    const offline = await offlineSession.playTurn({ campaignId: campaign.campaignId, branchId: campaign.branchId,
      intent: step ? step.firstStepIntent : '观察周围的情况',
      ...(step ? { guidanceChoice: { decisionPoint: guidance.decisionPoint, candidateRef: step.candidateRef } } : {}) });
    const offlinePhysical = await physicalCount() - before;
    const localMarked = String(offline.text).startsWith('（本地叙事）');
    console.log(`[offline] grade=${offline.grade} physical=${offlinePhysical} localTemplate=${localMarked}`);
    log({ kind: 'offline_turn', grade: offline.grade, physical: offlinePhysical, localTemplate: localMarked });

    log({ kind: 'summary', committed, plannerDispatches, narratorDispatches, offlineLocalMarked: localMarked });
    console.log('\nJOURNEY COMPLETE');
  } finally {
    h.db.close();
  }
}

main().catch(error => {
  console.error('JOURNEY FAILED:', error instanceof Error ? error.message : String(error));
  try { const j = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8')); console.error(`[budget] ext1 spent=${j.spentPhysicalRequests}/${j.capPhysicalRequests}`); } catch { /* keep the primary failure */ }
  process.exit(1);
});
