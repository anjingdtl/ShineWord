// Closeout C6: contract-driven disabled-fate state machine regression.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateFateContract,
  applyFateTransitions,
  selectFateRule,
  rescueFate,
  stabilizeFate,
  emptyFateState,
} = require('../dist/domain/combat/disabledFate');

const CONTRACT = {
  encounterId: 'enc-demo',
  rules: [
    {
      fate: 'ending', appliesTo: 'player', minDisabledRounds: 0, priority: 1,
      outcome: { kind: 'ends_campaign', endingId: 'ending-captured-hero' },
    },
    {
      fate: 'captured', appliesTo: 'companion', minDisabledRounds: 0, priority: 2,
      outcome: { kind: 'awaits_rescue' },
    },
    {
      fate: 'death_risk', appliesTo: 'npc', minDisabledRounds: 1, priority: 3,
      outcome: { kind: 'death_risk', lethalAfterRounds: 3 },
    },
  ],
};

test('C6 fate contract validation rejects malformed contracts', () => {
  validateFateContract(CONTRACT);
  assert.throws(() => validateFateContract({
    encounterId: 'e',
    rules: [{ fate: 'nonsense', appliesTo: 'any', minDisabledRounds: 0, priority: 1, outcome: { kind: 'awaits_rescue' } }],
  }), /Unknown fate/);
  assert.throws(() => validateFateContract({
    encounterId: 'e',
    rules: [
      { fate: 'captured', appliesTo: 'any', minDisabledRounds: 0, priority: 1, outcome: { kind: 'awaits_rescue' } },
      { fate: 'rescued', appliesTo: 'any', minDisabledRounds: 0, priority: 1, outcome: { kind: 'awaits_rescue' } },
    ],
  }), /Duplicate/);
  assert.throws(() => validateFateContract({
    encounterId: 'e',
    rules: [{ fate: 'ending', appliesTo: 'any', minDisabledRounds: 0, priority: 1, outcome: { kind: 'ends_campaign', endingId: '' } }],
  }), /endingId/);
  assert.throws(() => validateFateContract({
    encounterId: 'e',
    rules: [{ fate: 'death_risk', appliesTo: 'any', minDisabledRounds: 0, priority: 1, outcome: { kind: 'death_risk', lethalAfterRounds: 0 } }],
  }), /lethalAfterRounds/);
});

test('C6 rule selection honors side, companion split and disabled duration', () => {
  assert.equal(selectFateRule(CONTRACT, { side: 'player', isCompanion: false }, 0).fate, 'ending');
  assert.equal(selectFateRule(CONTRACT, { side: 'player', isCompanion: true }, 0).fate, 'captured');
  // NPC death risk needs one full disabled round.
  assert.equal(selectFateRule(CONTRACT, { side: 'npc', isCompanion: false }, 0), null);
  assert.equal(selectFateRule(CONTRACT, { side: 'npc', isCompanion: false }, 1).fate, 'death_risk');
});

test('C6 player disable triggers the campaign ending through the contract', () => {
  const fates = {};
  const transition = applyFateTransitions(
    3,
    [{ actorId: 'hero', side: 'player', isCompanion: false, disabled: true }],
    fates,
    CONTRACT,
  );
  assert.equal(fates.hero.fate, 'ending');
  assert.equal(fates.hero.phase, 'concluded');
  assert.equal(fates.hero.resolution, 'ended');
  assert.equal(transition.endingId, 'ending-captured-hero');
  assert.ok(transition.events.some(event => event.kind === 'ending_triggered'));
});

