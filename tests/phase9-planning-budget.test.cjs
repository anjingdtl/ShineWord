const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { runOpeningPlanJob } = require('../dist/application/campaignPlan/planningService');
const { runReplanJob } = require('../dist/application/campaignPlan/replanService');
const { CampaignSession } = require('../dist/application/campaign/session');
const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');
const { OpenAICompatibleProvider, HttpRequestTimeoutError } = require('../dist/application/llm/openAICompatible');
const { LedgeredProvider } = require('../dist/application/llm/requestLedger');
const { RateScheduledProvider } = require('../dist/application/llm/scheduledProvider');
const { GlobalRateScheduler, endpointBucketId } = require('../dist/application/worldBuild/rateScheduler');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { generateCampaignPlanCandidate } = require('../dist/application/campaignPlan/generationService');
const { estimateFinalWireInput } = require('../dist/application/llm/finalWireVerifier');
const { deriveSafetyMargin } = require('../dist/application/context/modelEnvelope');
const { llmModelProfileFingerprint } = require('../dist/application/llm/profileFingerprint');
const { previewCampaignPlanUnknownReplay, confirmCampaignPlanUnknownReplay } = require('../dist/application/campaignPlan/unknownReplayRecovery');
const { adoptOpeningPlan } = require('../dist/application/campaignPlan/adoption');
const { exportSave } = require('../dist/application/export/saveFile');
const profile = { id: 'budget', name: 'Budget', endpoint: 'https://example.invalid/v1', model: 'glm-5.3-flash', keyRef: 'test', reasoningTier: 'high',
  capabilities: { contextWindow: 1048576, maxOutputTokens: 32768, supportsJson: true, supportsStreaming: false }, contentOutputTokens: 16384 };
const largeProfile = { ...profile, capabilities: { ...profile.capabilities, maxOutputTokens: 65536 } };
async function seedUsage(store, id, tokens, failureClass) {
  const attempt = await store.beginAttempt({ logicalRequestId: id, requestKind: 'campaign_plan', modelProfileFingerprint: 'budget', reasoningTier: 'high' }, 1);
  await store.updateAttempt(attempt.attemptId, { status: failureClass ? 'failed' : 'succeeded', failureClass: failureClass ?? null,
    reasoningTokens: tokens, estimatedUsage: 0 });
}
async function setup(h, id, responses, onResponse = () => {}, runProfile = profile, profileFingerprint = 'budget') {
  const base = await h.planStore.getSetup('setup-t'), intent = { ...base.intent, setupId: id };
  await h.planStore.upsertSetup({ ...base, setupId: id, intent, currentCandidateId: null, status: 'planning' });
  await h.planStore.insertJob({ ...await h.planStore.getJob('job-t'), jobId: id, setupId: id, status: 'queued',
    intentHash: sha256HexOf(canonicalJsonOf(intent)), leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, freezeRootId: null });
  const wires = [], store = new SqliteLlmLedgerStore(h.adapter);
  const inner = new OpenAICompatibleProvider(runProfile, { async get() { return 'test-only'; } }, { async post(request) {
    wires.push(JSON.parse(request.body)); const next = responses[wires.length - 1];
    if (!next) throw Error('Unexpected extra physical dispatch');
    onResponse(wires.length);
    if (next === 'timeout') throw new HttpRequestTimeoutError(request.timeoutMs);
    return { status: 200, body: JSON.stringify(next === 'thinking' ? {
      choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'only thinking' } }],
      usage: { prompt_tokens: 10, completion_tokens: wires.at(-1).max_tokens, completion_tokens_details: { reasoning_tokens: wires.at(-1).max_tokens } }
    } : typeof next === 'object' ? next : { choices: [{ finish_reason: 'stop', message: { content: next } }] }) };
  } }, 300000);
  const provider = new RateScheduledProvider(new LedgeredProvider(inner, store, { modelProfileFingerprint: profileFingerprint }),
    new GlobalRateScheduler({ maxConcurrent: 1, endpointBucketId: endpointBucketId(runProfile.endpoint) }));
  const deps = { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, profile: runProfile, provider, now: () => NOW };
  const run = () => runOpeningPlanJob(deps, id, { anchorTitle: '开篇', playerName: '旅人', protagonistSkills: ['skill-observation'] });
  return { wires, store, run, deps };
}
test('planning budget: reasoning-only recovery re-enters the kernel and scheduler once under the shared two-HTTP limit', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'thought-recovery', ['thinking', JSON.stringify(candidateModel())]);
    const result = await q.run(); assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 2);
    assert.deepEqual(q.wires.map(w=>w.max_tokens), [24576,32768]);
    assert.ok(q.wires.every(w=>w.reasoning_effort==='high'));
    assert.equal((await q.store.listAttempts('campaign-plan:thought-recovery')).length,2);
    assert.equal((await q.run()).physicalRequests,0); assert.equal(q.wires.length,2);
  } finally { h.db.close(); }
});

