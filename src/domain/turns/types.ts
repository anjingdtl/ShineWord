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

/**
 * V0.2 effect whitelist. Planner-proposable ops are validated by
 * `contracts.ts`; engine-only ops (`removeCondition`, `grantItem`) are
 * emitted exclusively by local settlement code (rest, loot policy) and are
 * rejected inside LLM action contracts.
 */
export type PlannerEffectOperation =
  | { op: 'consumeResource'; actorId: string; resourceId: string; amount: number }
  | { op: 'changeLocation'; actorId: string; locationId: string }
  | { op: 'applyCondition'; actorId: string; conditionId: string }
  | { op: 'advanceClock'; minutes: number }
  | { op: 'transferItem'; itemId: string; fromActorId: string; toActorId: string }
  /** `cap` is engine-injected (card max); the planner field is rejected. */
  | { op: 'restoreResource'; actorId: string; resourceId: string; amount: number; cap?: number }
  | { op: 'recordEvent'; eventType: string; summary: string };

export type EngineEffectOperation =
  | { op: 'removeCondition'; actorId: string; conditionId: string }
  | { op: 'grantItem'; itemId: string; actorId: string };

export type EffectOperation = PlannerEffectOperation | EngineEffectOperation;

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
