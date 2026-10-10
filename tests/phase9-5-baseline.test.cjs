'use strict';

/**
 * Phase 9.5 M0 reference harness. This exercises the pre-change L2 session
 * path with fixed rule dice so a later local path can compare contracts,
 * grades, prepared outcomes, and committed state under identical inputs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, SITUATION_ID } = require('./helpers/phase9CampaignFixture.cjs');
const { compileProposal } = require('../dist/application/game/v2Compile');

const cases = [
  { name: 'full_success', difficultyBand: 'simple', die: 6, evidence: 2 },
  { name: 'success', difficultyBand: 'normal', die: 5, evidence: 1 },
  { name: 'failure', difficultyBand: 'challenging', die: 5, evidence: 0 },
  { name: 'severe_failure', difficultyBand: 'peak', die: 6, evidence: 0 },
];

for (const scenario of cases) {
  test(`phase9.5 M0 reference: L2 sweep ${scenario.name} freezes and commits the existing four-grade result`, async t => {
    const dice = [scenario.die, 1, 1];
    const requests = [];
    const provider = {
      async complete(request) {
        requests.push(request.role);
        const value = JSON.parse(request.user);
        if (request.role === 'Planner') {
          return { text: JSON.stringify({
            proposalVersion: '2.0', turnId: value.turnId,
            expectedStateVersion: value.expectedStateVersion, actorId: 'pc',
            actionKind: 'skill_check', skillId: 'skill-observation',
            difficultyBand: scenario.difficultyBand, evidenceIds: [],
            intent: value.playerIntent, candidateRef: `method:${SITUATION_ID}:sweep`,
          }) };
        }
        return { text: JSON.stringify({ turnId: value.turnId, outcomeGrade: value.outcomeGrade, text: '受控叙事桩' }) };
      },
    };
    const h = await fixture({ provider, random: {
      nextIntInclusive(min, max) {
        assert.ok(dice.length, 'legacy baseline must not consume more dice than its rules require');
        const value = dice.shift();
        assert.ok(value >= min && value <= max, `fixed die ${value} is within ${min}..${max}`);
        return value;
      },
    } });
    t.after(() => h.db.close());

    const result = await h.session.playTurn({ campaignId: h.campaignId, branchId: h.branchId,
      intent: '仔细查看青石巷现场，寻找值得注意的细节与线索' });
    const committed = await h.turns.getCommittedTurn(h.branchId, result.turnId);
    const state = await h.turns.getState(h.branchId);
    const staged = JSON.parse((await h.turns.getStagedTurn(h.branchId, result.turnId)).actionContractJson);

    assert.equal(committed.outcomeGrade, scenario.name);
    assert.equal(state.situations.find(s => s.situationId === SITUATION_ID).counters.evidence ?? 0, scenario.evidence);
    assert.equal(staged.difficultyBand, scenario.difficultyBand);
    assert.deepEqual(Object.keys(staged.outcomes).sort(), ['failure', 'full_success', 'severe_failure', 'success']);
    assert.deepEqual(requests, ['Planner', 'Narrator'], 'reference behavior includes the legacy Planner and Narrator requests');
    assert.equal(dice.length, 0, 'the selected rules roll consumed exactly the fixed dice');
  });
}

test('phase9.5 M0 RED witness: one unchanged Method accepts Planner-owned difficulty and evidence choices', () => {
  const card = {
    actorId: 'pc', name: '旅人', kind: 'original', controller: 'player',
    attributes: { physique: 2, agility: 2, insight: 2, knowledge: 2, willpower: 2, social: 2 },
    skills: { observation: 'trained' }, abilities: [], preparedAbilities: [],
    resourceMax: { stamina: 10, hp: 10 }, defense: 10, powerTier: 'ordinary',
    rulesetId: 'shineword-core', rulesetVersion: '0.4.0', worldId: 'w', worldPackageRevision: 1, cardRevision: 1,
  };
  const method = candidateModel().firstSituation.methods[0];
  assert.equal(Object.hasOwn(method, 'difficultyPolicy'), false);
  assert.equal(Object.hasOwn(method, 'evidenceBinding'), false);
  const state = { branchId: 'b', stateVersion: 0, clockMinutes: 0,
    actors: { pc: { actorId: 'pc', locationId: 'l', resources: {}, conditions: [] } }, itemOwners: {}, encounters: [] };
  const compile = proposal => compileProposal({
    proposal: { proposalVersion: '2.0', turnId: 'turn-red', expectedStateVersion: 0,
      actorId: 'pc', actionKind: 'skill_check', skillId: 'skill-observation',
      intent: method.firstStep.intent, ...proposal },
    actingCard: card, cards: [card],
    catalog: { 'skill-observation': { name: '观察', description: 'd', attribute: 'insight',
      allowUntrained: true, powerTier: 'ordinary', usage: 'knowledge' } },
    abilities: new Map(), scenes: [], constraints: [], state,
    methods: [method], methodSituations: [SITUATION_ID],
    selectedMethodRef: { situationId: SITUATION_ID, methodId: method.methodId },
  }).contract;

  const plannerChoice = compile({ difficultyBand: 'hard', evidenceIds: ['lore-crates'] });
  const omittedChoice = compile({ evidenceIds: [] });
  assert.equal(plannerChoice.difficultyBand, 'hard');
  assert.deepEqual(plannerChoice.evidenceIds, ['lore-crates']);
  assert.equal(omittedChoice.difficultyBand, 'normal', 'legacy compiler supplies its current fallback');
  assert.deepEqual(omittedChoice.evidenceIds, []);
  assert.notEqual(plannerChoice.difficultyBand, omittedChoice.difficultyBand);
  assert.notDeepEqual(plannerChoice.evidenceIds, omittedChoice.evidenceIds);
});
