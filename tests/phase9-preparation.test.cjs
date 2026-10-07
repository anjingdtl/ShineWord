const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel } = require('./helpers/phase9CampaignFixture.cjs');
const { parseCampaignPlanCandidate } = require('../dist/application/campaignPlan/candidateModel');
const { validateCampaignPlan, validateOrdinarySuccessCompletion } = require('../dist/domain/campaignPlan/planValidation');
const { snapshotConditionFacts, evaluateCondition } = require('../dist/domain/situations/conditions');
const { SqliteGuidanceStore } = require('../dist/infra/sqlite/sqliteGuidanceStore');

function preparationModel() {
  const model = candidateModel();
  const prepare = model.firstSituation.methods[0];
  prepare.firstStep.actionKind = 'observe'; delete prepare.firstStep.skillId;
  prepare.requires = {};
  const fulfill = model.firstSituation.methods[1];
  fulfill.requires = { condition: { kind: 'counter_at_least', situationId: 'self', counterId: 'evidence', minimum: 1 } };
  fulfill.preparation = '先查明货箱的异常，再把证据带给林凡';
  const finish = structuredClone(fulfill);
  finish.methodId = 'deliver-testimony'; finish.title = '送交证词';
  finish.firstStep.intent = '将林凡兑现的证词送交巡卫，解除青石巷的威胁';
  finish.requires = { condition: { kind: 'promise_fulfilled', situationId: 'self', promiseId: 'testimony' } };
  finish.preparation = '先履行查证的承诺，取得证词';
  for (const grade of ['success', 'full_success']) {
    prepare.outcomes[grade].effects = [
      { template: 'situation_counter', situationId: 'self', counterId: 'evidence', delta: 1 },
      { template: 'promise_create', situationId: 'self', promiseId: 'testimony', promisorActorId: 'pc', description: '带着查证结果向林凡履约' },
    ];
    fulfill.outcomes[grade].effects = [{ template: 'promise_fulfill', situationId: 'self', promiseId: 'testimony' }];
    finish.outcomes[grade].effects = [{ template: 'situation_status', situationId: 'self', status: 'resolved', resolution: '巡卫收到经查证的证词' }];
  }
  model.firstSituation.methods.push(finish);
  model.stages[0].completion = { kind: 'all', of: [
    { kind: 'situation_resolved', situationId: 'self' },
    { kind: 'promise_fulfilled', situationId: 'self', promiseId: 'testimony' },
  ] };
  return model;
}

test('preparation: a misplaced condition is refused with an exact wrapper correction and no dropped threshold', () => {
  const model = preparationModel(), condition = structuredClone(model.firstSituation.methods[1].requires.condition);
  model.firstSituation.methods[1].requires = condition;
  const errors = [];
  assert.equal(parseCampaignPlanCandidate(model, errors), null);
  assert.match(errors.join(' '), /Put the complete condition object under requires.condition/);
  assert.match(errors.join(' '), /preserve the original condition fields and threshold/);
  model.firstSituation.methods[1].requires = { condition };
  const repairedErrors = [], repaired = parseCampaignPlanCandidate(model, repairedErrors);
  assert.deepEqual(repairedErrors, []);
  assert.deepEqual(repaired.firstSituation.methods[1].requires.condition, condition);
});

test('preparation: the authoring adapter preserves bounded snapshot gates and refuses event-history gates', () => {
  const model = preparationModel(), errors = [];
  const parsed = parseCampaignPlanCandidate(model, errors);
  assert.ok(parsed, errors.join('; '));
  assert.deepEqual(parsed.firstSituation.methods[2].requires, model.firstSituation.methods[2].requires);
  model.firstSituation.methods[2].requires.condition = { kind: 'all', of: [
    { kind: 'promise_fulfilled', situationId: 'self', promiseId: 'testimony' },
    { kind: 'committed_event', eventType: 'testimony_collected' },
  ] };
  const bad = [];
  assert.equal(parseCampaignPlanCandidate(model, bad), null);
  assert.match(bad.join(' '), /snapshot conditions.*committed_event/);
});

