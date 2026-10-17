'use strict';
// Synthetic authored content, production compilation/adoption/Session/SQLite. No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
const { enqueueReplan, runReplanJob, adoptReplanCandidate } = require('../dist/application/campaignPlan/replanService');
const { projectNarrativeOpportunities } = require('../dist/application/campaignPlan/opportunityProjection');
const { campaignSituationEntries } = require('../dist/application/campaignPlan/contentResolver');
const { baseEntries } = require('./helpers/phase9CampaignFixture.cjs');
const PROFILE = { endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'low',
  capabilities: { contextWindow: 60000, maxOutputTokens: 12000, supportsJson: true } };

function fixedMethod(id, intent, effects, requires = {}) {
  const method = structuredClone(candidateModel().firstSituation.methods[0]);
  Object.assign(method, { methodId: id, title: intent, firstStep: { actionKind: 'observe', intent }, requires,
    difficultyPolicy: { kind: 'fixed', band: 'normal' }, evidencePolicy: { kind: 'fixed', evidenceIds: [] }, evidenceAllowlist: [] });
  for (const grade of ['success', 'full_success']) method.outcomes[grade] = { resultFact: intent, effects: structuredClone(effects) };
  return method;
}
function branchingModel() {
  const model = candidateModel();
  delete model.firstSituation.deadlineClockSeconds;
  model.rewards = [];
  model.stages[1].completion = { kind: 'committed_event', eventType: 'join_verified' };
  model.firstSituation.methods = ['knowledge', 'permit', 'cost'].map(id => fixedMethod(id, `准备${id}路线`, [
    { template: 'situation_counter', situationId: 'self', counterId: 'prepared', delta: 1 },
    { template: 'schedule_consequence', consequenceId: id },
  ]));
  model.firstSituation.methods.push(fixedMethod('join', '完成调查并在巷口汇合', [
    { template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1 },
    { template: 'situation_status', situationId: 'self', status: 'resolved', resolution: '三条路线在巷口汇合' },
  ], { condition: { kind: 'counter_at_least', situationId: 'self', counterId: 'prepared', minimum: 1 } }));
  model.consequences = [
    { consequenceId: 'knowledge', description: '调查资料在汇合时送到', visibility: 'public',
      trigger: { kind: 'node_succeeded', nodeId: 'stage-1' }, effects: [{ template: 'grant_knowledge', entryId: 'lore-crates' }] },
    { consequenceId: 'permit', description: '核准通行资格在汇合时生效', visibility: 'public',
      trigger: { kind: 'node_succeeded', nodeId: 'stage-1' }, effects: [{ template: 'situation_counter', situationId: 'self', counterId: 'route_permit', delta: 1 }] },
    { consequenceId: 'cost', description: '绕路的体力代价在汇合时结算', visibility: 'public',
      trigger: { kind: 'node_succeeded', nodeId: 'stage-1' }, effects: [{ template: 'resource_change', actorId: '__player__', resourceId: 'stamina', amount: -2 }] },
  ];
  return model;
}
async function prepareJoin(h) {
  const state = await h.turns.getState(h.branchId);
  const { plan, intent } = await h.planStore.getPlanRevision(state.campaignRuntime.planBinding.planId, state.campaignRuntime.planBinding.revision);
  const model = branchingModel();
  const remap = value => Array.isArray(value) ? value.map(remap) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, key === 'situationId' && nested === 'self' ? SITUATION_ID : remap(nested)])) : value;
  model.stages[0] = { ...model.stages[0], completion: remap(model.stages[0].completion), situationRef: SITUATION_ID };
  model.stages[1] = { ...model.stages[1], coverage: 'concrete', completion: { kind: 'situation_resolved', situationId: 'self' } };
  const close = [{ template: 'situation_status', situationId: 'self', status: 'resolved', resolution: '凭当前合法资格通过巷口' },
    { template: 'record_event', eventType: 'join_verified', summary: '巷口核验通过' }];
  model.firstSituation.methods = [
    fixedMethod('read-manifest', '凭调查资料核对货单', close, { knowledgeEntryId: 'lore-crates' }),
    fixedMethod('use-permit', '凭通行资格通过巷口', [...close, { template: 'resource_change', actorId: '__player__', resourceId: 'stamina', amount: -1 }], { condition: { kind: 'counter_at_least', situationId: SITUATION_ID, counterId: 'route_permit', minimum: 1 } }),
    fixedMethod('manual', '付出时间逐项人工核验', [...close, { template: 'resource_change', actorId: '__player__', resourceId: 'hp', amount: -1 }]),
  ];
  model.consequences = [];
  const deps = { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, profile: PROFILE,
    provider: { complete: async () => ({ text: JSON.stringify(model) }) } };
  const job = await enqueueReplan({ deps, campaignId: h.campaignId, branchId: h.branchId, plan,
    runtime: state.campaignRuntime, state, reasons: ['stage_content_prepared_ahead', 'stage_content_target:stage-2'] });
  const result = await runReplanJob(deps, job.jobId, { intent: state.campaignRuntime.intent ?? intent,
    protagonistSkills: ['skill-observation'], anchorTitle: '当前局势', playerName: '旅人' });
  assert.equal(result.status, 'candidate_ready', JSON.stringify(result));
  assert.equal((await adoptReplanCandidate({ db: h.adapter, planStore: h.planStore, turns: h.turns,
    campaignId: h.campaignId, branchId: h.branchId, candidateId: result.candidateId })).outcome, 'adopted');
}

