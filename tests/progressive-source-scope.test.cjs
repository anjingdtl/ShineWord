'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { CodePointOffsetIndex } = require('../dist/domain/world/textOffsets');
const { buildWholeSourceRanges } = require('../dist/application/worldPackage/sourceScope');

const sha256Hex = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

test('whole-source coverage hashes bounded contiguous ranges and accepts only whitespace parser gaps', async () => {
  const text = 'A😀 \nB\nC';
  const index = new CodePointOffsetIndex(text);
  const chunks = [
    { startOffset: 0, endOffset: 2 },
    { startOffset: 4, endOffset: 5 },
    { startOffset: 6, endOffset: 7 },
  ];
  const ranges = await buildWholeSourceRanges({
    chunks,
    sourceCodePointCount: index.codePointCount,
    readRange: (start, end) => index.slice(start, end),
    sha256Hex,
  });
  assert.equal(ranges.length, 3);
  assert.deepEqual(ranges.map(({ startCodePoint, endCodePoint }) => [startCodePoint, endCodePoint]), [
    [0, 4], [4, 6], [6, 7],
  ]);
  assert.deepEqual(ranges.map(range => range.contentSha256), [
    sha256Hex(index.slice(0, 4)), sha256Hex(index.slice(4, 6)), sha256Hex(index.slice(6, 7)),
  ]);
});

test('whole-source coverage rejects non-whitespace gaps and overlapping chunks', async () => {
  const text = 'A!B';
  const readRange = (start, end) => [...text].slice(start, end).join('');
  await assert.rejects(() => buildWholeSourceRanges({
    chunks: [{ startOffset: 0, endOffset: 1 }, { startOffset: 2, endOffset: 3 }],
    sourceCodePointCount: 3,
    readRange,
    sha256Hex,
  }), /非空白原文/);
  await assert.rejects(() => buildWholeSourceRanges({
    chunks: [{ startOffset: 0, endOffset: 2 }, { startOffset: 1, endOffset: 3 }],
    sourceCodePointCount: 3,
    readRange,
    sha256Hex,
  }), /范围重叠/);
});

test('large novels collapse into at most 64 scope ranges', async () => {
  const text = 'x'.repeat(1_000);
  const chunks = Array.from({ length: text.length }, (_, index) => ({
    startOffset: index,
    endOffset: index + 1,
  }));
  const ranges = await buildWholeSourceRanges({
    chunks,
    sourceCodePointCount: text.length,
    readRange: (start, end) => text.slice(start, end),
    sha256Hex,
  });
  assert.ok(ranges.length <= 64);
  assert.equal(ranges[0].startCodePoint, 0);
  assert.equal(ranges.at(-1).endCodePoint, text.length);
  for (let i = 1; i < ranges.length; i += 1) {
    assert.equal(ranges[i - 1].endCodePoint, ranges[i].startCodePoint);
  }
});
