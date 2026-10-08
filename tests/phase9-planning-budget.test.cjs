const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { runOpeningPlanJob } = require('../dist/application/campaignPlan/planningService');
const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');
const { OpenAICompatibleProvider, HttpRequestTimeoutError } = require('../dist/application/llm/openAICompatible');
const { LedgeredProvider } = require('../dist/application/llm/requestLedger');
const { RateScheduledProvider } = require('../dist/application/llm/scheduledProvider');
const { GlobalRateScheduler, endpointBucketId } = require('../dist/application/worldBuild/rateScheduler');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');
const profile = { id: 'budget', name: 'Budget', endpoint: 'https://example.invalid/v1', model: 'glm-5.3-flash', keyRef: 'test', reasoningTier: 'high',
  capabilities: { contextWindow: 1048576, maxOutputTokens: 32768, supportsJson: true, supportsStreaming: false }, contentOutputTokens: 16384 };
const largeProfile = { ...profile, capabilities: { ...profile.capabilities, maxOutputTokens: 65536 } };
async function seedUsage(store, id, tokens, failureClass) {
  const attempt = await store.beginAttempt({ logicalRequestId: id, requestKind: 'campaign_plan', modelProfileFingerprint: 'budget', reasoningTier: 'high' }, 1);
  await store.updateAttempt(attempt.attemptId, { status: failureClass ? 'failed' : 'succeeded', failureClass: failureClass ?? null,
    reasoningTokens: tokens, estimatedUsage: 0 });
}
async function setup(h, id, responses, onResponse = () => {}, runProfile = profile) {
  const base = await h.planStore.getSetup('setup-t'), intent = { ...base.intent, setupId: id };
  await h.planStore.upsertSetup({ ...base, setupId: id, intent, currentCandidateId: null, status: 'planning' });
  await h.planStore.insertJob({ ...await h.planStore.getJob('job-t'), jobId: id, setupId: id, status: 'queued',
    intentHash: sha256HexOf(canonicalJsonOf(intent)), leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, freezeRootId: null });
  const wires = [], store = new SqliteLlmLedgerStore(h.adapter);
  const inner = new OpenAICompatibleProvider(runProfile, { async get() { return 'test-only'; } }, { async post(request) {
    wires.push(JSON.parse(request.body)); const next = responses[wires.length - 1];
    if (!next) throw Error('Unexpected extra physical dispatch');
    onResponse(wires.length);
    if (next === 'timeout') throw new HttpRequestTimeoutError(request.timeoutMs);
    return { status: 200, body: JSON.stringify(next === 'thinking' ? {
      choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'only thinking' } }],
      usage: { prompt_tokens: 10, completion_tokens: wires.at(-1).max_tokens, completion_tokens_details: { reasoning_tokens: wires.at(-1).max_tokens } }
    } : typeof next === 'object' ? next : { choices: [{ finish_reason: 'stop', message: { content: next } }] }) };
  } }, 300000);
  const provider = new RateScheduledProvider(new LedgeredProvider(inner, store, { modelProfileFingerprint: 'budget' }),
    new GlobalRateScheduler({ maxConcurrent: 1, endpointBucketId: endpointBucketId(runProfile.endpoint) }));
  const deps = { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, profile: runProfile, provider, now: () => NOW };
  const run = () => runOpeningPlanJob(deps, id, { anchorTitle: '开篇', playerName: '旅人', protagonistSkills: ['skill-observation'] });
  return { wires, store, run, deps };
}
test('planning budget: reasoning-only recovery re-enters the kernel and scheduler once under the shared two-HTTP limit', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'thought-recovery', ['thinking', JSON.stringify(candidateModel())]);
    const result = await q.run(); assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 2);
    assert.deepEqual(q.wires.map(w=>w.max_tokens), [24576,32768]);
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
    assert.deepEqual(q.wires.map(w=>w.max_tokens),[24576,32768]);
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

const clipped = () => ({ choices: [{ finish_reason: 'length', message: { content: '{"partial_UNSAFE":', reasoning_content: 'thinking' } }],
  usage: { prompt_tokens: 8375, completion_tokens: 24576, completion_tokens_details: { reasoning_tokens: 24259 } } });

