// 1M resident build P0 regression suite: output-budget-driven packer v2,
// online per-chunk output calibration, adaptive split sizing, and the
// profile budget with reasoning-reserve fields (plan §3.1/§5).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planExtractGroups,
  OutputPerChunkCalibrator,
  splitPartCount,
  DEFAULT_EST_OUTPUT_PER_CHUNK,
} = require('../dist/application/worldBuild/groupPlanner');
const {
  modelBudgetFromProfile,
} = require('../dist/application/worldBuild/profileModelBudget');

/** 1M-class budget per plan §3.1 (DeepSeek V4.1 Flash extraction profile). */
const BUDGET_1M = {
  contextWindowTokens: 1_048_576,
  maxContentOutputTokens: 16_384,
  reasoningReserveTokens: 0,
  reasoningEffort: 'off',
  supportsPromptCache: true,
  reserveTokens: 2_000,
};

function syntheticChunks(count, charCount) {
  return Array.from({ length: count }, (_, i) => ({
    chunkId: `c${String(i).padStart(4, '0')}`,
    chapterId: `ch-${String(Math.floor(i / 8)).padStart(3, '0')}`,
    chunkIndex: i,
    startOffset: i * charCount,
    endOffset: (i + 1) * charCount,
    charCount,
    contentHash: `h${i}`,
  }));
}

test('T1 packer v2: 944 chunks x 1200 cp under a 1M budget are grouped by OUTPUT budget', () => {
  const chunks = syntheticChunks(944, 1_200);
  const groups = planExtractGroups(chunks, BUDGET_1M);

  // Coverage invariants survive the redesign.
  const planned = groups.flatMap(group => group.segments);
  assert.equal(planned.length, chunks.length);
  for (let i = 0; i < planned.length; i += 1) {
    assert.equal(planned[i].chunkId, chunks[i].chunkId, 'order preserved');
  }

  // Group size is decided by the output budget: 16384 * 0.7 / 800 = 14.33,
  // so every group carries at most 14 chunks and never approaches the
  // 32-segment evidence-reliability cap (let alone the legacy 64).
  for (const group of groups) {
    assert.ok(group.segments.length >= 4, 'amortization floor of 4 chunks');
    assert.ok(group.segments.length <= 32, 'evidence-attribution reliability cap');
    assert.ok(group.segments.length <= 14, 'output-budget driven group size');
    const estOutput = group.segments.length * DEFAULT_EST_OUTPUT_PER_CHUNK;
    assert.ok(estOutput <= 16_384 * 0.7, `estimated output ${estOutput} fits 0.7 x content budget`);
  }
  // 944 / 14 = 67.4 -> 68 groups; the 1M input budget never binds.
  assert.equal(groups.length, 68);
  assert.ok(groups.every(group => group.estInputTokens <= 14 * 1_200));

  // GLM-style 16k content + 2048 reasoning reserve keeps the same grouping:
  // the reserve shrinks the input budget only, which is irrelevant at 1M.
  const glmBudget = { ...BUDGET_1M, reasoningReserveTokens: 4_096, reasoningEffort: 'low' };
  const glmGroups = planExtractGroups(chunks, glmBudget);
  assert.equal(glmGroups.length, 68);
});

test('T1 packer v2: calibrated estimates shrink groups without breaking coverage', () => {
  const chunks = syntheticChunks(60, 1_200);
  const groups = planExtractGroups(chunks, BUDGET_1M, { estOutputPerChunk: 1_600 });
  for (const group of groups) {
    assert.ok(group.segments.length <= 7, '16384*0.7/1600 = 7 chunks per group');
    assert.ok(group.segments.length >= 4);
  }
  const planned = groups.flatMap(group => group.segments);
  assert.equal(planned.length, 60);
  for (let i = 0; i < planned.length; i += 1) {
    assert.equal(planned[i].chunkId, chunks[i].chunkId);
  }
});

test('output calibrator fires after 3 groups, then every 10, over a 10-group sliding window', () => {
  const calibrator = new OutputPerChunkCalibrator();
  assert.equal(calibrator.currentEstimate, DEFAULT_EST_OUTPUT_PER_CHUNK);
  assert.equal(calibrator.due(1), false);
  assert.equal(calibrator.due(2), false);
  assert.equal(calibrator.due(3), true, 'first checkpoint after 3 units');
  calibrator.record(2_800, 14);
  calibrator.record(3_150, 14);
  calibrator.record(2_730, 14);
  assert.equal(Math.ceil((2800 + 3150 + 2730) / 42), calibrator.recalibrate());
  assert.equal(calibrator.currentEstimate, 207);

  assert.equal(calibrator.due(10), false);
  assert.equal(calibrator.due(13), true, 'then every 10 groups');
  for (let i = 0; i < 10; i += 1) calibrator.record(14 * 800, 14);
  assert.equal(calibrator.recalibrate(), 800, 'recent samples dominate the window');
  assert.equal(calibrator.currentEstimate, 800);
});

test('split sizing halves by default and only adds parts when the calibrated estimate demands it', () => {
  // Default estimate (800): a 14-chunk group with a 16k content budget halves.
  assert.equal(splitPartCount(14, 800, 16_384), 2);
  assert.equal(splitPartCount(1, 800, 16_384), 1, 'single chunk cannot split');
  // Calibrated 4x estimate: even a half (7 x 3200 = 22400) would overflow, so
  // parts of at most 3 chunks each -> ceil(14/3) = 5 parts.
  assert.equal(splitPartCount(14, 3_200, 16_384), 5);
  // Tiny content budget: the parts cap out at one chunk each.
  assert.equal(splitPartCount(6, 800, 1_000), 6);
});

test('profile budget carries request-kind reasoning reserves and business output separately', () => {
  const glm = modelBudgetFromProfile({
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: 1_048_576, maxOutputTokens: 131_072, supportsPromptCache: true,
    },
    contentOutputTokens: 16_384,
    reasoningReserveTokens: 2_048,
    reasoningEffort: 'low',
  });
  assert.equal(glm.maxContentOutputTokens, 16_384);
  assert.equal(glm.reasoningReserveTokens, 4_096);
  assert.equal(glm.reasoningEffort, 'low');
  assert.equal(glm.reasoningTier, 'low');
  assert.equal(glm.supportsPromptCache, true);
  // The planner's initial estimate is business output; the kernel adds reserve
  // once to produce the exact provider wire ceiling.
  const requestMaxTokens = glm.maxContentOutputTokens + glm.reasoningReserveTokens;
  assert.equal(requestMaxTokens, 20_480);
  assert.ok(131_072 - requestMaxTokens > 0);

  // A small but sufficient ceiling keeps the low tier and shrinks business
  // output to preserve the minimum reasoning reserve.
  const small = modelBudgetFromProfile({
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: 32_000, maxOutputTokens: 8_192,
    },
    reasoningReserveTokens: 2_048,
    reasoningEffort: 'low',
  });
  assert.equal(small.reasoningTier, 'low');
  assert.equal(small.reasoningReserveTokens, 4_096);
  assert.equal(small.maxContentOutputTokens, 4_096);

  // Legacy off migrates to low; automatic World Build never closes thinking.
  const deepseek = modelBudgetFromProfile({
    capabilities: {
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      contextWindow: 1_048_576, maxOutputTokens: 393_216, supportsPromptCache: true,
    },
    reasoningEffort: 'off',
  });
  assert.equal(deepseek.maxContentOutputTokens, 16_384);
  assert.equal(deepseek.reasoningReserveTokens, 4_096);
  assert.equal(deepseek.reasoningTier, 'low');
});
