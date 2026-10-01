/**
 * Persistent 30/30/40 stage planning (unified build P3).
 *
 * The original book is split at SOURCE positions: ideal cut points at 30% and
 * 60% of the normalized code point count, snapped to the nearest chapter END
 * (ties choose the EARLIER boundary). Stage boundaries are narrative
 * positions, not story-world time - flashbacks and insertions never move a
 * boundary. The plan is deterministic for a given chapter layout, covered by
 * tests for: tiny books (stages may merge empty), mega single chapters
 * (chunk-level split), and exact no-hole/no-overlap coverage.
 *
 * The 30/30/40 ratios are ORIGINAL-BOOK stage fractions - each stage still
 * builds through chapter batches bounded by the model window (P1); a stage
 * is never one request.
 */
import type { SourceChapter } from '../../domain/world/types';

export const STAGE_PLAN_VERSION = 'stage-plan-1';
export const STAGE_RATIOS = [0.30, 0.30, 0.40] as const;
/** Near-boundary pre-build window: last 15% of a stage (calibratable). */
export const DEFAULT_BOUNDARY_PREBUILD_RATIO = 0.15;

export interface StageSlice {
  /** 0-based stage index (S1=0, S2=1, S3=2). */
  index: number;
  /** Inclusive-exclusive normalized codepoint range [startCp, endCp). */
  startCp: number;
  endCp: number;
  /** Chapter ids covered, in order (>=1 for non-empty stages). */
  chapterIds: string[];
  /** Actual fraction of the whole book this stage covers. */
  ratio: number;
}

export interface StagePlan {
  planVersion: typeof STAGE_PLAN_VERSION;
  strategy: 'full' | 'progressive';
  /** Total normalized codepoints of the source. */
  codePointCount: number;
  stages: StageSlice[];
}

/**
 * Computes stage slices over normalized codepoints. `chapters` must be the
 * ordered chapter list; `codePointCount` the whole normalized length. A book
 * too small to fill three non-empty stages merges later stages into earlier
 * ones (fewer stages is legal - "merge empty stages" - but coverage must
 * still be exact and contiguous from 0 to codePointCount).
 */
export function computeStagePlan(
  chapters: readonly SourceChapter[],
  codePointCount: number,
  options: { strategy?: 'full' | 'progressive'; ratios?: readonly [number, number, number] } = {},
): StagePlan {
  if (chapters.length === 0) throw new Error('Stage plan requires at least one chapter.');
  if (codePointCount <= 0) throw new Error('Stage plan requires a positive code point count.');
  const ratios = options.ratios ?? STAGE_RATIOS;
  const ordered = [...chapters].sort((a, b) => a.index - b.index);
  for (const chapter of ordered) {
    if (chapter.endOffset > codePointCount) {
      throw new Error(`Chapter ${chapter.chapterId} ends beyond the source length.`);
    }
  }

  // Ideal cut points at 0.30N and 0.60N; snap to the chapter end nearest to
  // the ideal point (ties -> the earlier boundary). b1 in (0, N), b2 in (b1, N).
  const idealB1 = Math.round(codePointCount * ratios[0]);
  const idealB2 = Math.round(codePointCount * (ratios[0] + ratios[1]));
  const chapterEnds = ordered.map(chapter => chapter.endOffset);
  const snapToChapterEnd = (ideal: number, minExclusive: number, maxExclusive: number): number => {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const end of chapterEnds) {
      if (end <= minExclusive || end >= maxExclusive) continue;
      const distance = Math.abs(end - ideal);
      if (distance < bestDistance || (distance === bestDistance && end < best)) {
        best = end;
        bestDistance = distance;
      }
    }
    return best;
  };
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  // A boundary must leave at least one chapter on each side.
  const b1 = snapToChapterEnd(idealB1, first.startOffset, last.endOffset);
  const b2 = b1 > 0 ? snapToChapterEnd(idealB2, b1, last.endOffset) : -1;

  const boundaries: number[] = [];
  const chapterIdsFor = (startCp: number, endCp: number): string[] =>
    ordered.filter(chapter => chapter.endOffset > startCp && chapter.startOffset < endCp)
      .map(chapter => chapter.chapterId);
  const pushStage = (startCp: number, endCp: number) => {
    const chapterIds = chapterIdsFor(startCp, endCp);
    if (chapterIds.length === 0) return; // merge empty stage
    boundaries.push(startCp);
  };

  if (b1 <= 0) {
    // Whole book is one stage (single chapter or nothing fits after the
    // first boundary): S1 covers everything.
    pushStage(0, codePointCount);
  } else if (b2 <= b1) {
    pushStage(0, b1);
    pushStage(b1, codePointCount);
  } else {
    pushStage(0, b1);
    pushStage(b1, b2);
    pushStage(b2, codePointCount);
  }
  if (boundaries.length === 0) {
    throw new Error('Stage plan produced no non-empty stages.');
  }
  boundaries.push(codePointCount);

  const stages: StageSlice[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const startCp = boundaries[i]!;
    const endCp = boundaries[i + 1]!;
    stages.push({
      index: stages.length,
      startCp,
      endCp,
      chapterIds: chapterIdsFor(startCp, endCp),
      ratio: (endCp - startCp) / codePointCount,
    });
  }
  // Coverage invariant: contiguous from 0, ends at N, no holes/overlap.
  if (stages[0]!.startCp !== 0 || stages[stages.length - 1]!.endCp !== codePointCount) {
    throw new Error('Stage plan does not cover the whole source.');
  }
  for (let i = 1; i < stages.length; i += 1) {
    if (stages[i]!.startCp !== stages[i - 1]!.endCp) {
      throw new Error('Stage plan has a hole or overlap.');
    }
  }
  return {
    planVersion: STAGE_PLAN_VERSION,
    strategy: options.strategy ?? 'progressive',
    codePointCount,
    stages,
  };
}

