/**
 * P8-2 acceptance: elastic reclamation, zero-send budget failures, final
 * wire verification and the compact per-entity memory projection
 * (plan §10, gates A06/A07/A08 evidence at unit level).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { planTurnContext } = require('../dist/application/context/contextPlanner');
const { buildCandidate } = require('../dist/application/context/candidateCollector');
const { computeRequestEnvelope } = require('../dist/application/context/modelEnvelope');
const {
  estimateFinalWireInput,
  verifyFinalWireRequest,
} = require('../dist/application/llm/finalWireVerifier');
const { BudgetInfeasibleError } = require('../dist/application/llm/requestPlan');
const { resolveModelCapabilities } = require('../dist/application/llm/capabilityResolver');
const { DEFAULT_OUTPUT_DEMANDS } = require('../dist/application/llm/requestBudgetKernel');
const { compileMemoryMaterialCandidates } = require('../dist/application/memory/storyMemoryCompiler');

function capabilitiesFor(window, maxOutput = 8192) {
  return resolveModelCapabilities({
    declared: { contextWindowTokens: window, maxOutputTokens: maxOutput },
    reasoningMode: 'always_on',
  });
}

function candidate(id, board, text, requirement = 'preferred', clipMode = 'whole_item', priority) {
  return buildCandidate({ id, board, text, requirement, clipMode, priority }, 'query');
}

test('A06: a too-large first whole-item is skipped and later small items reclaim its share', () => {
  // Window 2000 tokens: mandatory ~120, preferred huge item 5000, small items 200 each.
  const candidates = [
    candidate('m-state', 'currentState', '当前局面'.repeat(30), 'mandatory'),
    candidate('huge-world', 'worldKnowledge', '世界设定条目。'.repeat(1000)),
    candidate('small-rel-1', 'worldKnowledge', '关系一：与守卫统领有旧怨。', 'preferred', 'whole_item', 80),
    candidate('small-rel-2', 'worldKnowledge', '关系二：与酒馆老板交好。', 'preferred', 'whole_item', 79),
  ];
  const result = planTurnContext({
    requestKind: 'planner',
    branchId: 'b',
    stateVersion: 1,
    candidates,
    capabilities: capabilitiesFor(8_000),
    businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
    estimatedMandatoryInputTokens: 120,
  });
  const droppedHuge = result.context.droppedEntries?.find(entry => entry.id === 'huge-world');
  assert.ok(droppedHuge, 'the oversized item was dropped');
  assert.equal(droppedHuge.reason, 'whole_item_too_large');
  const includedIds = result.context.included.map(item => item.id);
  assert.ok(includedIds.includes('small-rel-1'), 'small item 1 fits after reclamation');
  assert.ok(includedIds.includes('small-rel-2'), 'small item 2 fits after reclamation');
  for (const item of result.context.included) {
    const original = candidates.find(entry => entry.id === item.id);
    if (original && original.clipMode === 'whole_item') {
      assert.ok(!item.clipped, 'included whole items are never clipped');
    }
  }
});

test('A08: mandatory over the window fails with a typed error and no render', () => {
  assert.throws(
    () => planTurnContext({
      requestKind: 'planner',
      branchId: 'b',
      stateVersion: 1,
      candidates: [candidate('m-state', 'currentState', '局面'.repeat(4000), 'mandatory')],
      capabilities: capabilitiesFor(8_000),
      businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
      estimatedMandatoryInputTokens: 120,
    }),
    error => error instanceof BudgetInfeasibleError
      && ['mandatory_input_infeasible', 'mandatory_exceeds_hard'].includes(error.code),
  );
});

test('A07: low-demand boards leave room for high-demand items in the same pool', () => {
  const candidates = [
    candidate('m-state', 'currentState', '局面'.repeat(60), 'mandatory'),
    candidate('style', 'authority', '文风'.repeat(30), 'preferred', 'whole_item', 100),
    candidate('memory-1', 'storyMemory', '记忆'.repeat(80), 'preferred', 'whole_item', 90),
  ];
  const result = planTurnContext({
    requestKind: 'planner',
    branchId: 'b',
    stateVersion: 1,
    candidates,
    capabilities: capabilitiesFor(6_000),
    businessOutputDemand: DEFAULT_OUTPUT_DEMANDS.planner,
    estimatedMandatoryInputTokens: 150,
  });
  const ids = result.context.included.map(item => item.id);
  assert.ok(ids.includes('style') && ids.includes('memory-1'), 'both boards get served from one pool');
});

test('envelope infeasibility is a typed BudgetInfeasibleError', () => {
  assert.throws(
    () => computeRequestEnvelope({
      contextWindowTokens: 2_000,
      outputReservationTokens: 1_900,
      reasoningReserveTokens: 500,
      reasoningBudget: 'inside_completion',
    }),
    error => error instanceof BudgetInfeasibleError && error.code === 'envelope_infeasible',
  );
});

test('final wire verifier accepts a fitting request and rejects an overflowing one', () => {
  const budget = {
    contextWindowTokens: 2_000,
    hardInputLimit: 1_500,
    wireOutputTokens: 400,
    safetyMarginTokens: 64,
  };
  const check = verifyFinalWireRequest({
    messages: [
      { role: 'system', content: '系统指令'.repeat(10) },
      { role: 'user', content: '用户载荷'.repeat(100) },
    ],
    budget,
  });
  assert.equal(check.ok, true);
  assert.ok(check.estimatedInputTokens > 0);

  assert.throws(
    () => verifyFinalWireRequest({
      messages: [{ role: 'user', content: '超长载荷'.repeat(2_000) }],
      budget,
    }),
    error => error instanceof BudgetInfeasibleError && error.code === 'final_wire_exceeded',
  );
  const estimate = estimateFinalWireInput([{ role: 'user', content: '' }]);
  assert.equal(estimate, 0, 'empty message bodies contribute nothing');
});

function memoryStateFor(branchId) {
  return {
    schemaVersion: 3,
    branchId,
    throughStateVersion: 8,
    characters: {
      'actor-a': {
        actorId: 'actor-a',
        stableIdentitySummary: '守卫统领',
        currentNarrativeState: {
          emotionalState: '警惕',
          currentGoal: '抓住潜入者',
          concerns: ['粮仓火情'],
          promises: ['查明真相'],
          secretsKnownToPlayer: ['密道位置'],
        },
        importantExperiences: [],
        lastChangedStateVersion: 8,
      },
    },
    relationships: {
      'rel:actor-a->actor-b': {
        relationshipId: 'rel:actor-a->actor-b',
        fromActorId: 'actor-a',
        toActorId: 'actor-b',
        relationType: '旧识',
        currentNarrativeState: '表面客气',
        trustNarrative: '暗中提防',
        importantPromises: ['互不揭发'],
        unresolvedTensions: ['火药去向'],
        publicStatus: 'public',
        lastChangedStateVersion: 7,
      },
    },
    narrative: {
      currentArc: { title: '粮仓疑云', summary: '火起之后真相未明' },
      currentObjective: '查明起火原因',
      activeConflicts: [{ conflictId: 'c1', title: '对峙', description: '看守与潜入', stakes: '自由', status: 'open' }],
      openThreads: [{ threadId: 't1', title: '火油桶', description: '来历不明', status: 'open' }],
      foreshadowing: [],
      recentCompletedBeats: [{ turnId: 't8', stateVersion: 8, summary: '避开巡夜' }],
      recentResolvedThreads: [],
      archiveDigest: '',
    },
    metadata: { status: 'clean', dirtyFromStateVersion: null, fingerprint: 'fp-1', lastAppliedPatchId: 'p1', updatedAt: '2026-10-04T00:00:00.000Z' },
  };
}

test('compact memory projection: objective mandatory, entities compete per-item on the memory board', () => {
  const materials = compileMemoryMaterialCandidates(memoryStateFor('branch-a'), '守卫 粮仓');
  const byId = new Map(materials.map(material => [material.id, material]));
  assert.equal(byId.get('story-memory:objective').retention, 'mandatory');
  assert.ok(byId.has('story-memory:character:actor-a'), 'one material per character');
  assert.ok(byId.has('story-memory:relationship:rel:actor-a->actor-b'), 'one material per relationship');
  assert.ok(byId.has('story-memory:mainline'), 'conflicts/threads/beats form one mainline material');
  assert.equal(byId.get('story-memory:character:actor-a').boardOverride, 'storyMemory');
  assert.ok(byId.get('story-memory:character:actor-a').payload.text.includes('查明真相'));
  assert.ok(byId.get('story-memory:mainline').payload.text.includes('火油桶'));
});