test('campaign-plan structural repair targets a downstream consequence consumer and invalid clue namespace references', async () => {
  const model = structuredClone(candidateModel());
  model.consequences[0].trigger = { kind: 'node_succeeded', nodeId: 'stage-1' };
  model.consequences[0].effects = [{ template: 'grant_knowledge', entryId: 'lore-crates' }];
  model.clues = [{ clueId: 'clue-x', title: '调查线索', text: '现场证词指向一条尚待核实的线索。',
    sourceEntryIds: ['lore-outside-catalog'],
    provenance: { kind: 'canon_inspired', sourceFactIds: ['fact-known'], rationale: '据已绑定的事实整理。' } }];
  const requests = [];
  let validationPass = 0;
  const generated = await generateCampaignPlanCandidate({
    provider: { async complete(request) { requests.push(request); return { text: JSON.stringify(model) }; } },
    profile,
    materials: { system: 'frozen campaign-plan contract', user: 'frozen player intent and world material' },
    logicalRequestId: 'orphan-consequence-repair', worldId: 'w', physicalRequestBudget: 2,
    validateModel: () => validationPass++ === 0
      ? ['consequence lin-favor: no later stage or ending consumes its authoritative effect.',
        'clue clue-x: source lore-outside-catalog is outside the bound catalog.',
        'artifact: clue camp-clue-x depends on content outside its bound catalog.'] : [],
  });
  assert.equal(generated.status, 'ready');
  assert.equal(generated.physicalRequests, 2);
  assert.equal(requests.length, 2);
  assert.match(requests[1].user, /可用的后续必做 main 阶段 nodeId：stage-2/);
  assert.match(requests[1].user, /\{"kind":"knowledge_known","entryId":"lore-crates"\}/);
  assert.match(requests[1].user, /触发阶段 completion 已引用该效果，移除那一个循环条件叶/);
  assert.match(requests[1].user, /不得删除 consequence、放宽阶段依赖或仅改文案/);
  assert.match(requests[1].user, /从该 clue 的 sourceEntryIds 删除这个被拒绝值/);
  assert.match(requests[1].user, /sourceFactIds 是不同命名空间/);
  assert.match(requests[1].user, /lore-outside-catalog/);
});

test('planning budget: restart after a known thought-only response resumes the frozen root with one larger-budget HTTP', async () => {
  const h = await fixture();
  try {
    const renew = h.planStore.renewJobLease.bind(h.planStore);
    const q = await setup(h, 'thought-restart', ['thinking',JSON.stringify(candidateModel())], attempt => {
      if (attempt === 1) h.planStore.renewJobLease = async () => { throw Error('simulated interruption after the known response'); };
    });
    const stopped = await q.run(); assert.equal(stopped.status,'retryable_failed'); assert.equal(stopped.physicalRequests,1);
    const root = h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:thought-restart').payload_json;
    h.planStore.renewJobLease = renew;
    const restored = await q.run(); assert.equal(restored.status,'candidate_ready'); assert.equal(restored.physicalRequests,1);
    assert.deepEqual(q.wires.map(w=>w.max_tokens),[24576,32768]);
    assert.equal(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:thought-restart').payload_json,root);
    assert.equal((await q.store.listAttempts('campaign-plan:thought-restart')).length,2);
  } finally { h.db.close(); }
});
test('planning budget: a thought retry that returns an invalid candidate cannot obtain a third structural-repair HTTP', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'thought-invalid', ['thinking','{}',JSON.stringify(candidateModel())]);
    const result = await q.run(); assert.equal(result.status,'invalid'); assert.equal(result.physicalRequests,2);
    assert.equal(q.wires.length,2); assert.equal((await h.planStore.latestCandidateForJob('thought-invalid')).stage,'rejected');
  } finally { h.db.close(); }
});
test('planning budget: timeout after the known thought retry reports both HTTP attempts and recovery dispatches zero', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'thought-unknown', ['thinking','timeout',JSON.stringify(candidateModel())]);
    const result = await q.run(); assert.equal(result.status,'outcome_unknown'); assert.equal(result.physicalRequests,2);
    assert.equal((await q.run()).physicalRequests,0); assert.equal(q.wires.length,2);
    assert.deepEqual((await q.store.listAttempts('campaign-plan:thought-unknown')).map(a=>a.status),['failed','outcome_unknown']);
  } finally { h.db.close(); }
});

