const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canTransitionTurn,
  transitionTurn,
  validateActionContract,
} = require('../dist/domain');

function validContract() {
  const outcome = (achieved, publicSummary) => ({ achieved, publicSummary, effects: [] });
  return {
    protocolVersion: '3.0',
    turnId: 'turn-001',
    expectedStateVersion: 12,
    actorId: 'actor-player',
    actionType: 'stealth',
    targetId: 'location-archive',
    skillId: 'stealth',
    difficultyBand: 'challenging',
    evidenceIds: ['fact-wall', 'scene-rain'],
    requiresRoll: true,
    intent: '进入藏书阁且不被发现',
    timeCostMinutes: 5,
    resourcePreconditions: [],
    outcomes: {
      full_success: outcome(true, '进入并取得有利藏身位置'),
      success: outcome(true, '成功进入藏书阁'),
      failure: outcome(false, '被发现，转入交涉'),
      severe_failure: outcome(false, '被包围，但保留下一步行动'),
    },
  };
}

test('turn state machine allows the documented roll path', () => {
  const path = ['Draft', 'Planned', 'AwaitRoll', 'Resolved', 'Narrated', 'Validated', 'Committed'];
  let state = path[0];
  for (const next of path.slice(1)) {
    assert.equal(canTransitionTurn(state, next), true);
    state = transitionTurn(state, next);
  }
  assert.equal(state, 'Committed');
});

test('turn state machine rejects skipping resolution', () => {
  assert.equal(canTransitionTurn('AwaitRoll', 'Narrated'), false);
  assert.throws(() => transitionTurn('AwaitRoll', 'Narrated'), /Illegal turn transition/);
});

test('valid action contract contains all four frozen outcomes', () => {
  assert.deepEqual(validateActionContract(validContract()), []);
});

test('planner cannot smuggle local roll results into a contract', () => {
  const contract = validContract();
  contract.outcomes.success.effects.push({ op: 'recordEvent', eventType: 'entered', summary: 'ok', randomValue: 8 });
  const errors = validateActionContract(contract);
  assert.ok(errors.some((item) => item.includes('randomValue')));
});
