const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, candidateModel, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { runOpeningPlanJob } = require('../dist/application/campaignPlan/planningService');
const { runReplanJob, adoptReplanCandidate } = require('../dist/application/campaignPlan/replanService');
const { parseCampaignPlanCandidate } = require('../dist/application/campaignPlan/candidateModel');
const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');
const { forkBranch } = require('../dist/application/branch/fork');
const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
const { exportSave, restoreSave } = require('../dist/application/export/saveFile');
const { validateOrdinarySuccessCompletion } = require('../dist/domain/campaignPlan/planValidation');

const profile = { id: 'test', name: 'Test', endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'low',
  capabilities: { contextWindow: 60000, maxOutputTokens: 12000, supportsJson: true } };
const args = { anchorTitle: '开篇', playerName: '旅人', protagonistSkills: ['skill-observation'], openingGoalSuggestions: [] };
async function opening(h, id) {
  const setup = await h.planStore.getSetup('setup-t');
  const intent = { ...setup.intent, setupId: id };
  await h.planStore.upsertSetup({ ...setup, setupId: id, intent, status: 'planning', currentCandidateId: null });
  await h.planStore.insertJob({ jobId: id, setupId: id, campaignId: null, branchId: null, jobKind: 'opening_plan',
    triggerReasons: ['test'], baseStateVersion: null, basePlanId: null, basePlanRevision: null,
    intentHash: sha256HexOf(canonicalJsonOf(intent)), contentManifestHash: null, knowledgePolicyHash: null, triggerEventRefs: [],
    status: 'queued', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 0, nextRetryAt: null,
    physicalRequestBudget: 2, freezeRootId: null, lastError: null, createdAt: NOW, updatedAt: NOW });
}
const deps = (h, provider) => ({ db: h.adapter, planStore: h.planStore, worldStore: h.worlds, provider, profile });

test('closeout: full-success-only completion is bounded invalid; repair can supply an ordinary fulfillment route', async () => {
  const h = await fixture();
  try {
    const bad = candidateModel();
    for (const m of bad.firstSituation.methods) m.outcomes.success.effects = m.outcomes.success.effects.filter(e => e.template !== 'situation_status');
    await opening(h, 'full-only'); let calls = 0;
    const invalid = { async complete() { calls++; return { text: JSON.stringify(bad) }; } };
    const result = await runOpeningPlanJob(deps(h, invalid), 'full-only', args);
    assert.equal(result.status, 'invalid'); assert.equal(calls, 2);
    assert.match(result.errors.join(' '), /ordinary success producer/);
    assert.equal((await h.planStore.latestCandidateForJob('full-only')).rawResponseText, JSON.stringify(bad));
    await runOpeningPlanJob(deps(h, invalid), 'full-only', args); assert.equal(calls, 2);
    await opening(h, 'ordinary-repair'); let repairedCalls = 0;
    const repaired = await runOpeningPlanJob(deps(h, { async complete(request) {
      repairedCalls++;
      if (repairedCalls === 2) assert.match(request.user, /ordinary success producer/);
      return { text: JSON.stringify(repairedCalls === 1 ? bad : candidateModel()) };
    } }), 'ordinary-repair', args);
    assert.equal(repaired.status, 'candidate_ready', JSON.stringify(repaired)); assert.equal(repairedCalls, 2);
    // Existing adopted content is immutable and playable across this new-authoring gate.
    assert.equal((await h.turns.getState(h.branchId)).stateVersion, 0);
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    assert.equal((await h.turns.getState(h.branchId)).campaignRuntime.nodeStates[0].status, 'succeeded');
  } finally { h.db.close(); }
});

test('closeout: ordinary completion accepts alternatives and reachable delayed markers, rejects circular or full-only scheduling', async () => {
  const h = await fixture();
  try {
    const candidate = await h.planStore.getCandidate('cand-t');
    const plan = structuredClone(candidate.plan), artifact = structuredClone(candidate.artifact);
    const sid = artifact.situations[0].entryId, start = plan.nodes[0];
    for (const m of artifact.situations[0].definition.methods) m.outcomeTemplates.success.effects = m.outcomeTemplates.success.effects.filter(e => e.template !== 'situation_status');
    assert.equal(validateOrdinarySuccessCompletion(plan, artifact).length, 1);
    const counter = { kind: 'situation_counter_at_least', situationId: sid, counterId: 'evidence', minimum: 2 };
    start.completion = { kind: 'any', of: [start.completion, counter] };
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact), []);
    start.completion = { kind: 'all', of: [{ kind: 'situation_status', situationId: sid, status: 'resolved' }, counter] };
    artifact.consequenceTemplates[0].triggerCondition = counter;
    artifact.consequenceTemplates[0].effectSpecs = [{ template: 'situation_status', situationId: sid, status: 'resolved' }];
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact), []);
    artifact.consequenceTemplates[0].triggerCondition = { kind: 'situation_status', situationId: sid, status: 'resolved' };
    assert.equal(validateOrdinarySuccessCompletion(plan, artifact).length, 1);
    artifact.consequenceTemplates[0].triggerCondition = counter;
    for (const m of artifact.situations[0].definition.methods) m.outcomeTemplates.success.effects = m.outcomeTemplates.success.effects.filter(e => e.template !== 'schedule_consequence');
    assert.equal(validateOrdinarySuccessCompletion(plan, artifact).length, 1);
  } finally { h.db.close(); }
});

test('closeout: two ordinary successful decisions complete a counter route without waiting for full_success', async () => {
  const model = candidateModel();
  model.stages[0].completion = { kind: 'counter_at_least', situationId: 'self', counterId: 'evidence', minimum: 2 };
  for (const m of model.firstSituation.methods) m.outcomes.success.effects = [{ template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1 }];
  const h = await fixture({ model });
  try {
    const action = { campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' };
    await h.session.playTurn(action);
    assert.equal((await h.turns.getState(h.branchId)).campaignRuntime.nodeStates[0].status, 'active');
    await h.session.playTurn(action);
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.campaignRuntime.nodeStates[0].status, 'succeeded');
    assert.equal(after.campaignRuntime.grantedRewardKeys.length, 1);
    const actionTurns = h.db.prepare('SELECT outcome_grade FROM turns WHERE branch_id=? AND action_contract_hash<>? ORDER BY committed_state_version')
      .all(h.branchId, 'manage-adoption');
    assert.deepEqual(actionTurns.map(r => r.outcome_grade), ['success','success']);
  } finally { h.db.close(); }
});

test('closeout: a retained coarse primary yields to the prepared replan stage in the adoption commit', async () => {
  const h = await fixture();
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const before = await h.turns.getState(h.branchId);
    assert.equal(before.campaignRuntime.primaryNodeId, 'stage-2');
    const model = candidateModel(); model.rewards = [];
    model.stages[0].nodeId = 'prepare-report'; model.stages[0].publicObjective = '整理证据并向知情人确认';
    model.stages[0].dependsOn = ['stage-1'];
    model.stages[1].dependsOn = ['prepare-report']; model.stages[1].activation.nodeId = 'prepare-report';
    // The existing coarse node is first in the model and retains its available
    // runtime status; iteration order must not eclipse the ready firstSituation.
    model.stages.reverse();
    h.session.provider = { async complete() { return { text: JSON.stringify(model) }; } };
    await h.session.runCampaignReplan(h.campaignId, h.branchId);
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.stateVersion, before.stateVersion + 1);
    assert.equal(after.campaignRuntime.primaryNodeId, 'prepare-report');
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'prepare-report').status, 'active');
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-2').status, 'available');
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    assert.equal(after.campaignRuntime.publicObjectiveProjection, '整理证据并向知情人确认');
    assert.deepEqual(after.campaignRuntime.grantedRewardKeys, before.campaignRuntime.grantedRewardKeys);
    const progress = await h.session.getCampaignProgress(h.campaignId, h.branchId);
    assert.equal(progress.currentObjective, after.campaignRuntime.publicObjectiveProjection);
  } finally { h.db.close(); }
});

test('closeout: prepared content cannot steal an active stage, bypass dependencies, or resume a paused campaign', async () => {
  const h = await fixture();
  try {
    const { evaluateCampaignProgress } = require('../dist/domain/campaignPlan/progressReducer');
    const candidate = await h.planStore.getCandidate('cand-t');
    const state = await h.turns.getState(h.branchId), plan = structuredClone(candidate.plan);
    plan.nodes.push({ ...structuredClone(plan.nodes[0]), nodeId: 'new-ready' });
    const runtime = structuredClone(state.campaignRuntime);
    runtime.nodeStates.push({ nodeId: 'new-ready', status: 'available', completedEvidence: [] });
    const evaluate = r => evaluateCampaignProgress({ plan, runtime: r, state, transactionEvents: [], historyEvents: [],
      turnId: 'local-check', nextStateVersion: 1 });
    assert.equal(evaluate(runtime).runtime.primaryNodeId, 'stage-1');
    runtime.primaryNodeId = 'stage-2';
    runtime.nodeStates[0].status = 'succeeded'; runtime.nodeStates[1].status = 'available';
    plan.nodes.at(-1).statusDependencies = ['stage-2'];
    assert.equal(evaluate(runtime).runtime.primaryNodeId, 'stage-2');
    plan.nodes.at(-1).statusDependencies = [];
    runtime.campaignStatus = 'paused';
    assert.equal(evaluate(runtime).runtime.primaryNodeId, 'stage-2');
    assert.equal(evaluate(runtime).runtime.campaignStatus, 'paused');
  } finally { h.db.close(); }
});

