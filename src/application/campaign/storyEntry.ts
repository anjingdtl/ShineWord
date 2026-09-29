import type { RollGrade } from '../../domain/rules/types';

export interface StoryEntryInput {
  turnId: string;
  narrativeText: string | null;
  narrativeStatus: string | null;
  outcomeGrade: RollGrade;
}

export interface StoryEntry {
  /** Internal list key only; never render in the story body. */
  turnId: string;
  text: string;
  grade: RollGrade;
  mechanicalOnly: boolean;
}

/**
 * Player-safe history projection. Only a committed narrator result is prose.
 * `public_summary`, effects, contracts and NPC decision rationale are
 * deliberately not used as a fallback, even when their column names sound
 * player-facing.
 */
export function projectStoryEntry(input: StoryEntryInput): StoryEntry {
  const narrative = input.narrativeStatus === 'Committed' && typeof input.narrativeText === 'string'
    ? input.narrativeText.trim()
    : '';
  return {
    turnId: input.turnId,
    text: narrative || '本地规则已完成这一步行动。',
    grade: input.outcomeGrade,
    mechanicalOnly: narrative.length === 0,
  };
}
