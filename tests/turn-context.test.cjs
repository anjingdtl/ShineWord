const test = require('node:test');
const assert = require('node:assert/strict');

const { planTurnContext, LEGACY_PLANNER_OUTPUT_TOKENS } = require('../dist/application/context/contextPlanner');
const { renderFrozenContext } = require('../dist/application/context/contextRenderer');
const { buildCandidate, candidatesFromParts } = require('../dist/application/context/candidateCollector');
const { resolveModelCapabilities } = require('../dist/application/llm/capabilityResolver');
const { DEFAULT_OUTPUT_DEMANDS } = require('../dist/application/llm/requestBudgetKernel');

function capabilitiesFor(window, maxOutput = 32_768) {
  return resolveModelCapabilities({
    declared: { contextWindowTokens: window, maxOutputTokens: maxOutput },
    reasoningMode: 'always_on',
  });
}

/** Oversubscribed candidate set across all six boards (~30K tokens). */
function heavyCandidates(query) {
  const parts = [
    ...Array.from({ length: 8 }, (_, i) =>
      `【世界】地域志${i}: ${'山川形胜与门派源流。'.repeat(240)}`),
    '【世界规则】宵禁: 入夜后庭院巡视频率翻倍。',
    '【可见人物】guard-1(守卫甲) 位于当前位置。',
    '【角色】actor-shen(沈青) 位于 courtyard，hp:8/8 stamina:6/6',
    '【主目标】进入藏书阁取回手稿',
    '【相关长期记忆】mem-1: 沈青与守卫统领有旧怨。',
    '【角色已知线索】clue-rain 雨夜换岗: 换岗间隙约半炷香。',
    '【最近的经历】\nturn-0007: 雨势渐大\nturn-0008: 守卫换岗',
    '使用队伍中存在的 actorId。只提出提案允许的动作（skill_check/ability/observe/talk/interact/move）；检定与数值由本地规则引擎编译。',
  ];
  const candidates = candidatesFromParts(parts, query);
  candidates.push(buildCandidate({
    id: 'story-memory-v2',
    board: 'storyMemory',
    heading: '长期故事状态',
    text: '沈青目标：取回手稿。与守卫统领关系：旧怨未解，承诺不伤人性命。',
  }, query));
  candidates.push(buildCandidate({
    id: 'source-evidence',
    board: 'sourceEvidence',
    heading: '原著证据',
    text: 'chapter-3 [1200,1350): 雨夜山门的描写……'.repeat(300),
    requirement: 'optional',
    clipMode: 'text',
  }, query));
  return candidates.filter(Boolean);
}

function planFor(window, kind = 'planner', candidates = heavyCandidates('雨夜 潜行 藏书阁')) {
  return planTurnContext({
    requestKind: kind,
    branchId: 'b1',
    stateVersion: 9,
    candidates,
    capabilities: capabilitiesFor(window),
    businessOutputDemand: kind === 'planner' ? DEFAULT_OUTPUT_DEMANDS.planner : DEFAULT_OUTPUT_DEMANDS.narrator,
    estimatedMandatoryInputTokens: 320,
    reasoningBudget: 'inside_completion',
    reasoningReserveTokens: 2_048,
  });
}

test('32K model stays playable: mandatory boards survive, optional material clipped', () => {
  const { context } = planFor(32_000);
  const boards = new Set(context.included.map(item => item.board));
  assert.ok(boards.has('authority'), 'protocol line survives');
  assert.ok(boards.has('currentState'), 'current state survives');
  const evidence = context.included.find(item => item.board === 'sourceEvidence');
  assert.ok(!evidence || evidence.clipped, 'oversubscription clips/drops optional evidence');
  const total = context.included.reduce((sum, item) => sum + item.allocatedTokens, 0);
  assert.ok(total < 24_000);
});

test('128K window includes strictly more material than 32K', () => {
  const small = planFor(32_000);
  const large = planFor(128_000);
  assert.ok(large.context.estimatedTokens > small.context.estimatedTokens);
  const evidenceSmall = small.context.included.find(item => item.board === 'sourceEvidence');
  const evidenceLarge = large.context.included.find(item => item.board === 'sourceEvidence');
  assert.ok(evidenceLarge && !evidenceLarge.clipped, '128K carries the evidence whole');
  assert.ok(!evidenceSmall || evidenceSmall.clipped, '32K had to clip it');
});