test('closeout: malformed reward and collection entries are rejected before compile, without throwing', () => {
  const mutations = [
    m => { m.rewards[0].rewards = [{ kind: 'relationship', toActorId: 'actor-player', delta: 2 }]; },
    m => { m.rewards[0].rewards = [null]; },
    m => { m.rewards[0].rewards = [{ kind: 'knowledge', targetId: 'lore-crates', toActorId: 7 }]; },
    m => { m.rewards[0].rewards = [{ kind: 'relationship', targetId: 'tpl-lin', delta: 1 }]; },
    m => { m.rewards[0].rewards = [{ kind: 'resource_cap', targetId: 'hp', delta: '2' }]; },
    m => { m.rewards[0].rewards = [{ kind: 'skill_rank', targetId: 'skill-observation', rank: ['novice'] }]; },
    m => { m.rewards[0].rewards[0].kind = ['knowledge']; },
    m => { m.firstSituation.methods[0].firstStep.actionKind = ['talk']; },
    m => { m.firstSituation.methods[0].firstStep.skillId = ['skill-observation']; },
    m => { m.firstSituation.methods[0].outcomes.success.effects = [{ template: ['situation_status'], situationId: 'self', status: 'resolved' }]; },
    m => { m.firstSituation.methods[0].outcomes.success.effects = [{ template: 'situation_status', situationId: 'self', status: ['resolved'] }]; },
    m => { m.stages[0].completion.kind = ['situation_resolved']; },
    m => { m.endings[0].outcomeKind = ['success']; },
    m => { m.modelVersion = ['campaign-plan-model-1']; },
    m => { m.rewards[0] = null; },
    m => { m.consequences[0] = null; },
    m => { m.stages[0] = null; },
    m => { m.endings[0] = null; },
    m => { delete m.firstSituation.methods[0].methodId; },
    m => { delete m.stages[0].nodeId; },
    m => { delete m.consequences[0].consequenceId; },
  ];
  for (const mutate of mutations) {
    const model = candidateModel(); mutate(model);
    const errors = [];
    assert.equal(parseCampaignPlanCandidate(model, errors), null);
    assert.ok(errors.length > 0);
  }
  const valid = candidateModel();
  valid.rewards[0].rewards.push({ kind: 'relationship', targetId: 'tpl-lin', toActorId: 'actor-player', delta: 2 });
  assert.ok(parseCampaignPlanCandidate(valid, []));
});

test('closeout: method requirements preserve legal gates and reject malformed or unsupported mechanics', () => {
  const malformed = [[], 'none', { skillId: ['skill-observation'] }, { minRank: 'master' },
    { skillId: 'skill-observation', minRank: 1 }, { skillId: 'skill-observation', minRank: ['novice'] },
    { itemId: 7 }, { knowledgeEntryId: {} }, { actorAlive: {} }, { relationshipTo: ['tpl-lin'] },
    { minCloseness: 20 }, { relationshipTo: 'tpl-lin', minCloseness: '20' },
    { relationshipTo: 'tpl-lin', minCloseness: 101 }, { condition: 'invented-gate' }];
  for (const requires of malformed) {
    const model = candidateModel(); model.firstSituation.methods[0].requires = requires;
    const errors = [];
    assert.equal(parseCampaignPlanCandidate(model, errors), null);
    assert.match(errors.join(' '), /requires/);
  }
  const requires = { skillId: 'skill-observation', minRank: 'trained', itemId: 'item-crate',
    knowledgeEntryId: 'lore-crates', relationshipTo: 'tpl-lin', minCloseness: 20, actorAlive: 'tpl-lin' };
  const model = candidateModel(); model.firstSituation.methods[0].requires = requires;
  assert.deepEqual(parseCampaignPlanCandidate(model, []).firstSituation.methods[0].requires, requires);
  model.firstSituation.methods[0].firstStep.targetEntryId = null;
  model.firstSituation.methods[0].requires = { skillId: null, minRank: null, itemId: null };
  const parsed = parseCampaignPlanCandidate(model, []);
  assert.deepEqual(parsed.firstSituation.methods[0].requires, {});
  assert.equal(parsed.firstSituation.methods[0].firstStep.targetEntryId, undefined);
});

test('closeout: malformed required skill never reaches compiler or a retryable job, and raw resume sends nothing', async () => {
  const h = await fixture();
  try {
    await opening(h, 'method-requires-invalid');
    const model = candidateModel();
    model.firstSituation.methods[0].requires = { skillId: ['skill-observation'] };
    let calls = 0;
    const provider = { async complete() { calls++; return { text: JSON.stringify(model) }; } };
    const result = await runOpeningPlanJob(deps(h, provider), 'method-requires-invalid', args);
    assert.equal(result.status, 'invalid');
    assert.equal(calls, 2);
    assert.match(result.errors.join(' '), /requires.skillId: stable string id required/);
    const candidate = await h.planStore.latestCandidateForJob('method-requires-invalid');
    assert.equal(candidate.rawResponseText, JSON.stringify(model));
    assert.equal(candidate.stage, 'rejected');
    await runOpeningPlanJob(deps(h, provider), 'method-requires-invalid', args);
    assert.equal(calls, 2);
  } finally { h.db.close(); }
});

test('closeout: unsupported preparation fields get exact repair feedback while a legal knowledge gate is preserved', async () => {
  const h = await fixture();
  try {
    await opening(h, 'requires-repair'); let calls = 0;
    const bad = candidateModel(); bad.firstSituation.methods[0].requires = { knowledge: 'lore-crates' };
    const good = candidateModel(); good.firstSituation.methods[0].requires = { knowledgeEntryId: 'lore-crates' };
    const result = await runOpeningPlanJob(deps(h, { async complete(request) {
      calls++; assert.match(request.system, /requires 仅支持这些字段/);
      if (calls === 2) assert.match(request.user, /unsupported requirement field knowledge; allowed fields:.*knowledgeEntryId/);
      return { text: JSON.stringify(calls === 1 ? bad : good) };
    } }), 'requires-repair', args);
    assert.equal(result.status, 'candidate_ready', JSON.stringify(result)); assert.equal(calls, 2);
    const candidate = await h.planStore.getCandidate(result.candidateId);
    assert.deepEqual(candidate.artifact.situations[0].definition.methods[0].requires, { knowledgeEntryId: 'lore-crates' });
  } finally { h.db.close(); }
});

test('closeout: strict reference types retain Chinese location IDs and the compiler still enforces scope', async () => {
  const h = await fixture();
  try {
    const { intent } = await h.planStore.getSetup('setup-t');
    const { ctx } = await require('../dist/application/campaignPlan/planningService').buildPlanningContext({
      worldStore: h.worlds, intent, protagonistSkills: ['skill-observation'],
    });
    const { compileCampaignPlan } = require('../dist/application/campaignPlan/localCompile');
    const model = candidateModel();
    model.firstSituation.methods[0].firstStep = { intent: '沿巷道走到青石巷查看货箱', actionKind: 'move', destinationId: '青石巷' };
    const errors = [];
    const parsed = parseCampaignPlanCandidate(model, errors);
    assert.ok(parsed, errors.join('; '));
    const input = { model: parsed, intent, ctx, planId: 'move-ref', revision: 1, parentRevision: null, createdAt: NOW };
    assert.deepEqual(compileCampaignPlan(input).errors, []);
    parsed.firstSituation.methods[0].firstStep.destinationId = '未发布的远方';
    assert.match(compileCampaignPlan(input).errors.join(' '), /destination .* not a visible scene/);
    model.firstSituation.methods[0].firstStep.destinationId = ['青石巷'];
    assert.equal(parseCampaignPlanCandidate(model, []), null);
  } finally { h.db.close(); }
});

test('closeout: reward target missing in both physical responses leaves an invalid job, and resume sends nothing', async () => {
  const h = await fixture();
  try {
    await opening(h, 'reward-invalid');
    const model = candidateModel();
    model.rewards[0].rewards = [{ kind: 'relationship', toActorId: 'actor-player', delta: 2 }];
    let calls = 0;
    const provider = { async complete() { calls++; return { text: JSON.stringify(model) }; } };
    const result = await runOpeningPlanJob(deps(h, provider), 'reward-invalid', args);
    assert.equal(result.status, 'invalid');
    assert.equal(calls, 2);
    assert.match(result.errors.join(' '), /targetId/);
    const candidate = await h.planStore.latestCandidateForJob('reward-invalid');
    assert.equal(candidate.stage, 'rejected');
    assert.equal(candidate.repairUsed, true);
    assert.equal(candidate.rawResponseText, JSON.stringify(model));
    await runOpeningPlanJob(deps(h, provider), 'reward-invalid', args);
    assert.equal(calls, 2);
    assert.equal((await h.planStore.getSetup('reward-invalid')).status, 'failed');
  } finally { h.db.close(); }
});

