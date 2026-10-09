/** Independent acceptance counterexamples. Expected to fail until repaired.
 * Run after npm run build:core. Uses production compile/adopt/Session/SQLite;
 * the fixture provider and RNG are engineering controls, never real journeys.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel } = require('../../../tests/helpers/phase9CampaignFixture.cjs');

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
