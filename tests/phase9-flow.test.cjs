const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, baseEntries, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');

test('flow: a method business event completes and rewards its stage in the emitting commit', async () => {
  const model = candidateModel();
  model.stages[0].completion = { kind: 'committed_event', eventType: 'evidence_verified' };
  for (const grade of ['success','full_success']) model.firstSituation.methods[1].outcomes[grade].effects = [
    { template: 'record_event', eventType: 'evidence_verified', summary: '林凡核实证据' }];
  const h = await fixture({ model });
  try {
    const result = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.stateVersion, result.stateVersion);
    assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    assert.ok(state.discoveries.some(d => d.entryId === 'lore-crates'));
    const event = h.db.prepare("SELECT turn_id,state_version FROM branch_events WHERE branch_id=? AND event_type='campaign_reward_granted'").get(h.branchId);
    assert.equal(event.turn_id, result.turnId);
    assert.equal(event.state_version, result.stateVersion);
  } finally { h.db.close(); }
});

test('flow: local rest triggers deferred effects, stage rewards and a replan without HTTP', async () => {
  const model = candidateModel();
  model.stages[0].completion = { kind: 'committed_event', eventType: 'rest_completed' };
  model.consequences[0].trigger = { kind: 'committed_event', eventType: 'rest_completed' };
  model.consequences[0].effects = [{ template: 'relationship_shift', fromActorId: 'tpl-lin', toActorId: 'player', delta: 1 }];
  let calls = 0; const h = await fixture({ model, onRequest: () => calls++ });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const before = await h.turns.getState(h.branchId); calls = 0;
    await h.session.rest({ campaignId: h.campaignId, branchId: h.branchId, kind: 'short' });
    const after = await h.turns.getState(h.branchId);
    assert.equal(calls, 0);
    assert.equal(after.stateVersion, before.stateVersion + 1);
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    assert.equal(after.campaignRuntime.deferredConsequences[0].status, 'triggered');
    assert.equal(after.relationships.find(r => r.fromActorId === 'npc-tpl-lin' && r.toActorId === 'pc').closeness, 1);
    assert.ok(after.discoveries.some(d => d.entryId === 'lore-crates'));
    assert.ok(await h.planStore.findActiveJob(h.branchId, 'replan'));
    await h.session.rest({ campaignId: h.campaignId, branchId: h.branchId, kind: 'short' });
    assert.equal((await h.turns.getState(h.branchId)).campaignRuntime.grantedRewardKeys.length, 1);
  } finally { h.db.close(); }
});

for (const businessEvent of ['encounter_started', 'combat_action_passed']) {
  test(`flow: ${businessEvent} settles campaign progress through local combat commits`, async () => {
    const model = candidateModel(); model.stages[0].completion = { kind: 'committed_event', eventType: businessEvent };
    let calls = 0; const h = await fixture({ model, onRequest: () => calls++ });
    try {
      let view = await h.session.beginEncounter({ campaignId: h.campaignId, branchId: h.branchId, hostiles: [{ templateId: 'tpl-lin' }] });
      if (businessEvent === 'combat_action_passed') {
        for (let i = 0; i < 4 && !view.currentActorIsPlayer; i++) view = await h.session.encounterNpcTurn({ campaignId: h.campaignId, branchId: h.branchId, encounterId: view.encounterId });
        await h.session.encounterPassTurn({ campaignId: h.campaignId, branchId: h.branchId, encounterId: view.encounterId });
      }
      const state = await h.turns.getState(h.branchId);
      assert.equal(calls, 0);
      assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
      assert.ok(state.discoveries.some(d => d.entryId === 'lore-crates'));
      assert.ok(await h.planStore.findActiveJob(h.branchId, 'replan'));
    } finally { h.db.close(); }
  });
}

test('flow: milestone commits settle a stage once and replay cannot grant it again', async () => {
  const model = candidateModel(); model.stages[0].completion = { kind: 'committed_event', eventType: 'milestone' };
  let calls = 0; const h = await fixture({ model, onRequest: () => calls++ });
  try {
    const input = { campaignId: h.campaignId, branchId: h.branchId, actorId: 'pc', skillId: 'skill-observation', points: 2, encounterId: 'observed-clue' };
    await h.session.grantMilestone(input);
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.campaignRuntime.nodeStates[0].status, 'succeeded');
    assert.ok(state.discoveries.some(d => d.entryId === 'lore-crates'));
    assert.ok(await h.planStore.findActiveJob(h.branchId, 'replan'));
    assert.equal((await h.session.grantMilestone(input)).replayed, true);
    assert.equal((await h.turns.getState(h.branchId)).stateVersion, state.stateVersion);
    assert.equal(calls, 0);
  } finally { h.db.close(); }
});

