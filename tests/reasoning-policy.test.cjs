const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REASONING_CALIBRATION_MIN_SAMPLES,
  REASONING_RESERVE_POLICY,
  REASONING_USAGE_ROLLING_WINDOW,
  reasoningUsageStatsFromSamples,
  providerReasoningParamsForTier,
  reasoningDialectForModel,
  resolveReasoningPolicy,
  ReasoningCapabilityInsufficientError,
  ReasoningDialectUnsupportedError,
} = require('../dist/application/llm/reasoningPolicy');
const { normalizeReasoningTier } = require('../dist/application/llm/types');
const { llmModelProfileFingerprint } = require('../dist/application/llm/profileFingerprint');

const kinds = Object.keys(REASONING_RESERVE_POLICY);
const tiers = ['low', 'high', 'max'];

test('one cold-start policy has strictly increasing reserves for every request kind', () => {
  for (const requestKind of kinds) {
    const reserves = REASONING_RESERVE_POLICY[requestKind].target;
    assert.ok(reserves.low < reserves.high, `${requestKind}: low < high`);
    assert.ok(reserves.high < reserves.max, `${requestKind}: high < max`);
  }
  assert.ok(REASONING_RESERVE_POLICY.narrator.target.high < REASONING_RESERVE_POLICY.planner.target.high,
    'Narrator keeps an independent, smaller reserve than Planner');
});

test('provider dialects preserve all three product tiers and never disable thinking', () => {
  for (const tier of tiers) {
    assert.deepEqual(providerReasoningParamsForTier('glm', tier), {
      reasoning_effort: tier,
      thinking: { clear_thinking: false },
    });
    assert.deepEqual(providerReasoningParamsForTier('deepseek', tier), {
      thinking: { type: 'enabled' },
      reasoning_effort: tier,
    });
    assert.deepEqual(providerReasoningParamsForTier('generic', tier), {
      reasoning_effort: tier,
    });
  }
});

test('legacy off normalizes only at the compatibility boundary', () => {
  assert.equal(normalizeReasoningTier('off'), 'low');
  assert.equal(normalizeReasoningTier(undefined), 'low');
  assert.equal(normalizeReasoningTier('low'), 'low');
  assert.equal(normalizeReasoningTier('high'), 'high');
  assert.equal(normalizeReasoningTier('max'), 'max');
});

test('reserve is clamped below both the model and wire ceilings while preserving the requested tier', () => {
  const result = resolveReasoningPolicy({
    providerDialect: 'glm', model: 'glm-test', tier: 'high', requestKind: 'planner',
    modelMaxOutputTokens: 10_000, contextWindowTokens: 32_000,
    providerWireMaxOutputTokens: 6_000,
  });
  assert.equal(result.tier, 'high');
  assert.equal(result.effectiveTier, 'high');
  assert.equal(result.reserveTokens, 5_100);
  assert.equal(result.reserveClamped, true);
  assert.ok(result.reserveTokens < 10_000);
  assert.ok(result.reserveTokens + 900 <= 6_000);
});

test('insufficient output capacity rejects max instead of silently downgrading its reserve or tier', () => {
  assert.throws(() => resolveReasoningPolicy({
    providerDialect: 'glm', model: 'small-model', tier: 'max', requestKind: 'planner',
    modelMaxOutputTokens: 10_000, contextWindowTokens: 32_000,
    providerWireMaxOutputTokens: 6_000,
  }), error => error instanceof ReasoningCapabilityInsufficientError
    && /minimum max reasoning budget/.test(error.message));
});

test('reasoning usage calibration waits for enough known samples and uses P95 with 25 percent headroom', () => {
  const input = {
    providerDialect: 'generic', model: 'm', tier: 'high', requestKind: 'planner',
    modelMaxOutputTokens: 131_072, contextWindowTokens: 1_048_576,
  };
  const cold = resolveReasoningPolicy({ ...input, historicalStats: { sampleCount: REASONING_CALIBRATION_MIN_SAMPLES - 1, p95: 12_000 } });
  assert.equal(cold.reserveSource, 'cold_start');
  assert.equal(cold.reserveTokens, 8_192);

  const calibrated = resolveReasoningPolicy({ ...input, historicalStats: { sampleCount: 8, p95: 12_000 } });
  assert.equal(calibrated.reserveSource, 'usage_calibrated');
  assert.equal(calibrated.reserveTokens, 15_000);
  assert.equal(calibrated.p95ReasoningTokens, 12_000);
});

test('reasoning usage stats retain known percentiles and exclude unknown values', () => {
  assert.equal(REASONING_USAGE_ROLLING_WINDOW, 32);
  assert.deepEqual(reasoningUsageStatsFromSamples([500, 900, 1_200, 1_600, 2_100, null, undefined, NaN]), {
    sampleCount: 5,
    p50: 1_200,
    p90: 2_100,
    p95: 2_100,
    max: 2_100,
  });
  assert.equal(reasoningUsageStatsFromSamples([null, undefined]), null);
});

test('model dialect detection is request policy routing, and unsupported is explicit', () => {
  assert.equal(reasoningDialectForModel('deepseek-flash'), 'deepseek');
  assert.equal(reasoningDialectForModel('DeepSeek-V4.1-Flash'), 'deepseek');
  assert.equal(reasoningDialectForModel('glm-5.3-flash'), 'glm');
  assert.equal(reasoningDialectForModel('custom-endpoint-model'), 'generic');
  assert.throws(() => providerReasoningParamsForTier('unsupported', 'max'), ReasoningDialectUnsupportedError);
});

test('usage profile fingerprint distinguishes endpoint/model capabilities without storing endpoint text', () => {
  const profile = {
    id: 'glm-main', endpoint: 'https://api.example/v1', model: 'glm-5.3-flash',
    capabilities: { contextWindow: 1_048_576, maxOutputTokens: 131_072 },
    reasoningDialect: 'glm', reasoningTier: 'low',
  };
  const fingerprint = llmModelProfileFingerprint(profile);
  assert.equal(fingerprint.includes(profile.endpoint), false);
  assert.notEqual(fingerprint, llmModelProfileFingerprint({ ...profile, endpoint: 'https://other.example/v1' }));
  assert.notEqual(fingerprint, llmModelProfileFingerprint({ ...profile, model: 'other-model' }));
  assert.notEqual(fingerprint, llmModelProfileFingerprint({
    ...profile, capabilities: { ...profile.capabilities, contextWindow: 128_000 },
  }));
  assert.equal(fingerprint, llmModelProfileFingerprint({ ...profile, reasoningTier: 'max' }),
    'tier stays a separate ledger dimension');
});
