import type {
  DifficultyBand,
  DieSides,
  SkillRank,
  SituationalDiceModifier,
} from './types';

export const SHINEWORD_RULESET_ID = 'shineword-core';
/**
 * V0.2 (P2 acceptance G05): card-driven V2 proposals with local contract
 * compilation, engine-capped restores, training/milestone action
 * transactions, challenge-closure anti-farm and zone-graph ranges.
 *
 * Dispatch policy (plan §9): V0.2 mechanics apply to campaigns locked to a
 * published world package (package_revision >= 1). Legacy V0.1 campaigns
 * (pre-package demos without a lock) stay readable but cannot play forward -
 * they are refused with an explicit upgrade message instead of silently
 * mixing rule versions.
 */
export const SHINEWORD_RULESET_VERSION = '0.2.0';

export const SKILL_DIE_BY_RANK: Readonly<Record<SkillRank, DieSides>> = {
  untrained: 4,
  novice: 6,
  trained: 8,
  expert: 10,
  master: 12,
};

export const DIFFICULTY_BY_BAND: Readonly<Record<DifficultyBand, number>> = {
  simple: 3,
  normal: 4,
  challenging: 6,
  hard: 8,
  extreme: 10,
  peak: 12,
};

export function assertBaseAttribute(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw new Error(`Base attribute must be an integer from 1 to 3; received ${value}.`);
  }
}

export function diceCountFor(
  attribute: number,
  modifier: SituationalDiceModifier = 0,
): number {
  assertBaseAttribute(attribute);
  const raw = attribute + modifier;
  return Math.min(4, Math.max(1, raw));
}

export function dieSidesFor(rank: SkillRank): DieSides {
  return SKILL_DIE_BY_RANK[rank];
}

export function difficultyForBand(band: DifficultyBand): number {
  return DIFFICULTY_BY_BAND[band];
}