export type StageStatus =
  | 'untriggered' | 'queued' | 'building' | 'validating' | 'built'
  | 'pending_activation' | 'activated'
  | 'waiting_network' | 'waiting_unlock' | 'waiting_system'
  | 'paused' | 'failed';

export interface StageStateRecord {
  planId: string;
  stageIndex: number;
  status: StageStatus;
  runId: string | null;
  packageRevision: number | null;
  triggerReason: string | null;
  triggerDedupeKey: string | null;
  triggeredAt: string | null;
  updatedAt: string;
}

export interface StageTriggerDecision {
  stageIndex: number;
  reason: 'boundary_proximity' | 'dependency_demand';
  /** Stable dedupe key - repeated triggers with the same key collapse. */
  dedupeKey: string;
}

export interface NarrativeAnchorInput {
  /** Canon events with their world-time ordinal and source chapter. */
  events: ReadonlyArray<{ worldTimeOrder: number; narrativeChapterId: string | null }>;
  /** Normalized codepoint spans by chapterId. */
  chapterSpans: ReadonlyMap<string, { startCp: number; endCp: number }>;
  /** The campaign's locked opening order; null/0 = origin (no event spans). */
  anchorWorldTimeOrder: number | null;
  /** Evidence spans of the player's CURRENT scene location (may be empty). */
  locationSpans: ReadonlyArray<{ startCp: number; endCp: number }>;
}

/**
 * Narrative anchor derivation (unified P3 §3, "已确认场景/事件的来源锚点").
 * The play loop has no per-turn event confirmation artifact yet, so the
 * anchor is the FURTHEST source position the story verifiably stands at:
 *   - chapters of canon events at/below the campaign's locked opening order
 *     (where the campaign was born - static), UNION
 *   - evidence spans of the player's current scene location (where the scene
 *     is NOW - moves as the player travels into later-book geography).
 * Long stays in early locations therefore never sweep later stages, while a
 * late anchor or travel into the boundary window queues the pre-build.
 */
export function deriveNarrativeAnchorCp(input: NarrativeAnchorInput): number | null {
  const anchorOrder = input.anchorWorldTimeOrder ?? 0;
  let anchorCp: number | null = null;
  const consider = (endCp: number): void => {
    if (anchorCp === null || endCp > anchorCp) anchorCp = endCp;
  };
  if (anchorOrder > 0) {
    for (const event of input.events) {
      if (event.worldTimeOrder > anchorOrder) continue;
      const span = event.narrativeChapterId ? input.chapterSpans.get(event.narrativeChapterId) : undefined;
      if (span) consider(span.endCp);
    }
  }
  for (const span of input.locationSpans) consider(span.endCp);
  return anchorCp;
}

/**
 * Trigger evaluation (unified P3 §3): a next stage becomes queued when either
 *   - boundary proximity: the narrative anchor sits in the last 15% of the
 *     current built stage (pre-build intent), or
 *   - dependency demand: an entity/location/event the CURRENT action needs
 *     cites source spans that fall into the unbuilt stage.
 * Long stays never auto-sweep the book; time/turn counts are not triggers.
 */
export function evaluateStageTriggers(input: {
  plan: StagePlan;
  states: ReadonlyMap<number, Pick<StageStateRecord, 'status' | 'triggerDedupeKey'>>;
  /** Normalized codepoint anchor of the latest confirmed scene/event. */
  anchorCp?: number | null;
  /** Source spans needed by the action being prepared. */
  neededRanges?: ReadonlyArray<{ startCp: number; endCp: number }>;
  boundaryRatio?: number;
}): StageTriggerDecision[] {
  const { plan, states } = input;
  const boundaryRatio = input.boundaryRatio ?? DEFAULT_BOUNDARY_PREBUILD_RATIO;
  const decisions: StageTriggerDecision[] = [];
  const isBuiltOrPending = (index: number): boolean => {
    const state = states.get(index);
    return !!state && !['untriggered', 'failed'].includes(state.status);
  };
  for (const stage of plan.stages) {
    if (isBuiltOrPending(stage.index)) continue;
    // Only the NEXT unbuilt stage (in order) is ever triggerable.
    if (plan.stages.some(earlier => earlier.index < stage.index && !isBuiltOrPending(earlier.index))) {
      continue;
    }
    const previous = plan.stages[stage.index - 1];
    const prebuildWindowStart = previous
      ? previous.endCp - Math.floor((previous.endCp - previous.startCp) * boundaryRatio)
      : 0;
    if (typeof input.anchorCp === 'number' && input.anchorCp >= prebuildWindowStart
      && input.anchorCp < stage.startCp) {
      decisions.push({ stageIndex: stage.index, reason: 'boundary_proximity', dedupeKey: `proximity:${stage.index}` });
      continue;
    }
    const demanded = (input.neededRanges ?? []).some(range =>
      range.endCp > stage.startCp && range.startCp < stage.endCp);
    if (demanded) {
      decisions.push({ stageIndex: stage.index, reason: 'dependency_demand', dedupeKey: `demand:${stage.index}` });
    }
  }
  return decisions;
}

/** Stage label for UI/reports: S1/S2/S3 by index. */
export function stageLabel(index: number): string {
  return `S${index + 1}`;
}
