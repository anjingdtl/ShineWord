/** P9-O1 engineering evidence only: real Session/SQLite, controlled LLM/RNG. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
const { enqueueReplan, runReplanJob, adoptReplanCandidate } = require('../dist/application/campaignPlan/replanService');
const { canonicalJsonOf } = require('../dist/application/campaignPlan/hashing');
const { readPlanFreeze } = require('../dist/application/campaignPlan/jobFreeze');
const { evaluateStagePreparationTarget } = require('../dist/application/campaignPlan/stagePreparation');

const PROFILE = { endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'low',
  capabilities: { contextWindow: 60000, maxOutputTokens: 12000, supportsJson: true } };
const REASONS = ['stage_content_prepared_ahead', 'stage_content_target:stage-2'];

function nextStageModel() {
  const model = candidateModel();
  const remap = value => Array.isArray(value) ? value.map(remap) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, key === 'situationId' && nested === 'self' ? SITUATION_ID : remap(nested)])) : value;
  model.stages[0] = { ...model.stages[0], completion: remap(model.stages[0].completion), situationRef: SITUATION_ID };
  model.stages[1] = { ...model.stages[1], coverage: 'concrete', completion: candidateModel().stages[0].completion };
  model.rewards = [];
  return model;
}

async function context(h) {
  const state = await h.turns.getState(h.branchId);
  const revision = await h.planStore.getPlanRevision(state.campaignRuntime.planBinding.planId, state.campaignRuntime.planBinding.revision);
  return { state, plan: revision.plan, intent: state.campaignRuntime.intent ?? revision.intent };
}
async function queued(h, extra = [], now) {
  const { state, plan } = await context(h);
  return enqueueReplan({ deps: { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, provider: {}, profile: PROFILE, now },
    campaignId: h.campaignId, branchId: h.branchId, plan, runtime: state.campaignRuntime, state, reasons: [...REASONS, ...extra] });
}
async function generate(h, jobId, provider = { complete: async () => ({ text: JSON.stringify(nextStageModel()) }) }) {
  const { intent } = await context(h);
  return runReplanJob({ db: h.adapter, planStore: h.planStore, worldStore: h.worlds, profile: PROFILE, provider }, jobId,
    { intent, protagonistSkills: ['skill-observation'], anchorTitle: '当前局势', playerName: '旅人' });
}
const adopt = (h, candidateId) => adoptReplanCandidate({ db: h.adapter, planStore: h.planStore, turns: h.turns,
  campaignId: h.campaignId, branchId: h.branchId, candidateId });

test('P9-O1: an active stage queues its nearest missing successor before completion, single-flight and zero director calls', async () => {
  const requests = [];
  const h = await fixture({ onRequest: request => requests.push(request.role) });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '仔细查看青石巷现场' });
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.campaignRuntime.primaryNodeId, 'stage-1');
    assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'active');
    const job = await h.planStore.findActiveJob(h.branchId, 'replan');
    assert.ok(job, 'next stage must be queued while the current stage is still active');
    assert.ok(job.triggerReasons.includes(REASONS[0]));
    assert.ok(job.triggerReasons.includes(REASONS[1]));
    assert.deepEqual(requests, ['Planner', 'Narrator']);
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '再次查看青石巷现场' });
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM campaign_plan_jobs WHERE branch_id=? AND job_kind='replan'").get(h.branchId).n, 1);
  } finally { h.db.close(); }
});

test('P9-O1: entering automatic preparation schedules the missing successor without requiring a filler turn', async () => {
  let calls = 0;
  const h = await fixture({ provider: { complete: async () => { calls++; return { text: JSON.stringify(nextStageModel()) }; } } });
  try {
    assert.equal(await h.session.runCampaignReplan(h.campaignId, h.branchId, { automatic: true }), 'adopted');
    assert.equal(calls, 1);
    const { state, plan } = await context(h);
    assert.equal(state.campaignRuntime.primaryNodeId, 'stage-1');
    assert.equal(plan.nodes.find(n => n.nodeId === 'stage-2').coverage, 'concrete');
  } finally { h.db.close(); }
});

test('P9-O1: generated content belongs only to the successor; adoption preserves the current stage and delays future pressure', async () => {
  const h = await fixture();
  try {
    const before = await context(h);
    const job = await queued(h);
    const result = await generate(h, job.jobId);
    assert.equal(result.status, 'candidate_ready', result.errors.join('; '));
    const candidate = await h.planStore.getCandidate(result.candidateId);
    assert.equal(candidate.artifact.situations[0].nodeId, 'stage-2');
    assert.equal(canonicalJsonOf(candidate.plan.nodes.find(n => n.nodeId === 'stage-1')),
      canonicalJsonOf(before.plan.nodes.find(n => n.nodeId === 'stage-1')), 'an active board cannot be replaced by its successor');
    assert.deepEqual(candidate.plan.possibleEndings, before.plan.possibleEndings);
    const frozen = await readPlanFreeze(h.adapter, job.jobId);
    assert.match(frozen.materials.system, /stage-2/);
    assert.equal((await adopt(h, result.candidateId)).outcome, 'adopted');
    const after = await context(h);
    const successor = after.plan.nodes.find(n => n.nodeId === 'stage-2');
    const board = after.state.situations.find(s => s.situationId === successor.situationRef);
    assert.equal(board.status, 'dormant');
    assert.equal(board.dueAtClockSeconds, undefined);
    assert.equal(after.state.campaignRuntime.primaryNodeId, 'stage-1');
    assert.deepEqual(after.state.actors, before.state.actors);
    assert.equal(after.state.clockSeconds, before.state.clockSeconds);
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const completed = await h.turns.getState(h.branchId);
    assert.equal(completed.campaignRuntime.primaryNodeId, 'stage-2');
    assert.equal(completed.situations.find(s => s.situationId === successor.situationRef).status, 'active');
    assert.equal(completed.situations.find(s => s.situationId === successor.situationRef).dueAtClockSeconds, completed.clockSeconds + 3600);
    assert.equal(await h.planStore.findActiveJob(h.branchId, 'replan'), null, 'stage transition must use the prepared board');
  } finally { h.db.close(); }
});

test('P9-O1: stage-content preparation inherits endings without rewriting the raw model response', async () => {
  const model = nextStageModel();
  delete model.endings;
  const rawText = JSON.stringify(model);
  const h = await fixture();
  try {
    const before = await context(h);
    const job = await queued(h);
    const result = await generate(h, job.jobId, { complete: async () => ({ text: rawText }) });
    assert.equal(result.status, 'candidate_ready', result.errors.join('; '));
    const candidate = await h.planStore.getCandidate(result.candidateId);
    assert.deepEqual(candidate.plan.possibleEndings, before.plan.possibleEndings);
    assert.equal(candidate.rawResponseText, rawText, 'audit retains the exact provider response');
    assert.equal(JSON.parse(candidate.rawResponseText).endings, undefined, 'the parser placeholder is never persisted');
  } finally { h.db.close(); }
});

test('P9-O1: stage-content preparation compiles only its frozen successor and ignores unrelated model provenance', async () => {
  const model = nextStageModel();
  model.stages[0] = { ...model.stages[0], provenance: {
    kind: 'canon_inspired', sourceFactIds: ['not-in-the-frozen-catalog'], rationale: '模型改写的其他阶段来源',
  } };
  const rawText = JSON.stringify(model);
  const h = await fixture();
  try {
    const before = await context(h);
    const job = await queued(h);
    let calls = 0;
    const result = await generate(h, job.jobId, { complete: async () => { calls++; return { text: rawText }; } });
    assert.equal(result.status, 'candidate_ready', result.errors.join('; '));
    assert.equal(calls, 1, 'scope projection avoids paying for repair of a node the job cannot change');
    const candidate = await h.planStore.getCandidate(result.candidateId);
    assert.deepEqual(candidate.plan.nodes.find(node => node.nodeId === 'stage-1'), before.plan.nodes.find(node => node.nodeId === 'stage-1'));
    assert.deepEqual(candidate.plan.nodes.find(node => node.nodeId === 'stage-2').completion,
      before.plan.nodes.find(node => node.nodeId === 'stage-2').completion,
      'stage-content preparation must preserve the frozen successor completion condition');
    assert.deepEqual(candidate.plan.possibleEndings, before.plan.possibleEndings);
    assert.equal(candidate.rawResponseText, rawText, 'scope projection does not rewrite the audited provider response');
  } finally { h.db.close(); }
});

test('P9-O1: stage-content preparation drops newly authored long consequences from a single-stage scope', async () => {
  const model = nextStageModel();
  const consequenceId = 'stage-content-too-soon';
  model.stages[1] = { ...model.stages[1], consequenceRefs: [consequenceId] };
  model.consequences = [{ consequenceId, description: '在后继阶段结算的新后果。',
    trigger: { kind: 'node_succeeded', nodeId: 'stage-2' }, effects: [{ template: 'record_event', eventType: 'too_soon_effect', summary: '新后果' }], visibility: 'public' }];
  for (const method of model.firstSituation.methods) for (const outcome of Object.values(method.outcomes)) {
    outcome.effects = [...outcome.effects, { template: 'schedule_consequence', consequenceId }];
  }
  const rawText = JSON.stringify(model);
  const h = await fixture();
  try {
    const job = await queued(h);
    const result = await generate(h, job.jobId, { complete: async () => ({ text: rawText }) });
    assert.equal(result.status, 'candidate_ready', result.errors.join('; '));
    const candidate = await h.planStore.getCandidate(result.candidateId);
    assert.equal(candidate.rawResponseText, rawText, 'the original provider response remains auditable');
    assert.equal(candidate.artifact.consequenceTemplates.length, 0, 'a one-stage materialization cannot author a long consequence');
    for (const situation of candidate.artifact.situations) for (const method of situation.definition.methods) {
      for (const outcome of Object.values(method.outcomeTemplates)) {
        assert.ok(outcome.effects.every(effect => effect.template !== 'schedule_consequence'));
      }
    }
  } finally { h.db.close(); }
});

test('P9-O1: an in-flight turn holds a ready candidate without invalidation or repeated generation', async () => {
  const h = await fixture();
  try {
    const job = await queued(h);
    let calls = 0;
    const provider = { complete: async () => { calls++; return { text: JSON.stringify(nextStageModel()) }; } };
    const result = await generate(h, job.jobId, provider);
    assert.equal(result.status, 'candidate_ready', result.errors.join('; '));
    await h.adapter.execute("INSERT INTO turns (branch_id,turn_id,expected_state_version,status,public_summary,effects_json,action_contract_json,action_contract_hash,created_at) VALUES (?,'in-flight',0,'Planned','','[]','{}','fixture',?)", [h.branchId, new Date().toISOString()]);
    const refused = await adopt(h, result.candidateId);
    assert.match(refused.reason, /in-flight/);
    assert.equal((await h.planStore.getJob(job.jobId)).status, 'candidate_ready');
    assert.equal((await generate(h, job.jobId, provider)).status, 'candidate_ready');
    assert.equal(calls, 1);
    await h.adapter.execute("DELETE FROM turns WHERE branch_id=? AND turn_id='in-flight'", [h.branchId]);
    assert.equal((await adopt(h, result.candidateId)).outcome, 'adopted');
  } finally { h.db.close(); }
});

test('P9-O1: current-stage completion during generation stales the old facts, preserving the player commit', async () => {
  const h = await fixture();
  try {
    const job = await queued(h);
    const result = await generate(h, job.jobId, { complete: async () => {
      await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
      return { text: JSON.stringify(nextStageModel()) };
    } });
    assert.equal(result.status, 'candidate_ready', result.errors.join('; '));
    const committed = canonicalJsonOf(await h.turns.getState(h.branchId));
    const outcome = await adopt(h, result.candidateId);
    assert.equal(outcome.outcome, 'stale');
    assert.match(outcome.reason, /facts changed/);
    assert.equal(canonicalJsonOf(await h.turns.getState(h.branchId)), committed);
  } finally { h.db.close(); }
});

test('P9-O1: a goal-change fence during generation cannot publish or adopt the old successor', async () => {
  const h = await fixture();
  try {
    const job = await queued(h);
    let calls = 0;
    const result = await generate(h, job.jobId, { complete: async () => {
      calls++;
      await h.session.changeCampaignGoal({ campaignId: h.campaignId, branchId: h.branchId, newGoal: '先护送林凡离开' });
      return { text: JSON.stringify(nextStageModel()) };
    } });
    assert.equal(result.status, 'stale');
    assert.equal(calls, 1);
    assert.equal((await h.planStore.getJob(job.jobId)).status, 'stale');
    assert.notEqual((await h.planStore.latestCandidateForJob(job.jobId))?.stage, 'ready');
    assert.equal((await h.turns.getState(h.branchId)).campaignRuntime.publicObjectiveProjection, '先护送林凡离开');
  } finally { h.db.close(); }
});

test('P9-O1: two failed preparations of one node stop automatic scheduling and expose a public failure notice', async () => {
  const h = await fixture();
  try {
    for (let i = 0; i < 2; i++) {
      const job = await queued(h, ['explicit-fixture:' + i]);
      const claimed = await h.planStore.claimJob(job.jobId, 'fixture', '2099-01-01T00:00:00.000Z', new Date().toISOString());
      assert.ok(claimed);
      await h.planStore.transitionJob(job.jobId, claimed.fencingToken, 'invalid', { lastError: 'fixture failure' });
    }
    const held = await queued(h, ['another-local-trigger']);
    assert.equal(held.merged, true, 'do not create a third automatic job for the same missing node');
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM campaign_plan_jobs WHERE branch_id=? AND job_kind='replan'").get(h.branchId).n, 2);
    assert.match((await h.session.getCampaignProgress(h.campaignId, h.branchId)).preparationNotice, /准备失败/);
  } finally { h.db.close(); }
});

test('P9-O1: an already prepared nearest successor, pause or terminal campaign does not expand distant nodes', async () => {
  const h = await fixture();
  try {
    const { state, plan } = await context(h);
    assert.equal(evaluateStagePreparationTarget({ state, plan, runtime: state.campaignRuntime }).nodeId, 'stage-2');
    assert.equal(evaluateStagePreparationTarget({ state, plan, runtime: { ...state.campaignRuntime, campaignStatus: 'paused' } }), null);
    assert.equal(evaluateStagePreparationTarget({ state, plan, runtime: { ...state.campaignRuntime, campaignStatus: 'ended' } }), null);
    const preparedPlan = { ...plan, nodes: [...plan.nodes.map(n => n.nodeId === 'stage-2'
      ? { ...n, coverage: 'concrete', situationRef: 'next-board', nextNodeIds: ['stage-3'] } : n),
      { ...plan.nodes[1], nodeId: 'stage-3' }] };
    const preparedState = { ...state, situations: [...state.situations, { ...state.situations[0], situationId: 'next-board', status: 'dormant' }] };
    assert.equal(evaluateStagePreparationTarget({ plan: preparedPlan, state: preparedState, runtime: state.campaignRuntime }), null);
  } finally { h.db.close(); }
});

test('P9-O1: pausing an adopted stage does not permanently suppress its prepared board', async () => {
  const h = await fixture();
  try {
    const job = await queued(h);
    const result = await generate(h, job.jobId);
    assert.equal(result.status, 'candidate_ready', result.errors.join('; '));
    assert.equal((await adopt(h, result.candidateId)).outcome, 'adopted');
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const { plan } = await context(h);
    const sid = plan.nodes.find(n => n.nodeId === 'stage-2').situationRef;
    await h.session.setCampaignStatus({ campaignId: h.campaignId, branchId: h.branchId, status: 'paused' });
    await h.session.rest({ campaignId: h.campaignId, branchId: h.branchId, kind: 'short' });
    assert.equal((await h.turns.getState(h.branchId)).situations.find(s => s.situationId === sid).status, 'active');
    await h.session.setCampaignStatus({ campaignId: h.campaignId, branchId: h.branchId, status: 'active' });
    assert.equal((await h.turns.getState(h.branchId)).campaignRuntime.primaryNodeId, 'stage-2');
  } finally { h.db.close(); }
});

test('P9-O1: a prepared future board is absent from the current Narrator packet', async () => {
  const requests = [];
  const h = await fixture({ onRequest: request => requests.push(request) });
  try {
    const job = await queued(h);
    const model = nextStageModel();
    model.firstSituation.summary = '这条只属于尚未进入阶段的未来机会不能提前出现';
    model.firstSituation.pressureDescription = '尚未开始的后继阶段压力';
    const result = await generate(h, job.jobId, { complete: async () => ({ text: JSON.stringify(model) }) });
    assert.equal(result.status, 'candidate_ready', result.errors.join('; '));
    assert.equal((await adopt(h, result.candidateId)).outcome, 'adopted');
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '仔细查看青石巷现场' });
    const narrator = requests.find(request => request.role === 'Narrator');
    assert.ok(narrator);
    assert.ok(!narrator.user.includes(model.firstSituation.summary));
    assert.ok(!narrator.user.includes(model.firstSituation.pressureDescription));
    assert.equal((await h.turns.getState(h.branchId)).campaignRuntime.primaryNodeId, 'stage-1');
  } finally { h.db.close(); }
});

test('P9-O1: an unknown preparation cannot be replaced or dispatched automatically even after a goal change', async () => {
  let calls = 0;
  const h = await fixture({ provider: { complete: async () => { calls++; throw Error('must not dispatch'); } } });
  try {
    const job = await queued(h);
    const claimed = await h.planStore.claimJob(job.jobId, 'fixture', '2099-01-01T00:00:00.000Z', new Date().toISOString());
    await h.planStore.transitionJob(job.jobId, claimed.fencingToken, 'outcome_unknown', { lastError: 'unknown sent result' });
    const before = canonicalJsonOf(await h.planStore.getJob(job.jobId));
    assert.equal(await h.session.runCampaignReplan(h.campaignId, h.branchId, { automatic: true }), 'no_change');
    await h.session.changeCampaignGoal({ campaignId: h.campaignId, branchId: h.branchId, newGoal: '先护送林凡离开' });
    assert.equal(await h.session.runCampaignReplan(h.campaignId, h.branchId, { automatic: true }), 'no_change');
    assert.equal(calls, 0);
    assert.equal(canonicalJsonOf(await h.planStore.getJob(job.jobId)), before);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM campaign_plan_jobs WHERE branch_id=? AND job_kind='replan'").get(h.branchId).n, 1);
  } finally { h.db.close(); }
});

test('P9-O1: recovery refuses a changed job scope without changing the frozen root or calling a provider', async () => {
  const h = await fixture();
  try {
    const job = await queued(h);
    const first = await generate(h, job.jobId, { complete: async () => { throw Error('controlled local provider failure'); } });
    assert.equal(first.status, 'retryable_failed');
    const original = h.db.prepare('SELECT payload_json,content_hash FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:' + job.jobId);
    await h.adapter.execute('UPDATE campaign_plan_jobs SET trigger_reasons_json=? WHERE job_id=?',
      [JSON.stringify(['stage_content_prepared_ahead', 'stage_content_target:stage-1']), job.jobId]);
    let calls = 0;
    const recovered = await generate(h, job.jobId, { complete: async () => { calls++; return { text: JSON.stringify(nextStageModel()) }; } });
    assert.equal(recovered.status, 'invalid');
    assert.equal(calls, 0);
    assert.deepEqual(h.db.prepare('SELECT payload_json,content_hash FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:' + job.jobId), original);
  } finally { h.db.close(); }
});

test('P9-O1: a changed nearest node replaces only an unfrozen queued scope; a running scope is immutable', async () => {
  const model = candidateModel();
  model.stages[1].next = ['stage-3'];
  model.stages.push({ ...model.stages[1], nodeId: 'stage-3', next: [], dependsOn: ['stage-2'],
    activation: { kind: 'node_succeeded', nodeId: 'stage-2' } });
  model.endings[0].condition = { kind: 'node_succeeded', nodeId: 'stage-3' };
  const h = await fixture({ model });
  try {
    const now = () => '2026-10-09T09:00:00.000Z';
    const first = await queued(h, [], now);
    const { state, plan } = await context(h);
    const second = await enqueueReplan({ deps: { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, provider: {}, profile: PROFILE, now },
      campaignId: h.campaignId, branchId: h.branchId, plan, runtime: state.campaignRuntime, state,
      reasons: ['stage_content_prepared_ahead', 'stage_content_target:stage-3'] });
    assert.equal(second.merged, true);
    assert.equal(second.jobId, first.jobId, 'unstarted preparation uses the same bounded queue');
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM campaign_plan_jobs WHERE branch_id=?').get(h.branchId).n, 1);
    assert.deepEqual((await h.planStore.getJob(second.jobId)).triggerReasons, ['stage_content_prepared_ahead', 'stage_content_target:stage-3']);
    await h.planStore.claimJob(second.jobId, 'fixture', '2099-01-01T00:00:00.000Z', new Date().toISOString());
    const held = await queued(h, [], now);
    assert.equal(held.jobId, second.jobId);
    assert.equal(held.merged, true);
    assert.deepEqual((await h.planStore.getJob(second.jobId)).triggerReasons, ['stage_content_prepared_ahead', 'stage_content_target:stage-3']);
  } finally { h.db.close(); }
});

test('P9-O1: same-millisecond replacement after a known rejection selects the latest running repair', async () => {
  const h = await fixture();
  try {
    const now = () => '2026-10-09T09:00:00.000Z';
    const first = await queued(h, [], now);
    await h.adapter.execute("UPDATE campaign_plan_jobs SET status='invalid' WHERE job_id=?", [first.jobId]);
    const { state, plan } = await context(h);
    const repair = await enqueueReplan({ deps: { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, provider: {}, profile: PROFILE, now },
      campaignId: h.campaignId, branchId: h.branchId, plan, runtime: state.campaignRuntime, state,
      reasons: ['player_requested:known-rejection-repair'] });
    assert.notEqual(repair.jobId, first.jobId);
    await h.planStore.claimJob(repair.jobId, 'fixture', '2099-01-01T00:00:00.000Z', now());
    const held = await queued(h, [], now);
    assert.equal(held.jobId, repair.jobId);
    assert.deepEqual((await h.planStore.getJob(repair.jobId)).triggerReasons, ['player_requested:known-rejection-repair']);
    assert.equal((await h.planStore.getJob(first.jobId)).status, 'invalid');
  } finally { h.db.close(); }
});
