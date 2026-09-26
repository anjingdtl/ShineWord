import type { DifficultyBand, RollGrade } from '../rules/types';

export const TURN_STATES = [
  'Draft',
  'Planned',
  'AwaitRoll',
  'Resolved',
  'Narrated',
  'Validated',
  'Repair',
  'Paused',
  'Committed',
] as const;
export type TurnState = (typeof TURN_STATES)[number];

export type EffectOperation =
  | { op: 'consumeResource'; actorId: string; resourceId: string; amount: number }
  | { op: 'changeLocation'; actorId: string; locationId: string }
  | { op: 'applyCondition'; actorId: string; conditionId: string }
  | { op: 'advanceClock'; minutes: number }
  | { op: 'transferItem'; itemId: string; fromActorId: string; toActorId: string }
  | { op: 'recordEvent'; eventType: string; summary: string };

export interface ResourcePrecondition {
  actorId: string;
  resourceId: string;
  minimum: number;
}

export interface OutcomeClause {
  achieved: boolean;
  publicSummary: string;
  effects: EffectOperation[];
}

export interface ActionContract {
  protocolVersion: '1.0';
  turnId: string;
  expectedStateVersion: number;
  actorId: string;
  actionType: string;
  targetId?: string;
  skillId?: string;
  difficultyBand?: DifficultyBand;
  evidenceIds: string[];
  requiresRoll: boolean;
  intent: string;
  timeCostMinutes: number;
  resourcePreconditions: ResourcePrecondition[];
  outcomes: Record<RollGrade, OutcomeClause>;
}
