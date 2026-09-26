import { assertRandomResult, type RandomSource } from './random';
import {
  diceCountFor,
  dieSidesFor,
  SHINEWORD_RULESET_ID,
  SHINEWORD_RULESET_VERSION,
} from './ruleset';
import type { RollGrade, RollRecord, RollSpec } from './types';

export function gradeMargin(margin: number): RollGrade {
  if (margin >= 3) return 'full_success';
  if (margin >= 0) return 'success';
  if (margin >= -2) return 'failure';
  return 'severe_failure';
}

export interface ResolveRollInput {
  turnId: string;
  rollIndex: number;
  contractHash: string;
  spec: RollSpec;
  random: RandomSource;
  createdAt?: string;
}

export function resolveRoll({
  turnId,
  rollIndex,
  contractHash,
  spec,
  random,
  createdAt = new Date().toISOString(),
}: ResolveRollInput): RollRecord {
  if (!turnId.trim()) throw new Error('turnId is required.');
  if (!contractHash.trim()) throw new Error('contractHash is required.');
  if (!Number.isInteger(rollIndex) || rollIndex < 0) {
    throw new Error(`rollIndex must be a non-negative integer; received ${rollIndex}.`);
  }
  if (!Number.isInteger(spec.difficulty)) {
    throw new Error(`difficulty must be an integer; received ${spec.difficulty}.`);
  }

  const diceCount = diceCountFor(spec.attribute, spec.situationalDiceModifier ?? 0);
  const dieSides = dieSidesFor(spec.skillRank);
  const rolls: number[] = [];

  for (let i = 0; i < diceCount; i += 1) {
    const value = random.nextIntInclusive(1, dieSides);
    assertRandomResult(value, 1, dieSides);
    rolls.push(value);
  }

  const highest = Math.max(...rolls);
  const margin = highest - spec.difficulty;

  return {
    rulesetId: SHINEWORD_RULESET_ID,
    rulesetVersion: SHINEWORD_RULESET_VERSION,
    turnId,
    rollIndex,
    contractHash,
    diceCount,
    dieSides,
    rolls,
    highest,
    difficulty: spec.difficulty,
    margin,
    grade: gradeMargin(margin),
    createdAt,
  };
}
