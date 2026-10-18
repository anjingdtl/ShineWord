const assert = require('node:assert/strict');
const test = require('node:test');
const { errorMessage } = require('../dist/application/errorMessage');

test('uses an actionable fallback for structured native failures without leaking DB details', () => {
  const fallback = '操作未能完成，请检查当前回合状态后重试。';
  const message = errorMessage({ message: 'p95 injected outbox abort (code 1811 SQLITE_CONSTRAINT_TRIGGER)' }, fallback);
  assert.equal(message, fallback);
  assert.notEqual(message, '[object Object]');
});

test('preserves Error and string messages and uses fallback for unreadable values', () => {
  assert.equal(errorMessage(new Error('database busy'), 'fallback'), 'database busy');
  assert.equal(errorMessage('Network request failed', 'fallback'), 'Network request failed');
  assert.equal(errorMessage({ code: 'SQLITE_ERROR' }, '操作未能完成，请重试。'), '操作未能完成，请重试。');
  assert.equal(errorMessage('', 'fallback'), 'fallback');
});