test('preparation: shared snapshot facts expose counters, promises and nodes, keeping missing data UNKNOWN under not', () => {
  const base = { actors: {}, itemOwners: {}, playerActorId: 'pc', causalWorldTimeOrder: 1,
    situations: [{ situationId: 's', status: 'active', counters: { evidence: 2 },
      promises: [{ promiseId: 'p', status: 'fulfilled' }] }],
    campaignNodeStates: [{ nodeId: 'previous', status: 'succeeded' }] };
  const facts = snapshotConditionFacts(base);
  for (const condition of [
    { kind: 'situation_counter_at_least', situationId: 's', counterId: 'evidence', minimum: 2 },
    { kind: 'promise_status', situationId: 's', promiseId: 'p', status: 'fulfilled' },
    { kind: 'campaign_node_status', nodeId: 'previous', status: 'succeeded' },
  ]) assert.deepEqual(evaluateCondition(condition, facts), { value: true, unknown: false });
  assert.deepEqual(evaluateCondition({ kind: 'not', of: { kind: 'promise_status', situationId: 's', promiseId: 'absent', status: 'fulfilled' } }, facts), { value: false, unknown: true });
  assert.deepEqual(evaluateCondition({ kind: 'not', of: { kind: 'situation_counter_at_least', situationId: 's', counterId: 'absent', minimum: 1 } }, facts), { value: false, unknown: true });
});

test('preparation: scope validation rejects unknown prerequisite identities before a proposal can be adopted', async () => {
  const h = await fixture({ model: preparationModel() });
  try {
    const candidate = await h.planStore.getCandidate('cand-t');
    const ctx = { visibleWorldEntryIds: new Set(['skill-observation', 'item-crate', 'lore-crates']),
      openingActorIds: new Set(['pc']), openingTemplateIds: new Set(['tpl-lin']), protagonistSkills: new Set(['skill-observation']) };
    assert.deepEqual(validateCampaignPlan(candidate.plan, ctx, candidate.artifact), []);
    const artifact = structuredClone(candidate.artifact);
    const condition = artifact.situations[0].definition.methods[2].requires.condition;
    condition.promiseId = 'invented';
    assert.ok(validateCampaignPlan(candidate.plan, ctx, artifact).some(e => /unknown promise/.test(e)));
    condition.situationId = 'missing-situation';
    assert.ok(validateCampaignPlan(candidate.plan, ctx, artifact).some(e => /not in world or campaign content/.test(e)));
    artifact.situations[0].definition.methods[2].requires.condition = { kind: 'campaign_node_status', nodeId: 'invented', status: 'succeeded' };
    assert.ok(validateCampaignPlan(candidate.plan, ctx, artifact).some(e => /unknown campaign node/.test(e)));
  } finally { h.db.close(); }
});

test('preparation: producer analysis accepts a preparation chain but rejects a self-dependent completion route', async () => {
  const h = await fixture({ model: preparationModel() });
  try {
    const candidate = await h.planStore.getCandidate('cand-t');
    assert.deepEqual(validateOrdinarySuccessCompletion(candidate.plan, candidate.artifact), []);
    const artifact = structuredClone(candidate.artifact);
    artifact.situations[0].definition.methods[0].requires.condition = {
      kind: 'situation_counter_at_least', situationId: artifact.situations[0].entryId, counterId: 'evidence', minimum: 1,
    };
    assert.match(validateOrdinarySuccessCompletion(candidate.plan, artifact).join(' '), /independently producible prerequisites/);
    artifact.situations[0].definition.methods[0].requires.condition = {
      kind: 'any', of: [artifact.situations[0].definition.methods[0].requires.condition, { kind: 'actor_alive', actorId: 'pc' }],
    };
    assert.deepEqual(validateOrdinarySuccessCompletion(candidate.plan, artifact), [], 'a legitimate alternative remains possible');
  } finally { h.db.close(); }
});

