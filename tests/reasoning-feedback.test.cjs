const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/phase9CampaignFixture.cjs');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const { LedgeredProvider } = require('../dist/application/llm/requestLedger');
const { RateScheduledProvider } = require('../dist/application/llm/scheduledProvider');
const { GlobalRateScheduler } = require('../dist/application/worldBuild/rateScheduler');
const { freezeReasoningUsageFeedback, recoverReasoningPolicy } = require('../dist/application/llm/reasoningFeedback');
const { resolveReasoningPolicy } = require('../dist/application/llm/reasoningPolicy');
const { SqliteStoryMemoryStore } = require('../dist/application/memory/storyMemoryRepository');
const selection = { tier: 'high', providerDialect: 'glm', model: 'glm-test' };
const scope = { modelProfileFingerprint: 'same-profile', reasoningTier: 'high', requestKind: 'campaign_plan' };
async function seed(store, id, tokens, patch = {}, input = {}) {
  const attempt = await store.beginAttempt({ logicalRequestId: id, ...scope, ...input }, Number(id.replace(/\D/g, '')) || 1);
  await store.updateAttempt(attempt.attemptId, { status: 'succeeded', reasoningTokens: tokens, estimatedUsage: 0, ...patch });
}
const policy = input => resolveReasoningPolicy({ ...selection, requestKind: 'campaign_plan', modelMaxOutputTokens: 65536,
  contextWindowTokens: 1048576, ...input });

test('reasoning feedback excludes unknown, estimated, malformed and foreign-scope measurements before applying the window', async () => {
  const h = await fixture();
  try {
    const store = new SqliteLlmLedgerStore(h.adapter);
    await seed(store, 'f1', 7000);
    await seed(store, 'f2', 24000, { status: 'failed', failureClass: 'reasoning_only' });
    await seed(store, 'f3', 25000, { status: 'failed', failureClass: 'length' });
    await seed(store, 'f4', 65000, { status: 'outcome_unknown' });
    await seed(store, 'f5', 65000, { estimatedUsage: 1 });
    await seed(store, 'f6', -1);
    await seed(store, 'f7', 1.5);
    await seed(store, 'f8', 65000, {}, { reasoningTier: 'max' });
    await seed(store, 'f9', 65000, {}, { modelProfileFingerprint: 'other-endpoint-model' });
    await seed(store, 'f10', 65000, {}, { requestKind: 'narrator' });
    await seed(store, 'f11', 65000, { status: 'failed', failureClass: 'content_filter' });
    assert.deepEqual(await store.listRecentReasoningUsage({ ...scope, limit: 2 }), [
      { reasoningTokens: 25000, completion: 'exhausted' }, { reasoningTokens: 24000, completion: 'exhausted' },
    ]);
    assert.deepEqual(await store.listRecentReasoningUsage({ ...scope, limit: 32 }), [
      { reasoningTokens: 25000, completion: 'exhausted' }, { reasoningTokens: 24000, completion: 'exhausted' },
      { reasoningTokens: 7000, completion: 'complete' },
    ]);
    await assert.rejects(() => store.listRecentReasoningUsage({ ...scope, limit: 0 }), /limit/);
  } finally { h.db.close(); }
});

test('scheduled provider forwards local feedback with the exact ledger identity and no HTTP dispatch', async () => {
  const h = await fixture(); let sends = 0;
  try {
    const store = new SqliteLlmLedgerStore(h.adapter);
    await seed(store, 'f1', 32422, { status: 'failed', failureClass: 'length' });
    const provider = new RateScheduledProvider(new LedgeredProvider({ async complete() { sends++; } }, store,
      { modelProfileFingerprint: 'same-profile' }), new GlobalRateScheduler({ maxConcurrent: 1, endpointBucketId: 'local' }));
    const frozen = await freezeReasoningUsageFeedback(provider, 'campaign_plan', selection);
    assert.deepEqual(frozen.usageFeedback, { completed: [], exhausted: [32422] });
    const resolved = policy(frozen);
    assert.equal(resolved.reserveTokens, 48633); assert.equal(resolved.reserveSource, 'usage_floor');
    assert.equal(resolved.p95ReasoningTokens, undefined); assert.equal(sends, 0);
    assert.equal(await freezeReasoningUsageFeedback(provider, 'narrator', selection), selection);
  } finally { h.db.close(); }
});

