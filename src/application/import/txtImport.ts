import type {
  ChapterSplitStrategy,
  ParsedTxtSource,
  SourceChapter,
  SourceChunk,
} from '../../domain/world/types';
import { CodePointOffsetIndex, codePointLength, utf8Bytes } from '../../domain/world/textOffsets';

export const NORMALIZE_VERSION = 'normalize-1';
export const CHAPTER_SPLIT_VERSION = 'chapter-split-1';

export interface ByteSha256Provider {
  sha256BytesHex(bytes: Uint8Array): Promise<string>;
}

export interface TextDecodeProvider {
  /** Decode bytes for the given encoding label ('utf-8', 'gbk', 'utf-16le', ...). */
  decode(bytes: Uint8Array, encoding: string): string;
}

export interface TxtImportOptions {
  targetChunkCodePoints?: number;
  fallbackChapterCodePoints?: number;
}

interface Paragraph {
  text: string;
  startOffset: number;
}

const STANDARD_HEADING =
  /^\s*(?:第\s*[0-9０-９〇零一二两三四五六七八九十百千万]+\s*[章节卷回部集幕])(?:[\s:：、.．·-]*\S[^\n]{0,48})?\s*$/;
const LOOSE_HEADING_EN = /^\s*(?:Chapter|CHAPTER|chapter)\s+\d+(?:[^\n]{0,44})?\s*$/;
const LOOSE_HEADING_NUM = /^\s*\d{1,4}[、.．]\s*\S[^\n]{0,40}\s*$/;

/** Heading matchers shared with the streaming importer (closeout C2). */
export function isStandardHeadingLine(line: string): boolean {
  return STANDARD_HEADING.test(line);
}

export function isLooseHeadingLine(line: string): boolean {
  return LOOSE_HEADING_EN.test(line) || LOOSE_HEADING_NUM.test(line);
}

