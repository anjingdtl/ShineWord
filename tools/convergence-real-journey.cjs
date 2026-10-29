/**
 * Startup-convergence real-model journey driver (C-17; authorized 2026-10-27).
 *
 * PRODUCTION pipeline on the host, against the scoped MiniMax budget:
 *   1. world build (T-D, one real world_extract) — reused if already published
 *   2. LOCAL baseline opening (W3: zero requests) → adopt → play surface
 *   3. real foreground turns (Planner+Narrator each) via playTurn
 *   4. background successor preparation (T-C campaign_plan) observed
 *   5. offline case: unreachable endpoint → narrator degrades to the local
 *      template (W4c), planner stays local (L1) — zero physical requests
 *
 * Budget: the scoped convergence manifest (tools/phase9-budget.cjs with
 * PHASE9_BUDGET_SCOPE_FILE). Credentials never leave memory; nothing secret
 * is printed. Artifacts under .tmp/convergence/.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const requireP = p => require(path.join(ROOT, p));
const { createMobileHarness } = requireP('tests/helpers/mobileHarness.cjs');
const { SqliteCampaignPlanStore } = requireP('dist/infra/sqlite/sqliteCampaignPlanStore');
const { adoptOpeningPlan } = requireP('dist/application/campaignPlan/adoption');
const { buildPlanningContext } = requireP('dist/application/campaignPlan/planningService');
const { buildLocalBaselineModel, localBaselineCandidateIdentity } = requireP('dist/application/campaignPlan/localBaselinePlan');
const { compileAndValidateCandidate } = requireP('dist/application/campaignPlan/candidateCompile');
const { frozenPlanJob } = requireP('dist/application/campaignPlan/jobFreeze');
const { CampaignSession } = requireP('dist/application/campaign/session');
const { OpenAICompatibleProvider } = requireP('dist/application/llm/openAICompatible');
const { LedgeredProvider } = requireP('dist/application/llm/requestLedger');
const { RateScheduledProvider } = requireP('dist/application/llm/scheduledProvider');
const { GlobalRateScheduler, endpointBucketId } = requireP('dist/application/worldBuild/rateScheduler');
const { SqliteLlmLedgerStore } = requireP('dist/infra/sqlite/sqliteLlmLedgerStore');
const { llmModelProfileFingerprint } = requireP('dist/application/llm/profileFingerprint');
const { canonicalJsonOf, sha256HexOf } = requireP('dist/application/campaignPlan/hashing');

const KEY_FILE = process.env.CONVERGENCE_KEY_FILE || 'C:/Users/anjin/Desktop/Ai工作坊/Test-API/Minimax-TEST-KEY.txt';
const NOVEL_PATH = process.env.CONVERGENCE_NOVEL || 'C:/Users/anjin/Desktop/Ai工作坊/放开那个女巫.txt';
const WORK = '.tmp/convergence/journey';
const REAL_TURNS = Number(process.env.CONVERGENCE_REAL_TURNS || 3);

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

function scopedBudgetModule() {
  const scope = process.env.PHASE9_BUDGET_SCOPE_FILE;
  if (!scope) throw new Error('PHASE9_BUDGET_SCOPE_FILE is required for this driver');
  return require('./phase9-budget.cjs');
}

const budget = scopedBudgetModule();
const { postQaHttp } = require('./phase9-http.cjs');

function profileFor(endpoint) {
  // Wire-verified MiniMax preset (mobile/src/profileStore.ts) + QA tier high:
  // the low tier produced under-evidenced extractions on-device (2026-10-28).
  return {
    id: 'convergence-host', name: 'convergence-host', endpoint, model: 'MiniMax-M3.1-Flash', keyRef: 'memory',
    reasoningTier: 'high', reasoningDialect: 'generic', contentOutputTokens: 16_384,
    capabilities: { supportsJson: false, supportsStreaming: true, reportsUsage: true,
      contextWindow: 1_000_000, maxOutputTokens: 524_288, supportsPromptCache: true },
  };
}

function makeProvider(h, profile) {
  const ledger = new SqliteLlmLedgerStore(h.adapter);
  const inner = new OpenAICompatibleProvider(profile, h.secrets, h.transport, 300_000);
  return new RateScheduledProvider(
    new LedgeredProvider(inner, ledger, { modelProfileFingerprint: llmModelProfileFingerprint(profile) }),
    new GlobalRateScheduler({ maxConcurrent: 2, endpointBucketId: endpointBucketId(profile.endpoint) }));
}

function stubProfile() {
  return { id: 'stub', name: 'stub', endpoint: 'https://stub.invalid/v1', model: 'stub', keyRef: 'stub',
    capabilities: { supportsJson: false, supportsStreaming: false, reportsUsage: false } };
}

function makeSession(h, profile) {
  return new CampaignSession({
    db: h.adapter,
    turns: h.runtime.turns ?? new (requireP('dist/infra/sqlite/sqliteTurnStore').SqliteTurnStore)(h.adapter),
    game: new (requireP('dist/infra/sqlite/sqliteGameStore').SqliteGameStore)(h.adapter),
    worldStore: h.runtime.worldStore,
    narratives: new (requireP('dist/infra/sqlite/sqliteNarrativeStore').SqliteNarrativeStore)(h.adapter),
    guidance: new (requireP('dist/infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(h.adapter),
    hashProvider: { sha256Hex: async t => crypto.createHash('sha256').update(String(t)).digest('hex') },
    random: { nextIntInclusive: (min, max) => min + Math.floor(Math.random() * (max - min + 1)) },
  }, makeProvider(h, profile), profile);
}

async function physicalCount(h) {
  const rows = await h.adapter.queryAll('SELECT COUNT(*) AS n FROM llm_request_attempts');
  return Number(rows[0]?.n ?? 0);
}

const jsonl = path.join(WORK, 'journey.jsonl');
function log(event) { fs.appendFileSync(jsonl, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); }

async function buildWorld(h, profile) {
  const worldFile = path.join(WORK, 'world.json');
  if (fs.existsSync(worldFile)) {
    const saved = JSON.parse(fs.readFileSync(worldFile, 'utf8'));
    const revision = await h.runtime.worldStore.getPublishedPackageRevision(saved.worldId);
    if (revision) { console.log(`[world] reused ${saved.worldId} r${revision}`); return { worldId: saved.worldId, revision }; }
  }
  if (process.env.CONVERGENCE_REUSE_DB === '1') {
    throw new Error('CONVERGENCE_REUSE_DB=1 but no world.json found for the reused database');
  }
  console.log('[world] importing novel through the production progressive pipeline (real extract)…');
  const before = await physicalCount(h);
  const imported = await h.sourceImport.importNovelUnified('memory://novel', path.basename(NOVEL_PATH), profile, 'progressive',
    progress => { if (progress.message) process.stdout.write(`\r[import] ${progress.message.slice(0, 60).padEnd(60)}`); });
  process.stdout.write('\n');
  for (const runId of imported.runIds) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await h.sourceImport.requestSegmentRunControl(runId, 'resume');
      const result = await h.sourceImport.runExtraction(runId, profile, () => {});
      if (result.completed) break;
      const issues = await h.runtime.worldStore.listReviewIssues(imported.worldId, 'open');
      if (issues.length === 0) throw new Error(`run ${runId} blocked without review issues`);
      for (const issue of issues) {
        if (issue.kind === 'canon_conflict') {
          const detail = JSON.parse(issue.detailJson ?? '{}');
          for (const factId of detail.factIds ?? []) {
            await h.runtime.worldStore.resolveCanonFactConflict(imported.worldId, factId, 'complementary');
          }
        }
        await h.runtime.worldStore.resolveReviewIssue(imported.worldId, issue.issueId, 'resolved', true);
      }
      console.log(`[world] resolved ${issues.length} review issue(s), retrying`);
    }
  }
  const revision = await h.runtime.worldStore.getPublishedPackageRevision(imported.worldId);
  if (!revision) throw new Error('import did not publish');
  const spent = await physicalCount(h) - before;
  fs.writeFileSync(worldFile, JSON.stringify({ worldId: imported.worldId, revision }));
  console.log(`[world] ${imported.worldId} r${revision} published (${spent} physical)`);
  log({ kind: 'world_build', worldId: imported.worldId, revision, physical: spent });
  return { worldId: imported.worldId, revision };
}

/** W3 local baseline: compile → validate → persist → adopt. Zero requests. */
async function startLocalCampaign(h, profile, world, intentText, lengthPreference) {
  const planStore = new SqliteCampaignPlanStore(h.adapter);
  const setupId = `setup-local-${Date.now().toString(36)}`;
  const pkg = await h.runtime.worldStore.getWorldPackage(world.worldId, world.revision);
  const session0 = await makeSession(h, stubProfile());
  const setup = await session0.getWorldSetup(world.worldId);
  const firstAnchor = setup.anchorEvents[0];
  const anchor = { worldTimeOrder: firstAnchor?.worldTimeOrder ?? 1,
    ...(firstAnchor?.eventId ? { anchorEventId: firstAnchor.eventId } : {}),
    locationId: setup.locations[0] ?? '' };
  const intent = {
    schemaVersion: 'campaign-intent-1', setupId, intentRevision: 1,
    rawIntent: intentText, normalizedIntent: intentText, goalMode: 'declared',
    protagonistBinding: { actorId: 'actor-player', kind: 'original', name: '罗澜' },
    openingAnchor: anchor, companionBindings: [], lengthPreference,
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
    create: { db: h.adapter, worldStore: h.runtime.worldStore, campaignId: `camp-local-${Date.now().toString(36)}`,
      title: `本地基线 · ${intentText.slice(0, 12)}`, worldId: world.worldId, packageRevision: world.revision,
      anchor, protagonist: { actorId: 'actor-player', kind: 'original', name: '罗澜',
        attributes: { physique: 2, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
        initialSkills: setup.skills.slice(0, 3).map(s => s.entryId) },
      companions: [], goal: intentText, createdAt: new Date().toISOString() },
  });
  const l1 = compiled.artifact.situations[0].definition.methods.map(m => m.methodId);
  console.log(`[local] adopted ${adopted.campaign.campaignId} in one click (0 requests); L1 methods: ${l1.join(', ')}`);
  log({ kind: 'local_baseline', campaignId: adopted.campaign.campaignId, methods: l1, physical: 0 });
  return { campaignId: adopted.campaign.campaignId, branchId: adopted.campaign.branchId };
}

