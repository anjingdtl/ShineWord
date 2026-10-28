/**
 * Local narration template (convergence W4c — approved D4, 2026-10-27).
 *
 * The T-B tier contract for `narrator`: the player is waiting, so the request
 * has a hard deadline plus a local fallback that must never enter the
 * outcome_unknown dead end. This module renders the fallback from FROZEN
 * authoritative facts only — the contract's public outcome summary, the
 * rolled grade and the dice — never novel text, player input, or invented
 * state. Text stays short and contains no duration claims, so it always
 * passes validateNarrative including assertNarrativeDurationFitsClock.
 */
import type { RollGrade, RollRecord } from '../../domain/rules/types';
import type { ActionContract } from '../../domain/turns/types';
import type { NarrativeCandidate } from './v2Turn';

/**
 * Hard deadline for receiving a narratable candidate. If the request is still
 * QUEUED when it fires, the queue signal aborts and the turn degrades to the
 * local template; a request already dispatched keeps its own transport
 * deadline and the existing outcome_unknown rules (never auto-degraded).
 */
export const NARRATOR_LOCAL_DEGRADE_DEADLINE_MS = 45_000;

/**
 * A transport failure this fast never completed a server roundtrip (a real
 * model call cannot return in under two seconds), so treating it as
 * pre-connection cannot double-bill. Only the T-B narrator path uses this;
 * the ledger attempt still records outcome_unknown and is never replayed.
 */
export const NARRATOR_FAST_FAIL_MS = 2_000;

const GRADE_LABEL: Record<RollGrade, string> = {
  full_success: '大成功',
  success: '成功',
  failure: '失败',
  severe_failure: '严重失败',
};

const GRADE_TAIL: Record<RollGrade, string> = {
  full_success: '一切顺利，局面对你明显有利。',
  success: '你达到了目的，局势推进了一步。',
  failure: '这次尝试没有奏效，需要另想办法。',
  severe_failure: '事情变得更糟了，代价不小。',
};

function rollLine(rollRecord: RollRecord | null | undefined): string {
  if (!rollRecord) return '';
  const dice = `${rollRecord.diceCount}d${rollRecord.dieSides}`;
  const rolls = `[${rollRecord.rolls.join(', ')}]`;
  return ` 检定 ${dice} ${rolls}（最高 ${rollRecord.highest}）。`;
}

/** Renders the degrade text from frozen contract facts only. Pure. */
export function localNarrationText(input: {
  grade: RollGrade;
  outcomeSummary: string;
  rollRecord?: RollRecord | null;
}): string {
  const summary = input.outcomeSummary.trim() || '行动已按规则结算。';
  return `（本地叙事）${GRADE_LABEL[input.grade]}：${summary}。${rollLine(input.rollRecord)}${GRADE_TAIL[input.grade]}`;
}

/** A degrade candidate validated by the same validateNarrative the model path uses. */
export function localNarrationCandidate(input: {
  contract: Pick<ActionContract, 'outcomes'>;
  turnId: string;
  grade: RollGrade;
  rollRecord?: RollRecord | null;
}): NarrativeCandidate {
  return {
    turnId: input.turnId,
    outcomeGrade: input.grade,
    text: localNarrationText({
      grade: input.grade,
      outcomeSummary: input.contract.outcomes[input.grade]?.publicSummary ?? '',
      rollRecord: input.rollRecord,
    }),
  };
}
