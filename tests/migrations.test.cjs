const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');
const { BUILTIN_MIGRATIONS } = require('../dist/infra/sqlite/builtinMigrations');
const { SqliteBuildRunStore } = require('../dist/infra/sqlite/sqliteBuildRunStore');

class NodeSqliteAdapter {
  constructor(db) {
    this.db = db;
  }
  async execute(sql, params = []) {
    if (params.length === 0 && sql.includes(';')) {
      this.db.exec(sql);
      return 0;
    }
    return this.db.prepare(sql).run(...params).changes;
  }
  async queryOne(sql, params = []) {
    return this.db.prepare(sql).get(...params) ?? null;
  }
  async queryAll(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }
  async transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await work(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

test('migration runner applies core schema once and records its version', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const adapter = new NodeSqliteAdapter(db);
    const coreSql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '001_core.sql'),
      'utf8',
    );
    const migrations = [{ version: 1, name: 'core', sql: coreSql }];

    const first = await applySqliteMigrations(
      adapter,
      migrations,
      () => '2026-09-26T00:00:00.000Z',
    );
    const second = await applySqliteMigrations(
      adapter,
      migrations,
      () => '2026-09-26T00:00:01.000Z',
    );

    assert.deepEqual(first, [1]);
    assert.deepEqual(second, []);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
      1,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='turns'")
        .get().count,
      1,
    );
  } finally {
    db.close();
  }
});

test('failed migration rolls back its schema changes and version row', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const adapter = new NodeSqliteAdapter(db);
    await assert.rejects(
      applySqliteMigrations(adapter, [
        {
          version: 1,
          name: 'broken',
          sql: 'CREATE TABLE should_rollback (id INTEGER); INSERT INTO missing_table VALUES (1);',
        },
      ]),
    );

    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='should_rollback'")
        .get().count,
      0,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test('migration runner rejects duplicate or out-of-order versions', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const adapter = new NodeSqliteAdapter(db);
    await assert.rejects(
      applySqliteMigrations(adapter, [
        { version: 2, name: 'second', sql: 'SELECT 1;' },
        { version: 1, name: 'first', sql: 'SELECT 1;' },
      ]),
      /strictly increasing/,
    );
  } finally {
    db.close();
  }
});

