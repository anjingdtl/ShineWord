'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { modelBudgetFromProfile } = require('../dist/application/worldBuild/profileModelBudget');

function profile(contextWindow, maxOutputTokens) {
  return { capabilities: { contextWindow, maxOutputTokens } };
}

test('opening/full-build planner budget follows profile capabilities and extractor output cap', () => {
  assert.deepEqual(modelBudgetFromProfile(profile(32_000, 4_096)), {
    contextWindowTokens: 32_000,
    maxContentOutputTokens: 4_096,
    reasoningReserveTokens: 0,
    reasoningEffort: 'off',
    supportsPromptCache: false,
    reserveTokens: 2_000,
  });
  // The legacy 8k hard clamp is removed (1M plan §5): a profile that
  // declares a 16k output ceiling now keeps its full content budget.
  assert.deepEqual(modelBudgetFromProfile(profile(128_000, 16_000)), {
    contextWindowTokens: 128_000,
    maxContentOutputTokens: 16_000,
    reasoningReserveTokens: 0,
    reasoningEffort: 'off',
    supportsPromptCache: false,
    reserveTokens: 2_000,
  });
  assert.equal(modelBudgetFromProfile(profile(128_000, 131_072)).maxContentOutputTokens, 16_384);
});

test('profile budget rejects invalid limits before planning or making requests', () => {
  assert.throws(() => modelBudgetFromProfile(profile(0, 4096)), /contextWindow/);
  assert.throws(() => modelBudgetFromProfile(profile(32_000, 0)), /maxOutputTokens/);
  assert.throws(() => modelBudgetFromProfile(profile(4_000, 8_000)), /leaves no room/);
});
