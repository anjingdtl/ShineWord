'use strict';
/**
 * P7-1 exit verification: the prepared-turn pipeline.
 *
 * - prepareTurnResolution reduces the FULL next state (single reduction);
 * - commitPreparedTurn applies that exact object atomically;
 * - a replay of the same commit cannot double-apply rewards/events;
 * - the rescue fixture's two routes diverge on committed facts: saving the
 *   companion suppresses the future death reference; not saving lets it fire
 *   on the branch while canon stays untouched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  prepareTurnResolution,
  commitPreparedTurn,
} = require('../dist/application/turns/commitTurn');
const { InMemoryTurnStore } = require('../dist/infra/memory/inMemoryTurnStore');
const { applySituationRuntime } = require('../dist/application/situations/causalProjection');
const { hashActionContract, serializeActionContract } = require('../dist/domain/turns/canonical');
const { FIXTURES } = require('./fixtures/phase7/situationFixtures.cjs');

const sha = {
  sha256Hex: input => crypto.createHash('sha256').update(input).digest('hex'),
};

function rescueSituationRef() {
  const entry = FIXTURES.rescue.entries.find(e => e.entryId === 'situation-sect-aftermath');
  return { situationId: entry.entryId, definition: entry.definition };
}

function branchState(overrides = {}) {
  return {
    branchId: 'b1',
    stateVersion: 4,
    clockSeconds: 3600,
    clockMinutes: 60,
    actors: {
      'actor-player': { actorId: 'actor-player', locationId: 'scene-sect', resources: { hp: 8, stamina: 6 }, conditions: [] },
      'actor-companion': { actorId: 'actor-companion', locationId: 'scene-sect', resources: { hp: 1, stamina: 2 }, conditions: ['bleeding'], lifeStatus: 'critical' },
    },
    itemOwners: {},
    discoveries: [{ entryId: 'lore-north-trail', actorId: 'actor-player', knownAtStateVersion: 1, sourceTurnId: 'turn-0001', knownVia: 'witnessed' }],
    situations: [{
      situationId: 'situation-sect-aftermath', status: 'active', counters: {},
      processedEventKeys: [], promises: [], suppressedEventKeys: {},
      sourceTurnId: 'turn-0001', statusVersion: 2, activatedAtVersion: 3,
    }],
    causalWorldTimeOrder: 20,
    ...(overrides.extraState ?? {}),
  };
}

/** A heal turn contract bound to the fixture's heal method (skill_check). */
function healContract() {
  const outcome = (achieved, summary, effects) => ({ achieved, publicSummary: summary, effects });
  return {
    protocolVersion: '3.0',
    turnId: 'turn-0005',
    expectedStateVersion: 4,
    actorId: 'actor-player',
    actionType: 'skill_check',
    skillId: 'skill-medicine',
    difficultyBand: 'normal',
    evidenceIds: [],
    requiresRoll: true,
    intent: '检查岳轻的伤势，用现有手段止血救治',
    timeCostMinutes: 10,
    resourcePreconditions: [],
    methodRef: { situationId: 'situation-sect-aftermath', methodId: 'heal' },
    outcomes: {
      full_success: outcome(true, '止血成功，伤势稳定', []),
      success: outcome(true, '止血成功，伤势稳定', []),
      failure: outcome(false, '救治没能奏效', []),
      severe_failure: outcome(false, '救治失败，伤势恶化', []),
    },
  };
}

async function setupBranch() {
  return new InMemoryTurnStore([branchState()]);
}

function rollFor(grade, contractHash) {
  return {
    rulesetId: 'shineword-core',
    rulesetVersion: '0.4.0',
    turnId: 'turn-0005',
    rollIndex: 0,
    contractHash,
    diceCount: 2,
    dieSides: 6,
    rolls: [5, 3],
    highest: 5,
    difficulty: 4,
    attribute: 3,
    skillRank: 'trained',
    grade,
    rolledAt: 'now',
  };
}

function methodOpsFor(contract, grade) {
  const { definition } = rescueSituationRef();
  const method = definition.methods.find(m => m.methodId === contract.methodRef?.methodId);
  if (!method) return [];
  return grade === 'success' || grade === 'full_success' ? [...(method.onSuccess ?? [])] : [];
}

function situationReducer(contract, grade) {
  return nextState => {
    const runtime = applySituationRuntime({
      definitions: [rescueSituationRef()],
      nextState,
      sourceTurnId: contract.turnId,
      playerActorId: 'actor-player',
      methodOps: methodOpsFor(contract, grade),
    });
    nextState.situations = runtime.situations;
    for (const fate of runtime.actorFates) {
      const actor = nextState.actors[fate.actorId];
      if (actor) actor.lifeStatus = fate.lifeStatus;
    }
    if (nextState.causalWorldTimeOrder === undefined || nextState.causalWorldTimeOrder < 30) {
      // The journey reaches the death reference's window in later turns;
      // tests set the causal order explicitly per scenario.
    }
    return runtime.events;
  };
}

