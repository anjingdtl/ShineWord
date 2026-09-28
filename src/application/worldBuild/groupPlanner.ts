/**
 * Model-budget-driven extract group planner (closeout C3, plan §7.1/§7.2).
 *
 * Physical chunks (bounded I/O, ~1200 cp) are packed into LLM groups so one
 * request amortizes the prompt while staying inside a VERIFIED model budget:
 * system + group body + output reserve + safety margin <= context window.
 * Chapters, storage chunks and model groups stay decoupled: a group is a
 * list of consecutive chunk ranges plus a coverage ledger.
 */
import type { SourceChapter, SourceChunk } from '../../domain/world/types';

export interface ModelBudget {
  /** Verified context window of the model, in tokens. */
  contextWindowTokens: number;
  /** Output the model may produce for one request. */
  maxOutputTokens: number;
  /** Safety margin for reasoning tokens, schema, formatting drift. */
  reserveTokens: number;
}

export const DEFAULT_MODEL_BUDGET: ModelBudget = {
  contextWindowTokens: 128_000,
  maxOutputTokens: 8_000,
  reserveTokens: 2_000,
};

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
  /** Hard cap on one group's body even when the budget would allow more. */
  maxGroupSegments?: number;
}

export function planExtractGroups(
  chunks: readonly SourceChunk[],
  budget: ModelBudget = DEFAULT_MODEL_BUDGET,
  options: GroupPlanOptions = {},
): ExtractGroup[] {
  const overhead = options.promptOverheadTokens ?? 1_500;
  const maxSegments = options.maxGroupSegments ?? 64;
  const bodyBudget = budget.contextWindowTokens - budget.maxOutputTokens
    - budget.reserveTokens - overhead;
  if (bodyBudget <= 0) {
    throw new Error('Model budget leaves no room for any group body.');
  }

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
    if (current.length > 0 && (currentTokens + chunkTokens > bodyBudget || current.length >= maxSegments)) {
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

/** Chapter titles for the group prompt headers, by chapterId. */
export function chapterTitleIndex(chapters: readonly SourceChapter[]): Map<string, string> {
  return new Map(chapters.map(chapter => [chapter.chapterId, chapter.title]));
}