test('censored usage cannot make seven completed samples into calibrated P95, while early complete evidence sets a floor', () => {
  const result = policy({ usageFeedback: { completed: Array(7).fill(10000), exhausted: [32422] } });
  assert.equal(result.reserveSource, 'usage_floor'); assert.equal(result.reserveTokens, 48633);
  assert.equal(result.p95ReasoningTokens, 10000);
  assert.equal(policy({ usageFeedback: { completed: [30000], exhausted: [] } }).reserveTokens, 37500);
  const calibrated = policy({ usageFeedback: { completed: Array(8).fill(24000), exhausted: [] } });
  assert.equal(calibrated.reserveSource, 'usage_calibrated'); assert.equal(calibrated.reserveTokens, 30000);
});

test('a proven lower bound beyond the model capacity fails before dispatch instead of clamping below known usage', () => {
  assert.throws(() => policy({ modelMaxOutputTokens: 32768, usageFeedback: { completed: [], exhausted: [32422] } }), /observed reasoning usage/);
  assert.throws(() => policy({ usageFeedback: { completed: [], exhausted: [0] } }), /feedback is invalid/);
  assert.throws(() => policy({ reserveTokensOverride: 12288, usageFeedback: { completed: [], exhausted: [24521] } }), /below observed usage/);
});

test('one exhausted response uses its measured lower bound with 50 percent recovery headroom, preserving the tier', () => {
  const recovered = recoverReasoningPolicy(selection, 12288, 24521);
  const result = policy(recovered);
  assert.equal(result.reserveTokens, 36782); assert.equal(result.tier, 'high');
  assert.equal(policy(recoverReasoningPolicy(selection, 12288)).reserveTokens, 18432);
});

test('memory material restore retains its feedback and never invokes a fresh history reader', async () => {
  const h = await fixture(); let reads = 0;
  try {
    const store = new SqliteStoryMemoryStore(h.adapter);
    const input = { batchId: 'feedback-batch', branchId: 'c-main', from: 1, to: 2, baseFingerprint: 'seed', payload: { reasoningPolicy: selection } };
    const first = await store.freezeBatchRequest({ ...input, preparePayload: async p => {
      reads++; return { ...p, reasoningPolicy: { ...selection, usageFeedback: { completed: [20000], exhausted: [] } } };
    } });
    const second = await store.freezeBatchRequest({ ...input, preparePayload: async () => { throw Error('live feedback consulted on restore'); } });
    assert.deepEqual(second, first); assert.equal(reads, 1);
    await assert.rejects(() => store.freezeBatchRequest({ ...input, baseFingerprint: 'changed' }), /integrity\/base/);
  } finally { h.db.close(); }
});

test('a production player turn freezes separate Planner and Narrator usage from the same shared ledger', async () => {
  const h = await fixture(); const requests = [];
  try {
    const { CampaignSession } = require('../dist/application/campaign/session');
    const { SqliteGameStore } = require('../dist/infra/sqlite/sqliteGameStore');
    const { SqliteNarrativeStore } = require('../dist/infra/sqlite/sqliteNarrativeStore');
    const { sha } = require('./helpers/mobileHarness.cjs');
    const { llmModelProfileFingerprint } = require('../dist/application/llm/profileFingerprint');
    const profile = { id: 'play-budget', endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'low',
      capabilities: { contextWindow: 60000, maxOutputTokens: 12000, supportsJson: true } };
    const store = new SqliteLlmLedgerStore(h.adapter), fp = llmModelProfileFingerprint(profile);
    await seed(store, 'play1', 3000, {}, { modelProfileFingerprint: fp, reasoningTier: 'low', requestKind: 'planner' });
    await seed(store, 'play2', 2000, {}, { modelProfileFingerprint: fp, reasoningTier: 'low', requestKind: 'narrator' });
    const session = new CampaignSession({ db: h.adapter, turns: h.turns, game: new SqliteGameStore(h.adapter), worldStore: h.worlds,
      narratives: new SqliteNarrativeStore(h.adapter), hashProvider: sha, llmLedger: store, random: { nextIntInclusive: () => 6 } },
    { async complete(request) { requests.push(request); return h.session.provider.complete(request); } }, profile);
    const before = await h.turns.getState(h.branchId);
    await session.playTurn({ campaignId: h.campaignId, branchId: h.branchId, intent: '向林凡打听青石巷最近的情况' });
    assert.equal((await h.turns.getState(h.branchId)).stateVersion, before.stateVersion + 1);
    assert.equal(requests.find(r => r.role === 'Planner').reasoningReserveTokens, 3750);
    assert.equal(requests.find(r => r.role === 'Narrator').reasoningReserveTokens, 2500);
    assert.equal(requests.find(r => r.role === 'Planner').maxOutputTokens, 7750);
    assert.equal(requests.find(r => r.role === 'Narrator').maxOutputTokens, 10500);
  } finally { h.db.close(); }
});
