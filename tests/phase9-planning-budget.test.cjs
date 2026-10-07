const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { runOpeningPlanJob } = require('../dist/application/campaignPlan/planningService');
const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');
const { OpenAICompatibleProvider } = require('../dist/application/llm/openAICompatible');
const { LedgeredProvider } = require('../dist/application/llm/requestLedger');
const { RateScheduledProvider } = require('../dist/application/llm/scheduledProvider');
const { GlobalRateScheduler, endpointBucketId } = require('../dist/application/worldBuild/rateScheduler');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const profile = { id: 'budget', name: 'Budget', endpoint: 'https://example.invalid/v1', model: 'glm-5.3-flash', keyRef: 'test', reasoningTier: 'high',
  capabilities: { contextWindow: 1048576, maxOutputTokens: 32768, supportsJson: true, supportsStreaming: false }, contentOutputTokens: 16384 };
async function setup(h, id, responses, onResponse = () => {}) {
  const base = await h.planStore.getSetup('setup-t'), intent = { ...base.intent, setupId: id };
  await h.planStore.upsertSetup({ ...base, setupId: id, intent, currentCandidateId: null, status: 'planning' });
  await h.planStore.insertJob({ ...await h.planStore.getJob('job-t'), jobId: id, setupId: id, status: 'queued',
    intentHash: sha256HexOf(canonicalJsonOf(intent)), leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, freezeRootId: null });
  const wires = [], store = new SqliteLlmLedgerStore(h.adapter);
  const inner = new OpenAICompatibleProvider(profile, { async get() { return 'test-only'; } }, { async post(request) {
    wires.push(JSON.parse(request.body)); const next = responses[wires.length - 1];
    if (!next) throw Error('Unexpected extra physical dispatch');
    onResponse(wires.length);
    if (next === 'timeout') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return { status: 200, body: JSON.stringify(next === 'thinking' ? {
      choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'only thinking' } }],
      usage: { prompt_tokens: 10, completion_tokens: wires.at(-1).max_tokens, completion_tokens_details: { reasoning_tokens: wires.at(-1).max_tokens } }
    } : { choices: [{ finish_reason: 'stop', message: { content: next } }] }) };
  } }, 300000);
  const provider = new RateScheduledProvider(new LedgeredProvider(inner, store, { modelProfileFingerprint: 'budget' }),
    new GlobalRateScheduler({ maxConcurrent: 1, endpointBucketId: endpointBucketId(profile.endpoint) }));
  const deps = { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, profile, provider, now: () => NOW };
  const run = () => runOpeningPlanJob(deps, id, { anchorTitle: '开篇', playerName: '旅人', protagonistSkills: ['skill-observation'] });
  return { wires, store, run };
}
test('planning budget: reasoning-only recovery re-enters the kernel and scheduler once under the shared two-HTTP limit', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'thought-recovery', ['thinking', JSON.stringify(candidateModel())]);
    const result = await q.run(); assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 2);
    assert.deepEqual(q.wires.map(w=>w.max_tokens), [24576,30720]);
    assert.ok(q.wires.every(w=>w.reasoning_effort==='high'));
    assert.equal((await q.store.listAttempts('campaign-plan:thought-recovery')).length,2);
    assert.equal((await q.run()).physicalRequests,0); assert.equal(q.wires.length,2);
  } finally { h.db.close(); }
});
test('planning budget: restart after a known thought-only response resumes the frozen root with one larger-budget HTTP', async () => {
  const h = await fixture();
  try {
    const renew = h.planStore.renewJobLease.bind(h.planStore);
    const q = await setup(h, 'thought-restart', ['thinking',JSON.stringify(candidateModel())], attempt => {
      if (attempt === 1) h.planStore.renewJobLease = async () => { throw Error('simulated interruption after the known response'); };
    });
    const stopped = await q.run(); assert.equal(stopped.status,'retryable_failed'); assert.equal(stopped.physicalRequests,1);
    const root = h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:thought-restart').payload_json;
    h.planStore.renewJobLease = renew;
    const restored = await q.run(); assert.equal(restored.status,'candidate_ready'); assert.equal(restored.physicalRequests,1);
    assert.deepEqual(q.wires.map(w=>w.max_tokens),[24576,30720]);
    assert.equal(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:thought-restart').payload_json,root);
    assert.equal((await q.store.listAttempts('campaign-plan:thought-restart')).length,2);
  } finally { h.db.close(); }
});
test('planning budget: a thought retry that returns an invalid candidate cannot obtain a third structural-repair HTTP', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'thought-invalid', ['thinking','{}',JSON.stringify(candidateModel())]);
    const result = await q.run(); assert.equal(result.status,'invalid'); assert.equal(result.physicalRequests,2);
    assert.equal(q.wires.length,2); assert.equal((await h.planStore.latestCandidateForJob('thought-invalid')).stage,'rejected');
  } finally { h.db.close(); }
});
test('planning budget: timeout after the known thought retry reports both HTTP attempts and recovery dispatches zero', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'thought-unknown', ['thinking','timeout',JSON.stringify(candidateModel())]);
    const result = await q.run(); assert.equal(result.status,'outcome_unknown'); assert.equal(result.physicalRequests,2);
    assert.equal((await q.run()).physicalRequests,0); assert.equal(q.wires.length,2);
    assert.deepEqual((await q.store.listAttempts('campaign-plan:thought-unknown')).map(a=>a.status),['failed','outcome_unknown']);
  } finally { h.db.close(); }
});
test('planning budget: structural repair and reasoning-only response share the same cap rather than nesting retries', async () => {
  const h = await fixture();
  try {
    const q = await setup(h,'repair-thought',['{}','thinking',JSON.stringify(candidateModel())]);
    const result = await q.run(); assert.equal(result.physicalRequests,2); assert.equal(result.status,'retryable_failed');
    assert.equal((await q.run()).status,'invalid'); assert.equal(q.wires.length,2);
  } finally { h.db.close(); }
});