async function playRealTurns(h, profile, campaign, count) {
  const session = makeSession(h, profile);
  let committed = 0;
  let attempts = 0;
  while (committed < count && attempts < count * 3) {
    attempts += 1;
    const guidance = await session.ensureDecisionPointGuidance({ campaignId: campaign.campaignId,
      branchId: campaign.branchId, sourceTurnId: 'qa-current', localOnly: true });
    const step = guidance?.steps.find(s => s.availability === 'available');
    const before = await physicalCount(h);
    const started = Date.now();
    try {
      const result = await session.playTurn({ campaignId: campaign.campaignId, branchId: campaign.branchId,
        intent: step ? step.firstStepIntent : '观察周围的情况',
        ...(step ? { guidanceChoice: { decisionPoint: guidance.decisionPoint, candidateRef: step.candidateRef } } : {}) });
      const physical = await physicalCount(h) - before;
      committed += 1;
      console.log(`[turn ${committed}] grade=${result.grade} ${Date.now() - started}ms physical=${physical} text="${String(result.text).slice(0, 40)}…"`);
      log({ kind: 'turn', index: committed, turnId: result.turnId, grade: result.grade, ms: Date.now() - started, physical });
    } catch (error) {
      console.log(`[turn ${committed}] FAILED: ${(error instanceof Error ? error.message : String(error)).slice(0, 100)}`);
      log({ kind: 'turn_failed', index: committed, error: String(error).slice(0, 200) });
      break;
    }
  }
  return committed;
}