test('campaign-plan recovery: preview sends nothing; confirmed replay preserves unknown attempt and adopts/exports linked result', async () => {
  const h = await fixture();
  try {
    const id = 'unknown-replay-source';
    const fp = llmModelProfileFingerprint(profile);
    const responses = ['timeout'];
    const q = await setup(h, id, responses, undefined, profile, fp);
    const unknown = await q.run();
    assert.equal(unknown.status, 'outcome_unknown');
    assert.equal(q.wires.length, 1);
    const original = (await q.store.listAttempts(`campaign-plan:${id}`))[0];
    assert.equal(original.status, 'outcome_unknown');
    assert.equal(original.replayApprovedAt, null);

    const preview = await previewCampaignPlanUnknownReplay(h.adapter, id, profile);
    assert.equal(preview.alreadyApproved, false);
    assert.equal(preview.remainingPhysicalRequestBudget, 1);
    assert.deepEqual(preview.attemptIds, [original.attemptId]);
    assert.equal(q.wires.length, 1, 'read-only preview makes no provider call');
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM campaign_plan_replay_approvals').get().n, 0);

    const rootBefore = h.db.prepare('SELECT payload_json,content_hash FROM frozen_turn_material_roots WHERE root_id=?').get(`campaign-job:${id}`);
    const confirmed = await confirmCampaignPlanUnknownReplay(h.adapter, { sourceJobId: id,
      approvalFingerprint: preview.approvalFingerprint, activeProfile: profile, now: () => NOW });
    const duplicate = await confirmCampaignPlanUnknownReplay(h.adapter, { sourceJobId: id,
      approvalFingerprint: preview.approvalFingerprint, activeProfile: profile, now: () => NOW });
    assert.equal(duplicate.linkedJobId, confirmed.linkedJobId, 'double confirmation is idempotent');
    assert.equal(duplicate.alreadyApproved, true);
    assert.equal(q.wires.length, 1, 'approval only creates a linked job; it does not dispatch');
    const preserved = (await q.store.listAttempts(`campaign-plan:${id}`))[0];
    assert.equal(preserved.status, 'outcome_unknown');
    assert.ok(preserved.replayApprovedAt > 0);
    const rootAfter = h.db.prepare('SELECT payload_json,content_hash FROM frozen_turn_material_roots WHERE root_id=?').get(`campaign-job:${confirmed.linkedJobId}`);
    assert.equal(rootAfter.payload_json, rootBefore.payload_json, 'linked freeze reuses the exact original payload');
    assert.equal(rootAfter.content_hash, rootBefore.content_hash);
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM campaign_plan_replay_approvals WHERE source_job_id=?').get(id).n, 1);

    responses.push(JSON.stringify(candidateModel()));
    const replay = await runOpeningPlanJob(q.deps, confirmed.linkedJobId,
      { anchorTitle: '开篇', playerName: '旅人', protagonistSkills: ['skill-observation'] });
    assert.equal(replay.status, 'candidate_ready', JSON.stringify(replay));
    assert.equal(replay.physicalRequests, 1);
    assert.equal(q.wires.length, 2);
    const linked = await h.planStore.getJob(confirmed.linkedJobId);
    assert.equal(linked.physicalRequestBudget, 1, 'the linked task keeps only the source job’s unused budget');
    const sourceSetup = await h.planStore.getSetup(id);
    const candidate = await h.planStore.getCandidate(replay.candidateId);
    const protagonist = sourceSetup.intent.protagonistBinding;
    const adopted = await adoptOpeningPlan({ db: h.adapter, planStore: h.planStore, setupId: id, candidateId: replay.candidateId,
      create: { db: h.adapter, worldStore: h.worlds, campaignId: 'campaign-after-approved-replay',
        title: 'Approved replay', worldId: sourceSetup.worldId, packageRevision: sourceSetup.packageRevision,
        anchor: sourceSetup.intent.openingAnchor, protagonist: { actorId: protagonist.actorId, kind: protagonist.kind,
          name: protagonist.name, description: protagonist.description, attributes: protagonist.attributes ??
            { physique: 2, agility: 2, insight: 2, knowledge: 2, willpower: 1, social: 1 },
          canonEntityId: protagonist.canonEntityId, initialSkills: protagonist.initialSkills ?? ['skill-observation'] },
        companions: sourceSetup.intent.companionBindings, goal: candidate.plan.longTermGoal, createdAt: NOW } });
    assert.equal(adopted.outcome, 'created');
    const save = await exportSave({ db: h.adapter, sha256Hex: async text => sha256HexOf(text),
      campaignId: 'campaign-after-approved-replay', branchId: 'campaign-after-approved-replay-main', createdAt: NOW });
    assert.equal(save.save.manifest.campaignId, 'campaign-after-approved-replay');
    assert.equal(h.db.prepare("SELECT status FROM llm_request_attempts WHERE attempt_id=?").get(original.attemptId).status, 'outcome_unknown');
  } finally { h.db.close(); }
});

