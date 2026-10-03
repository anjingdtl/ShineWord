// Real-device stability regression suite (P0-2 / P1-5 / §4):
//
// - runner error persistence: headless bootstrap exceptions are classified
//   and persisted as failed_retryable, never silently swallowed; already
//   classified runs are never overwritten; texts are sanitized
// - foreground-service watchdog: no evidence -> inline fallback; evidence in
//   time -> no fallback; failed service start -> inline immediately
// - task observability: live per-unit counters replace the misleading
//   cumulative failure counter (69 units / 176 attempts must show 3 retryable)
// - library polling decision: dynamic lists poll, static lists stop
//
// Mobile sources are transpiled in-place (profile-store.test.cjs pattern)
// with node:sqlite backing the mocked database bridge.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteBuildRunStore } = require('../dist/infra/sqlite/sqliteBuildRunStore');
const { SqliteLlmLedgerStore } = require('../dist/infra/sqlite/sqliteLlmLedgerStore');

class NodeSqliteAdapter {
  constructor(db) {
    this.db = db;
    this.chain = Promise.resolve();
  }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) { this.db.exec(sql); return 0; }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async queryAll(sql, params = []) { return this.db.prepare(sql).all(...params); }
  transaction(work) {
    const run = () => {
      this.db.exec('BEGIN IMMEDIATE');
      return work(this).then(
        value => { this.db.exec('COMMIT'); return value; },
        error => { this.db.exec('ROLLBACK'); throw error; },
      );
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
}

function setupDb() {
  const db = new DatabaseSync(':memory:');
  for (const migration of BUILTIN_MIGRATIONS) {
    for (const statement of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

/** Transpiles a mobile TS module with per-request require interception. */
function loadMobileModule(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const mobileModule = new Module(filename, module);
  mobileModule.filename = filename;
  mobileModule.paths = Module._nodeModulePaths(path.dirname(filename));
  const nativeRequire = mobileModule.require.bind(mobileModule);
  mobileModule.require = request => {
    for (const [prefix, replacement] of Object.entries(mocks)) {
      if (request === prefix || request.endsWith(prefix)) return replacement;
    }
    const distMatch = request.match(/^(?:\.\.\/)+src\/(.+)$/);
    if (distMatch) return require(path.join('../dist', distMatch[1]));
    return nativeRequire(request);
  };
  mobileModule._compile(compiled, filename);
  return mobileModule.exports;
}

function makeRuntime(adapter) {
  return { db: adapter, worldStore: null, llmLedger: new SqliteLlmLedgerStore(adapter) };
}

function insertSource(db, sourceId, fileName) {
  const now = '2026-09-30T08:00:00.000Z';
  db.prepare(
    `INSERT INTO imported_sources
       (source_id, raw_sha256, normalized_tree_hash, normalize_tree_hash_version, byte_length,
        code_point_count, encoding, normalize_version, chapter_split_version, normalize_shard_scheme,
        split_strategy, file_name, title, status, created_at, updated_at)
     VALUES (?, ?, 'tree', 'v', 1, 1, 'utf-8', 'n', 'c', 's', 'standard', ?, NULL, 'active', ?, ?)`,
  ).run(sourceId, `raw-${sourceId}`, fileName, now, now);
}

function insertRun(db, runId, sourceId, { status = 'queued', unitsTotal = 1, unitsDone = 0, unitsFailed = 0 } = {}) {
  const now = '2026-09-30T08:00:00.000Z';
  db.prepare(
    `INSERT INTO world_build_runs
       (run_id, world_id, source_id, source_snapshot_hash, pipeline_version, plan_version,
        model_fingerprint, phase, status, units_total, units_done, units_failed, fencing_token,
        created_at, updated_at)
     VALUES (?, 'w-1', ?, 'h', 'p', 'pl', 'm', 'extracting', ?, ?, ?, ?, 0, ?, ?)`,
  ).run(runId, sourceId, status, unitsTotal, unitsDone, unitsFailed, now, now);
}

function insertUnit(db, unitId, runId, { status = 'queued', attempt = 0, ord = 0 } = {}) {
  const now = '2026-09-30T08:00:00.000Z';
  db.prepare(
    `INSERT INTO world_build_units
       (unit_id, run_id, kind, source_ranges_json, input_hash, config_fingerprint, ord, status,
        attempt, created_at, updated_at)
     VALUES (?, ?, 'extract_group', '[]', ?, 'cf', ?, ?, ?, ?, ?)`,
  ).run(unitId, runId, `h-${unitId}`, ord, status, attempt, now, now);
}

// ---------------------------------------------------------------------------
// P0-2.1 runner error persistence
// ---------------------------------------------------------------------------

const runnerMocks = {
  './profileStore': { loadApiProfile: async () => null },
  './sourceImport': { runExtraction: async () => { throw new Error('should not run'); } },
  './buildServiceBridge': {
    startBuildService: async () => true,
    notifyBuildProgress: async () => true,
    requestRunControl: async () => true,
  },
  './database': { getDatabaseRuntime: async () => { throw new Error('no db in this test'); } },
};

test('classifyRunnerError maps bootstrap failures to the persisted taxonomy and redacts keys', () => {
  const runner = loadMobileModule('mobile/src/buildRunner.ts', runnerMocks);
  assert.equal(
    runner.classifyRunnerError(new Error('Keychain is locked')).code, 'keychain_unavailable');
  assert.equal(
    runner.classifyRunnerError(new Error('LLM API key is missing from secure storage.')).code,
    'keychain_unavailable');
  assert.equal(
    runner.classifyRunnerError(new Error('HTTP 401 unauthorized')).code, 'provider_config_error');
  assert.equal(
    runner.classifyRunnerError(new Error('fetch failed: network unreachable')).code, 'network_error');
  assert.equal(
    runner.classifyRunnerError(new Error('boom at frozen config revive')).code, 'runner_execution_failed');
  const sanitized = runner.classifyRunnerError(
    new Error(`request failed with sk-abcdefghijklmnop and Bearer abc.def.ghi`));
  assert.ok(!sanitized.message.includes('sk-abcdefghijklmnop'), 'credential-like text is redacted');
  assert.ok(!sanitized.message.includes('abc.def.ghi'), 'bearer tokens are redacted');
});

test('persistRunnerFailure: running run -> failed_retryable; classified run untouched', async () => {
  const runner = loadMobileModule('mobile/src/buildRunner.ts', runnerMocks);
  const db = setupDb();
  try {
    insertSource(db, 'src-a', 'a.txt');
    insertRun(db, 'run-a', 'src-a', { status: 'running' });
    const store = new SqliteBuildRunStore(new NodeSqliteAdapter(db));
    const applied = await runner.persistRunnerFailure(store, 'run-a', new Error('network down: fetch failed'));
    assert.equal(applied, 'network_error');
    const run = await store.getRun('run-a');
    assert.equal(run.status, 'failed_retryable', 'a crashed executor never keeps pretending running');
    assert.equal(run.lastErrorCode, 'network_error');
    assert.ok(run.lastErrorMessage.includes('network'));

    // A run the coordinator already classified keeps its more specific state.
    insertRun(db, 'run-b', 'src-a', { status: 'needs_review' });
    const untouched = await runner.persistRunnerFailure(store, 'run-b', new Error('late crash'));
    assert.equal(untouched, null);
    assert.equal((await store.getRun('run-b')).status, 'needs_review');

    // Unknown run: nothing to do, no throw.
    assert.equal(await runner.persistRunnerFailure(store, 'run-nope', new Error('x')), null);
  } finally {
    db.close();
  }
});

test('worldBuildRunner leaves a legacy no-credential run as waiting_unlock (visible, resumable)', async () => {
  const db = setupDb();
  const adapter = new NodeSqliteAdapter(db);
  insertSource(db, 'src-b', 'b.txt');
  insertRun(db, 'run-legacy', 'src-b', { status: 'running' });
  const runner = loadMobileModule('mobile/src/buildRunner.ts', {
    ...runnerMocks,
    './database': { getDatabaseRuntime: async () => makeRuntime(adapter) },
  });
  await runner.worldBuildRunner({ runId: 'run-legacy' });
  const store = new SqliteBuildRunStore(adapter);
  const run = await store.getRun('run-legacy');
  assert.equal(run.status, 'waiting_unlock');
  assert.equal(run.lastErrorCode, 'keychain_unavailable');
});

// ---------------------------------------------------------------------------
// P0-2.2 foreground-service startup watchdog
// ---------------------------------------------------------------------------

function loadWatchdog({ serviceResult, runtime, onService = () => undefined, active = false }) {
  const extractionCalls = [];
  const serviceCalls = [];
  return {
    extractionCalls,
    serviceCalls,
    api: loadMobileModule('mobile/src/buildWatchdog.ts', {
      './database': { getDatabaseRuntime: async () => runtime },
      './buildServiceBridge': { startBuildService: async runId => {
        serviceCalls.push(runId);
        await onService(runId);
        return serviceResult;
      } },
      './sourceImport': {
        isRunActive: () => active,
        resumeRun: async () => ({ activeInProcess: active }),
        runExtraction: async (runId, profile, onProgress) => {
          extractionCalls.push(runId);
          return { completed: true, unitsDone: 1, unitsTotal: 1, unitsFailed: 0 };
        },
      },
    }),
  };
}

test('watchdog: service started and execution evidence appears -> no inline fallback', async () => {
  const db = setupDb();
  try {
    insertSource(db, 'src-w1', 'w1.txt');
    insertRun(db, 'run-w1', 'src-w1', { status: 'running' });
    const { api, extractionCalls } = loadWatchdog({
      serviceResult: true,
      runtime: makeRuntime(new NodeSqliteAdapter(db)),
      onService: () => db.prepare(`UPDATE world_build_runs SET lease_owner = 'new-headless',
        lease_expires_at = ?, heartbeat_at = ? WHERE run_id = 'run-w1'`)
        .run(new Date(Date.now() + 60_000).toISOString(), new Date().toISOString()),
    });
    const outcome = await api.startBuildWithWatchdog('run-w1', null, { evidencePollMs: 10, evidenceTimeoutMs: 500 });
    assert.equal(outcome, 'service');
    assert.equal(extractionCalls.length, 0, 'background executor confirmed - no duplicate inline run');
  } finally {
    db.close();
  }
});

test('watchdog: service returns true but nothing executes -> inline fallback fires', async () => {
  const db = setupDb();
  try {
    insertSource(db, 'src-w2', 'w2.txt');
    insertRun(db, 'run-w2', 'src-w2', { status: 'queued' }); // stays queued: headless task never woke
    const { api, extractionCalls } = loadWatchdog({
      serviceResult: true,
      runtime: makeRuntime(new NodeSqliteAdapter(db)),
    });
    const outcome = await api.startBuildWithWatchdog('run-w2', null, { evidencePollMs: 10, evidenceTimeoutMs: 60 });
    assert.equal(outcome, 'inline');
    assert.deepEqual(extractionCalls, ['run-w2'], 'inline execution rescues the stalled run');
  } finally {
    db.close();
  }
});

test('watchdog: service start fails -> inline immediately, no evidence wait', async () => {
  const db = setupDb();
  try {
    insertSource(db, 'src-w3', 'w3.txt');
    insertRun(db, 'run-w3', 'src-w3', { status: 'queued' });
    const { api, extractionCalls } = loadWatchdog({
      serviceResult: false,
      runtime: makeRuntime(new NodeSqliteAdapter(db)),
    });
    const startedAt = Date.now();
    const outcome = await api.startBuildWithWatchdog('run-w3', null, { evidencePollMs: 10, evidenceTimeoutMs: 5_000 });
    assert.equal(outcome, 'inline');
    assert.deepEqual(extractionCalls, ['run-w3']);
    assert.ok(Date.now() - startedAt < 1_000, 'no timeout window is paid when the service refused');
  } finally {
    db.close();
  }
});

test('watchdog: slow background start (evidence within the window) is NOT duplicated inline', async () => {
  const db = setupDb();
  try {
    insertSource(db, 'src-w4', 'w4.txt');
    insertRun(db, 'run-w4', 'src-w4', { status: 'queued' });
    const adapter = new NodeSqliteAdapter(db);
    const store = new SqliteBuildRunStore(adapter);
    // The background executor acquires its lease ~40ms in.
    setTimeout(() => { void store.acquireLease('run-w4', 'headless', 60_000, new Date().toISOString()); }, 40);
    const { api, extractionCalls } = loadWatchdog({
      serviceResult: true,
      runtime: makeRuntime(adapter),
    });
    const outcome = await api.startBuildWithWatchdog('run-w4', null, { evidencePollMs: 15, evidenceTimeoutMs: 1_500 });
    assert.equal(outcome, 'service');
    assert.equal(extractionCalls.length, 0, 'a real executor appeared in time - inline stays off');
  } finally {
    db.close();
  }
});

test('watchdog: historical unit activity MUST NOT count as fresh execution evidence', async () => {
  const db = setupDb();
  try {
    insertSource(db, 'src-w5', 'w5.txt');
    insertRun(db, 'run-w5', 'src-w5', { status: 'queued' });
    // No lease and status still queued, but one unit was already attempted.
    insertUnit(db, 'u-w5', 'run-w5', { status: 'failed_retryable', attempt: 2 });
    const { api, extractionCalls } = loadWatchdog({
      serviceResult: true,
      runtime: makeRuntime(new NodeSqliteAdapter(db)),
    });
    const outcome = await api.startBuildWithWatchdog('run-w5', null, { evidencePollMs: 5, evidenceTimeoutMs: 25 });
    assert.equal(outcome, 'inline');
    assert.deepEqual(extractionCalls, ['run-w5']);
  } finally {
    db.close();
  }
});

for (const stale of ['expired lease and running status', 'stale running unit', 'unchanged live lease', 'control-only update']) {
  test(`watchdog: ${stale} does not prove this startup`, async () => {
    const db = setupDb();
    try {
      insertSource(db, 's', 'test.txt');
      insertRun(db, 'r', 's', { status: 'running' });
      insertUnit(db, 'u', 'r', { status: 'running', attempt: 3 });
      const expiry = new Date(Date.now() + (stale === 'unchanged live lease' ? 60_000 : -60_000)).toISOString();
      db.prepare(`UPDATE world_build_runs SET lease_owner = 'old', lease_expires_at = ?,
        heartbeat_at = '2020-01-01T00:00:00.000Z' WHERE run_id = 'r'`).run(expiry);
      const { api, extractionCalls } = loadWatchdog({ serviceResult: true,
        runtime: makeRuntime(new NodeSqliteAdapter(db)),
        onService: () => {
          if (stale === 'control-only update') db.prepare(`UPDATE world_build_runs
            SET updated_at = ?, pause_requested = 0 WHERE run_id = 'r'`).run(new Date().toISOString());
        },
      });
      assert.equal(await api.startBuildWithWatchdog('r', null, { evidencePollMs: 5, evidenceTimeoutMs: 20 }), 'inline');
      assert.deepEqual(extractionCalls, ['r']);
    } finally { db.close(); }
  });
}

for (const fresh of ['lease owner', 'lease renewal', 'heartbeat', 'attempt total', 'unit timestamp']) {
  test(`watchdog: fresh ${fresh} confirms the service`, async () => {
    const db = setupDb();
    try {
      insertSource(db, 's', 'test.txt');
      insertRun(db, 'r', 's', { status: 'running' });
      insertUnit(db, 'u', 'r', { status: 'failed_retryable', attempt: 2 });
      db.prepare(`UPDATE world_build_runs SET lease_owner = 'old', lease_expires_at = ?,
        heartbeat_at = '2020-01-01T00:00:00.000Z' WHERE run_id = 'r'`)
        .run(new Date(Date.now() + 30_000).toISOString());
      const { api, extractionCalls } = loadWatchdog({ serviceResult: true,
        runtime: makeRuntime(new NodeSqliteAdapter(db)), onService: () => {
          const now = new Date().toISOString();
          if (fresh === 'lease owner') db.exec(`UPDATE world_build_runs SET lease_owner = 'new' WHERE run_id = 'r'`);
          if (fresh === 'lease renewal') db.prepare(`UPDATE world_build_runs SET lease_expires_at = ? WHERE run_id = 'r'`)
            .run(new Date(Date.now() + 60_000).toISOString());
          if (fresh === 'heartbeat') db.prepare(`UPDATE world_build_runs SET heartbeat_at = ? WHERE run_id = 'r'`).run(now);
          // Same attempted-unit count, but a new physical attempt: SUM(attempt), not COUNT(attempt > 0).
          if (fresh === 'attempt total') db.exec(`UPDATE world_build_units SET attempt = 3 WHERE unit_id = 'u'`);
          if (fresh === 'unit timestamp') db.prepare(`UPDATE world_build_units SET updated_at = ? WHERE unit_id = 'u'`).run(now);
        },
      });
      assert.equal(await api.startBuildWithWatchdog('r', null, { evidencePollMs: 5, evidenceTimeoutMs: 50 }), 'service');
      assert.equal(extractionCalls.length, 0);
    } finally { db.close(); }
  });
}

for (const fresh of [false, true]) {
  test(`app recovery: historical attempts and ${fresh ? 'fresh heartbeat confirm Headless' : 'no new evidence fall back inline'}`, async () => {
    const db = setupDb();
    try {
      insertSource(db, 's', 'test.txt');
      insertRun(db, 'r', 's', { status: 'running', unitsDone: 2, unitsTotal: 69 });
      insertUnit(db, 'u', 'r', { status: 'completed', attempt: 2 });
      const { api, extractionCalls } = loadWatchdog({ serviceResult: true,
        runtime: makeRuntime(new NodeSqliteAdapter(db)), onService: () => {
          if (fresh) db.prepare(`UPDATE world_build_runs SET heartbeat_at = ? WHERE run_id = 'r'`).run(new Date().toISOString());
        },
      });
      await api.recoverBuildTasks([{ runId: 'r', status: 'running', leaseHeld: false,
        pauseRequested: false, cancelRequested: false }], null, { evidencePollMs: 5, evidenceTimeoutMs: 25 });
      assert.deepEqual(extractionCalls, fresh ? [] : ['r']);
    } finally { db.close(); }
  });
}

test('recovery respects user intent; pause revocation with an active executor never starts another', async () => {
  const { api, serviceCalls, extractionCalls } = loadWatchdog({ serviceResult: true, runtime: null, active: true });
  assert.equal(await api.startOrResumeBuild('r', null, { resume: true }), 'active');
  await api.recoverBuildTasks(['paused_user', 'stopped_user', 'needs_review', 'running'].map(status => ({
    runId: status, status, leaseHeld: false, pauseRequested: status === 'running', cancelRequested: false,
  })), null);
  assert.deepEqual(serviceCalls, []);
  assert.deepEqual(extractionCalls, []);
});

test('watchdog: a user stop during the startup window cancels the pending fallback', async () => {
  const db = setupDb();
  try {
    insertSource(db, 's', 'test.txt');
    insertRun(db, 'r', 's', { status: 'queued' });
    const { api, extractionCalls } = loadWatchdog({ serviceResult: true,
      runtime: makeRuntime(new NodeSqliteAdapter(db)), onService: () => {
        db.exec("UPDATE world_build_runs SET status = 'stopped_user', cancel_requested = 0 WHERE run_id = 'r'");
      },
    });
    assert.equal(await api.startBuildWithWatchdog('r', null, { evidencePollMs: 5, evidenceTimeoutMs: 25 }), 'inactive');
    assert.deepEqual(extractionCalls, []);
  } finally { db.close(); }
});

// ---------------------------------------------------------------------------
// P1-5 counter semantics + task observability + poll decision
// ---------------------------------------------------------------------------

function loadBuildTasks(runtime) {
  return loadMobileModule('mobile/src/buildTasks.ts', {
    './database': { getDatabaseRuntime: async () => runtime },
  });
}

test('one unit failing 10 times: failureAttempts=10 but unitsRetryable=1 (never 176 待重试)', async () => {
  const db = setupDb();
  try {
    insertSource(db, 'src-c', 'c.txt');
    insertRun(db, 'run-c', 'src-c', { status: 'running', unitsTotal: 69, unitsDone: 2, unitsFailed: 176 });
    for (let i = 1; i <= 2; i += 1) insertUnit(db, `u-c-done-${i}`, 'run-c', { status: 'completed', ord: i - 1 });
    insertUnit(db, 'u-c-run-1', 'run-c', { status: 'running', attempt: 1, ord: 2 });
    insertUnit(db, 'u-c-run-2', 'run-c', { status: 'running', attempt: 1, ord: 3 });
    insertUnit(db, 'u-c-run-3', 'run-c', { status: 'running', attempt: 1, ord: 4 });
    // 61 queued -> but 3 of the "queue" are failed_retryable instead (2+3+3+61=69).
    for (let i = 1; i <= 61; i += 1) insertUnit(db, `u-c-q-${i}`, 'run-c', { status: 'queued', ord: 4 + i });
    for (let i = 1; i <= 3; i += 1) {
      insertUnit(db, `u-c-retry-${i}`, 'run-c', {
        status: 'failed_retryable', attempt: i === 1 ? 10 : 1, ord: 70 + i,
      });
    }
    const tasksApi = loadBuildTasks(makeRuntime(new NodeSqliteAdapter(db)));
    const tasks = await tasksApi.listOpenBuildTasks();
    assert.equal(tasks.length, 1);
    const task = tasks[0];
    assert.equal(task.unitsDone, 2);
    assert.equal(task.unitsTotal, 69);
    assert.equal(task.unitsFailed, 176, 'cumulative failed ATTEMPTS preserved as history');
    assert.equal(task.unitsRetryable, 3, 'current retryable units derive live from unit rows');
    assert.ok(task.unitsRetryable <= task.unitsTotal, 'retryable can never exceed the total');
    assert.equal(task.unitsRunning, 3);
    assert.equal(task.unitsQueued, 61);
    assert.equal(task.currentAttempt, 10, 'max live attempt surfaces for the detail view');

    const line = tasksApi.taskProgressLine(task);
    assert.ok(line.includes('2/69'), line);
    assert.ok(line.includes('待重试 3'), line);
    assert.ok(!line.includes('176'), 'the historical attempt counter must not render as pending retries');

    const activity = tasksApi.taskActivityLine(task);
    assert.ok(activity.includes('正在等待模型响应'), activity);
    assert.ok(activity.includes('第 10 次尝试'), activity);

    assert.equal(tasksApi.taskStatusLabel(task), '进行中');
  } finally {
    db.close();
  }
});

test('pause/stop request states surface in the headline label', async () => {
  const db = setupDb();
  try {
    insertSource(db, 'src-d', 'd.txt');
    insertRun(db, 'run-d1', 'src-d', { status: 'running' });
    insertRun(db, 'run-d2', 'src-d', { status: 'running' });
    insertRun(db, 'run-d3', 'src-d', { status: 'stopped_user' });
    db.prepare("UPDATE world_build_runs SET pause_requested = 1 WHERE run_id = 'run-d1'").run();
    db.prepare("UPDATE world_build_runs SET cancel_requested = 1 WHERE run_id = 'run-d2'").run();
    const tasksApi = loadBuildTasks(makeRuntime(new NodeSqliteAdapter(db)));
    const tasks = await tasksApi.listOpenBuildTasks();
    const byId = new Map(tasks.map(task => [task.runId, task]));
    assert.equal(tasksApi.taskStatusLabel(byId.get('run-d1')), '暂停请求中');
    assert.equal(byId.get('run-d1').pauseRequested, true);
    assert.equal(tasksApi.taskStatusLabel(byId.get('run-d2')), '停止请求中');
    assert.equal(tasksApi.taskStatusLabel(byId.get('run-d3')), '已停止');
  } finally {
    db.close();
  }
});

test('poll decision: dynamic tasks poll; static lists stop; request flags count as dynamic', () => {
  const buildTasks = loadBuildTasks(makeRuntime(null));
  const base = {
    runId: 'r', worldId: 'w', title: 't', fileName: null, phase: 'extracting',
    unitsDone: 0, unitsTotal: 1, unitsFailed: 0,
    unitsRunning: 0, unitsQueued: 0, unitsRetryable: 0, unitsNeedsReview: 0,
    unitsFailedTerminal: 0, currentAttempt: 0, lastActivityAt: '', lastErrorCode: null,
    lastErrorMessage: null, updatedAt: '', leaseHeld: false,
    pauseRequested: false, cancelRequested: false,
  };
  const make = overrides => ({ ...base, ...overrides });
  assert.equal(buildTasks.isTaskListDynamic([make({ status: 'running' })]), true);
  assert.equal(buildTasks.isTaskListDynamic([make({ status: 'queued' })]), true);
  assert.equal(buildTasks.isTaskListDynamic([make({ status: 'failed_retryable' })]), true);
  assert.equal(buildTasks.isTaskListDynamic([make({ status: 'waiting_network' })]), true);
  assert.equal(buildTasks.isTaskListDynamic([make({ status: 'waiting_unlock' })]), true);
  assert.equal(buildTasks.isTaskListDynamic([make({ status: 'running', pauseRequested: true })]), true);
  assert.equal(buildTasks.isTaskListDynamic([make({ status: 'running', cancelRequested: true })]), true);
  assert.equal(buildTasks.isTaskListDynamic([make({ status: 'paused_user' })]), false, 'static - timer stops');
  assert.equal(buildTasks.isTaskListDynamic([make({ status: 'stopped_user' })]), false, 'static - timer stops');
  assert.equal(buildTasks.isTaskListDynamic([make({ status: 'needs_review' })]), false, 'static - timer stops');
  assert.equal(buildTasks.isTaskListDynamic([]), false);
});

test('store-level counter semantics: completeUnit(failed_retryable) x10 stays ONE retryable unit', async () => {
  const db = setupDb();
  try {
    insertSource(db, 'src-e', 'e.txt');
    insertRun(db, 'run-e', 'src-e', { status: 'running', unitsTotal: 1 });
    insertUnit(db, 'u-e', 'run-e', { status: 'queued' });
    const adapter = new NodeSqliteAdapter(db);
    const store = new SqliteBuildRunStore(adapter);
    const token = await store.acquireLease('run-e', 'owner', 60_000, new Date().toISOString());
    for (let round = 1; round <= 10; round += 1) {
      await store.claimUnit('u-e', new Date().toISOString());
      await store.completeUnit({
        unitId: 'u-e', fencingToken: token, status: 'failed_retryable',
        errorCode: 'network', errorMessage: 'boom', now: new Date().toISOString(),
      });
    }
    const run = await store.getRun('run-e');
    assert.equal(run.unitsFailed, 10, 'cumulative attempt counter keeps growing (history)');
    const retryableRows = (await adapter.queryAll(
      "SELECT COUNT(*) AS c FROM world_build_units WHERE run_id = 'run-e' AND status IN ('failed_retryable', 'waiting_network')",
    ))[0].c;
    assert.equal(retryableRows, 1, 'the SAME unit is still exactly one retryable row');
  } finally {
    db.close();
  }
});
