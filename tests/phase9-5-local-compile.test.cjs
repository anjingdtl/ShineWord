'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, baseEntries, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
const { campaignSituationEntries } = require('../dist/application/campaignPlan/contentResolver');
const { evaluateLocalCompileReadiness } = require('../dist/application/game/localCompileReadiness');
const { resolveRecoverableGuidanceChoice } = require('../dist/application/guidance/recoveredChoice');
const { savePlayIntentDraft, loadPlayRecovery, clearPlayIntentDraft } = require('../dist/application/campaign/playRecovery');
const { runV2Turn } = require('../dist/application/game/v2Turn');
const { outcomeSetHashFor } = require('../dist/application/campaignPlan/localCompile');
const { campaignContentBindingHash } = require('../dist/application/campaignPlan/contentBinding');
const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');
const { packageIndexes, compileProposal } = require('../dist/application/game/v2Compile');
const { campaignCompletionRewardBlocker } = require('../dist/application/campaignPlan/routeReadiness');
const { projectNarrativeOpportunities } = require('../dist/application/campaignPlan/opportunityProjection');
const { settleCampaignProgress } = require('../dist/application/campaignPlan/settlement');
const { applySituationTransitions } = require('../dist/domain/situations/transitions');

function modelWithPolicy(policy = { kind: 'fixed', band: 'challenging' }, evidenceIds = ['lore-crates']) {
  const model = candidateModel();
  const sweep = model.firstSituation.methods.find(method => method.methodId === 'sweep');
  sweep.difficultyPolicy = policy;
  sweep.evidencePolicy = policy.kind === 'planner_required'
    ? { kind: 'planner_required' }
    : { kind: 'fixed', evidenceIds };
  sweep.evidenceAllowlist = policy.kind === 'planner_required' ? [] : evidenceIds;
  return model;
}

async function readinessInput(h, candidateRef = `method:${SITUATION_ID}:sweep`) {
  const state = await h.turns.getState(h.branchId);
  const summary = await h.session.getSummary(h.campaignId, h.branchId);
  const runtime = state.campaignRuntime;
  const { plan } = await h.planStore.getPlanRevision(runtime.planBinding.planId, runtime.planBinding.revision);
  const artifacts = await Promise.all(state.campaignContentBinding.artifactIds.map(id => h.planStore.getArtifact(id)));
  const situationDefinitions = artifacts.flatMap(artifact => artifact.situations.map(item => ({
    situationId: item.entryId, definition: item.definition,
  })));
  const selectedMethods = situationDefinitions.flatMap(item => item.definition.methods.map(method => ({
    situationId: item.situationId, method,
  })));
  const playerCard = summary.cards.find(card => card.controller === 'player');
  return {
    state, plan, artifacts, situationDefinitions, selectedMethods,
    selectedMethodRef: { situationId: SITUATION_ID, methodId: 'sweep' },
    candidateRef, turnId: `turn-${String(state.stateVersion + 1).padStart(4, '0')}`,
    playerIntent: '仔细查看青石巷现场，寻找值得注意的细节与线索', playerCard, cards: summary.cards,
    entries: [...baseEntries(), ...artifacts.flatMap(campaignSituationEntries)],
  };
}

