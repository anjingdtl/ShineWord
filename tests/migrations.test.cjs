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

test('current baseline refuses historical schema 23 without mutation', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES (23); CREATE TABLE old_game(value TEXT); INSERT INTO old_game VALUES ('preserved')");
    const { installBaselineSchema } = require('../dist/application/project/dbBaseline');
    await assert.rejects(() => installBaselineSchema(new NodeSqliteAdapter(db)), /数据基线/);
    assert.equal(db.prepare('SELECT value FROM old_game').get().value, 'preserved');
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='frozen_turn_material_roots'").get().n, 0);
  } finally { db.close(); }
});


test('current baseline refuses historical schema 24 without mutation', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES (24); CREATE TABLE old_game(value TEXT); INSERT INTO old_game VALUES ('preserved')");
    const { installBaselineSchema } = require('../dist/application/project/dbBaseline');
    await assert.rejects(() => installBaselineSchema(new NodeSqliteAdapter(db)), /数据基线/);
    assert.equal(db.prepare('SELECT value FROM old_game').get().value, 'preserved');
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='frozen_turn_material_roots'").get().n, 0);
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

test('current baseline refuses historical schema 25 without mutation', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES (25); CREATE TABLE old_game(value TEXT); INSERT INTO old_game VALUES ('preserved')");
    const { installBaselineSchema } = require('../dist/application/project/dbBaseline');
    await assert.rejects(() => installBaselineSchema(new NodeSqliteAdapter(db)), /数据基线/);
    assert.equal(db.prepare('SELECT value FROM old_game').get().value, 'preserved');
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='frozen_turn_material_roots'").get().n, 0);
  } finally { db.close(); }
});
