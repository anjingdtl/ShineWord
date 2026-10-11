'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sliceNovelBytes } = require('../scripts/lib/smokeNovel.cjs');

const GB18030_SAMPLE = Buffer.from(
  '0PfR1A0Ktdox1cIgQQ0KWA0Ktdoy1cIgQg0KWQ0Ktdoz1cIgQw0KWg0K',
  'base64',
);

test('smoke sample decodes GB18030 and stops before the chapter after the requested prefix', () => {
  const result = sliceNovelBytes(GB18030_SAMPLE, 2, 'gb18030');
  assert.equal(result.sourceEncoding, 'gb18030');
  assert.equal(result.chapterCount, 2);
  assert.equal(result.sourceBytes, GB18030_SAMPLE.length);
  assert.equal(result.bytes.toString('utf8'), '绪言\n第1章 A\nX\n第2章 B\nY');
});

test('smoke sample rejects malformed UTF-8 instead of replacing text and missing headings', () => {
  assert.throws(() => sliceNovelBytes(GB18030_SAMPLE, 2, 'utf-8'), /cannot be decoded/);
});

test('smoke sample refuses inputs with no supported chapter heading', () => {
  assert.throws(() => sliceNovelBytes(Buffer.from('plain text', 'utf8'), 2), /No supported chapter headings/);
});

test('smoke sample enforces its byte limit after chapter slicing', () => {
  assert.throws(() => sliceNovelBytes(GB18030_SAMPLE, 2, 'gb18030', 8), /above the 8-byte limit/);
});
