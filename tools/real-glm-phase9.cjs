const requireP = p => require(path.join(ROOT, p));
/**
 * Phase 9 real-GLM journey driver (P9-7, plan §16.3).
 *
 * Runs the PRODUCTION import → planning → adoption → playTurn pipeline over
 * the real GLM endpoint against the full test novel. Credentials are read
 * from the local key file into memory only — never printed, never persisted.
 *
 * Usage:
 *   node tools/real-glm-phase9.cjs smoke        # 10-decision smoke
 *   node tools/real-glm-phase9.cjs journey J1    # protection intent, ≥20 decisions
 *   node tools/real-glm-phase9.cjs journey J2    # investigation intent
 *   node tools/real-glm-phase9.cjs journey J3    # cooperation/daily intent
 *   node tools/real-glm-phase9.cjs fork          # J4 A/B from the same snapshot
 *
 * Artifacts (git-ignored): .tmp/phase9/*.jsonl, journey state, manifest budget.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const { createMobileHarness } = require(path.join(ROOT, 'tests/helpers/mobileHarness.cjs'));
const { SqliteCampaignPlanStore } = requireP('dist/infra/sqlite/sqliteCampaignPlanStore');
const { runOpeningPlanJob } = requireP('dist/application/campaignPlan/planningService');
const { adoptOpeningPlan } = requireP('dist/application/campaignPlan/adoption');
const { CampaignSession } = requireP('dist/application/campaign/session');
const { OpenAICompatibleProvider } = requireP('dist/application/llm/openAICompatible');
const { LedgeredProvider } = requireP('dist/application/llm/requestLedger');
const { RateScheduledProvider } = requireP('dist/application/llm/scheduledProvider');
const { GlobalRateScheduler, endpointBucketId } = requireP('dist/application/worldBuild/rateScheduler');
const { SqliteLlmLedgerStore } = requireP('dist/infra/sqlite/sqliteLlmLedgerStore');
const { MemorySecretStore } = requireP('dist/application/llm/memorySecretStore');
const { llmModelProfileFingerprint } = requireP('dist/application/llm/profileFingerprint');

const KEY_FILE = 'C:/Users/Administrator/Desktop/AIstudio/Test-key/GLM-TEST.txt';
const NOVEL_PATH = 'C:/Users/Administrator/Desktop/AIstudio/放开那个女巫.txt';
const WORK = '.tmp/phase9';
const DB_PATH = path.join(WORK, 'phase9.sqlite');
const MANIFEST_PATH = path.join(WORK, 'test-manifest.json');
const BUDGET = 400;

function parseConfig() {
  const lines = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let endpoint = '', model = '', key = '';
  for (const line of lines) {
    const m = line.match(/^(endpoint|url|https|key|model|api_key)\s*[：:=]?\s*(.*)$/i);
    if (!m) continue;
    const name = m[1].toLowerCase(); const value = m[2].replace(/^[：:=]\s*/, '').trim();
    if (name === 'https' && value.startsWith('//')) { endpoint = 'https:' + value; continue; }
    if (name === 'endpoint' || name === 'url') endpoint = value;
    else if (name === 'key' || name === 'api_key') key = value;
    else if (name === 'model') model = value;
  }
  // Bare https line (no key: prefix)
  if (!endpoint) {
    const urlLine = lines.find(l => /^https?:\/\//.test(l));
    if (urlLine) endpoint = urlLine.trim();
  }
  if (!endpoint || !model || !key) throw new Error('config incomplete (endpoint/model/key)');
  if (!/\/chat\/completions$/.test(endpoint) && !/\/paas\/v4$/.test(endpoint)) {
    // normalize base endpoint
  }
  return { endpoint: endpoint.replace(/\/+$/, ''), model, key };
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

async function countPhysicalRequests(adapter) {
  const rows = await adapter.queryAll('SELECT COUNT(*) AS n FROM llm_request_attempts');
  return Number(rows[0]?.n ?? 0);
}

function sha(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

const JOURNEYS = {
  J1: {
    label: '保护/救援',
    intent: '保护一个在当前局面中受到威胁的人，查明威胁来源并让他们安全',
    prefer: ['保护', '守护', '护卫', '救', '护送', '拦', '挡', '警告', '守夜'],
    avoid: [],
    length: 'short',
  },
  J2: {
    label: '调查',
    intent: '调查这个世界里已出现的一个异常或冲突，收集证据并查明真相',
    prefer: ['调查', '查看', '检查', '线索', '观察', '搜', '查', '证据', '询问', '打听'],
    avoid: [],
    length: 'short',
  },
  J3: {
    label: '合作/日常建设',
    intent: '与当地人建立合作，推进一件符合这个世界日常的建设性事情',
    prefer: ['交谈', '帮助', '合作', '打听', '帮忙', '协助', '一起', '准备', '修', '整理'],
    avoid: [],
    length: 'short',
  },
};

function paraphrase(intent, index) {
  const openers = ['我想', '我打算', '试着', '接下来'];
  const closers = ['', '，尽量稳妥一些', '，先看看情况', '，别太冒险'];
  if (index % 3 === 0) return intent; // exact tap text every third decision
  const opener = openers[index % openers.length];
  const closer = closers[(index >> 1) % closers.length];
  return `${opener}${intent}${closer}`;
}

function pickStep(guidance, journey, decisionIndex) {
  if (!guidance || guidance.steps.length === 0) return null;
  const available = guidance.steps.filter(step => step.availability === 'available');
  if (available.length === 0) return null;
  const preferred = available.filter(step =>
    journey.prefer.some(keyword => step.title.includes(keyword) || step.firstStepIntent.includes(keyword)));
  const pool = preferred.length > 0 ? preferred : available;
  return pool[decisionIndex % pool.length];
}

function logLine(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
}

async function buildWorld(h, profile) {
  const manifest = loadManifest();
  const worldFile = path.join(WORK, 'world.json');
  if (fs.existsSync(worldFile)) {
    const saved = JSON.parse(fs.readFileSync(worldFile, 'utf8'));
    const revision = await h.runtime.worldStore.getPublishedPackageRevision(saved.worldId);
    if (revision) {
      console.log(`[world] reused ${saved.worldId} r${revision}`);
      return { worldId: saved.worldId, revision };
    }
  }
  // Resume an interrupted import from a previous driver run (the DB is durable).
  const staleRuns = await h.adapter.queryAll("SELECT run_id, world_id FROM world_build_runs WHERE status NOT IN ('completed','canceled','failed_terminal') ORDER BY created_at");
  for (const row of staleRuns) {
    const revision0 = await h.runtime.worldStore.getPublishedPackageRevision(row.world_id);
    if (revision0) {
      fs.writeFileSync(path.join(WORK, 'world.json'), JSON.stringify({ worldId: row.world_id, revision: revision0 }));
      console.log(`[world] reused ${row.world_id} r${revision0}`);
      return { worldId: row.world_id, revision: revision0 };
    }
    console.log(`[world] resuming stale run ${row.run_id}`);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await h.sourceImport.requestSegmentRunControl(row.run_id, 'resume');
      const result = await h.sourceImport.runExtraction(row.run_id, profile, () => {});
      if (result.completed) break;
      const issues = await h.runtime.worldStore.listReviewIssues(row.world_id, 'open');
      for (const issue of issues) {
        if (issue.kind === 'canon_conflict') {
          const detail = JSON.parse(issue.detailJson ?? '{}');
          for (const factId of detail.factIds ?? []) {
            await h.runtime.worldStore.resolveCanonFactConflict(row.world_id, factId, 'complementary');
          }
        }
        await h.runtime.worldStore.resolveReviewIssue(row.world_id, issue.issueId, 'resolved', true);
      }
      if (issues.length === 0) {
        const statuses = await h.adapter.queryAll('SELECT status, last_error_code FROM world_build_runs WHERE run_id=?', [row.run_id]);
        console.log('[world] run not completing; run state:', JSON.stringify(statuses));
        break;
      }
      console.log(`[world] resolved ${issues.length} review issue(s)`);
    }
    const revisionAfter = await h.runtime.worldStore.getPublishedPackageRevision(row.world_id);
    if (revisionAfter) {
      fs.writeFileSync(path.join(WORK, 'world.json'), JSON.stringify({ worldId: row.world_id, revision: revisionAfter }));
      console.log(`[world] resumed ${row.world_id} r${revisionAfter}`);
      return { worldId: row.world_id, revision: revisionAfter };
    }
  }  console.log('[world] importing full novel through the production progressive pipeline…');
  const before = await countPhysicalRequests(h.adapter);
  const imported = await h.sourceImport.importNovelUnified('memory://novel', path.basename(NOVEL_PATH), profile, 'progressive', progress => {
    if (progress.message) process.stdout.write(`\r[import] ${progress.message.slice(0, 60).padEnd(60)}`);
  });
  process.stdout.write('\n');
  // Real novels hit the canon-conflict review gate; resolve each conflict
  // through the PRODUCTION resolution API (a real user action), then retry.
  for (const runId of imported.runIds) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await h.sourceImport.requestSegmentRunControl(runId, 'resume');
      const result = await h.sourceImport.runExtraction(runId, profile, () => {});
      if (result.completed) break;
      const issues = await h.runtime.worldStore.listReviewIssues(imported.worldId, 'open');
      if (issues.length === 0) throw new Error(`run ${runId} blocked without open review issues: `
        + JSON.stringify(issues.map(issue => [issue.issueId, issue.kind])));
      for (const issue of issues) {
        if (issue.kind === 'canon_conflict') {
          const detail = JSON.parse(issue.detailJson ?? '{}');
          for (const factId of detail.factIds ?? []) {
            await h.runtime.worldStore.resolveCanonFactConflict(imported.worldId, factId, 'complementary');
          }
        }
        await h.runtime.worldStore.resolveReviewIssue(imported.worldId, issue.issueId, 'resolved', true);
      }
      console.log(`[world] resolved ${issues.length} review issue(s), retrying run`);
      await h.sourceImport.requestSegmentRunControl(runId, 'resume');
    }
  }
  const revision = await h.runtime.worldStore.getPublishedPackageRevision(imported.worldId);
  if (!revision) throw new Error('progressive import did not publish a package');
  const after = await countPhysicalRequests(h.adapter);
  const spent = after - before;
  manifest.budget.spent += spent;
  saveManifest(manifest);
  console.log(`[world] ${imported.worldId} r${revision} published (physical requests: ${spent})`);
  fs.writeFileSync(worldFile, JSON.stringify({ worldId: imported.worldId, revision }));
  return { worldId: imported.worldId, revision };
}

