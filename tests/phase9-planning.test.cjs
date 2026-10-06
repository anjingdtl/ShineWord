/**
 * Phase 9 planning tests (P9-3): the production opening pipeline — setup/job,
 * ledgered campaign_plan generation with one bounded repair, local compile +
 * hard gates, atomic idempotent adoption and job recovery points. LLM is
 * faked at the transport boundary; everything else is real (SQLite, world
 * build pipeline, stores, campaign creation).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileHarness, sha } = require('./helpers/mobileHarness.cjs');

const { SqliteCampaignPlanStore } = require('../dist/infra/sqlite/sqliteCampaignPlanStore');
const { runOpeningPlanJob } = require('../dist/application/campaignPlan/planningService');
const { adoptOpeningPlan } = require('../dist/application/campaignPlan/adoption');
const { campaignSituationEntries, resolveCampaignContent } = require('../dist/application/campaignPlan/contentResolver');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
const { LedgeredProvider } = require('../dist/application/llm/requestLedger');
const { RateScheduledProvider } = require('../dist/application/llm/scheduledProvider');
const { GlobalRateScheduler } = require('../dist/application/worldBuild/rateScheduler');
const { MemorySecretStore } = require('../dist/application/llm/memorySecretStore');
const { llmModelProfileFingerprint } = require('../dist/application/llm/profileFingerprint');
const { firstSituationEntryId } = require('../dist/application/campaignPlan/localCompile');

const PROFILE = { id: 'test', name: 'Test', endpoint: 'https://test.invalid/v1', model: 'glm-test', keyRef: 'memory',
  capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 65_536, maxOutputTokens: 24_576 },
  reasoningDialect: 'glm', reasoningTier: 'low', contentOutputTokens: 12_000, concurrency: 1 };
const TEXT = '第一章 街口\n林凡站在青石巷，手持铜钥，身属青岚会，懂得听风术，遵守入夜禁行的规矩。苏轻语站在他身旁。';
const NOW = '2026-10-06T00:00:00.000Z';

function candidateModel() {
  return {
    modelVersion: 'campaign-plan-model-1',
    proposal: {
      title: '青石巷的威胁', longTermGoal: '查明并解除青石巷的隐患',
      publicPitch: '一条以调查和保护为核心的短冒险：入夜禁行之下，巷子里的平静正在被打破。',
      gmPremise: '幕后是青岚会内部的一次私运，只有在现场证据面前才会暴露。',
      tone: '写实',
    },
    stages: [
      {
        nodeId: 'stage-1', role: 'main', title: '查明隐患', publicObjective: '弄清青石巷里发生了什么',
        gmPurpose: '让玩家在现场找到第一批证据，建立对局势的基本判断。',
        coverage: 'concrete', activation: null,
        completion: { kind: 'situation_resolved', situationId: 'self' },
        failure: null, cancellation: null, dependsOn: [], alternatives: [], next: ['stage-2'],
        provenance: { kind: 'design_fill', rationale: 'opening stage' },
      },
      {
        nodeId: 'stage-2', role: 'main', title: '解除威胁', publicObjective: '在事情失控前解决隐患',
        gmPurpose: 'gm purpose for stage two',
        coverage: 'provisional',
        activation: { kind: 'node_succeeded', nodeId: 'stage-1' },
        completion: { kind: 'committed_event', eventType: 'quest_succeeded' },
        failure: null, cancellation: null, dependsOn: ['stage-1'], alternatives: [], next: [],
        provenance: { kind: 'design_fill', rationale: 'later stage' },
      },
    ],
    endings: [
      { endingId: 'end-safe', title: '巷子重归平静', publicDescription: '威胁被解除。', outcomeKind: 'success',
        condition: { kind: 'node_succeeded', nodeId: 'stage-2' } },
    ],
    firstSituation: {
      situationTitle: '入夜前的青石巷', summary: '入夜禁行将近，青石巷里的动静不太对劲，值得弄清并介入。',
      gmBrief: '证据藏在现场：货箱与脚印。', pressureDescription: '夜幕降临前局势会变化。',
      deadlineClockSeconds: 3600,
      signs: [{ text: '现场留有尚未查明的细节' }],
      methods: [
        {
          methodId: 'sweep', title: '查看现场', goal: '弄清巷子里的异常',
          firstStep: { intent: '仔细查看青石巷现场，寻找值得注意的细节与线索', actionKind: 'observe' },
          requires: {}, tradeoffs: '花费时间', preparation: '无',
          outcomes: {
            full_success: { resultFact: '你把现场看得一清二楚，找到了关键细节。', effects: [{ template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 2 }, { template: 'record_event', eventType: 'scene_swept', summary: '现场被彻底检查' }] },
            success: { resultFact: '你确认了异常的大致来源。', effects: [{ template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1 }] },
            failure: { resultFact: '你没有看出额外的线索。', effects: [] },
            severe_failure: { resultFact: '你打翻了货箱，惊动了旁人。', effects: [{ template: 'record_event', eventType: 'alert_raised', summary: '动静引起了注意' }] },
          },
        },
        {
          methodId: 'ask-lin', title: '找林凡打听', goal: '从知情人处了解情况',
          firstStep: { intent: '向林凡打听青石巷最近的情况', actionKind: 'talk' },
          requires: {}, tradeoffs: '对方不一定愿意多说', preparation: '无',
          outcomes: {
            full_success: { resultFact: '林凡把知道的全告诉了你。', effects: [{ template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 2 }, { template: 'schedule_consequence', consequenceId: 'lin-favor' }] },
            success: { resultFact: '林凡透露了一点有用的信息。', effects: [{ template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1 }, { template: 'schedule_consequence', consequenceId: 'lin-favor' }] },
            failure: { resultFact: '林凡摇了摇头，不愿多说。', effects: [] },
            severe_failure: { resultFact: '你的追问让林凡起了疑心。', effects: [{ template: 'relationship_shift', fromActorId: 'npc-tpl-lin', toActorId: 'pc', delta: -1 }] },
          },
        },
      ],
    },
    consequences: [
      { consequenceId: 'lin-favor', description: '林凡稍后会请你帮他一个小忙', visibility: 'public',
        trigger: { kind: 'situation_resolved', situationId: 'self' },
        effects: [{ template: 'relationship_shift', fromActorId: 'npc-tpl-lin', toActorId: 'pc', delta: 1 }] },
    ],
    rewards: [
      { policyId: 'rp-1', nodeId: 'stage-1', description: '现场经验与林凡的信任',
        rewards: [{ kind: 'relationship', targetId: 'npc-tpl-lin', toActorId: 'pc', delta: 1 }] },
    ],
  };
}

function planningProvider(planResponses, ledgerStore) {
  const transport = {
    async post(request) {
      const body = JSON.parse(request.body);
      if (body.messages[0].content.includes('战役主线策划')) {
        const next = planResponses.shift() ?? { content: JSON.stringify(candidateModel()) };
        return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: next.content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } }) };
      }
      throw new Error('Unexpected pipeline request');
    },
  };
  const secrets = new MemorySecretStore();
  secrets.set(PROFILE.keyRef, 'test-memory-key');
  const inner = new OpenAICompatibleProvider(PROFILE, secrets, transport, 30_000);
  const scheduler = new GlobalRateScheduler({ maxConcurrent: 2, endpointBucketId: require('../dist/application/worldBuild/rateScheduler').endpointBucketId(PROFILE.endpoint) });
  const ledger = new LedgeredProvider(inner, ledgerStore, { modelProfileFingerprint: llmModelProfileFingerprint(PROFILE) });
  return new RateScheduledProvider(ledger, scheduler);
}

async function builtWorld() {
  const h = await createMobileHarness({ bytes: Buffer.from(TEXT), transport: {
    async post(request) {
      const body = JSON.parse(request.body);
      let output;
      if (body.messages[0].content.includes('WorldMapper')) {
        output = { skills: [], constraints: [], actorTemplates: [], items: [], lore: [], ruleMappings: [] };
      } else if (body.messages[0].content.includes('Extractor')) {
        const entities = [['lin', 'character', '林凡'], ['alley', 'location', '青石巷'], ['key', 'item', '铜钥'],
          ['guild', 'faction', '青岚会'], ['wind', 'ability', '听风术'], ['rule', 'rule', '入夜禁行']]
          .map(([key, type, name]) => ({ key, type, name, aliases: [] }));
        output = { entities, facts: entities.filter(e => e.type !== 'location').map(e => ({ subject: e.key,
          predicate: e.type === 'character' ? 'current_location' : 'named',
          value: e.type === 'character' ? { location: '青石巷' } : { name: e.name }, status: 'explicit', confidence: 1, segment: 1, quote: '林凡站在青石巷' })), events: [], ruleMappings: [] };
      } else if (body.messages[0].content.includes('Timeline')) {
        output = { events: [] };
      } else {
        throw new Error('Unexpected pipeline request');
      }
      return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } }) };
    },
  } });
  const imported = await h.sourceImport.importNovelUnified('memory://synthetic', 'opening.txt', PROFILE, 'full', () => {});
  for (const id of imported.runIds) await h.sourceImport.runExtraction(id, PROFILE, () => {});
  const revision = await h.runtime.worldStore.getPublishedPackageRevision(imported.worldId);
  return { ...h, imported, revision };
}

async function seedSetup(h, overrides = {}) {
  const planStore = new SqliteCampaignPlanStore(h.adapter);
  const intent = {
    schemaVersion: 'campaign-intent-1', setupId: 'setup-p1', intentRevision: 1,
    rawIntent: '保护青石巷的居民', normalizedIntent: '查明并解除青石巷的隐患', goalMode: 'declared',
    protagonistBinding: { actorId: 'pc', kind: 'original', name: '旅人' },
    openingAnchor: { worldTimeOrder: 0, locationId: '青石巷' },
    companionBindings: [], lengthPreference: 'short', userConstraints: [], requestedCanonTargets: [],
    knowledgePolicy: 'anchor_projection',
    sourceCoverageBinding: { worldId: h.imported.worldId, packageRevision: h.revision, coverageWorldTimeOrder: 0, packageContentHash: 'h'.repeat(64) },
    createdAt: NOW,
    ...overrides,
  };
  await planStore.upsertSetup({ setupId: intent.setupId, worldId: h.imported.worldId, packageRevision: h.revision,
    intent, intentHistory: [intent], currentCandidateId: null, status: 'planning', createdAt: NOW, updatedAt: NOW });
  await planStore.insertJob({
    jobId: 'job-p1', setupId: intent.setupId, campaignId: null, branchId: null, jobKind: 'opening_plan',
    triggerReasons: ['user_requested'], baseStateVersion: null, basePlanId: null, basePlanRevision: null,
    intentHash: 'i'.repeat(64), contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
    status: 'queued', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 0,
    nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null, createdAt: NOW, updatedAt: NOW,
  });
  return { planStore, intent };
}

test('P9-3: opening pipeline generates, compiles and adopts a real playable plan (fake transport)', async () => {
  const h = await builtWorld();
  try {
    const { planStore } = await seedSetup(h);
    const provider = planningProvider([], new (require('../dist/infra/sqlite/sqliteLlmLedgerStore').SqliteLlmLedgerStore)(h.adapter));
    const run = await runOpeningPlanJob({
      db: h.adapter, planStore, worldStore: h.runtime.worldStore, provider, profile: PROFILE, now: () => NOW,
    }, 'job-p1', { anchorTitle: '第一章 街口', playerName: '旅人', protagonistSkills: [], openingGoalSuggestions: [] });
    assert.equal(run.status, 'candidate_ready', JSON.stringify(run.errors).slice(0, 600));
    assert.equal(run.physicalRequests, 1, 'first valid response spends one request');
    const candidate = await planStore.getCandidate(run.candidateId);
    assert.equal(candidate.stage, 'ready');
    assert.ok(candidate.plan.nodes.length >= 2);
    assert.equal(candidate.plan.startNodeIds.includes('stage-1'), true);
    const situation = candidate.artifact.situations[0];
    assert.equal(situation.entryId, firstSituationEntryId());
    assert.ok(situation.definition.methods.length >= 2, 'two mechanically different routes');
    assert.ok(situation.definition.methods.every(method => method.outcomeTemplates
      && Object.keys(method.outcomeTemplates).length === 4), 'four-grade templates compiled');

    // Adopt: single transaction, idempotent double-click.
    const adopted = await adoptOpeningPlan({
      db: h.adapter, planStore, setupId: 'setup-p1', candidateId: run.candidateId,
      create: {
        db: h.adapter, worldStore: h.runtime.worldStore, campaignId: 'camp-p1', title: '青石巷的威胁',
        worldId: h.imported.worldId, packageRevision: h.revision,
        anchor: { worldTimeOrder: 0, locationId: '青石巷' },
        protagonist: { actorId: 'pc', kind: 'original', name: '旅人', attributes: { physique: 2, agility: 1, knowledge: 1, insight: 1, willpower: 1, social: 1 }, initialSkills: [] },
        goal: '查明并解除青石巷的隐患', createdAt: NOW,
      },
    });
    assert.equal(adopted.outcome, 'created');
    const runtime = adopted.campaign.snapshot.campaignRuntime;
    assert.ok(runtime, 'runtime written in the creation transaction');
    assert.equal(runtime.planBinding.planId, candidate.plan.planId);
    assert.equal(runtime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'active', 'adoption pass activates the start node');
    const replay = await adoptOpeningPlan({
      db: h.adapter, planStore, setupId: 'setup-p1', candidateId: run.candidateId,
      create: {
        db: h.adapter, worldStore: h.runtime.worldStore, campaignId: 'camp-p1', title: '青石巷的威胁',
        worldId: h.imported.worldId, packageRevision: h.revision,
        anchor: { worldTimeOrder: 0, locationId: '青石巷' },
        protagonist: { actorId: 'pc', kind: 'original', name: '旅人', attributes: { physique: 2, agility: 1, knowledge: 1, insight: 1, willpower: 1, social: 1 }, initialSkills: [] },
        goal: 'x', createdAt: NOW,
      },
    });
    assert.equal(replay.outcome, 'already_exists', 'double start is idempotent (A09)');
    assert.equal(replay.campaign.campaignId, 'camp-p1');

    // Recovery: re-running the job reuses the durable ready candidate, zero HTTP.
    const again = await runOpeningPlanJob({
      db: h.adapter, planStore, worldStore: h.runtime.worldStore, provider: planningProvider([{ content: 'GARBAGE' }], new (require('../dist/infra/sqlite/sqliteLlmLedgerStore').SqliteLlmLedgerStore)(h.adapter)), profile: PROFILE, now: () => NOW,
    }, 'job-p1', { anchorTitle: 'x', playerName: '旅人', protagonistSkills: [], openingGoalSuggestions: [] });
    assert.equal(again.status, 'already_ready');
    assert.equal(again.physicalRequests, 0, 'durable candidate reused without re-dispatch (A29)');

    // Content resolution: campaign situations compose with world entries.
    const worldEntries = (await h.runtime.worldStore.getWorldPackage(h.imported.worldId, h.revision)).entries;
    const artifact = await planStore.getArtifact(candidate.artifact.artifactId);
    const merged = resolveCampaignContent(worldEntries, [artifact]);
    assert.ok(merged.some(entry => entry.entryId === firstSituationEntryId()), 'campaign situation resolved through the unified resolver');
    assert.ok(campaignSituationEntries(artifact).every(entry => entry.provenance.kind === 'design_fill'), 'campaign content never claims canon provenance');
  } finally {
    h.db.close();
  }
});

test('P9-3: invalid JSON repairs once within two physical requests, then fails honestly', async () => {
  const h = await builtWorld();
  try {
    const { planStore } = await seedSetup(h);
    const provider = planningProvider([
      { content: '{"proposal": {"longTermGoal": "truncated' }, // form-like invalid JSON
      { content: '{"stages": "still wrong"}' }, // schema-invalid repair
    ], new (require('../dist/infra/sqlite/sqliteLlmLedgerStore').SqliteLlmLedgerStore)(h.adapter));
    const run = await runOpeningPlanJob({
      db: h.adapter, planStore, worldStore: h.runtime.worldStore, provider, profile: PROFILE, now: () => NOW,
    }, 'job-p1', { anchorTitle: 'x', playerName: '旅人', protagonistSkills: [], openingGoalSuggestions: [] });
    assert.equal(run.status, 'invalid');
    assert.equal(run.physicalRequests, 2, 'generation + one bounded repair, no hidden retries (A27/T06)');
    const job = await planStore.getJob('job-p1');
    assert.equal(job.status, 'invalid');
    assert.ok(job.lastError.length > 0, 'diagnosable failure persisted');
    assert.equal((await planStore.getSetup('setup-p1')).status, 'failed');
  } finally {
    h.db.close();
  }
});

test('P9-3: intent edit invalidates a ready proposal before adoption', async () => {
  const h = await builtWorld();
  try {
    const { planStore, intent } = await seedSetup(h);
    const provider = planningProvider([], new (require('../dist/infra/sqlite/sqliteLlmLedgerStore').SqliteLlmLedgerStore)(h.adapter));
    const run = await runOpeningPlanJob({
      db: h.adapter, planStore, worldStore: h.runtime.worldStore, provider, profile: PROFILE, now: () => NOW,
    }, 'job-p1', { anchorTitle: 'x', playerName: '旅人', protagonistSkills: [], openingGoalSuggestions: [] });
    assert.equal(run.status, 'candidate_ready', JSON.stringify(run.errors).slice(0, 600));
    // User edits the intent: old candidate must be invalidated.
    const edited = { ...intent, intentRevision: 2, normalizedIntent: '换一个目标：查明真相' };
    await planStore.upsertSetup({ setupId: 'setup-p1', worldId: h.imported.worldId, packageRevision: h.revision,
      intent: edited, intentHistory: [intent, edited], currentCandidateId: null, status: 'planning', createdAt: NOW, updatedAt: NOW });
    assert.equal(await planStore.invalidateSetupCandidate('setup-p1', NOW), false, 'status already planning');
    await assert.rejects(() => adoptOpeningPlan({
      db: h.adapter, planStore, setupId: 'setup-p1', candidateId: run.candidateId,
      create: { db: h.adapter, worldStore: h.runtime.worldStore, campaignId: 'c2', title: 't', worldId: h.imported.worldId,
        packageRevision: h.revision, anchor: { worldTimeOrder: 0, locationId: '青石巷' },
        protagonist: { actorId: 'pc', kind: 'original', name: '旅人', attributes: { physique: 2, agility: 1, knowledge: 1, insight: 1, willpower: 1, social: 1 }, initialSkills: [] }, goal: 'x', createdAt: NOW },
    }), /no longer current/, 'stale proposal cannot start a campaign (A13)');
  } finally {
    h.db.close();
  }
});
