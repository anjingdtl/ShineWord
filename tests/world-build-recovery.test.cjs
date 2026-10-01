'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileHarness, loadMobileModule } = require('./helpers/mobileHarness.cjs');
const { taskOverallProgress } = require('../dist/application/worldBuild/buildProgress');
const { executeWithAutomaticMappingRecovery } = require('../dist/application/worldBuild/automaticMappingRecovery');

const PROFILE = { id: 'primary', name: 'Primary', endpoint: 'https://primary.invalid/v1', model: 'glm-test', keyRef: 'llm.primary',
  capabilities: { supportsJson: true, supportsStreaming: false, reportsUsage: true, contextWindow: 65_536, maxOutputTokens: 24_576 },
  reasoningDialect: 'glm', reasoningTier: 'low', contentOutputTokens: 3_000, concurrency: 1 };
const QUOTE = '林凡站在青石巷，手持铜钥，懂得听风术，遵守入夜禁行的规矩。';

test('production mobile pipeline recovers reasoning-only mapping through backoff without asking the user', async () => {
  let mappingRequests = 0;
  let extractRequests = 0;
  let automaticNotice = false;
  const h = await createMobileHarness({ bytes: Buffer.from(`第一章 街口\n${QUOTE}`), transport: {
    async post(request) {
      const body = JSON.parse(request.body);
      const system = body.messages[0].content;
      let output;
      if (system.includes('WorldMapper')) {
        mappingRequests += 1;
        if (mappingRequests <= 6) return { status: 200, body: JSON.stringify({ choices: [{
          message: { content: '', reasoning_content: 'synthetic fixture' }, finish_reason: 'length' }] }) };
        output = { skills: [], lore: [] };
      } else if (system.includes('Extractor')) {
        extractRequests += 1;
        const entities = [['lin', 'character', '林凡'], ['alley', 'location', '青石巷'], ['key', 'item', '铜钥'], ['wind', 'ability', '听风术']]
          .map(([key, type, name]) => ({ key, type, name, aliases: [] }));
        output = { entities, facts: entities.map(e => ({ subject: e.key, predicate: 'named', value: { name: e.name },
          status: 'explicit', confidence: 1, segment: 1, quote: QUOTE })), events: [], ruleMappings: [] };
      } else if (system.includes('Timeline')) output = { events: [] };
      else throw new Error('unexpected request');
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }] }) };
    },
  } });
  try {
    const imported = await h.sourceImport.importNovelUnified('memory://fixture', 'automatic.txt', PROFILE, 'full', () => {});
    const runId = imported.runIds[0];
    const result = await h.sourceImport.runExtraction(runId, PROFILE, info => {
      if (info.message?.includes('后台自动恢复')) automaticNotice = true;
    });
    assert.equal(result.completed, true);
    assert.equal(automaticNotice, true, 'the automatic backoff branch actually ran');
    assert.ok(mappingRequests > 6);
    assert.equal(extractRequests, 1, 'completed extraction is never re-requested');
    assert.equal((await h.runtime.worldStore.listReviewIssues(imported.worldId, 'open')).length, 0);
    assert.equal(taskOverallProgress(await h.runStore.getRun(runId)).ratio, 1);
  } finally { h.db.close(); }
});

test('background recovery automatically retries with durable backoff and completes without review or user action', async () => {
  const h = await createMobileHarness({ bytes: Buffer.from(`第一章 街口\n${QUOTE}`) });
  try {
    const imported = await h.sourceImport.importNovelUnified('memory://fixture', 'auto.txt', PROFILE, 'full', () => {});
    const runId = imported.runIds[0];
    let time = Date.now();
    let attempts = 0;
    let waited = 0;
    const result = await executeWithAutomaticMappingRecovery({
      runStore: h.runStore, worldStore: h.runtime.worldStore, signal: { aborted: false },
      now: () => time, sleep: async ms => { time += ms; waited += ms; },
      execute: async () => {
        attempts += 1;
        await h.runStore.setRunStatus(runId, attempts < 4 ? 'failed_retryable' : 'completed', new Date(time).toISOString(),
          attempts < 4 ? 'mapping_auto_retry' : null);
        return { completed: attempts === 4 };
      },
    }, runId);
    assert.equal(result.completed, true);
    assert.equal(attempts, 4);
    assert.equal(waited, 5_000 + 10_000 + 300_000, 'persistent faults use a circuit backoff');
    const recovery = await h.runtime.worldStore.getJob(imported.worldId, `job-map-recovery-${runId}`);
    assert.equal(recovery.attempts, 3);
    assert.equal((await h.runtime.worldStore.listReviewIssues(imported.worldId, 'open')).length, 0);
  } finally { h.db.close(); }
});

test('automatic recovery honors a stop during backoff and preserves checkpoints', async () => {
  const h = await createMobileHarness({ bytes: Buffer.from(`第一章 街口\n${QUOTE}`) });
  try {
    const imported = await h.sourceImport.importNovelUnified('memory://fixture', 'stop-auto.txt', PROFILE, 'full', () => {});
    const runId = imported.runIds[0];
    const signal = { aborted: false, stopRequested: false };
    let attempts = 0;
    await executeWithAutomaticMappingRecovery({
      runStore: h.runStore, worldStore: h.runtime.worldStore, signal,
      sleep: async () => { signal.aborted = true; signal.stopRequested = true; },
      execute: async () => {
        attempts += 1;
        await h.runStore.setRunStatus(runId, 'failed_retryable', new Date().toISOString(), 'mapping_auto_retry');
        return { completed: false };
      },
    }, runId);
    assert.equal(attempts, 1);
    assert.equal((await h.runStore.getRun(runId)).status, 'stopped_user');
    assert.ok(await h.runtime.worldStore.getJob(imported.worldId, `job-map-recovery-${runId}`));
  } finally { h.db.close(); }
});

