import type { DifficultyBand, RollGrade } from '../rules/types';
import type { ContentDependencyBinding } from '../content/types';
import type { EffectiveStyleSnapshotV1 } from '../style/types';

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
  | { op: 'grantItem'; itemId: string; actorId: string }
  /** pressure_track module contributions (P8-7): engine-injected only; the
   * planner channel can never author pressure changes. */
  | { op: 'raisePressure'; trackId: string; amount: number; maxLevel: number }
  | { op: 'relievePressure'; trackId: string; amount: number };

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
  protocolVersion: '2.0';
  turnId: string;
  expectedStateVersion: number;
  /** Optional on pre-progressive contracts; when present it is frozen into
   *  actionContractHash and names every immutable package used this turn. */
  contentDependency?: ContentDependencyBinding;
  /** Recoverable expression projection frozen before any turn request. */
  styleSnapshot?: EffectiveStyleSnapshotV1;
  actorId: string;
  actionType: string;
  /** Required for locally compiled ability contracts; planner cannot author effects. */
  abilityId?: string;
  targetId?: string;
  skillId?: string;
  difficultyBand?: DifficultyBand;
  evidenceIds: string[];
  requiresRoll: boolean;
  intent: string;
  timeCostMinutes: number;
  resourcePreconditions: ResourcePrecondition[];
  outcomes: Record<RollGrade, OutcomeClause>;
  /**
   * P7: situation method binding stamped by the LOCAL compiler when the
   * submitted action matches a published method's first step. Frozen into
   * the contract hash; the planner channel can never author it. Situation
   * transitions bound to the method apply only through the local reducer.
   */
  methodRef?: { situationId: string; methodId: string };
  /**
   * P8-6: the immutable rule binding this contract was compiled under
   * (core version, configuration hash, module versions, capability-table
   * hash). Stamped by the LOCAL compiler from the campaign's locked
   * configuration; frozen into the contract hash (plan §8.4).
   */
  ruleBinding?: {
    coreId: string;
    coreVersion: string;
    configurationHash: string;
    moduleVersions: ReadonlyArray<{ moduleId: string; version: string }>;
    executableCapabilitiesHash: string;
  };
}
