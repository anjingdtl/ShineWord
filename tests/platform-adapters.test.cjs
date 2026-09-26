const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NativeSecureRandomByteSource,
} = require('../dist/platform/random/nativeSecureRandom');

test('native secure random adapter validates bytes', () => {
  const source = new NativeSecureRandomByteSource({ nextByte: () => 255 });
  assert.equal(source.nextByte(), 255);
  assert.throws(
    () => new NativeSecureRandomByteSource({ nextByte: () => 256 }).nextByte(),
    /invalid byte/,
  );
});
