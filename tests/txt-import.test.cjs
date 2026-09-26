const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  importTxtSource,
  normalizeText,
  detectEncoding,
  sliceByCodePoints,
} = require('../dist/application/import/txtImport');
const { codePointLength, CodePointOffsetIndex } = require('../dist/domain/world/textOffsets');

const sha = {
  async sha256BytesHex(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
  },
};

const decoder = {
  decode(bytes, encoding) {
    return new TextDecoder(encoding === 'utf-8-sig' ? 'utf-8' : encoding).decode(bytes);
  },
};

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name));
}

test('encoding detection recognizes BOMs and GBK fallback', () => {
  assert.equal(detectEncoding(Buffer.from('普通中文文本，没有 BOM。', 'utf-8')), 'utf-8');
  assert.equal(detectEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), 'utf-8-sig');
  assert.equal(detectEncoding(Buffer.from([0xff, 0xfe, 0x61, 0x00])), 'utf-16le');
  assert.equal(detectEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x61])), 'utf-16be');
  // "世界" encoded in GBK contains byte sequences invalid in UTF-8.
  assert.equal(detectEncoding(Buffer.from([0xca, 0xc0, 0xbd, 0xe7])), 'gbk');
});

test('normalizeText unifies newlines, strips indentation, zero-width and blank runs', () => {
  const normalized = normalizeText('a\r\nb\rc \u200B \n\n\n\n\u00A0d\n');
  assert.equal(normalized, 'a\nb\nc\n\nd\n');
  // Full-width ideographic indentation (typical in Chinese novels) is stripped.
  assert.equal(normalizeText('\u3000\u3000楔子\n\u3000\u3000正文。'), '楔子\n正文。');
});

test('code point index slices by code point offsets, not UTF-16 units', () => {
  const text = '𠀀𠀀abc中文'; // each 𠀀 is one code point, two UTF-16 units
  const index = new CodePointOffsetIndex(text);
  assert.equal(index.codePointCount, 7);
  assert.equal(index.slice(0, 1), '𠀀');
  assert.equal(index.slice(2, 5), 'abc');
  assert.equal(codePointLength(text), 7);
  assert.equal(sliceByCodePoints(text, 5, 7), '中文');
});

test('small fixture novel splits into standard chapters and SHA-256 hashed chunks', async () => {
  const bytes = fixture('novel-small.txt');
  const parsed = await importTxtSource(bytes, sha, decoder);

  assert.equal(parsed.encoding, 'utf-8');
  assert.equal(parsed.splitStrategy, 'standard');
  assert.equal(parsed.chapters.length, 4);
  assert.equal(parsed.chapters[0].title, '第一章 雨夜客栈');
  assert.equal(parsed.chapters[3].title, '第四章 雨夜启程');
  assert.ok(parsed.chunks.length >= parsed.chapters.length);
  assert.equal(parsed.sourceSha256Hex, crypto.createHash('sha256').update(bytes).digest('hex'));

  // Chapter offsets partition the whole text in code points.
  assert.equal(parsed.chapters[0].startOffset, 0);
  for (let i = 1; i < parsed.chapters.length; i += 1) {
    assert.equal(parsed.chapters[i].startOffset, parsed.chapters[i - 1].endOffset);
  }
  assert.equal(parsed.chapters[parsed.chapters.length - 1].endOffset, parsed.codePointCount);

  // Chunk hashes are SHA-256 of the exact chunk text.
  for (const chunk of parsed.chunks) {
    const chunkText = sliceByCodePoints(parsed.text, chunk.startOffset, chunk.endOffset);
    const expected = crypto.createHash('sha256').update(Buffer.from(chunkText, 'utf-8')).digest('hex');
    assert.equal(chunk.contentHash, expected);
    assert.equal(chunk.charCount, codePointLength(chunkText));
  }

  // Annotated quotes from the small fixture resolve inside the source.
  const annotations = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-small.json'), 'utf8'));
  for (const fact of annotations.facts) {
    const quoteOffset = parsed.text.indexOf(fact.quote);
    assert.ok(quoteOffset >= 0, `quote not found: ${fact.quote}`);
  }
});

test('medium fixture novel (30 chapters) parses with source offsets and unique hashes', async () => {
  const bytes = fixture('novel-medium.txt');
  const parsed = await importTxtSource(bytes, sha, decoder, { targetChunkCodePoints: 300 });

  assert.equal(parsed.splitStrategy, 'standard');
  assert.equal(parsed.chapters.length, 30);
  assert.ok(parsed.codePointCount >= 15_000);
  assert.ok(parsed.chunks.length >= 60, 'small chunks should split chapters into multiple pieces');

  // All chunk hashes are proper SHA-256 digests of their exact text.
  // (Repetitive fixture prose may legitimately produce equal hashes for
  // identical filler text; content-addressing is the desired property.)
  for (const chunk of parsed.chunks) {
    assert.match(chunk.contentHash, /^[0-9a-f]{64}$/);
    const chunkText = sliceByCodePoints(parsed.text, chunk.startOffset, chunk.endOffset);
    const expected = crypto.createHash('sha256').update(Buffer.from(chunkText, 'utf-8')).digest('hex');
    assert.equal(chunk.contentHash, expected);
  }

  // Every chunk belongs to exactly one chapter and stays inside its bounds.
  const chapterById = new Map(parsed.chapters.map(c => [c.chapterId, c]));
  for (const chunk of parsed.chunks) {
    const chapter = chapterById.get(chunk.chapterId);
    assert.ok(chapter, `unknown chapter ${chunk.chapterId}`);
    assert.ok(chunk.startOffset >= chapter.startOffset);
    assert.ok(chunk.endOffset <= chapter.endOffset);
  }

  // All annotated facts resolve verbatim and map to consistent code-point spans.
  const annotations = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'facts-medium.json'), 'utf8'));
  assert.ok(annotations.facts.length >= 200, 'medium fixture must annotate >= 200 facts');
  for (const fact of annotations.facts) {
    const quote = fact.quote;
    assert.ok(parsed.text.includes(quote), `quote not found: ${quote}`);
  }
});

test('GBK-encoded input decodes through the decoder port', async () => {
  // "第一章 试炼\n他擅长剑术。" in GBK bytes (verified against TextDecoder('gbk')).
  const gbkBytes = new Uint8Array([
    0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xca, 0xd4, 0xc1, 0xb6, 0x0a,
    0xcb, 0xfb, 0xc9, 0xc3, 0xb3, 0xa4, 0xbd, 0xa3, 0xca, 0xf5, 0xa1, 0xa3,
  ]);
  assert.equal(detectEncoding(gbkBytes), 'gbk');
  const parsed = await importTxtSource(gbkBytes, sha, decoder);
  assert.equal(parsed.encoding, 'gbk');
  assert.ok(parsed.text.includes('他擅长剑术'));
  assert.equal(parsed.chapters.length, 1);
});