async function planAndAdopt(h, profile, world, journeyId, journey, anchorInput) {
  const planStore = new SqliteCampaignPlanStore(h.adapter);
  const setupId = `setup-${journeyId.toLowerCase()}-${Date.now().toString(36)}`;
  const intent = {
    schemaVersion: 'campaign-intent-1', setupId, intentRevision: 1,
    rawIntent: journey.intent, normalizedIntent: journey.intent, goalMode: 'declared',
    protagonistBinding: { actorId: 'actor-player', kind: 'original', name: '旅人' },
    openingAnchor: anchorInput.anchor,
    companionBindings: [], lengthPreference: journey.length,
    userConstraints: [], requestedCanonTargets: [], knowledgePolicy: 'anchor_projection',
    sourceCoverageBinding: {
      worldId: world.worldId, packageRevision: world.revision,
      coverageWorldTimeOrder: anchorInput.anchor.worldTimeOrder,
      packageContentHash: (await h.runtime.worldStore.getWorldPackage(world.worldId, world.revision)).manifest.contentHash,
    },
    createdAt: new Date().toISOString(),
  };
  await planStore.upsertSetup({
    setupId, worldId: world.worldId, packageRevision: world.revision,
    intent, intentHistory: [intent], currentCandidateId: null, status: 'planning',
    createdAt: intent.createdAt, updatedAt: intent.createdAt,
  });
  const jobId = `job-${setupId}`;
  await planStore.insertJob({
    jobId, setupId, campaignId: null, branchId: null, jobKind: 'opening_plan',
    triggerReasons: ['user_requested'], baseStateVersion: null, basePlanId: null, basePlanRevision: null,
    intentHash: sha(journey.intent), contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
    status: 'queued', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 0,
    nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null,
    createdAt: intent.createdAt, updatedAt: intent.createdAt,
  });
  const ledger = new SqliteLlmLedgerStore(h.adapter);
  const inner = new OpenAICompatibleProvider(profile, h.secrets, h.transport, 300_000);
  const provider = new RateScheduledProvider(
    new LedgeredProvider(inner, ledger, { modelProfileFingerprint: llmModelProfileFingerprint(profile) }),
    new GlobalRateScheduler({ maxConcurrent: 2, endpointBucketId: endpointBucketId(profile.endpoint) }));
  const before = await countPhysicalRequests(h.adapter);
  const started = Date.now();
  const run = await runOpeningPlanJob({
    db: h.adapter, planStore, worldStore: h.runtime.worldStore, provider, profile,
  }, jobId, {
    anchorTitle: anchorInput.anchorTitle, playerName: '旅人',
    protagonistSkills: anchorInput.skills, openingGoalSuggestions: [],
  });
  const after = await countPhysicalRequests(h.adapter);
  const manifest = loadManifest();
  manifest.budget.spent += after - before;
  saveManifest(manifest);
  if (run.status !== 'candidate_ready') {
    throw new Error(`planning failed: ${run.status} ${run.errors.slice(0, 3).join('; ')}`);
  }
  const planMs = Date.now() - started;
  const campaignId = `camp-${journeyId.toLowerCase()}-${Date.now().toString(36)}`;
  const adopted = await adoptOpeningPlan({
    db: h.adapter, planStore, setupId, candidateId: run.candidateId,
    create: {
      db: h.adapter, worldStore: h.runtime.worldStore, campaignId,
      title: `${journeyId} · ${journey.label}`,
      worldId: world.worldId, packageRevision: world.revision,
      anchor: anchorInput.anchor,
      protagonist: {
        actorId: 'actor-player', kind: 'original', name: '旅人',
        attributes: { physique: 2, agility: 1, insight: 1, knowledge: 1, willpower: 1, social: 1 },
        initialSkills: anchorInput.skills,
      },
      goal: journey.intent, createdAt: new Date().toISOString(),
    },
  });
  return { campaignId, branchId: adopted.campaign.branchId, planMs, physical: after - before,
    plan: adopted.campaign.snapshot.campaignRuntime };
}