test('convergence: three authored routes join stage-2; two delayed effects change next-turn eligibility and commit once', async t => {
  const outcomes = [];
  for (const route of ['knowledge', 'permit', 'cost']) {
    const roles = [];
    const h = await fixture({ model: branchingModel(), includeGuidance: true, onRequest: r => roles.push(r.role) });
    t.after(() => h.db.close());
    await prepareJoin(h);
    const initial = await h.turns.getState(h.branchId);
    const play = intent => h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent });
    await play(`准备${route}路线`);
    const pending = await h.turns.getState(h.branchId);
    assert.equal(pending.campaignRuntime.deferredConsequences.find(c => c.consequenceId === route).status, 'pending');
    const joined = await play('完成调查并在巷口汇合');
    const state = await h.turns.getState(h.branchId);
    assert.equal(state.campaignRuntime.primaryNodeId, 'stage-2');
    assert.equal(state.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-2').status, 'active');
    assert.equal(state.campaignRuntime.deferredConsequences.find(c => c.consequenceId === route).status, 'discharged');
    for (const eventType of ['campaign_consequence_scheduled', 'campaign_consequence_triggered', 'campaign_consequence_discharged']) {
      assert.equal(h.db.prepare('SELECT COUNT(*) n FROM branch_events WHERE event_type=?').get(eventType).n, 1);
    }
    const binding = state.campaignRuntime.planBinding;
    const { plan } = await h.planStore.getPlanRevision(binding.planId, binding.revision);
    const artifacts = await Promise.all(state.campaignContentBinding.artifactIds.map(id => h.planStore.getArtifact(id)));
    const summary = await h.session.getSummary(h.campaignId, h.branchId);
    const projection = projectNarrativeOpportunities({ state, plan, artifacts,
      situationDefinitions: artifacts.flatMap(a => a.situations.map(s => ({ situationId: s.entryId, definition: s.definition }))),
      playerCard: summary.cards.find(c => c.controller === 'player'), cards: summary.cards,
      entries: [...baseEntries(), ...artifacts.flatMap(campaignSituationEntries)] });
    const routes = projection.opportunities.find(o => o.nodeId === 'stage-2').routes;
    assert.equal(routes.find(r => r.methodId === 'read-manifest').available, route === 'knowledge');
    assert.equal(routes.find(r => r.methodId === 'use-permit').available, route === 'permit', JSON.stringify({ route, situations: state.situations, routes, consequences: state.campaignRuntime.deferredConsequences }));
    if (route === 'cost') assert.equal(state.actors.pc.resources.stamina, initial.actors.pc.resources.stamina - 2);
    const denied = route === 'knowledge' ? '凭通行资格通过巷口' : '凭调查资料核对货单';
    const requestCount = roles.length;
    await assert.rejects(play(denied), /尚未掌握|行动前提/);
    assert.equal(roles.length, requestCount, 'illegal consumer is refused before dispatch');
    const resumed = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
      intent: '完成调查并在巷口汇合', turnIdOverride: joined.turnId });
    assert.equal(resumed.resumed, true);
    assert.equal(roles.length, requestCount, 'replay never dispatches or settles again');
    await play(route === 'knowledge' ? '凭调查资料核对货单' : route === 'permit' ? '凭通行资格通过巷口' : '付出时间逐项人工核验');
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-2').status, 'succeeded', JSON.stringify({ route, nodes: plan.nodes, situations: after.situations }));
    assert.equal(after.campaignRuntime.deferredConsequences.length, 1);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM branch_events WHERE event_type='campaign_consequence_triggered'").get().n, 1);
    assert.equal(roles.includes('Planner'), false);
    outcomes.push({ route, knowledge: state.discoveries.some(d => d.entryId === 'lore-crates'),
      permit: (state.situations.find(s => s.situationId === SITUATION_ID).counters.route_permit ?? 0) >= 1, stamina: state.actors.pc.resources.stamina });
  }
  assert.equal(new Set(outcomes.map(o => JSON.stringify([o.knowledge, o.permit, o.stamina]))).size, 3);
});