test('whole build: unusable API stays below 100% without content review; selected API resumes without repeating extraction', async () => {
  const requests = [];
  const h = await createMobileHarness({ bytes: Buffer.from(`第一章 街口\n${QUOTE}`), transport: {
    async post(request) {
      const body = JSON.parse(request.body);
      const system = body.messages[0].content;
      requests.push({ url: request.url, system, tokens: body.max_tokens });
      let output;
      if (system.includes('WorldMapper')) {
        if (request.url.includes('primary')) return { status: 401,
          body: JSON.stringify({ error: { message: 'invalid credential (401)' } }) };
        output = { skills: [], lore: [], constraints: [], actorTemplates: [], items: [] };
      } else if (system.includes('Extractor')) {
        const entities = [['lin', 'character', '林凡'], ['alley', 'location', '青石巷'], ['key', 'item', '铜钥'], ['wind', 'ability', '听风术']]
          .map(([key, type, name]) => ({ key, type, name, aliases: [] }));
        output = { entities, facts: entities.map(entity => ({ subject: entity.key, predicate: 'named',
          value: { name: entity.name }, status: 'explicit', confidence: 1, segment: 1, quote: QUOTE })), events: [], ruleMappings: [] };
      } else if (system.includes('Timeline')) output = { events: [] };
      else throw new Error('unexpected request');
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }] }) };
    },
  } });
  try {
    const imported = await h.sourceImport.importNovelUnified('memory://fixture', 'review.txt', PROFILE, 'full', () => {});
    const runId = imported.runIds[0];
    const failed = await h.sourceImport.runExtraction(runId, PROFILE, () => {});
    assert.equal(failed.completed, false);
    const run = await h.runStore.getRun(runId);
    assert.equal(run.status, 'failed_retryable');
    assert.equal(run.lastErrorCode, 'mapping_configuration_required');
    assert.equal(run.unitsDone, run.unitsTotal);
    assert.ok(taskOverallProgress(run).ratio < 1);
    const tasksApi = loadMobileModule('mobile/src/buildTasks.ts', { './database': { getDatabaseRuntime: async () => h.runtime } });
    const task = (await tasksApi.listOpenBuildTasksForWorld(imported.worldId))[0];
    assert.equal(task.openReviewIssues, 0);
    assert.equal(task.blockingReviewIssues, 0);
    const extractionRequests = requests.filter(r => r.system.includes('Extractor')).length;
    const backup = { ...PROFILE, id: 'backup', endpoint: 'https://backup.invalid/v1', keyRef: 'llm.backup' };
    await h.sourceImport.useCurrentApiForRun(runId, backup);
    await h.sourceImport.resumeRun(runId);
    assert.equal((await h.runStore.getRun(runId)).status, 'failed_retryable');
    const result = await h.sourceImport.runExtraction(runId, PROFILE, () => {});
    assert.equal(result.completed, true);
    assert.equal(requests.filter(r => r.system.includes('Extractor')).length, extractionRequests);
    assert.ok(requests.some(r => r.url.includes('backup') && r.system.includes('WorldMapper')));
    assert.equal((await h.runtime.worldStore.listReviewIssues(imported.worldId, 'open')).length, 0);
    assert.equal(taskOverallProgress(await h.runStore.getRun(runId)).ratio, 1);
    assert.equal((await tasksApi.listOpenBuildTasksForWorld(imported.worldId)).length, 0);
    const finished = await tasksApi.listBuildTasksForWorld(imported.worldId);
    assert.equal(finished.length, 1, 'completed task remains visible in the hub');
    assert.equal(finished[0].status, 'completed');
    assert.equal(taskOverallProgress(finished[0]).valueText.endsWith('100%'), true);
    assert.ok(await h.runtime.worldStore.getPublishedPackageRevision(imported.worldId));
  } finally { h.db.close(); }
});

test('progress includes mapping, review/validation, publication and never reaches 100% during those stages', () => {
  const run = { unitsDone: 1, unitsTotal: 1, status: 'running', phase: 'mapping' };
  assert.equal(taskOverallProgress(run).valueText, '1/4 步 · 25%');
  assert.equal(taskOverallProgress({ ...run, phase: 'validating' }).done, 2);
  assert.equal(taskOverallProgress({ ...run, phase: 'publishing' }).done, 3);
  assert.ok(taskOverallProgress({ ...run, phase: 'validating', status: 'needs_review' }).ratio < 1);
  assert.equal(taskOverallProgress({ ...run, status: 'completed' }).ratio, 1);
});

test('replacing API refuses a live executor and does not rewrite its frozen configuration', async () => {
  const h = await createMobileHarness({ bytes: Buffer.from(`第一章 街口\n${QUOTE}`) });
  try {
    const imported = await h.sourceImport.importNovelUnified('memory://fixture', 'api.txt', PROFILE, 'full', () => {});
    const runId = imported.runIds[0];
    await h.runStore.setRunStatus(runId, 'failed_retryable', new Date().toISOString());
    h.db.prepare('UPDATE world_build_runs SET lease_owner = ?, lease_expires_at = ? WHERE run_id = ?')
      .run('other-process', new Date(Date.now() + 60_000).toISOString(), runId);
    const before = await h.runStore.getRun(runId);
    await assert.rejects(h.sourceImport.useCurrentApiForRun(runId, { ...PROFILE, endpoint: 'https://backup.invalid/v1' }), /仍在执行/);
    assert.equal((await h.runStore.getRun(runId)).configJson, before.configJson);
  } finally { h.db.close(); }
});
