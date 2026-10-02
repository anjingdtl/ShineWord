/**
 * Analysis-batch planner v2 (planner-v2 / plan-analysis-1).
 *
 * Storage chunks are the EVIDENCE and persistence boundary (~1,200 cp each);
 * they are NOT the LLM request unit. This planner decouples the two for good:
 *
 *   Novel -> Chapter -> Storage Chunk -> Analysis Slice -> LLM Batch
 *
 *   - Chapter  = the novel's semantic boundary.
 *   - Storage chunk = the data/evidence boundary (kept as-is).
 *   - AnalysisSlice = the semantic text block handed to the model: one whole
 *     chapter, or a contiguous run of one over-long chapter's chunks.
 *   - LLM Batch  = the set of AnalysisSlices one physical API request covers.
 *
 * Batch size is decided ONLY by token budgets:
 *
 *   hardInputBudget  = contextWindow - reasoningReserve - maxContentOutput
 *                      - promptOverhead - safetyMargin
 *   sourceTarget     = min(contextWindow x sourceRatio,
 *                          hardInputBudget,
 *                          outputDensityBudget)
 *   outputDensityBudget = usableContentOutput / calibratedDensity
 *
 * There is no chunk-count cap (no 14, no 32): 100 storage chunks may share one
 * batch when the budgets allow, and one over-long chapter is sliced at chunk
 * boundaries instead. Coverage stays exact: every chunk lands in exactly one
 * batch, in canonical order, with no holes and no duplicates.
 *
 * Probe ladder (§6): the source ratio starts conservative (12%), grows on
 * success (12% -> 20% -> 25% -> 30% max) and shrinks on recoverable output
 * failures (30% -> 20% -> 12% -> halving, floor 2%). The output side is
 * modelled by an extraction DENSITY (content output tokens per source input
 * token, initial conservative 6%) that is calibrated online from measured
 * usage - never again "800 tokens per storage chunk".
 */
import type { SourceChapter, SourceChunk } from '../../domain/world/types';
import { orderChunksByChapter } from './chapterBatchPlanner';
import type { ExtractSegment, ModelBudget } from './groupPlanner';

export const PLAN_VERSION_ANALYSIS = 'plan-analysis-1';

/** Probe ladder §6: start conservative, grow on success. */
export const SOURCE_RATIO_PROBE_START = 0.12;
export const SOURCE_RATIO_GROW_LADDER = [0.12, 0.20, 0.25, 0.30] as const;
export const SOURCE_RATIO_MAX = 0.30;
export const SOURCE_RATIO_SHRINK_LADDER = [0.30, 0.20, 0.12] as const;
export const SOURCE_RATIO_FLOOR = 0.02;

/**
 * Extraction density model §7: content output tokens per source input token.
 * The initial value is deliberately conservative (test window 4% - 8%); the
 * TokenDensityCalibrator replaces it with measured reality after the first
 * real batches.
 */
export const DEFAULT_EXTRACTION_DENSITY = 0.06;
export const MIN_CALIBRATED_DENSITY = 0.005;
export const MAX_CALIBRATED_DENSITY = 0.5;
/** Fraction of the content output budget the planner is willing to predict-fill. */
export const OUTPUT_USABLE_RATIO = 0.85;
/** Per-slice prompt header token estimate ([S# title] line). */
export const SLICE_HEADER_OVERHEAD_TOKENS = 24;

/** Next ratio on the grow ladder; the current value when already at the top. */
export function nextSourceRatioUp(current: number): number {
  for (const step of SOURCE_RATIO_GROW_LADDER) {
    if (step > current + 1e-9) return step;
  }
  return Math.min(current, SOURCE_RATIO_MAX);
}

/** Next ratio on the shrink ladder (30% -> 20% -> 12% -> halving to floor). */
export function nextSourceRatioDown(current: number): number {
  for (const step of SOURCE_RATIO_SHRINK_LADDER) {
    if (step < current - 1e-9) return step;
  }
  const halved = current / 2;
  return halved >= SOURCE_RATIO_FLOOR ? halved : Math.min(current, SOURCE_RATIO_FLOOR);
}

export function clampDensity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EXTRACTION_DENSITY;
  return Math.min(MAX_CALIBRATED_DENSITY, Math.max(MIN_CALIBRATED_DENSITY, value));
}

