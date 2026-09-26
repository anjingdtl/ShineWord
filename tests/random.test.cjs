const test = require('node:test');
const assert = require('node:assert/strict');
const { RejectionSamplingRandomSource } = require('../dist/domain');

class SequenceBytes {
  constructor(values) {
    this.values = values.slice();
  }
  nextByte() {
    if (this.values.length === 0) throw new Error('Byte sequence exhausted');
    return this.values.shift();
  }
}

test('rejection sampling discards biased tail bytes for d6', () => {
  const random = new RejectionSamplingRandomSource(
    new SequenceBytes([252, 255, 251]),
  );
  assert.equal(random.nextIntInclusive(1, 6), 6);
});

test('rejection sampling maps byte boundaries into the requested inclusive range', () => {
  const low = new RejectionSamplingRandomSource(new SequenceBytes([0]));
  const high = new RejectionSamplingRandomSource(new SequenceBytes([251]));
  assert.equal(low.nextIntInclusive(1, 12), 1);
  assert.equal(high.nextIntInclusive(1, 12), 12);
});

test('rejection sampling rejects invalid byte sources and oversized ranges', () => {
  const invalid = new RejectionSamplingRandomSource(new SequenceBytes([300]));
  assert.throws(() => invalid.nextIntInclusive(1, 6), /expected an integer from 0 to 255/);

  const range = new RejectionSamplingRandomSource(new SequenceBytes([0]));
  assert.throws(() => range.nextIntInclusive(0, 256), /ranges up to 256 values/);
});
