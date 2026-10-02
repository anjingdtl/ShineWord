/**
 * Streaming TXT import (closeout C2).
 *
 * Consumes the novel through bounded text windows (native-side decode on the
 * device, a Node TextDecoder in tests), normalizes and chapter-splits with
 * EXACTLY the same semantics as the batch importer (`importTxtSource`), and
 * persists the normalized text as bounded shards. Chapter/chunk planning uses
 * the shared metadata helpers in `txtImport.ts` so the two paths cannot drift.
 *
 * Differences from batch, by design (recorded in the source manifest):
 * - the full normalized text is never held in memory; text reads go through
 *   the shard store;
 * - paragraphs longer than `maxParagraphCp` code points are hard-split at a
 *   surrogate-safe boundary (the batch importer would build one huge line);
 * - the normalized-text digest is a versioned shard-tree hash, not a digest
 *   over the whole string.
 */
import type {
  ChapterSplitStrategy,
  SourceChapter,
  SourceChunk,
} from '../../domain/world/types';
import { codePointLength, utf8Bytes, CodePointOffsetIndex } from '../../domain/world/textOffsets';
import {
  CHAPTER_SPLIT_VERSION,
  buildChapterDraftsFromMeta,
  classifyChapterStrategy,
  isLooseHeadingLine,
  isStandardHeadingLine,
  planChunksForChapter,
  type ParagraphMeta,
} from './txtImport';

export const NORMALIZE_VERSION_STREAMING = 'normalize-1';
export const NORMALIZE_SHARD_SCHEME = 'normalize-shard-1';
export const NORMALIZE_TREE_HASH_VERSION = 'normalize-hash-shard-tree-1';
export const DEFAULT_SHARD_CP = 32_768;
/** Hard cap for a paragraph with no line breaks (closeout plan §4.2). */
export const DEFAULT_MAX_PARAGRAPH_CP = 50_000;
export const DEFAULT_READ_WINDOW_BYTES = 256 * 1024;

export interface TextWindow {
  text: string;
  nextByteOffset: number;
  atEof: boolean;
}

/** Bounded decoded-text reader over a staged private copy of the raw file. */
export interface StreamingTextSource {
  readonly encoding: string;
  readonly byteLength: number;
  /** True byte digest of the raw file, computed during staging. */
  readonly rawSha256Hex: string;
  readText(byteOffset: number, maxBytes: number): Promise<TextWindow>;
}

/** Persisted normalized-text storage; writes shards, reads ranges back. */
export interface SourceShardStore {
  saveShard(input: {
    sourceId: string;
    shardIndex: number;
    startCp: number;
    endCp: number;
    text: string;
  }): Promise<void>;
  readRange(sourceId: string, startCp: number, endCp: number): Promise<string>;
}

export interface StreamingImportProgress {
  phase: 'reading' | 'planning' | 'hashing';
  bytesRead: number;
  totalBytes: number;
  completedRecords?: number;
  totalRecords?: number;
}

export interface StreamingImportOptions {
  targetChunkCodePoints?: number;
  fallbackChapterCodePoints?: number;
  maxParagraphCp?: number;
  shardCp?: number;
  readWindowBytes?: number;
  onProgress?: (progress: StreamingImportProgress) => void;
  sha256Hex(input: string): Promise<string>;
  sha256BytesHex(bytes: Uint8Array): Promise<string>;
  sha256BytesBatchHex?(bytes: readonly Uint8Array[]): Promise<readonly string[]>;
}

export interface StreamingImportResult {
  sourceId: string;
  encoding: string;
  rawSha256Hex: string;
  byteLength: number;
  codePointCount: number;
  normalizeVersion: string;
  chapterSplitVersion: string;
  splitStrategy: ChapterSplitStrategy;
  normalizeShardScheme: string;
  normalizedTreeHash: string;
  shardCount: number;
  maxParagraphSplits: number;
  chapters: SourceChapter[];
  chunks: SourceChunk[];
}

function normalizeLine(raw: string): string {
  return raw
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/^[ \t\u3000]+/, '')
    .replace(/[ \t\u3000]+$/, '');
}

function splitAtCpBoundary(text: string, maxCp: number): [string, string] {
  let cp = 0;
  let utf16 = 0;
  while (utf16 < text.length && cp < maxCp) {
    const code = text.charCodeAt(utf16);
    utf16 += code >= 0xd800 && code < 0xdc00 ? 2 : 1;
    cp += 1;
  }
  return [text.slice(0, utf16), text.slice(utf16)];
}

