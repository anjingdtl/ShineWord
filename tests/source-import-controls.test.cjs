'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const realCoordinator = require('../dist/application/worldBuild/coordinator');
const { createMobileHarness, sha } = require('./helpers/mobileHarness.cjs');
const { SqliteSourceStore } = require('../dist/infra/sqlite/sqliteSourceStore');
const { freezeRunConfig } = require('../dist/application/worldBuild/runConfig');
const { modelBudgetFromProfile } = require('../dist/application/worldBuild/profileModelBudget');

const PROFILE = {
  id: 'default', name: 'Test', endpoint: 'https://api.example.com/v1', model: 'glm-test', keyRef: 'test',
  capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 32_768, maxOutputTokens: 16_384 },
  reasoningTier: 'low', reasoningDialect: 'glm', contentOutputTokens: 3_000, concurrency: 1,
};

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('sourceImport: refinement reuses paused/stopped work and cannot bypass a billing review with a new run', async () => {
  const h = await createMobileHarness({ bytes: Buffer.from('第一章 石殿\n林凡在青石巷停下。') });
  try {
    const imported = await h.sourceImport.importNovelUnified('memory://novel', 'refinement.txt', PROFILE, 'progressive', () => {});
    const runId = imported.runIds[0];
    const before = h.db.prepare('SELECT COUNT(*) n FROM world_build_runs').get().n;
    for (const status of ['paused_user', 'stopped_user', 'failed_retryable']) {
      h.db.prepare('UPDATE world_build_runs SET status = ? WHERE run_id = ?').run(status, runId);
      assert.deepEqual(await h.sourceImport.startFullWorldRefinement(imported.worldId, PROFILE), { runId, resumed: true });
      assert.equal(h.db.prepare('SELECT COUNT(*) n FROM world_build_runs').get().n, before);
    }
    h.db.prepare("UPDATE world_build_runs SET status = 'needs_review' WHERE run_id = ?").run(runId);
    await assert.rejects(h.sourceImport.startFullWorldRefinement(imported.worldId, PROFILE), /人工审查/);
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM world_build_runs').get().n, before);
    assert.ok((await h.runStore.listUnits(runId)).every(unit => unit.attempt === 0));
  } finally { h.db.close(); }
});

async function setup(concurrency = 1, failure = null) {
  const entered = deferred();
  const release = deferred();
  let capturedSignal;
  let executions = 0;
  let requests = 0;
  const owners = [];
  const coordinator = {
    ...realCoordinator,
    async executeRun(deps, id) {
      executions += 1;
      capturedSignal = deps.signal;
      owners.push(deps.owner);
      const extract = async () => {
        requests += 1;
        if (requests === 1) { entered.resolve(); await release.promise; }
        if (failure) throw failure;
        return { entities: [], facts: [], events: [], ruleMappings: [], rejectedQuotes: 0, rejected: 0 };
      };
      return realCoordinator.executeRun({ ...deps,
        onTimeline: undefined, onFinalize: undefined,
        extractor: { version: deps.extractor.version, extract },
        groupExtractor: { extract },
      }, id);
    },
  };
  const bytes = Buffer.from(Array.from({ length: 5 }, (_, i) =>
    `第${i + 1}章 试炼\n${`林凡进入第${i + 1}座石殿，苏轻语守在云隐峰。\n`.repeat(120)}`).join('\n'));
  const h = await createMobileHarness({ bytes, coordinator });
  const imported = await h.sourceImport.importNovelUnified('memory://novel', 'control-test.txt', PROFILE, 'progressive', () => {});
  const budget = modelBudgetFromProfile(PROFILE);
  await realCoordinator.createExtractionRun({ sourceStore: new SqliteSourceStore(h.adapter),
    runStore: h.runStore, worldStore: h.runtime.worldStore, sha256Hex: sha.sha256Hex }, {
    runId: 'controls-run', worldId: imported.worldId, sourceId: imported.sourceId,
    title: 'Controls', modelFingerprint: 'test-model', extractorVersion: 'test',
    mode: 'chunk', budget, config: freezeRunConfig({ ...PROFILE, concurrency }, budget),
  });
  return { ...h, id: 'controls-run', entered, release, owners,
    signal: () => capturedSignal, executions: () => executions, requests: () => requests };
}

