'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { governWorldBuildRequest } = require('../dist/application/worldBuild/llmRequest');
const { modelBudgetFromProfile } = require('../dist/application/worldBuild/profileModelBudget');
const { freezeRunConfig, reviveRunConfig } = require('../dist/application/worldBuild/runConfig');
const { LlmGroupExtractor } = require('../dist/application/world/llmGroupExtractor');

function makeProfile(reasoningTier) {
  return {
    id: 'fixture', name: 'Fixture', endpoint: 'https://example.invalid/v1', model: 'GLM-5.3-Flash',
    keyRef: 'llm.fixture', reasoningTier, reasoningDialect: 'glm',
    capabilities: {
      contextWindow: 1_048_576, maxOutputTokens: 131_072,
      supportsJson: true, supportsStreaming: false, reportsUsage: true,
      supportsPromptCache: true,
    },
  };
}

const governanceFor = profile => ({
  profile,
  runId: 'run-fixture',
  worldId: 'world-fixture',
  modelProfileFingerprint: 'profile-fixture-fingerprint',
});

test('World Build freezes tier, per-kind reserve, exact wire output and stable ledger identity', () => {
  const observed = [];
  for (const tier of ['low', 'high', 'max']) {
    const profile = makeProfile(tier);
    const budget = modelBudgetFromProfile(profile);
    const request = governWorldBuildRequest({
      request: {
        role: 'Extractor', system: 'Return JSON.', user: JSON.stringify({ text: 'required source text' }),
        maxOutputTokens: budget.maxContentOutputTokens, jsonMode: true,
      },
      requestKind: 'world_extract',
      logicalRequestId: 'world-extract:run-fixture:unit-0001:all',
      governance: governanceFor(profile),
    });
    observed.push(request);
    assert.equal(request.reasoningTier, tier);
    assert.equal(request.requestKind, 'world_extract');
    assert.equal(request.maxPhysicalRequests, 1);
    assert.equal(request.ledger.logicalRequestId, 'world-extract:run-fixture:unit-0001:all');
    assert.equal(request.reasoningReserveTokens, { low: 4_096, high: 16_384, max: 49_152 }[tier]);
    assert.equal(request.maxOutputTokens, Math.min(16_000, budget.maxContentOutputTokens) + request.reasoningReserveTokens);
  }
  assert.ok(observed[0].reasoningReserveTokens < observed[1].reasoningReserveTokens);
  assert.ok(observed[1].reasoningReserveTokens < observed[2].reasoningReserveTokens);

  const highProfile = makeProfile('high');
  const retry = governWorldBuildRequest({
    request: { role: 'Extractor', system: 'Return JSON.', user: 'required', maxOutputTokens: 16_384 },
    requestKind: 'world_extract',
    logicalRequestId: 'world-extract:run-fixture:unit-0001:all',
    governance: governanceFor(highProfile),
    reserveMultiplier: 1.5,
  });
  assert.equal(retry.reasoningTier, 'high');
  assert.equal(retry.reasoningReserveTokens, 24_576);
  assert.equal(retry.ledger.logicalRequestId, observed[1].ledger.logicalRequestId);
});

test('Frozen World Build policy migrates legacy off to low and preserves provider identity and capabilities', () => {
  const profile = makeProfile('low');
  const budget = modelBudgetFromProfile(profile);
  const frozen = freezeRunConfig(profile, budget);
  assert.equal(frozen.reasoningTier, 'low');
  assert.deepEqual(frozen.reasoningReservePolicy.reserves, {
    world_extract: 4_096,
    world_mapping: 4_096,
    world_adjudication: 2_048,
    timeline: 2_048,
    registry: 4_096,
  });
  const highFrozen = freezeRunConfig(makeProfile('high'), modelBudgetFromProfile(makeProfile('high')));
  assert.notDeepEqual(highFrozen.reasoningReservePolicy.reserves, frozen.reasoningReservePolicy.reserves);
  assert.equal(highFrozen.reasoningTier, 'high');

  const legacy = reviveRunConfig(JSON.stringify({
    configVersion: 'run-config-1', endpoint: 'https://old.example/v1', model: 'old-model', keyRef: 'llm.old',
    reasoningEffort: 'off', contentOutputTokens: 4_000, reasoningReserveTokens: 0,
    contextWindowTokens: 64_000, maxOutputTokens: 8_000,
    supportsPromptCache: false, supportsJson: true, concurrency: 2,
    profileId: 'old-profile', profileName: 'Old',
  }));
  assert.equal(legacy.reasoningTier, 'low');
  assert.equal(legacy.endpoint, 'https://old.example/v1');
  assert.equal(legacy.model, 'old-model');
  assert.equal(legacy.keyRef, 'llm.old');
  assert.equal(legacy.contextWindowTokens, 64_000);
  assert.equal(legacy.maxOutputTokens, 8_000);
});

test('World Extract structured parsing tolerates wrappers but still rejects false evidence quotes', async () => {
  const extractor = new LlmGroupExtractor(async () => ({
    text: 'Here is the result:\n```json\n' + JSON.stringify({
      facts: [{
        subject: 'person', predicate: 'owns', value: { item: 'ring' }, status: 'explicit',
        confidence: 1, segment: 1, quote: 'this line is not in the source',
      }],
    }) + '\n```',
  }));
  const result = await extractor.extract({
    unitId: 'unit', worldId: 'world-fixture',
    segments: [{ chunkId: 'chunk', chapterId: 'chapter', chapterTitle: 'Title', startCp: 0, text: 'source line' }],
  });
  assert.equal(result.facts.length, 0);
  assert.equal(result.rejectedQuotes, 1);
});