export async function importTxtSourceStreaming(
  source: StreamingTextSource,
  shards: SourceShardStore,
  sourceId: string,
  options: StreamingImportOptions,
): Promise<StreamingImportResult> {
  const targetChunk = options.targetChunkCodePoints ?? 1_200;
  const fallbackChapterSize = options.fallbackChapterCodePoints ?? 5_000;
  const maxParagraphCp = options.maxParagraphCp ?? DEFAULT_MAX_PARAGRAPH_CP;
  const shardCp = options.shardCp ?? DEFAULT_SHARD_CP;
  const readWindowBytes = options.readWindowBytes ?? DEFAULT_READ_WINDOW_BYTES;
  const report = options.onProgress ?? (() => undefined);

  // ---- pass 1: stream, normalize, persist shards, collect metadata -------
  const paragraphs: ParagraphMeta[] = [];
  const shardDigests: string[] = [];
  let shardIndex = 0;
  let shardBuffer = '';
  let shardBufferCp = 0;
  let shardStartCp = 0;
  let cpCursor = 0;
  let sawAnyLine = false;
  let previousLineBlank = false;
  let maxParagraphSplits = 0;

  const flushShard = async (): Promise<void> => {
    if (shardBuffer.length === 0) return;
    const endCp = shardStartCp + shardBufferCp;
    await shards.saveShard({ sourceId, shardIndex, startCp: shardStartCp, endCp, text: shardBuffer });
    shardDigests.push(await options.sha256Hex(shardBuffer));
    shardIndex += 1;
    shardBuffer = '';
    shardBufferCp = 0;
    shardStartCp = endCp;
  };

  const emitLine = async (line: string, options?: { finalUnterminated?: boolean }): Promise<void> => {
    const normalized = normalizeLine(line);
    const blank = normalized.length === 0;
    if (blank) {
      // A final unterminated blank line contributes nothing (its characters
      // trim away in batch normalization); other blank lines may still be
      // the single survivor of a collapsed run.
      if (options?.finalUnterminated) return;
      if (sawAnyLine && previousLineBlank) {
        // Batch collapses runs of >= 2 empty lines to exactly one empty line;
        // the skipped lines' code points never enter the normalized output.
        previousLineBlank = true;
        return;
      }
    }
    sawAnyLine = true;
    previousLineBlank = blank;
    const lineCp = codePointLength(normalized);
    if (!blank) {
      const headingKind: ParagraphMeta['headingKind'] = isStandardHeadingLine(normalized)
        ? 'standard'
        : isLooseHeadingLine(normalized)
          ? 'loose'
          : 'none';
      paragraphs.push({
        startOffset: cpCursor,
        lengthCp: lineCp,
        headingKind,
        headingText: headingKind === 'none' ? '' : normalized,
      });
    }
    shardBuffer += normalized;
    shardBufferCp += lineCp;
    cpCursor += lineCp;
    // Every terminated line is followed by exactly one '\n' in the normalized
    // text; a final unterminated line (batch: no trailing newline) is not.
    if (!options?.finalUnterminated) {
      shardBuffer += '\n';
      shardBufferCp += 1;
      cpCursor += 1;
    }
    if (shardBufferCp >= shardCp) {
      await flushShard();
    }
  };

  const emitSplit = async (line: string, options?: { finalUnterminated?: boolean }): Promise<void> => {
    let remaining = line;
    while (codePointLength(remaining) > maxParagraphCp) {
      const [head, tail] = splitAtCpBoundary(remaining, maxParagraphCp);
      await emitLine(head);
      remaining = tail;
      maxParagraphSplits += 1;
    }
    await emitLine(remaining, options);
  };

  // Line assembly across windows. '\r' terminates a line and optionally eats
  // a following '\n' (matches batch replace(/\r\n?/g, '\n')).
  let pending = '';
  let pendingCr = false;
  let byteOffset = 0;
  let firstWindow = true;
  for (;;) {
    report({ phase: 'reading', bytesRead: byteOffset, totalBytes: source.byteLength });
    const window = await source.readText(byteOffset, readWindowBytes);
    let text = window.text;
    byteOffset = window.nextByteOffset;
    if (firstWindow) {
      firstWindow = false;
      if (text.startsWith('\uFEFF')) text = text.slice(1);
    }
    let cursor = 0;
    if (pendingCr) {
      pendingCr = false;
      if (text[cursor] === '\n') cursor += 1;
      const line = pending;
      pending = '';
      await emitSplit(line);
    }
    while (cursor < text.length) {
      const nextLf = text.indexOf('\n', cursor);
      const nextCr = text.indexOf('\r', cursor);
      if (nextLf === -1 && nextCr === -1) {
        pending += text.slice(cursor);
        break;
      }
      if (nextCr !== -1 && (nextLf === -1 || nextCr < nextLf)) {
        if (nextCr === text.length - 1) {
          // '\r' at the window boundary: the next window decides whether a
          // '\n' follows before the terminator is consumed.
          pending += text.slice(cursor, nextCr);
          pendingCr = true;
          break;
        }
        const line = pending + text.slice(cursor, nextCr);
        pending = '';
        cursor = nextCr + 1;
        if (text[cursor] === '\n') cursor += 1;
        await emitSplit(line);
        continue;
      }
      const line = pending + text.slice(cursor, nextLf);
      pending = '';
      cursor = nextLf + 1;
      await emitSplit(line);
    }
    if (window.atEof) break;
  }
  if (pendingCr) {
    // '\r' at end-of-file is a terminator (batch maps it to '\n').
    await emitSplit(pending);
    pending = '';
  } else if (pending.length > 0) {
    // Final line without a terminator: batch normalization emits it without
    // a trailing newline.
    await emitSplit(pending, { finalUnterminated: true });
    pending = '';
  }
  await flushShard();
  const codePointCount = cpCursor;

  // ---- pass 2: plan chapters/chunks from the shared metadata --------------
  report({ phase: 'planning', bytesRead: source.byteLength, totalBytes: source.byteLength });
  const splitStrategy = classifyChapterStrategy(paragraphs);
  const drafts = buildChapterDraftsFromMeta(paragraphs, splitStrategy, codePointCount, fallbackChapterSize);

  const chapters: SourceChapter[] = [];
  const chunks: SourceChunk[] = [];
  for (let i = 0; i < drafts.length; i += 1) {
    const draft = drafts[i];
    if (!draft) continue;
    const chapter: SourceChapter = {
      chapterId: `ch-${String(i + 1).padStart(4, '0')}`,
      index: i,
      title: draft.title.trim() || `片段 ${i + 1}`,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      charCount: draft.endOffset - draft.startOffset,
      contentHash: '',
    };
    chapters.push(chapter);
    chunks.push(...planChunksForChapter(chapter, draft, paragraphs, targetChunk));
  }
  // Import owns these finished staging shards. A bounded read-ahead window
  // avoids thousands of repeated SQLite/bridge reads of the same shard.
  let cached: { start: number; end: number; index: CodePointOffsetIndex } | null = null;
  const readRecord = async (start: number, end: number): Promise<string> => {
    if (end - start > 65_536) return shards.readRange(sourceId, start, end);
    if (!cached || start < cached.start || end > cached.end) {
      const until = Math.min(codePointCount, start + 65_536);
      const text = await shards.readRange(sourceId, start, until);
      const index = new CodePointOffsetIndex(text);
      if (index.codePointCount !== until - start) throw new Error('import_shard_coverage_missing');
      cached = { start, end: until, index };
    }
    return cached.index.slice(start - cached.start, end - cached.start);
  };
  const records = [...chapters, ...chunks].sort((a,b) => a.startOffset - b.startOffset);
  for (let offset = 0; offset < records.length; offset += 16) {
    report({ phase: 'hashing', bytesRead: source.byteLength, totalBytes: source.byteLength, completedRecords: offset, totalRecords: records.length });
    const batch = records.slice(offset, offset + 16);
    const bytes: Uint8Array[] = [];
    for (const record of batch) {
      const text = await readRecord(record.startOffset, record.endOffset);
      record.charCount = codePointLength(text);
      if (record.charCount !== record.endOffset - record.startOffset) throw new Error('import_shard_coverage_missing');
      bytes.push(utf8Bytes(text));
    }
    const digests = options.sha256BytesBatchHex && bytes.reduce((n,v)=>n+v.byteLength,0) <= 1_048_576
      ? await options.sha256BytesBatchHex(bytes)
      : await Promise.all(bytes.map(value => options.sha256BytesHex(value)));
    if (digests.length !== batch.length) throw new Error('invalid_batch_digests');
    for (let i = 0; i < batch.length; i++) batch[i]!.contentHash = digests[i]!;
  }

  const normalizedTreeHash = await options.sha256Hex(shardDigests.join(''));

  return {
    sourceId,
    encoding: source.encoding,
    rawSha256Hex: source.rawSha256Hex,
    byteLength: source.byteLength,
    codePointCount,
    normalizeVersion: NORMALIZE_VERSION_STREAMING,
    chapterSplitVersion: CHAPTER_SPLIT_VERSION,
    splitStrategy,
    normalizeShardScheme: NORMALIZE_SHARD_SCHEME,
    normalizedTreeHash,
    shardCount: shardIndex,
    maxParagraphSplits,
    chapters,
    chunks,
  };
}