test('sourceImport: pause -> revoke clears the actual executor signal and avoids paused_user', { timeout: 5_000 }, async () => {
  const h = await setup();
  try {
    const running = h.sourceImport.runExtraction(h.id, PROFILE, () => {});
    await h.entered.promise;
    h.sourceImport.pauseRun(h.id);
    assert.equal(h.signal().aborted, true);
    assert.equal(await h.watchdog.startOrResumeBuild(h.id, PROFILE, { resume: true }), 'active');
    assert.equal(h.signal().aborted, false);
    assert.equal(h.signal().stopRequested, false);
    const row = await h.runStore.getRun(h.id);
    assert.equal(row.pauseRequested, false);
    assert.equal(row.cancelRequested, false);
    assert.equal(h.executions(), 1, 'the current coordinator is reused');
    h.release.resolve();
    assert.equal((await running).completed, true);
    assert.equal((await h.runStore.getRun(h.id)).status, 'completed');
  } finally { h.release.resolve(); h.db.close(); }
});

test('sourceImport: revoking an in-flight stop clears stopRequested and both persisted flags', { timeout: 5_000 }, async () => {
  const h = await setup();
  try {
    const running = h.sourceImport.runExtraction(h.id, PROFILE, () => {});
    await h.entered.promise;
    await h.sourceImport.cancelRun(h.id);
    assert.equal(h.signal().stopRequested, true);
    assert.equal(h.signal().aborted, true);
    assert.deepEqual(await h.sourceImport.resumeRun(h.id), { activeInProcess: true });
    assert.equal(h.signal().stopRequested, false);
    assert.equal(h.signal().aborted, false);
    h.release.resolve();
    assert.equal((await running).completed, true);
    assert.equal((await h.runStore.getRun(h.id)).status, 'completed');
  } finally { h.release.resolve(); h.db.close(); }
});

test('sourceImport: concurrent starters share one promise, signal and coordinator', { timeout: 5_000 }, async () => {
  const h = await setup();
  try {
    const first = h.sourceImport.runExtraction(h.id, PROFILE, () => {});
    const second = h.sourceImport.runExtraction(h.id, PROFILE, () => {});
    assert.equal(first, second);
    await h.entered.promise;
    assert.equal(h.executions(), 1);
    h.release.resolve();
    await Promise.all([first, second]);
    assert.equal(h.sourceImport.isRunActive(h.id), false);
  } finally { h.release.resolve(); h.db.close(); }
});

test('sourceImport: stopping an idle queued run persists stopped_user without starting an executor', { timeout: 5_000 }, async () => {
  const h = await setup();
  try {
    await h.sourceImport.cancelRun(h.id);
    const stopped = await h.runStore.getRun(h.id);
    assert.equal(stopped.status, 'stopped_user');
    assert.equal(stopped.cancelRequested, false);
    assert.equal(stopped.pauseRequested, false);
    assert.equal(h.executions(), 0);
    assert.equal(h.requests(), 0);
    assert.ok((await h.runStore.listUnits(h.id)).every(unit => unit.status === 'queued' && unit.attempt === 0));
    const late = await h.sourceImport.runExtraction(h.id, PROFILE, () => {});
    assert.equal(late.completed, false);
    assert.equal(h.executions(), 0, 'a late service callback cannot restart a user-stopped task');
    h.release.resolve();
    await h.watchdog.startOrResumeBuild(h.id, PROFILE, { resume: true });
    assert.equal((await h.runStore.getRun(h.id)).status, 'completed');
  } finally { h.release.resolve(); h.db.close(); }
});

