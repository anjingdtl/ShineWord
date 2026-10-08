const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { loadMobileModule } = require('./helpers/mobileHarness.cjs');

async function bridge(h) {
  let calls = 0;
  let acquisitions = 0;
  const api = loadMobileModule('mobile/src/campaignPlanning.ts', {
    './database': { getDatabaseRuntime: async () => ({ db: h.adapter, worldStore: h.worlds }) },
    './runtime': { buildProvider: async () => ({ async complete() { calls++; throw Error('Unexpected paid replay'); } }) },
    './llmExecutionBridge': { acquirePlanningExecution: async () => { acquisitions++; throw Error('A terminal preparation must not acquire execution'); } },
  });
  return { api, calls: () => calls, acquisitions: () => acquisitions };
}

async function savedJob(h, status, lastError = null) {
  const original = await h.planStore.getSetup('setup-t'), id = 'restore-' + status;
  const intent = { ...original.intent, setupId: id };
  await h.planStore.upsertSetup({ ...original, setupId: id, intent, status: 'planning', currentCandidateId: null, updatedAt: '2026-10-07T00:00:00Z' });
  await h.planStore.insertJob({ jobId: 'job-' + id, setupId: id, campaignId: null, branchId: null, jobKind: 'opening_plan', triggerReasons: ['test'],
    baseStateVersion: null, basePlanId: null, basePlanRevision: null, intentHash: 'a'.repeat(64), contentManifestHash: null, knowledgePolicyHash: null,
    triggerEventRefs: [], status, leaseOwner: null, leaseExpiresAt: null, fencingToken: 0, attemptCount: 1, nextRetryAt: null,
    physicalRequestBudget: 2, freezeRootId: null, lastError, createdAt: NOW, updatedAt: NOW });
  return id;
}

test('preparation restore: cold and explicit resume preserve outcome_unknown, exact input and zero HTTP', async () => {
  const h = await fixture();
  try {
    const id = await savedJob(h, 'outcome_unknown', 'LLM request timed out.'), b = await bridge(h);
    const state = await h.turns.getState(h.branchId), original = await h.planStore.getJob('job-' + id);
    for (let i = 0; i < 2; i++) {
      const restored = await b.api.restoreCampaignPreparation('w', h.session.profile);
      assert.equal(restored.setupId, id);
      assert.equal(restored.phase, 'outcome_unknown');
      assert.match(restored.error, /可能已经计费.*恢复不会自动重发/);
      assert.equal(restored.proposal, null);
      assert.equal(restored.input.goal, (await h.planStore.getSetup(id)).intent.rawIntent);
      const phases = [], resumed = await b.api.resumeCampaignPreparation(id, restored.input, p => phases.push(p));
      assert.equal(resumed.phase, 'outcome_unknown');
      assert.equal(resumed.error, restored.error);
      assert.equal(phases.at(-1), 'outcome_unknown');
    }
    assert.equal(b.calls(), 0);
    assert.equal(b.acquisitions(), 0);
    assert.deepEqual(await h.planStore.getJob('job-' + id), original);
    assert.deepEqual(await h.turns.getState(h.branchId), state);
  } finally { h.db.close(); }
});

test('preparation restore: a rejected candidate stays failed and an intact ready proposal restores without a request', async () => {
  const h = await fixture();
  try {
    const id = await savedJob(h, 'invalid', 'Invalid completion reference'), b = await bridge(h);
    const failed = await b.api.restoreCampaignPreparation('w', h.session.profile);
    assert.equal(failed.phase, 'failed'); assert.match(failed.error, /Invalid completion reference/);
    const resumed = await b.api.resumeCampaignPreparation(id, failed.input, () => {});
    assert.equal(resumed.phase, 'failed'); assert.notEqual(resumed.phase, 'outcome_unknown');
    await h.adapter.execute("UPDATE campaign_setups SET status='cancelled' WHERE setup_id=?", [id]);
    await h.planStore.insertJob({ ...await h.planStore.getJob('job-t'), jobId: 'job-setup-t', status: 'candidate_ready' });
    await h.planStore.upsertCandidate({ ...await h.planStore.getCandidate('cand-t'), candidateId: 'cand-restore-ready', jobId: 'job-setup-t' });
    await h.adapter.execute("UPDATE campaign_setups SET status='proposal_ready', current_candidate_id='cand-restore-ready' WHERE setup_id='setup-t'");
    const ready = await b.api.restoreCampaignPreparation('w', h.session.profile);
    assert.equal(ready.phase, 'ready'); assert.ok(ready.proposal); assert.equal(ready.error, undefined);
    const repeated = await b.api.resumeCampaignPreparation('setup-t', ready.input, () => {});
    assert.equal(repeated.phase, 'ready'); assert.deepEqual(repeated.proposal, ready.proposal);
    assert.equal(b.calls(), 0);
    assert.equal(b.acquisitions(), 0);
  } finally { h.db.close(); }
});
