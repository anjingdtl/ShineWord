const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NativeSecureRandomByteSource,
} = require('../dist/platform/random/nativeSecureRandom');
const {
  ReactNativeSqliteAdapter,
} = require('../dist/infra/sqlite/reactNativeSqliteAdapter');

test('native secure random adapter validates bytes', () => {
  const source = new NativeSecureRandomByteSource({ nextByte: () => 255 });
  assert.equal(source.nextByte(), 255);
  assert.throws(
    () => new NativeSecureRandomByteSource({ nextByte: () => 256 }).nextByte(),
    /invalid byte/,
  );
});

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

test('react-native sqlite adapter preserves query rows and transaction boundary', async () => {
  const calls = [];
  const tx = {
    async executeSql(sql, params = []) {
      calls.push(['tx', sql, params]);
      if (sql.startsWith('SELECT')) return [tx, result([{ value: 42 }])];
      return [tx, result([])];
    },
  };

  const db = {
    async executeSql(sql, params = []) {
      calls.push(['db', sql, params]);
      if (sql.startsWith('SELECT')) return [result([{ id: 1 }, { id: 2 }])];
      return [result([])];
    },
    async transaction(work) {
      calls.push(['begin']);
      const value = await work(tx);
      calls.push(['commit']);
      return value;
    },
  };

  const adapter = new ReactNativeSqliteAdapter(db);
  assert.deepEqual(await adapter.queryAll('SELECT * FROM x'), [{ id: 1 }, { id: 2 }]);
  assert.equal(
    await adapter.transaction(async t => {
      const row = await t.queryOne('SELECT value FROM y');
      await t.execute('UPDATE y SET value = ?', [43]);
      return row.value;
    }),
    42,
  );
  assert.deepEqual(calls.map(call => call[0]), ['db', 'begin', 'tx', 'tx', 'commit']);
});