async function pickAnchor(h, world) {
  const session = await makeSession(h, stubProfileFor());
  const setup = await session.getWorldSetup(world.worldId);
  const firstAnchor = setup.anchorEvents[0];
  return {
    anchor: {
      worldTimeOrder: firstAnchor?.worldTimeOrder ?? 1,
      ...(firstAnchor?.eventId ? { anchorEventId: firstAnchor.eventId } : {}),
      locationId: setup.locations[0] ?? '',
    },
    anchorTitle: firstAnchor ? `序${firstAnchor.worldTimeOrder} · ${firstAnchor.title}` : '时间原点',
    skills: setup.skills.slice(0, 3).map(skill => skill.entryId),
    worldSetup: setup,
  };
}

function stubProfileFor() {
  return {
    id: 'stub', name: 'stub', endpoint: 'https://stub.invalid/v1', model: 'stub', keyRef: 'stub',
    capabilities: { supportsJson: false, supportsStreaming: false, reportsUsage: false },
  };
}

async function makeSession(h, profile) {
  const ledger = new SqliteLlmLedgerStore(h.adapter);
  const inner = new OpenAICompatibleProvider(profile, h.secrets, h.transport, 300_000);
  const provider = new RateScheduledProvider(
    new LedgeredProvider(inner, ledger, { modelProfileFingerprint: llmModelProfileFingerprint(profile) }),
    new GlobalRateScheduler({ maxConcurrent: 2, endpointBucketId: endpointBucketId(profile.endpoint) }));
  return new CampaignSession({
    db: h.adapter,
    turns: h.runtime.turns ?? new (requireP('dist/infra/sqlite/sqliteTurnStore').SqliteTurnStore)(h.adapter),
    game: new (requireP('dist/infra/sqlite/sqliteGameStore').SqliteGameStore)(h.adapter),
    worldStore: h.runtime.worldStore,
    narratives: new (requireP('dist/infra/sqlite/sqliteNarrativeStore').SqliteNarrativeStore)(h.adapter),
    guidance: new (requireP('dist/infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(h.adapter),
    hashProvider: { sha256Hex: async t => sha(String(t)) },
    random: { nextIntInclusive: (min, max) => min + Math.floor(Math.random() * (max - min + 1)) },
  }, provider, profile);
}

async function playJourney(h, profile, options) {
  const { journeyId, decisions, jsonlFile } = options;
  const journey = JOURNEYS[journeyId] ?? { ...JOURNEYS.J1, ...options.journeyOverrides };
  const manifest = loadManifest();
  const worldState = JSON.parse(fs.readFileSync(path.join(WORK, 'world.json'), 'utf8'));
  const anchor = await pickAnchor(h, worldState);
  const session = await makeSession(h, profile);
  // Adoption can refuse a plan whose ending already holds at the opening
  // (honest gate). Retry with a fresh proposal instead of failing the journey.
  let planned = null;
  let lastPlanError = null;
  for (let attempt = 0; attempt < 3 && !planned; attempt += 1) {
    try {
      planned = await planAndAdopt(h, profile, worldState, journeyId, journey, anchor);
    } catch (error) {
      lastPlanError = error instanceof Error ? error.message : String(error);
      console.log(`[${journeyId}] plan attempt ${attempt + 1} refused: ${lastPlanError.slice(0, 100)}`);
    }
  }
  if (!planned) throw new Error(`planning failed after retries: ${lastPlanError}`);
  logLine(jsonlFile, {
    kind: 'plan', journeyId, campaignId: planned.campaignId, planMs: planned.planMs,
    physicalRequests: planned.physical,
    longTermGoal: 'see proposal card', primaryNode: planned.plan.primaryNodeId,
    nodeStates: planned.plan.nodeStates.map(n => [n.nodeId, n.status]),
  });
  console.log(`[${journeyId}] plan ready in ${planned.planMs}ms (${planned.physical} req) → ${planned.campaignId}`);

  let lastGuidance = null;
  let committedDecisions = 0;
  let attempts = 0;
  const errors = [];
  while (committedDecisions < decisions && attempts < decisions * 3) {
    attempts += 1;
    const manifestNow = loadManifest();
    if (manifestNow.budget.spent >= BUDGET) {
      errors.push(`budget exhausted at decision ${committedDecisions}`);
      break;
    }
    const step = pickStep(lastGuidance, journey, committedDecisions);
    const baseIntent = step ? step.firstStepIntent : (committedDecisions === 0
      ? journey.intent
      : ['观察周围的情况', '和附近的人聊聊眼前的事', '查看周围有没有值得注意的东西'][committedDecisions % 3]);
    const intent = paraphrase(baseIntent, committedDecisions);
    const before = await countPhysicalRequests(h.adapter);
    const started = Date.now();
    try {
      const result = await session.playTurn({ campaignId: planned.campaignId, branchId: planned.branchId, intent });
      const after = await countPhysicalRequests(h.adapter);
      committedDecisions += 1;
      const state = await session.getSummary(planned.campaignId, planned.branchId);
      const progress = await session.getCampaignProgress(planned.campaignId, planned.branchId);
      logLine(jsonlFile, {
        kind: 'decision', journeyId, decision: committedDecisions, turnId: result.turnId,
        intent, stepRef: step?.candidateRef ?? null, stepTitle: step?.title ?? null,
        grade: result.grade, stateVersion: result.stateVersion, ms: Date.now() - started,
        physicalRequests: after - before,
        campaignEvents: (await h.adapter.queryAll(
          'SELECT event_type, payload_json FROM branch_events WHERE branch_id=? AND event_seq>(SELECT COALESCE(MAX(x.event_seq),0)-8 FROM branch_events x WHERE x.branch_id=?) ORDER BY event_seq',
          [planned.branchId, planned.branchId])).map(row => row.event_type),
        runtimeStatus: state.state.campaignRuntime?.campaignStatus,
        primaryNode: state.state.campaignRuntime?.primaryNodeId,
        nodeStates: state.state.campaignRuntime?.nodeStates.map(n => [n.nodeId, n.status]),
        progressLines: progress?.recentProgress?.slice(-2) ?? [],
        narrativePreview: (result.text ?? '').slice(0, 80),
      });
      manifestNow.budget.spent = after;
      saveManifest(manifestNow);
      lastGuidance = result.guidance ?? lastGuidance;
      process.stdout.write(`[${journeyId}] decision ${committedDecisions}/${decisions} ${result.grade} ${(Date.now() - started) / 1000 | 0}s (req ${after - before})\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`decision ${committedDecisions + 1}: ${message.slice(0, 200)}`);
      logLine(jsonlFile, { kind: 'error', journeyId, decision: committedDecisions + 1, intent, message: message.slice(0, 300) });
      process.stdout.write(`[${journeyId}] ERROR at decision ${committedDecisions + 1}: ${message.slice(0, 120)}\n`);
      // A rejected intent (stale path etc.) is a real outcome: try a different
      // action next attempt rather than aborting the whole journey.
      lastGuidance = null;
      if (errors.length > 8) break;
    }
  }
  const finalState = await session.getSummary(planned.campaignId, planned.branchId);
  const finalRuntime = finalState.state.campaignRuntime;
  logLine(jsonlFile, {
    kind: 'summary', journeyId, campaignId: planned.campaignId, committedDecisions, attempts,
    campaignStatus: finalRuntime?.campaignStatus,
    nodeStates: finalRuntime?.nodeStates.map(n => [n.nodeId, n.status]),
    consequences: finalRuntime?.deferredConsequences.map(c => [c.consequenceId, c.status]),
    ending: finalRuntime?.ending ?? null,
    errors,
  });
  return { committedDecisions, campaignId: planned.campaignId, branchId: planned.branchId, errors, finalRuntime };
}

async function replanProvider(h, profile) {
  const { OpenAICompatibleProvider } = requireP('dist/application/llm/openAICompatible');
  const { LedgeredProvider } = requireP('dist/application/llm/requestLedger');
  const { RateScheduledProvider } = requireP('dist/application/llm/scheduledProvider');
  const { GlobalRateScheduler, endpointBucketId } = requireP('dist/application/worldBuild/rateScheduler');
  const { SqliteLlmLedgerStore } = requireP('dist/infra/sqlite/sqliteLlmLedgerStore');
  const { llmModelProfileFingerprint } = requireP('dist/application/llm/profileFingerprint');
  const inner = new OpenAICompatibleProvider(profile, h.secrets, h.transport, 300_000);
  return new RateScheduledProvider(
    new LedgeredProvider(inner, new SqliteLlmLedgerStore(h.adapter), { modelProfileFingerprint: llmModelProfileFingerprint(profile) }),
    new GlobalRateScheduler({ maxConcurrent: 2, endpointBucketId: endpointBucketId(profile.endpoint) }));
}

async function main() {
  const command = process.argv[2] ?? 'smoke';
  fs.mkdirSync(WORK, { recursive: true });
  const config = parseConfig();
  const profile = {
    id: 'glm-phase9', name: 'GLM phase9', endpoint: config.endpoint, model: config.model, keyRef: 'glm.phase9',
    // Test-declared capabilities (recorded in the manifest; not guessed from
    // the file name): the coding-plan GLM endpoint serves 1M-class context.
    capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 1_048_576, maxOutputTokens: 32_768 },
    reasoningDialect: 'glm', reasoningTier: 'low', contentOutputTokens: 16_384, concurrency: 2,
  };
  const secrets = new MemorySecretStore();
  await secrets.set(profile.keyRef, config.key);
  const transport = { async post(request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 300_000);
    try {
      const response = await fetch(request.url, {
        method: 'POST', headers: request.headers, body: request.body, signal: controller.signal,
      });
      return { status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers.entries()) };
    } finally {
      clearTimeout(timer);
    }
  } };
  const bytes = fs.readFileSync(NOVEL_PATH);
  const h = await createMobileHarness({ bytes, dbPath: DB_PATH, transport, secrets });
  h.secrets = secrets; h.transport = transport;
  const manifest = loadManifest();
  manifest.inputs.llm.declaredCapabilities = { contextWindow: 1048576, maxOutputTokens: 32768, declaredBy: 'test manifest (ADR: not from filename)' };
  saveManifest(manifest);

  const world = await buildWorld(h, profile);
  if (command === 'smoke') {
    const result = await playJourney(h, profile, { journeyId: 'SMOKE', decisions: 10,
      jsonlFile: path.join(WORK, 'journey-smoke.jsonl'),
      journeyOverrides: JOURNEYS.J2 });
    console.log(`[smoke] committed=${result.committedDecisions} errors=${result.errors.length}`);
    h.db.close();
    return;
  }
  if (command === 'journey') {
    const journeyId = (process.argv[3] ?? 'J1').toUpperCase();
    const decisions = Number(process.argv[4] ?? 20);
    const result = await playJourney(h, profile, { journeyId, decisions,
      jsonlFile: path.join(WORK, `journey-${journeyId}.jsonl`) });
    console.log(`[${journeyId}] committed=${result.committedDecisions} errors=${result.errors.length} status=${result.finalRuntime?.campaignStatus}`);
    h.db.close();
    return;
  }
  if (command === 'fork') {
    // J4: fork the J2 campaign's stable snapshot into two branches, drive
    // different routes, and exercise the real-LLM replan chain on branch A.
    const { forkBranch } = requireP('dist/application/branch/fork');
    const { SqliteGameStore } = requireP('dist/infra/sqlite/sqliteGameStore');
    const { SqliteTurnStore } = requireP('dist/infra/sqlite/sqliteTurnStore');
    const { evaluateReplanTriggers, runReplanJob, adoptReplanCandidate } = requireP('dist/application/campaignPlan/replanService');
    const j2 = JSON.parse(fs.readFileSync(path.join(WORK, 'journey-J2.jsonl'), 'utf8').trim().split('\n').pop());
    const campaignId = j2.campaignId;
    const sourceBranch = `${campaignId}-main`;
    const turns = new SqliteTurnStore(h.adapter);
    const gameStore = new SqliteGameStore(h.adapter);
    // Fork at an early stable snapshot (min(version 4, head)).
    const head = await turns.getState(sourceBranch);
    const atVersion = Math.min(4, head.stateVersion);
    const forkA = await forkBranch({ db: h.adapter, turnStore: turns, gameStore,
      sourceBranchId: sourceBranch, targetBranchId: `${campaignId}-j4a`, campaignId, forkTurnId: null,
      ...(atVersion < head.stateVersion ? { atStateVersion: atVersion } : {}), createdAt: new Date().toISOString() });
    const forkB = await forkBranch({ db: h.adapter, turnStore: turns, gameStore,
      sourceBranchId: sourceBranch, targetBranchId: `${campaignId}-j4b`, campaignId, forkTurnId: null,
      ...(atVersion < head.stateVersion ? { atStateVersion: atVersion } : {}), createdAt: new Date().toISOString() });
    console.log(`[J4] forked at v${atVersion} → ${forkA.snapshot.branchId} / ${forkB.snapshot.branchId}`);
    const session = await makeSession(h, profile);
    const jsonlFile = path.join(WORK, 'journey-J4.jsonl');
    const runBranch = async (branchId, label, journey, goalChange) => {
      let decided = 0; let attempts = 0; let lastGuidance = null;
      while (decided < 10 && attempts < 30) {
        attempts += 1;
        const step = pickStep(lastGuidance, journey, decided);
        const baseIntent = step ? step.firstStepIntent : (decided === 0 ? journey.intent
          : ['查看周围的情况', '和附近的人聊聊眼前的事', '检查现场留下的痕迹'][decided % 3]);
        const intent = paraphrase(baseIntent, decided);
        try {
          const result = await session.playTurn({ campaignId, branchId, intent });
          decided += 1;
          lastGuidance = result.guidance ?? lastGuidance;
          const state = await turns.getState(branchId);
          logLine(jsonlFile, { kind: 'decision', journey: label, decision: decided, branchId, intent,
            grade: result.grade, primaryNode: state.campaignRuntime?.primaryNodeId,
            nodeStates: state.campaignRuntime?.nodeStates.map(n => [n.nodeId, n.status]),
            consequences: state.campaignRuntime?.deferredConsequences.map(c => [c.consequenceId, c.status]) });
          process.stdout.write(`[J4-${label}] decision ${decided}/10 ${result.grade}\n`);
          // Mid-journey goal change on branch A triggers the replan chain.
          if (goalChange && decided === 5) {
            const change = await session.changeCampaignGoal({ campaignId, branchId, newGoal: goalChange });
            console.log(`[J4-${label}] goal changed → revision ${change.intentRevision}`);
            const planStore = new SqliteCampaignPlanStore(h.adapter);
            const job = (await h.adapter.queryAll("SELECT job_id FROM campaign_plan_jobs WHERE branch_id=? AND status IN ('queued','retryable_failed') ORDER BY created_at DESC LIMIT 1", [branchId]))[0];
            if (job) {
              const run = await runReplanJob({ db: h.adapter, planStore, worldStore: h.runtime.worldStore,
                provider: await replanProvider(h, profile), profile }, job.job_id, {
                intent: { schemaVersion: 'campaign-intent-1', setupId: 'replan-j4', intentRevision: 2,
                  rawIntent: goalChange, normalizedIntent: goalChange, goalMode: 'declared',
                  protagonistBinding: { actorId: 'actor-player', kind: 'original', name: '旅人' },
                  openingAnchor: { worldTimeOrder: 1, locationId: '' }, companionBindings: [],
                  lengthPreference: 'short', userConstraints: [], requestedCanonTargets: [],
                  knowledgePolicy: 'anchor_projection',
                  sourceCoverageBinding: JSON.parse(fs.readFileSync(path.join(WORK, 'world.json'), 'utf8')),
                  createdAt: new Date().toISOString() },
                protagonistSkills: [], anchorTitle: '序1', playerName: '旅人' });
              console.log(`[J4-${label}] replan job: ${run.status} (${run.physicalRequests} req)`);
              if (run.status === 'candidate_ready') {
                const adopted = await adoptReplanCandidate({ db: h.adapter, planStore, turns,
                  campaignId, branchId, candidateId: run.candidateId });
                console.log(`[J4-${label}] replan adoption: ${adopted.outcome}`);
                logLine(jsonlFile, { kind: 'replan', journey: label, branchId, run: run.status, adoption: adopted });
              }
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logLine(jsonlFile, { kind: 'error', journey: label, decision: decided + 1, message: message.slice(0, 200) });
          lastGuidance = null;
        }
      }
      const state = await turns.getState(branchId);
      logLine(jsonlFile, { kind: 'summary', journey: label, branchId, committed: decided,
        nodeStates: state.campaignRuntime?.nodeStates.map(n => [n.nodeId, n.status]),
        consequences: state.campaignRuntime?.deferredConsequences.map(c => [c.consequenceId, c.status]),
        planRevision: state.campaignRuntime?.planBinding.revision,
        stateVersion: state.stateVersion });
      return { decided, state };
    };
    const resultA = await runBranch(`${campaignId}-j4a`, 'A', JOURNEYS.J1, '护送关键证人离开小镇，避开追捕');
    const resultB = await runBranch(`${campaignId}-j4b`, 'B', JOURNEYS.J2, null);
    console.log(`[J4] A: ${resultA.decided} decisions, plan r${resultA.state.campaignRuntime?.planBinding.revision}, v${resultA.state.stateVersion}`);
    console.log(`[J4] B: ${resultB.decided} decisions, plan r${resultB.state.campaignRuntime?.planBinding.revision}, v${resultB.state.stateVersion}`);
    const manifestFork = loadManifest();
    manifestFork.budget.spent = await countPhysicalRequests(h.adapter);
    saveManifest(manifestFork);
    h.db.close();
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

main().catch(error => {
  console.error('[fatal]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
