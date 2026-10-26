/**
 * Local opening-goal generation (convergence plan W2, acceptance C-03/C-04
 * automated halves): determinism, ≤28 code points, ≤2 items, dedupe, and
 * graceful fallbacks for empty world data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { localOpeningGoals } = require('../dist/application/campaign/localOpeningGoals');

const input = {
  worldTitle: '三宝书',
  anchorTitle: '序0 · 程岩穿越为四王子罗兰',
  locationName: '王府',
  characterNames: ['罗兰', '老管家'],
  playerName: '旅人',
};

test('generates deterministic template goals without any provider', () => {
  const first = localOpeningGoals(input);
  const second = localOpeningGoals({ ...input });
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.match(first[0], /^查明/);
  assert.match(first[1], /^与/);
});

test('every suggestion is at most 28 code points', () => {
  const longAnchor = { ...input, anchorTitle: '序12 · ' + '很长的开局标题'.repeat(10), characterNames: ['亚历山德拉·冯·施瓦岑贝格公主殿下'] };
  for (const goal of localOpeningGoals(longAnchor)) {
    assert.ok(Array.from(goal).length <= 28, `goal too long: ${goal} (${Array.from(goal).length})`);
  }
});

test('anchor ordinal prefix is stripped and anchor is the goal subject', () => {
  const [goal] = localOpeningGoals(input);
  assert.ok(goal.includes('程岩穿越为四王子罗兰'), goal);
  assert.ok(!goal.includes('序0'), goal);
});

test('falls back to location when no canon characters are known', () => {
  const goals = localOpeningGoals({ ...input, characterNames: [] });
  assert.equal(goals.length, 2);
  assert.match(goals[1], /^在王府站稳脚跟$/);
});

test('falls back to a neutral goal with no anchor and no location', () => {
  const goals = localOpeningGoals({ worldTitle: '书', anchorTitle: '', locationName: undefined, characterNames: [], playerName: 'x' });
  assert.equal(goals.length, 2);
  assert.equal(goals[0], '查明开局事件的来龙去脉');
  assert.equal(goals[1], '改善当前的处境');
});

test('never returns duplicates and never exceeds two goals', () => {
  const goals = localOpeningGoals({ worldTitle: '书', anchorTitle: '序0 · x', locationName: '与x结盟，改善处境', characterNames: [] });
  // anchor core "x" produces 查明x的来龙去脉; location fallback 在与x结盟，改善处境站稳脚跟 may
  // exceed 28 and be dropped — the invariant is dedupe and the ≤2 cap.
  assert.ok(goals.length >= 1 && goals.length <= 2);
  assert.equal(new Set(goals).size, goals.length);
});
