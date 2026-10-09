/** Independent acceptance counterexamples. Production regression fixtures for repaired settlement defects.
 * Run after npm run build:core. Uses production compile/adopt/Session/SQLite;
 * the fixture provider and RNG are engineering controls, never real journeys.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel } = require('./helpers/phase9CampaignFixture.cjs');
const { settleCampaignProgress } = require('../dist/application/campaignPlan/settlement');

test('reward closure also applies during opening adoption without an extra action', async () => {
  const model = candidateModel();
  model.stages[0].completion = { kind: 'actor_alive', actorId: 'tpl-lin' };
  model.stages[1].completion = { kind: 'knowledge_known', entryId: 'lore-crates' };
  model.endings[0].condition = { kind: 'quest_succeeded', questId: 'quest-future' };
  const h = await fixture({ model });
  try {
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-2').status, 'succeeded');
    assert.equal(state.campaignRuntime.campaignStatus, 'active');
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM turns').get().n, 1, 'only the initial adoption record exists');
    assert.equal(state.campaignRuntime.grantedRewardKeys.length, 1);
  } finally { h.db.close(); }
});

test('pending nested consequences resolve their archived templates after a revision', async () => {
  const model = candidateModel();
  model.consequences[0].trigger = { kind: 'committed_event', eventType: 'later_trigger' };
  model.consequences[0].effects.push({ template: 'schedule_consequence', consequenceId: 'followup' });
  model.consequences.push({ consequenceId: 'followup', description: '原先承诺的后续请求', visibility: 'public',
    trigger: { kind: 'committed_event', eventType: 'lin_called_in_favor' },
    effects: [{ template: 'record_event', eventType: 'original_followup', summary: '原先承诺的后果' }] });
  const h = await fixture({ model });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const state = await h.turns.getState(h.branchId);
    const binding = state.campaignRuntime.planBinding;
    const { plan } = await h.planStore.getPlanRevision(binding.planId, binding.revision);
    const [original] = await h.planStore.listArtifactsForCampaign(h.campaignId);
    const revision = structuredClone(original);
    revision.artifactId += '-revision'; revision.planRevision += 1;
    revision.consequenceTemplates[0].effectSpecs[0].summary = '修订后的另一份承诺';
    revision.consequenceTemplates[1].effectSpecs[0].eventType = 'revised_followup';
    plan.revision += 1; state.campaignRuntime.planBinding.revision += 1;
    const events = settleCampaignProgress({ nextState: state, turnId: 'later-commit', nextStateVersion: state.stateVersion+1,
      plan, artifacts: [revision, original], transactionEvents: [{ eventType: 'later_trigger', payload: {} }], historyEvents: [] });
    assert.equal(events.filter(e => e.eventType === 'original_followup').length, 1);
    assert.equal(events.filter(e => e.eventType === 'revised_followup').length, 0);
    const ambiguous = structuredClone(original);
    ambiguous.artifactId += '-ambiguous';
    ambiguous.consequenceTemplates[1].effectSpecs[0].eventType = 'ambiguous_followup';
    const before = await h.turns.getState(h.branchId);
    const basePlan = (await h.planStore.getPlanRevision(before.campaignRuntime.planBinding.planId,
      before.campaignRuntime.planBinding.revision)).plan;
    assert.throws(() => settleCampaignProgress({ nextState: before, turnId: 'ambiguous', nextStateVersion: before.stateVersion+1,
      plan: basePlan, artifacts: [ambiguous, original], transactionEvents: [{ eventType: 'later_trigger', payload: {} }], historyEvents: [] }), /有歧义/);
  } finally { h.db.close(); }
});

test('nested consequence closure applies four effects and leaves the fifth pending across commits', async () => {
  const model = candidateModel();
  const root = model.consequences[0];
  root.effects.push({ template: 'schedule_consequence', consequenceId: 'follow-2' });
  for (let i = 2; i <= 6; i++) model.consequences.push({ consequenceId: `follow-${i}`,
    description: `林凡请求的第${i}个后续后果`, visibility: 'public',
    trigger: { kind: 'committed_event', eventType: i === 2 ? 'lin_called_in_favor' : `follow_event_${i-1}` },
    effects: [{ template: 'record_event', eventType: `follow_event_${i}`, summary: '后续负担已送达' },
      { template: 'schedule_consequence', consequenceId: i < 6 ? `follow-${i+1}` : 'lin-favor' }] });
  const h = await fixture({ model });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const first = await h.turns.getState(h.branchId);
    assert.equal(first.campaignRuntime.deferredConsequences.filter(c => c.status === 'triggered').length, 4);
    assert.equal(first.campaignRuntime.deferredConsequences.find(c => c.consequenceId === 'follow-5').status, 'pending');
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM branch_events WHERE event_type='follow_event_5'").get().n, 0);
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '环顾四周' });
    const second = await h.turns.getState(h.branchId);
    assert.equal(second.campaignRuntime.deferredConsequences.length, 6, 'the cycle back to its root dedupes');
    assert.equal(second.campaignRuntime.deferredConsequences.filter(c => c.status === 'triggered').length, 6);
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '环顾四周' });
    for (let i = 2; i <= 6; i++) assert.equal(h.db.prepare('SELECT COUNT(*) n FROM branch_events WHERE event_type=?').get(`follow_event_${i}`).n, 1);
  } finally { h.db.close(); }
});

test('reward re-evaluation shares one eight-transition allowance for the whole commit', async () => {
  const h = await fixture();
  try {
    const state = await h.turns.getState(h.branchId);
    const binding = state.campaignRuntime.planBinding;
    const { plan } = await h.planStore.getPlanRevision(binding.planId, binding.revision);
    const artifacts = await h.planStore.listArtifactsForCampaign(h.campaignId);
    plan.possibleEndings = [];
    const seed = plan.nodes[1];
    for (let i = 3; i <= 10; i++) {
      plan.nodes.push({ ...structuredClone(seed), nodeId: `stage-${i}`, activation: null,
        statusDependencies: [], completion: { kind: 'knowledge_known', entryId: 'lore-crates' } });
      state.campaignRuntime.nodeStates.push({ nodeId: `stage-${i}`, status: 'planned', completedEvidence: [] });
    }
    plan.nodes[0].completion = { kind: 'actor_alive', actorId: 'npc-tpl-lin' };
    plan.nodes[1].completion = { kind: 'knowledge_known', entryId: 'lore-crates' };
    const events = settleCampaignProgress({ nextState: state, turnId: 'bounded-commit', nextStateVersion: state.stateVersion+1,
      plan, artifacts, transactionEvents: [], historyEvents: [] });
    assert.ok(events.filter(e => e.eventType === 'campaign_node_changed').length <= 8);
    assert.ok(state.campaignRuntime.nodeStates.some(n => n.status === 'planned'), 'remaining stages stay available to later commits');
    assert.ok(state.discoveries.some(d => d.entryId === 'lore-crates'));
  } finally { h.db.close(); }
});

test('R60: a stage reward satisfies downstream progress in the same commit', async () => {
  const model = candidateModel();
  model.stages[1].completion = { kind: 'knowledge_known', entryId: 'lore-crates' };
  const h = await fixture({ model });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
      intent: '向林凡打听青石巷最近的情况' });
    const state = await h.turns.getState(h.branchId);
    assert.ok(state.discoveries.some(d => d.entryId === 'lore-crates' && d.actorId === 'pc'));
    assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-2').status, 'succeeded',
      'reward knowledge is authoritative now; it must not require an extra player action');
    assert.equal(state.campaignRuntime.campaignStatus, 'completed');
  } finally { h.db.close(); }
});

test('R61: a triggered consequence retains its declared follow-up consequence', async () => {
  const model = candidateModel();
  model.consequences[0].effects.push({ template: 'schedule_consequence', consequenceId: 'lin-followup' });
  model.consequences.push({ consequenceId: 'lin-followup', description: '第二个后果回应林凡的请求',
    visibility: 'public', trigger: { kind: 'committed_event', eventType: 'lin_called_in_favor' },
    effects: [{ template: 'record_event', eventType: 'lin_followup_delivered', summary: '后续请求已送达' }] });
  const h = await fixture({ model });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
      intent: '向林凡打听青石巷最近的情况' });
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.campaignRuntime.deferredConsequences.find(c => c.consequenceId === 'lin-favor').status, 'triggered');
    assert.ok(state.campaignRuntime.deferredConsequences.some(c => c.consequenceId === 'lin-followup'),
      'the accepted schedule_consequence effect must be registered, never silently discarded');
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM branch_events WHERE branch_id=? AND event_type='lin_followup_delivered'").get(h.branchId).n, 1);
  } finally { h.db.close(); }
});
