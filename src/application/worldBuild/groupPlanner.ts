/**
 * Model-budget-driven extract group planner (closeout C3, 1M resident plan §5).
 *
 * Physical chunks (bounded I/O, ~1200 cp) are packed into LLM groups so one
 * request amortizes the prompt while staying inside a VERIFIED model budget.
 * Since the 1M redesign, packing is OUTPUT-budget driven: the group size is
 * what the model can ANSWER for, not merely what fits in the input window -
 * chunksPerGroup = clamp(maxContentOutputTokens * 0.7 / estOutputPerChunk,
 * 4, maxGroupSegments). maxGroupSegments is the evidence-attribution
 * reliability cap; the input window still bounds the group body as a hard
 * ceiling. Chapters, storage chunks and model groups stay decoupled: a group
 * is a list of consecutive chunk ranges plus a coverage ledger.
 */
import type { SourceChapter, SourceChunk } from '../../domain/world/types';
import type { LegacyReasoningEffort } from '../llm/types';

/** @deprecated Compatibility alias for old frozen world-build records. */
export type ReasoningEffort = LegacyReasoningEffort;

export interface ModelBudget {
  /** Verified context window of the model, in tokens. */
  contextWindowTokens: number;
  /** Content (JSON body) output budget per request, EXCLUDING reasoning. */
  maxContentOutputTokens: number;
  /** Chain-of-thought reserve on top of the content budget (GLM low = 2,048). */
  reasoningReserveTokens: number;
  /** @deprecated Legacy run compatibility; new runs use the shared tier policy. */
  reasoningEffort: ReasoningEffort;
  /** Probe-determined prefix-cache support (resident-mode gate). */
  supportsPromptCache: boolean;
  /** Safety margin for schema, formatting drift. */
  reserveTokens: number;
}

export const DEFAULT_MODEL_BUDGET: ModelBudget = {
  contextWindowTokens: 128_000,
  maxContentOutputTokens: 16_384,
  reasoningReserveTokens: 0,
  reasoningEffort: 'off',
  supportsPromptCache: false,
  reserveTokens: 2_000,
};

export const DEFAULT_PROMPT_OVERHEAD_TOKENS = 1_500;
/** Evidence-attribution reliability cap (1M plan §5). */
export const DEFAULT_MAX_GROUP_SEGMENTS = 32;
/** Amortization floor: an output-budget group never packs fewer chunks. */
export const MIN_OUTPUT_DRIVEN_SEGMENTS = 4;
export const DEFAULT_EST_OUTPUT_PER_CHUNK = 800;
/** Fraction of the content output budget usable for estimated chunk output. */
export const OUTPUT_BUDGET_RATIO = 0.7;

/**
 * Conservative token estimate: CJK code points cost ~1 token each, other
 * text ~0.3. Deliberately pessimistic rather than exact (plan §7.2); actual
 * provider usage is recorded per unit to calibrate.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0x2e80 && code <= 0x9fff || code >= 0x3000 && code <= 0x303f
      || code >= 0xff00 && code <= 0xffef || code >= 0x3400 && code <= 0x4dbf) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk + other * 0.3);
}

export interface ExtractSegment {
  chunkId: string;
  chapterId: string;
  startCp: number;
  endCp: number;
  charCount: number;
}

export interface ExtractGroup {
  ord: number;
  segments: ExtractSegment[];
  /** Estimated input tokens for the group body (without prompt overhead). */
  estInputTokens: number;
  /** Joined member chunk content hashes - the unit's input identity. */
  inputHashSeed: string;
}

export interface GroupPlanOptions {
  /** Fixed per-request overhead estimate (system prompt, schema, headers). */
  promptOverheadTokens?: number;
  /** Evidence-attribution reliability cap for one group (default 32). */
  maxGroupSegments?: number;
  /** Estimated content output tokens per chunk (default 800; §5 calibration). */
  estOutputPerChunk?: number;
}