test('closeout: numeric reward rank gets actionable bounded repair and can publish the corrected candidate', async () => {
  const h = await fixture();
  try {
    await opening(h, 'reward-rank-repair');
    const model = candidateModel();
    model.rewards[0].rewards = [{ kind: 'skill_rank', targetId: 'skill-observation', rank: 1 }];
    let calls = 0;
    const provider = { async complete(request) {
      calls++;
      assert.match(request.system, /rank 必须是字符串 untrained \/ novice \/ trained \/ expert \/ master/);
      if (calls === 2) {
        assert.match(request.user, /numeric ranks are invalid/);
        assert.match(request.user, /novice \| trained \| expert \| master/);
        model.rewards[0].rewards[0].rank = 'novice';
      }
      return { text: JSON.stringify(model) };
    } };
    const result = await runOpeningPlanJob(deps(h, provider), 'reward-rank-repair', args);
    assert.equal(result.status, 'candidate_ready', result.errors.join(' '));
    assert.equal(calls, 2);
    const candidate = await h.planStore.latestCandidateForJob('reward-rank-repair');
    assert.equal(candidate.artifact.rewardPolicies[0].rewards[0].rank, 'novice');
    assert.equal(candidate.repairUsed, true);
  } finally { h.db.close(); }
});

test('closeout: consequence examples in the generation contract are accepted by the production parser', async () => {
  const h = await fixture();
  try {
    const { intent } = await h.planStore.getSetup('setup-t');
    const { ctx } = await require('../dist/application/campaignPlan/planningService').buildPlanningContext({
      worldStore: h.worlds, intent, protagonistSkills: ['skill-observation'],
    });
    const materials = require('../dist/application/campaignPlan/generationService').buildPlanRequestMaterials({
      intent, ctx, visibleEntries: ctx.visibleEntries, worldTitle: '青石巷', ...args,
    });
    const line = materials.system.split('\n').find(s => s.trim().startsWith('"consequences":'));
    const example = JSON.parse('{' + line.trim().replace(/,$/, '') + '}').consequences[0];
    const model = candidateModel();
    model.consequences[0].trigger = example.trigger;
    model.consequences[0].effects = example.effects;
    const errors = [];
    assert.ok(parseCampaignPlanCandidate(model, errors), JSON.stringify(errors));
    assert.deepEqual(errors, []);
    // Conditions must consume the exact event produced later, not an alias.
    model.firstSituation.methods[0].outcomes.success.effects.push({
      template: 'record_event', eventType: example.trigger.eventType, summary: '后续履约',
    });
    assert.ok(parseCampaignPlanCandidate(model, []));
    model.consequences[0].effects[0].eventType = 'reaction-recorded';
    const invalid = [];
    assert.equal(parseCampaignPlanCandidate(model, invalid), null);
    assert.ok(invalid.some(error => error.includes('snake_case')));
  } finally { h.db.close(); }
});

test('closeout: nested complete consequences and rewards are preserved but ambiguous placement fails', () => {
  const model = candidateModel();
  model.firstSituation.consequences = model.consequences; delete model.consequences;
  model.firstSituation.rewards = model.rewards; delete model.rewards;
  const errors = []; const parsed = parseCampaignPlanCandidate(model, errors);
  assert.deepEqual(errors, []);
  assert.equal(parsed.consequences[0].consequenceId, 'lin-favor');
  assert.equal(parsed.rewards[0].policyId, 'rp-1');
  model.consequences = [];
  const ambiguous = [];
  assert.equal(parseCampaignPlanCandidate(model, ambiguous), null);
  assert.match(ambiguous.join(' '), /one location only/);
  delete model.consequences; model.firstSituation.consequences[0].trigger = 'later';
  const invalid = [];
  assert.equal(parseCampaignPlanCandidate(model, invalid), null);
  assert.match(invalid.join(' '), /trigger/);
});

test('closeout: publishing a provisional current stage promotes it to active and exposes its new methods', async () => {
  const h = await fixture();
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const previous = await h.turns.getState(h.branchId);
    assert.equal(previous.campaignRuntime.primaryNodeId, 'stage-2');
    assert.equal(previous.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-2').status, 'available');
    const model = candidateModel(); model.rewards = [];
    model.stages[0].nodeId = 'stage-2'; model.stages[0].coverage = 'provisional'; model.stages[0].next = ['stage-3'];
    model.stages[1].nodeId = 'stage-3'; model.stages[1].dependsOn = ['stage-2'];
    model.stages[1].activation.nodeId = 'stage-2'; model.endings[0].condition.nodeId = 'stage-3';
    h.session.provider = { async complete() { return { text: JSON.stringify(model) }; } };
    assert.equal(await h.session.runCampaignReplan(h.campaignId, h.branchId), 'adopted');
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.campaignRuntime.primaryNodeId, 'stage-2');
    assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-2').status, 'active');
    const plan = (await h.planStore.getPlanRevision(state.campaignRuntime.planBinding.planId, state.campaignRuntime.planBinding.revision)).plan;
    assert.equal(plan.nodes.find(n => n.nodeId === 'stage-2').coverage, 'concrete');
    assert.ok(!plan.unresolvedDependencies.some(d => d.nodeId === 'stage-2'));
    h.session.deps.guidance = new (require('../dist/infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(h.adapter);
    const guide = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'current', localOnly: true });
    assert.ok(guide.steps.some(s => s.availability === 'available' && s.situationId === plan.nodes.find(n => n.nodeId === 'stage-2').situationRef));
  } finally { h.db.close(); }
});

test('closeout: a new replan method can fulfill a branch-owned promise from the previous situation', async () => {
  const { SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
  const original = candidateModel();
  original.stages[0].completion = { kind: 'committed_event', eventType: 'favor_accepted' };
  for (const grade of ['success','full_success']) original.firstSituation.methods[1].outcomes[grade].effects = [
    { template: 'promise_create', situationId: 'self', promiseId: 'old-favor', promisorActorId: 'tpl-lin', promiseeActorId: 'player', description: '答应帮助林凡' },
    { template: 'record_event', eventType: 'favor_accepted', summary: '已答应林凡的请求' }];
  const h = await fixture({ model: original });
  try {
    const turnProvider = h.session.provider;
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const prior = await h.turns.getState(h.branchId);
    assert.equal(prior.situations.find(s => s.situationId === SITUATION_ID).status, 'active');
    assert.equal(prior.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    await h.session.changeCampaignGoal({ campaignId: h.campaignId, branchId: h.branchId, newGoal: '兑现对林凡的承诺' });
    const model = candidateModel(); model.rewards = [];
    model.stages[0].nodeId = 'honor'; model.stages[0].next = ['after-honor'];
    model.stages[0].completion = { kind: 'promise_fulfilled', situationId: SITUATION_ID, promiseId: 'old-favor' };
    model.stages[1].nodeId = 'after-honor'; model.stages[1].dependsOn = ['honor'];
    model.stages[1].activation = { kind: 'node_succeeded', nodeId: 'honor' }; model.endings[0].condition.nodeId = 'after-honor';
    for (const grade of ['success','full_success']) model.firstSituation.methods[0].outcomes[grade].effects = [
      { template: 'promise_fulfill', situationId: SITUATION_ID, promiseId: 'old-favor' }];
    h.session.provider = { async complete() { return { text: JSON.stringify(model) }; } };
    assert.equal(await h.session.runCampaignReplan(h.campaignId, h.branchId), 'adopted');
    h.session.provider = turnProvider;
    h.session.deps.guidance = new (require('../dist/infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(h.adapter);
    const guide = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'test', localOnly: true });
    const step = guide.steps.find(s => s.candidateRef.endsWith(':sweep'));
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: step.firstStepIntent,
      guidanceChoice: { decisionPoint: guide.decisionPoint, candidateRef: step.candidateRef } });
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.situations.find(s => s.situationId === SITUATION_ID).promises.find(p => p.promiseId === 'old-favor').status, 'fulfilled');
    assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'honor').status, 'succeeded');
  } finally { h.db.close(); }
});

