const test = require('node:test');
const assert = require('node:assert/strict');
const { previewLlmRequestBudget, PREVIEW_MANDATORY_INPUT_ESTIMATE } = require('../dist/application/llm/requestBudgetPreview');
const { planLlmRequest, DEFAULT_OUTPUT_DEMANDS } = require('../dist/application/llm/requestBudgetKernel');
const { resolveModelCapabilities } = require('../dist/application/llm/capabilityResolver');

function productionPlan(input) {
  return planLlmRequest({
    capabilities: resolveModelCapabilities({
      declared: { contextWindowTokens: input.contextWindowTokens, maxOutputTokens: input.maxOutputTokens },
      reasoningMode: 'always_on',
    }),
    requestKind: input.requestKind,
    estimatedMandatoryInputTokens: input.representativeMandatoryInputTokens ?? PREVIEW_MANDATORY_INPUT_ESTIMATE,
    businessOutputDemand: DEFAULT_OUTPUT_DEMANDS[input.requestKind],
    reasoningPolicy: { model: input.model, providerDialect: input.providerDialect, tier: input.reasoningTier },
  });
}

for (const contextWindowTokens of [32_000, 64_000, 128_000, 200_000, 1_048_576]) {
  for (const reasoningTier of ['low', 'high', 'max']) {
    test(`Planner preview matches production @ ${contextWindowTokens} / ${reasoningTier}`, () => {
      for (const providerDialect of ['deepseek', 'glm', 'generic']) {
        for (const representativeMandatoryInputTokens of [PREVIEW_MANDATORY_INPUT_ESTIMATE, 600]) {
          const input = {
            contextWindowTokens, maxOutputTokens: 32_768, model: `${providerDialect}-fixture`,
            providerDialect, reasoningTier, requestKind: 'planner', representativeMandatoryInputTokens,
          };
          const preview = previewLlmRequestBudget(input);
          const plan = productionPlan(input);
          assert.deepEqual(preview, {
            available: true, contextWindowTokens,
            businessOutputTokens: plan.requestedOutputTokens,
            reasoningReserveTokens: plan.envelope.reasoningReserveTokens,
            safetyMarginTokens: plan.envelope.safetyMarginTokens,
            hardInputLimit: plan.envelope.hardInputLimit,
            softInputLimit: plan.envelope.softInputLimit,
            burstInputLimit: plan.envelope.burstInputLimit,
            wireOutputTokens: plan.wireOutputTokens,
            reserveClamped: plan.reasoningPolicy.reserveClamped,
          });
          assert.equal(plan.reasoningPolicy.effectiveTier, reasoningTier);
        }
      }
    });
  }
}

const base = {
  model: 'custom-model', providerDialect: 'generic', reasoningTier: 'low', requestKind: 'planner',
};

test('unknown or incomplete custom capabilities cannot become a precise preview or be mutated', () => {
  for (const capabilities of [{}, { contextWindowTokens: 128_000 }, { maxOutputTokens: 8_192 }]) {
    const input = { ...base, ...capabilities };
    const before = structuredClone(input);
    assert.deepEqual(previewLlmRequestBudget(input), {
      available: false,
      errorCode: capabilities.contextWindowTokens === undefined ? 'context_window_unknown' : 'max_output_unknown',
    });
    assert.deepEqual(input, before);
  }
});

test('32K / 4K output / Max is explicitly infeasible without negative budgets or a tier downgrade', () => {
  const input = { ...base, contextWindowTokens: 32_000, maxOutputTokens: 4_096, reasoningTier: 'max' };
  assert.deepEqual(previewLlmRequestBudget(input), {
    available: false, errorCode: 'reasoning_capability_insufficient',
  });
  assert.throws(() => productionPlan(input), error => error.code === 'reasoning_capability_insufficient');
  assert.equal(input.reasoningTier, 'max');
});

test('a clamped reserve is the same as production and leaves the selected tier intact', () => {
  const input = { ...base, contextWindowTokens: 32_000, maxOutputTokens: 6_000, reasoningTier: 'high' };
  const preview = previewLlmRequestBudget(input);
  const plan = productionPlan(input);
  assert.equal(preview.available, true);
  assert.equal(preview.reserveClamped, true);
  assert.equal(preview.reasoningReserveTokens, plan.envelope.reasoningReserveTokens);
  assert.equal(preview.businessOutputTokens, plan.requestedOutputTokens);
  assert.equal(preview.hardInputLimit, plan.envelope.hardInputLimit);
  assert.equal(plan.reasoningPolicy.effectiveTier, 'high');
});

test('a small context fails even when the model output declaration is large', () => {
  const input = { ...base, contextWindowTokens: 2_048, maxOutputTokens: 393_216, reasoningTier: 'max' };
  assert.deepEqual(previewLlmRequestBudget(input), {
    available: false, errorCode: 'reasoning_capability_insufficient',
  });
});

test('the settings preview honors explicit unsupported reasoning dialects', () => {
  assert.deepEqual(previewLlmRequestBudget({
    ...base, contextWindowTokens: 128_000, maxOutputTokens: 32_768, providerDialect: 'unsupported',
  }), { available: false, errorCode: 'reasoning_dialect_unsupported' });
});

test('Planner preview grants the production maximum when available instead of the old UI target', () => {
  const preview = previewLlmRequestBudget({ ...base, contextWindowTokens: 128_000, maxOutputTokens: 32_768 });
  assert.equal(preview.available, true);
  assert.equal(preview.businessOutputTokens, DEFAULT_OUTPUT_DEMANDS.planner.maximum);
  assert.notEqual(preview.businessOutputTokens, DEFAULT_OUTPUT_DEMANDS.planner.target);
});
