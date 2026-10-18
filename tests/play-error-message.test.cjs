const assert = require('node:assert/strict');
const test = require('node:test');
const { errorMessage } = require('../dist/application/errorMessage');

test('formats native structured errors from the play path without showing [object Object]', () => {
  const message = errorMessage({ message: 'injected outbox abort' }, '操作未能完成，请重试。');
  assert.equal(message, 'injected outbox abort');
  assert.notEqual(message, '[object Object]');
});

test('preserves Error and string messages and uses fallback for unreadable values', () => {
  assert.equal(errorMessage(new Error('database busy'), 'fallback'), 'database busy');
  assert.equal(errorMessage('Network request failed', 'fallback'), 'Network request failed');
  assert.equal(errorMessage({ code: 'SQLITE_ERROR' }, '操作未能完成，请重试。'), '操作未能完成，请重试。');
  assert.equal(errorMessage('', 'fallback'), 'fallback');
});