for (const ended of [false, true]) test(`closeout: ${ended ? 'campaign ending' : 'node completion'} retires actions in compiler, prepared narration and same-version guidance cache`, async () => {
  const { SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
  const model = candidateModel(), requests = [];
  model.stages[0].completion = { kind: 'committed_event', eventType: 'report_received' };
  for (const grade of ['success', 'full_success']) model.firstSituation.methods[1].outcomes[grade].effects = [
    { template: 'record_event', eventType: 'report_received', summary: '供述已回报' },
    { template: 'promise_create', situationId: 'self', promiseId: 'still-owed', promisorActorId: 'tpl-lin', promiseeActorId: 'player', description: '稍后兑现约定' },
  ];
  if (ended) model.endings[0].condition = { kind: 'node_succeeded', nodeId: 'stage-1' };
  const h = await fixture({ model, onRequest: request => requests.push(request) });
  try {
    h.session.deps.guidance = new (require('../dist/infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(h.adapter);
    const archiveBefore = h.db.prepare('SELECT artifact_json, content_hash FROM campaign_content_artifacts').all();
    const oldGuide = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'opening', localOnly: true });
    const oldStep = oldGuide.steps.find(s => s.candidateRef.endsWith(':ask-lin'));
    assert.ok(oldStep);
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: oldStep.firstStepIntent,
      guidanceChoice: { decisionPoint: oldGuide.decisionPoint, candidateRef: oldStep.candidateRef } });
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.situations.find(s => s.situationId === SITUATION_ID).status, 'active');
    assert.equal(state.situations.find(s => s.situationId === SITUATION_ID).promises.find(p => p.promiseId === 'still-owed').status, 'open');
    assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    assert.equal(state.campaignRuntime.campaignStatus, ended ? 'completed' : 'active');
    // Check the prepared packet actually sent to Narrator and the guide saved
    // immediately by playTurn, before any UI refresh can repair it.
    const packet = JSON.parse(requests.find(r => r.role === 'Narrator').user).situationPacket;
    assert.ok(packet);
    assert.ok(packet.allowedCandidates.every(c => c.situationId !== SITUATION_ID));
    assert.ok(packet.opportunities.every(o => o.situationId !== SITUATION_ID));
    const committedGuide = await h.session.getGuidanceAtVersion(h.branchId, state.stateVersion);
    assert.ok(committedGuide.steps.every(s => s.situationId !== SITUATION_ID));
    assert.ok(committedGuide.steps.some(s => s.actionId === 'observe'));
    // Emulate a legacy app cache at this exact state version. The new current
    // projection must replace it locally, even though the archive hash is equal.
    await h.session.deps.guidance.save({ ...committedGuide, steps: oldGuide.steps,
      decisionPoint: { ...committedGuide.decisionPoint, contextHash: 'legacy-unfiltered' } });
    const calls = requests.length;
    const fresh = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'cold-load', localOnly: true });
    assert.ok(fresh.steps.every(s => s.situationId !== SITUATION_ID));
    assert.equal(requests.length, calls);
    await assert.rejects(() => h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: oldStep.firstStepIntent,
      guidanceChoice: { decisionPoint: fresh.decisionPoint, candidateRef: oldStep.candidateRef } }), /失效|可用办法/);
    assert.equal(requests.length, calls, 'retired selection is rejected before HTTP');
    assert.equal((await h.turns.getState(h.branchId)).stateVersion, state.stateVersion);
    if (!ended) {
      await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '在巷口稍作停留' });
      const turns = await h.turns.listCommittedTurns(h.branchId);
      const stored = await h.turns.getStagedTurn(h.branchId, turns.at(-1).turnId);
      const contract = JSON.parse(stored.actionContractJson);
      assert.equal(contract.methodRef, undefined);
      assert.equal(contract.campaignEffects, undefined);
    }
    assert.deepEqual(h.db.prepare('SELECT artifact_json, content_hash FROM campaign_content_artifacts').all(), archiveBefore);
  } finally { h.db.close(); }
});

test('closeout: lifecycle content projection preserves world content, paused paths and immutable authority archives', async () => {
  const h = await fixture();
  try {
    const { resolveCampaignContent, projectPlayableSituations, campaignMethodsForTurn } = require('../dist/application/campaignPlan/contentResolver');
    const candidate = await h.planStore.getCandidate('cand-t'), artifact = candidate.artifact;
    const raw = JSON.stringify(artifact), state = await h.turns.getState(h.branchId);
    const entries = resolveCampaignContent(require('./helpers/phase9CampaignFixture.cjs').baseEntries(), [artifact]);
    const campaignSituation = entries.find(e => e.kind === 'situation');
    const worldSituation = { situationId: 'world-situation', definition: campaignSituation.definition };
    const definitions = [worldSituation, { situationId: campaignSituation.entryId, definition: campaignSituation.definition }];
    const runtime = structuredClone(state.campaignRuntime);
    runtime.campaignStatus = 'paused';
    assert.equal(projectPlayableSituations(definitions, [artifact], runtime).length, 2);
    assert.equal(campaignMethodsForTurn([artifact], new Set([campaignSituation.entryId]), runtime).length, 2);
    for (const status of ['succeeded', 'failed', 'superseded', 'cancelled']) {
      runtime.campaignStatus = 'active'; runtime.nodeStates[0].status = status;
      assert.deepEqual(projectPlayableSituations(definitions, [artifact], runtime), [worldSituation]);
      assert.equal(campaignMethodsForTurn([artifact], new Set([campaignSituation.entryId]), runtime).length, 0);
    }
    runtime.nodeStates[0].status = 'active';
    for (const status of ['completed', 'failed', 'ended']) {
      runtime.campaignStatus = status;
      assert.deepEqual(projectPlayableSituations(definitions, [artifact], runtime), [worldSituation]);
    }
    assert.equal(campaignSituation.definition.methods.length, 2);
    assert.equal(JSON.stringify(artifact), raw);
  } finally { h.db.close(); }
});

test('closeout: progress cannot depend on its own success and unbuilt future stages cannot claim concrete coverage', async () => {
  const model = candidateModel(); model.stages[1].coverage = 'concrete';
  const h = await fixture({ model });
  try {
    const row = await h.planStore.getPlanRevision('plan-t', 1);
    assert.equal(row.plan.nodes[1].coverage, 'provisional');
    assert.ok(row.plan.unresolvedDependencies.some(d => d.nodeId === 'stage-2'));
    const ctx = { visibleWorldEntryIds: new Set(require('./helpers/phase9CampaignFixture.cjs').baseEntries().map(e => e.entryId)),
      openingActorIds: new Set(['pc']), openingTemplateIds: new Set(['tpl-lin']), artifactSituationIds: new Set([require('./helpers/phase9CampaignFixture.cjs').SITUATION_ID]) };
    for (const field of ['completion','failure','cancellation']) {
      const plan = structuredClone(row.plan);
      plan.nodes[0][field] = { kind: 'any', of: [{ kind: 'campaign_node_status', nodeId: 'stage-1', status: 'succeeded' }, { kind: 'actor_alive', actorId: 'pc' }] };
      assert.ok(require('../dist/domain/campaignPlan/planValidation').validateCampaignPlan(plan, ctx).some(e => e.includes('self-dependent progress')));
    }
  } finally { h.db.close(); }
});

test('closeout: planning consumes adopted source entries with anchor filtering and changed source bindings stale a ready replan', async () => {
  const h = await fixture();
  try {
    const setup = await h.planStore.getSetup('setup-t');
    const published = (await h.worlds.getWorldPackage('w', 1)).entries;
    const added = { ...published.find(e => e.kind === 'lore'), entryId: 'lore-adopted', definition: { name: '已采用的新线索', text: '已确认的现场线索' } };
    const { ctx } = await require('../dist/application/campaignPlan/planningService').buildPlanningContext({ worldStore: h.worlds,
      intent: setup.intent, protagonistSkills: [], effectiveEntries: [...published, added] });
    assert.ok(ctx.visibleEntries.some(e => e.entryId === 'lore-adopted'));
    await h.session.changeCampaignGoal({ campaignId: h.campaignId, branchId: h.branchId, newGoal: '调查新的线索' });
    const job = await h.planStore.findActiveJob(h.branchId, 'replan');
    const run = await runReplanJob(deps(h, { async complete() { return { text: JSON.stringify(candidateModel()) }; } }), job.jobId, { ...args, intent: {} });
    assert.equal(run.status, 'candidate_ready');
    // Controlled same-version publication fault: no game result is invented.
    const state = await h.turns.getState(h.branchId);
    state.segmentContentBinding = { manifestHash: 'changed-after-freeze' };
    await h.adapter.execute('UPDATE snapshots SET snapshot_json=? WHERE branch_id=? AND state_version=?', [JSON.stringify(state), h.branchId, state.stateVersion]);
    const result = await adoptReplanCandidate({ db: h.adapter, planStore: h.planStore, turns: h.turns,
      campaignId: h.campaignId, branchId: h.branchId, candidateId: run.candidateId });
    assert.equal(result.outcome, 'stale'); assert.match(result.reason, /source content changed/);
  } finally { h.db.close(); }
});