test('1M window never pads: allocation stays bounded by demand', () => {
  const huge = planFor(1_048_576);
  const demand = heavyCandidates('雨夜 潜行 藏书阁')
    .reduce((sum, candidate) => sum + candidate.estimatedTokens, 0);
  assert.ok(huge.context.estimatedTokens <= demand + 1, 'no artificial filling');
  assert.ok(huge.context.estimatedTokens > 0);
});

test('mandatory candidates are never dropped under pressure', () => {
  const { context } = planFor(32_000);
  for (const id of context.included.map(item => item.id)) {
    const candidate = heavyCandidates('x').find(item => item.id === id);
    void candidate;
  }
  const mandatoryIds = heavyCandidates('雨夜')
    .filter(candidate => candidate.requirement === 'mandatory')
    .map(candidate => candidate.id);
  for (const id of mandatoryIds) {
    assert.ok(context.includedCandidateIds.includes(id), `mandatory ${id} must survive`);
  }
});

test('deterministic: same input -> identical contextId and rendering', () => {
  const a = planFor(128_000);
  const b = planFor(128_000);
  assert.equal(a.context.contextId, b.context.contextId);
  assert.equal(renderFrozenContext(a.context), renderFrozenContext(b.context));
});

test('different windows produce clearly different plans', () => {
  const a = planFor(32_000);
  const b = planFor(200_000);
  assert.notEqual(a.context.contextId, b.context.contextId);
  assert.notEqual(a.context.estimatedTokens, b.context.estimatedTokens);
});

test('frozen context records tier/reserve and distinguishes Low from Max plans', () => {
  const common = {
    requestKind: 'planner',
    branchId: 'b1',
    stateVersion: 17,
    candidates: heavyCandidates('雨夜 潜行 藏书阁'),
    capabilities: capabilitiesFor(128_000, 131_072),
    businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
    estimatedMandatoryInputTokens: 320,
  };
  const low = planTurnContext({
    ...common,
    reasoningPolicy: { tier: 'low', providerDialect: 'glm', model: 'glm-5.3-flash' },
  });
  const max = planTurnContext({
    ...common,
    reasoningPolicy: { tier: 'max', providerDialect: 'glm', model: 'glm-5.3-flash' },
  });
  assert.equal(low.context.reasoning.tier, 'low');
  assert.equal(max.context.reasoning.tier, 'max');
  assert.equal(low.context.reasoning.reserveTokens, 2_048);
  assert.equal(max.context.reasoning.reserveTokens, 24_576);
  assert.equal(low.context.reasoning.policyVersion, max.context.reasoning.policyVersion);
  assert.notEqual(low.context.contextId, max.context.contextId);
  assert.notEqual(low.context.budgetPlanFingerprint, max.context.budgetPlanFingerprint);
  assert.ok(low.envelope.hard > max.envelope.hard);
  assert.equal(max.wireOutputTokens, max.requestedOutputTokens + max.context.reasoning.reserveTokens);
});

test('Max reserve shrinks optional context while preserving the mandatory protocol floor', () => {
  const candidate = {
    id: 'large-optional-evidence',
    board: 'sourceEvidence',
    requirement: 'optional',
    priority: 10,
    relevance: 0.5,
    estimatedTokens: 80_000,
    minTokens: 0,
    targetTokens: 80_000,
    clipMode: 'text',
    heading: '原著证据',
    text: '雨夜门前的证据。'.repeat(8_000),
    provenance: { sourceType: 'fixture', sourceId: 'pressure' },
  };
  const common = {
    requestKind: 'planner',
    branchId: 'b1',
    stateVersion: 18,
    candidates: [candidate],
    capabilities: capabilitiesFor(32_000, 131_072),
    businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
    estimatedMandatoryInputTokens: 500,
  };
  const low = planTurnContext({
    ...common,
    reasoningPolicy: { tier: 'low', providerDialect: 'glm', model: 'glm-5.3-flash' },
  });
  const max = planTurnContext({
    ...common,
    reasoningPolicy: { tier: 'max', providerDialect: 'glm', model: 'glm-5.3-flash' },
  });
  const lowAllocated = low.context.included.find(item => item.id === candidate.id)?.allocatedTokens ?? 0;
  const maxAllocated = max.context.included.find(item => item.id === candidate.id)?.allocatedTokens ?? 0;
  assert.ok(lowAllocated > maxAllocated, `Low allocated ${lowAllocated}, Max allocated ${maxAllocated}`);
  assert.ok(max.context.estimatedTokens >= 0);
  assert.equal(max.context.includedCandidateIds.includes(candidate.id), maxAllocated > 0);
  assert.ok(max.envelope.hard >= common.estimatedMandatoryInputTokens);
});

