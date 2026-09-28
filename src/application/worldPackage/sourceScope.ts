import { codePointLength } from '../../domain/world/textOffsets';

const MAX_SOURCE_SCOPE_RANGES = 64;

/**
 * Hash a bounded, contiguous coverage manifest for a fully extracted source.
 * Parser separators may fall between extraction chunks, but only whitespace
 * is allowed in those gaps. Reads are grouped so large sources never need to
 * be materialized as one string for the package manifest.
 */
export async function buildWholeSourceRanges(input: {
  chunks: readonly { startOffset: number; endOffset: number }[];
  sourceCodePointCount: number;
  readRange(startCodePoint: number, endCodePoint: number): Promise<string> | string;
  sha256Hex(value: string): Promise<string> | string;
}): Promise<Array<{
  startCodePoint: number;
  endCodePoint: number;
  contentSha256: string;
}>> {
  if (!Number.isSafeInteger(input.sourceCodePointCount) || input.sourceCodePointCount < 1
    || input.chunks.length === 0) {
    throw new Error('全文来源范围无效，未发布全量精编包。');
  }
  const chunks = [...input.chunks]
    .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
  let cursor = 0;
  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.startOffset) || !Number.isSafeInteger(chunk.endOffset)
      || chunk.startOffset < cursor || chunk.endOffset <= chunk.startOffset
      || chunk.endOffset > input.sourceCodePointCount) {
      throw new Error('文本块范围重叠或超出原文，未发布全量精编包。');
    }
    if (chunk.startOffset > cursor) {
      const gap = await input.readRange(cursor, chunk.startOffset);
      if (!isWhitespaceOnly(gap)) {
        throw new Error('存在未进入抽取请求的非空白原文，未发布全量精编包。');
      }
    }
    cursor = chunk.endOffset;
  }
  if (cursor < input.sourceCodePointCount) {
    const gap = await input.readRange(cursor, input.sourceCodePointCount);
    if (!isWhitespaceOnly(gap)) {
      throw new Error('原文末尾存在未进入抽取请求的非空白内容，未发布全量精编包。');
    }
  }

  const chunksPerRange = Math.ceil(chunks.length / MAX_SOURCE_SCOPE_RANGES);
  const ranges: Array<{ startCodePoint: number; endCodePoint: number; contentSha256: string }> = [];
  let startCodePoint = 0;
  for (let nextChunkIndex = chunksPerRange; ; nextChunkIndex += chunksPerRange) {
    const endCodePoint = nextChunkIndex < chunks.length
      ? chunks[nextChunkIndex]!.startOffset
      : input.sourceCodePointCount;
    if (endCodePoint <= startCodePoint) {
      throw new Error('全文来源范围无法连续分组，未发布全量精编包。');
    }
    const text = await input.readRange(startCodePoint, endCodePoint);
    if (codePointLength(text) !== endCodePoint - startCodePoint) {
      throw new Error('全文来源分段长度校验失败，未发布全量精编包。');
    }
    ranges.push({
      startCodePoint,
      endCodePoint,
      contentSha256: await input.sha256Hex(text),
    });
    startCodePoint = endCodePoint;
    if (nextChunkIndex >= chunks.length) break;
  }
  if (ranges.length > MAX_SOURCE_SCOPE_RANGES
    || startCodePoint !== input.sourceCodePointCount) {
    throw new Error('全文来源范围超过清单上限或未覆盖到末尾。');
  }
  return ranges;
}

function isWhitespaceOnly(value: string): boolean {
  for (const character of value) {
    if (!/\s/u.test(character)) return false;
  }
  return true;
}