function populateLegacyBuilds(db) {
  const now = '2026-09-29T00:00:00.000Z';
  db.prepare(`INSERT INTO imported_sources
    (source_id, raw_sha256, normalized_tree_hash, normalize_tree_hash_version, byte_length,
     code_point_count, encoding, normalize_version, chapter_split_version, normalize_shard_scheme,
     split_strategy, status, created_at, updated_at)
    VALUES ('source-old', 'hash', 'tree', 'v1', 100, 100, 'utf-8', 'n1', 'c1', 's1', 'standard', 'active', ?, ?)`)
    .run(now, now);
  const runInsert = db.prepare(`INSERT INTO world_build_runs
    (run_id, world_id, source_id, source_snapshot_hash, pipeline_version, plan_version,
     model_fingerprint, phase, status, units_total, units_done, units_failed, lease_owner,
     lease_expires_at, fencing_token, heartbeat_at, last_error_code, last_error_message,
     created_at, updated_at, config_json, plan_state_json, scope_json, pause_requested, cancel_requested)
    VALUES (?, 'world-old', 'source-old', 'snapshot', 'pipeline', 'plan', 'model', 'extracting', ?,
      69, ?, ?, 'legacy-owner', '2026-09-29T00:02:00.000Z', 42, ?, 'old-error', 'old message', ?, ?,
      '{"frozen":true}', '{"planned":true}', '{"startCp":0,"endCp":100}', 1, 1)`);
  const unitInsert = db.prepare(`INSERT INTO world_build_units
    (unit_id, run_id, kind, source_ranges_json, input_hash, config_fingerprint, parent_unit_id,
     ord, status, attempt, retry_at, result_ref, usage_json, error_code, error_message, created_at, updated_at)
    VALUES (?, ?, 'extract_group', '[]', ?, 'frozen-config', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [id, status, done, failures] of [
    ['A', 'running', 2, 176], ['B', 'paused_user', 10, 3],
    ['C', 'canceled', 2, 6], ['D', 'failed_retryable', 5, 12],
  ]) {
    runInsert.run(id, status, done, failures, now, now, now);
    for (let i = 0; i < 69; i += 1) {
      const state = i < done ? 'completed' : ['queued', 'running', 'failed_retryable', 'needs_review', 'canceled', 'canceled'][i - done] ?? 'queued';
      const neverAttempted = i === done + 4 || state === 'queued';
      const attempt = neverAttempted ? 0 : i < done ? 2 : 3;
      const usage = neverAttempted ? null : '{"outputTokens":100,"reasoningTokens":10}';
      const result = state === 'completed' || i === done + 5 ? `result-${id}-${i}` : null;
      unitInsert.run(`${id}-${i}`, id, `input-${id}-${i}`, i > 0 ? `${id}-0` : null,
        i, state, attempt, state === 'failed_retryable' ? now : null, result, usage,
        state === 'failed_retryable' ? 'network' : null, state === 'failed_retryable' ? 'old failure' : null, now, now);
    }
  }
  // A truncation-replaced parent is structural history, not unfinished work.
  db.exec(`UPDATE world_build_units SET status = 'canceled', attempt = 3
    WHERE unit_id = 'C-20';
    UPDATE world_build_units SET parent_unit_id = 'C-20' WHERE unit_id IN ('C-21', 'C-22');`);
  // A fully consumed legacy canceled run is deliberately not made runnable.
  runInsert.run('E', 'canceled', 69, 0, now, now, now);
}

test('populated v23 -> v24 preserves every build field, counters, commits, fencing and FK integrity', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const adapter = new NodeSqliteAdapter(db);
    const v23 = BUILTIN_MIGRATIONS.filter(m => m.version <= 23);
    await applySqliteMigrations(adapter, v23);
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 23);
    populateLegacyBuilds(db);
    const oldRuns = db.prepare('SELECT * FROM world_build_runs ORDER BY run_id').all();
    const oldUnits = db.prepare('SELECT * FROM world_build_units ORDER BY unit_id').all();
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    // ONLY v24 runs; this is not an empty/new-schema test.
    assert.deepEqual(await applySqliteMigrations(adapter, [BUILTIN_MIGRATIONS.find(m => m.version === 24)]), [24]);
    const runs = db.prepare('SELECT * FROM world_build_runs ORDER BY run_id').all();
    const units = db.prepare('SELECT * FROM world_build_units ORDER BY unit_id').all();
    assert.equal(runs.length, oldRuns.length);
    assert.equal(units.length, oldUnits.length);
    for (let i = 0; i < runs.length; i += 1) {
      const expected = { ...oldRuns[i] };
      if (expected.run_id === 'C') Object.assign(expected, { status: 'stopped_user', pause_requested: 0, cancel_requested: 0 });
      assert.deepEqual({ ...runs[i] }, expected, `all fields for run ${expected.run_id}`);
    }
    for (let i = 0; i < units.length; i += 1) {
      const expected = { ...oldUnits[i] };
      if (expected.run_id === 'C' && expected.status === 'canceled'
        && !oldUnits.some(child => child.parent_unit_id === expected.unit_id)) {
        expected.status = expected.attempt === 0 && expected.result_ref === null && expected.usage_json === null
          ? 'queued' : 'needs_review';
      }
      assert.deepEqual({ ...units[i] }, expected, `all fields for unit ${expected.unit_id}`);
    }
    const store = new SqliteBuildRunStore(adapter);
    assert.ok((await store.listResumableRuns()).some(r => r.runId === 'C' && r.status === 'stopped_user'));
    assert.equal((await store.getRun('A')).unitsFailed, 176);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM world_build_units WHERE run_id = 'A' AND status = 'failed_retryable'`).get().n, 1);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    // New constraints/indexes and parent FK enforcement remain functional.
    assert.throws(() => db.exec(`UPDATE world_build_units SET run_id = 'missing' WHERE unit_id = 'A-0'`), /FOREIGN KEY/);
    assert.equal(await store.acquireLease('C', 'new-executor', 60_000, '2026-09-30T00:00:00.000Z'), 43);
    assert.equal(db.prepare(`SELECT attempt FROM world_build_units WHERE unit_id = 'C-0'`).get().attempt, 2);
  } finally { db.close(); }
});