test('campaign-plan recovery: a replan unknown is fenced to its adopted campaign branch and resumes as a linked job', async () => {
  const h = await fixture();
  try {
    const state = await h.turns.getState(h.branchId);
    const revision = await h.planStore.getPlanRevision(state.campaignRuntime.planBinding.planId,
      state.campaignRuntime.planBinding.revision);
    const intent = state.campaignRuntime.intent ?? revision.intent;
    const jobId = 'replan-unknown-source';
    await h.planStore.insertJob({
      jobId, setupId: `replan:${h.campaignId}`, campaignId: h.campaignId, branchId: h.branchId,
      jobKind: 'replan', triggerReasons: ['goal_changed'], baseStateVersion: state.stateVersion,
      basePlanId: revision.plan.planId, basePlanRevision: revision.plan.revision,
      intentHash: sha256HexOf(canonicalJsonOf(intent)), contentManifestHash: state.campaignContentBinding?.contentHash ?? null,
      knowledgePolicyHash: null, triggerEventRefs: [], status: 'queued', leaseOwner: null, leaseExpiresAt: null,
      fencingToken: 0, attemptCount: 0, nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null,
      lastError: null, createdAt: NOW, updatedAt: NOW,
    });
    const wires = [];
    const ledgerStore = new SqliteLlmLedgerStore(h.adapter);
    const inner = new OpenAICompatibleProvider(profile, { async get() { return 'test-only'; } }, { async post(request) {
      wires.push(JSON.parse(request.body));
      if (wires.length === 1) throw new HttpRequestTimeoutError(request.timeoutMs);
      return { status: 200, body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(candidateModel()) } }] }) };
    } }, 300000);
    const provider = new RateScheduledProvider(new LedgeredProvider(inner, ledgerStore,
      { modelProfileFingerprint: llmModelProfileFingerprint(profile) }),
      new GlobalRateScheduler({ maxConcurrent: 1, endpointBucketId: endpointBucketId(profile.endpoint) }));
    const deps = { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, provider, profile, now: () => NOW };
    const run = linkedJobId => runReplanJob(deps, linkedJobId, { intent, protagonistSkills: ['skill-observation'],
      anchorTitle: '开篇', playerName: '旅人' });
    const session = new CampaignSession(h.session.deps, provider, profile);

    const unknown = await run(jobId);
    assert.equal(unknown.status, 'outcome_unknown');
    assert.equal(wires.length, 1);
    const originalAttempt = (await ledgerStore.listAttempts(`campaign-plan:${jobId}`))[0];
    assert.equal(originalAttempt.status, 'outcome_unknown');

    assert.equal((await session.getCampaignProgress(h.campaignId, h.branchId)).replanOutcomeUnknown, true);
    const preview = await session.previewCampaignReplanReplay(h.campaignId, h.branchId);
    assert.equal(preview.jobKind, 'replan');
    assert.equal(preview.campaignId, h.campaignId);
    assert.equal(preview.branchId, h.branchId);
    assert.deepEqual(preview.attemptIds, [originalAttempt.attemptId]);
    assert.equal(wires.length, 1, 'preview is read-only');
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM campaign_plan_replay_approvals').get().n, 0);

    const [linkedJobId, duplicateLinkedJobId] = await Promise.all([
      session.confirmCampaignReplanReplay(h.campaignId, h.branchId, preview.approvalFingerprint),
      session.confirmCampaignReplanReplay(h.campaignId, h.branchId, preview.approvalFingerprint),
    ]);
    assert.equal(duplicateLinkedJobId, linkedJobId, 'double confirmation shares the same in-flight recovery');
    assert.equal(wires.length, 2);
    assert.equal((await h.planStore.getJob(linkedJobId)).physicalRequestBudget, 1);
    const originalAfterApproval = (await ledgerStore.listAttempts(`campaign-plan:${jobId}`))[0];
    assert.equal(originalAfterApproval.status, 'outcome_unknown');
    assert.ok(originalAfterApproval.replayApprovedAt > 0);
    const audit = h.db.prepare('SELECT linked_job_id,fence_hash,attempt_ids_json FROM campaign_plan_replay_approvals WHERE source_job_id=?').get(jobId);
    assert.equal(audit.linked_job_id, linkedJobId);
    assert.equal(audit.fence_hash, preview.approvalFingerprint);
    assert.deepEqual(JSON.parse(audit.attempt_ids_json), [originalAttempt.attemptId]);
    const afterAdoption = await h.turns.getState(h.branchId);
    assert.equal(afterAdoption.campaignRuntime.planBinding.revision, revision.plan.revision + 1);
    assert.equal((await session.getCampaignProgress(h.campaignId, h.branchId)).replanOutcomeUnknown, false);
    assert.equal(await session.confirmCampaignReplanReplay(h.campaignId, h.branchId, preview.approvalFingerprint), linkedJobId,
      'a repeated confirmation after adoption returns its audited linked job');
    assert.equal(wires.length, 2, 'repeated confirmation after adoption does not dispatch');
    const save = await exportSave({ db: h.adapter, sha256Hex: async text => sha256HexOf(text),
      campaignId: h.campaignId, branchId: h.branchId, createdAt: NOW });
    assert.equal(save.save.manifest.campaignId, h.campaignId);
    assert.equal(save.save.manifest.branchId, h.branchId);
  } finally { h.db.close(); }
});

