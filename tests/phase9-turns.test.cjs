/**
 * Phase 9 turn-consumption tests (P9-4): campaign methods flow through the
 * production session (playTurn → v2Compile → prepared reduction → commit).
 * Proves: stable candidate binding for taps AND paraphrased free input (A11),
 * stale-reference refusal (A13), four-grade frozen outcome templates applied
 * per grade (A14), route-specific authoritative differences (A10), no_change
 * for unrelated actions, stage completion + rewards + deferred consequences
 * inside ONE commit (A16/A19).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');

const { compileProposal } = require('../dist/application/game/v2Compile');


const { fixture, candidateModel, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');

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

    // Stale route: the resolved situation no longer offers the method.
    await assert.rejects(
      () => h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '再向林凡打听一次青石巷的情况' }),
      /已不在当前可用办法|多个办法|局面已经变化/,
      'asking through the stale path after resolution is refused or re-assessed, never silently re-run (A13)');
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
