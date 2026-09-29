/**
 * Chapter-aligned batch planner for windowed extraction (unified build P1 §2).
 *
 * Batches are assembled from WHOLE CHAPTERS, not from the ~1,200-codepoint
 * storage chunks: storage chunks only serve I/O and evidence anchoring, they
 * no longer cap what the model reads in one request. Each batch is bounded by
 *
 *   1. the output budget  - floor(maxContentOutputTokens x 0.7) tokens of
 *      estimated extraction output (est 800/chunk, calibrated online), and
 *   2. the body budget    - min(windowBodyRoom, bodyTargetRatio x window),
 *      where the INITIAL bodyTargetRatio is 0.30 of the context window and
 *      shrinks on truncation failures (30% -> 20% -> 12% -> halving floor).
 *
 * A chapter whose chunks alone exceed the per-batch output budget is split at
 * chunk boundaries (super-long chapters get paragraph-level chunks upstream),
 * so coverage is always exact: every chunk lands in exactly one batch, in
 * order, with no holes and no duplicates.
 */
import type { SourceChapter, SourceChunk } from '../../domain/world/types';
import {
  DEFAULT_EST_OUTPUT_PER_CHUNK,
  DEFAULT_PROMPT_OVERHEAD_TOKENS,
  MIN_OUTPUT_DRIVEN_SEGMENTS,
  OUTPUT_BUDGET_RATIO,
  type ExtractSegment,
  type ModelBudget,
} from './groupPlanner';

/** Initial body target ladder (plan P1 §7): 30% -> 20% -> 12% -> halving. */
export const BODY_TARGET_LADDER = [0.30, 0.20, 0.12] as const;
export const BODY_TARGET_FLOOR = 0.02;

export function nextBodyTargetRatio(current: number): number {
  for (const step of BODY_TARGET_LADDER) {
    if (step < current - 1e-9) return step;
  }
  const halved = current / 2;
  return halved >= BODY_TARGET_FLOOR ? halved : Math.min(current, BODY_TARGET_FLOOR);
}


/** Canonical chunk order: chapter order first, per-chapter chunk order
 * second. The streaming importer numbers chunkIndex PER CHAPTER (each chapter
 * restarts at 0), so chunkIndex alone is NOT a global order. */
export function orderChunksByChapter(
  chapters: readonly SourceChapter[],
  chunks: readonly SourceChunk[],
): SourceChunk[] {
  const indexByChapter = new Map(chapters.map(chapter => [chapter.chapterId, chapter.index]));
  return [...chunks].sort((a, b) => {
    const chapterA = indexByChapter.get(a.chapterId) ?? 0;
    const chapterB = indexByChapter.get(b.chapterId) ?? 0;
    return chapterA !== chapterB ? chapterA - chapterB : a.chunkIndex - b.chunkIndex;
  });
}

export type ExtractionRoute = 'characters' | 'world';

export interface PlannedBatch {
  ord: number;
  segments: ExtractSegment[];
  /** Chapter ids covered, in order (a split chapter appears in consecutive batches). */
  chapterIds: string[];
  /** Conservative input-token estimate for the batch body. */
  estInputTokens: number;
  /** Chunk ids joined - the batch's input identity seed. */
  inputHashSeed: string;
  /** Present only for dual-route runs; undefined = full-scope extraction. */
  route?: ExtractionRoute;
}

export interface ChapterBatchPlanOptions {
  /** Initial body target fraction of the context window (default 0.30). */
  bodyTargetRatio?: number;
  /** Calibrated content output tokens per chunk (default 800). */
  estOutputPerChunk?: number;
  promptOverheadTokens?: number;
  /** Amortization floor per batch (default 4 chunks). */
  minSegmentsPerBatch?: number;
  /**
   * Split the same body into two route tasks - characters/relations/states/
   * skill clues vs world rules/events/timeline (plan P1 §4). Default single.
   */
  routes?: 'single' | 'dual';
}

interface Budgets {
  maxChunksPerBatch: number;
  bodyCeil: number;
}

function budgetLimits(
  budget: ModelBudget,
  options: Required<Pick<ChapterBatchPlanOptions, 'estOutputPerChunk' | 'promptOverheadTokens' | 'minSegmentsPerBatch' | 'bodyTargetRatio'>>,
): Budgets {
  const windowBodyRoom = budget.contextWindowTokens - budget.maxContentOutputTokens
    - budget.reasoningReserveTokens - budget.reserveTokens - options.promptOverheadTokens;
  if (windowBodyRoom <= 0) {
    throw new Error('Model budget leaves no room for any batch body.');
  }
  const bodyCeil = Math.min(
    windowBodyRoom,
    Math.floor(budget.contextWindowTokens * options.bodyTargetRatio),
  );
  if (bodyCeil <= 0) {
    throw new Error(`Body target ratio ${options.bodyTargetRatio} leaves no body room.`);
  }
  const outputBudget = Math.floor(budget.maxContentOutputTokens * OUTPUT_BUDGET_RATIO);
  const maxChunksPerBatch = Math.max(
    options.minSegmentsPerBatch,
    Math.floor(outputBudget / options.estOutputPerChunk),
  );
  return { maxChunksPerBatch, bodyCeil };
}

function batchFromSegments(ord: number, segments: ExtractSegment[], chapterIds: string[], route?: ExtractionRoute): PlannedBatch {
  const batch: PlannedBatch = {
    ord,
    segments,
    chapterIds,
    estInputTokens: segments.reduce((sum, segment) => sum + Math.ceil(segment.charCount), 0),
    inputHashSeed: segments.map(segment => segment.chunkId).join('|'),
  };
  if (route) batch.route = route;
  return batch;
}

