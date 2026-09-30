const test = require('node:test');
const assert = require('node:assert/strict');

const { allocateElasticContext } = require('../dist/application/context/elasticAllocator');
const { computeRequestEnvelope, deriveSafetyMargin } = require('../dist/application/context/modelEnvelope');
const { boardDemand, DEFAULT_BOARD_POLICIES } = require('../dist/application/context/contextPolicy');
const { planLlmRequest, DEFAULT_OUTPUT_DEMANDS } = require('../dist/application/llm/requestBudgetKernel');
const { resolveModelCapabilities, deriveMaxOutputTokens } = require('../dist/application/llm/capabilityResolver');
const { BudgetInfeasibleError, stableFingerprint } = require('../dist/application/llm/requestPlan');
const { probeCapabilities } = require('../dist/application/llm/capabilities');

const PLANNER_DEMAND = DEFAULT_OUTPUT_DEMANDS.planner;

function capabilities(overrides = {}) {
  return resolveModelCapabilities({
    declared: { contextWindowTokens: 128_000, maxOutputTokens: 32_768 },
    reasoningMode: 'always_on',
    ...overrides.declared ? {} : {},
    ...overrides,
  });
}

/** Declared 128K/32K profile with always-on reasoning (GLM-like). */
function glmLikeCapabilities(contextWindow = 128_000, maxOutput = 32_768) {
  return resolveModelCapabilities({
    declared: { contextWindowTokens: contextWindow, maxOutputTokens: maxOutput },
    reasoningMode: 'always_on',
  });
}

/** Six-board representative demand set (plan §12.1). */
function sixBoardDemands(scale = 1) {
  return [
    boardDemand({ id: 'authority', board: 'authority', estimatedTokens: Math.floor(1_200 * scale) }),
    boardDemand({ id: 'current', board: 'currentState', estimatedTokens: Math.floor(2_000 * scale) }),
    boardDemand({ id: 'world', board: 'worldKnowledge', estimatedTokens: Math.floor(8_000 * scale) }),
    boardDemand({ id: 'memory', board: 'storyMemory', estimatedTokens: Math.floor(3_000 * scale) }),
    boardDemand({ id: 'recent', board: 'recentHistory', estimatedTokens: Math.floor(2_500 * scale) }),
    boardDemand({ id: 'evidence', board: 'sourceEvidence', estimatedTokens: Math.floor(2_000 * scale) }),
  ];
}

const WINDOWS = [32_000, 64_000, 128_000, 200_000, 1_048_576];

// ---------------------------------------------------------------- B01 unknown
test('B01: unknown context window fails closed (never fabricated 128K)', () => {
  const unknown = resolveModelCapabilities({ reasoningMode: 'unknown' });
  assert.equal(unknown.contextWindowTokens, null);
  assert.equal(unknown.contextWindowSource, 'unknown');
  assert.throws(
    () => planLlmRequest({
      capabilities: unknown,
      requestKind: 'planner',
      estimatedMandatoryInputTokens: 500,
      businessOutputDemand: PLANNER_DEMAND,
    }),
    error => error instanceof BudgetInfeasibleError && error.code === 'context_window_unknown',
  );
});

// ------------------------------------------------------- B02 mandatory kept
test('B02: 32K window keeps mandatory whole under pressure', () => {
  const plan = planLlmRequest({
    capabilities: glmLikeCapabilities(32_000, 8_192),
    requestKind: 'planner',
    estimatedMandatoryInputTokens: 600,
    businessOutputDemand: PLANNER_DEMAND,
    contextDemands: [
      ...sixBoardDemands(3), // 56K of demand vs ~24K hard input
    ],
  });
  const byId = new Map(plan.allocation.allocations.map(entry => [entry.id, entry]));
  assert.equal(byId.get('authority').allocated, byId.get('authority').demanded);
  assert.equal(byId.get('current').allocated, byId.get('current').demanded);
  assert.ok(plan.allocatedInputTokens <= plan.envelope.hardInputLimit);
});