test('replan lifecycle: a queued job whose base state moved is rejected before a physical dispatch', async () => {
  const h = await fixture();
  try {
    const state = await h.turns.getState(h.branchId);
    const revision = await h.planStore.getPlanRevision(state.campaignRuntime.planBinding.planId,
      state.campaignRuntime.planBinding.revision);
    const intent = state.campaignRuntime.intent ?? revision.intent;
    const jobId = 'replan-stale-base';
    await h.planStore.insertJob({
      jobId, setupId: `replan:${h.campaignId}`, campaignId: h.campaignId, branchId: h.branchId,
      jobKind: 'replan', triggerReasons: ['goal_changed'], baseStateVersion: state.stateVersion,
      basePlanId: revision.plan.planId, basePlanRevision: revision.plan.revision,
      intentHash: sha256HexOf(canonicalJsonOf(intent)), contentManifestHash: state.campaignContentBinding?.contentHash ?? null,
      knowledgePolicyHash: null, triggerEventRefs: [], status: 'queued', leaseOwner: null, leaseExpiresAt: null,
      fencingToken: 0, attemptCount: 0, nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null,
      lastError: null, createdAt: NOW, updatedAt: NOW,
    });
    let physicalDispatches = 0;
    const provider = new OpenAICompatibleProvider(profile, { async get() { return 'test-only'; } }, { async post() {
      physicalDispatches++;
      throw new Error('stale replan must not reach transport');
    } }, 300000);
    const deps = { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, provider, profile, now: () => NOW };
    await h.session.setCampaignStatus({ campaignId: h.campaignId, branchId: h.branchId, status: 'paused' });
    const result = await runReplanJob(deps, jobId, { intent, protagonistSkills: ['skill-observation'],
      anchorTitle: '当前局势', playerName: '旅人' });
    assert.equal(result.status, 'stale');
    assert.equal(physicalDispatches, 0);
    assert.equal((await new SqliteLlmLedgerStore(h.adapter).listAttempts(`campaign-plan:${jobId}`)).length, 0);
  } finally { h.db.close(); }
});
test('planning budget: structural repair and reasoning-only response share the same cap rather than nesting retries', async () => {
  const h = await fixture();
  try {
    const q = await setup(h,'repair-thought',['{}','thinking',JSON.stringify(candidateModel())]);
    const result = await q.run(); assert.equal(result.physicalRequests,2); assert.equal(result.status,'retryable_failed');
    assert.equal((await q.run()).status,'invalid'); assert.equal(q.wires.length,2);
  } finally { h.db.close(); }
});

const clipped = () => ({ choices: [{ finish_reason: 'length', message: { content: '{"partial_UNSAFE":', reasoning_content: 'thinking' } }],
  usage: { prompt_tokens: 8375, completion_tokens: 24576, completion_tokens_details: { reasoning_tokens: 24259 } } });