test('planning lifecycle: one scope covers both HTTPs, validated publication and releases at ready; restore acquires nothing', async () => {
  const h = await fixture(); let held = false, acquisitions = 0, releases = 0;
  try {
    const q = await setup(h, 'lifetime-ready', ['{}', JSON.stringify(candidateModel())], () => assert.equal(held, true));
    q.deps.acquireExecution = async () => { acquisitions++; held = true; return () => { releases++; held = false; }; };
    const publish = h.planStore.upsertCandidate.bind(h.planStore);
    h.planStore.upsertCandidate = async (...args) => { assert.equal(held, true); return publish(...args); };
    const result = await q.run(); assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 2);
    assert.equal(held, false); assert.equal(acquisitions, 1); assert.equal(releases, 1);
    assert.equal((await q.run()).status, 'already_ready'); assert.equal(acquisitions, 1); assert.equal(q.wires.length, 2);
  } finally { h.db.close(); }
});

test('planning lifecycle: native denial before generation records no HTTP and no physical attempt', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'lifetime-denied', [JSON.stringify(candidateModel())]);
    q.deps.acquireExecution = async () => { throw new (require('../dist/application/llm/openAICompatible').HttpRequestNotSentError)('service unavailable'); };
    const result = await q.run(); assert.equal(result.status, 'retryable_failed'); assert.equal(result.physicalRequests, 0);
    assert.equal(q.wires.length, 0); assert.equal((await q.store.listAttempts('campaign-plan:lifetime-denied')).length, 0);
    assert.equal(await h.planStore.latestCandidateForJob('lifetime-denied'), null);
    assert.equal((await h.planStore.getSetup('lifetime-denied')).status, 'planning');
  } finally { h.db.close(); }
});

test('planning lifecycle: unknown and cancellation release protection; unknown recovery neither acquires nor replays', async () => {
  const h = await fixture(); let releases = 0, acquisitions = 0;
  try {
    const q = await setup(h, 'lifetime-unknown', ['timeout', JSON.stringify(candidateModel())]);
    q.deps.acquireExecution = async () => { acquisitions++; return () => { releases++; }; };
    assert.equal((await q.run()).status, 'outcome_unknown'); assert.equal(releases, 1);
    assert.equal((await q.run()).status, 'outcome_unknown'); assert.equal(acquisitions, 1); assert.equal(q.wires.length, 1);
    const cancelled = await setup(h, 'lifetime-cancelled', [JSON.stringify(candidateModel())]);
    cancelled.deps.acquireExecution = async () => {
      await h.adapter.execute("UPDATE campaign_setups SET status='cancelled' WHERE setup_id=?", ['lifetime-cancelled']);
      return () => { releases++; };
    };
    assert.equal((await cancelled.run()).status, 'stale'); assert.equal(releases, 2); assert.equal(cancelled.wires.length, 0);
    assert.equal((await cancelled.store.listAttempts('campaign-plan:lifetime-cancelled')).length, 0);
  } finally { h.db.close(); }
});

test('planning output: known truncated business output receives one usage-informed kernel retry and never becomes a candidate', async () => {
  const h=await fixture();
  try {
    const q=await setup(h,'clipped-recovery',[clipped(),JSON.stringify(candidateModel())]);
    const result=await q.run(); assert.equal(result.status,'candidate_ready'); assert.equal(result.physicalRequests,2);
    assert.deepEqual(q.wires.map(w=>w.max_tokens),[24576,32768]);
    const attempts=await q.store.listAttempts('campaign-plan:clipped-recovery');
    assert.equal(attempts[0].failureClass,'length'); assert.equal(attempts[0].reasoningTokens,24259);
    assert.ok(attempts[1].reasoningReserveTokens>24259); assert.equal(attempts[1].wireOutputTokens,32768);
    assert.equal((await h.planStore.latestCandidateForJob('clipped-recovery')).rawResponseText.includes('partial_UNSAFE'),false);
    assert.equal((await q.run()).physicalRequests,0); assert.equal(q.wires.length,2);
  } finally { h.db.close(); }
});