test('L1 typed selection binds exact fixed difficulty and non-empty visible evidence', async t => {
  const requests = [];
  const entries = baseEntries();
  entries.find(entry => entry.entryId === 'scene-alley').definition.clues = ['lore-crates'];
  const provider = { async complete(request) {
    requests.push(request.role);
    if (request.role === 'Planner') throw new Error('selected L1 method must bypass Planner');
    const value = JSON.parse(request.user);
    return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '受控叙事桩' }) };
  } };
  const h = await fixture({ entries, model: modelWithPolicy(), provider, includeGuidance: true });
  t.after(() => h.db.close());
  const input = await readinessInput(h);
  const ready = evaluateLocalCompileReadiness(input);
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.selection.proposal.difficultyBand, 'challenging');
  assert.deepEqual(ready.selection.proposal.evidenceIds, ['lore-crates']);
  assert.match(ready.selection.campaignBindingHash, /^[a-f0-9]{64}$/);
  const preflightCalls = [];
  await assert.rejects(runV2Turn({
    branchId: h.branchId,
    turnId: ready.selection.proposal.turnId,
    store: { getCommittedTurn: async () => null, getState: async () => input.state },
    journal: { getStagedTurn: async () => null },
    provider: { complete: async () => { preflightCalls.push('Planner'); throw new Error('unexpected'); } },
    selectedMethodRef: ready.selection.selectedMethodRef,
    candidateRef: ready.selection.candidateRef,
    campaignBindingHash: ready.selection.campaignBindingHash,
    localCompileSelection: { ...ready.selection, expectedStateVersion: input.state.stateVersion - 1 },
    actingCard: input.playerCard,
    cards: input.cards,
  }), /stale/i);
  assert.deepEqual(preflightCalls, [], 'stale L1 selection is rejected before any Planner dispatch');
  const methodIndex = input.selectedMethods.findIndex(item => item.method.methodId === 'sweep');
  const selectedMethod = input.selectedMethods[methodIndex].method;
  const recoveryCalls = [];
  await assert.rejects(runV2Turn({
    branchId: h.branchId,
    turnId: ready.selection.proposal.turnId,
    store: { getCommittedTurn: async () => null, getState: async () => input.state },
    journal: { getStagedTurn: async () => ({ actionContractJson: JSON.stringify({ methodRef: {
      situationId: SITUATION_ID, methodId: 'sweep', outcomeSetHash: outcomeSetHashFor(selectedMethod),
      campaignBindingHash: 'e'.repeat(64),
    } }) }) },
    provider: { complete: async () => { recoveryCalls.push('Planner'); throw new Error('unexpected'); } },
    methods: [selectedMethod], methodSituations: [SITUATION_ID],
    hashProvider: { sha256Hex: async () => '0'.repeat(64) },
  }), /binding changed/i);
  assert.deepEqual(recoveryCalls, [], 'recovery refuses a changed campaign method binding before any dispatch');

  const guidance = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId,
    branchId: h.branchId, sourceTurnId: 'opening', localOnly: true });
  assert.ok(guidance);
  const step = guidance.steps.find(item => item.candidateRef === `method:${SITUATION_ID}:sweep`);
  assert.ok(step && step.availability === 'available');
  const turn = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: step.firstStepIntent,
    guidanceChoice: { decisionPoint: guidance.decisionPoint, candidateRef: step.candidateRef } });
  assert.deepEqual(requests, ['Narrator']);
  const staged = await h.turns.getStagedTurn(h.branchId, turn.turnId);
  const contract = JSON.parse(staged.actionContractJson);
  assert.equal(contract.difficultyBand, 'challenging');
  assert.deepEqual(contract.evidenceIds, ['lore-crates']);
  assert.equal(contract.methodRef.campaignBindingHash, ready.selection.campaignBindingHash);
  const parityMethod = input.selectedMethods.find(item => item.method.methodId === 'sweep').method;
  const indexes = packageIndexes([...entries, ...input.artifacts.flatMap(campaignSituationEntries)]);
  const equivalentL2 = compileProposal({
    proposal: { ...ready.selection.proposal, evidenceIds: [...ready.selection.proposal.evidenceIds] },
    requestedIntent: ready.selection.proposal.intent,
    selectedMethodRef: ready.selection.selectedMethodRef,
    candidateRef: ready.selection.candidateRef,
    campaignBindingHash: ready.selection.campaignBindingHash,
    actingCard: input.playerCard,
    cards: input.cards,
    catalog: indexes.catalog,
    abilities: indexes.abilities,
    scenes: indexes.scenes,
    constraints: indexes.constraints,
    state: input.state,
    methods: [parityMethod],
    methodSituations: [SITUATION_ID],
  });
  assert.deepEqual(contract.outcomes, equivalentL2.contract.outcomes);
  assert.deepEqual(contract.campaignEffects, equivalentL2.contract.campaignEffects);
  assert.deepEqual(['full_success', 'success', 'failure', 'severe_failure'].map(grade => contract.outcomes[grade]),
    ['full_success', 'success', 'failure', 'severe_failure'].map(grade => equivalentL2.contract.outcomes[grade]),
    'all four frozen grade clauses match the equivalent L2 proposal compile');
});