test('flow: training, campaign rank/cap rewards and card projection survive the same commit and cold read', async () => {
  const model = candidateModel(); model.stages[0].completion = { kind: 'committed_event', eventType: 'training_completed' };
  model.rewards[0].rewards.push({ kind: 'skill_rank', targetId: 'skill-observation' }, { kind: 'resource_cap', targetId: 'stamina', delta: 2 });
  let calls = 0; const h = await fixture({ model, onRequest: () => calls++ });
  try {
    // Reach the real novice threshold through independent engine milestones.
    for (let i = 0; i < 5; i++) await h.session.grantMilestone({ campaignId: h.campaignId, branchId: h.branchId,
      actorId: 'pc', skillId: 'skill-observation', points: 2, encounterId: `training-practice-${i}` });
    const before = await h.turns.getState(h.branchId);
    const cap = before.cards.find(c => c.actorId === 'pc').card.resourceMax.stamina;
    const trained = await h.session.trainSkill({ campaignId: h.campaignId, branchId: h.branchId, actorId: 'pc', skillId: 'skill-observation' });
    assert.equal(trained.advanced, true);
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.stateVersion, before.stateVersion + 1);
    assert.equal(after.campaignRuntime.nodeStates[0].status, 'succeeded');
    assert.equal(after.skills.find(s => s.actorId === 'pc' && s.skillId === 'skill-observation').rank, 'expert');
    assert.equal(after.cards.find(c => c.actorId === 'pc').card.skills['skill-observation'], 'expert');
    assert.equal(after.cards.find(c => c.actorId === 'pc').card.resourceMax.stamina, cap + 2);
    assert.equal((await h.session.getSummary(h.campaignId, h.branchId)).cards.find(c => c.actorId === 'pc').skills['skill-observation'], 'expert');
    assert.ok(h.db.prepare("SELECT event_seq FROM branch_events WHERE branch_id=? AND state_version=? AND event_type='training_completed'").get(h.branchId, after.stateVersion));
    assert.ok(await h.planStore.findActiveJob(h.branchId, 'replan'));
    assert.equal(calls, 0);
  } finally { h.db.close(); }
});

test('flow: social success and campaign relation reward are each applied once', async () => {
  const entries = baseEntries(); entries[0].definition.usage = 'social';
  const model = candidateModel();
  const method = model.firstSituation.methods[0]; method.firstStep.targetEntryId = 'tpl-lin';
  method.outcomes.success.effects.push({ template: 'record_event', eventType: 'scene_swept', summary: '林凡接受分析' });
  model.stages[0].completion = { kind: 'committed_event', eventType: 'scene_swept' };
  model.rewards[0].rewards.push({ kind: 'relationship', targetId: 'tpl-lin', toActorId: 'player', delta: 1 });
  const h = await fixture({ model, entries, provider: { async complete(request) {
    const value = JSON.parse(request.user);
    return { text: JSON.stringify(request.role === 'Planner' ? {
      proposalVersion: '2.0', turnId: value.turnId, expectedStateVersion: value.expectedStateVersion,
      actorId: 'pc', actionKind: 'skill_check', skillId: 'skill-observation', targetId: 'npc-tpl-lin', difficultyBand: 'normal',
      evidenceIds: [], intent: value.playerIntent, candidateRef: `method:${SITUATION_ID}:sweep`,
    } : { turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '林凡接受了你的分析。' }) };
  } } });
  try {
    const result = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: method.firstStep.intent });
    assert.equal((await h.turns.getCommittedTurn(h.branchId, result.turnId)).outcomeGrade, 'success');
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.relationships.find(r => r.fromActorId === 'npc-tpl-lin' && r.toActorId === 'pc').closeness, 2);
    assert.equal(state.campaignRuntime.nodeStates[0].status, 'succeeded');
  } finally { h.db.close(); }
});

