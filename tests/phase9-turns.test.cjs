/**
 * Phase 9 turn-consumption tests (P9-4): campaign methods flow through the
 * production session (playTurn → v2Compile → prepared reduction → commit).
 * Proves: stable candidate binding for taps AND shape-compatible free input (A11),
 * stale player-reference refusal (A13), four-grade frozen outcome templates applied
 * per grade (A14), route-specific authoritative differences (A10), no_change
 * for unrelated actions, stage completion + rewards + deferred consequences
 * inside ONE commit (A16/A19).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');

const { compileProposal } = require('../dist/application/game/v2Compile');
const { assertNarrativeDurationFitsClock, buildNarratorWorldClock } = require('../dist/application/game/v2Turn');


const { fixture, candidateModel, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');

test('Narrator clock includes the full reduced action duration and outcome clock effects', () => {
  const state = { clockSeconds: 0, clockMinutes: 0 };
  const contract = {
    timeCostMinutes: 10,
    outcomes: {
      full_success: { effects: [] },
      success: { effects: [] },
      failure: { effects: [{ op: 'advanceClock', minutes: 120 }] },
      severe_failure: { effects: [] },
    },
  };
  const projected = buildNarratorWorldClock(state, contract, 'failure');
  assert.deepEqual(projected, {
    start: '第1日 00:00', end: '第1日 02:10', elapsedSeconds: 7800, elapsedMinutes: 130,
  }, 'without a prepared campaign projection, the frozen base cost and clock effects determine the full interval');

  const prepared = { nextState: { clockSeconds: 7800, clockMinutes: 130 } };
  assert.deepEqual(buildNarratorWorldClock(state, contract, 'failure', prepared), projected,
    'the prepared state is authoritative when the full local reduction is available');
});

test('Narrator rejects an explicit full-day claim when the frozen turn spans only a few hours', () => {
  const state = { clockSeconds: 17 * 60 * 60 + 50 * 60, clockMinutes: 1070 };
  const contract = {
    timeCostMinutes: 10,
    outcomes: {
      full_success: { effects: [] },
      success: { effects: [] },
      failure: { effects: [{ op: 'advanceClock', minutes: 240 }] },
      severe_failure: { effects: [] },
    },
  };
  const worldClock = buildNarratorWorldClock(state, contract, 'failure');
  assert.equal(worldClock.elapsedMinutes, 250);
  assert.throws(
    () => assertNarrativeDurationFitsClock('我整整调查了一天，仍然没有结论。', worldClock),
    /duration claim exceeds authoritative worldClock/,
  );
  assert.doesNotThrow(
    () => assertNarrativeDurationFitsClock('我花了几个小时核对材料。', worldClock),
  );
});

test('P9-4: paraphrased free input and exact taps bind the SAME method with identical frozen outcomes (A11/A14)', async () => {
  const h = await fixture();
  try {
    // Free input PARAPHRASE: the planner echoes the stable candidateRef.
    const adoptedState = await h.turns.getState(h.branchId);
    const paraphrase = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
      intent: '我打算把巷子现场仔细搜一遍，看看有什么不对' });
    const paraphraseContract = JSON.parse((await h.turns.getStagedTurn(h.branchId, paraphrase.turnId)).actionContractJson);
    assert.equal(paraphraseContract.methodRef.methodId, 'sweep', 'paraphrase binds by stable id');
    assert.equal(paraphraseContract.candidateRef, `method:${SITUATION_ID}:sweep`);
    assert.ok(paraphraseContract.methodRef.outcomeSetHash, 'outcome set identity frozen pre-roll');
    assert.ok(paraphraseContract.campaignEffects, 'four-grade campaign effects ride the contract');
    const state1 = await h.turns.getState(h.branchId);
    const situation1 = state1.situations.find(s => s.situationId === SITUATION_ID);
    assert.equal(situation1.counters.evidence, 1, 'route A (sweep) advances the evidence counter');

    // Exact-text tap path: same method, same effects (skill_check rolls here).
    const tap = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
      intent: '仔细查看青石巷现场，寻找值得注意的细节与线索' });
    const tapContract = JSON.parse((await h.turns.getStagedTurn(h.branchId, tap.turnId)).actionContractJson);
    assert.equal(tapContract.methodRef.methodId, 'sweep');
    assert.equal(tapContract.methodRef.outcomeSetHash, paraphraseContract.methodRef.outcomeSetHash,
      'same method ⇒ same frozen outcome set identity');
    const state2 = await h.turns.getState(h.branchId);
    const situation2 = state2.situations.find(s => s.situationId === SITUATION_ID);
    assert.ok(situation2.counters.evidence >= 1, 'evidence persists across the two submissions');
  } finally {
    h.db.close();
  }
});

test('P9-4: the alternate route resolves the stage, grants rewards and schedules+triggers the consequence in ONE commit (A10/A16/A19)', async () => {
  const h = await fixture();
  try {
    const before = await h.turns.getState(h.branchId);
    assert.equal(before.campaignRuntime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'active');
    assert.equal(before.situations.find(s => s.situationId === SITUATION_ID).status, 'active');

    const askResult = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
      intent: '向林凡打听青石巷最近的情况' });
    const contract = JSON.parse((await h.turns.getStagedTurn(h.branchId, askResult.turnId)).actionContractJson);
    assert.equal(contract.methodRef.methodId, 'ask-lin', 'route B (talk) binds its own method');

    const after = await h.turns.getState(h.branchId);
    const situation = after.situations.find(s => s.situationId === SITUATION_ID);
    assert.equal(situation.status, 'resolved', 'route B resolves the situation — a different authoritative outcome than route A');
    const runtime = after.campaignRuntime;
    assert.equal(runtime.nodeStates.find(n => n.nodeId === 'stage-1').status, 'succeeded', 'stage completed from the resolved condition');
    assert.equal(runtime.nodeStates.find(n => n.nodeId === 'stage-2').status, 'available', 'provisional directions wait for concrete content before activation');
    assert.equal(runtime.nodeStates.find(n => n.nodeId === 'stage-2').activatedAtVersion, undefined);
    assert.equal(runtime.primaryNodeId, 'stage-2');
    assert.equal(runtime.grantedRewardKeys.length, 1, 'stage reward granted exactly once');
    assert.ok(after.discoveries.some(d => d.entryId === 'lore-crates'), 'knowledge reward applied (lore-crates)');
    const consequence = runtime.deferredConsequences.find(c => c.consequenceId === 'lin-favor');
    assert.ok(consequence, 'deferred consequence scheduled by the success grade');
    assert.equal(consequence.status, 'triggered', 'its trigger condition (situation resolved) already holds');

    const events = h.db.prepare('SELECT event_type, payload_json FROM branch_events WHERE branch_id=? ORDER BY event_seq').all(h.branchId)
      .map(row => ({ type: row.event_type, payload: JSON.parse(row.payload_json) }));
    assert.ok(events.some(e => e.type === 'campaign_node_changed' && e.payload.nodeId === 'stage-1'));
    assert.ok(events.some(e => e.type === 'campaign_reward_granted'));
    assert.ok(events.some(e => e.type === 'campaign_consequence_scheduled'));
    assert.ok(events.some(e => e.type === 'campaign_consequence_triggered'));

    // An unrelated action afterwards produces no_change: no new progress.
    const idle = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '在巷口站一会儿，缓口气' });
    assert.ok(idle.turnId);
    const idleState = await h.turns.getState(h.branchId);
    assert.equal(idleState.campaignRuntime.grantedRewardKeys.length, 1, 'no duplicate rewards on an unrelated turn');
    const newProgress = idleState.campaignRuntime.recentProgressLines.filter(line => line.atStateVersion === idleState.stateVersion);
    assert.equal(newProgress.length, 0, 'irrelevant action adds no progress lines');

    // A freeform repeat after resolution is re-assessed as a generic action;
    // only a stale method the player explicitly selected must be refused.
    const repeatedIntent = '再向林凡打听一次青石巷的情况';
    const repeated = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: repeatedIntent });
    const repeatedContract = JSON.parse((await h.turns.getStagedTurn(h.branchId, repeated.turnId)).actionContractJson);
    assert.equal(repeatedContract.intent, repeatedIntent);
    assert.equal(repeatedContract.methodRef, undefined,
      'a stale Planner echo cannot silently rebind a method after its situation resolved');
  } finally {
    h.db.close();
  }
});

test('P9-4: compile refuses a selected method id that is not offered at this state (A13)', async () => {
  const makeCard = () => ({
    actorId: 'pc', name: '旅人', kind: 'original', controller: 'player',
    attributes: { physique: 2, agility: 2, insight: 2, knowledge: 2, willpower: 2, social: 2 },
    skills: { observation: 'trained' }, abilities: [], preparedAbilities: [],
    resourceMax: { stamina: 10, hp: 10 }, defense: 10, powerTier: 'ordinary',
    rulesetId: 'shineword-core', rulesetVersion: '0.4.0', worldId: 'w', worldPackageRevision: 1, cardRevision: 1,
  });
  const method = candidateModel().firstSituation.methods[0];
  const proposal = {
    proposalVersion: '2.0', turnId: 'turn-0001', expectedStateVersion: 0, actorId: 'pc',
    actionKind: 'skill_check', skillId: 'skill-observation', evidenceIds: [], intent: method.firstStep.intent,
  };
  const baseInput = {
    proposal, actingCard: makeCard(), cards: [makeCard()],
    catalog: { 'skill-observation': { name: '观察', description: 'd', attribute: 'insight', allowUntrained: true, powerTier: 'ordinary', usage: 'knowledge' } },
    abilities: new Map(), scenes: [], constraints: [],
    state: { branchId: 'b', stateVersion: 0, clockMinutes: 0, actors: { pc: { actorId: 'pc', locationId: 'l', resources: {}, conditions: [] } }, itemOwners: {}, encounters: [] },
  };
  // Not offered at all → stale reference refused.
  assert.throws(() => compileProposal({
    ...baseInput, selectedMethodRef: { situationId: SITUATION_ID, methodId: method.methodId },
    methods: [], methodSituations: [],
  }), /已不在当前可用办法/);
  // Offered and matching → binds and freezes the outcome templates.
  const bound = compileProposal({
    ...baseInput,
    selectedMethodRef: { situationId: SITUATION_ID, methodId: method.methodId },
    methods: [{ ...method, outcomeTemplates: undefined }], methodSituations: [SITUATION_ID],
  });
  assert.equal(bound.contract.methodRef.methodId, method.methodId);
});

test('Planner candidateRef cannot replace a free-input action with another method’s skill (A11)', () => {
  const method = candidateModel().firstSituation.methods.find(item => item.methodId === 'sweep');
  const card = {
    actorId: 'pc', name: '旅人', kind: 'original', controller: 'player',
    attributes: { physique: 2, agility: 2, insight: 2, knowledge: 2, willpower: 2, social: 2 },
    skills: { diplomacy: 'trained' }, abilities: [], preparedAbilities: [],
    resourceMax: { stamina: 10, hp: 10 }, defense: 10, powerTier: 'ordinary',
    rulesetId: 'shineword-core', rulesetVersion: '0.4.0', worldId: 'w', worldPackageRevision: 1, cardRevision: 1,
  };
  const intent = '我带着账目摘要向货运记录员申请查看公开凭据';
  const proposal = {
    proposalVersion: '2.0', turnId: 'turn-freeform', expectedStateVersion: 0, actorId: 'pc',
    actionKind: 'skill_check', skillId: 'skill-diplomacy', difficultyBand: 'normal', evidenceIds: [], intent,
    // This is a Planner suggestion, not a method the player tapped.
    candidateRef: `method:${SITUATION_ID}:sweep`,
  };
  const compiled = compileProposal({
    proposal, requestedIntent: intent, actingCard: card, cards: [card],
    catalog: {
      'skill-observation': { name: '观察', description: 'd', attribute: 'insight', allowUntrained: true, powerTier: 'ordinary', usage: 'knowledge' },
      'skill-diplomacy': { name: '外交', description: 'd', attribute: 'social', allowUntrained: true, powerTier: 'ordinary', usage: 'social' },
    },
    abilities: new Map(), scenes: [], constraints: [],
    state: { branchId: 'b', stateVersion: 0, clockMinutes: 0,
      actors: { pc: { actorId: 'pc', locationId: 'l', resources: {}, conditions: [] } }, itemOwners: {}, encounters: [] },
    methods: [method], methodSituations: [SITUATION_ID],
  });

  assert.equal(compiled.contract.actionType, 'skill_check');
  assert.equal(compiled.contract.skillId, 'diplomacy', 'the Planner proposal shape is preserved after id normalization');
  assert.equal(compiled.contract.intent, intent, 'the player intent remains the action being resolved');
  assert.equal(compiled.contract.methodRef, undefined, 'mismatched Planner refs cannot import another method’s effects');
  assert.equal(compiled.contract.campaignEffects, undefined);
});
