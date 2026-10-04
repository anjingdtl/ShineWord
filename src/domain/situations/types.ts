import type { SkillRank } from '../rules/types';

/**
 * Situation domain (plan §5, P7 contracts §3.1–3.4). Pure data and rules —
 * no UI, no database, no LLM. Everything authoritative is compiled locally;
 * narrative text can never produce situation effects.
 */

/** Frozen in docs/reviews/phase7/BASELINE_AND_CONTRACTS.md §3.3. */
export type SituationCondition =
  | { kind: 'all'; of: readonly SituationCondition[] }
  | { kind: 'any'; of: readonly SituationCondition[] }
  | { kind: 'not'; of: SituationCondition }
  | { kind: 'actor_alive'; actorId: string }
  | { kind: 'actor_at'; actorId: string; locationId: string }
  | { kind: 'actor_condition'; actorId: string; conditionId: string }
  | { kind: 'item_owned_by'; itemId: string; actorId: string }
  | { kind: 'knowledge_known'; entryId: string; actorId?: string }
  | { kind: 'relationship_at_least'; fromActorId: string; toActorId: string; closeness: number }
  | { kind: 'quest_status'; questId: string; status: string }
  | { kind: 'situation_status'; situationId: string; status: SituationStatus }
  | { kind: 'reference_event_resolved'; eventKey: string }
  | { kind: 'world_time_at_least'; order: number };

export type SituationStatus = 'dormant' | 'eligible' | 'active' | 'resolved' | 'suppressed';

export const SITUATION_STATUSES: readonly SituationStatus[] = [
  'dormant', 'eligible', 'active', 'resolved', 'suppressed',
];

/** Whitelisted method requirements (all optional, all AND-combined). */
export interface MethodRequirements {
  skillId?: string;
  minRank?: SkillRank;
  itemId?: string;
  knowledgeEntryId?: string;
  relationshipTo?: string;
  minCloseness?: number;
  actorAlive?: string;
  actorAt?: { actorId: string; locationId: string };
  condition?: SituationCondition;
}

export interface MethodFirstStep {
  /** Player-visible action intent text for the FIRST step only. */
  intent: string;
  actionKind: 'skill_check' | 'ability' | 'observe' | 'talk' | 'interact' | 'move';
  skillId?: string;
  itemId?: string;
  abilityId?: string;
  targetEntryId?: string;
  destinationId?: string;
}

export interface MethodTemplateV1 {
  methodId: string;
  title: string;
  goal: string;
  firstStep: MethodFirstStep;
  requires: MethodRequirements;
  tradeoffs: string;
  preparation: string;
  /** Optional extra visibility gate (evaluated with player knowledge). */
  visibility?: SituationCondition;
  /**
   * Engine effects injected into the matching outcome when the local compiler
   * binds a submitted action to this method (engine origin; publication gate
   * restricts to the existing engine effect whitelist). The Planner channel
   * can never author these.
   */
  successEffects?: readonly import('../turns/types').EffectOperation[];
  /** Situation transitions applied by the local reducer on success/failure. */
  onSuccess?: readonly SituationTransitionOp[];
  onFailure?: readonly SituationTransitionOp[];
}

export type SituationTransitionOp =
  | {
      kind: 'set_situation_status';
      situationId: string;
      status: SituationStatus;
      resolution?: string;
      /** When transitioning to active: freeze this pressure duration as an absolute due time. */
      dueClockSeconds?: number;
    }
  | { kind: 'situation_counter'; situationId: string; counterId: string; delta: number }
  | {
      kind: 'promise_create';
      situationId: string;
      promiseId: string;
      promisorActorId: string;
      promiseeActorId?: string;
      description: string;
      dueClockSeconds?: number;
    }
  | { kind: 'promise_fulfill'; situationId: string; promiseId: string }
  | { kind: 'promise_break'; situationId: string; promiseId: string }
  | { kind: 'suppress_reference_event'; situationId: string; eventKey: string; reason: string };

export interface SituationTransitionSet {
  onSuccess?: readonly SituationTransitionOp[];
  onPartial?: readonly SituationTransitionOp[];
  onFailure?: readonly SituationTransitionOp[];
  onExpire?: readonly SituationTransitionOp[];
}

/** Content-side situation definition (EntryKind 'situation', visibility 'gm'). */
export interface SituationDefinitionV1 {
  title: string;
  /** Player-safe summary (publication gate enforces no GM-only names). */
  summary: string;
  /** GM-only briefing; never enters player or Narrator payloads. */
  gmBrief: string;
  locationId?: string;
  participantEntryIds: readonly string[];
  activation: SituationCondition;
  knowledgeCondition?: SituationCondition;
  signs: ReadonlyArray<{ text: string; requiresKnowledgeEntryId?: string }>;
  pressure: {
    deadlineClockSeconds?: number;
    pressureEventKey?: string;
    description: string;
  };
  methods: readonly MethodTemplateV1[];
  transitions: SituationTransitionSet;
  followUpSituationIds?: readonly string[];
  /**
   * Canon future events this situation re-evaluates when the branch diverges
   * (locally compiled from canon; see referenceEvents.ts).
   */
  referenceEvents?: readonly import('./referenceEvents').ReferenceEventProjectionV1[];
}

/** Branch-local promise record (plan §4.4). */
export interface SituationPromiseRecord {
  promiseId: string;
  promisorActorId: string;
  promiseeActorId?: string;
  description: string;
  status: 'open' | 'fulfilled' | 'broken';
  dueClockSeconds?: number;
  createdAtVersion: number;
  resolvedAtVersion?: number;
  sourceTurnId: string;
  idempotencyKey: string;
}

/** Branch snapshot entry (GameStateSnapshot.situations). */
export interface SituationSnapshotEntry {
  situationId: string;
  status: SituationStatus;
  activatedAtVersion?: number;
  resolvedAtVersion?: number;
  resolution?: string;
  counters: Record<string, number>;
  /** Idempotency: event keys already applied by this branch. */
  processedEventKeys: string[];
  promises: SituationPromiseRecord[];
  /** Reference events suppressed by committed branch facts. */
  suppressedEventKeys: Record<string, { reason: string; atStateVersion: number; sourceTurnId: string }>;
  /** Absolute world-clock time when the pressure deadline expires (frozen at activation). */
  dueAtClockSeconds?: number;
  sourceTurnId: string;
  /** Monotone per-situation revision; guards stale writers. */
  statusVersion: number;
}

/** A canon future event projected into the branch for re-evaluation. */
export interface ReferenceEventProjection {
  eventKey: string;
  worldTimeOrder: number;
  /** Whitelist condition evaluated against BRANCH state (not canon future). */
  condition?: SituationCondition;
}

export const CONDITION_NODE_LIMIT = 24;
export const CONDITION_DEPTH_LIMIT = 6;