test('planning lifecycle: one scope covers both HTTPs, validated publication and releases at ready; restore acquires nothing', async () => {
  const h = await fixture(); let held = false, acquisitions = 0, releases = 0;
  try {
    const q = await setup(h, 'lifetime-ready', ['{}', JSON.stringify(candidateModel())], () => assert.equal(held, true));
    q.deps.acquireExecution = async () => { acquisitions++; held = true; return () => { releases++; held = false; }; };
    const publish = h.planStore.upsertCandidate.bind(h.planStore);
    h.planStore.upsertCandidate = async (...args) => { assert.equal(held, true); return publish(...args); };
    const result = await q.run(); assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 2);
    assert.equal(held, false); assert.equal(acquisitions, 1); assert.equal(releases, 1);
    assert.equal((await q.run()).status, 'already_ready'); assert.equal(acquisitions, 1); assert.equal(q.wires.length, 2);
  } finally { h.db.close(); }
});

test('planning lifecycle: native denial before generation records no HTTP and no physical attempt', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'lifetime-denied', [JSON.stringify(candidateModel())]);
    q.deps.acquireExecution = async () => { throw new (require('../dist/application/llm/openAICompatible').HttpRequestNotSentError)('service unavailable'); };
    const result = await q.run(); assert.equal(result.status, 'retryable_failed'); assert.equal(result.physicalRequests, 0);
    assert.equal(q.wires.length, 0); assert.equal((await q.store.listAttempts('campaign-plan:lifetime-denied')).length, 0);
    assert.equal(await h.planStore.latestCandidateForJob('lifetime-denied'), null);
    assert.equal((await h.planStore.getSetup('lifetime-denied')).status, 'planning');
  } finally { h.db.close(); }
});

test('planning lifecycle: unknown and cancellation release protection; unknown recovery neither acquires nor replays', async () => {
  const h = await fixture(); let releases = 0, acquisitions = 0;
  try {
    const q = await setup(h, 'lifetime-unknown', ['timeout', JSON.stringify(candidateModel())]);
    q.deps.acquireExecution = async () => { acquisitions++; return () => { releases++; }; };
    assert.equal((await q.run()).status, 'outcome_unknown'); assert.equal(releases, 1);
    assert.equal((await q.run()).status, 'outcome_unknown'); assert.equal(acquisitions, 1); assert.equal(q.wires.length, 1);
    const cancelled = await setup(h, 'lifetime-cancelled', [JSON.stringify(candidateModel())]);
    cancelled.deps.acquireExecution = async () => {
      await h.adapter.execute("UPDATE campaign_setups SET status='cancelled' WHERE setup_id=?", ['lifetime-cancelled']);
      return () => { releases++; };
    };
    assert.equal((await cancelled.run()).status, 'stale'); assert.equal(releases, 2); assert.equal(cancelled.wires.length, 0);
    assert.equal((await cancelled.store.listAttempts('campaign-plan:lifetime-cancelled')).length, 0);
  } finally { h.db.close(); }
});

test('planning output: known truncated business output receives one usage-informed kernel retry and never becomes a candidate', async () => {
  const h=await fixture();
  try {
    const q=await setup(h,'clipped-recovery',[clipped(),JSON.stringify(candidateModel())]);
    const result=await q.run(); assert.equal(result.status,'candidate_ready'); assert.equal(result.physicalRequests,2);
    assert.deepEqual(q.wires.map(w=>w.max_tokens),[24576,32768]);
    const attempts=await q.store.listAttempts('campaign-plan:clipped-recovery');
    assert.equal(attempts[0].failureClass,'length'); assert.equal(attempts[0].reasoningTokens,24259);
    assert.ok(attempts[1].reasoningReserveTokens>24259); assert.equal(attempts[1].wireOutputTokens,32768);
    assert.equal((await h.planStore.latestCandidateForJob('clipped-recovery')).rawResponseText.includes('partial_UNSAFE'),false);
    assert.equal((await q.run()).physicalRequests,0); assert.equal(q.wires.length,2);
  } finally { h.db.close(); }
});