// -------------------------------------------------------- B03 preferred gets
test('B03: preferred boards reach their target when budget is plentiful', () => {
  const plan = planLlmRequest({
    capabilities: glmLikeCapabilities(200_000, 32_768),
    requestKind: 'planner',
    estimatedMandatoryInputTokens: 800,
    businessOutputDemand: PLANNER_DEMAND,
    contextDemands: sixBoardDemands(1), // ~18.7K demand, huge window
  });
  const byId = new Map(plan.allocation.allocations.map(entry => [entry.id, entry]));
  assert.equal(byId.get('world').allocated, byId.get('world').demanded);
  assert.equal(byId.get('memory').allocated, byId.get('memory').demanded);
  assert.ok(byId.get('evidence').allocated > 0);
});

// ------------------------------------------------------- B04 optional shrink
test('B04: optional shrinks to its floor before preferred loses its target', () => {
  const result = allocateElasticContext([
    boardDemand({ id: 'authority', board: 'authority', estimatedTokens: 6_000 }),
    boardDemand({ id: 'memory', board: 'storyMemory', estimatedTokens: 3_000 }),
    boardDemand({ id: 'evidence', board: 'sourceEvidence', estimatedTokens: 5_000, minTokens: 500 }),
  ], 10_000);
  assert.equal(result.status, 'allocated');
  const byId = new Map(result.allocations.map(entry => [entry.id, entry]));
  assert.equal(byId.get('authority').allocated, 6_000);
  assert.equal(byId.get('memory').allocated, 3_000, 'preferred target survives');
  assert.equal(byId.get('evidence').allocated, 500, 'optional clipped to its floor');

  // Under extreme pressure an optional floor is deferred entirely (starved).
  const starved = allocateElasticContext([
    boardDemand({ id: 'authority', board: 'authority', estimatedTokens: 8_000 }),
    boardDemand({ id: 'evidence', board: 'sourceEvidence', estimatedTokens: 2_000, minTokens: 200 }),
  ], 10_000);
  const starvedEvidence = starved.allocations.find(entry => entry.id === 'evidence');
  assert.equal(starvedEvidence.allocated, 0);
  assert.ok(starvedEvidence.starved, 'soft-gated optional floor marked starved');
});

// ---------------------------------------------------------- B05 reclaim pool
test('B05: unused mandatory share flows into the elastic pool (no fixed caps)', () => {
  const result = allocateElasticContext([
    boardDemand({ id: 'authority', board: 'authority', estimatedTokens: 2_000 }),
    boardDemand({ id: 'world', board: 'worldKnowledge', estimatedTokens: 8_000 }),
    boardDemand({ id: 'evidence', board: 'sourceEvidence', estimatedTokens: 2_000 }),
  ], 10_000);
  const byId = new Map(result.allocations.map(entry => [entry.id, entry]));
  // authority only needed 2K of its 12% soft share; world reclaims it.
  assert.equal(byId.get('world').allocated, 7_500); // 6K soft + 1.5K burst borrow
  assert.equal(byId.get('evidence').allocated, 0);
  assert.equal(result.totalAllocated, 9_500); // mandatory + burst ceiling
});

// ---------------------------------------------------------- B06 burst borrow
test('B06: preferred borrows into the burst zone; optional never does', () => {
  const result = allocateElasticContext([
    boardDemand({ id: 'authority', board: 'authority', estimatedTokens: 2_000 }),
    boardDemand({ id: 'world', board: 'worldKnowledge', estimatedTokens: 8_000 }),
    boardDemand({ id: 'evidence', board: 'sourceEvidence', estimatedTokens: 2_000 }),
  ], 10_000);
  const world = result.allocations.find(entry => entry.id === 'world');
  assert.ok(world.phases.includes('burst'));
  assert.equal(result.totalAllocated, result.burstInputLimit);
  assert.ok(result.totalAllocated < result.hardInputLimit);
});

