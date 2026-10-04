import type {
  SituationCondition,
  SituationSnapshotEntry,
  SituationStatus,
} from './types';
import { CONDITION_DEPTH_LIMIT, CONDITION_NODE_LIMIT } from './types';

/**
 * Three-valued whitelist condition evaluation (plan §4.3): missing referenced
 * data is UNKNOWN and never counts as true. No eval, no script, no SQL — the
 * AST is validated structurally at publication and bounded at evaluation.
 */
export type ConditionValue = { value: boolean; unknown: boolean };

const TRUE: ConditionValue = { value: true, unknown: false };
const FALSE: ConditionValue = { value: false, unknown: false };
const UNKNOWN: ConditionValue = { value: false, unknown: true };

export interface ConditionFacts {
  /** lifeStatus of branch actors; absent actor = unknown. */
  actorLifeStatus: (actorId: string) => 'active' | 'incapacitated' | 'critical' | 'dead' | undefined;
  actorLocation: (actorId: string) => string | undefined;
  /** Condition presence on a branch actor; absent actor = unknown. */
  actorHasCondition: (actorId: string, conditionId: string) => boolean | undefined;
  itemOwner: (itemId: string) => string | undefined;
  /** Knowledge entries known to an actor (default: the player actor). */
  knowledgeKnown: (entryId: string, actorId?: string) => boolean | undefined;
  relationshipCloseness: (fromActorId: string, toActorId: string) => number | undefined;
  questStatus: (questId: string) => string | undefined;
  situationStatus: (situationId: string) => SituationStatus | undefined;
  /** Reference events already resolved by committed branch facts. */
  referenceEventResolved: (eventKey: string) => boolean | undefined;
  /**
   * Campaign causal progress: the highest worldTimeOrder referenced by
   * committed branch events — NOT the turn count and NOT world-clock minutes.
   */
  causalWorldTimeOrder: number;
}

export function validateConditionShape(
  condition: unknown,
  errors: string[],
  prefix = 'condition',
): void {
  countAndValidate(condition, errors, prefix, new Set());
}

function countAndValidate(
  node: unknown,
  errors: string[],
  prefix: string,
  seen: Set<object>,
): number {
  if (typeof node !== 'object' || node === null) {
    errors.push(`${prefix}: condition node must be an object.`);
    return 1;
  }
  if (seen.has(node)) {
    errors.push(`${prefix}: condition nodes must not be shared references.`);
    return 1;
  }
  seen.add(node);
  const record = node as Record<string, unknown>;
  switch (record.kind) {
    case 'all':
    case 'any': {
      const of = record.of;
      if (!Array.isArray(of) || of.length === 0) {
        errors.push(`${prefix}.${record.kind}: requires a non-empty "of" array.`);
        return 1;
      }
      let count = 1;
      of.forEach((child, index) => {
        count += countAndValidate(child, errors, `${prefix}.${record.kind}[${index}]`, seen);
      });
      if (count - 1 > CONDITION_NODE_LIMIT) {
        errors.push(`${prefix}: condition exceeds ${CONDITION_NODE_LIMIT} nodes.`);
      }
      return count;
    }
    case 'not': {
      if (record.of === undefined) {
        errors.push(`${prefix}.not: requires "of".`);
        return 1;
      }
      return 1 + countAndValidate(record.of, errors, `${prefix}.not`, seen);
    }
    case 'actor_alive':
    case 'actor_at':
    case 'actor_condition':
    case 'item_owned_by':
    case 'knowledge_known':
    case 'relationship_at_least':
    case 'quest_status':
    case 'situation_status':
    case 'reference_event_resolved':
    case 'world_time_at_least':
      return validateLeaf(record, errors, prefix);
    default:
      errors.push(`${prefix}: unknown condition kind "${String(record.kind)}".`);
      return 1;
  }
}

function requireId(value: unknown, errors: string[], key: string): boolean {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    errors.push(`${key}: must be a stable id string.`);
    return false;
  }
  return true;
}