test('promise side rewards are frozen, claimed on settlement, and suppressed on a new turn across asymmetric grades', async t => {
  const h = await fixture();
  t.after(() => h.db.close());
  const input = await readinessInput(h);
  const state = structuredClone(input.state);
  const method = structuredClone(input.selectedMethods.find(item => item.method.methodId === 'sweep').method);
  const promiseId = 'one-use-knowledge-promise';
  state.situations.find(item => item.situationId === SITUATION_ID).promises = [{
    promiseId, promisorActorId: 'npc-tpl-lin', promiseeActorId: 'pc', description: 'one-use fixture', status: 'open',
    createdAtVersion: state.stateVersion, sourceTurnId: 'fixture-create', idempotencyKey: 'fixture-create:promise',
  }];
  const bundled = [
    { template: 'situation_counter', situationId: SITUATION_ID, counterId: 'one_use_reward', delta: 10 },
    { template: 'relationship_shift', fromActorId: 'npc-tpl-lin', toActorId: 'pc', delta: 2 },
    { template: 'grant_knowledge', entryId: 'new-legal-clue', actorId: 'pc' },
  ];
  method.outcomeTemplates.success = { ...method.outcomeTemplates.success, effects: [
    { template: 'promise_fulfill', situationId: SITUATION_ID, promiseId }, ...bundled,
  ] };
  method.outcomeTemplates.full_success = { ...method.outcomeTemplates.full_success, effects: structuredClone(bundled) };
  const indexes = packageIndexes([...input.entries, ...input.artifacts.flatMap(campaignSituationEntries)]);
  const compile = version => compileProposal({
    proposal: { proposalVersion: '2.0', turnId: `promise-turn-${version}`,
      expectedStateVersion: version === 1 ? state.stateVersion : nextState.stateVersion,
      actorId: input.playerCard.actorId, actionKind: 'skill_check', skillId: 'skill-observation', difficultyBand: 'normal',
      evidenceIds: [], intent: method.firstStep.intent, candidateRef: `method:${SITUATION_ID}:${method.methodId}` },
    requestedIntent: method.firstStep.intent, selectedMethodRef: { situationId: SITUATION_ID, methodId: method.methodId },
    candidateRef: `method:${SITUATION_ID}:${method.methodId}`, actingCard: input.playerCard, cards: input.cards,
    catalog: indexes.catalog, abilities: indexes.abilities, scenes: indexes.scenes, constraints: indexes.constraints,
    state: version === 1 ? state : nextState, methods: [method], methodSituations: [SITUATION_ID],
  }).contract;
  const first = compile(1);
  assert.equal(first.campaignEffects.success.promiseEffectClaims.length, 2, 'counter and relationship identities are frozen before settlement');
  assert.equal(first.campaignEffects.full_success.transitions.some(op => op.kind === 'situation_counter'), false,
    'a grade cannot award promise-bundled supply while omitting the promise fact');
  const nextState = structuredClone(state);
  const firstTransitions = applySituationTransitions({ situations: nextState.situations,
    ops: first.campaignEffects.success.transitions, eventKey: 'one-use-first-commit', sourceTurnId: first.turnId,
    stateVersion: state.stateVersion + 1, clockSeconds: state.clockSeconds });
  nextState.situations = firstTransitions.situations;
  nextState.stateVersion = state.stateVersion + 1;
  settleCampaignProgress({ nextState, turnId: first.turnId, nextStateVersion: state.stateVersion + 1,
    action: { contract: first, grade: 'success' }, transactionEvents: [], plan: input.plan, artifacts: input.artifacts, historyEvents: [] });
  const firstSituation = nextState.situations.find(item => item.situationId === SITUATION_ID);
  assert.equal(firstSituation.counters.one_use_reward, 10);
  assert.equal(firstSituation.promises.find(item => item.promiseId === promiseId).status, 'fulfilled');
  assert.ok(nextState.discoveries.some(item => item.entryId === 'new-legal-clue' && item.actorId === 'pc'),
    'the first legal knowledge fact commits with the promise');
  assert.equal(nextState.campaignRuntime.grantedRewardKeys.filter(key => key.startsWith('campaign-promise-effect:v1:')).length, 2);

  const repeated = compile(2);
  assert.equal(repeated.campaignEffects.success.transitions.some(op => op.kind === 'situation_counter'), false);
  assert.equal(repeated.campaignEffects.full_success.transitions.some(op => op.kind === 'situation_counter'), false,
    'asymmetric full_success cannot bypass the success-grade claim');
  assert.equal(repeated.campaignEffects.success.relationshipShifts.length, 0);
  const repeatedState = structuredClone(nextState);
  const repeatedTransitions = applySituationTransitions({ situations: repeatedState.situations,
    ops: repeated.campaignEffects.success.transitions, eventKey: 'one-use-repeat-commit', sourceTurnId: repeated.turnId,
    stateVersion: repeatedState.stateVersion + 1, clockSeconds: repeatedState.clockSeconds });
  repeatedState.situations = repeatedTransitions.situations;
  settleCampaignProgress({ nextState: repeatedState, turnId: repeated.turnId, nextStateVersion: repeatedState.stateVersion + 1,
    action: { contract: repeated, grade: 'success' }, transactionEvents: [], plan: input.plan, artifacts: input.artifacts, historyEvents: [] });
  assert.equal(repeatedState.situations.find(item => item.situationId === SITUATION_ID).counters.one_use_reward, 10);
  assert.deepEqual(repeatedState.relationships, nextState.relationships);

  // A resolved promise must not make a new, independent fact or an ordinary
  // stage-closing effect disappear from the same otherwise-valid method.
  method.outcomeTemplates.success = { ...method.outcomeTemplates.success, effects: [
    { template: 'promise_fulfill', situationId: SITUATION_ID, promiseId },
    { template: 'grant_knowledge', entryId: 'new-clue-after-promise-resolution', actorId: 'pc' },
    { template: 'situation_status', situationId: SITUATION_ID, status: 'resolved' },
  ] };
  const closing = compile(3);
  assert.ok(closing.campaignEffects.success.transitions.some(op => op.kind === 'promise_fulfill'),
    'the archived promise transition can remain idempotent on an otherwise-valid method');
  assert.ok(closing.campaignEffects.success.transitions.some(op => op.kind === 'set_situation_status' && op.status === 'resolved'),
    'a previously resolved promise does not block an ordinary stage-closing fact');
  assert.ok(closing.campaignEffects.success.knowledgeGrants.some(grant => grant.entryId === 'new-clue-after-promise-resolution'),
    'a previously resolved promise does not block newly acquired knowledge');
  const closingState = structuredClone(nextState);
  const closingTransitions = applySituationTransitions({ situations: closingState.situations,
    ops: closing.campaignEffects.success.transitions, eventKey: 'one-use-close-after-resolution', sourceTurnId: closing.turnId,
    stateVersion: closingState.stateVersion + 1, clockSeconds: closingState.clockSeconds });
  closingState.situations = closingTransitions.situations;
  closingState.stateVersion += 1;
  settleCampaignProgress({ nextState: closingState, turnId: closing.turnId, nextStateVersion: closingState.stateVersion,
    action: { contract: closing, grade: 'success' }, transactionEvents: [], plan: input.plan, artifacts: input.artifacts, historyEvents: [] });
  assert.equal(closingState.situations.find(item => item.situationId === SITUATION_ID).status, 'resolved');
  assert.ok(closingState.discoveries.some(item => item.entryId === 'new-clue-after-promise-resolution' && item.actorId === 'pc'));

  method.methodId = 'ask-lin-revised-artifact';
  const revised = compile(4);
  assert.equal(revised.campaignEffects.success.transitions.some(op => op.kind === 'situation_counter'), false,
    'a same-method historical revision cannot release the branch-local reward claim');
});

