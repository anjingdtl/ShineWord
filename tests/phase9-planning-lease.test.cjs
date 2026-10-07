const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, candidateModel, NOW } = require('./helpers/phase9CampaignFixture.cjs');
const { runOpeningPlanJob } = require('../dist/application/campaignPlan/planningService');
const { canonicalJsonOf, sha256HexOf } = require('../dist/application/campaignPlan/hashing');
const profile = { id: 'lease-test', name: 'Lease test', endpoint: 'https://example.invalid', model: 'test', keyRef: 'k', reasoningTier: 'high',
  capabilities: { contextWindow: 65536, maxOutputTokens: 32768, supportsJson: true } };
const args = { anchorTitle: '开篇', playerName: '旅人', protagonistSkills: ['skill-observation'] };
async function job(h, id) {
  const setup = await h.planStore.getSetup('setup-t'), intent = { ...setup.intent, setupId: id };
  await h.planStore.upsertSetup({ ...setup, setupId: id, intent, status: 'planning', currentCandidateId: null });
  await h.planStore.insertJob({ ...await h.planStore.getJob('job-t'), jobId: id, setupId: id, status: 'queued',
    intentHash: sha256HexOf(canonicalJsonOf(intent)), leaseOwner: null, leaseExpiresAt: null, fencingToken: 0,
    attemptCount: 0, freezeRootId: null, lastError: null });
}
async function hold(h, id, now) {
  let resolveResponse, entered;
  const entry = new Promise(resolve => { entered = resolve; });
  const response = new Promise(resolve => { resolveResponse = resolve; });
  let calls = 0;
  const deps = { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, profile, now,
    provider: { async complete() { calls++; entered(); return response; } } };
  const pending = runOpeningPlanJob(deps, id, args);
  await entry;
  return { deps, pending, calls: () => calls, finish: (text = JSON.stringify(candidateModel())) => resolveResponse({ text }) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('planning lease: a live high-effort request remains single-flight beyond the initial ten-minute lease', async t => {
  const h = await fixture(); let run;
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = Date.parse(NOW), now = () => new Date(clock).toISOString();
  try {
    await job(h, 'long-live'); run = await hold(h, 'long-live', now);
    const initial = await h.planStore.getJob('long-live');
    for (let i = 0; i < 4; i++) { clock += 200000; t.mock.timers.tick(200000); await flush(); }
    const live = await h.planStore.getJob('long-live');
    assert.ok(Date.parse(live.leaseExpiresAt) > clock, 'the live request lease must renew, not expire while waiting for the response');
    assert.equal(live.fencingToken, initial.fencingToken);
    const concurrent = await runOpeningPlanJob(run.deps, 'long-live', args);
    assert.equal(concurrent.status, 'stale'); assert.match(concurrent.errors.join(' '), /lease held/);
    assert.equal(run.calls(), 1);
    run.finish(); assert.equal((await run.pending).status, 'candidate_ready');
    clock += 600000; t.mock.timers.tick(600000); await flush();
    assert.equal((await h.planStore.getJob('long-live')).status, 'candidate_ready');
    assert.equal(run.calls(), 1);
  } finally { if (run) { run.finish(); await run.pending; } t.mock.timers.reset(); h.db.close(); }
});

test('planning lease: the bounded repair keeps the same renewable lease and publishes only its validated response', async t => {
  const h = await fixture(); let finish, pending;
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = Date.parse(NOW), now = () => new Date(clock).toISOString(), calls = 0, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const response = new Promise(resolve => { finish = resolve; });
  try {
    await job(h, 'long-repair');
    const deps = { db: h.adapter, planStore: h.planStore, worldStore: h.worlds, profile, now,
      provider: { async complete() { if (++calls === 1) return { text: '{}' }; entered(); return response; } } };
    pending = runOpeningPlanJob(deps, 'long-repair', args); await waiting;
    const token = (await h.planStore.getJob('long-repair')).fencingToken;
    for (let i = 0; i < 4; i++) { clock += 200000; t.mock.timers.tick(200000); await flush(); }
    assert.equal((await runOpeningPlanJob(deps, 'long-repair', args)).status, 'stale');
    assert.equal(calls, 2);
    finish({ text: JSON.stringify(candidateModel()) });
    assert.equal((await pending).status, 'candidate_ready');
    const candidate = await h.planStore.latestCandidateForJob('long-repair');
    assert.equal(candidate.repairUsed, true); assert.equal(candidate.stage, 'ready');
    assert.equal((await h.planStore.getJob('long-repair')).fencingToken, token);
  } finally { finish?.({ text: JSON.stringify(candidateModel()) }); if (pending) await pending; t.mock.timers.reset(); h.db.close(); }
});

test('planning lease: renewal failure preserves the received raw response but blocks repair dispatch and publication', async t => {
  const h = await fixture(); let run;
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = Date.parse(NOW), now = () => new Date(clock).toISOString();
  try {
    await job(h, 'renew-failure'); run = await hold(h, 'renew-failure', now);
    h.planStore.renewJobLease = async () => { throw Error('database unavailable'); };
    clock += 200000; t.mock.timers.tick(200000); await flush();
    run.finish('{}'); assert.equal((await run.pending).status, 'stale');
    const candidate = await h.planStore.latestCandidateForJob('renew-failure');
    assert.equal(candidate.stage, 'raw_response'); assert.equal(candidate.rawResponseText, '{}');
    assert.equal(run.calls(), 1);
  } finally { if (run) { run.finish(); await run.pending; } t.mock.timers.reset(); h.db.close(); }
});

test('planning lease: cancellation during a long request cannot be renewed or publish a candidate', async t => {
  const h = await fixture(); let run;
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = Date.parse(NOW), now = () => new Date(clock).toISOString();
  try {
    await job(h, 'long-cancel'); run = await hold(h, 'long-cancel', now);
    await h.planStore.deleteSetup('long-cancel');
    clock += 200000; t.mock.timers.tick(200000); await flush();
    run.finish(); assert.equal((await run.pending).status, 'stale');
    assert.equal((await h.planStore.getJob('long-cancel')).status, 'cancelled');
    assert.equal(await h.planStore.latestCandidateForJob('long-cancel'), null);
    assert.equal(run.calls(), 1);
  } finally { if (run) { run.finish(); await run.pending; } t.mock.timers.reset(); h.db.close(); }
});

test('planning lease: an expired takeover fences the original worker and a heartbeat cannot revive its token', async t => {
  const h = await fixture(); let run;
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = Date.parse(NOW), now = () => new Date(clock).toISOString();
  try {
    await job(h, 'long-takeover'); run = await hold(h, 'long-takeover', now);
    clock += 700000; // Suspension: no heartbeat ran during this interval.
    const next = await h.planStore.reclaimExpiredJob('long-takeover', 'replacement', new Date(clock + 600000).toISOString(), now());
    assert.ok(next);
    t.mock.timers.tick(200000); await flush();
    run.finish(); assert.equal((await run.pending).status, 'stale');
    const retained = await h.planStore.getJob('long-takeover');
    assert.equal(retained.fencingToken, next.fencingToken); assert.equal(retained.leaseOwner, 'replacement');
    assert.equal(retained.status, 'running'); assert.equal(await h.planStore.latestCandidateForJob('long-takeover'), null);
    assert.equal(run.calls(), 1);
  } finally { if (run) { run.finish(); await run.pending; } t.mock.timers.reset(); h.db.close(); }
});
