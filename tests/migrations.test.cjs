const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { applySqliteMigrations } = require('../dist/infra/sqlite/migrations');

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