test('planner and narrator contexts differ (narrator never sees worldKnowledge)', () => {
  const planner = planFor(128_000, 'planner');
  const narratorCandidates = heavyCandidates('雨夜 潜行')
    .filter(candidate => candidate.board === 'currentState' || candidate.board === 'storyMemory')
    .map(candidate => ({ ...candidate, id: `narrator-${candidate.id}` }));
  const narrator = planFor(128_000, 'narrator', narratorCandidates);
  assert.ok(narrator.context.included.length < planner.context.included.length);
  assert.equal(narrator.context.included.some(item => item.board === 'worldKnowledge'), false);
  assert.equal(narrator.context.included.some(item => item.board === 'sourceEvidence'), false);
  assert.ok(narrator.requestedOutputTokens >= DEFAULT_OUTPUT_DEMANDS.narrator.minimum);
});

test('whole-item candidates drop instead of clipping in half', () => {
  const { context } = planFor(32_000);
  for (const item of context.included) {
    // Included whole items either fit or are text-clippable boards.
    if (item.clipped) {
      const candidate = heavyCandidates('雨夜').find(entry => entry.id === item.id);
      if (candidate && candidate.clipMode === 'whole_item') {
        assert.fail('whole_item candidate was clipped instead of dropped');
      }
    }
  }
  assert.ok(true);
});

test('unknown capabilities fall back to the legacy path, explicitly flagged', () => {
  const unknown = resolveModelCapabilities({ reasoningMode: 'unknown' });
  const result = planTurnContext({
    requestKind: 'planner',
    branchId: 'b1',
    stateVersion: 1,
    candidates: heavyCandidates('x'),
    capabilities: unknown,
    businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
    estimatedMandatoryInputTokens: 320,
  });
  assert.equal(result.context.legacyFallback, true);
  assert.ok(result.context.fallbackReason?.includes('context_window_unknown'));
  assert.equal(result.requestedOutputTokens, LEGACY_PLANNER_OUTPUT_TOKENS);
  assert.equal(result.envelope, null);
  // Nothing is dropped on the legacy path - same shape as the old builder.
  assert.equal(result.context.droppedCandidateIds.length, 0);
});

test('unknown context fallback freezes tier but keeps reserve explicitly unknown', () => {
  const unknown = resolveModelCapabilities({ reasoningMode: 'unknown' });
  const result = planTurnContext({
    requestKind: 'planner',
    branchId: 'b1',
    stateVersion: 2,
    candidates: heavyCandidates('x'),
    capabilities: unknown,
    businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
    estimatedMandatoryInputTokens: 320,
    reasoningPolicy: { tier: 'max', providerDialect: 'generic', model: 'custom-unknown' },
  });
  assert.equal(result.context.legacyFallback, true);
  assert.deepEqual(result.context.reasoning, {
    tier: 'max',
    effectiveTier: 'max',
    reserveTokens: null,
    policyVersion: 'reasoning-policy-1',
  });
});

test('renderer emits readable sections in board order', () => {
  const { context } = planFor(128_000);
  const rendered = renderFrozenContext(context);
  const currentIdx = rendered.indexOf('【当前局面】');
  const memoryIdx = rendered.indexOf('【长期故事状态】');
  assert.ok(currentIdx > -1 || rendered.includes('【行动协议】'));
  if (currentIdx > -1 && memoryIdx > -1) {
    assert.ok(currentIdx < memoryIdx, 'board order is authority->current->world->memory->recent->evidence');
  }
});