test('flow: recruitment lifecycle settles campaign progress and keeps its card and party projection', async () => {
  const entries = baseEntries(); entries[1].definition.recruitment = { recruitable: true, openingEligible: false, minimumCloseness: 0 };
  const model = candidateModel(); model.stages[0].completion = { kind: 'committed_event', eventType: 'companion_recruited' };
  let calls = 0; const h = await fixture({ model, entries, onRequest: () => calls++ });
  try {
    await h.session.recruitCompanion({ campaignId: h.campaignId, branchId: h.branchId, actorId: 'npc-tpl-lin' });
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.campaignRuntime.nodeStates[0].status, 'succeeded');
    assert.ok(state.discoveries.some(d => d.entryId === 'lore-crates'));
    assert.equal(state.cards.find(c => c.actorId === 'npc-tpl-lin').card.controller, 'companion');
    assert.equal(state.party.find(c => c.actorId === 'npc-tpl-lin').role, 'companion');
    assert.ok(await h.planStore.findActiveJob(h.branchId, 'replan'));
    assert.equal(calls, 0);
  } finally { h.db.close(); }
});

test('flow: campaign conditions and rewards preserve the existing 0..100 social relationship scale', async () => {
  const entries = baseEntries(); entries[0].definition.usage = 'social';
  const model = candidateModel();
  const method = model.firstSituation.methods[0]; method.firstStep.targetEntryId = 'tpl-lin';
  model.stages[0].completion = { kind: 'relationship_at_least', fromActorId: 'tpl-lin', toActorId: 'player', closeness: 6 };
  model.rewards[0].rewards = [{ kind: 'relationship', targetId: 'tpl-lin', toActorId: 'player', delta: 1 }];
  const h = await fixture({ model, entries, provider: { async complete(request) {
    const value = JSON.parse(request.user);
    return { text: JSON.stringify(request.role === 'Planner' ? {
      proposalVersion: '2.0', turnId: value.turnId, expectedStateVersion: value.expectedStateVersion,
      actorId: 'pc', actionKind: 'skill_check', skillId: 'skill-observation', targetId: 'npc-tpl-lin', difficultyBand: 'normal',
      evidenceIds: [], intent: value.playerIntent, candidateRef: `method:${SITUATION_ID}:sweep`,
    } : { turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '林凡更愿意与你合作。' }) };
  } } });
  try {
    for (let i = 0; i < 6; i++) await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: method.firstStep.intent });
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.relationships.find(r => r.fromActorId === 'npc-tpl-lin' && r.toActorId === 'pc').closeness, 7);
    assert.equal(state.campaignRuntime.nodeStates[0].status, 'succeeded');
  } finally { h.db.close(); }
});

test('flow: corrupt campaign content blocks local rest and combat before authoritative commit', async () => {
  let calls = 0; const h = await fixture({ onRequest: () => calls++ });
  try {
    const state = await h.turns.getState(h.branchId);
    const id = state.campaignContentBinding.artifactIds[0];
    const artifact = JSON.parse(h.db.prepare('SELECT artifact_json FROM campaign_content_artifacts WHERE artifact_id=?').get(id).artifact_json);
    artifact.rewardPolicies[0].description = 'tampered';
    h.db.prepare('UPDATE campaign_content_artifacts SET artifact_json=? WHERE artifact_id=?').run(JSON.stringify(artifact), id);
    await assert.rejects(() => h.session.rest({ campaignId: h.campaignId, branchId: h.branchId, kind: 'short' }), /哈希不符/);
    await assert.rejects(() => h.session.beginEncounter({ campaignId: h.campaignId, branchId: h.branchId, hostiles: [{ templateId: 'tpl-lin' }] }), /哈希不符/);
    assert.equal((await h.turns.getState(h.branchId)).stateVersion, state.stateVersion);
    assert.equal(calls, 0);
  } finally { h.db.close(); }
});

test('flow: an unfinished stage cannot be made playable by reusing a committed node', async () => {
  const { runReplanJob } = require('../dist/application/campaignPlan/replanService');
  const h = await fixture();
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const before = await h.turns.getState(h.branchId); const job = await h.planStore.findActiveJob(h.branchId, 'replan');
    let calls = 0;
    const result = await runReplanJob({ db: h.adapter, planStore: h.planStore, worldStore: h.worlds,
      provider: { async complete() { calls++; return { text: JSON.stringify(candidateModel()) }; } },
      profile: { endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'low',
        capabilities: { contextWindow: 60000, maxOutputTokens: 12000, supportsJson: true } } }, job.jobId,
      { anchorTitle: '青石巷', playerName: '旅人', protagonistSkills: ['skill-observation'] });
    assert.equal(result.status, 'invalid', JSON.stringify(result));
    assert.equal(calls, 2, 'only the shared initial request and one repair');
    assert.match(result.errors.join(' '), /committed or retired node/);
    assert.deepEqual((await h.turns.getState(h.branchId)).campaignRuntime, before.campaignRuntime);
  } finally { h.db.close(); }
});