export function planExtractGroups(
  chunks: readonly SourceChunk[],
  budget: ModelBudget = DEFAULT_MODEL_BUDGET,
  options: GroupPlanOptions = {},
): ExtractGroup[] {
  const overhead = options.promptOverheadTokens ?? DEFAULT_PROMPT_OVERHEAD_TOKENS;
  const maxSegments = options.maxGroupSegments ?? DEFAULT_MAX_GROUP_SEGMENTS;
  const estOutputPerChunk = Math.max(1, options.estOutputPerChunk ?? DEFAULT_EST_OUTPUT_PER_CHUNK);
  const bodyBudget = budget.contextWindowTokens - budget.maxContentOutputTokens
    - budget.reasoningReserveTokens - budget.reserveTokens - overhead;
  if (bodyBudget <= 0) {
    throw new Error('Model budget leaves no room for any group body.');
  }
  const outputBudget = Math.floor(budget.maxContentOutputTokens * OUTPUT_BUDGET_RATIO);
  const chunksPerGroup = Math.min(
    maxSegments,
    Math.max(MIN_OUTPUT_DRIVEN_SEGMENTS, Math.floor(outputBudget / estOutputPerChunk)),
  );

  const groups: ExtractGroup[] = [];
  let current: ExtractSegment[] = [];
  let currentTokens = 0;
  const flush = () => {
    if (current.length === 0) return;
    groups.push({
      ord: groups.length,
      segments: current,
      estInputTokens: currentTokens,
      inputHashSeed: current.map(segment => segment.chunkId).join('|'),
    });
    current = [];
    currentTokens = 0;
  };
  for (const chunk of chunks) {
    // Conservative upper bound: worst case one token per code point.
    const chunkTokens = Math.ceil(chunk.charCount);
    if (current.length > 0 && (currentTokens + chunkTokens > bodyBudget || current.length >= chunksPerGroup)) {
      flush();
    }
    current.push({
      chunkId: chunk.chunkId,
      chapterId: chunk.chapterId,
      startCp: chunk.startOffset,
      endCp: chunk.endOffset,
      charCount: chunk.charCount,
    });
    currentTokens += chunkTokens;
  }
  flush();

  // Coverage invariant: every chunk lands in exactly one group, in order.
  const planned = groups.flatMap(group => group.segments);
  if (planned.length !== chunks.length) {
    throw new Error(`Group plan lost chunks: ${planned.length}/${chunks.length}.`);
  }
  for (let i = 0; i < planned.length; i += 1) {
    if (planned[i]?.chunkId !== chunks[i]?.chunkId) {
      throw new Error('Group plan changed chunk order.');
    }
  }
  return groups;
}

export const CALIBRATION_FIRST_CHECKPOINT_GROUPS = 3;
export const CALIBRATION_INTERVAL_GROUPS = 10;
export const CALIBRATION_WINDOW_GROUPS = 10;

/**
 * Online calibration of estOutputPerChunk from measured unit usage (§3.3/§5):
 * one recalibration after the first 3 completed group units, then one every
 * 10 groups; the estimate is the sliding per-chunk mean of measured content
 * output tokens over the last 10 groups.
 */
export class OutputPerChunkCalibrator {
  private samples: Array<{ outputTokens: number; chunkCount: number }> = [];
  private estimate = DEFAULT_EST_OUTPUT_PER_CHUNK;

  record(outputTokens: number, chunkCount: number): void {
    if (!Number.isFinite(outputTokens) || outputTokens < 0 || chunkCount < 1) return;
    this.samples.push({ outputTokens: Math.ceil(outputTokens), chunkCount });
    if (this.samples.length > CALIBRATION_WINDOW_GROUPS * 2) {
      this.samples = this.samples.slice(-CALIBRATION_WINDOW_GROUPS);
    }
  }

  /** Whether a recalibration checkpoint fires after `completedGroups` groups. */
  due(completedGroups: number): boolean {
    if (completedGroups === CALIBRATION_FIRST_CHECKPOINT_GROUPS) return true;
    return completedGroups > CALIBRATION_FIRST_CHECKPOINT_GROUPS
      && (completedGroups - CALIBRATION_FIRST_CHECKPOINT_GROUPS) % CALIBRATION_INTERVAL_GROUPS === 0;
  }

  recalibrate(): number {
    const window = this.samples.slice(-CALIBRATION_WINDOW_GROUPS);
    if (window.length === 0) return this.estimate;
    const chunkTotal = window.reduce((sum, sample) => sum + sample.chunkCount, 0);
    if (chunkTotal === 0) return this.estimate;
    const outputTotal = window.reduce((sum, sample) => sum + sample.outputTokens, 0);
    this.estimate = Math.max(1, Math.ceil(outputTotal / chunkTotal));
    return this.estimate;
  }

  get currentEstimate(): number {
    return this.estimate;
  }
}

/**
 * How many contiguous parts an over-output group splits into: at least two
 * (the transactional halving), more only when the calibrated per-chunk
 * estimate says even a half would exceed the output budget. Pure function so
 * the split stays deterministic and testable.
 */
export function splitPartCount(
  totalChunks: number,
  estOutputPerChunk: number,
  maxContentOutputTokens: number,
): number {
  if (totalChunks <= 1) return 1;
  const outputBudget = Math.max(1, Math.floor(maxContentOutputTokens * OUTPUT_BUDGET_RATIO));
  const maxPerPart = Math.max(1, Math.floor(outputBudget / Math.max(1, estOutputPerChunk)));
  return Math.max(2, Math.ceil(totalChunks / Math.min(totalChunks, maxPerPart)));
}

/** Chapter titles for the group prompt headers, by chapterId. */
export function chapterTitleIndex(chapters: readonly SourceChapter[]): Map<string, string> {
  return new Map(chapters.map(chapter => [chapter.chapterId, chapter.title]));
}
