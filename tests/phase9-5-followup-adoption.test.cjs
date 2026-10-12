const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel } = require('./helpers/phase9CampaignFixture.cjs');
const { canonicalJsonOf } = require('../dist/application/campaignPlan/hashing');
const { buildStructuralRepairGuidance } = require('../dist/application/campaignPlan/generationService');

// Synthetic public content only. Real rejected responses and snapshots remain
// in the ignored evidence directory; no provider or device is contacted.
function longFollowup() {
  const model = candidateModel();
  const stage = model.stages[1];
  model.stages = Array.from({ length: 6 }, (_, i) => ({
    ...structuredClone(i ? stage : model.stages[0]), nodeId: `stage-${i + 1}`,
    title: `核实阶段${i + 1}`, publicObjective: `完成第${i + 1}项独立核实`,
    activation: i ? { kind: 'node_succeeded', nodeId: `stage-${i}` } : null,
    completion: { kind: 'committed_event', eventType: `stage_${i + 1}_done` },
    dependsOn: i ? [`stage-${i}`] : [], next: i < 5 ? [`stage-${i + 2}`] : [],
  }));
  model.stages[3].completion = { kind: 'all', of: [model.stages[3].completion,
    { kind: 'knowledge_known', entryId: 'lore-crates' }] };
  model.stages[5].completion = { kind: 'all', of: [model.stages[5].completion,
    { kind: 'committed_event', eventType: 'settlement_secured' }] };
  model.endings = [{ ...model.endings[0], condition: { kind: 'node_succeeded', nodeId: 'stage-6' } }];
  model.rewards = [];
  delete model.firstSituation.deadlineClockSeconds;
  for (const method of model.firstSituation.methods) {
    method.difficultyPolicy = { kind: 'fixed', band: 'normal' };
    method.evidencePolicy = { kind: 'fixed', evidenceIds: [] };
    method.evidenceAllowlist = [];
    for (const grade of ['success', 'full_success']) method.outcomes[grade].effects = [
      { template: 'record_event', eventType: 'stage_1_done', summary: '第一项调查得到可核实事实' },
      { template: 'schedule_consequence', consequenceId: 'cons-crest-truth' },
      { template: 'schedule_consequence', consequenceId: 'cons-settlement' },
    ];
  }
  model.consequences = [
    { consequenceId: 'cons-crest-truth', description: '调查后获得补充核实资料', visibility: 'public',
      trigger: { kind: 'node_succeeded', nodeId: 'stage-3' },
      effects: [{ template: 'grant_knowledge', entryId: 'lore-crates' }] },
    { consequenceId: 'cons-settlement', description: '实绩核实后获得合作回应', visibility: 'public',
      trigger: { kind: 'node_succeeded', nodeId: 'stage-5' },
      effects: [{ template: 'record_event', eventType: 'settlement_secured', summary: '实绩使合作落实' },
        { template: 'relationship_shift', fromActorId: 'pc', toActorId: 'tpl-lin', delta: 1 }] },
  ];
  return model;
}

test('information-only method repair explains an independent preparation consumer without fabricating completion', () => {
  const model = candidateModel();
  model.firstSituation.methods[0].outcomes.success.effects = [{ template: 'record_event', eventType: 'directions_checked', summary: '合成准备信息' }];
  const guidance = buildStructuralRepairGuidance([
    'method sweep: an ordinary-success event must be consumed by this or a reachable public campaign goal, or accompany a durable state effect.',
  ], model);
  assert.match(guidance, /method sweep 的成功事件（directions_checked/);
  assert.match(guidance, /候选：ask-lin/);
  assert.match(guidance, /requires.condition 正向消费/);
  assert.match(guidance, /首次准备不得关闭局面或宣称远期目标已完成/);
});