test('flow: an open promise keeps its situation identity across replan; a new self cannot fulfill it', async () => {
  const model = candidateModel();
  for (const grade of ['success','full_success']) model.firstSituation.methods[1].outcomes[grade].effects = [
    { template: 'promise_create', situationId: 'self', promiseId: 'lin-work', promisorActorId: 'player', description: '旅人答应帮林凡搬货' }];
  const h = await fixture({ model });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const before = await h.turns.getState(h.branchId);
    const bad = candidateModel();
    bad.firstSituation.methods[1].outcomes.success.effects.push({ template: 'promise_fulfill', situationId: 'self', promiseId: 'lin-work' });
    let calls = 0; h.session.provider = { async complete() { calls++; return { text: JSON.stringify(bad) }; } };
    await assert.rejects(() => h.session.runCampaignReplan(h.campaignId, h.branchId), /unknown promise/);
    assert.equal(calls, 2);
    assert.deepEqual((await h.turns.getState(h.branchId)).situations, before.situations);
  } finally { h.db.close(); }
});

test('flow: current completion requires a local producer, while a valid alternative remains playable', async () => {
  const { validateCampaignPlan } = require('../dist/domain/campaignPlan/planValidation');
  const h = await fixture();
  try {
    const state = await h.turns.getState(h.branchId);
    const { plan } = await h.planStore.getPlanRevision(state.campaignRuntime.planBinding.planId, 1);
    const artifact = await h.planStore.getArtifact(plan.contentArtifactRefs[0]);
    const ctx = { visibleWorldEntryIds: new Set(baseEntries().map(e => e.entryId)), openingActorIds: new Set(['pc']),
      openingTemplateIds: new Set(['tpl-lin']), protagonistSkills: new Set(['skill-observation']) };
    for (const s of artifact.situations) for (const m of s.definition.methods) for (const o of Object.values(m.outcomeTemplates)) {
      o.effects = o.effects.filter(e => e.template !== 'situation_status');
    }
    assert.match(validateCampaignPlan(plan, ctx, artifact).join(' '), /completion has no local effect producer/);
    plan.nodes[0].completion = { kind: 'any', of: [plan.nodes[0].completion,
      { kind: 'situation_counter_at_least', situationId: SITUATION_ID, counterId: 'evidence', minimum: 2 }] };
    assert.deepEqual(validateCampaignPlan(plan, ctx, artifact), []);
  } finally { h.db.close(); }
});

test('flow: a committed stage failure queues replanning after the primary is cleared, without replay or HTTP', async () => {
  const model = candidateModel();
  model.stages[0].failure = { kind: 'committed_event', eventType: 'inquiry_abandoned' };
  for (const grade of ['success', 'full_success']) model.firstSituation.methods[1].outcomes[grade].effects = [
    { template: 'record_event', eventType: 'inquiry_abandoned', summary: '调查受阻，需要另找办法' }];
  const roles = []; const h = await fixture({ model, onRequest: request => roles.push(request.role) });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.campaignRuntime.nodeStates[0].status, 'failed');
    assert.equal(state.campaignRuntime.primaryNodeId, null);
    assert.equal(state.campaignRuntime.campaignStatus, 'active');
    assert.equal(state.campaignRuntime.grantedRewardKeys.length, 0);
    assert.ok(state.campaignRuntime.recentProgressLines.some(line => line.text.includes('目标受阻')));
    const job = await h.planStore.findActiveJob(h.branchId, 'replan');
    assert.ok(job.triggerReasons.includes('primary_node_failed'));
    assert.deepEqual(roles, ['Planner', 'Narrator'], 'no additional planning request on commit');
    await h.session.rest({ campaignId: h.campaignId, branchId: h.branchId, kind: 'short' });
    assert.equal((await h.planStore.findActiveJob(h.branchId, 'replan')).jobId, job.jobId);
    assert.deepEqual(roles, ['Planner', 'Narrator']);
    const { evaluateReplanTriggers } = require('../dist/application/campaignPlan/replanService');
    const { plan } = await h.planStore.getPlanRevision(state.campaignRuntime.planBinding.planId, 1);
    const replacement = { ...state.campaignRuntime, primaryNodeId: 'stage-2',
      nodeStates: state.campaignRuntime.nodeStates.map(n => n.nodeId === 'stage-2' ? { ...n, status: 'active' } : n) };
    assert.ok(!evaluateReplanTriggers({ plan, runtime: replacement, state }).includes('primary_node_failed'));
  } finally { h.db.close(); }
});