test('prepared pipeline: single reduction, verbatim commit, no double apply on replay', async () => {
  const store = await setupBranch();
  const contract = healContract();
  const contractHash = await hashActionContract(contract, sha);

  const prepared = await prepareTurnResolution(store, {
    branchId: 'b1',
    contract,
    contractHash,
    outcomeGrade: 'success',
    rollRecord: rollFor('success', contractHash),
    contractOrigin: 'engine',
    applyAuthoritativeState: situationReducer(contract, 'success'),
    updateNextState: nextState => {
      // Engine success effects from the method's successEffects would be
      // injected by compileProposal; emulate them for this test.
      const companion = nextState.actors['actor-companion'];
      companion.conditions = companion.conditions.filter(c => c !== 'bleeding');
      companion.resources.hp = Math.min(8, (companion.resources.hp ?? 0) + 2);
      companion.lifeStatus = 'active';
    },
  });
  assert.equal(prepared.nextState.stateVersion, 5);
  assert.equal(prepared.nextState.actors['actor-companion'].conditions.includes('bleeding'), false);
  const counterAfterPrepare = prepared.nextState.situations[0].counters.companion_stabilized;
  assert.equal(counterAfterPrepare, 1);

  const commit = await commitPreparedTurn({ store, prepared });
  assert.equal(commit.replayed, false);
  assert.equal(commit.committedTurn.stateVersion, 5);

  // Replay the same commit: the store returns the existing row; the counter
  // in persisted state stays 1 (no second reward/consequence pass).
  const replay = await commitPreparedTurn({ store, prepared });
  assert.equal(replay.replayed, true);
  const stateAfter = await store.getState('b1');
  assert.equal(stateAfter.situations[0].counters.companion_stabilized, 1);
});

test('route divergence: saved companion suppresses the death reference at order 30', async () => {
  const store = await setupBranch();
  const contract = healContract();
  const contractHash = await hashActionContract(contract, sha);
  const prepared = await prepareTurnResolution(store, {
    branchId: 'b1',
    contract,
    contractHash,
    outcomeGrade: 'success',
    rollRecord: rollFor('success', contractHash),
    contractOrigin: 'engine',
    applyAuthoritativeState: situationReducer(contract, 'success'),
    updateNextState: nextState => {
      const companion = nextState.actors['actor-companion'];
      companion.conditions = companion.conditions.filter(c => c !== 'bleeding');
      companion.resources.hp = 3;
      companion.lifeStatus = 'active';
      nextState.causalWorldTimeOrder = 30; // later journey point
    },
  });
  const committed = await commitPreparedTurn({ store, prepared });
  assert.equal(committed.replayed, false);
  const state = await store.getState('b1');
  const situation = state.situations[0];
  assert.ok(situation.suppressedEventKeys['evt-companion-death'], 'reference suppressed with audit');
  assert.equal(state.actors['actor-companion'].lifeStatus, 'active', 'companion alive on this branch');
});

test('route divergence: unsaved companion meets the death reference on the branch', async () => {
  const store = await setupBranch();
  const contract = healContract();
  const contractHash = await hashActionContract(contract, sha);
  const prepared = await prepareTurnResolution(store, {
    branchId: 'b1',
    contract,
    contractHash,
    outcomeGrade: 'failure',
    rollRecord: rollFor('failure', contractHash),
    contractOrigin: 'engine',
    applyAuthoritativeState: situationReducer(contract, 'failure'),
    updateNextState: nextState => {
      // The player failed the rescue and moved on; the causal order later
      // reaches the death window while the companion still bleeds.
      nextState.causalWorldTimeOrder = 30;
    },
  });
  const committed = await commitPreparedTurn({ store, prepared });
  assert.equal(committed.replayed, false);
  const state = await store.getState('b1');
  const situation = state.situations[0];
  assert.equal(situation.suppressedEventKeys['evt-companion-death'], undefined, 'no suppression: the reference fired');
  assert.equal(situation.processedEventKeys.includes('ref:evt-companion-death'), true, 'reference applied with idempotency stamp');
  assert.equal(state.actors['actor-companion'].lifeStatus, 'dead', 'actor fate applied on this branch');
  assert.equal(situation.status, 'resolved');
  assert.equal(situation.resolution, '岳轻伤重不治');
});

test('failure route keeps real consequences: no free recovery', async () => {
  const store = await setupBranch();
  const contract = healContract();
  const contractHash = await hashActionContract(contract, sha);
  const prepared = await prepareTurnResolution(store, {
    branchId: 'b1',
    contract,
    contractHash,
    outcomeGrade: 'severe_failure',
    rollRecord: rollFor('severe_failure', contractHash),
    contractOrigin: 'engine',
    applyAuthoritativeState: situationReducer(contract, 'severe_failure'),
    updateNextState: nextState => {
      nextState.actors['actor-player'].resources.stamina -= 1;
    },
  });
  await commitPreparedTurn({ store, prepared });
  const state = await store.getState('b1');
  assert.equal(state.actors['actor-player'].resources.stamina, 5, 'stamina cost persisted');
  assert.equal(state.actors['actor-companion'].conditions.includes('bleeding'), true, 'bleeding NOT narrated away');
  assert.equal(state.situations[0].counters.companion_stabilized, undefined, 'no reward for a failed attempt');
});
