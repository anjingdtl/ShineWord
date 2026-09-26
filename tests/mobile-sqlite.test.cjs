const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ReactNativeSqliteAdapter,
} = require('../dist/infra/sqlite/reactNativeSqliteAdapter');

function result(rows) {
  return {
    rows: {
      length: rows.length,
      item(index) {
        return rows[index];
      },
    },
  };
}

test('mobile sqlite adapter wraps async domain work in explicit transaction statements', async () => {
  const calls = [];
  const db = {
    async executeSql(sql, params = []) {
      calls.push([sql, params]);
      if (sql.startsWith('SELECT')) return [result([{ value: 7 }])];
      return [result([])];
    },
  };
  const adapter = new ReactNativeSqliteAdapter(db);
  const value = await adapter.transaction(async tx => {
    const row = await tx.queryOne('SELECT value FROM demo');
    await tx.execute('UPDATE demo SET value=?', [8]);
    return row.value;
  });
  assert.equal(value, 7);
  assert.deepEqual(
    calls.map(x => x[0]),
    ['BEGIN IMMEDIATE', 'SELECT value FROM demo', 'UPDATE demo SET value=?', 'COMMIT'],
  );
});

test('mobile sqlite adapter rolls back and serializes overlapping logical transactions', async () => {
  const calls = [];
  let firstRelease;
  const gate = new Promise(resolve => { firstRelease = resolve; });
  const db = {
    async executeSql(sql, params = []) {
      calls.push(sql);
      return [result([])];
    },
  };
  const adapter = new ReactNativeSqliteAdapter(db);

  const first = adapter.transaction(async tx => {
    await tx.execute('FIRST');
    await gate;
  });
  const second = adapter.transaction(async tx => {
    await tx.execute('SECOND');
    throw new Error('boom');
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['BEGIN IMMEDIATE', 'FIRST']);
  firstRelease();
  await first;
  await assert.rejects(second, /boom/);
  assert.deepEqual(
    calls,
    ['BEGIN IMMEDIATE', 'FIRST', 'COMMIT', 'BEGIN IMMEDIATE', 'SECOND', 'ROLLBACK'],
  );
});