test('sourceImport: reviewed finalization resumes completed units without bypassing unresolved or billing review', { timeout: 5_000 }, async () => {
  const h = await setup();
  try {
    h.release.resolve();
    await h.sourceImport.runExtraction(h.id, PROFILE, () => {});
    const requests = h.requests();
    h.db.prepare("UPDATE world_build_runs SET status = 'needs_review', last_error_code = 'canon_conflict' WHERE run_id = ?").run(h.id);
    const worldId = (await h.runStore.getRun(h.id)).worldId;
    await h.runtime.worldStore.saveReviewIssue({ worldId, issueId: 'canon-conflict', kind: 'canon_conflict',
      severity: 'blocking', detailJson: '{}', createdAt: new Date().toISOString() });
    assert.equal(await h.watchdog.startOrResumeBuild(h.id, PROFILE, { resume: true }), 'inactive');
    await h.runtime.worldStore.resolveReviewIssue(worldId, 'canon-conflict', 'resolved');
    await h.watchdog.startOrResumeBuild(h.id, PROFILE, { resume: true });
    assert.equal((await h.runStore.getRun(h.id)).status, 'completed');
    assert.equal(h.requests(), requests, 'finalization reuses completed extraction');
    h.db.prepare("UPDATE world_build_runs SET status = 'needs_review', last_error_code = 'outcome_unknown' WHERE run_id = ?").run(h.id);
    assert.equal(await h.watchdog.startOrResumeBuild(h.id, PROFILE, { resume: true }), 'inactive');
    assert.equal(h.requests(), requests, 'ordinary resume never authorizes uncertain billing replay');
  } finally { h.release.resolve(); h.db.close(); }
});

test('sourceImport: stopping a run leased by another process only requests a boundary stop', { timeout: 5_000 }, async () => {
  const h = await setup();
  try {
    await h.runStore.acquireLease(h.id, 'other-process', 60_000, new Date().toISOString());
    await h.sourceImport.cancelRun(h.id);
    const requested = await h.runStore.getRun(h.id);
    assert.equal(requested.status, 'running');
    assert.equal(requested.cancelRequested, true);
    assert.equal(requested.leaseOwner, 'other-process');
    assert.equal(h.executions(), 0);
  } finally { h.release.resolve(); h.db.close(); }
});

test('sourceImport: idle concurrent workers keep pause pending until the response commits, and allow revocation', { timeout: 5_000 }, async () => {
  const h = await setup(3);
  try {
    // Leave one request in flight with two idle workers, matching the small UI build.
    h.db.prepare("DELETE FROM world_build_units WHERE run_id = ? AND ord > 0").run(h.id);
    h.db.prepare('UPDATE world_build_runs SET units_total = 1 WHERE run_id = ?').run(h.id);
    const running = h.sourceImport.runExtraction(h.id, PROFILE, () => {});
    await h.entered.promise;
    // Notification control reaches SQLite without touching the JS signal.
    await h.runStore.requestRunControl(h.id, 'pause', new Date().toISOString());
    await new Promise(resolve => setTimeout(resolve, 250));
    const pending = await h.runStore.getRun(h.id);
    assert.equal(pending.status, 'running', 'idle workers cannot honor pause before a sibling finishes');
    assert.equal(pending.pauseRequested, true);
    assert.equal(await h.watchdog.startOrResumeBuild(h.id, PROFILE, { resume: true }), 'active');
    h.release.resolve();
    assert.equal((await running).completed, true);
    assert.equal((await h.runStore.getRun(h.id)).status, 'completed');
    assert.equal(h.executions(), 1);
    assert.equal(h.requests(), 1);
  } finally { h.release.resolve(); h.db.close(); }
});

for (const status of [401, 403]) {
  test(`sourceImport: HTTP ${status} metadata blocks automatic retry even without status in provider text`, { timeout: 5_000 }, async () => {
    const { LlmRequestFailure } = require('../dist/application/llm/types');
    const h = await setup(1, new LlmRequestFailure('credential rejected', [{
      attempt: 1, durationMs: 1, httpStatus: status, outcome: 'http_error', errorCategory: 'provider_http',
    }]));
    try {
      const running = h.sourceImport.runExtraction(h.id, PROFILE, () => {});
      await h.entered.promise;
      h.release.resolve();
      await running;
      assert.equal((await h.runStore.getRun(h.id)).status, 'needs_review');
      const blocked = (await h.runStore.listUnits(h.id)).find(unit => unit.status === 'needs_review');
      assert.equal(blocked.errorCode, 'config');
      assert.match(blocked.errorMessage, new RegExp(`HTTP ${status}`));
      assert.equal(h.requests(), 1, 'an authentication failure is never automatically re-billed');
    } finally { h.release.resolve(); h.db.close(); }
  });
}

