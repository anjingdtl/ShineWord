const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { validateEndingCompletionOrder } = require('../dist/domain/campaignPlan/endingValidation');
const { runOpeningPlanJob } = require('../dist/application/campaignPlan/planningService');
const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');

const succeeded = nodeId => ({ kind: 'campaign_node_status', nodeId, status: 'succeeded' });
const event = eventType => ({ kind: 'committed_event', eventType });
const not = of => ({ kind: 'not', of });
const all = (...of) => ({ kind: 'all', of });
async function sample(h) {
  const candidate = await h.planStore.getCandidate('cand-t');
  const plan = structuredClone(candidate.plan), artifact = structuredClone(candidate.artifact);
  plan.possibleEndings.push({ endingId: 'early', title: '付出代价', publicDescription: '后续目标未完成', outcomeKind: 'pyrrhic',
    condition: all(succeeded('stage-1'), not(event('quest_succeeded'))) });
  return { plan, artifact };
}

test('ending order: a future main goal not yet fulfilled cannot automatically end a successful earlier stage', async () => {
  const h = await fixture();
  try {
    const { plan, artifact } = await sample(h);
    assert.match(validateEndingCompletionOrder(plan, artifact).join(' '), /later main goal stage-2.*尚未完成不等于失败/);
    plan.possibleEndings[1].condition = all(succeeded('stage-1'), not(succeeded('stage-2')));
    assert.equal(validateEndingCompletionOrder(plan, artifact).length, 1);
    plan.possibleEndings[1].condition = all(succeeded('stage-2'), not(event('unrelated_help')));
    assert.deepEqual(validateEndingCompletionOrder(plan, artifact), [], 'unrelated absence after the final main stage is not blanket-banned');
  } finally { h.db.close(); }
});

test('ending order: an actual committed failure can guard early loss; an OR bypass remains unsafe', async () => {
  const h = await fixture();
  try {
    const { plan, artifact } = await sample(h), early = plan.possibleEndings[1];
    const unsafe = structuredClone(early.condition);
    artifact.situations[0].definition.methods[0].outcomeTemplates.failure.effects.push({ template: 'record_event', eventType: 'support_lost', summary: '协助机会实际丧失' });
    early.condition = all(unsafe, event('support_lost'));
    assert.deepEqual(validateEndingCompletionOrder(plan, artifact), []);
    early.condition = { kind: 'any', of: [structuredClone(early.condition), structuredClone(unsafe)] };
    assert.equal(validateEndingCompletionOrder(plan, artifact).length, 1, 'a loss marker in one branch does not secure every alternative');
    early.condition = all(unsafe, event('support_lost'));
    artifact.situations[0].definition.methods[0].outcomeTemplates.success.effects.push({ template: 'record_event', eventType: 'support_lost', summary: 'same event also occurs on ordinary success' });
    assert.equal(validateEndingCompletionOrder(plan, artifact).length, 1, 'a shared success event is not proof of a failure roll');
  } finally { h.db.close(); }
});

test('ending order: bare early success or open endings cannot bypass a later main goal', async () => {
  const h = await fixture();
  try {
    const { plan, artifact } = await sample(h), early = plan.possibleEndings[1];
    for (const kind of ['success', 'pyrrhic', 'open']) {
      early.outcomeKind = kind;
      early.condition = succeeded('stage-1');
      assert.match(validateEndingCompletionOrder(plan, artifact).join(' '), /before later main goal stage-2 is attempted/);
      early.condition = all(succeeded('stage-1'), not(event('rescue_failed')));
      assert.equal(validateEndingCompletionOrder(plan, artifact).length, 1, 'absence of failure is not a reason to end an ongoing goal');
    }
    early.condition = all(succeeded('stage-1'), { kind: 'campaign_node_status', nodeId: 'stage-2', status: 'cancelled' });
    assert.deepEqual(validateEndingCompletionOrder(plan, artifact), []);
    early.condition = succeeded('stage-1');
    plan.nodes[1].role = 'optional';
    assert.deepEqual(validateEndingCompletionOrder(plan, artifact), [], 'an explicitly optional epilogue can remain unplayed');
  } finally { h.db.close(); }
});