function validateLeaf(record: Record<string, unknown>, errors: string[], prefix: string): number {
  switch (record.kind) {
    case 'actor_alive':
    case 'reference_event_resolved':
      requireId(record.actorId ?? record.eventKey, errors, `${prefix}.${record.kind}`);
      break;
    case 'actor_at':
      requireId(record.actorId, errors, `${prefix}.actor_at.actorId`);
      requireId(record.locationId, errors, `${prefix}.actor_at.locationId`);
      break;
    case 'actor_condition':
      requireId(record.actorId, errors, `${prefix}.actor_condition.actorId`);
      requireId(record.conditionId, errors, `${prefix}.actor_condition.conditionId`);
      break;
    case 'item_owned_by':
      requireId(record.itemId, errors, `${prefix}.item_owned_by.itemId`);
      requireId(record.actorId, errors, `${prefix}.item_owned_by.actorId`);
      break;
    case 'knowledge_known':
      requireId(record.entryId, errors, `${prefix}.knowledge_known.entryId`);
      if (record.actorId !== undefined) {
        requireId(record.actorId, errors, `${prefix}.knowledge_known.actorId`);
      }
      break;
    case 'relationship_at_least':
      requireId(record.fromActorId, errors, `${prefix}.relationship_at_least.fromActorId`);
      requireId(record.toActorId, errors, `${prefix}.relationship_at_least.toActorId`);
      if (typeof record.closeness !== 'number' || !Number.isFinite(record.closeness)) {
        errors.push(`${prefix}.relationship_at_least.closeness: must be a finite number.`);
      }
      break;
    case 'quest_status':
      requireId(record.questId, errors, `${prefix}.quest_status.questId`);
      if (typeof record.status !== 'string' || !record.status) {
        errors.push(`${prefix}.quest_status.status: must be a non-empty string.`);
      }
      break;
    case 'situation_status':
      requireId(record.situationId, errors, `${prefix}.situation_status.situationId`);
      if (!['dormant', 'eligible', 'active', 'resolved', 'suppressed'].includes(String(record.status))) {
        errors.push(`${prefix}.situation_status.status: unknown status.`);
      }
      break;
    case 'world_time_at_least':
      if (typeof record.order !== 'number' || !Number.isInteger(record.order) || record.order < 0) {
        errors.push(`${prefix}.world_time_at_least.order: must be a non-negative integer.`);
      }
      break;
    default:
      break;
  }
  return 1;
}

export function conditionDepth(condition: SituationCondition): number {
  switch (condition.kind) {
    case 'all':
    case 'any':
      return 1 + Math.max(0, ...condition.of.map(conditionDepth));
    case 'not':
      return 1 + conditionDepth(condition.of);
    default:
      return 1;
  }
}

/** Depth guard for stored (already published) conditions at evaluation time. */
function assertEvaluatable(condition: SituationCondition, depth: number): void {
  if (depth > CONDITION_DEPTH_LIMIT) {
    throw new Error(`Situation condition exceeds depth ${CONDITION_DEPTH_LIMIT}.`);
  }
  switch (condition.kind) {
    case 'all':
    case 'any':
      for (const child of condition.of) assertEvaluatable(child, depth + 1);
      break;
    case 'not':
      assertEvaluatable(condition.of, depth + 1);
      break;
    default:
      break;
  }
}