test('flow: a timed situation cannot count expiration as success through a bare resolved alternative', async () => {
  const { validateCampaignPlan } = require('../dist/domain/campaignPlan/planValidation');
  const h = await fixture();
  try {
    const state = await h.turns.getState(h.branchId);
    const { plan } = await h.planStore.getPlanRevision(state.campaignRuntime.planBinding.planId, 1);
    const artifact = await h.planStore.getArtifact(plan.contentArtifactRefs[0]);
    const ctx = { visibleWorldEntryIds: new Set(baseEntries().map(e => e.entryId)), openingActorIds: new Set(['pc']),
      openingTemplateIds: new Set(['tpl-lin']), protagonistSkills: new Set(['skill-observation']) };
    assert.deepEqual(validateCampaignPlan(plan, ctx, artifact), []);
    const resolved = { kind: 'situation_status', situationId: SITUATION_ID, status: 'resolved' };
    const evidence = { kind: 'situation_counter_at_least', situationId: SITUATION_ID, counterId: 'evidence', minimum: 1 };
    for (const completion of [resolved, { kind: 'any', of: [resolved, evidence] }]) {
      plan.nodes[0].completion = completion;
      assert.match(validateCampaignPlan(plan, ctx, artifact).join(' '), /pressure deadline for success/);
    }
    plan.nodes[0].completion = { kind: 'all', of: [resolved, evidence] };
    assert.deepEqual(validateCampaignPlan(plan, ctx, artifact), []);
    await h.session.rest({ campaignId: h.campaignId, branchId: h.branchId, kind: 'long' });
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.situations.find(s => s.situationId === SITUATION_ID).resolution, 'pressure_deadline_passed');
    assert.notEqual(after.campaignRuntime.nodeStates[0].status, 'succeeded');
    assert.equal(after.campaignRuntime.grantedRewardKeys.length, 0);
    assert.equal((await h.session.getCampaignProgress(h.campaignId, h.branchId)).completedStages.length, 0);
  } finally { h.db.close(); }
});

test('flow: prior partial success plus later expiration does not complete or reward a stage', async () => {
  let calls = 0;
  const h = await fixture({ onRequest: () => calls++ });
  try {
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
      intent: '仔细查看青石巷现场，寻找值得注意的细节与线索' });
    const before = await h.turns.getState(h.branchId);
    const partial = before.situations.find(s => s.situationId === SITUATION_ID);
    assert.ok(partial.counters.evidence >= 1);
    assert.equal(partial.status, 'active');
    assert.equal(before.campaignRuntime.nodeStates[0].status, 'active');
    calls = 0;
    await h.session.rest({ campaignId: h.campaignId, branchId: h.branchId, kind: 'long' });
    const after = await h.turns.getState(h.branchId);
    assert.equal(calls, 0);
    assert.equal(after.situations.find(s => s.situationId === SITUATION_ID).resolution, 'pressure_deadline_passed');
    assert.notEqual(after.campaignRuntime.nodeStates[0].status, 'succeeded');
    assert.equal(after.campaignRuntime.grantedRewardKeys.length, 0);
    assert.ok(!after.discoveries.some(d => d.entryId === 'lore-crates'));
    const { plan } = await h.planStore.getPlanRevision(after.campaignRuntime.planBinding.planId, 1);
    const { evaluateCampaignProgress } = require('../dist/domain/campaignPlan/progressReducer');
    const resolved = { kind: 'situation_status', situationId: SITUATION_ID, status: 'resolved' };
    const counter = { kind: 'situation_counter_at_least', situationId: SITUATION_ID, counterId: 'evidence', minimum: 1 };
    for (const [completion, succeeds] of [[{ kind: 'not', of: resolved }, false],
      [{ kind: 'not', of: { kind: 'not', of: resolved } }, false],
      [{ kind: 'any', of: [resolved, counter] }, true]]) {
      const modified = structuredClone(plan); modified.nodes[0].completion = completion;
      const result = evaluateCampaignProgress({ plan: modified, runtime: after.campaignRuntime, state: after,
        transactionEvents: [], historyEvents: [], turnId: 'probe', nextStateVersion: after.stateVersion + 1 });
      assert.equal(result.runtime.nodeStates[0].status === 'succeeded', succeeds,
        'expiry cannot satisfy resolved or invert actual status; independent counter-only completion remains valid');
    }
  } finally { h.db.close(); }
});