test('preparation: relationship completion respects the closing boundary, committed baseline and direction', async () => {
  const h = await fixture();
  try {
    const candidate = await h.planStore.getCandidate('cand-t');
    const plan = structuredClone(candidate.plan), artifact = structuredClone(candidate.artifact);
    const sid = artifact.situations[0].entryId;
    plan.nodes[0].completion = { kind: 'all', of: [
      { kind: 'situation_status', situationId: sid, status: 'resolved' },
      { kind: 'relationship_at_least', fromActorId: 'pc', toActorId: 'tpl-lin', closeness: 15 },
    ] };
    const finish = artifact.situations[0].definition.methods[1];
    finish.outcomeTemplates.success.effects.push({ template: 'relationship_shift', fromActorId: 'pc', toActorId: 'tpl-lin', delta: 1 });
    assert.match(validateOrdinarySuccessCompletion(plan, artifact).join(' '), /before its situation closes/);
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact, { playerActorId: 'pc', relationships: [
      { fromActorId: 'pc', toActorId: 'npc-tpl-lin', closeness: 14 },
    ] }), []);
    assert.match(validateOrdinarySuccessCompletion(plan, artifact, { playerActorId: 'pc', relationships: [
      { fromActorId: 'npc-tpl-lin', toActorId: 'pc', closeness: 14 },
    ] }).join(' '), /before its situation closes/);
    plan.nodes[0].completion.of[1] = { kind: 'relationship_at_least', fromActorId: 'tpl-lin', toActorId: 'pc', closeness: 15 };
    finish.outcomeTemplates.success.effects.push({ template: 'relationship_shift', fromActorId: 'tpl-lin', toActorId: 'pc', delta: 1 });
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact, { playerActorId: 'pc', actorAliases: [{ actorId: 'companion', templateId: 'tpl-lin' }],
      relationships: [{ fromActorId: 'companion', toActorId: 'pc', closeness: 14 }] }), [], 'a recruited companion retains its actual opening relationship');
    plan.nodes[0].completion.of[1] = { kind: 'relationship_at_least', fromActorId: 'pc', toActorId: 'tpl-lin', closeness: 15 };
    artifact.situations[0].definition.methods[0].outcomeTemplates.success.effects.push({ template: 'relationship_shift', fromActorId: 'pc', toActorId: 'tpl-lin', delta: 1 });
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact), [], 'a preparation route can supply the relation before the final action');
  } finally { h.db.close(); }
});