test('closeout: current mainline remains reachable under the candidate cap and generic model suggestions', async () => {
  const h = await fixture();
  try {
    const { SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
    const state = await h.turns.getState(h.branchId);
    const summary = await h.session.getSummary(h.campaignId, h.branchId);
    const playerCard = summary.cards.find(c => c.actorId === 'pc');
    const artifact = JSON.parse(h.db.prepare('SELECT artifact_json FROM campaign_content_artifacts LIMIT 1').get().artifact_json);
    const definition = artifact.situations.find(s => s.entryId === SITUATION_ID).definition;
    const definitions = Array.from({ length: 9 }, (_, i) => ({ situationId: 'world-sit-' + i,
      definition: { ...definition, methods: [ { ...definition.methods[0], methodId: 'world-' + i, title: '普通调查' + i } ] } }));
    for (const { situationId } of definitions) state.situations.push({ ...state.situations[0], situationId });
    definitions.push({ situationId: SITUATION_ID, definition });
    const prepared = { branchId: h.branchId, nextState: state, domainEvents: [], lifeEvents: [], extraEvents: [] };
    const packet = require('../dist/application/guidance/packet').buildSituationPacket({ prepared, situationDefinitions: definitions,
      playerCard, visibleActorNames: new Map(), cards: summary.cards,
      entries: (await h.worlds.getWorldPackage('w', 1)).entries, preferredSituationId: SITUATION_ID });
    assert.equal(packet.allowedCandidates[0].situationId, SITUATION_ID);
    assert.ok(packet.allowedCandidates.length <= 12);
    const genericSteps = packet.allowedCandidates.filter(c => c.situationId !== SITUATION_ID).slice(0, 3)
      .map(c => ({ candidateRef: c.ref, title: c.title, rationale: c.goal, tradeoffs: c.tradeoffs, firstStepIntent: c.firstStepIntent }));
    const guide = require('../dist/application/guidance/validate').assembleTurnGuidance({ prepared,
      contract: { turnId: 'local' }, grade: 'success', llmSteps: genericSteps, llmSummary: null, packet,
      campaignId: h.campaignId, playerActorId: 'pc', blockedNames: [], situationDefinitions: definitions, playerCard,
      visibleActorNames: new Map(), contentBindingHash: 'h', knowledgeHash: 'k', contextHash: 'c' });
    assert.ok(guide.steps.some(s => s.situationId === SITUATION_ID && s.availability === 'available'));
    assert.ok(guide.steps.length <= 3);
    h.session.deps.guidance = new (require('../dist/infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(h.adapter);
    const local = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'local', localOnly: true });
    assert.ok(local.steps.some(s => s.situationId === SITUATION_ID && s.availability === 'available'));
  } finally { h.db.close(); }
});

test('closeout: opening and management decision points derive current actionable guidance without HTTP or a story card', async () => {
  let calls = 0;
  const h = await fixture({ onRequest: () => calls++ });
  try {
    h.session.deps.guidance = new (require('../dist/infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(h.adapter);
    for (const status of [null, 'paused', 'active']) {
      if (status) await h.session.setCampaignStatus({ campaignId: h.campaignId, branchId: h.branchId, status });
      const state = await h.turns.getState(h.branchId);
      const guide = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'refresh-current', localOnly: true });
      assert.equal(guide.decisionPoint.stateVersion, state.stateVersion);
      assert.ok(guide.steps.some(s => s.availability === 'available'));
      assert.deepEqual(await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'refresh-current', localOnly: true }), guide);
    }
    assert.equal(calls, 0);
  } finally { h.db.close(); }
});

test('closeout: a later pressure deadline cannot become the displayed reason for an earlier evidence-based stage completion', async () => {
  const model = candidateModel();
  model.stages[0].completion = { kind: 'counter_at_least', situationId: 'self', counterId: 'evidence', minimum: 1 };
  model.firstSituation.deadlineClockSeconds = 3600;
  const h = await fixture({ model });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: model.firstSituation.methods[0].firstStep.intent });
    const completedAt = (await h.turns.getState(h.branchId)).campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').resolvedAtVersion;
    await h.session.rest({ campaignId: h.campaignId, branchId: h.branchId, kind: 'long' });
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '在巷口稍作停留' });
    const after = await h.turns.getState(h.branchId);
    const situation = after.situations.find(s => s.situationId === require('./helpers/phase9CampaignFixture.cjs').SITUATION_ID);
    assert.ok(situation.resolvedAtVersion > completedAt, JSON.stringify({ situation, completedAt, clock: after.clockMinutes }));
    const progress = await h.session.getCampaignProgress(h.campaignId, h.branchId);
    assert.equal(progress.completedStages.find(s => s.nodeId === 'stage-1').resolution, undefined);
  } finally { h.db.close(); }
});

test('closeout: a durable ready replan is adopted without HTTP; changed facts retire it so explicit recovery can start fresh', async () => {
  for (const changed of [false, true]) {
    const h = await fixture(); let calls = 0;
    const provider = { async complete() { calls++; return { text: JSON.stringify(candidateModel()) }; } };
    try {
      const turnProvider = h.session.provider;
      h.session.provider = provider;
      h.session.profile = profile;
      await h.session.changeCampaignGoal({ campaignId: h.campaignId, branchId: h.branchId, newGoal: '护送林凡离开青石巷' });
      const job = await h.planStore.findActiveJob(h.branchId, 'replan');
      const run = await runReplanJob(deps(h, provider), job.jobId, { ...args, intent: {} });
      assert.equal(run.status, 'candidate_ready', run.errors.join('; ')); assert.equal(calls, 1);
      if (changed) {
        h.session.provider = turnProvider;
        await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
        const result = await adoptReplanCandidate({ db: h.adapter, planStore: h.planStore, turns: h.turns,
          campaignId: h.campaignId, branchId: h.branchId, candidateId: run.candidateId });
        assert.equal(result.outcome, 'stale'); assert.equal((await h.planStore.getJob(job.jobId)).status, 'stale');
      } else {
        assert.equal(await h.session.runCampaignReplan(h.campaignId, h.branchId, { automatic: true }), 'adopted');
        assert.equal(calls, 1, 'ready recovery does not dispatch');
      }
    } finally { h.db.close(); }
  }
});

test('closeout: observe and talk methods keep their authority effects when archived content carries optional skill metadata', async () => {
  const model = candidateModel();
  model.firstSituation.methods[0].firstStep.actionKind = 'observe';
  model.firstSituation.methods[0].requires = {};
  model.firstSituation.methods[1].firstStep.skillId = 'skill-observation';
  const h = await fixture({ model });
  try {
    h.session.deps.guidance = new (require('../dist/infra/sqlite/sqliteGuidanceStore').SqliteGuidanceStore)(h.adapter);
    for (const method of model.firstSituation.methods) {
      const before = await h.turns.getState(h.branchId);
      const guide = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'test', localOnly: true });
      const step = guide.steps.find(s => s.candidateRef.endsWith(':' + method.methodId));
      assert.equal(step.availability, 'available');
      const result = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
        intent: method.firstStep.intent, guidanceChoice: { decisionPoint: guide.decisionPoint, candidateRef: step.candidateRef } });
      const contract = JSON.parse((await h.turns.getStagedTurn(h.branchId, result.turnId)).actionContractJson);
      assert.equal(contract.methodRef.methodId, method.methodId);
      assert.ok(contract.campaignEffects);
      const after = await h.turns.getState(h.branchId);
      assert.ok(after.situations.some(s => s.status === 'resolved' || s.counters.evidence > (before.situations.find(b => b.situationId === s.situationId)?.counters.evidence ?? 0)));
    }
  } finally { h.db.close(); }
});

test('closeout: a world NPC in another scene cannot prove a currently executable first-stage route', async () => {
  const { compileCampaignPlan } = require('../dist/application/campaignPlan/localCompile');
  const { validateCampaignPlan } = require('../dist/domain/campaignPlan/planValidation');
  const h = await fixture();
  try {
    const { buildPlanningContext } = require('../dist/application/campaignPlan/planningService');
    const setup = await h.planStore.getSetup('setup-t');
    const { ctx } = await buildPlanningContext({ worldStore: h.worlds,
      intent: { ...setup.intent, openingAnchor: { ...setup.intent.openingAnchor, locationId: '别处' } }, protagonistSkills: [] });
    const model = candidateModel();
    model.firstSituation.methods[0].firstStep.targetEntryId = 'tpl-lin';
    const errors = []; const parsed = parseCampaignPlanCandidate(model, errors); assert.ok(parsed, errors.join('; '));
    const { plan, artifact } = compileCampaignPlan({ model: parsed, ctx, intent: setup.intent,
      planId: 'probe', revision: 1, parentRevision: null, createdAt: NOW });
    const context = { visibleWorldEntryIds: new Set(ctx.visibleEntries.map(e => e.entryId)),
      openingActorIds: ctx.openingActorIds, openingTemplateIds: ctx.openingTemplateIds,
      artifactSituationIds: new Set(artifact.situations.map(s => s.entryId)), protagonistSkills: ctx.protagonistSkills,
      presentActorRefs: ctx.presentActorRefs, protagonistSkillRanks: ctx.protagonistSkillRanks };
    assert.ok(validateCampaignPlan(plan, context, artifact).some(error => error.includes('executable at start')));
    artifact.situations[0].definition.methods[0].firstStep.targetEntryId = undefined;
    assert.ok(!validateCampaignPlan(plan, context, artifact).some(error => error.includes('executable at start')));
    artifact.situations[0].definition.methods[0].requires.minRank = 'master';
    assert.ok(validateCampaignPlan(plan, context, artifact).some(error => error.includes('executable at start')));
  } finally { h.db.close(); }
});

test('closeout: canon planning qualifications come from opening facts instead of caller-supplied future skills', async () => {
  const h = await fixture();
  try {
    const { buildPlanningContext } = require('../dist/application/campaignPlan/planningService');
    const setup = await h.planStore.getSetup('setup-t');
    const intent = { ...setup.intent, protagonistBinding: { actorId: 'pc', kind: 'canon', name: '林凡', canonEntityId: 'ent-lin' } };
    const { ctx } = await buildPlanningContext({ worldStore: h.worlds, intent, protagonistSkills: ['future-magic'] });
    assert.ok(!ctx.protagonistSkills.has('future-magic'));
    await assert.rejects(() => buildPlanningContext({ worldStore: h.worlds,
      intent: { ...intent, protagonistBinding: { ...intent.protagonistBinding, canonEntityId: 'unknown-later-character' } }, protagonistSkills: [] }), /没有可用身份/);
  } finally { h.db.close(); }
});