export interface AnalysisBatchBudget {
  /** Hard input room left after output, reasoning, overhead and safety. */
  hardInputBudget: number;
  /** Operational packing target for source text in ONE request. */
  sourceTargetTokens: number;
  /** Input tokens whose predicted extraction output fills the usable budget. */
  densityBudgetTokens: number;
  /** Usable content output budget (maxContentOutputTokens x ratio). */
  usableOutputTokens: number;
  sourceRatio: number;
  density: number;
}

/**
 * Resolves the one-requests's source-text budget from the model budget. The
 * minimum of the window share, the hard input room and the output-density
 * budget; never a chunk count.
 */
export function resolveAnalysisBatchBudget(
  budget: ModelBudget,
  options: { sourceRatio?: number; density?: number; promptOverheadTokens?: number } = {},
): AnalysisBatchBudget {
  const sourceRatio = Math.min(SOURCE_RATIO_MAX, Math.max(SOURCE_RATIO_FLOOR, options.sourceRatio ?? SOURCE_RATIO_PROBE_START));
  const density = clampDensity(options.density ?? DEFAULT_EXTRACTION_DENSITY);
  const overhead = options.promptOverheadTokens ?? 1_500;
  const hardInputBudget = budget.contextWindowTokens - budget.maxContentOutputTokens
    - budget.reasoningReserveTokens - budget.reserveTokens - overhead;
  if (hardInputBudget <= 0) {
    throw new Error('Model budget leaves no room for any analysis batch body.');
  }
  const usableOutputTokens = Math.floor(budget.maxContentOutputTokens * OUTPUT_USABLE_RATIO);
  const densityBudgetTokens = Math.max(1, Math.floor(usableOutputTokens / density));
  const sourceTargetTokens = Math.max(
    1,
    Math.min(
      Math.floor(budget.contextWindowTokens * sourceRatio),
      hardInputBudget,
      densityBudgetTokens,
    ),
  );
  return { hardInputBudget, sourceTargetTokens, densityBudgetTokens, usableOutputTokens, sourceRatio, density };
}

/**
 * The semantic text block handed to the model. A slice covers one whole
 * chapter, or - only when that chapter alone exceeds the batch body budget -
 * a contiguous run of the chapter's storage chunks. Member ranges keep the
 * slice <-> storage-chunk mapping so evidence attribution stays exact.
 */
export interface AnalysisSlice {
  sliceId: string;
  chapterId: string;
  chapterTitle: string;
  /** Absolute normalized codepoint range [startCp, endCp). */
  startCp: number;
  endCp: number;
  memberChunkIds: string[];
  memberRanges: Array<{ chunkId: string; chapterId: string; startCp: number; endCp: number }>;
  /** Conservative input-token estimate including the slice header. */
  estimatedInputTokens: number;
}

/** Chapter-first slicing: whole chapters, over-long chapters split at chunk boundaries. */
export function buildAnalysisSlices(
  chapters: readonly SourceChapter[],
  chunks: readonly SourceChunk[],
  maxSliceTokens: number,
): AnalysisSlice[] {
  if (chunks.length === 0) return [];
  const orderedChapters = [...chapters].sort((a, b) => a.index - b.index);
  const chunksByChapter = new Map<string, SourceChunk[]>();
  for (const chunk of orderChunksByChapter(chapters, chunks)) {
    const list = chunksByChapter.get(chunk.chapterId);
    if (list) list.push(chunk);
    else chunksByChapter.set(chunk.chapterId, [chunk]);
  }
  const titleByChapter = new Map(orderedChapters.map(chapter => [chapter.chapterId, chapter.title]));
  const chunkTokens = (chunk: SourceChunk): number => Math.ceil(chunk.charCount);

  const slices: AnalysisSlice[] = [];
  for (const chapter of orderedChapters) {
    const chapterChunks = chunksByChapter.get(chapter.chapterId);
    if (!chapterChunks || chapterChunks.length === 0) continue;
    let partIndex = 0;
    let run: SourceChunk[] = [];
    let runTokens = 0;
    const flushRun = () => {
      if (run.length === 0) return;
      const first = run[0]!;
      const last = run[run.length - 1]!;
      slices.push({
        sliceId: `slice-${chapter.chapterId}-p${partIndex}`,
        chapterId: chapter.chapterId,
        chapterTitle: titleByChapter.get(chapter.chapterId) ?? chapter.chapterId,
        startCp: first.startOffset,
        endCp: last.endOffset,
        memberChunkIds: run.map(chunk => chunk.chunkId),
        memberRanges: run.map(chunk => ({
          chunkId: chunk.chunkId,
          chapterId: chunk.chapterId,
          startCp: chunk.startOffset,
          endCp: chunk.endOffset,
        })),
        estimatedInputTokens: runTokens + SLICE_HEADER_OVERHEAD_TOKENS,
      });
      partIndex += 1;
      run = [];
      runTokens = 0;
    };
    for (const chunk of chapterChunks) {
      const tokens = chunkTokens(chunk);
      if (run.length > 0 && runTokens + tokens > maxSliceTokens) flushRun();
      run.push(chunk);
      runTokens += tokens;
    }
    flushRun();
  }
  return slices;
}

