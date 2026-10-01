'use strict';
/**
 * Project projection regression suite (task §35):
 * - 3 worlds -> 3 projects, sorted updatedAt DESC, search filters by title
 * - per-project task isolation comes from the REAL per-world SQL query
 * - campaign / playable / building states drive the card's primary action
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const { BUILTIN_MIGRATIONS } = require(path.join(root, 'dist/infra/sqlite/builtinMigrations'));

function loadMobileModule(relativePath, mocks = {}) {
  const filename = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const nativeRequire = loaded.require.bind(loaded);
  loaded.require = request => {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    const dist = request.match(/^(?:\.\.\/)+src\/(.+)$/);
    return dist ? require(path.join(root, 'dist', dist[1])) : nativeRequire(request);
  };
  loaded._compile(compiled, filename);
  return loaded.exports;
}

class Adapter {
  constructor(db) { this.db = db; this.chain = Promise.resolve(); }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const run = async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try { const value = await work(this); this.db.exec('COMMIT'); return value; }
      catch (error) { this.db.exec('ROLLBACK'); throw error; }
    };
    const pending = this.chain.then(run, run);
    this.chain = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

const NOW = '2026-10-01T00:00:00.000Z';

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  db.prepare(
    `INSERT INTO imported_sources (source_id, raw_sha256, normalized_tree_hash,
       normalize_tree_hash_version, byte_length, code_point_count, encoding, normalize_version,
       chapter_split_version, normalize_shard_scheme, split_strategy, file_name, title,
       status, created_at, updated_at)
     VALUES ('src-1', 'sha-1', 'tree', 'v', 10, 10, 'utf-8', 'normalize-1', 'chapter-split-1',
       'normalize-shard-1', 'standard', 'a.txt', 'A', 'active', ?, ?)`,
  ).run(NOW, NOW);
  for (const [worldId, title, updated, status] of [
    ['w-a', '示例小说甲', '2026-10-01T10:00:00.000Z', 'extracting'],
    ['w-b', '诡秘之主', '2026-10-01T12:00:00.000Z', 'ready'],
    ['w-c', '凡人修仙传', '2026-09-30T08:00:00.000Z', 'ready'],
  ]) {
    db.prepare(
      `INSERT INTO worlds (world_id, title, source_sha256, source_bytes, normalize_version,
         chapter_split_version, build_status, created_at, updated_at)
       VALUES (?, ?, 'sha-1', 10, 'normalize-1', 'chapter-split-1', ?, ?, ?)`,
    ).run(worldId, title, status, NOW, updated);
    db.prepare(
      `INSERT INTO source_chapters (world_id, chapter_id, chapter_index, title, start_offset,
         end_offset, char_count, content_hash, created_at)
       VALUES (?, ?, 0, '第1章', 0, 10, 10, 'h', ?)`,
    ).run(worldId, `${worldId}-ch1`, NOW);
  }
  // Two open runs: A running, B paused. C has none.
  const insertRun = (runId, worldId, runStatus, updated) => {
    db.prepare(
      `INSERT INTO world_build_runs (run_id, world_id, source_id, source_snapshot_hash,
         pipeline_version, plan_version, model_fingerprint, phase, status, units_total,
         units_done, units_failed, created_at, updated_at, plan_state_json)
       VALUES (?, ?, 'src-1', 'snap', 'p', 'plan-analysis-1', 'm', 'extracting', ?, 8, 2, 0, ?, ?, '{}')`,
    ).run(runId, worldId, runStatus, NOW, updated);
    db.prepare(
      `INSERT INTO world_build_units (unit_id, run_id, kind, source_ranges_json, input_hash,
         config_fingerprint, ord, status, attempt, created_at, updated_at)
       VALUES (?, ?, 'extract_group', '{"ranges":[]}', 'h', 'cf', 0, 'completed', 1, ?, ?)`,
    ).run(`${runId}-u1`, runId, NOW, updated);
  };
  insertRun('run-a', 'w-a', 'running', '2026-10-01T11:00:00.000Z');
  insertRun('run-b', 'w-b', 'paused_user', '2026-10-01T09:00:00.000Z');
  return db;
}

test('PROJ-01 three worlds project into three isolated, sorted, searchable projects', async () => {
  const db = setup();
  try {
    const adapter = new Adapter(db);
    const fakeDatabase = { getDatabaseRuntime: async () => ({ db: adapter }) };
    const realBuildTasks = loadMobileModule('mobile/src/buildTasks.ts', { './database': fakeDatabase });

    // REAL per-world SQL: A's task never appears under B or C.
    const forA = await realBuildTasks.listOpenBuildTasksForWorld('w-a');
    const forB = await realBuildTasks.listOpenBuildTasksForWorld('w-b');
    const forC = await realBuildTasks.listOpenBuildTasksForWorld('w-c');
    assert.equal(forA.length, 1);
    assert.equal(forA[0].runId, 'run-a');
    assert.equal(forB.length, 1);
    assert.equal(forB[0].runId, 'run-b');
    assert.equal(forC.length, 0);

    const worldsFixture = [
      { worldId: 'w-a', title: '示例小说甲', sourceSha256: 'sha-1', legacySourceSha256: null, buildStatus: 'extracting', updatedAt: '2026-10-01T10:00:00.000Z', packageRevision: 0, openingReady: false, openReviewIssues: 0 },
      { worldId: 'w-b', title: '诡秘之主', sourceSha256: 'sha-1', legacySourceSha256: null, buildStatus: 'ready', updatedAt: '2026-10-01T12:00:00.000Z', packageRevision: 3, openingReady: true, openReviewIssues: 0 },
      { worldId: 'w-c', title: '凡人修仙传', sourceSha256: 'sha-1', legacySourceSha256: null, buildStatus: 'ready', updatedAt: '2026-09-30T08:00:00.000Z', packageRevision: 2, openingReady: true, openReviewIssues: 1 },
    ];
    const projectLibrary = loadMobileModule('mobile/src/projectLibrary.ts', {
      './database': fakeDatabase,
      './buildTasks': realBuildTasks,
      './worldImport': { listWorlds: async () => worldsFixture },
    });

    const campaigns = [
      { campaignId: 'camp-c', worldId: 'w-c', branchId: 'branch-c' },
    ];
    const projects = await projectLibrary.listProjects({ campaigns });
    assert.equal(projects.length, 3, '3 worlds -> 3 projects');

    // Sort: updatedAt DESC over the merged world+task timestamp
    // (B world 12:00 > A task 11:00 > C world 09-30).
    assert.deepEqual(projects.map(project => project.worldId), ['w-b', 'w-a', 'w-c']);
    const projectA = projects.find(project => project.worldId === 'w-a');
    assert.notEqual(projectA.activeRun, null);
    assert.equal(projectA.activeRun.runId, 'run-a');
    assert.equal(projectA.buildStatus, 'building');

    const byId = new Map(projects.map(project => [project.worldId, project]));
    assert.equal(byId.get('w-b').activeRun.runId, 'run-b', 'B sees only its paused task');
    assert.equal(byId.get('w-b').buildStatus, 'paused');
    assert.equal(byId.get('w-c').activeRun, null, 'C has no open task');
    assert.equal(byId.get('w-c').playable, true, 'C playable shows 开始冒险');
    assert.equal(byId.get('w-c').campaign?.campaignId, 'camp-c', 'C with campaign shows 继续冒险');
    assert.equal(byId.get('w-c').openReviewIssues, 1);
    assert.equal(byId.get('w-a').chapterCount, 1);

    // Search (task §22).
    assert.deepEqual(
      projectLibrary.filterProjects(projects, '示例小说').map(project => project.worldId),
      ['w-a'],
    );
    assert.deepEqual(
      projectLibrary.filterProjects(projects, '  ').length,
      3,
      'blank query keeps everything',
    );
    assert.deepEqual(projectLibrary.filterProjects(projects, '不存在'), []);
  } finally {
    db.close();
  }
});

function projectionFixture() {
  const db = setup();
  const database = { getDatabaseRuntime: async () => ({ db: new Adapter(db) }) };
  const worlds = ['a', 'b', 'c'].map(id => ({ worldId: `w-${id}`, title: `项目${id}`, sourceSha256: 'sha-1',
    updatedAt: NOW, packageRevision: 0, openingReady: false, openReviewIssues: 0 }));
  const library = loadMobileModule('mobile/src/projectLibrary.ts', {
    './database': database, './worldImport': { listWorlds: async () => worlds },
  });
  const calls = { buildProvider: 0, createSession: 0, listCampaigns: 0, listBranches: 0 };
  const session = {
    async listCampaigns() { calls.listCampaigns++; return [{ campaignId: 'camp-a', worldId: 'w-a' }]; },
    async listBranches() { calls.listBranches++; return [{ branchId: 'branch-a' }]; },
  };
  const refresh = loadMobileModule('mobile/src/projectLibraryRefresh.ts', {
    './runtime': {
      async buildProvider() { calls.buildProvider++; return {}; },
      async createSession() { calls.createSession++; return session; },
    },
    './projectLibrary': library,
  });
  return { db, library, refresh, calls, worlds };
}

function run(status, runId = status, done = 0, total = 8) {
  return { runId, status, phase: 'extracting', done, total, failed: 0,
    dynamic: ['queued', 'running'].includes(status), updatedAt: NOW };
}

test('PROJ-closeout unified statuses and priority include every resumable or blocked run', () => {
  const { db, library } = projectionFixture();
  try {
    for (const [status, expected] of Object.entries({ running: 'building', queued: 'building',
      paused_user: 'paused', paused_system: 'paused', stopped_user: 'stopped', needs_review: 'review',
      failed_retryable: 'retry', failed_terminal: 'failed', waiting_network: 'waiting_network', waiting_unlock: 'waiting_unlock' })) {
      assert.equal(library.deriveProjectStatus({ packageRevision: 0 }, library.summarizeProjectBuild([run(status)])), expected);
      assert.ok(library.PROJECT_STATUS_LABEL[expected]);
    }
    assert.equal(library.deriveProjectStatus({ packageRevision: 2, openingReady: true }, library.summarizeProjectBuild([run('completed')])), 'playable');
    assert.equal(library.summarizeProjectBuild([{ ...run('failed_retryable'), lastErrorCode: 'mapping_auto_retry' }]).status, 'recovering');
    assert.equal(library.PROJECT_STATUS_LABEL.recovering, '自动恢复中');
    assert.equal(library.summarizeProjectBuild([{ ...run('paused_user'), lastErrorCode: 'mapping_auto_retry' }]).status, 'paused');
    for (const [lower, higher] of [['completed', 'stopped_user'], ['stopped_user', 'paused_user'],
      ['paused_user', 'waiting_network'], ['waiting_network', 'running'], ['running', 'needs_review'], ['running', 'failed_retryable']]) {
      assert.equal(library.summarizeProjectBuild([run(lower), run(higher)]).status,
        library.summarizeProjectBuild([run(higher)]).status);
    }
  } finally { db.close(); }
});

test('PROJ-closeout multiple runs aggregate all effective batches and remain world-scoped', async () => {
  const { db, library } = projectionFixture();
  try {
    db.prepare(`INSERT INTO world_build_runs
      (run_id, world_id, source_id, source_snapshot_hash, pipeline_version, plan_version, model_fingerprint,
       phase, status, units_total, units_done, units_failed, created_at, updated_at)
      SELECT 'run-a-old', world_id, source_id, source_snapshot_hash, pipeline_version, plan_version, model_fingerprint,
       phase, 'paused_user', 4, 3, 0, created_at, updated_at FROM world_build_runs WHERE run_id = 'run-a'`).run();
    const projects = await library.listProjects({});
    const a = projects.find(p => p.worldId === 'w-a');
    assert.equal(a.activeRun.runId, 'run-a', 'running run outranks old paused run');
    assert.equal(a.buildStatus, 'building');
    assert.equal(a.buildSummary.runsTotal, 2);
    assert.equal(a.buildSummary.doneBatches, 5);
    assert.equal(a.buildSummary.totalBatches, 12);
    assert.equal(a.buildSummary.dynamicRuns, 1);
    assert.equal(projects.find(p => p.worldId === 'w-b').buildSummary.totalBatches, 8);
    const summary = library.summarizeProjectBuild([run('completed', 'stage-1', 8, 8), run('running', 'stage-2', 1, 6), run('canceled', 'superseded', 9, 99)]);
    assert.equal(summary.runsTotal, 2);
    assert.equal(summary.doneBatches, 9);
    assert.equal(summary.totalBatches, 14);
    assert.equal(summary.status, 'building');
  } finally { db.close(); }
});

test('PROJ-closeout fast poll updates card progress/status with zero session/provider/campaign/branch calls', async () => {
  const { db, library, refresh, calls } = projectionFixture();
  try {
    db.prepare("UPDATE world_build_runs SET units_done = 0 WHERE run_id = 'run-a'").run();
    let projects = await refresh.refreshLibraryFull({});
    const baseline = { ...calls };
    const a = projects.find(p => p.worldId === 'w-a');
    assert.equal(a.buildSummary.doneBatches, 0);
    db.prepare("UPDATE world_build_runs SET units_done = 1, updated_at = '2026-10-01T12:00:00.000Z' WHERE run_id = 'run-a'").run();
    db.prepare("UPDATE world_build_units SET updated_at = '2026-10-01T13:00:00.000Z' WHERE run_id = 'run-a'").run();
    let result = await library.refreshProjectBuildStatusFast(projects);
    assert.equal(result.needsFullRefresh, false);
    let next = result.projects.find(p => p.worldId === 'w-a');
    assert.equal(next.buildSummary.doneBatches, 1);
    assert.equal(next.buildSummary.totalBatches, 8);
    assert.equal(next.updatedAt, '2026-10-01T13:00:00.000Z');
    for (const field of ['campaign', 'playable', 'chapterCount', 'title', 'packageRevision']) assert.deepEqual(next[field], a[field]);
    assert.strictEqual(next.campaign, a.campaign, 'stable campaign object is retained');
    projects = result.projects;
    db.prepare("UPDATE world_build_runs SET status = 'paused_user' WHERE run_id = 'run-a'").run();
    result = await library.refreshProjectBuildStatusFast(projects);
    next = result.projects.find(p => p.worldId === 'w-a');
    assert.equal(next.buildStatus, 'paused');
    assert.equal(next.buildSummary.dynamicRuns, 0);
    assert.deepEqual(calls, baseline, 'fast path performs no full-refresh operations');
  } finally { db.close(); }
});

test('PROJ-closeout completion triggers exactly one full refresh and updates opening/campaign projection', async () => {
  const { db, library, refresh, calls, worlds } = projectionFixture();
  try {
    let projects = [];
    const timers = new Map();
    let timerId = 0;
    const controller = refresh.createLibraryRefreshController({
      full: () => refresh.refreshLibraryFull({}), fast: library.refreshProjectBuildStatusFast,
      getProjects: () => projects, apply: next => { projects = next; }, onError: e => { throw e; },
      setTimer: cb => { timers.set(++timerId, cb); return timerId; }, clearTimer: id => timers.delete(id),
    });
    await controller.focus();
    assert.equal(timers.size, 1);
    const baseline = calls.createSession;
    db.prepare("UPDATE world_build_runs SET status = 'completed', units_done = 8 WHERE run_id = 'run-a'").run();
    worlds[0].packageRevision = 1;
    worlds[0].openingReady = true;
    await controller.pollFast();
    assert.equal(calls.createSession, baseline + 1);
    const a = projects.find(p => p.worldId === 'w-a');
    assert.equal(a.playable, true);
    assert.equal(a.packageRevision, 1);
    assert.equal(a.buildStatus, 'playable');
    assert.deepEqual(a.campaign, { campaignId: 'camp-a', branchId: 'branch-a' });
    assert.equal(timers.size, 0, 'completed projects stop polling');
    await controller.pollFast();
    assert.equal(calls.createSession, baseline + 1, 'no repeated full refresh');
    controller.blur();
  } finally { db.close(); }
});

test('PROJ-closeout Opening published mid-run triggers full refresh without waiting for completion', async () => {
  const { db, library } = projectionFixture();
  try {
    const projects = await library.listProjects({});
    db.prepare(`INSERT INTO world_packages (world_id, revision, status, ruleset_id, ruleset_version, mapping_version,
      source_sha256, content_hash, created_at)
      VALUES ('w-a', 1, 'published', 'shineword', '1', '1', 'sha-1', 'h', ?)`).run(NOW);
    const result = await library.refreshProjectBuildStatusFast(projects);
    assert.equal(result.needsFullRefresh, true);
    assert.equal(result.projects.find(p => p.worldId === 'w-a').buildSummary.dynamicRuns, 1);
  } finally { db.close(); }
});

test('PROJ-closeout poll lifecycle serializes requests and discards responses after blur', async () => {
  const { db, library, refresh } = projectionFixture();
  try {
    let projects = await library.listProjects({});
    let fastCalls = 0, fullCalls = 0, resolveFast;
    const timers = new Map();
    const controller = refresh.createLibraryRefreshController({
      full: async () => { fullCalls++; return projects; },
      fast: async () => { fastCalls++; return new Promise(resolve => { resolveFast = resolve; }); },
      getProjects: () => projects, apply: next => { projects = next; }, onError: e => { throw e; },
      setTimer: cb => { timers.set(1, cb); return 1; }, clearTimer: id => timers.delete(id),
    });
    await controller.focus();
    assert.equal(fullCalls, 1);
    const before = projects;
    const first = controller.pollFast();
    await controller.pollFast();
    assert.equal(fastCalls, 1, 'in-flight fast query cannot overlap');
    const full = controller.refreshFull();
    assert.equal(fullCalls, 1, 'full refresh waits behind fast read');
    controller.blur();
    assert.equal(timers.size, 0, 'blur removes timer immediately');
    resolveFast({ projects: [], needsFullRefresh: true });
    await first; await full;
    assert.strictEqual(projects, before, 'late async response never overwrites projection after blur');
    await controller.pollFast();
    assert.equal(fastCalls, 1, 'unfocused screen cannot poll');
    await controller.focus();
    assert.equal(fullCalls, 2);
    assert.equal(timers.size, 1, 'refocus starts exactly one timer');
    controller.blur();
  } finally { db.close(); }
});