/**
 * Plans chapter-aligned extraction batches over the given chunks. `chapters`
 * and `chunks` come from the source store; every chunk must belong to a
 * listed chapter or the plan throws (coverage must be provable).
 */
export function planChapterBatches(
  chapters: readonly SourceChapter[],
  chunks: readonly SourceChunk[],
  budget: ModelBudget,
  options: ChapterBatchPlanOptions = {},
): PlannedBatch[] {
  const estOutputPerChunk = Math.max(1, options.estOutputPerChunk ?? DEFAULT_EST_OUTPUT_PER_CHUNK);
  const promptOverhead = options.promptOverheadTokens ?? DEFAULT_PROMPT_OVERHEAD_TOKENS;
  const minSegments = Math.max(1, options.minSegmentsPerBatch ?? MIN_OUTPUT_DRIVEN_SEGMENTS);
  const bodyTargetRatio = options.bodyTargetRatio ?? BODY_TARGET_LADDER[0];
  const routes = options.routes ?? 'single';
  const { maxChunksPerBatch, bodyCeil } = budgetLimits(budget, {
    estOutputPerChunk, promptOverheadTokens: promptOverhead, minSegmentsPerBatch: minSegments, bodyTargetRatio,
  });

  const orderedChapters = [...chapters].sort((a, b) => a.index - b.index);
  const chunksByChapter = new Map<string, SourceChunk[]>();
  for (const chunk of chunks) {
    const list = chunksByChapter.get(chunk.chapterId);
    if (list) list.push(chunk);
    else chunksByChapter.set(chunk.chapterId, [chunk]);
  }
  for (const [chapterId, list] of chunksByChapter) {
    list.sort((a, b) => a.chunkIndex - b.chunkIndex);
    if (!orderedChapters.some(chapter => chapter.chapterId === chapterId)) {
      throw new Error(`Chunk ${list[0]?.chunkId} belongs to unknown chapter ${chapterId}.`);
    }
  }

  // Pass 1: chunk runs - consecutive chunk sequences bounded by both budgets.
  // Chapter boundaries are preferred split points; an oversized chapter is
  // split at chunk boundaries as the only sanctioned case.
  type Run = { segments: ExtractSegment[]; chapterIds: string[] };
  const runs: Run[] = [];
  let current: Run | null = null;
  const flushRun = () => {
    if (current && current.segments.length > 0) runs.push(current);
    current = null;
  };
  for (const chapter of orderedChapters) {
    const chapterChunks = chunksByChapter.get(chapter.chapterId) ?? [];
    if (chapterChunks.length === 0) continue;
    const chunkCount = chapterChunks.length;
    let splitStart = 0;
    while (splitStart < chunkCount) {
      // How many chunks of this chapter can still join the current run?
      const capacity = current ? maxChunksPerBatch - current.segments.length : maxChunksPerBatch;
      if (capacity <= 0) {
        flushRun();
        continue;
      }
      const take = Math.min(capacity, chunkCount - splitStart);
      const part = chapterChunks.slice(splitStart, splitStart + take);
      let bodyTokens = current ? current.segments.reduce((s, seg) => s + Math.ceil(seg.charCount), 0) : 0;
      let fitting = 0;
      for (const chunk of part) {
        const chunkTokens = Math.ceil(chunk.charCount);
        if (current && current.segments.length + fitting >= minSegments && bodyTokens + chunkTokens > bodyCeil) break;
        if (!current && fitting >= minSegments && bodyTokens + chunkTokens > bodyCeil) break;
        bodyTokens += chunkTokens;
        fitting += 1;
      }
      if (fitting === 0) {
        // Even one chunk overflows the body ceiling: with a sane budget this
        // cannot happen for chunk-sized bodies; guard anyway by taking one.
        fitting = 1;
      }
      const chosen = part.slice(0, fitting);
      if (!current) {
        current = { segments: [], chapterIds: [] };
      }
      for (const chunk of chosen) {
        current.segments.push({
          chunkId: chunk.chunkId,
          chapterId: chunk.chapterId,
          startCp: chunk.startOffset,
          endCp: chunk.endOffset,
          charCount: chunk.charCount,
        });
      }
      if (!current.chapterIds.includes(chapter.chapterId)) current.chapterIds.push(chapter.chapterId);
      splitStart += fitting;
      if (current.segments.length >= maxChunksPerBatch) flushRun();
    }
  }
  flushRun();

  // Coverage invariant: exact, ordered, no holes, no duplicates.
  const planned = runs.flatMap(run => run.segments);
  const orderedChunks = orderChunksByChapter(chapters, chunks);
  if (planned.length !== orderedChunks.length) {
    throw new Error(`Chapter batch plan lost chunks: ${planned.length}/${orderedChunks.length}.`);
  }
  for (let i = 0; i < planned.length; i += 1) {
    if (planned[i]?.chunkId !== orderedChunks[i]?.chunkId) {
      throw new Error('Chapter batch plan changed chunk order.');
    }
  }

  // Pass 2: route fan-out (dual route duplicates each run with a route tag;
  // the two units share coverage but carry distinct identities).
  const batches: PlannedBatch[] = [];
  if (routes === 'dual') {
    for (const run of runs) {
      batches.push(batchFromSegments(batches.length, run.segments, run.chapterIds, 'characters'));
      batches.push(batchFromSegments(batches.length, run.segments, run.chapterIds, 'world'));
    }
  } else {
    for (const run of runs) {
      batches.push(batchFromSegments(batches.length, run.segments, run.chapterIds));
    }
  }
  return batches;
}