export type AnalysisRoute = 'characters' | 'world';

export interface AnalysisBatch {
  ord: number;
  /** Semantic slices in this batch, in order. */
  slices: AnalysisSlice[];
  chapterIds: string[];
  /** Chunk-level coverage ledger (unchanged downstream contract). */
  segments: ExtractSegment[];
  estInputTokens: number;
  inputHashSeed: string;
  route?: AnalysisRoute;
}

export interface AnalysisBatchPlanOptions {
  sourceRatio?: number;
  density?: number;
  promptOverheadTokens?: number;
  routes?: 'single' | 'dual';
}

/**
 * Plans chapter-first, token-budget-bounded analysis batches over the source
 * chunks. Storage chunks ride along as the coverage ledger only; their count
 * never bounds the batch.
 */
export function planAnalysisBatches(
  chapters: readonly SourceChapter[],
  chunks: readonly SourceChunk[],
  budget: ModelBudget,
  options: AnalysisBatchPlanOptions = {},
): AnalysisBatch[] {
  const resolved = resolveAnalysisBatchBudget(budget, options);
  const slices = buildAnalysisSlices(chapters, chunks, resolved.sourceTargetTokens);

  type Run = { slices: AnalysisSlice[]; chapterIds: string[]; tokens: number };
  const runs: Run[] = [];
  let current: Run | null = null;
  const flush = () => {
    if (current && current.slices.length > 0) runs.push(current);
    current = null;
  };
  for (const slice of slices) {
    if (current && current.tokens + slice.estimatedInputTokens > resolved.sourceTargetTokens) {
      flush();
    }
    if (!current) current = { slices: [], chapterIds: [], tokens: 0 };
    current.slices.push(slice);
    if (!current.chapterIds.includes(slice.chapterId)) current.chapterIds.push(slice.chapterId);
    current.tokens += slice.estimatedInputTokens;
  }
  flush();

  // Coverage invariant: the flattened chunk ledger is exactly the ordered
  // chunk list - no holes, no duplicates, no reordering.
  const orderedChunks = orderChunksByChapter(chapters, chunks);
  const planned = runs.flatMap(run => run.slices.flatMap(slice => slice.memberRanges));
  if (planned.length !== orderedChunks.length) {
    throw new Error(`Analysis batch plan lost chunks: ${planned.length}/${orderedChunks.length}.`);
  }
  for (let i = 0; i < planned.length; i += 1) {
    if (planned[i]?.chunkId !== orderedChunks[i]?.chunkId) {
      throw new Error('Analysis batch plan changed chunk order.');
    }
  }

  const routes = options.routes ?? 'single';
  const batches: AnalysisBatch[] = [];
  const makeBatch = (run: Run, ord: number, route?: AnalysisRoute): AnalysisBatch => {
    const segments = run.slices.flatMap(slice => slice.memberRanges).map(range => ({
      chunkId: range.chunkId,
      chapterId: range.chapterId,
      startCp: range.startCp,
      endCp: range.endCp,
      charCount: range.endCp - range.startCp,
    }));
    const batch: AnalysisBatch = {
      ord,
      slices: run.slices,
      chapterIds: run.chapterIds,
      segments,
      estInputTokens: run.tokens,
      inputHashSeed: run.slices.map(slice => `${slice.sliceId}:${slice.startCp}-${slice.endCp}:` +
        slice.memberChunkIds.map(id => `${id}:${orderedChunks.find(chunk => chunk.chunkId === id)!.contentHash}`).join(',')).join('|'),
    };
    if (route) batch.route = route;
    return batch;
  };
  if (routes === 'dual') {
    for (const run of runs) {
      batches.push(makeBatch(run, batches.length, 'characters'));
      batches.push(makeBatch(run, batches.length, 'world'));
    }
  } else {
    for (const run of runs) {
      batches.push(makeBatch(run, batches.length));
    }
  }
  return batches;
}

