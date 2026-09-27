import type { SkillRank } from '../rules/types';

export const SKILL_RANK_ORDER: readonly SkillRank[] = [
  'untrained',
  'novice',
  'trained',
  'expert',
  'master',
];

/** Practice points required to advance FROM each rank to the next. */
export const PRACTICE_THRESHOLDS: Readonly<Record<SkillRank, number>> = {
  untrained: 5,
  novice: 10,
  trained: 20,
  expert: 40,
  master: Number.POSITIVE_INFINITY,
};

export interface SkillProgress {
  skillId: string;
  rank: SkillRank;
  practicePoints: number;
  /** Turn ids that already awarded practice for this skill (dedup per encounter). */
  awardedTurns: readonly string[];
}

export function rankIndex(rank: SkillRank): number {
  return SKILL_RANK_ORDER.indexOf(rank);
}

/**
 * Awards one practice point for an independent risky encounter. The same turn
 * can never award the same skill twice, which also blocks rewind-replay
 * farming: a replayed turn id finds itself in awardedTurns.
 */
export function awardPractice(
  progress: SkillProgress,
  turnId: string,
): SkillProgress {
  if (progress.awardedTurns.includes(turnId)) return progress;
  if (progress.rank === 'master') return progress;
  return {
    ...progress,
    practicePoints: progress.practicePoints + 1,
    awardedTurns: [...progress.awardedTurns, turnId],
  };
}

export interface AdvancementCheck {
  advanced: boolean;
  nextRank: SkillRank | null;
  pointsRemaining: number;
  pointsSpent: number;
}

/**
 * Rank advancement consumes the full threshold and additionally requires the
 * world to allow the training conditions (checked by the caller); a single
 * roll can never unlock a rank by itself.
 */
export function checkAdvancement(progress: SkillProgress): AdvancementCheck {
  const threshold = PRACTICE_THRESHOLDS[progress.rank];
  if (!Number.isFinite(threshold) || progress.practicePoints < threshold) {
    return { advanced: false, nextRank: null, pointsRemaining: progress.practicePoints, pointsSpent: 0 };
  }
  const currentIndex = rankIndex(progress.rank);
  const nextRank: SkillRank | undefined = SKILL_RANK_ORDER[currentIndex + 1];
  if (!nextRank) {
    return { advanced: false, nextRank: null, pointsRemaining: progress.practicePoints, pointsSpent: 0 };
  }
  return {
    advanced: true,
    nextRank,
    pointsRemaining: progress.practicePoints - threshold,
    pointsSpent: threshold,
  };
}

export interface MilestoneRewardInput {
  skillId: string;
  currentRank: SkillRank;
  grantedRanks: number;
  /** Milestones may add up to 2 ranks to already-unlocked (non-untrained) skills. */
  maxRanks?: number;
}

/**
 * Milestone rewards: 1-2 ranks onto an already unlocked skill, never onto
 * untrained (a milestone cannot grant brand-new competence by itself), and
 * never beyond master.
 */
export function applyMilestoneReward(input: MilestoneRewardInput): SkillRank {
  const maxRanks = input.maxRanks ?? 2;
  if (input.grantedRanks < 1 || input.grantedRanks > maxRanks) {
    throw new Error(`Milestone rank grant must be between 1 and ${maxRanks}.`);
  }
  if (input.currentRank === 'untrained') {
    throw new Error('Milestone rewards cannot unlock an untrained skill.');
  }
  const nextIndex = Math.min(
    rankIndex(input.currentRank) + input.grantedRanks,
    rankIndex('master'),
  );
  const nextRank = SKILL_RANK_ORDER[nextIndex];
  if (!nextRank) throw new Error('Rank order is broken; this is a ruleset bug.');
  return nextRank;
}
