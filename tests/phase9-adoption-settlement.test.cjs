/** Engineering fixtures only; these commits do not count as real journeys. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, baseEntries } = require('./helpers/phase9CampaignFixture.cjs');

function revisionModel() {
  const model = candidateModel();
  model.stages[0].nodeId = 'stage-2';
  model.stages[0].completion = { kind: 'knowledge_known', entryId: 'lore-crates' };
  model.stages[0].dependsOn = ['stage-1'];
  model.stages[0].next = ['stage-3'];
  model.stages[1].nodeId = 'stage-3';
  model.stages[1].activation.nodeId = 'stage-2';
  model.stages[1].dependsOn = ['stage-2'];
  model.endings[0].condition.nodeId = 'stage-3';
  model.rewards = [{ policyId: 'rp-next', nodeId: 'stage-2', description: '林凡的准备', rewards: [
    { kind: 'knowledge', targetId: 'lore-crates', toActorId: 'tpl-lin' },
    { kind: 'resource_cap', targetId: 'hp', toActorId: 'tpl-lin', delta: 1 },
  ] }];
  return model;
}

test('opening adoption applies an already satisfied stage reward to snapshot and durable projections once', async () => {
  const model = candidateModel();
  model.stages[0].completion = { kind: 'actor_alive', actorId: 'tpl-lin' };
  model.rewards[0].rewards = [
    { kind: 'resource_cap', targetId: 'hp', toActorId: 'tpl-lin', delta: 1 },
    { kind: 'relationship', targetId: 'tpl-lin', toActorId: 'pc', delta: 2 },
    { kind: 'knowledge', targetId: 'lore-crates', toActorId: 'tpl-lin' },
  ];
  const h = await fixture({ model });
  try {
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    assert.equal(state.campaignRuntime.grantedRewardKeys.length, 1);
    assert.equal(state.cards.find(c => c.actorId === 'npc-tpl-lin').card.resourceMax.hp, 9);
    const stored = JSON.parse(h.db.prepare('SELECT card_json FROM actor_cards WHERE branch_id=? AND actor_id=?').get(h.branchId, 'npc-tpl-lin').card_json);
    assert.equal(stored.resourceMax.hp, 9, 'cold card projection agrees with the committed reward');
    assert.equal(state.relationships.find(r => r.fromActorId === 'npc-tpl-lin' && r.toActorId === 'pc').closeness, 2);
    assert.equal(h.db.prepare('SELECT closeness FROM relationships WHERE branch_id=? AND from_actor_id=? AND to_actor_id=?').get(h.branchId, 'npc-tpl-lin', 'pc').closeness, 2);
    assert.ok(state.discoveries.some(d => d.entryId === 'lore-crates' && d.actorId === 'npc-tpl-lin'));
    const events = h.db.prepare('SELECT event_type FROM branch_events WHERE branch_id=?').all(h.branchId).map(r => r.event_type);
    assert.equal(events.filter(t => t === 'campaign_reward_granted').length, 1);
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '环顾四周' });
    const later = await h.turns.getState(h.branchId);
    assert.equal(later.cards.find(c => c.actorId === 'npc-tpl-lin').card.resourceMax.hp, 9, 'later play never applies the reward twice');
  } finally { h.db.close(); }
});

test('an uninstantiated replan reward owner rejects adoption without consuming consequences or switching archives', async () => {
  const entries = baseEntries();
  entries.push({ ...structuredClone(entries.find(e => e.entryId === 'tpl-lin')), entryId: 'tpl-away' });
  const model = candidateModel();
  model.consequences[0].trigger = { kind: 'node_succeeded', nodeId: 'stage-2' };
  const h = await fixture({ entries, model });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const before = await h.turns.getState(h.branchId);
    const archived = h.db.prepare('SELECT plan_json FROM campaign_plan_revisions').all();
    const revision = revisionModel();
    revision.rewards[0].rewards = [{ kind: 'knowledge', targetId: 'lore-crates', toActorId: 'tpl-away' }];
    h.session.provider = { async complete() { return { text: JSON.stringify(revision) }; } };
    await assert.rejects(h.session.runCampaignReplan(h.campaignId, h.branchId), /未实例化或有歧义/);
    assert.deepEqual(await h.turns.getState(h.branchId), before, 'all prepared authority rolls back');
    assert.deepEqual(h.db.prepare('SELECT plan_json FROM campaign_plan_revisions').all(), archived, 'adopted archives remain immutable');
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM campaign_plan_jobs WHERE branch_id=? AND status='candidate_ready'").get(h.branchId).n, 1);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM branch_events WHERE branch_id=? AND event_type='campaign_consequence_triggered'").get(h.branchId).n, 0);
  } finally { h.db.close(); }
});

test('a committed ending is evaluated after the triggered consequence effects, never against an intermediate draft', async () => {
  const model = candidateModel();
  model.consequences[0].effects = [{ template: 'relationship_shift', fromActorId: 'tpl-lin', toActorId: 'pc', delta: 3 }];
  const obligation = { kind: 'relationship_at_least', fromActorId: 'tpl-lin', toActorId: 'pc', closeness: 3 };
  model.endings = [
    { endingId: 'safe', title: '平安离开', publicDescription: '事情已经结束。', outcomeKind: 'success', condition: {
      kind: 'all', of: [{ kind: 'node_succeeded', nodeId: 'stage-1' }, { kind: 'not', of: [obligation] }],
    } },
    { endingId: 'owed', title: '代价兑现', publicDescription: '请求成为后续负担。', outcomeKind: 'failure', condition: obligation },
  ];
  const h = await fixture({ model });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const after = await h.turns.getState(h.branchId);
    assert.ok(after.relationships.find(r => r.fromActorId === 'npc-tpl-lin' && r.toActorId === 'pc').closeness >= 3);
    assert.equal(after.campaignRuntime.ending.endingId, 'owed', 'the selected ending matches the persisted post-consequence facts');
    assert.equal(after.campaignRuntime.campaignStatus, 'failed');
    const endings = h.db.prepare("SELECT payload_json FROM branch_events WHERE branch_id=? AND event_type='campaign_ending'").all(h.branchId);
    assert.equal(endings.length, 1);
    assert.equal(JSON.parse(endings[0].payload_json).endingId, 'owed');
  } finally { h.db.close(); }
});

for (const completion of [
  { kind: 'knowledge_known', entryId: 'lore-crates' },
  { kind: 'committed_event', eventType: 'situation_resolved' },
]) test(`replan adoption settles consequences and rewards from ${completion.kind}`, async () => {
  const model = candidateModel();
  model.consequences[0].trigger = { kind: 'node_succeeded', nodeId: 'stage-2' };
  model.consequences[0].effects = [
    { template: 'resource_change', actorId: 'tpl-lin', resourceId: 'hp', amount: -1 },
    { template: 'relationship_shift', fromActorId: 'tpl-lin', toActorId: 'pc', delta: 2 },
    { template: 'record_event', eventType: 'lin_called_in_favor', summary: '林凡兑现请求' },
  ];
  const h = await fixture({ model });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const before = await h.turns.getState(h.branchId);
    assert.equal(before.campaignRuntime.deferredConsequences[0].status, 'pending');
    const revision = revisionModel();
    // This opening stage is satisfied by a previously committed local effect,
    // rather than by a new decision or a model assertion.
    revision.stages[0].completion = completion;
    const turnProvider = h.session.provider;
    h.session.provider = { async complete() { return { text: JSON.stringify(revision) }; } };
    assert.equal(await h.session.runCampaignReplan(h.campaignId, h.branchId), 'adopted');
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-2').status, 'succeeded', 'adoption reads committed branch history');
    assert.equal(after.campaignRuntime.deferredConsequences[0].status, 'triggered');
    assert.equal(after.actors['npc-tpl-lin'].resources.hp, before.actors['npc-tpl-lin'].resources.hp - 1, 'triggered means effects were applied');
    assert.equal(after.cards.find(c => c.actorId === 'npc-tpl-lin').card.resourceMax.hp, 9);
    assert.ok(after.discoveries.some(d => d.entryId === 'lore-crates' && d.actorId === 'npc-tpl-lin'));
    assert.equal(after.clockSeconds, before.clockSeconds, 'adoption itself does not advance game time');
    const count = () => h.db.prepare("SELECT COUNT(*) n FROM branch_events WHERE branch_id=? AND event_type='lin_called_in_favor'").get(h.branchId).n;
    assert.equal(count(), 1);
    h.session.provider = turnProvider;
    for (let i = 0; i < 2; i++) await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '环顾四周' });
    const later = await h.turns.getState(h.branchId);
    assert.equal(later.actors['npc-tpl-lin'].resources.hp, after.actors['npc-tpl-lin'].resources.hp);
    assert.equal(later.cards.find(c => c.actorId === 'npc-tpl-lin').card.resourceMax.hp, 9);
    assert.equal(count(), 1, 'later commits do not repeat an adoption consequence');
  } finally { h.db.close(); }
});