test('closeout: local contract errors share the one repair; recovery never resets its budget', async () => {
  const h = await fixture();
  try {
    await opening(h, 'repair-local'); let calls = 0;
    const bad = candidateModel(); bad.firstSituation.methods[0].outcomes.success.effects = [{ template: 'schedule_consequence', consequenceId: 'absent' }];
    const result = await runOpeningPlanJob(deps(h, { async complete(request) {
      calls++;
      if (calls === 2) { assert.ok(request.user.includes('absent')); assert.ok(request.user.includes('待修复候选')); }
      return { text: JSON.stringify(calls === 1 ? bad : candidateModel()) };
    } }), 'repair-local', args);
    assert.equal(result.status, 'candidate_ready', JSON.stringify(result)); assert.equal(calls, 2);
    assert.equal((await h.planStore.latestCandidateForJob('repair-local')).repairUsed, true);
    await opening(h, 'exhausted'); calls = 0;
    const provider = { async complete() { calls++; return { text: JSON.stringify(bad) }; } };
    const rejected = await runOpeningPlanJob(deps(h, provider), 'exhausted', args);
    assert.equal(rejected.status, 'invalid'); assert.equal(calls, 2);
    await runOpeningPlanJob(deps(h, provider), 'exhausted', args);
    assert.equal(calls, 2, 'restart cannot buy a third attempt');
  } finally { h.db.close(); }
});

test('closeout: importing twice into the source database preserves its immutable archives and rewards', async () => {
  const h = await fixture();
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const before = await h.turns.getState(h.branchId);
    const originalArchives = h.db.prepare('SELECT plan_json,campaign_id FROM campaign_plan_revisions ORDER BY plan_id,revision').all();
    const originalArtifact = await h.planStore.getArtifact(before.campaignContentBinding.artifactIds[0]);
    const save = await exportSave({ db: h.adapter, sha256Hex: async text => sha256HexOf(text), campaignId: h.campaignId, branchId: h.branchId, createdAt: NOW });
    for (const suffix of ['a','b']) {
      const campaignId = `import-${suffix}`; const branchId = `import-${suffix}-main`;
      await restoreSave({ db: h.adapter, sha256Hex: async text => sha256HexOf(text), save: save.save,
        newCampaignId: campaignId, newBranchId: branchId, createdAt: NOW });
      const imported = await h.turns.getState(branchId);
      assert.equal(imported.campaignRuntime.branchId, branchId);
      assert.notEqual(imported.campaignRuntime.planBinding.planId, before.campaignRuntime.planBinding.planId);
      const plan = await h.planStore.getPlanRevision(imported.campaignRuntime.planBinding.planId, 1);
      assert.equal(plan.plan.contentHash, imported.campaignRuntime.planBinding.contentHash);
      const artifact = await h.planStore.getArtifact(imported.campaignContentBinding.artifactIds[0]);
      assert.equal(artifact.campaignId, campaignId);
      const { contentHash, ...body } = artifact;
      assert.equal(contentHash, sha256HexOf(canonicalJsonOf(body)));
      const grants = imported.campaignRuntime.grantedRewardKeys.length;
      await h.session.playTurn({ campaignId, branchId, intent: '在巷口稍作停留' });
      assert.equal((await h.turns.getState(branchId)).campaignRuntime.grantedRewardKeys.length, grants);
    }
    assert.deepEqual(h.db.prepare('SELECT plan_json,campaign_id FROM campaign_plan_revisions WHERE campaign_id=? ORDER BY plan_id,revision').all(h.campaignId), originalArchives);
    assert.deepEqual(await h.planStore.getArtifact(originalArtifact.artifactId), originalArtifact);
    assert.deepEqual(await h.turns.getState(h.branchId), before);
  } finally { h.db.close(); }
});

test('closeout: paid response survives a ready-write crash; resume sends zero HTTP with frozen inputs', async () => {
  const h = await fixture();
  try {
    await opening(h, 'crash');
    let calls = 0;
    const provider = { async complete() { calls++; return { text: JSON.stringify(candidateModel()) }; } };
    const persist = h.planStore.upsertCandidate.bind(h.planStore);
    h.planStore.upsertCandidate = async (candidate, tx) => {
      if (candidate.stage === 'ready') throw new Error('injected ready-write crash');
      return persist(candidate, tx);
    };
    assert.equal((await runOpeningPlanJob(deps(h, provider), 'crash', args)).status, 'retryable_failed');
    assert.equal((await h.planStore.latestCandidateForJob('crash')).stage, 'raw_response');
    h.planStore.upsertCandidate = persist;
    const resumed = await runOpeningPlanJob(deps(h, provider), 'crash', { ...args, protagonistSkills: [], anchorTitle: 'live drift' });
    assert.equal(resumed.status, 'candidate_ready', JSON.stringify(resumed));
    assert.equal(resumed.physicalRequests, 0);
    assert.equal(calls, 1);
    assert.equal((await h.planStore.getSetup('crash')).status, 'proposal_ready');
  } finally { h.db.close(); }
});

test('closeout: cancellation during HTTP fences the response and never resurrects the setup', async () => {
  const h = await fixture();
  try {
    await opening(h, 'cancel');
    const result = await runOpeningPlanJob(deps(h, { async complete() {
      await h.planStore.deleteSetup('cancel'); return { text: JSON.stringify(candidateModel()) };
    } }), 'cancel', args);
    assert.equal(result.status, 'stale');
    assert.equal((await h.planStore.getJob('cancel')).status, 'cancelled');
    assert.equal(await h.planStore.latestCandidateForJob('cancel'), null);
  } finally { h.db.close(); }
});

test('closeout: corrupt frozen envelope is retained and refuses all new requests', async () => {
  const h = await fixture();
  try {
    await opening(h, 'corrupt');
    await runOpeningPlanJob(deps(h, { async complete() { throw new Error('offline before response'); } }), 'corrupt', args);
    await h.adapter.execute("UPDATE frozen_turn_material_roots SET payload_json='{}' WHERE root_id='campaign-job:corrupt'");
    let calls = 0;
    const result = await runOpeningPlanJob(deps(h, { async complete() { calls++; throw new Error('must not send'); } }), 'corrupt', args);
    assert.equal(result.status, 'invalid'); assert.equal(calls, 0);
    assert.equal(h.db.prepare("SELECT payload_json FROM frozen_turn_material_roots WHERE root_id='campaign-job:corrupt'").get().payload_json, '{}');
  } finally { h.db.close(); }
});

test('closeout: illegal completion/effects never degrade into a ready plan or fake success', () => {
  for (const mutate of [
    m => { m.stages[0].completion = { kind: 'made_up_condition' }; },
    m => { m.firstSituation.methods[0].outcomes.success.effects = [{ template: 'situation_status', situationId: 'self', status: 'custom_won' }]; },
    m => { m.consequences[0].trigger = { kind: 'all', of: [] }; },
    m => { m.stages[0].completion = { kind: 'counter_at_least', situationId: 'self', counterId: 'evidence', minimum: 'two' }; },
    m => { m.firstSituation.methods[0].outcomes.success.effects = [{ template: 'clock_advance', minutes: -1 }]; },
  ]) {
    const model = candidateModel(); mutate(model); const errors = [];
    assert.equal(parseCampaignPlanCandidate(model, errors), null); assert.ok(errors.length > 0);
  }
});

test('closeout: recovered ready candidate verifies both body hashes and cannot dispatch on corruption', async () => {
  const h = await fixture();
  try {
    await opening(h, 'ready-hash'); let calls = 0;
    const provider = { async complete() { calls++; return { text: JSON.stringify(candidateModel()) }; } };
    const first = await runOpeningPlanJob(deps(h, provider), 'ready-hash', args);
    assert.equal(first.status, 'candidate_ready');
    const candidate = await h.planStore.getCandidate(first.candidateId);
    candidate.plan.publicPitch = '被外部损坏的公开提案内容';
    // Recomputing only the candidate envelope cannot hide a stale plan hash.
    candidate.candidateHash = sha256HexOf(canonicalJsonOf({ plan: candidate.plan, artifact: candidate.artifact }));
    await h.planStore.upsertCandidate(candidate);
    assert.equal((await runOpeningPlanJob(deps(h, provider), 'ready-hash', args)).status, 'invalid');
    assert.equal(calls, 1);
  } finally { h.db.close(); }
});

test('closeout: changing intent during a paid response fences the old candidate before publication', async () => {
  const h = await fixture();
  try {
    await opening(h, 'edit-running');
    const result = await runOpeningPlanJob(deps(h, { async complete() {
      const setup = await h.planStore.getSetup('edit-running');
      await h.planStore.upsertSetup({ ...setup, intent: { ...setup.intent, intentRevision: 2, rawIntent: '新的完整意图', normalizedIntent: '新的完整意图' } });
      return { text: JSON.stringify(candidateModel()) };
    } }), 'edit-running', args);
    assert.equal(result.status, 'stale');
    assert.notEqual((await h.planStore.getSetup('edit-running')).status, 'proposal_ready');
    assert.notEqual((await h.planStore.latestCandidateForJob('edit-running'))?.stage, 'ready');
  } finally { h.db.close(); }
});

