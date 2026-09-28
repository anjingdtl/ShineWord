const test = require('node:test');
const assert = require('node:assert/strict');

const {
  awardPractice,
  trainSkill,
  isTrainable,
  applyMilestonePractice,
  assertTrainingAllowed,
  PRACTICE_THRESHOLDS,
} = require('../dist/domain/progression/growth');
const {
  startEncounter,
  applyDamage,
  spendStamina,
  changeDistance,
  advanceInitiative,
  resolveEncounter,
} = require('../dist/domain/combat/encounter');

function skill(skillId, rank, points, awarded = []) {
  return { skillId, rank, practicePoints: points, awardedKeys: awarded };
}

test('practice: one point per independent encounter, encounter-key dedup blocks replay farming', () => {
  let progress = skill('sword', 'untrained', 0);
  progress = awardPractice(progress, 'enc-0001');
  assert.equal(progress.practicePoints, 1);

  // The same encounter replaying must not award again (double click / rewind
  // replay / reopening the scene). Reusing the same turnId inside a new
  // encounter is equally refused: the key is the encounter, not the turn.
  const replayed = awardPractice(progress, 'enc-0001');
  assert.equal(replayed, progress, 'replay returns the same progress');
  assert.equal(replayed.practicePoints, 1);

  // A different encounter is an independent practice opportunity.
  progress = awardPractice(progress, 'enc-0002');
  assert.equal(progress.practicePoints, 2);

  // Milestone and practice rewards are independent dedup dimensions.
  progress = awardPractice(progress, 'enc-0002', 'milestone');
  assert.equal(progress.practicePoints, 3);

  // Master no longer accrues practice.
  const master = skill('sword', 'master', 0);
  assert.equal(awardPractice(master, 'enc-x').practicePoints, 0);
});

test('training consumes the full threshold: 5/10/20/40 and requires conditions', () => {
  const okConditions = { hasSource: true, hasResources: true, meetsPrerequisites: true };

  // Threshold reached only makes the skill trainable, it never auto-advances.
  assert.equal(isTrainable(skill('sword', 'untrained', 4)), false);
  assert.equal(isTrainable(skill('sword', 'untrained', 5)), true);

  // 4 points at untrained: not enough even with conditions met.
  const almost = trainSkill(skill('sword', 'untrained', 4), okConditions);
  assert.equal(almost.advanced, false);
  assert.equal(almost.pointsRemaining, 4);

  const first = trainSkill(skill('sword', 'untrained', 5), okConditions);
  assert.equal(first.advanced, true);
  assert.equal(first.nextRank, 'novice');
  assert.equal(first.pointsRemaining, 0);
  assert.equal(first.pointsSpent, 5);

  assert.equal(trainSkill(skill('sword', 'novice', 9), okConditions).advanced, false);
  assert.equal(trainSkill(skill('sword', 'novice', 10), okConditions).nextRank, 'trained');
  assert.equal(trainSkill(skill('sword', 'trained', 20), okConditions).nextRank, 'expert');
  assert.equal(trainSkill(skill('sword', 'expert', 40), okConditions).nextRank, 'master');
  assert.equal(trainSkill(skill('sword', 'master', 999), okConditions).advanced, false);
  assert.ok(PRACTICE_THRESHOLDS.untrained < PRACTICE_THRESHOLDS.novice);

  // Missing instructor/resources/prerequisites blocks advancement explicitly.
  assert.throws(
    () => trainSkill(skill('sword', 'untrained', 5), { hasSource: false, hasResources: true, meetsPrerequisites: true }),
    /instructor, manual or environment/,
  );
  assert.throws(
    () => trainSkill(skill('sword', 'untrained', 5), { hasSource: true, hasResources: false, meetsPrerequisites: true }),
    /requires the configured resources/,
  );
  assert.throws(
    () => trainSkill(skill('sword', 'untrained', 5), { hasSource: true, hasResources: true, meetsPrerequisites: false }),
    /prerequisites/,
  );
  assert.doesNotThrow(() => assertTrainingAllowed(okConditions));
});

test('milestone rewards add 1-2 practice points onto unlocked skills only', () => {
  assert.equal(applyMilestonePractice({ skillId: 'sword', currentRank: 'trained', grantedPoints: 1 }), 1);
  assert.equal(applyMilestonePractice({ skillId: 'sword', currentRank: 'trained', grantedPoints: 2 }), 2);
  // Master gains nothing further.
  assert.equal(applyMilestonePractice({ skillId: 'sword', currentRank: 'master', grantedPoints: 2 }), 0);
  assert.throws(
    () => applyMilestonePractice({ skillId: 'sword', currentRank: 'untrained', grantedPoints: 2 }),
    /cannot unlock/,
  );
  assert.throws(
    () => applyMilestonePractice({ skillId: 'sword', currentRank: 'trained', grantedPoints: 3 }),
    /between 1 and 2/,
  );
});

