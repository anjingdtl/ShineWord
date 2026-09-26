const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRoll, gradeMargin, qualifyAction } = require('../dist/domain');

class SequenceRandom {
  constructor(values) {
    this.values = values.slice();
  }
  nextIntInclusive() {
    if (this.values.length === 0) throw new Error('Sequence exhausted');
    return this.values.shift();
  }
}

test('3d8 keep-high resolves [2,5,7] as ordinary success at D6', () => {
  const record = resolveRoll({
    turnId: 'turn-001',
    rollIndex: 0,
    contractHash: 'contract-001',
    spec: { attribute: 2, skillRank: 'trained', situationalDiceModifier: 1, difficulty: 6 },
    random: new SequenceRandom([2, 5, 7]),
    createdAt: '2026-09-26T00:00:00.000Z',
  });
  assert.deepEqual(record.rolls, [2, 5, 7]);
  assert.equal(record.diceCount, 3);
  assert.equal(record.dieSides, 8);
  assert.equal(record.highest, 7);
  assert.equal(record.margin, 1);
  assert.equal(record.grade, 'success');
});

test('3d8 keep-high resolves [1,2,3] as severe failure at D6', () => {
  const record = resolveRoll({
    turnId: 'turn-002',
    rollIndex: 0,
    contractHash: 'contract-002',
    spec: { attribute: 2, skillRank: 'trained', situationalDiceModifier: 1, difficulty: 6 },
    random: new SequenceRandom([1, 2, 3]),
  });
  assert.equal(record.highest, 3);
  assert.equal(record.margin, -3);
  assert.equal(record.grade, 'severe_failure');
});

test('margin grading follows the four frozen outcome tiers', () => {
  assert.equal(gradeMargin(3), 'full_success');
  assert.equal(gradeMargin(0), 'success');
  assert.equal(gradeMargin(-1), 'failure');
  assert.equal(gradeMargin(-3), 'severe_failure');
});

test('qualification blocks impossible actions before rolling', () => {
  assert.equal(qualifyAction({ hasRequiredCapability: false }).mode, 'blocked');
  assert.equal(qualifyAction({ violatesHardRule: true }).mode, 'blocked');
  assert.equal(qualifyAction({ uncertain: false }).mode, 'automatic');
  assert.equal(qualifyAction({ uncertain: true, consequential: true }).mode, 'roll');
});