// ---------------------------------------------------------- B07 hard overflow
test('B07: total demand beyond hard never exceeds the hard limit', () => {
  const result = allocateElasticContext([
    boardDemand({ id: 'authority', board: 'authority', estimatedTokens: 9_000 }),
    boardDemand({ id: 'world', board: 'worldKnowledge', estimatedTokens: 5_000 }),
  ], 10_000);
  assert.equal(result.status, 'allocated');
  assert.ok(result.totalAllocated <= result.hardInputLimit);
  const world = result.allocations.find(entry => entry.id === 'world');
  assert.equal(world.allocated, 500); // burst-zone remainder

  const infeasible = allocateElasticContext([
    boardDemand({ id: 'authority', board: 'authority', estimatedTokens: 11_000 }),
  ], 10_000);
  assert.equal(infeasible.status, 'infeasible');
  assert.equal(infeasible.infeasibleReason, 'mandatory_exceeds_hard');
});

// --------------------------------------------------------- B08 deterministic
test('B08: identical inputs produce byte-identical allocations', () => {
  const demands = sixBoardDemands(1.5);
  const a = allocateElasticContext(demands, 40_000);
  const b = allocateElasticContext([...demands].reverse(), 40_000);
  assert.equal(JSON.stringify(a), JSON.stringify(b));

  const planA = planLlmRequest({
    capabilities: glmLikeCapabilities(),
    requestKind: 'planner',
    estimatedMandatoryInputTokens: 700,
    businessOutputDemand: PLANNER_DEMAND,
    contextDemands: [...demands].reverse(),
  });
  const planB = planLlmRequest({
    capabilities: glmLikeCapabilities(),
    requestKind: 'planner',
    estimatedMandatoryInputTokens: 700,
    businessOutputDemand: PLANNER_DEMAND,
    contextDemands: demands,
  });
  assert.equal(JSON.stringify(planA), JSON.stringify(planB));
  assert.equal(planA.contextPlanId, planB.contextPlanId);
});

// ------------------------------------------------------- B09 reasoning split
test('B09: reasoning reserve is subtracted exactly once per dialect', () => {
  const common = {
    requestKind: 'planner',
    estimatedMandatoryInputTokens: 500,
    businessOutputDemand: PLANNER_DEMAND,
    capabilities: glmLikeCapabilities(128_000, 32_768),
  };
  const inside = planLlmRequest({ ...common, reasoningBudget: 'inside_completion' });
  const separate = planLlmRequest({ ...common, reasoningBudget: 'separate' });

  // inside_completion: wire output carries O+R and the input side loses it once
  assert.equal(inside.envelope.wireOutputTokens, inside.requestedOutputTokens + 2_048);
  assert.equal(
    inside.envelope.hardInputLimit,
    128_000 - inside.envelope.wireOutputTokens - inside.envelope.safetyMarginTokens,
  );
  // separate: reasoning never touches the input window
  assert.equal(separate.envelope.wireOutputTokens, separate.requestedOutputTokens);
  assert.equal(
    separate.envelope.hardInputLimit,
    128_000 - separate.requestedOutputTokens - separate.envelope.safetyMarginTokens,
  );
  assert.ok(inside.envelope.hardInputLimit < separate.envelope.hardInputLimit);
});

// ------------------------------------------------------- B10 provider wire
test('B10: provider wire ceiling caps the grant and blocks infeasible minimums', () => {
  const common = {
    requestKind: 'planner',
    estimatedMandatoryInputTokens: 500,
    businessOutputDemand: PLANNER_DEMAND,
    capabilities: glmLikeCapabilities(128_000, 32_768),
    reasoningBudget: 'inside_completion',
  };
  // Wire 3,000: grant degrades to fit wire minus reserve but stays above the
  // business minimum + reserve.
  const tight = planLlmRequest({ ...common, providerWireMaxOutputTokens: 3_000 });
  assert.equal(tight.envelope.wireOutputTokens, 3_000);
  assert.ok(tight.requestedOutputTokens >= PLANNER_DEMAND.minimum);

  // Wire 2,500 cannot host minimum 900 + reserve 2,048 -> fail closed.
  assert.throws(
    () => planLlmRequest({ ...common, providerWireMaxOutputTokens: 2_500 }),
    error => error instanceof BudgetInfeasibleError && error.code === 'output_demand_infeasible',
  );
});

