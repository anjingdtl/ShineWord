const test = require('node:test');
const assert = require('node:assert/strict');
const {
  diceCountFor,
  dieSidesFor,
  difficultyForBand,
  successProbability,
  formatProbability,
} = require('../dist/domain');

test('ruleset maps attributes, skills and difficulty exactly', () => {
  assert.equal(diceCountFor(2, 1), 3);
  assert.equal(diceCountFor(1, -1), 1);
  assert.equal(diceCountFor(3, 1), 4);
  assert.equal(dieSidesFor('trained'), 8);
  assert.equal(difficultyForBand('challenging'), 6);
});

test('probability examples match construction plan', () => {
  assert.equal(successProbability(1, 8, 6), 0.375);
  assert.equal(successProbability(2, 8, 6), 0.609375);
  assert.equal(successProbability(3, 8, 6), 0.755859375);
  assert.ok(Math.abs(successProbability(2, 6, 6) - 11 / 36) < 1e-12);
  assert.equal(successProbability(2, 10, 6), 0.75);
  assert.equal(formatProbability(successProbability(3, 8, 6)), '75.59%');
});

test('probability respects impossible and automatic boundaries', () => {
  assert.equal(successProbability(2, 4, 5), 0);
  assert.equal(successProbability(2, 4, 1), 1);
});