async function waitForBackgroundPreparation(h, profile, campaign, timeoutMs) {
  const session = makeSession(h, profile);
  const started = Date.now();
  let lastPlanId = null;
  while (Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 20_000));
    const rows = await h.adapter.queryAll(
      "SELECT job_id,status,last_error FROM campaign_plan_jobs WHERE campaign_id=? ORDER BY created_at DESC LIMIT 3", [campaign.campaignId]);
    const ready = rows.find(r => r.status === 'candidate_ready' || r.status === 'adopted');
    console.log(`[background] ${Math.round((Date.now() - started) / 1000)}s: ${rows.map(r => r.status).join(',')}`);
    if (ready) { lastPlanId = ready.job_id; break; }
    if (rows.some(r => r.status === 'retryable_failed' || r.status === 'invalid')) break;
  }
  if (lastPlanId) { console.log(`[background] successor plan ready: ${lastPlanId}`); log({ kind: 'background_ready', jobId: lastPlanId }); }
  else log({ kind: 'background_pending', waitedMs: Date.now() - started });
  return lastPlanId;
}

/** W4c offline case: unreachable endpoint → planner stays local (L1), narrator degrades. */
async function playOfflineTurns(h, campaign, count) {
  const offlineProfile = profileFor('http://127.0.0.1:1/v1'); // nothing listens there
  const session = makeSession(h, offlineProfile);
  let degraded = 0;
  for (let i = 0; i < count; i += 1) {
    const guidance = await session.ensureDecisionPointGuidance({ campaignId: campaign.campaignId,
      branchId: campaign.branchId, sourceTurnId: 'qa-current', localOnly: true });
    const step = guidance?.steps.find(s => s.availability === 'available');
    const before = await physicalCount(h);
    const started = Date.now();
    const result = await session.playTurn({ campaignId: campaign.campaignId, branchId: campaign.branchId,
      intent: step ? step.firstStepIntent : '观察周围的情况',
      ...(step ? { guidanceChoice: { decisionPoint: guidance.decisionPoint, candidateRef: step.candidateRef } } : {}) });
    const physical = await physicalCount(h) - before;
    const isLocal = String(result.text).startsWith('（本地叙事）');
    if (isLocal) degraded += 1;
    console.log(`[offline ${i + 1}] grade=${result.grade} ${Date.now() - started}ms local=${isLocal} physical=${physical}`);
    log({ kind: 'offline_turn', index: i + 1, grade: result.grade, localTemplate: isLocal, physical, ms: Date.now() - started });
  }
  return degraded;
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const creds = readCredentials();
  const profile = profileFor(creds.endpoint);
  // Host transport: SSE-capable (long high-tier thinking must stream; the
  // buffered gateway cut ~300s on real GLM evidence) with the scoped budget
  // reserved before every physical dispatch and reconciled on the outcome.
  const transport = { async post(request) {
    const reservationId = budget.reservePhysicalRequest({ owner: 'host:convergence-journey',
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
  const bytes = fs.readFileSync(NOVEL_PATH);
  const h = await createMobileHarness({ bytes, dbPath: path.join(WORK, 'journey.sqlite'), transport,
    secrets: { async get() { return creds.key; } } });
  h.secrets = { async get() { return creds.key; } }; h.transport = transport;
  try {
    const world = await buildWorld(h, profile);
    const campaign = await startLocalCampaign(h, profile, world, '查清眼前事件的来龙去脉，并在镇上站稳脚跟', 'medium');
    const realTurns = await playRealTurns(h, profile, campaign, REAL_TURNS);
    log({ kind: 'summary', realTurns });
    console.log(`\n== real turns committed: ${realTurns}/${REAL_TURNS} ==`);
    const backgroundJobId = await waitForBackgroundPreparation(h, profile, campaign, 5 * 60_000);
    const offlineDegraded = await playOfflineTurns(h, campaign, 2);
    console.log(`\n== offline turns with local-template narration: ${offlineDegraded}/2 ==`);
    log({ kind: 'done', realTurns, backgroundJobId, offlineDegraded });
    console.log('\nJOURNEY COMPLETE');
  } finally {
    h.db.close();
  }
}

main().catch(error => { console.error('JOURNEY FAILED:', error instanceof Error ? error.message : String(error)); process.exit(1); });