/**
 * Online extraction-density calibration (§7): density = measured CONTENT
 * output tokens / measured source input tokens over a sliding window of
 * completed batches. Replaces the chunk-count based OutputPerChunkCalibrator
 * for planner-v2 runs.
 */
export const DENSITY_CHECKPOINT_BATCHES = [1, 2, 3] as const;
export const DENSITY_INTERVAL_BATCHES = 3;
export const DENSITY_WINDOW_BATCHES = 10;

export class TokenDensityCalibrator {
  private samples: Array<{ inputTokens: number; outputTokens: number }> = [];
  private density: number;

  constructor(initialDensity: number = DEFAULT_EXTRACTION_DENSITY) {
    this.density = clampDensity(initialDensity);
  }

  /** Records one completed batch's measured usage (content tokens, no reasoning). */
  record(inputTokens: number, contentOutputTokens: number): void {
    if (!Number.isFinite(inputTokens) || inputTokens <= 0
      || !Number.isFinite(contentOutputTokens) || contentOutputTokens < 0) return;
    this.samples.push({ inputTokens: Math.ceil(inputTokens), outputTokens: Math.ceil(contentOutputTokens) });
    if (this.samples.length > DENSITY_WINDOW_BATCHES * 2) {
      this.samples = this.samples.slice(-DENSITY_WINDOW_BATCHES);
    }
  }

  /** Whether a calibration checkpoint fires after `completedBatches` batches. */
  due(completedBatches: number): boolean {
    if ((DENSITY_CHECKPOINT_BATCHES as readonly number[]).includes(completedBatches)) return true;
    const lastCheckpoint = Math.max(...DENSITY_CHECKPOINT_BATCHES);
    return completedBatches > lastCheckpoint
      && (completedBatches - lastCheckpoint) % DENSITY_INTERVAL_BATCHES === 0;
  }

  recalibrate(): number {
    const window = this.samples.slice(-DENSITY_WINDOW_BATCHES);
    if (window.length === 0) return this.density;
    const inputTotal = window.reduce((sum, sample) => sum + sample.inputTokens, 0);
    if (inputTotal <= 0) return this.density;
    const outputTotal = window.reduce((sum, sample) => sum + sample.outputTokens, 0);
    this.density = clampDensity(outputTotal / inputTotal);
    return this.density;
  }

  get currentDensity(): number {
    return this.density;
  }
}

/** Predicted content output for a batch of `inputTokens` source tokens. */
export function predictOutputTokens(inputTokens: number, density: number): number {
  return Math.ceil(inputTokens * clampDensity(density));
}

/**
 * How many contiguous parts an over-output batch splits into under the
 * density model: at least two (the transactional halving), more only when the
 * calibrated density says even a half would overflow the usable budget.
 */
export function densitySplitPartCount(
  totalInputTokens: number,
  density: number,
  maxContentOutputTokens: number,
): number {
  if (totalInputTokens <= 0) return 1;
  const usable = Math.max(1, Math.floor(maxContentOutputTokens * OUTPUT_USABLE_RATIO));
  const predicted = predictOutputTokens(totalInputTokens, density);
  if (predicted <= usable) return 1;
  return Math.max(2, Math.ceil(predicted / usable));
}

/**
 * Largest grow-ladder ratio whose predicted output still fits the usable
 * budget at the given density - caps growth before it buys truncations.
 */
export function capSourceRatioByDensity(
  budget: ModelBudget,
  density: number,
  candidates?: readonly number[],
): number {
  const ladder = candidates ?? SOURCE_RATIO_GROW_LADDER;
  const usable = Math.max(1, Math.floor(budget.maxContentOutputTokens * OUTPUT_USABLE_RATIO));
  let best = SOURCE_RATIO_FLOOR;
  for (const ratio of ladder) {
    const inputAtRatio = Math.floor(budget.contextWindowTokens * ratio);
    if (predictOutputTokens(inputAtRatio, density) <= usable) best = ratio;
  }
  return best;
}