test('sourceImport: unknown prior billing outcome remains needs_review instead of an automatic retry loop', { timeout: 5_000 }, async () => {
  const { OutcomeUnknownReplayError } = require('../dist/application/llm/requestLedger');
  const h = await setup(1, new OutcomeUnknownReplayError('request-20260930135000'));
  try {
    const running = h.sourceImport.runExtraction(h.id, PROFILE, () => {});
    await h.entered.promise;
    h.release.resolve();
    await running;
    const run = await h.runStore.getRun(h.id);
    assert.equal(run.status, 'needs_review');
    assert.equal(run.lastErrorCode, 'outcome_unknown');
    assert.equal(h.requests(), 1);
  } finally { h.release.resolve(); h.db.close(); }
});

test('sourceImport: pause honors the unit boundary after committing the in-flight response, then resumes without paying again', { timeout: 5_000 }, async () => {
  const h = await setup();
  try {
    const running = h.sourceImport.runExtraction(h.id, PROFILE, () => {});
    await h.entered.promise;
    h.sourceImport.pauseRun(h.id);
    h.release.resolve();
    await running;
    const paused = await h.runStore.getRun(h.id);
    assert.equal(paused.status, 'paused_user');
    assert.equal(paused.unitsDone, 1, 'the successful paid response is committed before pausing');
    const committed = (await h.runStore.listUnits(h.id)).find(u => u.status === 'completed');
    await h.watchdog.startOrResumeBuild(h.id, PROFILE, { resume: true });
    const final = await h.runStore.listUnits(h.id);
    assert.equal(final.find(u => u.unitId === committed.unitId).attempt, committed.attempt);
    assert.equal(h.requests(), final.length, 'pause/resume never repeats the committed LLM unit');
  } finally { h.release.resolve(); h.db.close(); }
});

test('sourceImport: stopped resume with historical attempts and a silent service falls back and preserves completed units', { timeout: 5_000 }, async () => {
  const h = await setup();
  try {
    // Replan this real imported source into per-chapter groups so work remains after stopping.
    const units = await h.runStore.listUnits(h.id);
    assert.ok(units.length > 1, 'fixture must leave unfinished work');
    const running = h.sourceImport.runExtraction(h.id, PROFILE, progress => {
      if (progress.chunksDone >= 1) void h.sourceImport.cancelRun(h.id);
    });
    await h.entered.promise;
    h.release.resolve();
    await running;
    assert.equal((await h.runStore.getRun(h.id)).status, 'stopped_user');
    const oldCompleted = (await h.runStore.listUnits(h.id)).filter(u => u.status === 'completed');
    assert.ok(oldCompleted.length >= 1);
    const serviceMocks = require('./helpers/mobileHarness.cjs').loadMobileModule('mobile/src/buildWatchdog.ts', {
      './database': { getDatabaseRuntime: async () => h.runtime },
      './buildServiceBridge': { startBuildService: async () => true }, './sourceImport': h.sourceImport,
    });
    assert.equal(await serviceMocks.startOrResumeBuild(h.id, PROFILE, { resume: true, evidenceTimeoutMs: 25, evidencePollMs: 5 }), 'inline');
    assert.equal((await h.runStore.getRun(h.id)).status, 'completed');
    const finalUnits = await h.runStore.listUnits(h.id);
    for (const done of oldCompleted) assert.equal(finalUnits.find(u => u.unitId === done.unitId).attempt, done.attempt);
    assert.equal(h.requests(), finalUnits.length, 'one extraction per unit, including stop/resume');
    assert.equal(new Set(h.owners).size, 2, 'resumed executor has a distinct lease owner');
  } finally { h.release.resolve(); h.db.close(); }
});