test('planning output: restart after known truncation uses durable usage and preserves the original frozen root', async () => {
  const h=await fixture();
  try {
    const renew=h.planStore.renewJobLease.bind(h.planStore);
    const q=await setup(h,'clipped-restart',[clipped(),JSON.stringify(candidateModel())],n=>{
      if(n===1)h.planStore.renewJobLease=async()=>{throw Error('interrupted after known truncation');};
    });
    const first=await q.run(); assert.equal(first.status,'retryable_failed'); assert.equal(first.physicalRequests,1);
    const root=h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:clipped-restart').payload_json;
    h.planStore.renewJobLease=renew;
    const second=await q.run();assert.equal(second.status,'candidate_ready');assert.equal(second.physicalRequests,1);
    assert.deepEqual(q.wires.map(w=>w.max_tokens),[24576,32768]);
    assert.equal(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:clipped-restart').payload_json,root);
  }finally{h.db.close();}
});

test('planning output: a second truncated response exhausts the same two-request budget and never triggers a structural repair', async () => {
  const h=await fixture();
  try {
    const q=await setup(h,'clipped-twice',[clipped(),clipped(),JSON.stringify(candidateModel())]);
    const first=await q.run();assert.equal(first.status,'retryable_failed');assert.equal(first.physicalRequests,2);
    const second=await q.run();assert.equal(second.status,'invalid');assert.equal(second.physicalRequests,0);assert.equal(q.wires.length,2);
    assert.equal(await h.planStore.latestCandidateForJob('clipped-twice'),null);
  }finally{h.db.close();}
});

test('planning feedback: a new task freezes previous censored usage and grants body output on top of sufficient reasoning', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'history-floor', [JSON.stringify(candidateModel())], undefined, largeProfile);
    await seedUsage(q.store, 'prior-known-length', 32422, 'length');
    const result = await q.run(); assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 1);
    assert.equal(q.wires[0].max_tokens, 60921);
    const root = JSON.parse(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:history-floor').payload_json);
    assert.deepEqual(root.reasoningPolicy.usageFeedback, { completed: [], exhausted: [32422] });
    const attempts = await q.store.listAttempts('campaign-plan:history-floor');
    assert.equal(attempts[0].reasoningReserveTokens, 48633); assert.equal(attempts[0].wireOutputTokens - attempts[0].reasoningReserveTokens, 12288);
  } finally { h.db.close(); }
});

test('planning feedback: known 24576 exhaustion receives a 49152 wire ceiling rather than the previous five-percent boost', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'large-recovery', ['thinking', JSON.stringify(candidateModel())], undefined, largeProfile);
    const result = await q.run(); assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 2);
    assert.deepEqual(q.wires.map(w => w.max_tokens), [24576, 49152]);
    assert.equal((await q.store.listAttempts('campaign-plan:large-recovery'))[1].reasoningReserveTokens, 36864);
  } finally { h.db.close(); }
});

test('planning feedback: restoration ignores later history and keeps the original material root and selected budget', async () => {
  const h = await fixture();
  try {
    const renew = h.planStore.renewJobLease.bind(h.planStore);
    const q = await setup(h, 'frozen-history', ['{}', JSON.stringify(candidateModel())], n => {
      if (n === 1) h.planStore.renewJobLease = async () => { throw Error('interrupted after known content'); };
    }, largeProfile);
    await seedUsage(q.store, 'prior-complete', 24000);
    assert.equal((await q.run()).status, 'retryable_failed');
    const root = h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:frozen-history').payload_json;
    await seedUsage(q.store, 'later-length', 42000, 'length');
    h.planStore.renewJobLease = renew;
    const result = await q.run();
    assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 1);
    assert.deepEqual(q.wires.map(w => w.max_tokens), [42288, 42288]);
    assert.equal(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:frozen-history').payload_json, root);
  } finally { h.db.close(); }
});

test('planning feedback: a known infeasible history dispatches no paid request and leaves no candidate', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'history-infeasible', [JSON.stringify(candidateModel())]);
    await seedUsage(q.store, 'prior-large', 32422, 'length');
    const result = await q.run(); assert.equal(result.status, 'retryable_failed'); assert.equal(result.physicalRequests, 0);
    assert.equal(q.wires.length, 0); assert.match(result.errors.join(' '), /observed reasoning usage/);
    assert.equal(await h.planStore.latestCandidateForJob('history-infeasible'), null);
  } finally { h.db.close(); }
});

