import type { DieSides } from './types';

export function successProbability(
  diceCount: number,
  dieSides: DieSides,
  difficulty: number,
): number {
  if (!Number.isInteger(diceCount) || diceCount < 1 || diceCount > 4) {
    throw new Error(`Dice count must be an integer from 1 to 4; received ${diceCount}.`);
  }
  if (!Number.isInteger(difficulty)) {
    throw new Error(`Difficulty must be an integer; received ${difficulty}.`);
  }
  if (difficulty <= 1) return 1;
  if (difficulty > dieSides) return 0;
  return 1 - Math.pow((difficulty - 1) / dieSides, diceCount);
}

export function formatProbability(probability: number, digits = 2): string {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error(`Probability must be between 0 and 1; received ${probability}.`);
  }
  return `${(probability * 100).toFixed(digits)}%`;
}