test('C6 companion capture awaits rescue; rescue concludes it; healing frees it', () => {
  const fates = {};
  const actors = [{ actorId: 'ally', side: 'player', isCompanion: true, disabled: true }];
  const t1 = applyFateTransitions(2, actors, fates, CONTRACT);
  assert.equal(fates.ally.fate, 'captured');
  assert.equal(fates.ally.phase, 'active');
  assert.equal(t1.events.filter(e => e.kind === 'fate_assigned').length, 1);

  // Rescue concludes the fate.
  assert.equal(rescueFate(fates, 'ally', 4), true);
  assert.equal(fates.ally.resolution, 'rescued');
  assert.equal(fates.ally.phase, 'concluded');
  // Rescuing a non-captured actor is refused.
  assert.equal(rescueFate(fates, 'ally', 5), false);

  // A fresh capture lifted by healing resolves as freed, not rescued.
  const fates2 = {};
  applyFateTransitions(2, actors, fates2, CONTRACT);
  const healed = [{ actorId: 'ally', side: 'player', isCompanion: true, disabled: false }];
  const t3 = applyFateTransitions(3, healed, fates2, CONTRACT);
  assert.equal(fates2.ally.phase, 'concluded');
  assert.equal(fates2.ally.resolution, 'freed');
  assert.ok(t3.events.some(e => e.kind === 'fate_resolved' && e.resolution === 'freed'));
});

test('C6 npc death risk escalates per round and dies at the lethal threshold', () => {
  const fates = {};
  const npc = [{ actorId: 'bandit', side: 'npc', isCompanion: false, disabled: true }];
  // Round 1: disabled 0 full rounds -> still pending, no fate.
  applyFateTransitions(1, npc, fates, CONTRACT);
  assert.equal(fates.bandit.phase, 'pending');
  // Round 2: rule matches (disabledRounds=1) -> active death_risk.
  const t2 = applyFateTransitions(2, npc, fates, CONTRACT);
  assert.equal(fates.bandit.fate, 'death_risk');
  assert.ok(t2.events.some(e => e.kind === 'fate_assigned'));
  // Round 3: escalation event, still alive (2 < 3).
  const t3 = applyFateTransitions(3, npc, fates, CONTRACT);
  assert.ok(t3.events.some(e => e.kind === 'death_risk_escalated'));
  assert.equal(fates.bandit.phase, 'active');
  // Round 4: lethal threshold reached.
  const t4 = applyFateTransitions(4, npc, fates, CONTRACT);
  assert.equal(fates.bandit.phase, 'concluded');
  assert.equal(fates.bandit.resolution, 'died');
  assert.ok(t4.events.some(e => e.kind === 'fate_resolved' && e.resolution === 'died'));
});

test('C6 stabilize resets the death-risk clock', () => {
  const fates = {};
  const npc = [{ actorId: 'guard', side: 'npc', isCompanion: false, disabled: true }];
  applyFateTransitions(1, npc, fates, CONTRACT);
  applyFateTransitions(2, npc, fates, CONTRACT);
  assert.equal(fates.guard.fate, 'death_risk');
  // Stabilized at round 3: the lethal check restarts from there.
  assert.equal(stabilizeFate(fates, 'guard', 3), true);
  applyFateTransitions(4, npc, fates, CONTRACT);
  applyFateTransitions(5, npc, fates, CONTRACT);
  assert.equal(fates.guard.phase, 'active', 'two rounds after stabilize is still below the threshold');
  const t6 = applyFateTransitions(6, npc, fates, CONTRACT);
  assert.equal(fates.guard.resolution, 'died');
  assert.ok(t6.events.some(e => e.kind === 'fate_resolved'));
});

test('C6 snapshot round trip: fate state is plain JSON, rewind restores exactly', () => {
  const fates = {};
  const npc = [{ actorId: 'guard', side: 'npc', isCompanion: false, disabled: true }];
  applyFateTransitions(1, npc, fates, CONTRACT);
  applyFateTransitions(2, npc, fates, CONTRACT);
  // Snapshots serialize the record as-is (it lives inside EncounterState).
  const snapshot = JSON.parse(JSON.stringify(fates));
  const restored = Object.fromEntries(
    Object.entries(snapshot).map(([actorId, state]) => [actorId, { ...state }]),
  );
  // "Rewind" to the snapshot and replay: the same deterministic path.
  applyFateTransitions(3, npc, restored, CONTRACT);
  applyFateTransitions(4, npc, restored, CONTRACT);
  assert.deepEqual(restored.guard, {
    ...restored.guard,
    phase: 'concluded',
    resolution: 'died',
  });
  assert.equal(restored.guard.disabledSinceRound, 1);
  assert.equal(emptyFateState('x').phase, 'none');
});