test('a recovered exact guidance draft restores its current L1 route binding and skips Planner', async t => {
  const requests = [];
  const provider = { async complete(request) {
    requests.push(request.role);
    if (request.role === 'Planner') throw new Error('recovered L1 guidance must bypass Planner');
    const value = JSON.parse(request.user);
    return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '受控叙事桩' }) };
  } };
  const h = await fixture({ model: modelWithPolicy({ kind: 'fixed', band: 'normal' }, []), provider, includeGuidance: true });
  t.after(() => h.db.close());
  const guidance = await h.session.ensureDecisionPointGuidance({ campaignId: h.campaignId,
    branchId: h.branchId, sourceTurnId: 'opening-recovery', localOnly: true });
  assert.ok(guidance);
  const step = guidance.steps.find(item => item.candidateRef === `method:${SITUATION_ID}:sweep`);
  assert.ok(step && step.availability === 'available');
  const expectedStateVersion = guidance.decisionPoint.stateVersion;
  await savePlayIntentDraft(h.adapter, h.campaignId, h.branchId, step.firstStepIntent);
  const recovery = await loadPlayRecovery(h.adapter, h.campaignId, h.branchId);
  assert.ok(recovery);
  const choice = resolveRecoverableGuidanceChoice({
    campaignId: h.campaignId,
    branchId: h.branchId,
    stateVersion: expectedStateVersion,
    intent: step.firstStepIntent,
    guidance,
    recovery,
  });
  assert.deepEqual(choice, { decisionPoint: guidance.decisionPoint, candidateRef: step.candidateRef });

  const turn = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
    intent: step.firstStepIntent, guidanceChoice: choice });
  assert.deepEqual(requests, ['Narrator']);
  const staged = await h.turns.getStagedTurn(h.branchId, turn.turnId);
  const contract = JSON.parse(staged.actionContractJson);
  assert.equal(contract.difficultyBand, 'normal');
  assert.equal(contract.candidateRef, step.candidateRef);
  await clearPlayIntentDraft(h.adapter, h.branchId, expectedStateVersion);
});

