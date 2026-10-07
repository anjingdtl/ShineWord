const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
const { validateOrdinarySuccessCompletion } = require('../dist/domain/campaignPlan/planValidation');
const { canonicalJsonOf } = require('../dist/application/campaignPlan/hashing');
const { SqliteGuidanceStore } = require('../dist/infra/sqlite/sqliteGuidanceStore');

const prior = (status = 'open', count = 0) => ({ situations: [{ situationId: 'old', status: 'active', counters: { work: count },
  promises: [{ promiseId: 'help', status }] }] });

test('inherited completion: an open old promise cannot require a full-success-only fulfillment', async () => {
  const h = await fixture();
  try {
    const { plan, artifact } = structuredClone(await h.planStore.getCandidate('cand-t'));
    plan.nodes[0].completion = { kind: 'promise_status', situationId: 'old', promiseId: 'help', status: 'fulfilled' };
    const method = artifact.situations[0].definition.methods[1];
    const fulfill = { template: 'promise_fulfill', situationId: 'old', promiseId: 'help' };
    method.outcomeTemplates.full_success.effects.push(fulfill);
    assert.match(validateOrdinarySuccessCompletion(plan, artifact, prior()).join(' '), /no ordinary success producer/);
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact, prior('fulfilled')), [], 'already fulfilled is committed evidence');
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact), [], 'an unknown external baseline is not fabricated as open');
    method.outcomeTemplates.success.effects.push(fulfill);
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact, prior()), [], 'ordinary fulfillment may consume an existing old promise');
    method.outcomeTemplates.success.effects.pop();
    plan.nodes[0].completion = { kind: 'any', of: [plan.nodes[0].completion,
      { kind: 'situation_counter_at_least', situationId: artifact.situations[0].entryId, counterId: 'evidence', minimum: 1 }] };
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact, prior()), [], 'a real alternative is still legal');
  } finally { h.db.close(); }
});

test('inherited completion: old counter supply uses the frozen baseline and the current closing boundary', async () => {
  const h = await fixture();
  try {
    const { plan, artifact } = structuredClone(await h.planStore.getCandidate('cand-t'));
    plan.nodes[0].completion = { kind: 'situation_counter_at_least', situationId: 'old', counterId: 'work', minimum: 2 };
    for (const m of artifact.situations[0].definition.methods) {
      m.outcomeTemplates.success.effects = [{ template: 'situation_counter', situationId: 'old', counterId: 'work', delta: 1 },
        { template: 'situation_status', situationId: artifact.situations[0].entryId, status: 'resolved' }];
    }
    assert.match(validateOrdinarySuccessCompletion(plan, artifact, prior()).join(' '), /before its situation closes/);
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact, prior('open', 1)), []);
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact, prior('open', 2)), []);
    for (const m of artifact.situations[0].definition.methods) {
      m.outcomeTemplates.full_success.effects.push(m.outcomeTemplates.success.effects.shift());
    }
    assert.match(validateOrdinarySuccessCompletion(plan, artifact, prior()).join(' '), /no ordinary success producer/);
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact, { situations: [] }), [], 'unavailable external facts stay unknown');
  } finally { h.db.close(); }
});

test('inherited completion: a known active old situation needs an ordinary resolution producer', async () => {
  const h = await fixture();
  try {
    const { plan, artifact } = structuredClone(await h.planStore.getCandidate('cand-t'));
    plan.nodes[0].completion = { kind: 'situation_status', situationId: 'old', status: 'resolved' };
    const m = artifact.situations[0].definition.methods[1];
    m.outcomeTemplates.full_success.effects.push({ template: 'situation_status', situationId: 'old', status: 'resolved' });
    assert.match(validateOrdinarySuccessCompletion(plan, artifact, prior()).join(' '), /no ordinary success producer/);
    m.outcomeTemplates.success.effects.push({ template: 'situation_status', situationId: 'old', status: 'resolved' });
    assert.deepEqual(validateOrdinarySuccessCompletion(plan, artifact, prior()), []);
  } finally { h.db.close(); }
});

test('inherited completion: production replan repairs the old promise path and commits ordinary fulfillment without changing archives', async () => {
  const opening = candidateModel();
  for (const grade of ['success', 'full_success']) opening.firstSituation.methods[1].outcomes[grade].effects = [
    { template: 'promise_create', situationId: 'self', promiseId: 'help', promisorActorId: 'pc', description: '答应协助林凡查证' }];
  const h = await fixture({ model: opening });
  try {
    h.session.deps.guidance = new SqliteGuidanceStore(h.adapter);
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    const archived = canonicalJsonOf(await h.planStore.getCandidate('cand-t'));
    const bad = candidateModel();
    bad.stages[0].completion.of.push({ kind: 'promise_fulfilled', situationId: SITUATION_ID, promiseId: 'help' });
    const fulfill = { template: 'promise_fulfill', situationId: SITUATION_ID, promiseId: 'help' };
    bad.firstSituation.methods[1].outcomes.full_success.effects.push(fulfill);
    const repaired = structuredClone(bad);
    repaired.firstSituation.methods[1].outcomes.success.effects.push(fulfill);
    let calls = 0;
    h.session.provider = { async complete(request) {
      calls++;
      if (calls === 2) assert.match(request.user, /no ordinary success producer/);
      return { text: JSON.stringify(calls === 1 ? bad : repaired) };
    } };
    const result = await h.session.runCampaignReplan(h.campaignId, h.branchId);
    assert.equal(result, 'adopted');
    assert.equal(calls, 2);
    assert.equal((await h.turns.getState(h.branchId)).situations.find(s => s.situationId === SITUATION_ID).promises[0].status, 'open');
    const guide = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'test', localOnly: true });
    const step = guide.steps.find(s => s.methodId === 'ask-lin');
    assert.equal(step.availability, 'available');
    h.session.provider = { async complete(request) {
      const value = JSON.parse(request.user);
      return { text: JSON.stringify(request.role === 'Planner' ? {
        proposalVersion: '2.0', turnId: value.turnId, expectedStateVersion: value.expectedStateVersion, actorId: 'pc',
        actionKind: 'talk', evidenceIds: [], intent: value.playerIntent, candidateRef: step.candidateRef,
      } : { turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '旅人兑现了先前的承诺。' }) };
    } };
    await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: step.firstStepIntent,
      guidanceChoice: { decisionPoint: guide.decisionPoint, candidateRef: step.candidateRef } });
    const after = await h.turns.getState(h.branchId);
    assert.equal(after.situations.find(s => s.situationId === SITUATION_ID).promises[0].status, 'fulfilled');
    assert.equal(after.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded');
    assert.equal(canonicalJsonOf(await h.planStore.getCandidate('cand-t')), archived);
  } finally { h.db.close(); }
});
