const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  hashActionContract,
  serializeActionContract,
  resolveRoll,
} = require('../dist/domain');
const { commitResolvedTurn } = require('../dist/application/turns/commitTurn');
const { InMemoryTurnStore } = require('../dist/infra/memory/inMemoryTurnStore');

class SequenceRandom {
  constructor(values) {
    this.values = values.slice();
  }
  nextIntInclusive() {
    return this.values.shift();
  }
}

function initialState(branchId) {
  return {
    branchId,
    stateVersion: 12,
    clockMinutes: 100,
    actors: {
      'actor-player': {
        actorId: 'actor-player',
        locationId: 'location-courtyard',
        resources: { stamina: 5 },
        conditions: [],
      },
      'actor-guard': {
        actorId: 'actor-guard',
        locationId: 'location-archive',
        resources: { stamina: 5 },
        conditions: [],
      },
    },
    itemOwners: { 'item-key': 'actor-guard' },
  };
}

function contract(turnId = 'turn-001', expectedStateVersion = 12) {
  const base = (achieved, publicSummary, effects = []) => ({ achieved, publicSummary, effects });
  return {
    protocolVersion: '3.0',
    turnId,
    expectedStateVersion,
    actorId: 'actor-player',
    actionType: 'stealth',
    targetId: 'location-archive',
    skillId: 'stealth',
    difficultyBand: 'challenging',
    evidenceIds: ['fact-guard', 'scene-rain'],
    requiresRoll: true,
    intent: '趁雨声潜入藏书阁',
    timeCostMinutes: 5,
    resourcePreconditions: [
      { actorId: 'actor-player', resourceId: 'stamina', minimum: 1 },
    ],
    outcomes: {
      full_success: base(true, '进入并取得有利藏身位置', [
        { op: 'consumeResource', actorId: 'actor-player', resourceId: 'stamina', amount: 1 },
        { op: 'changeLocation', actorId: 'actor-player', locationId: 'location-archive' },
        { op: 'applyCondition', actorId: 'actor-player', conditionId: 'hidden' },
      ]),
      success: base(true, '成功进入藏书阁', [
        { op: 'consumeResource', actorId: 'actor-player', resourceId: 'stamina', amount: 1 },
        { op: 'changeLocation', actorId: 'actor-player', locationId: 'location-archive' },
        { op: 'recordEvent', eventType: 'entered_archive', summary: '玩家潜入藏书阁' },
      ]),
      failure: base(false, '被发现，转入交涉'),
      severe_failure: base(false, '被包围，但保留下一步行动', [
        { op: 'applyCondition', actorId: 'actor-player', conditionId: 'surrounded' },
      ]),
    },
  };
}

const shaProvider = {
  sha256Hex(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

test('canonical contract serialization ignores object insertion order', () => {
  const a = { z: 1, a: { y: 2, x: 3 } };
  const b = { a: { x: 3, y: 2 }, z: 1 };
  const { canonicalStringify } = require('../dist/domain');
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

test('contract hash is stable SHA-256 over canonical JSON', async () => {
  const c = contract();
  const hash1 = await hashActionContract(c, shaProvider);
  const hash2 = crypto.createHash('sha256').update(serializeActionContract(c)).digest('hex');
  assert.equal(hash1, hash2);
  assert.match(hash1, /^[0-9a-f]{64}$/);
});

test('fixed mini-world resolves and commits one complete roll turn', async () => {
  const store = new InMemoryTurnStore([initialState('branch-a'), initialState('branch-b')]);
  const c = contract();
  const contractHash = await hashActionContract(c, shaProvider);
  const rollRecord = resolveRoll({
    turnId: c.turnId,
    rollIndex: 0,
    contractHash,
    spec: { attribute: 2, skillRank: 'trained', situationalDiceModifier: 1, difficulty: 6 },
    random: new SequenceRandom([2, 5, 7]),
    createdAt: '2026-09-26T00:00:00.000Z',
  });

  const first = await commitResolvedTurn({
    store,
    branchId: 'branch-a',
    contract: c,
    contractHash,
    outcomeGrade: rollRecord.grade,
    rollRecord,
    committedAt: '2026-09-26T00:00:01.000Z',
  });
  assert.equal(first.replayed, false);
  assert.equal(first.committedTurn.stateVersion, 13);

  const stateA = await store.getState('branch-a');
  assert.equal(stateA.stateVersion, 13);
  assert.equal(stateA.clockMinutes, 105);
  assert.equal(stateA.actors['actor-player'].locationId, 'location-archive');
  assert.equal(stateA.actors['actor-player'].resources.stamina, 4);

  const stateB = await store.getState('branch-b');
  assert.equal(stateB.stateVersion, 12);
  assert.equal(stateB.clockMinutes, 100);
  assert.equal(stateB.actors['actor-player'].locationId, 'location-courtyard');
});

test('replaying the same turn is idempotent and does not spend resources twice', async () => {
  const store = new InMemoryTurnStore([initialState('branch-a')]);
  const c = contract();
  const contractHash = await hashActionContract(c, shaProvider);
  const rollRecord = resolveRoll({
    turnId: c.turnId,
    rollIndex: 0,
    contractHash,
    spec: { attribute: 2, skillRank: 'trained', situationalDiceModifier: 1, difficulty: 6 },
    random: new SequenceRandom([2, 5, 7]),
  });
  const input = {
    store,
    branchId: 'branch-a',
    contract: c,
    contractHash,
    outcomeGrade: rollRecord.grade,
    rollRecord,
  };
  await commitResolvedTurn(input);
  const replay = await commitResolvedTurn(input);
  assert.equal(replay.replayed, true);
  const state = await store.getState('branch-a');
  assert.equal(state.stateVersion, 13);
  assert.equal(state.actors['actor-player'].resources.stamina, 4);
});

test('a stale second turn is rejected by stateVersion', async () => {
  const store = new InMemoryTurnStore([initialState('branch-a')]);
  const firstContract = contract('turn-001', 12);
  const firstHash = await hashActionContract(firstContract, shaProvider);
  const firstRoll = resolveRoll({
    turnId: firstContract.turnId,
    rollIndex: 0,
    contractHash: firstHash,
    spec: { attribute: 2, skillRank: 'trained', situationalDiceModifier: 1, difficulty: 6 },
    random: new SequenceRandom([2, 5, 7]),
  });
  await commitResolvedTurn({
    store,
    branchId: 'branch-a',
    contract: firstContract,
    contractHash: firstHash,
    outcomeGrade: firstRoll.grade,
    rollRecord: firstRoll,
  });

  const stale = contract('turn-002', 12);
  const staleHash = await hashActionContract(stale, shaProvider);
  const staleRoll = resolveRoll({
    turnId: stale.turnId,
    rollIndex: 0,
    contractHash: staleHash,
    spec: { attribute: 2, skillRank: 'trained', difficulty: 6 },
    random: new SequenceRandom([7, 7]),
  });
  await assert.rejects(
    commitResolvedTurn({
      store,
      branchId: 'branch-a',
      contract: stale,
      contractHash: staleHash,
      outcomeGrade: staleRoll.grade,
      rollRecord: staleRoll,
    }),
    /State version mismatch/,
  );
});