test('ending order: real actor loss or broken promise preserves an authored early failure route', async () => {
  const h = await fixture();
  try {
    const { plan, artifact } = await sample(h), early = plan.possibleEndings[1], unsafe = early.condition;
    early.condition = all(unsafe, not({ kind: 'actor_alive', actorId: 'pc' }));
    assert.deepEqual(validateEndingCompletionOrder(plan, artifact), []);
    early.condition = all(unsafe, { kind: 'promise_status', situationId: artifact.situations[0].entryId, promiseId: 'help', status: 'broken' });
    assert.deepEqual(validateEndingCompletionOrder(plan, artifact), []);
    early.condition = all(unsafe, { kind: 'actor_alive', actorId: 'pc' });
    assert.equal(validateEndingCompletionOrder(plan, artifact).length, 1, 'being alive cannot serve as the failure guard');
  } finally { h.db.close(); }
});

test('ending order: dependency edges and nested polarity are checked, optional and retired goals do not become mandatory', async () => {
  const h = await fixture();
  try {
    const { plan, artifact } = await sample(h);
    plan.nodes[0].nextNodeIds = [];
    assert.equal(validateEndingCompletionOrder(plan, artifact).length, 1, 'status dependency still makes the second stage a later goal');
    plan.possibleEndings[1].condition = all(succeeded('stage-1'), not(not(event('quest_succeeded'))));
    assert.deepEqual(validateEndingCompletionOrder(plan, artifact), [], 'double negation requires future success');
    plan.possibleEndings[1].condition = all(succeeded('stage-1'), not(event('quest_succeeded')));
    plan.nodes[1].role = 'optional';
    assert.deepEqual(validateEndingCompletionOrder(plan, artifact), []);
    plan.nodes[1].role = 'main'; plan.retiredNodeIds = ['stage-2'];
    assert.deepEqual(validateEndingCompletionOrder(plan, artifact), []);
  } finally { h.db.close(); }
});

test('ending order: new candidate repair is bounded and archived adopted content is unchanged', async () => {
  const h = await fixture();
  try {
    const profile = { id: 'test', name: 'Test', endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'low',
      capabilities: { contextWindow: 60000, maxOutputTokens: 12000, supportsJson: true } };
    const bad = candidateModel();
    bad.endings.push({ endingId: 'early', title: '代价结局', publicDescription: '后续未完成', outcomeKind: 'pyrrhic',
      condition: { kind: 'all', of: [{ kind: 'node_succeeded', nodeId: 'stage-1' }, not(event('quest_succeeded'))] } });
    const archived = canonicalJsonOf(await h.planStore.getCandidate('cand-t'));
    const setup = await h.planStore.getSetup('setup-t'), id = 'ending-order';
    const intent = { ...setup.intent, setupId: id };
    await h.planStore.upsertSetup({ ...setup, setupId: id, intent, status: 'planning', currentCandidateId: null });
    await h.planStore.insertJob({ jobId: id, setupId: id, campaignId: null, branchId: null, jobKind: 'opening_plan', triggerReasons: ['test'],
      baseStateVersion: null, basePlanId: null, basePlanRevision: null, intentHash: sha256HexOf(canonicalJsonOf(intent)), contentManifestHash: null,
      knowledgePolicyHash: null, triggerEventRefs: [], status: 'queued', leaseOwner: null, leaseExpiresAt: null, fencingToken: 0,
      attemptCount: 0, nextRetryAt: null, physicalRequestBudget: 2, freezeRootId: null, lastError: null, createdAt: NOW, updatedAt: NOW });
    let calls = 0;
    const provider = { async complete(request) {
      calls++;
      if (calls === 2) assert.match(request.user, /absence of later main goal/);
      return { text: JSON.stringify(calls === 1 ? bad : candidateModel()) };
    } };
    const result = await runOpeningPlanJob({ db: h.adapter, planStore: h.planStore, worldStore: h.worlds, provider, profile }, id,
      { anchorTitle: '开篇', playerName: '旅人', protagonistSkills: ['skill-observation'], openingGoalSuggestions: [] });
    assert.equal(result.status, 'candidate_ready', JSON.stringify(result)); assert.equal(calls, 2);
    const current = await h.planStore.latestCandidateForJob(id);
    assert.equal(current.repairUsed, true); assert.equal(current.rawResponseText, JSON.stringify(candidateModel()));
    await runOpeningPlanJob({ db: h.adapter, planStore: h.planStore, worldStore: h.worlds, provider, profile }, id,
      { anchorTitle: '开篇', playerName: '旅人', protagonistSkills: ['skill-observation'], openingGoalSuggestions: [] });
    assert.equal(calls, 2, 'ready reentry has zero physical calls');
    assert.equal(canonicalJsonOf(await h.planStore.getCandidate('cand-t')), archived);
    assert.equal((await h.turns.getState(h.branchId)).stateVersion, 0);
  } finally { h.db.close(); }
});