test('recovered guidance binding refuses stale, ambiguous, unavailable, frozen, and unknown drafts', () => {
  const decisionPoint = { campaignId: 'campaign', branchId: 'branch', playerActorId: 'actor-player',
    sourceTurnId: 'opening', decisionPointId: 'branch:4', stateVersion: 4,
    contentBindingHash: 'content', knowledgeHash: 'knowledge', contextHash: 'context' };
  const step = { source: 'local', candidateRef: 'method:situation:method', title: '路线', rationale: '',
    tradeoffs: '', firstStepIntent: '检查账册', actionKind: 'skill_check', availability: 'available' };
  const guidance = { decisionPoint, steps: [step] };
  const recovery = { expectedStateVersion: 4, intent: '检查账册', frozen: false, unknownAttemptIds: [] };
  const base = { campaignId: 'campaign', branchId: 'branch', stateVersion: 4,
    intent: '检查账册', guidance, recovery };
  assert.deepEqual(resolveRecoverableGuidanceChoice(base), { decisionPoint, candidateRef: step.candidateRef });
  assert.equal(resolveRecoverableGuidanceChoice({ ...base, stateVersion: 5 }), null);
  assert.equal(resolveRecoverableGuidanceChoice({ ...base, branchId: 'other-branch' }), null);
  assert.equal(resolveRecoverableGuidanceChoice({ ...base, recovery: { ...recovery, expectedStateVersion: 3 } }), null);
  assert.equal(resolveRecoverableGuidanceChoice({ ...base, recovery: { ...recovery, intent: '别的行动' } }), null);
  assert.equal(resolveRecoverableGuidanceChoice({ ...base, recovery: { ...recovery, frozen: true } }), null);
  assert.equal(resolveRecoverableGuidanceChoice({ ...base, recovery: { ...recovery, unknownAttemptIds: ['attempt-1'] } }), null);
  assert.equal(resolveRecoverableGuidanceChoice({ ...base, guidance: { ...guidance, steps: [{ ...step, availability: 'needs_preparation' }] } }), null);
  assert.equal(resolveRecoverableGuidanceChoice({ ...base, guidance: { ...guidance, steps: [step, { ...step, candidateRef: 'method:situation:other' }] } }), null);
});

