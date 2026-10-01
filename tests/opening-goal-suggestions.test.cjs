// Opening-goal suggestions (product ask 2026-10-01 #3): two short goals from
// one JSON request over the world package; every failure mode resolves to an
// empty array so the wizard never blocks.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestOpeningGoals } = require('../dist/application/campaign/openingGoalSuggestions');

const INPUT = {
  worldTitle: '放开那个女巫',
  anchorTitle: '序0 · 程岩穿越为四王子罗兰',
  locationName: '绝境山脉',
  characterNames: ['罗兰', '安娜', '巴罗夫'],
  playerName: 'Roland',
};

function providerReturning(text) {
  return {
    async complete(request) {
      assert.equal(request.requestKind, 'opening_goal');
      assert.equal(request.jsonMode, true);
      return { text, usage: { estimated: true } };
    },
  };
}

test('parses two goals from a clean JSON completion', async () => {
  const goals = await suggestOpeningGoals(providerReturning(
    '{"goals":["查明绞刑架下女巫的死因","在边陲镇站稳脚跟并招募第一批手下"]}',
  ), INPUT);
  assert.deepEqual(goals, ['查明绞刑架下女巫的死因', '在边陲镇站稳脚跟并招募第一批手下']);
});

test('caps at two goals, trims and drops fragments', async () => {
  const goals = await suggestOpeningGoals(providerReturning(
    '{"goals":["  目标一：调查黑鸦标记  ","短","目标三：活下来","目标四"]}',
  ), INPUT);
  assert.deepEqual(goals, ['目标一：调查黑鸦标记', '目标三：活下来']);
});

test('degrades to [] on non-JSON, wrong shape, provider error', async () => {
  assert.deepEqual(await suggestOpeningGoals(providerReturning('不是 JSON'), INPUT), []);
  assert.deepEqual(await suggestOpeningGoals(providerReturning('{"goals":"不是数组"}'), INPUT), []);
  const throwing = {
    async complete() { throw new Error('HTTP 429'); },
  };
  assert.deepEqual(await suggestOpeningGoals(throwing, INPUT), []);
});