// -------------------------------------------------------------- B11 tiny task
test('B11: tiny task on a small window still plans (32K playable)', () => {
  const plan = planLlmRequest({
    capabilities: resolveModelCapabilities({
      declared: { contextWindowTokens: 32_000, maxOutputTokens: 4_096 },
      reasoningMode: 'none',
    }),
    requestKind: 'planner',
    estimatedMandatoryInputTokens: 900,
    businessOutputDemand: PLANNER_DEMAND,
    contextDemands: sixBoardDemands(0.2),
  });
  assert.ok(plan.envelope.hardInputLimit > 0);
  assert.ok(plan.allocatedInputTokens <= plan.envelope.hardInputLimit);
  assert.equal(plan.requestedOutputTokens, 4_000);
});

// ------------------------------------------------------------ B12 huge window
test('B12: 1M window absorbs demand but never pads beyond it', () => {
  const demands = sixBoardDemands(1);
  const totalDemand = demands.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const plan = planLlmRequest({
    capabilities: glmLikeCapabilities(1_048_576, 131_072),
    requestKind: 'planner',
    estimatedMandatoryInputTokens: 800,
    businessOutputDemand: PLANNER_DEMAND,
    contextDemands: demands,
  });
  assert.ok(plan.allocation.totalAllocated <= totalDemand);
  assert.ok(plan.allocation.totalAllocated <= plan.allocation.softInputLimit);
  assert.ok(plan.envelope.softInputLimit < plan.envelope.burstInputLimit);
  assert.ok(plan.envelope.burstInputLimit < plan.envelope.hardInputLimit);
});

// ----------------------------------------------------------- window matrix
for (const window of WINDOWS) {
  test(`matrix: ${window / 1000}K window invariants hold under pressure`, () => {
    const plan = planLlmRequest({
      capabilities: glmLikeCapabilities(window, Math.min(32_768, Math.floor(window / 4))),
      requestKind: 'planner',
      estimatedMandatoryInputTokens: 800,
      businessOutputDemand: PLANNER_DEMAND,
      contextDemands: sixBoardDemands(6), // deliberate oversubscription
    });
    const byId = new Map(plan.allocation.allocations.map(entry => [entry.id, entry]));
    assert.equal(byId.get('authority').allocated, byId.get('authority').demanded,
      'authority mandatory whole');
    assert.equal(byId.get('current').allocated, byId.get('current').demanded,
      'currentState mandatory whole');
    const evidence = byId.get('evidence');
    assert.ok(evidence.allocated <= plan.allocation.burstInputLimit, 'optional within burst');
    assert.ok(plan.allocatedInputTokens <= plan.envelope.hardInputLimit, 'never over hard');
    const rerun = planLlmRequest({
      capabilities: glmLikeCapabilities(window, Math.min(32_768, Math.floor(window / 4))),
      requestKind: 'planner',
      estimatedMandatoryInputTokens: 800,
      businessOutputDemand: PLANNER_DEMAND,
      contextDemands: sixBoardDemands(6),
    });
    assert.equal(rerun.contextPlanId, plan.contextPlanId, 'deterministic plan id');
  });
}

// -------------------------------------------------- capability source rules
test('capability resolution: declared > documented > probed > unknown', () => {
  const declared = resolveModelCapabilities({
    declared: { contextWindowTokens: 1_048_576, maxOutputTokens: 131_072, supportsJsonMode: true },
    documented: { contextWindowTokens: 131_072, supportsJsonMode: false },
    probed: { contextWindowTokens: 32_000, reportsUsage: true },
  });
  assert.equal(declared.contextWindowTokens, 1_048_576);
  assert.equal(declared.contextWindowSource, 'user_declared');
  assert.equal(declared.maxOutputTokens, 131_072);
  assert.equal(declared.maxOutputSource, 'user_declared');
  assert.equal(declared.supportsJsonMode, true, 'declared boolean wins');
  assert.equal(declared.reportsUsage, true, 'probe fills undeclared booleans');

  const documented = resolveModelCapabilities({
    documented: { contextWindowTokens: 131_072 },
  });
  assert.equal(documented.contextWindowSource, 'provider_documented');

  const probed = resolveModelCapabilities({ probed: { maxOutputTokens: 8_192 } });
  assert.equal(probed.maxOutputSource, 'provider_probe');
  assert.equal(probed.contextWindowTokens, null);
  assert.equal(probed.contextWindowSource, 'unknown');
});

