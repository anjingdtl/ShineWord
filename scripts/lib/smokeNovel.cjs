'use strict';

const CHAPTER_HEADING = /^\s*第\s*[0-9０-９〇零一二两三四五六七八九十百千万]+\s*[章卷回部]\s*\S/;
const SUPPORTED_ENCODINGS = new Set(['utf-8', 'utf8', 'gb18030', 'gbk']);

/**
 * Decode and select a bounded chapter prefix for the real-LLM smoke.
 * Fail closed when decoding or chapter detection fails so malformed input
 * cannot silently turn into a whole-book request.
 */
function sliceNovelBytes(inputBytes, chapters, encoding = 'utf-8', maxBytes = 256 * 1024) {
  if (!Buffer.isBuffer(inputBytes)) throw new TypeError('Novel input must be a Buffer.');
  if (!Number.isSafeInteger(chapters) || chapters < 1) throw new RangeError('Chapter count must be a positive integer.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Maximum sample size must be a positive integer.');

  const normalizedEncoding = String(encoding).toLowerCase();
  if (!SUPPORTED_ENCODINGS.has(normalizedEncoding)) {
    throw new Error('Unsupported novel encoding; use utf-8 or gb18030.');
  }

  let text;
  try {
    text = new TextDecoder(normalizedEncoding, { fatal: true }).decode(inputBytes);
  } catch {
    throw new Error(`Novel cannot be decoded as ${normalizedEncoding}; choose utf-8 or gb18030 explicitly.`);
  }

  const selectedLines = [];
  let headingCount = 0;
  for (const line of text.split(/\r\n?|\n/)) {
    if (CHAPTER_HEADING.test(line)) {
      headingCount += 1;
      if (headingCount > chapters) break;
    }
    selectedLines.push(line);
  }

  if (headingCount === 0) {
    throw new Error('No supported chapter headings found; refusing to send an unsliced novel.');
  }

  const bytes = Buffer.from(selectedLines.join('\n'), 'utf8');
  if (bytes.length > maxBytes) {
    throw new Error(`Selected novel sample is ${bytes.length} bytes, above the ${maxBytes}-byte limit.`);
  }

  return {
    bytes,
    chapterCount: Math.min(headingCount, chapters),
    sourceEncoding: normalizedEncoding,
    sourceBytes: inputBytes.length,
  };
}

module.exports = { sliceNovelBytes };
