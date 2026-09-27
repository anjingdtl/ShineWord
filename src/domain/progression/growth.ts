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

export type RewardKind = 'practice' | 'milestone';

/** Reward dedup key inside one skill row: `encounterId:rewardKind`. */
export function rewardKey(encounterId: string, kind: RewardKind = 'practice'): string {
  return `${encounterId}:${kind}`;
}

export interface SkillProgress {
  skillId: string;
  rank: SkillRank;
  practicePoints: number;
  /**
   * Dedup keys `encounterId:rewardKind`. One independent encounter awards the
   * same skill at most once — replaying a turn or reopening a scene finds its
   * own key and is refused. (Column remains `awarded_turns_json` for storage
   * compatibility; the content is reward keys since Phase 2.)
   */
  awardedKeys: readonly string[];
}

export function rankIndex(rank: SkillRank): number {
  return SKILL_RANK_ORDER.indexOf(rank);
}

/**
 * Awards one practice point for an independent risky encounter. The same
 * encounter can never award the same skill twice, which also blocks
 * rewind-replay farming: a replayed encounter id finds itself in awardedKeys.
 */
export function awardPractice(
  progress: SkillProgress,
  encounterId: string,
  kind: RewardKind = 'practice',
): SkillProgress {
  const key = rewardKey(encounterId, kind);
  if (progress.awardedKeys.includes(key)) return progress;
  if (progress.rank === 'master') return progress;
  return {
    ...progress,
    practicePoints: progress.practicePoints + 1,
    awardedKeys: [...progress.awardedKeys, key],
  };
}

export interface TrainingConditions {
  /** Instructor, manual or environment requirement is satisfied. */
  hasSource: boolean;
  /** Required resources (time cost is settled by the caller's clock effects). */
  hasResources: boolean;
  /** World path prerequisites (realm, origin, prior skill) are satisfied. */
  meetsPrerequisites: boolean;
}

export function assertTrainingAllowed(conditions: TrainingConditions): void {
  if (!conditions.hasSource) {
    throw new Error('Training requires an available instructor, manual or environment.');
  }
  if (!conditions.hasResources) {
    throw new Error('Training requires the configured resources.');
  }
  if (!conditions.meetsPrerequisites) {
    throw new Error('Training prerequisites for this path are not met.');
  }
}

export interface AdvancementCheck {
  advanced: boolean;
  nextRank: SkillRank | null;
  pointsRemaining: number;
  pointsSpent: number;
}

/**
 * Explicit rank advancement: reaching the threshold only makes a skill
 * "trainable" — the caller checks training conditions first (assertTrainingAllowed),
 * then consumes the full threshold. A single roll can never unlock a rank.
 */
export function trainSkill(
  progress: SkillProgress,
  conditions: TrainingConditions,
): AdvancementCheck {
  assertTrainingAllowed(conditions);
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

/** True when the skill has reached its threshold and can be trained. */
export function isTrainable(progress: SkillProgress): boolean {
  const threshold = PRACTICE_THRESHOLDS[progress.rank];
  return Number.isFinite(threshold) && progress.practicePoints >= threshold;
}

/** Suffix stamped onto a challenge id once that challenge is ACHIEVED. */
export const CHALLENGE_CLOSED_SUFFIX = ':closed';

/**
 * Free-exploration challenge identity (plan §8.4: "客户端不得因玩家换措辞
 * 或重新打开场景创建新的奖励机会").
 *
 * A challenge is one open pursuit of a skill goal. It closes when an attempt
 * ACHIEVES its outcome (full_success/success); retrying an unachieved
 * challenge — re-typing the same action, re-opening the scene, failing again
 * — keeps the SAME challenge id, so the whole failed sequence is worth at
 * most one practice point (成功或失败均可获点, 每独立挑战至多一次). A new
 * challenge opens only after the previous one was achieved.
 */
export function openChallengeId(
  branchId: string,
  actorId: string,
  skillId: string,
  progress: SkillProgress | null,
): string {
  const closed = (progress?.awardedKeys ?? []).filter(
    key => key.endsWith(CHALLENGE_CLOSED_SUFFIX),
  ).length;
  return `challenge-${branchId}-${actorId}-${skillId}-${closed + 1}`;
}

/** Key stamped when a challenge is achieved (closes it for that skill). */
export function challengeClosedKey(challengeId: string): string {
  return `${challengeId}${CHALLENGE_CLOSED_SUFFIX}`;
}

export interface MilestonePracticeInput {
  skillId: string;
  currentRank: SkillRank;
  /** Milestones add 1-2 practice points, never ranks. */
  grantedPoints: number;
  maxPoints?: number;
}

/**
 * Milestone rewards: 1-2 practice points onto an already unlocked
 * (non-untrained) skill, never onto untrained (a milestone cannot grant
 * brand-new competence by itself). Ranks only change through explicit
 * training that consumes thresholds.
 */
export function applyMilestonePractice(input: MilestonePracticeInput): number {
  const maxPoints = input.maxPoints ?? 2;
  if (!Number.isInteger(input.grantedPoints) || input.grantedPoints < 1 || input.grantedPoints > maxPoints) {
    throw new Error(`Milestone grant must be between 1 and ${maxPoints} practice points.`);
  }
  if (input.currentRank === 'untrained') {
    throw new Error('Milestone rewards cannot unlock an untrained skill.');
  }
  if (input.currentRank === 'master') return 0;
  return input.grantedPoints;
}