test('L1 readiness keeps historical methods on L2, routes explicit planner_required to L2, and refuses stale or mismatched binding', async t => {
  const legacyRoles = [];
  const hLegacy = await fixture({ onRequest: request => legacyRoles.push(request.role), includeGuidance: true });
  t.after(() => hLegacy.db.close());
  const legacy = evaluateLocalCompileReadiness(await readinessInput(hLegacy));
  assert.equal(legacy.kind, 'legacy_l2');
  const legacyGuidance = await hLegacy.session.ensureDecisionPointGuidance({ campaignId: hLegacy.campaignId,
    branchId: hLegacy.branchId, sourceTurnId: 'opening', localOnly: true });
  const legacyStep = legacyGuidance.steps.find(item => item.candidateRef === `method:${SITUATION_ID}:sweep`);
  const legacyTurn = await hLegacy.session.playTurn({ campaignId: hLegacy.campaignId, branchId: hLegacy.branchId,
    intent: legacyStep.firstStepIntent,
    guidanceChoice: { decisionPoint: legacyGuidance.decisionPoint, candidateRef: legacyStep.candidateRef } });
  assert.ok(legacyRoles.includes('Planner'), 'historical methods still use L2 Planner compilation');
  const legacyContract = JSON.parse((await hLegacy.turns.getStagedTurn(hLegacy.branchId, legacyTurn.turnId)).actionContractJson);
  assert.equal(legacyContract.methodRef.campaignBindingHash, undefined);

  const hNoEvidence = await fixture({ model: modelWithPolicy({ kind: 'fixed', band: 'normal' }, []) });
  t.after(() => hNoEvidence.db.close());
  const noEvidence = evaluateLocalCompileReadiness(await readinessInput(hNoEvidence));
  assert.equal(noEvidence.kind, 'ready');
  assert.deepEqual(noEvidence.selection.proposal.evidenceIds, [], 'explicit empty fixed evidence means no evidence');

  const plannerRoles = [];
  const hPlanner = await fixture({ model: modelWithPolicy({ kind: 'planner_required' }),
    onRequest: request => plannerRoles.push(request.role), includeGuidance: true });
  t.after(() => hPlanner.db.close());
  const planner = evaluateLocalCompileReadiness(await readinessInput(hPlanner));
  assert.equal(planner.kind, 'planner_required');
  assert.match(planner.campaignBindingHash, /^[a-f0-9]{64}$/);
  const staleInput = await readinessInput(hPlanner, `method:${SITUATION_ID}:ask-lin`);
  assert.deepEqual(evaluateLocalCompileReadiness(staleInput), {
    kind: 'refused', code: 'method_not_currently_selected',
  });
  const changed = await readinessInput(hPlanner);
  const method = changed.selectedMethods.find(item => item.method.methodId === 'sweep').method;
  method.ruleBindingHash = 'f'.repeat(64);
  assert.deepEqual(evaluateLocalCompileReadiness(changed), { kind: 'refused', code: 'rule_binding_mismatch' });
  const plannerGuidance = await hPlanner.session.ensureDecisionPointGuidance({ campaignId: hPlanner.campaignId,
    branchId: hPlanner.branchId, sourceTurnId: 'opening', localOnly: true });
  const plannerStep = plannerGuidance.steps.find(item => item.candidateRef === `method:${SITUATION_ID}:sweep`);
  const plannerTurn = await hPlanner.session.playTurn({ campaignId: hPlanner.campaignId, branchId: hPlanner.branchId,
    intent: plannerStep.firstStepIntent,
    guidanceChoice: { decisionPoint: plannerGuidance.decisionPoint, candidateRef: plannerStep.candidateRef } });
  const plannerContract = JSON.parse((await hPlanner.turns.getStagedTurn(hPlanner.branchId, plannerTurn.turnId)).actionContractJson);
  assert.ok(plannerRoles.includes('Planner'), 'planner_required policy explicitly keeps L2 dispatch');
  assert.equal(plannerContract.methodRef.campaignBindingHash, planner.campaignBindingHash);
});