test('v25 also repairs legacy canceled builds on clients which already applied v24', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const adapter = new NodeSqliteAdapter(db);
    await applySqliteMigrations(adapter, BUILTIN_MIGRATIONS.filter(m => m.version <= 24));
    populateLegacyBuilds(db); // Old v24 allowed these rows without converting them.
    const throughV25 = BUILTIN_MIGRATIONS.filter(m => m.version <= 25);
    assert.deepEqual(await applySqliteMigrations(adapter, throughV25), [25]);
    assert.equal((await new SqliteBuildRunStore(adapter).getRun('C')).status, 'stopped_user');
    assert.equal(db.prepare(`SELECT status FROM world_build_units WHERE unit_id = 'C-0'`).get().status, 'completed');
    assert.equal(db.prepare(`SELECT status FROM world_build_units WHERE unit_id = 'C-6'`).get().status, 'queued');
    assert.equal(db.prepare(`SELECT status FROM world_build_units WHERE unit_id = 'C-7'`).get().status, 'needs_review');
    assert.equal(db.prepare(`SELECT status FROM world_build_units WHERE unit_id = 'C-20'`).get().status, 'canceled');
    assert.deepEqual(await applySqliteMigrations(adapter, throughV25), []);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('a rebuild with FK violations rolls back and restores foreign_keys=ON', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const adapter = new NodeSqliteAdapter(db);
    db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (parent_id INTEGER REFERENCES parent(id));');
    await assert.rejects(applySqliteMigrations(adapter, [{ version: 1, name: 'bad-rebuild', foreignKeys: 'off',
      sql: 'INSERT INTO child VALUES (404);',
    }]), /foreign key integrity/);
    assert.deepEqual(db.prepare('SELECT * FROM child').all(), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 0);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally { db.close(); }
});

test('phase6 schema 28/29/30 upgrade preserves populated interaction operations and prepared/committed steps', async () => {
  for (const baseline of [28,29,30]) {
    const db=new DatabaseSync(':memory:');try {
      const adapter=new NodeSqliteAdapter(db);await applySqliteMigrations(adapter,BUILTIN_MIGRATIONS.filter(m=>m.version<=baseline));
      db.exec(`INSERT INTO worlds (world_id,title,source_sha256,source_bytes,normalize_version,chapter_split_version,build_status,created_at,updated_at) VALUES ('w','旧世界','hash',100,'n','c','ready','now','now');
        INSERT INTO campaigns (campaign_id,world_id,title,ruleset_id,ruleset_version,world_mapping_version,opening_json,created_at) VALUES ('c','w','旧战役','shineword','1','old','{}','now');
        INSERT INTO branches (branch_id,campaign_id,state_version,created_at) VALUES ('b','c',3,'now');
        INSERT INTO interaction_operations VALUES ('old-op','c','b','encounter_auto','paused_system',2,8,1,8,'now','now');
        INSERT INTO interaction_operation_steps VALUES ('old-op',0,'npc_turn','paid-old-0',1,2,'committed','now','now');
        INSERT INTO interaction_operation_steps VALUES ('old-op',1,'npc_turn','paid-old-1',2,NULL,'prepared','now','now');`);
      const before=db.prepare('SELECT * FROM interaction_operations').all(), steps=db.prepare('SELECT * FROM interaction_operation_steps ORDER BY step_index').all();
      assert.deepEqual(await applySqliteMigrations(adapter,BUILTIN_MIGRATIONS),Array.from({length:31-baseline},(_,i)=>baseline+i+1));
      assert.deepEqual(db.prepare('SELECT * FROM interaction_operations').all(),before);assert.deepEqual(db.prepare('SELECT * FROM interaction_operation_steps ORDER BY step_index').all(),steps);
      assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
      db.exec(`INSERT INTO interaction_operations VALUES ('new-turn','c','b','play_turn','running',3,9,0,1,'now','now')`);
      assert.throws(()=>db.exec(`INSERT INTO interaction_operations VALUES ('other-turn','c','b','play_turn','running',3,10,0,1,'now','now')`),/UNIQUE/);
    }finally{db.close()}
  }
});