test('preparation: closing methods cannot be combined or replayed to invent missing counters and promises', async () => {
  const h = await fixture();
  try {
    const candidate = await h.planStore.getCandidate('cand-t');
    const plan = structuredClone(candidate.plan), artifact = structuredClone(candidate.artifact);
    const sid = artifact.situations[0].entryId, methods = artifact.situations[0].definition.methods;
    plan.nodes[0].completion = { kind: 'all', of: [
      { kind: 'situation_status', situationId: sid, status: 'resolved' },
      { kind: 'situation_counter_at_least', situationId: sid, counterId: 'evidence', minimum: 2 },
    ] };
    for (const m of methods) m.outcomeTemplates.success.effects = [
      { template: 'situation_counter', situationId: sid, counterId: 'evidence', delta: 1 },
      { template: 'situation_status', situationId: sid, status: 'resolved', resolution: '本次调查结束' },
    ];
    assert.match(validateOrdinarySuccessCompletion(plan, artifact).join(' '), /before its situation closes/);
    methods[0].outcomeTemplates.success.effects.pop();
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact), []);
    plan.nodes[0].completion = { kind: 'promise_status', situationId: sid, promiseId: 'p', status: 'fulfilled' };
    methods[0].outcomeTemplates.success.effects = [{ template: 'promise_create', situationId: sid, promiseId: 'p', promisorActorId: 'pc', description: '协助查证' },
      { template: 'situation_status', situationId: sid, status: 'resolved', resolution: '不能再履约' }];
    methods[1].requires.condition = { kind: 'situation_counter_at_least', situationId: sid, counterId: 'evidence', minimum: 1 };
    methods[1].outcomeTemplates.success.effects = [{ template: 'promise_fulfill', situationId: sid, promiseId: 'p' }];
    methods[0].outcomeTemplates.success.effects.push({ template: 'situation_counter', situationId: sid, counterId: 'evidence', delta: 1 });
    assert.match(validateOrdinarySuccessCompletion(plan, artifact).join(' '), /before its situation closes/);
    methods[1].requires = {};
    methods[0].outcomeTemplates.success.effects = [];
    methods[0].outcomeTemplates.full_success.effects = [{ template: 'promise_create', situationId: sid, promiseId: 'p', promisorActorId: 'pc', description: '仅大成功能取得的承诺' }];
    assert.match(validateOrdinarySuccessCompletion(plan, artifact).join(' '), /before its situation closes/, 'ordinary fulfillment cannot invent a promise that only full_success creates');
    methods[0].outcomeTemplates.success.effects = structuredClone(methods[0].outcomeTemplates.full_success.effects);
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact), [], 'a separate ordinary preparation supplies the promise');
  } finally { h.db.close(); }
});

test('preparation: production SQLite session unlocks preparation, fulfillment and delivery in three separate committed decisions', async () => {
  const h = await fixture({ model: preparationModel() });
  try {
    h.session.deps.guidance = new SqliteGuidanceStore(h.adapter);
    const original = (await h.planStore.getCandidate('cand-t')).artifact;
    const sid = original.situations[0].entryId;
    const methods = original.situations[0].definition.methods;
    const guide = () => h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'test', localOnly: true });
    let current = await guide();
    const available = id => current.steps.find(step => step.candidateRef === `method:${sid}:${id}`)?.availability;
    assert.equal(available(methods[0].methodId), 'available');
    assert.equal(available(methods[1].methodId), 'needs_preparation');
    assert.equal(available(methods[2].methodId), 'needs_preparation');
    let requests = 0;
    const complete = h.session.provider.complete.bind(h.session.provider);
    h.session.provider.complete = async request => { requests++; return complete(request); };
    const blocked = current.steps.find(step => step.methodId === methods[2].methodId);
    await assert.rejects(h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
      intent: methods[2].firstStep.intent, guidanceChoice: { decisionPoint: current.decisionPoint, candidateRef: blocked.candidateRef } }), /这条路径已失效/);
    assert.equal(requests, 0);
    assert.equal((await h.turns.getState(h.branchId)).stateVersion, 0);
    for (let i = 0; i < methods.length; i++) {
      const method = methods[i], step = current.steps.find(step => step.methodId === method.methodId);
      assert.equal(step.availability, 'available');
      await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
        intent: method.firstStep.intent, guidanceChoice: { decisionPoint: current.decisionPoint, candidateRef: step.candidateRef } });
      const state = await h.turns.getState(h.branchId), situation = state.situations.find(s => s.situationId === sid);
      assert.equal(state.stateVersion, i + 1);
      assert.equal(situation.promises.find(p => p.promiseId === 'testimony').status, i === 0 ? 'open' : 'fulfilled');
      assert.equal(state.campaignRuntime.nodeStates[0].status, i === 2 ? 'succeeded' : 'active');
      current = await guide();
      if (i === 0) {
        assert.equal(available(methods[1].methodId), 'available');
        assert.equal(available(methods[2].methodId), 'needs_preparation');
      }
    }
    const stored = await h.planStore.getCandidate('cand-t');
    assert.deepEqual(stored.artifact, original, 'eligibility updates never rewrite the four frozen outcomes');
  } finally { h.db.close(); }
});