test('convergence: two deferred transition batches after a method both apply once, including replay', async t => {
  const model = branchingModel();
  model.firstSituation.methods[0].outcomes.success.effects.push({ template: 'schedule_consequence', consequenceId: 'permit' });
  model.consequences[0].effects = [{ template: 'situation_counter', situationId: 'self', counterId: 'permit_a', delta: 2 }];
  const h = await fixture({ model });
  t.after(() => h.db.close());
  await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '准备knowledge路线' });
  const join = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '完成调查并在巷口汇合' });
  const state = await h.turns.getState(h.branchId);
  const counters = state.situations.find(s => s.situationId === SITUATION_ID).counters;
  assert.equal(counters.permit_a, 2);
  assert.equal(counters.route_permit, 1);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM branch_events WHERE event_type='situation_counter_changed' AND json_extract(payload_json,'$.counterId') IN ('permit_a','route_permit')").get().n, 2);
  const before = JSON.stringify(state);
  await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '完成调查并在巷口汇合', turnIdOverride: join.turnId });
  assert.equal(JSON.stringify(await h.turns.getState(h.branchId)), before);
});

test('convergence: outbox abort rolls back deferred effects and recovery reuses the frozen candidate exactly once', async t => {
  const roles = [];
  const h = await fixture({ model: branchingModel(), onRequest: r => roles.push(r.role) });
  t.after(() => h.db.close());
  await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '准备permit路线' });
  const before = JSON.stringify(await h.turns.getState(h.branchId));
  const eventCount = h.db.prepare('SELECT COUNT(*) n FROM branch_events').get().n;
  h.db.exec("CREATE TRIGGER convergence_outbox_abort BEFORE INSERT ON frozen_turn_postprocess_outbox BEGIN SELECT RAISE(ABORT,'injected outbox abort'); END");
  await assert.rejects(h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: '完成调查并在巷口汇合' }), /injected outbox abort/);
  assert.equal(JSON.stringify(await h.turns.getState(h.branchId)), before);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM branch_events').get().n, eventCount);
  const pendingTurn = h.db.prepare("SELECT turn_id,action_contract_json,action_contract_hash FROM turns WHERE status!='Committed'").get();
  assert.ok(pendingTurn);
  const candidate = h.db.prepare('SELECT text,status FROM turn_narratives WHERE turn_id=?').get(pendingTurn.turn_id);
  assert.equal(candidate.status, 'Candidate');
  const requests = roles.length;
  h.db.exec('DROP TRIGGER convergence_outbox_abort');
  const result = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: '完成调查并在巷口汇合', turnIdOverride: pendingTurn.turn_id });
  assert.equal(roles.length, requests, 'received valid candidate is reused after transaction failure');
  const after = await h.turns.getState(h.branchId);
  assert.equal(after.situations.find(s => s.situationId === SITUATION_ID).counters.route_permit, 1);
  assert.equal(after.campaignRuntime.deferredConsequences[0].status, 'discharged');
  const frozen = await h.turns.getStagedTurn(h.branchId, result.turnId);
  assert.equal(frozen.actionContractJson, pendingTurn.action_contract_json);
  assert.equal(frozen.actionContractHash, pendingTurn.action_contract_hash);
  assert.equal(h.db.prepare('SELECT text FROM turn_narratives WHERE turn_id=?').get(result.turnId).text, candidate.text);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM frozen_turn_postprocess_outbox WHERE turn_id=?').get(result.turnId).n, 1);
  await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: '完成调查并在巷口汇合', turnIdOverride: result.turnId });
  assert.deepEqual(await h.turns.getState(h.branchId), after);
});