test('closeout: skill, resource cap and a newly directed relationship reward survive SQL projection stamping', async () => {
  const model = candidateModel();
  model.rewards[0].rewards.push({ kind: 'skill_rank', targetId: 'skill-observation', rank: 'expert' },
    { kind: 'resource_cap', targetId: 'stamina', delta: 2 },
    { kind: 'relationship', targetId: 'pc', toActorId: 'tpl-lin', delta: 1 });
  const h = await fixture({ model });
  try {
    const before = await h.turns.getState(h.branchId);
    const player = before.party.find(p => p.controller === 'player').actorId;
    const cap = before.cards.find(c => c.actorId === player).card.resourceMax.stamina;
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.cards.find(c => c.actorId === player).card.resourceMax.stamina, cap + 2);
    assert.equal(after.skills.find(s => s.actorId === player && s.skillId.replace(/^skill-/, '') === 'observation').rank, 'expert');
    assert.equal(after.relationships.find(r => r.fromActorId === player && r.toActorId === 'npc-tpl-lin').closeness, 1);
  } finally { h.db.close(); }
});

for (const companion of [false, true]) test(`closeout: template-addressed rewards commit to the actual ${companion ? 'companion' : 'scene NPC'} and survive cold reads`, async () => {
  const model = candidateModel();
  model.rewards[0].rewards.push({ kind: 'knowledge', targetId: 'lore-crates', toActorId: 'tpl-lin' },
    { kind: 'resource_cap', targetId: 'stamina', toActorId: 'tpl-lin', delta: 2 },
    { kind: 'relationship', targetId: 'tpl-lin', toActorId: 'pc', delta: 2 });
  const actorId = companion ? 'companion-lin' : 'npc-tpl-lin';
  const entries = require('./helpers/phase9CampaignFixture.cjs').baseEntries();
  if (companion) entries.find(e => e.entryId === 'tpl-lin').definition.recruitment = {
    recruitable: true, openingEligible: true, minimumCloseness: 0,
    openingRelationship: { stance: 'friendly', closeness: 2 },
  };
  const h = await fixture({ model, entries, companions: companion ? [{ actorId, templateId: 'tpl-lin' }] : [] });
  try {
    const before = await h.turns.getState(h.branchId);
    assert.equal(before.cards.filter(c => c.card.templateId === 'tpl-lin').length, 1,
      'a selected companion and scene template represent one actual person');
    const card = before.cards.find(c => c.actorId === actorId).card;
    const cap = card.resourceMax.stamina;
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const after = await h.turns.getState(h.branchId);
    assert.ok(after.discoveries.some(d => d.entryId === 'lore-crates' && d.actorId === actorId));
    assert.equal(after.discoveries.some(d => d.actorId === 'tpl-lin'), false, 'a template is not a runtime knowledge owner');
    assert.equal(after.cards.find(c => c.actorId === actorId).card.resourceMax.stamina, cap + 2);
    assert.equal(after.relationships.find(r => r.fromActorId === actorId && r.toActorId === 'pc').closeness,
      (before.relationships.find(r => r.fromActorId === actorId && r.toActorId === 'pc')?.closeness ?? 0) + 2);
    assert.equal(after.actors['tpl-lin'], undefined);
    const persisted = await h.adapter.queryOne('SELECT card_json FROM actor_cards WHERE branch_id=? AND actor_id=?', [h.branchId, actorId]);
    assert.equal(JSON.parse(persisted.card_json).resourceMax.stamina, cap + 2);
    await h.session.rest({ campaignId: h.campaignId, branchId: h.branchId, kind: 'short' });
    assert.equal((await h.turns.getState(h.branchId)).cards.find(c => c.actorId === actorId).card.resourceMax.stamina, cap + 2);
  } finally { h.db.close(); }
});

test('closeout: a reward cannot commit knowledge to a scoped template with no instantiated owner', async () => {
  const model = candidateModel();
  model.stages[0].completion = { kind: 'counter_at_least', situationId: 'self', counterId: 'evidence', minimum: 1 };
  model.rewards[0].rewards.push({ kind: 'knowledge', targetId: 'lore-crates', toActorId: 'tpl-lin' });
  const entries = require('./helpers/phase9CampaignFixture.cjs').baseEntries();
  entries.find(e => e.kind === 'scene').definition.actors = [];
  const h = await fixture({ model, entries });
  try {
    const before = await h.turns.getState(h.branchId);
    await assert.rejects(h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '仔细查看现场' }),
      /人物.*未实例化或有歧义/);
    assert.deepEqual(await h.turns.getState(h.branchId), before, 'atomic failure retains the snapshot and reward grant keys');
    assert.equal((await h.turns.getState(h.branchId)).discoveries.some(d => d.actorId === 'tpl-lin'), false);
  } finally { h.db.close(); }
});

test('closeout: resource penalties and healing are bounded in the frozen four-grade contract', async () => {
  const model = candidateModel();
  for (const grade of ['success','full_success','failure','severe_failure']) model.firstSituation.methods[1].outcomes[grade].effects.push(
    { template: 'resource_change', actorId: 'pc', resourceId: 'stamina', amount: -10 },
    { template: 'resource_change', actorId: 'pc', resourceId: 'hp', amount: 10 });
  const h = await fixture({ model });
  try {
    const before = await h.turns.getState(h.branchId);
    const player = before.actors.pc;
    const result = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.actors.pc.resources.stamina, 0);
    assert.equal(after.actors.pc.resources.hp, before.cards.find(c => c.actorId === 'pc').card.resourceMax.hp);
    const turn = h.db.prepare('SELECT action_contract_json FROM turns WHERE branch_id=? AND turn_id=?').get(h.branchId, result.turnId);
    const contract = JSON.parse(turn.action_contract_json);
    for (const grade of ['success','full_success','failure','severe_failure']) {
      const penalty = contract.outcomes[grade].effects.find(e => e.op === 'consumeResource' && e.resourceId === 'stamina');
      assert.equal(penalty.amount, player.resources.stamina);
      assert.ok(contract.outcomes[grade].effects.find(e => e.op === 'restoreResource' && e.resourceId === 'hp').cap > 0);
    }
  } finally { h.db.close(); }
});

test('closeout: a second campaign penalty at zero stamina commits without zero-valued effects', async () => {
  const model = candidateModel();
  for (const grade of ['success','full_success','failure','severe_failure']) {
    model.firstSituation.methods[0].outcomes[grade].effects.push(
      { template: 'resource_change', actorId: 'pc', resourceId: 'stamina', amount: -10 },
      { template: 'resource_change', actorId: 'pc', resourceId: 'stamina', amount: -1 });
  }
  const h = await fixture({ model });
  try {
    const input = { campaignId: h.campaignId, branchId: h.branchId, intent: '仔细查看青石巷现场，寻找值得注意的细节与线索' };
    await h.session.playTurn(input);
    assert.equal((await h.turns.getState(h.branchId)).actors.pc.resources.stamina, 0);
    const second = await h.session.playTurn(input);
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.stateVersion, 2);
    assert.equal(after.actors.pc.resources.stamina, 0);
    assert.equal((await h.turns.getCommittedTurn(h.branchId, second.turnId)).turnId, second.turnId);
    const contract = JSON.parse((await h.turns.getStagedTurn(h.branchId, second.turnId)).actionContractJson);
    for (const grade of ['success','full_success','failure','severe_failure']) {
      assert.equal(contract.outcomes[grade].effects.some(e => e.op === 'consumeResource' && e.resourceId === 'stamina'), false);
      assert.ok(contract.campaignEffects[grade].transitions.some(t => t.kind === 'situation_counter') || grade.endsWith('failure'));
    }
  } finally { h.db.close(); }
});

test('closeout: an invented reputation resource cannot become a playable candidate', async () => {
  const h = await fixture();
  try {
    await opening(h, 'unknown-resource'); const bad = candidateModel();
    bad.firstSituation.methods[0].outcomes.severe_failure.effects.push({ template: 'resource_change', actorId: 'pc', resourceId: 'reputation', amount: -1 });
    let calls = 0;
    const result = await runOpeningPlanJob(deps(h, { async complete() { calls++; return { text: JSON.stringify(bad) }; } }), 'unknown-resource', args);
    assert.equal(result.status, 'invalid'); assert.equal(calls, 2); assert.match(result.errors.join(' '), /unknown resources/);
  } finally { h.db.close(); }
});

test('closeout: rejected replans stay bounded automatically and a player can explicitly request a fresh job', async () => {
  const h = await fixture();
  try {
    let calls = 0, valid = false;
    h.session.provider = { async complete() { calls++; return { text: valid ? JSON.stringify(candidateModel()) : '{bad-json' }; } };
    await assert.rejects(() => h.session.runCampaignReplan(h.campaignId, h.branchId), /JSON|invalid|解析/);
    assert.equal(calls, 2);
    assert.equal(await h.session.runCampaignReplan(h.campaignId, h.branchId, { automatic: true }), 'no_change');
    assert.equal(calls, 2);
    valid = true;
    assert.equal(await h.session.runCampaignReplan(h.campaignId, h.branchId), 'adopted');
    assert.equal(calls, 3);
    assert.equal((await h.turns.getState(h.branchId)).campaignRuntime.planBinding.revision, 2);
  } finally { h.db.close(); }
});