test('derived max output is clamped, marked derived, and never backfills the profile', () => {
  assert.equal(deriveMaxOutputTokens(4_096), 1_024);
  assert.equal(deriveMaxOutputTokens(32_000), 8_000);
  assert.equal(deriveMaxOutputTokens(1_048_576), 16_384);

  const caps = resolveModelCapabilities({
    declared: { contextWindowTokens: 128_000 }, // no max output declared
    reasoningMode: 'none',
  });
  assert.equal(caps.maxOutputTokens, null);
  const plan = planLlmRequest({
    capabilities: caps,
    requestKind: 'planner',
    estimatedMandatoryInputTokens: 500,
    businessOutputDemand: PLANNER_DEMAND,
  });
  assert.equal(plan.trace.derivedMaxOutputTokens, 16_384);
  assert.equal(plan.requestedOutputTokens, PLANNER_DEMAND.maximum); // demand < derived ceiling
  // The capability object itself stays unknown-source; nothing was written back.
  assert.equal(caps.maxOutputTokens, null);
});

// ------------------------------------------------------------ envelope math
test('safety margin derivation: floors for small windows, caps for large', () => {
  assert.equal(deriveSafetyMargin(32_000), 1_024);
  assert.equal(deriveSafetyMargin(64_000), 1_024);
  assert.equal(deriveSafetyMargin(128_000), 1_920);
  assert.equal(deriveSafetyMargin(200_000), 2_000);
  assert.equal(deriveSafetyMargin(1_048_576), 8_192);
});

test('envelope soft/burst ratios follow 80%/95% of hard input', () => {
  const envelope = computeRequestEnvelope({
    contextWindowTokens: 100_000,
    outputReservationTokens: 4_000,
    reasoningReserveTokens: 2_000,
    reasoningBudget: 'inside_completion',
    safetyMarginTokens: 1_000,
  });
  assert.equal(envelope.wireOutputTokens, 6_000);
  assert.equal(envelope.hardInputLimit, 93_000);
  assert.equal(envelope.softInputLimit, 74_400);
  assert.equal(envelope.burstInputLimit, 88_350);
});

// ----------------------------------------------------------------- M1.1 probe
test('M1.1: probeCapabilities reports the context window as unknown, not 128K', async () => {
  const transport = {
    async post() {
      return {
        status: 200,
        body: JSON.stringify({
          id: 'probe-1',
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      };
    },
  };
  const outcome = await probeCapabilities({
    transport,
    endpoint: 'https://example.test/v1',
    model: 'glm-test',
    apiKey: 'probe-key',
    declaredMaxOutputTokens: 8_192,
  });
  assert.equal(outcome.capabilities.contextWindow, undefined);
  assert.deepEqual(outcome.probes.contextWindow, { tokens: null, source: 'unknown' });
  assert.equal(outcome.capabilities.maxOutputTokens, 8_192);
});

// ---------------------------------------------------------------- fingerprint
test('stable fingerprint is deterministic and order-insensitive for objects', () => {
  assert.equal(
    stableFingerprint({ a: 1, b: [2, 3] }),
    stableFingerprint({ b: [2, 3], a: 1 }),
  );
  assert.notEqual(stableFingerprint({ a: 1 }), stableFingerprint({ a: 2 }));
});

// --------------------------------------------------------- policy shape sanity
test('board policies cover all six boards with sensible defaults', () => {
  assert.equal(DEFAULT_BOARD_POLICIES.length, 6);
  const share = DEFAULT_BOARD_POLICIES.reduce((sum, item) => sum + item.softShare, 0);
  assert.ok(Math.abs(share - 1) < 1e-9);
});
