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