test('closeout: forked rewards remain spent after the next real production settlement', async () => {
  const h = await fixture();
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const before = await h.turns.getState(h.branchId);
    const target = h.branchId + '-reward';
    await forkBranch({ db: h.adapter, turnStore: h.turns, gameStore: new SqliteGameStore(h.adapter), sourceBranchId: h.branchId,
      targetBranchId: target, campaignId: h.campaignId, forkTurnId: null, createdAt: NOW });
    await h.session.playTurn({ campaignId: h.campaignId, branchId: target, intent: '在巷口稍作停留' });
    const after = await h.turns.getState(target);
    assert.equal(after.campaignRuntime.grantedRewardKeys.length, before.campaignRuntime.grantedRewardKeys.length);
    assert.equal(after.relationships[0].closeness, before.relationships[0].closeness);
    assert.equal(after.discoveries.length, before.discoveries.length);
  } finally { h.db.close(); }
});

test('closeout: a consequence persists across two decisions and applies authority once at its later trigger', async () => {
  const model = candidateModel();
  model.consequences[0].trigger = { kind: 'counter_at_least', situationId: 'self', counterId: 'evidence', minimum: 2 };
  model.consequences[0].effects = [{ template: 'relationship_shift', fromActorId: 'tpl-lin', toActorId: 'player', delta: 1 },
    { template: 'record_event', eventType: 'lin_called_in_favor', summary: '林凡兑现了合作承诺' }];
  for (const grade of ['success','full_success']) model.firstSituation.methods[1].outcomes[grade].effects = [
    { template: 'schedule_consequence', consequenceId: 'lin-favor' }];
  const h = await fixture({ model });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const scheduled = await h.turns.getState(h.branchId);
    const base = scheduled.relationships[0].closeness;
    for (let i = 0; i < 2; i++) await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '在巷口稍作停留' });
    assert.equal((await h.turns.getState(h.branchId)).campaignRuntime.deferredConsequences[0].status, 'pending');
    for (let i = 0; i < 2; i++) await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '仔细查看现场' });
    const triggered = await h.turns.getState(h.branchId);
    assert.equal(triggered.campaignRuntime.deferredConsequences[0].status, 'triggered');
    assert.equal(triggered.relationships[0].closeness, base + 1, 'effect changed the committed relationship');
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '在巷口稍作停留' });
    assert.equal((await h.turns.getState(h.branchId)).relationships[0].closeness, base + 1);
  } finally { h.db.close(); }
});

test('closeout: pause permits exploration and keeps the objective; resume restores the active node', async () => {
  const h = await fixture();
  try {
    const before = await h.turns.getState(h.branchId);
    await h.session.setCampaignStatus({ campaignId: h.campaignId, branchId: h.branchId, status: 'paused' });
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '在巷口稍作停留' });
    assert.equal((await h.session.getCampaignProgress(h.campaignId, h.branchId)).currentObjective, before.campaignRuntime.publicObjectiveProjection);
    assert.equal((await h.turns.getState(h.branchId)).campaignRuntime.nodeStates[0].status, 'suspended');
    await h.session.setCampaignStatus({ campaignId: h.campaignId, branchId: h.branchId, status: 'active' });
    assert.equal((await h.turns.getState(h.branchId)).campaignRuntime.nodeStates[0].status, 'active');
  } finally { h.db.close(); }
});

test('closeout: replan uses complete current intent, adopts new content with outbox, and preserves committed nodes', async () => {
  const h = await fixture();
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const original = await h.turns.getState(h.branchId);
    const raw = '护送林凡离开。' + '必须先保证知情人的安全；'.repeat(40);
    await h.session.changeCampaignGoal({ campaignId: h.campaignId, branchId: h.branchId, newGoal: '护送林凡', newRawIntent: raw });
    const model = candidateModel(); model.proposal.longTermGoal = '护送林凡'; model.rewards = [];
    model.stages[0].nodeId = 'escort-prepare'; model.stages[0].next = ['escort-finish'];
    model.stages[1].nodeId = 'escort-finish'; model.stages[1].dependsOn = ['escort-prepare'];
    model.stages[1].activation = { kind: 'node_succeeded', nodeId: 'escort-prepare' };
    model.endings[0].condition.nodeId = 'escort-finish';
    const job = await h.planStore.findActiveJob(h.branchId, 'replan');
    let calls = 0;
    const run = await runReplanJob(deps(h, { async complete(request) {
      calls++; assert.ok(request.user.includes(raw)); assert.ok(request.user.includes('npc-tpl-lin'));
      return { text: JSON.stringify(model) };
    } }), job.jobId, { ...args, intent: { rawIntent: 'stale caller intent' } });
    assert.equal(run.status, 'candidate_ready', JSON.stringify(run)); assert.equal(calls, 1);
    const candidate = await h.planStore.getCandidate(run.candidateId);
    assert.notEqual(candidate.artifact.situations[0].entryId, 'camp-sit-open');
    const adopted = await adoptReplanCandidate({ db: h.adapter, planStore: h.planStore, turns: h.turns,
      campaignId: h.campaignId, branchId: h.branchId, candidateId: run.candidateId });
    assert.equal(adopted.outcome, 'adopted', JSON.stringify(adopted));
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'escort-prepare').status, 'active');
    assert.ok(after.campaignContentBinding.artifactIds.includes(candidate.artifact.artifactId));
    assert.equal(after.campaignRuntime.intent.rawIntent, raw);
    assert.equal(after.campaignRuntime.intentRevision, 2);
    assert.equal(after.campaignRuntime.grantedRewardKeys.length, original.campaignRuntime.grantedRewardKeys.length);
    assert.ok(h.db.prepare("SELECT handoff_id FROM frozen_turn_postprocess_outbox WHERE branch_id=? AND turn_id LIKE '%manage-replan%'").get(h.branchId));
    const revision = await h.planStore.getPlanRevision(after.campaignRuntime.planBinding.planId, after.campaignRuntime.planBinding.revision);
    assert.equal(revision.intent.rawIntent, raw);
    // Continued play and save import must resolve both old and new artifacts.
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '在巷口稍作停留' });
    // The production postprocessor runs after play returns. Export keeps its
    // stable-boundary guard; wait for the local worker instead of racing it.
    for (let i = 0; i < 200 && h.db.prepare("SELECT COUNT(*) n FROM frozen_turn_postprocess_outbox WHERE branch_id=? AND status='running'").get(h.branchId).n; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM frozen_turn_postprocess_outbox WHERE branch_id=? AND status='running'").get(h.branchId).n, 0);
    const save = await exportSave({ db: h.adapter, sha256Hex: async text => sha256HexOf(text), campaignId: h.campaignId, branchId: h.branchId, createdAt: NOW });
    await restoreSave({ db: h.adapter, sha256Hex: async text => sha256HexOf(text), save: save.save, newCampaignId: 'replan-import', newBranchId: 'replan-import-main', createdAt: NOW });
    await h.session.playTurn({ campaignId: 'replan-import', branchId: 'replan-import-main', intent: '在巷口稍作停留' });
    await assert.rejects(() => h.adapter.transaction(tx => h.planStore.archivePlanRevision(tx, {
      plan: revision.plan, intent: revision.intent, setupId: 'x', campaignId: 'other', sourceTrigger: 'tamper', intentHash: revision.plan.intentHash, adoptedAt: NOW })), /UNIQUE/);
  } finally { h.db.close(); }
});

test('closeout A40: 100/300/1000 production decisions keep runtime, queries and jobs bounded', { timeout: 120000 }, async () => {
  const samples = []; let calls = 0;
  const h = await fixture({ onRequest: () => { calls++; } });
  try {
    const started = performance.now();
    for (let i = 1; i <= 1000; i++) {
      await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '在巷口稍作停留' });
      if (![100,300,1000].includes(i)) continue;
      const queryStart = performance.now(); const state = await h.turns.getState(h.branchId);
      const queryMs = performance.now() - queryStart;
      const runtimeBytes = Buffer.byteLength(JSON.stringify(state.campaignRuntime));
      const jobs = h.db.prepare('SELECT COUNT(*) n FROM campaign_plan_jobs WHERE branch_id=?').get(h.branchId).n;
      assert.ok(runtimeBytes < 20000); assert.ok(state.campaignRuntime.recentProgressLines.length <= 5);
      assert.ok(jobs <= 1, 'unchanged trigger cannot spawn endless planning jobs');
      const runtimeStructuralBytes = Buffer.byteLength(JSON.stringify({ ...state.campaignRuntime, stateVersion: 0 }));
      samples.push({ decisions: i, stateVersion: state.stateVersion, snapshotBytes: Buffer.byteLength(JSON.stringify(state)), runtimeBytes, runtimeStructuralBytes,
        queryMs, elapsedMs: performance.now() - started, jobs, calls });
    }
    assert.equal(calls, 2000, 'ordinary turns use only Planner and Narrator');
    assert.equal(samples[2].runtimeStructuralBytes, samples[0].runtimeStructuralBytes);
    fs.mkdirSync('.tmp/phase9', { recursive: true });
    fs.writeFileSync('.tmp/phase9/reaccept-longrun.json', JSON.stringify({ kind: 'production-session-local-deterministic', samples }, null, 2));
  } finally { h.db.close(); }
});
