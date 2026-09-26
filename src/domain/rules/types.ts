export const SKILL_DIE_SIDES = [4, 6, 8, 10, 12] as const;
export type DieSides = (typeof SKILL_DIE_SIDES)[number];

export const ATTRIBUTE_NAMES = [
  'physique',
  'agility',
  'insight',
  'knowledge',
  'willpower',
  'social',
] as const;
export type AttributeName = (typeof ATTRIBUTE_NAMES)[number];

export const SKILL_RANKS = [
  'untrained',
  'novice',
  'trained',
  'expert',
  'master',
] as const;
export type SkillRank = (typeof SKILL_RANKS)[number];

export const DIFFICULTY_BANDS = [
  'simple',
  'normal',
  'challenging',
  'hard',
  'extreme',
  'peak',
] as const;
export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];

export const ROLL_GRADES = [
  'full_success',
  'success',
  'failure',
  'severe_failure',
] as const;
export type RollGrade = (typeof ROLL_GRADES)[number];

export type SituationalDiceModifier = -1 | 0 | 1;

export interface RollSpec {
  attribute: number;
  skillRank: SkillRank;
  situationalDiceModifier?: SituationalDiceModifier;
  difficulty: number;
}

export interface RollRecord {
  rulesetId: string;
  rulesetVersion: string;
  turnId: string;
  rollIndex: number;
  contractHash: string;
  diceCount: number;
  dieSides: DieSides;
  rolls: number[];
  highest: number;
  difficulty: number;
  margin: number;
  grade: RollGrade;
  createdAt: string;
}