function encounter() {
  return startEncounter({
    encounterId: 'enc-1',
    scene: { sceneId: 'rainy-archive', coverSpotIds: ['pillar'], exitIds: ['north-gate'] },
    actors: [
      { actorId: 'player', side: 'player', hp: 10, maxHp: 10, stamina: 8, conditions: [] },
      { actorId: 'guard', side: 'npc', hp: 6, maxHp: 6, stamina: 5, conditions: [] },
      { actorId: 'dog', side: 'npc', hp: 3, maxHp: 3, stamina: 2, conditions: [] },
    ],
    initiative: ['player', 'guard', 'dog'],
  }).state;
}

test('encounter start freezes initiative and validates actors', () => {
  const state = encounter();
  assert.equal(state.status, 'active');
  assert.deepEqual(state.initiative, ['player', 'guard', 'dog']);
  assert.equal(state.actors.player.distanceBand, 'mid');
  assert.equal(state.scene.exitIds[0], 'north-gate');

  assert.throws(() => startEncounter({
    encounterId: 'e',
    scene: { sceneId: 's', coverSpotIds: [], exitIds: [] },
    actors: [{ actorId: 'a', side: 'player', hp: 5, maxHp: 5, stamina: 2, conditions: [] }],
    initiative: ['ghost'],
  }), /unknown actor/);

  const afterDisabled = startEncounter({
    encounterId: 'e-disabled-start',
    scene: { sceneId: 's', coverSpotIds: [], exitIds: [] },
    actors: [
      { actorId: 'down', side: 'player', hp: 0, maxHp: 5, stamina: 0, conditions: ['disabled'] },
      { actorId: 'ready', side: 'player', hp: 5, maxHp: 5, stamina: 2, conditions: [] },
    ],
    initiative: ['down', 'ready'],
  });
  assert.equal(afterDisabled.currentActorId, 'ready', 'an incapacitated first slot cannot deadlock encounter start');
  assert.equal(afterDisabled.state.turnCursor, 1);

  assert.throws(() => startEncounter({
    encounterId: 'e',
    scene: { sceneId: 's', coverSpotIds: [], exitIds: [] },
    actors: [{ actorId: 'a', side: 'player', hp: -1, maxHp: 5, stamina: 2, conditions: [] }],
    initiative: ['a'],
  }), /negative resources/);
});

test('damage applies armor floored at zero and disables at zero HP', () => {
  const state = encounter();
  // Raw 3 vs armor 1 => 2 damage.
  const hit = applyDamage(state, 'guard', 3, 1);
  assert.deepEqual(hit, { actorId: 'guard', hpBefore: 6, hpAfter: 4, disabled: false });

  // Armor never heals: raw 2 vs armor 5 => 0 damage.
  const noDamage = applyDamage(state, 'guard', 2, 5);
  assert.equal(noDamage.hpAfter, 4);

  // Lethal hit disables and appends the condition.
  const lethal = applyDamage(state, 'dog', 10, 0);
  assert.equal(lethal.disabled, true);
  assert.ok(state.actors.dog.conditions.includes('disabled'));

  assert.throws(() => applyDamage(state, 'guard', -1, 0), /non-negative/);
  assert.throws(() => applyDamage(state, 'guard', 2, -1), /non-negative/);
});

test('stamina and distance are validated resources', () => {
  const state = encounter();
  spendStamina(state, 'player', 3);
  assert.equal(state.actors.player.stamina, 5);
  assert.throws(() => spendStamina(state, 'player', 99), /Not enough stamina/);
  changeDistance(state, 'player', 'far');
  assert.equal(state.actors.player.distanceBand, 'far');
});

test('initiative follows the frozen order, skips disabled actors, wraps rounds', () => {
  const state = encounter();
  // Round 1: player -> guard -> dog(disabled -> skipped) -> wrap -> player (round 2).
  applyDamage(state, 'dog', 99, 0);
  const first = advanceInitiative(state);
  assert.equal(first.actorId, 'guard');
  assert.equal(first.round, 1);
  const wrapped = advanceInitiative(state); // dog is disabled -> wraps to player
  assert.equal(wrapped.actorId, 'player');
  assert.equal(wrapped.round, 2);

  // Disable everyone: no conscious actor remains.
  const dead = encounter();
  applyDamage(dead, 'player', 99, 0);
  applyDamage(dead, 'guard', 99, 0);
  applyDamage(dead, 'dog', 99, 0);
  assert.throws(() => advanceInitiative(dead), /No conscious actor/);
});

test('encounter resolution: wipe requires all players down, escape and resolve are legal', () => {
  const state = encounter();
  assert.throws(() => resolveEncounter(state, 'wiped'), /player actor is conscious/);

  applyDamage(state, 'player', 99, 0);
  const wiped = resolveEncounter(state, 'wiped');
  assert.equal(wiped.status, 'wiped');

  const other = encounter();
  assert.equal(resolveEncounter(other, 'escaped').status, 'escaped');
  assert.equal(resolveEncounter(encounter(), 'resolved').status, 'resolved');
  assert.throws(() => advanceInitiative(other), /not active/);
});