test('L1 readiness keeps an active prior-revision method when a replan only adds a later-stage artifact', async t => {
  const h = await fixture({ model: modelWithPolicy({ kind: 'fixed', band: 'challenging' }, []), includeGuidance: true });
  t.after(() => h.db.close());
  const input = await readinessInput(h);
  const priorArtifact = input.artifacts.find(artifact => artifact.situations
    .some(situation => situation.entryId === SITUATION_ID
      && situation.definition.methods.some(method => method.methodId === 'sweep')));
  assert.ok(priorArtifact, 'the active opening method begins in the adopted artifact');

  const nextPlanBody = {
    ...Object.fromEntries(Object.entries(input.plan).filter(([key]) => key !== 'contentHash')),
    planId: 'plan-replan-test',
    revision: 2,
    parentRevision: 1,
    contentArtifactRefs: ['artifact-replan-stage-2'],
  };
  const nextPlan = { ...nextPlanBody, contentHash: sha256HexOf(canonicalJsonOf(nextPlanBody)) };
  const nextArtifactBody = {
    ...Object.fromEntries(Object.entries(priorArtifact).filter(([key]) => key !== 'contentHash')),
    artifactId: 'artifact-replan-stage-2',
    planId: nextPlan.planId,
    planRevision: nextPlan.revision,
    situations: [],
  };
  const nextArtifact = { ...nextArtifactBody, contentHash: sha256HexOf(canonicalJsonOf(nextArtifactBody)) };
  const artifacts = [priorArtifact, nextArtifact];
  input.plan = nextPlan;
  input.artifacts = artifacts;
  input.state.campaignRuntime.planBinding = {
    planId: nextPlan.planId,
    revision: nextPlan.revision,
    contentHash: nextPlan.contentHash,
  };
  input.state.campaignContentBinding = {
    ...input.state.campaignContentBinding,
    artifactIds: artifacts.map(artifact => artifact.artifactId),
    contentHash: campaignContentBindingHash(artifacts),
  };

  const readiness = evaluateLocalCompileReadiness(input);
  assert.equal(readiness.kind, 'ready');
  assert.equal(readiness.selection.selectedMethodRef.situationId, SITUATION_ID);
  assert.equal(readiness.selection.selectedMethodRef.methodId, 'sweep');
});