export function detectEncoding(bytes: Uint8Array): string {
  const byteAt = (i: number): number => bytes[i] ?? 0;
  if (bytes.length >= 3 && byteAt(0) === 0xef && byteAt(1) === 0xbb && byteAt(2) === 0xbf) {
    return 'utf-8-sig';
  }
  if (bytes.length >= 2 && byteAt(0) === 0xff && byteAt(1) === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && byteAt(0) === 0xfe && byteAt(1) === 0xff) return 'utf-16be';
  // Probe UTF-8 validity; fall back to GBK for Chinese text.
  const probeLength = Math.min(bytes.length, 65_536);
  for (let i = 0; i < probeLength; ) {
    const b = byteAt(i);
    if (b < 0x80) {
      i += 1;
      continue;
    }
    let continuation = 0;
    let min = 0x80;
    if (b >= 0xc2 && b <= 0xdf) {
      continuation = 1;
    } else if (b >= 0xe0 && b <= 0xef) {
      continuation = 2;
      min = b === 0xe0 ? 0xa0 : 0x80;
    } else if (b >= 0xf0 && b <= 0xf4) {
      continuation = 3;
      min = b === 0xf0 ? 0x90 : 0x80;
    } else {
      return 'gbk';
    }
    if (i + continuation >= probeLength) break;
    for (let j = 1; j <= continuation; j += 1) {
      const cb = byteAt(i + j);
      const lower = j === 1 ? min : 0x80;
      if (cb < lower || cb > 0xbf) return 'gbk';
    }
    i += continuation + 1;
  }
  return 'utf-8';
}

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/^[ \t\u3000]+/gm, '')
    .replace(/[ \t\u3000]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

function splitParagraphs(normalized: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let cursorUtf16 = 0;
  let offset = 0;
  while (cursorUtf16 <= normalized.length) {
    const nextBreak = normalized.indexOf('\n', cursorUtf16);
    const rawLine = nextBreak === -1
      ? normalized.slice(cursorUtf16)
      : normalized.slice(cursorUtf16, nextBreak);
    if (rawLine.trim().length > 0) {
      paragraphs.push({ text: rawLine, startOffset: offset });
    }
    offset += codePointLength(rawLine) + 1;
    if (nextBreak === -1) break;
    cursorUtf16 = nextBreak + 1;
  }
  return paragraphs;
}

/**
 * Paragraph metadata shared by the batch importer and the streaming importer
 * (closeout C2) so chapter/chunk planning cannot drift between them.
 * `headingText` is populated only for lines matching a chapter heading
 * pattern - the streaming pass does not retain full paragraph text.
 */
export interface ParagraphMeta {
  startOffset: number;
  lengthCp: number;
  headingKind: 'none' | 'standard' | 'loose';
  /** Trimmed line for heading matches (title source); '' otherwise. */
  headingText: string;
}

export function paragraphMetaFrom(normalized: string): ParagraphMeta[] {
  const paragraphs = splitParagraphs(normalized);
  return paragraphs.map(paragraph => {
    const line = paragraph.text.trim();
    const headingKind: ParagraphMeta['headingKind'] = STANDARD_HEADING.test(line)
      ? 'standard'
      : LOOSE_HEADING_EN.test(line) || LOOSE_HEADING_NUM.test(line)
        ? 'loose'
        : 'none';
    return {
      startOffset: paragraph.startOffset,
      lengthCp: codePointLength(paragraph.text),
      headingKind,
      headingText: headingKind === 'none' ? '' : line,
    };
  });
}

export function classifyChapterStrategy(paragraphs: readonly ParagraphMeta[]): ChapterSplitStrategy {
  let standard = 0;
  let loose = 0;
  for (const paragraph of paragraphs) {
    if (paragraph.headingKind === 'standard') standard += 1;
    else if (paragraph.headingKind === 'loose') loose += 1;
  }
  if (standard >= 2) return 'standard';
  if (loose >= 3) return 'loose';
  return 'fallback';
}

export interface ChapterDraft {
  title: string;
  startOffset: number;
  endOffset: number;
}

export function buildChapterDraftsFromMeta(
  paragraphs: readonly ParagraphMeta[],
  strategy: ChapterSplitStrategy,
  codePointCount: number,
  fallbackChapterSize: number,
): ChapterDraft[] {
  const drafts: ChapterDraft[] = [];

  if (strategy === 'fallback') {
    let chapterStart = 0;
    let acc = 0;
    for (let i = 0; i < paragraphs.length; i += 1) {
      const paragraph = paragraphs[i];
      if (!paragraph) continue;
      acc += paragraph.lengthCp + 1;
      const nextParagraph = paragraphs[i + 1];
      const nextStart = nextParagraph ? nextParagraph.startOffset : codePointCount;
      if (acc >= fallbackChapterSize || i === paragraphs.length - 1) {
        if (nextStart > chapterStart || drafts.length === 0) {
          drafts.push({
            title: `片段 ${drafts.length + 1}`,
            startOffset: chapterStart,
            endOffset: nextStart,
          });
        }
        chapterStart = nextStart;
        acc = 0;
      }
    }
    return drafts;
  }

  let currentTitle = '开篇';
  let currentStart = 0;
  for (const paragraph of paragraphs) {
    if (paragraph.headingKind === 'none') continue;
    if (paragraph.headingKind !== strategy) continue;
    const line = paragraph.headingText;
    if (paragraph.startOffset > currentStart) {
      drafts.push({ title: currentTitle, startOffset: currentStart, endOffset: paragraph.startOffset });
      currentTitle = line.slice(0, 60);
      currentStart = paragraph.startOffset;
    } else if (currentTitle === '开篇' && drafts.length === 0) {
      // Heading at the very start of the document names the first chapter.
      currentTitle = line.slice(0, 60);
    }
  }
  drafts.push({ title: currentTitle, startOffset: currentStart, endOffset: codePointCount });
  return drafts;
}

export async function importTxtSource(
  bytes: Uint8Array,
  sha: ByteSha256Provider,
  decoder: TextDecodeProvider,
  options: TxtImportOptions = {},
): Promise<ParsedTxtSource> {
  const targetChunk = options.targetChunkCodePoints ?? 1_200;
  const fallbackChapterSize = options.fallbackChapterCodePoints ?? 5_000;

  const encoding = detectEncoding(bytes);
  const decoded = decoder.decode(bytes, encoding);
  const normalized = normalizeText(
    decoded.startsWith('\uFEFF') ? decoded.slice(1) : decoded,
  );
  const sourceSha256Hex = await sha.sha256BytesHex(bytes);

  const paragraphs = paragraphMetaFrom(normalized);
  const strategy = classifyChapterStrategy(paragraphs);
  const index = new CodePointOffsetIndex(normalized);
  const codePointCount = index.codePointCount;

  const drafts = buildChapterDraftsFromMeta(paragraphs, strategy, codePointCount, fallbackChapterSize);

  const chapters: SourceChapter[] = [];
  const chunks: SourceChunk[] = [];

  for (let i = 0; i < drafts.length; i += 1) {
    const draft = drafts[i];
    if (!draft) continue;
    const chapterText = index.slice(draft.startOffset, draft.endOffset);
    const chapter: SourceChapter = {
      chapterId: `ch-${String(i + 1).padStart(4, '0')}`,
      index: i,
      title: draft.title.trim() || `片段 ${i + 1}`,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      charCount: codePointLength(chapterText),
      contentHash: await sha.sha256BytesHex(utf8Bytes(chapterText)),
    };
    chapters.push(chapter);
    chunks.push(...planChunksForChapter(chapter, draft, paragraphs, targetChunk));
  }

  // Fill chunk sizes and hashes in one pass after offsets are final.
  for (const chunk of chunks) {
    const chunkText = index.slice(chunk.startOffset, chunk.endOffset);
    chunk.charCount = codePointLength(chunkText);
    chunk.contentHash = await sha.sha256BytesHex(utf8Bytes(chunkText));
  }

  return {
    encoding,
    sourceSha256Hex,
    sourceByteLength: bytes.length,
    normalizeVersion: NORMALIZE_VERSION,
    chapterSplitVersion: CHAPTER_SPLIT_VERSION,
    splitStrategy: strategy,
    text: normalized,
    codePointCount,
    chapters,
    chunks,
  };
}

/**
 * Physical chunk planning shared by batch and streaming importers: packs
 * consecutive paragraphs of one chapter up to `targetChunk` code points.
 * Offsets only - text and hashes are the caller's responsibility.
 */
export function planChunksForChapter(
  chapter: { chapterId: string },
  draft: { startOffset: number; endOffset: number },
  paragraphs: readonly ParagraphMeta[],
  targetChunk: number,
): SourceChunk[] {
  const chapterParagraphs = paragraphs.filter(
    p => p.startOffset >= draft.startOffset && p.startOffset < draft.endOffset,
  );
  const chunks: SourceChunk[] = [];
  let chunkIndex = 0;
  let batch: ParagraphMeta[] = [];
  let acc = 0;
  const flush = (endOffset: number) => {
    const firstParagraph = batch[0];
    if (!firstParagraph) return;
    const startOffset = firstParagraph.startOffset;
    const boundedEnd = Math.min(endOffset, draft.endOffset);
    if (boundedEnd <= startOffset) {
      batch = [];
      acc = 0;
      return;
    }
    chunks.push({
      chunkId: `${chapter.chapterId}-c${String(chunkIndex + 1).padStart(3, '0')}`,
      chapterId: chapter.chapterId,
      chunkIndex,
      startOffset,
      endOffset: boundedEnd,
      charCount: boundedEnd - startOffset,
      contentHash: '',
    });
    chunkIndex += 1;
    batch = [];
    acc = 0;
  };

  for (const paragraph of chapterParagraphs) {
    batch.push(paragraph);
    acc += paragraph.lengthCp + 1;
    if (acc >= targetChunk) {
      flush(paragraph.startOffset + paragraph.lengthCp + 1);
    }
  }
  flush(draft.endOffset);
  return chunks;
}

export function sliceByCodePoints(text: string, startOffset: number, endOffset: number): string {
  const index = new CodePointOffsetIndex(text);
  return index.slice(startOffset, endOffset);
}