test('BUG-95-001 production repair creates/adopts a new revision and its selected route commits, preserving prior archives', async t => {
  const original = longFollowup();
  const h = await fixture({ model: original, lengthPreference: 'long', includeGuidance: true });
  t.after(() => h.db.close());
  const state = await h.turns.getState(h.branchId);
  const oldCandidate = canonicalJsonOf(await h.planStore.getCandidate('cand-t'));
  const oldPlan = h.db.prepare('SELECT plan_json FROM campaign_plan_revisions WHERE plan_id=? AND revision=1').get(state.campaignRuntime.planBinding.planId).plan_json;
  const oldSnapshot = h.db.prepare('SELECT snapshot_json FROM snapshots WHERE branch_id=? AND state_version=?').get(h.branchId, state.stateVersion).snapshot_json;
  const invalid = structuredClone(original);
  invalid.stages[3].completion = invalid.stages[3].completion.of[0];
  invalid.stages[5].completion = invalid.stages[5].completion.of[0];
  invalid.consequences[1].trigger = { kind: 'committed_event', eventType: 'stage_5_done' };
  const invalidBody = canonicalJsonOf(invalid);
  let calls = 0;
  h.session.provider = { async complete(request) {
    calls++;
    if (calls === 2) {
      assert.match(request.user, /consequence cons-crest-truth: no later stage or ending consumes/);
      assert.match(request.user, /consequence cons-settlement: trigger must wait/);
      assert.match(request.user, /consequence cons-settlement: no later stage or ending consumes/);
      assert.match(request.user, /consequence cons-crest-truth：/);
      assert.match(request.user, /consequence cons-settlement：/);
      assert.match(request.user, /按新的 trigger 节点重新选择/);
    }
    assert.ok(calls <= 2, 'one bounded synthetic generation and one structural repair');
    return { text: JSON.stringify(calls === 1 ? invalid : original) };
  } };
  assert.equal(await h.session.runCampaignReplan(h.campaignId, h.branchId), 'adopted');
  assert.equal(calls, 2);
  const adopted = await h.turns.getState(h.branchId);
  assert.equal(adopted.campaignRuntime.planBinding.revision, state.campaignRuntime.planBinding.revision + 1);
  const revision = await h.planStore.getPlanRevision(adopted.campaignRuntime.planBinding.planId, adopted.campaignRuntime.planBinding.revision);
  assert.equal(revision.plan.parentRevision, 1);
  const guide = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'offline-new-revision', localOnly: true });
  const step = guide.steps.find(s => s.methodId === 'ask-lin' && s.availability === 'available');
  assert.ok(step, 'new adopted revision supplies a player-selectable route');
  const requests = [];
  h.session.provider = { async complete(request) {
    requests.push(request.role);
    assert.equal(request.role, 'Narrator', 'the selected fixed method needs no synthetic Planner');
    const value = JSON.parse(request.user);
    return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '核实取得阶段事实，后续回应等待实际履约。' }) };
  } };
  const turn = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: step.firstStepIntent,
    guidanceChoice: { decisionPoint: guide.decisionPoint, candidateRef: step.candidateRef } });
  assert.ok(await h.turns.getCommittedTurn(h.branchId, turn.turnId));
  const after = await h.turns.getState(h.branchId);
  assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
  assert.equal(after.campaignRuntime.deferredConsequences.length, 2);
  assert.ok(after.campaignRuntime.deferredConsequences.every(c => c.status === 'pending'), 'both delayed effects wait for later required stages');
  assert.deepEqual(requests, ['Narrator']);
  assert.equal(canonicalJsonOf(invalid), invalidBody);
  assert.equal(canonicalJsonOf(await h.planStore.getCandidate('cand-t')), oldCandidate);
  assert.equal(h.db.prepare('SELECT plan_json FROM campaign_plan_revisions WHERE plan_id=? AND revision=1').get(state.campaignRuntime.planBinding.planId).plan_json, oldPlan);
  assert.equal(h.db.prepare('SELECT snapshot_json FROM snapshots WHERE branch_id=? AND state_version=?').get(h.branchId, state.stateVersion).snapshot_json, oldSnapshot);
});