export function evaluateCondition(
  condition: SituationCondition,
  facts: ConditionFacts,
): ConditionValue {
  assertEvaluatable(condition, 1);
  switch (condition.kind) {
    case 'all': {
      let anyUnknown = false;
      for (const child of condition.of) {
        const result = evaluateCondition(child, facts);
        if (result.value === false && !result.unknown) return FALSE;
        if (result.unknown) anyUnknown = true;
      }
      return anyUnknown ? UNKNOWN : TRUE;
    }
    case 'any': {
      let anyUnknown = false;
      for (const child of condition.of) {
        const result = evaluateCondition(child, facts);
        if (result.value === true && !result.unknown) return TRUE;
        if (result.unknown) anyUnknown = true;
      }
      return anyUnknown ? UNKNOWN : FALSE;
    }
    case 'not': {
      const inner = evaluateCondition(condition.of, facts);
      if (inner.unknown) return UNKNOWN;
      return inner.value ? FALSE : TRUE;
    }
    case 'actor_alive': {
      const status = facts.actorLifeStatus(condition.actorId);
      if (status === undefined) return UNKNOWN;
      return status === 'dead' ? FALSE : TRUE;
    }
    case 'actor_at': {
      const location = facts.actorLocation(condition.actorId);
      if (location === undefined) return UNKNOWN;
      return location === condition.locationId ? TRUE : FALSE;
    }
    case 'actor_condition': {
      const has = facts.actorHasCondition(condition.actorId, condition.conditionId);
      if (has === undefined) return UNKNOWN;
      return has ? TRUE : FALSE;
    }
    case 'item_owned_by': {
      const owner = facts.itemOwner(condition.itemId);
      if (owner === undefined) return UNKNOWN;
      return owner === condition.actorId ? TRUE : FALSE;
    }
    case 'knowledge_known': {
      const known = facts.knowledgeKnown(condition.entryId, condition.actorId);
      if (known === undefined) return UNKNOWN;
      return known ? TRUE : FALSE;
    }
    case 'relationship_at_least': {
      const closeness = facts.relationshipCloseness(condition.fromActorId, condition.toActorId);
      if (closeness === undefined) return UNKNOWN;
      return closeness >= condition.closeness ? TRUE : FALSE;
    }
    case 'quest_status': {
      const status = facts.questStatus(condition.questId);
      if (status === undefined) return UNKNOWN;
      return status === condition.status ? TRUE : FALSE;
    }
    case 'situation_status': {
      const status = facts.situationStatus(condition.situationId);
      if (status === undefined) return UNKNOWN;
      return status === condition.status ? TRUE : FALSE;
    }
    case 'reference_event_resolved': {
      const resolved = facts.referenceEventResolved(condition.eventKey);
      if (resolved === undefined) return UNKNOWN;
      return resolved ? TRUE : FALSE;
    }
    case 'world_time_at_least':
      return facts.causalWorldTimeOrder >= condition.order ? TRUE : FALSE;
    default:
      return UNKNOWN;
  }
}

/**
 * Facts adapter over a GameStateSnapshot-shaped view plus committed reference
 * events. Kept structural so both the engine and tests can feed projections.
 */
export function snapshotConditionFacts(input: {
  actors: Record<string, import('../state/types').ActorState>;
  itemOwners: Record<string, string>;
  discoveries?: ReadonlyArray<{ entryId: string; actorId: string }>;
  relationships?: ReadonlyArray<{ fromActorId: string; toActorId: string; closeness: number }>;
  questProgress?: ReadonlyArray<{ questId: string; status: string }>;
  situations?: readonly SituationSnapshotEntry[];
  playerActorId: string;
  resolvedReferenceEventKeys?: readonly string[];
  causalWorldTimeOrder: number;
}): ConditionFacts {
  const situationById = new Map((input.situations ?? []).map(entry => [entry.situationId, entry]));
  const knownEntries = new Map<string, Set<string>>();
  for (const discovery of input.discoveries ?? []) {
    let owners = knownEntries.get(discovery.entryId);
    if (!owners) {
      owners = new Set();
      knownEntries.set(discovery.entryId, owners);
    }
    owners.add(discovery.actorId);
  }
  const relationshipKeys = new Map(
    (input.relationships ?? []).map(rel => [`${rel.fromActorId}->${rel.toActorId}`, rel.closeness]),
  );
  const questStatusById = new Map((input.questProgress ?? []).map(q => [q.questId, q.status]));
  const resolvedKeys = new Set(input.resolvedReferenceEventKeys ?? []);
  return {
    actorLifeStatus: actorId => input.actors[actorId]?.lifeStatus,
    actorLocation: actorId => input.actors[actorId]?.locationId,
    actorHasCondition: (actorId, conditionId) => {
      const actor = input.actors[actorId];
      if (!actor) return undefined;
      return actor.conditions.includes(conditionId);
    },
    itemOwner: itemId => input.itemOwners[itemId],
    knowledgeKnown: (entryId, actorId) => {
      const owners = knownEntries.get(entryId);
      if (!owners) return false;
      const target = actorId ?? input.playerActorId;
      return owners.has(target);
    },
    relationshipCloseness: (from, to) => relationshipKeys.get(`${from}->${to}`),
    questStatus: questId => questStatusById.get(questId),
    situationStatus: situationId => situationById.get(situationId)?.status,
    referenceEventResolved: eventKey => (resolvedKeys.size === 0 && !input.resolvedReferenceEventKeys
      ? undefined
      : resolvedKeys.has(eventKey)),
    causalWorldTimeOrder: input.causalWorldTimeOrder,
  };
}