test('planning budget: manual restoration cannot pay again when a known truncated request already reached the frozen wire ceiling', async () => {
  const h=await fixture();
  try {
    const atCeiling={choices:[{finish_reason:'length',message:{content:'{"unfinished":',reasoning_content:''}}],
      usage:{prompt_tokens:20,completion_tokens:32768,completion_tokens_details:{reasoning_tokens:0}}};
    const q=await setup(h,'ceiling-restore',[atCeiling,JSON.stringify(candidateModel())]);
    await seedUsage(q.store,'prior-body-sizing',16384);
    const first=await q.run();assert.equal(first.status,'retryable_failed');assert.equal(first.physicalRequests,1);
    assert.deepEqual(q.wires.map(w=>w.max_tokens),[32768]);
    const root=h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:ceiling-restore').payload_json;
    const before=await q.store.listAttempts('campaign-plan:ceiling-restore');
    const restored=await q.run();assert.equal(restored.status,'retryable_failed');assert.equal(restored.physicalRequests,0);
    assert.match(restored.errors.join(' '),/输出预算无法增加/);
    assert.equal(q.wires.length,1);assert.deepEqual(await q.store.listAttempts('campaign-plan:ceiling-restore'),before);
    assert.equal(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:ceiling-restore').payload_json,root);
    assert.equal(await h.planStore.latestCandidateForJob('ceiling-restore'),null);
    assert.equal((await q.run()).physicalRequests,0);assert.equal(q.wires.length,1);
  }finally{h.db.close();}
});

test('planning budget: a known exhausted legacy attempt without a durable wire ceiling fails closed on restore', async () => {
  const h=await fixture();
  try {
    const q=await setup(h,'missing-wire-restore',[{choices:[{finish_reason:'length',message:{content:'{"unfinished":'}}],
      usage:{prompt_tokens:20,completion_tokens:32768,completion_tokens_details:{reasoning_tokens:0}}},JSON.stringify(candidateModel())]);
    await seedUsage(q.store,'prior-wire-sizing',16384);
    assert.equal((await q.run()).physicalRequests,1);
    await h.adapter.execute('UPDATE llm_request_attempts SET wire_output_tokens=NULL WHERE logical_request_id=?',['campaign-plan:missing-wire-restore']);
    const before=await q.store.listAttempts('campaign-plan:missing-wire-restore');
    const restored=await q.run();assert.equal(restored.status,'retryable_failed');assert.equal(restored.physicalRequests,0);
    assert.match(restored.errors.join(' '),/缺少有效的输出预算记录/);assert.equal(q.wires.length,1);
    assert.deepEqual(await q.store.listAttempts('campaign-plan:missing-wire-restore'),before);
  }finally{h.db.close();}
});

test('planning budget: full structural repair that exceeds the frozen wire envelope stops before a second paid request', async () => {
  const h = await fixture();
  try {
    const narrow = { ...profile, capabilities: { ...profile.capabilities, contextWindow: 32768 } };
    const raw = JSON.stringify({ invalid: '证'.repeat(10000) });
    const q = await setup(h, 'repair-wire-overflow', [raw, JSON.stringify(candidateModel())], undefined, narrow);
    const first = await q.run();
    assert.equal(first.status, 'retryable_failed');
    assert.equal(first.physicalRequests, 1, 'oversized assembled repair must not spend its remaining request');
    assert.match(first.errors.join(' '), /Final wire check failed/);
    const candidate = await h.planStore.latestCandidateForJob('repair-wire-overflow');
    assert.equal(candidate.rawResponseText, raw, 'retain the entire paid response, without clipping');
    const root = h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:repair-wire-overflow').payload_json;
    const attempts = await q.store.listAttempts('campaign-plan:repair-wire-overflow');
    assert.equal((await q.run()).physicalRequests, 0, 'restoration cannot pay for the same infeasible repair');
    assert.equal(q.wires.length, 1);
    assert.deepEqual(await q.store.listAttempts('campaign-plan:repair-wire-overflow'), attempts);
    assert.equal(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:repair-wire-overflow').payload_json, root);
  } finally { h.db.close(); }
});

test('planning budget: complete repair input is reflected in scheduler admission and remains within the exact frozen wire ceiling', async () => {
  const requests = [];
  const result = await generateCampaignPlanCandidate({ profile, materials: { system: 'protocol', user: '完整玩家意图' },
    logicalRequestId: 'wire-fit', worldId: 'world-fixture', provider: { async complete(input) {
      requests.push(input); return { text: requests.length === 1 ? '{}' : JSON.stringify(candidateModel()) };
    } } });
  assert.equal(result.status, 'ready');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].maxOutputTokens, requests[1].maxOutputTokens, 'structural repair retains the frozen wire allocation');
  for (const input of requests) {
    const tokens = estimateFinalWireInput([{ role: 'system', content: input.system }, { role: 'user', content: input.user }]);
    assert.equal(input.scheduling.estimatedInputTokens, tokens);
    assert.ok(tokens + input.maxOutputTokens + deriveSafetyMargin(profile.capabilities.contextWindow) <= profile.capabilities.contextWindow);
  }
});