test('planning output: restart after known truncation uses durable usage and preserves the original frozen root', async () => {
  const h=await fixture();
  try {
    const renew=h.planStore.renewJobLease.bind(h.planStore);
    const q=await setup(h,'clipped-restart',[clipped(),JSON.stringify(candidateModel())],n=>{
      if(n===1)h.planStore.renewJobLease=async()=>{throw Error('interrupted after known truncation');};
    });
    const first=await q.run(); assert.equal(first.status,'retryable_failed'); assert.equal(first.physicalRequests,1);
    const root=h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:clipped-restart').payload_json;
    h.planStore.renewJobLease=renew;
    const second=await q.run();assert.equal(second.status,'candidate_ready');assert.equal(second.physicalRequests,1);
    assert.deepEqual(q.wires.map(w=>w.max_tokens),[24576,32768]);
    assert.equal(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:clipped-restart').payload_json,root);
  }finally{h.db.close();}
});

test('planning output: a second truncated response exhausts the same two-request budget and never triggers a structural repair', async () => {
  const h=await fixture();
  try {
    const q=await setup(h,'clipped-twice',[clipped(),clipped(),JSON.stringify(candidateModel())]);
    const first=await q.run();assert.equal(first.status,'retryable_failed');assert.equal(first.physicalRequests,2);
    const second=await q.run();assert.equal(second.status,'invalid');assert.equal(second.physicalRequests,0);assert.equal(q.wires.length,2);
    assert.equal(await h.planStore.latestCandidateForJob('clipped-twice'),null);
  }finally{h.db.close();}
});

test('planning feedback: a new task freezes previous censored usage and grants body output on top of sufficient reasoning', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'history-floor', [JSON.stringify(candidateModel())], undefined, largeProfile);
    await seedUsage(q.store, 'prior-known-length', 32422, 'length');
    const result = await q.run(); assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 1);
    assert.equal(q.wires[0].max_tokens, 60921);
    const root = JSON.parse(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:history-floor').payload_json);
    assert.deepEqual(root.reasoningPolicy.usageFeedback, { completed: [], exhausted: [32422] });
    const attempts = await q.store.listAttempts('campaign-plan:history-floor');
    assert.equal(attempts[0].reasoningReserveTokens, 48633); assert.equal(attempts[0].wireOutputTokens - attempts[0].reasoningReserveTokens, 12288);
  } finally { h.db.close(); }
});

test('planning feedback: known 24576 exhaustion receives a 49152 wire ceiling rather than the previous five-percent boost', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'large-recovery', ['thinking', JSON.stringify(candidateModel())], undefined, largeProfile);
    const result = await q.run(); assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 2);
    assert.deepEqual(q.wires.map(w => w.max_tokens), [24576, 49152]);
    assert.equal((await q.store.listAttempts('campaign-plan:large-recovery'))[1].reasoningReserveTokens, 36864);
  } finally { h.db.close(); }
});

test('planning feedback: restoration ignores later history and keeps the original material root and selected budget', async () => {
  const h = await fixture();
  try {
    const renew = h.planStore.renewJobLease.bind(h.planStore);
    const q = await setup(h, 'frozen-history', ['{}', JSON.stringify(candidateModel())], n => {
      if (n === 1) h.planStore.renewJobLease = async () => { throw Error('interrupted after known content'); };
    }, largeProfile);
    await seedUsage(q.store, 'prior-complete', 24000);
    assert.equal((await q.run()).status, 'retryable_failed');
    const root = h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:frozen-history').payload_json;
    await seedUsage(q.store, 'later-length', 42000, 'length');
    h.planStore.renewJobLease = renew;
    const result = await q.run();
    assert.equal(result.status, 'candidate_ready'); assert.equal(result.physicalRequests, 1);
    assert.deepEqual(q.wires.map(w => w.max_tokens), [42288, 42288]);
    assert.equal(h.db.prepare('SELECT payload_json FROM frozen_turn_material_roots WHERE root_id=?').get('campaign-job:frozen-history').payload_json, root);
  } finally { h.db.close(); }
});

test('planning feedback: a known infeasible history dispatches no paid request and leaves no candidate', async () => {
  const h = await fixture();
  try {
    const q = await setup(h, 'history-infeasible', [JSON.stringify(candidateModel())]);
    await seedUsage(q.store, 'prior-large', 32422, 'length');
    const result = await q.run(); assert.equal(result.status, 'retryable_failed'); assert.equal(result.physicalRequests, 0);
    assert.equal(q.wires.length, 0); assert.match(result.errors.join(' '), /observed reasoning usage/);
    assert.equal(await h.planStore.latestCandidateForJob('history-infeasible'), null);
  } finally { h.db.close(); }
});