test('a closure route with an unresolved reward actor is blocked before operation journaling or rolling', async t => {
  const requests = [];
  const h = await fixture({ includeGuidance: true, onRequest: request => requests.push(request.role) });
  t.after(() => h.db.close());
  const state = await h.turns.getState(h.branchId);
  const summary = await h.session.getSummary(h.campaignId, h.branchId);
  const oldGuidance = await h.session.ensureDecisionPointGuidance({
    campaignId: h.campaignId, branchId: h.branchId, sourceTurnId: 'opening', localOnly: true,
  });
  const candidateRef = 'method:' + SITUATION_ID + ':ask-lin';
  const oldStep = oldGuidance.steps.find(step => step.candidateRef === candidateRef);
  assert.ok(oldStep && oldStep.availability === 'available', 'the route was offered before the reward actor became unavailable');

  const originalLoad = h.session.loadCampaignPlanForState.bind(h.session);
  const withBrokenReward = content => content && ({
    ...content,
    artifacts: content.artifacts.map(artifact => ({
      ...artifact,
      rewardPolicies: [...artifact.rewardPolicies, {
        policyId: 'reward-with-uninstantiated-actor',
        nodeId: 'stage-1',
        description: 'fixture reward',
        rewards: [{ kind: 'relationship', targetId: 'actor-not-instantiated', toActorId: 'pc', delta: 1 }],
      }],
    })),
  });
  h.session.loadCampaignPlanForState = async (...args) => withBrokenReward(await originalLoad(...args));

  const input = await readinessInput(h, candidateRef);
  input.selectedMethodRef = { situationId: SITUATION_ID, methodId: 'ask-lin' };
  input.playerIntent = oldStep.firstStepIntent;
  input.artifacts = withBrokenReward({ plan: input.plan, artifacts: input.artifacts }).artifacts;
  assert.deepEqual(evaluateLocalCompileReadiness(input), {
    kind: 'refused', code: 'campaign_completion_reward_unavailable',
  });
  const closeMethod = input.selectedMethods.find(item => item.method.methodId === 'ask-lin').method;
  assert.equal(campaignCompletionRewardBlocker({
    state, plan: input.plan, artifacts: input.artifacts, situationId: SITUATION_ID, method: closeMethod, cards: summary.cards,
  }), 'campaign_completion_reward_actor_unavailable');
  const progressMethod = input.selectedMethods.find(item => item.method.methodId === 'sweep').method;
  assert.equal(campaignCompletionRewardBlocker({
    state, plan: input.plan, artifacts: input.artifacts, situationId: SITUATION_ID, method: progressMethod, cards: summary.cards,
  }), null, 'a method that does not close the node remains usable');
  const projection = projectNarrativeOpportunities({
    state, plan: input.plan, artifacts: input.artifacts, situationDefinitions: input.situationDefinitions,
    playerCard: input.playerCard, cards: summary.cards, entries: input.entries,
  });
  const projectedRoutes = projection.opportunities.flatMap(opportunity => opportunity.routes);
  assert.equal(projectedRoutes.find(route => route.methodId === 'ask-lin').available, false);
  assert.equal(projectedRoutes.find(route => route.methodId === 'sweep').available, true);
  assert.equal(projection.preferredCandidateRef, 'method:' + SITUATION_ID + ':sweep');

  await assert.rejects(h.session.playTurn({
    campaignId: h.campaignId,
    branchId: h.branchId,
    intent: oldStep.firstStepIntent,
    guidanceChoice: { decisionPoint: oldGuidance.decisionPoint, candidateRef },
  }), /收尾路线暂不可用/);
  assert.deepEqual(requests, [], 'the pre-roll route guard makes no provider request');
  const operation = await h.adapter.queryOne(
    'SELECT operation_id FROM interaction_operations WHERE branch_id=? LIMIT 1', [h.branchId]);
  assert.equal(operation, null, 'the route is rejected before an interaction operation is journaled');
  const turnId = 'turn-' + String(state.stateVersion + 1).padStart(4, '0');
  assert.equal(await h.turns.getStagedTurn(h.branchId, turnId), null, 'no staged action contract or roll is created');
});
