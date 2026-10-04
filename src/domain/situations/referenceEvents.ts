import type {
  SituationSnapshotEntry,
  SituationTransitionOp,
} from './types';
import { evaluateCondition, type ConditionFacts } from './conditions';

/**
 * Campaign-causal projection of canon future events (plan §4.1–4.3).
 *
 * The canon text is never rewritten: a future event (e.g. a character dying
 * at worldTimeOrder 30) stays intact in the world store. The BRANCH owns its
 * own facts. At every committed boundary, due reference events are
 * re-evaluated against the branch state:
 *
 *  - precondition definitively FALSE  → suppressed (audit keeps the reason);
 *  - precondition TRUE when due       → the event's published, locally
 *    compiled consequences apply (situation transitions + at most one actor
 *    fate change), emitting `reference_event_due`;
 *  - precondition UNKNOWN             → stays pending; never auto-fires.
 *
 * Progress is the campaign CAUSAL order (highest worldTimeOrder referenced by
 * committed branch events), never the turn count and never world-clock
 * minutes (plan §4.2).
 */

export interface ReferenceEventProjectionV1 {
  eventKey: string;
  worldTimeOrder: number;
  /** Owning situation (records suppressions and applies onDue transitions). */
  situationId: string;
  /** Whitelist condition over BRANCH state; absent = unconditionally due. */
  condition?: import('./types').SituationCondition;
  /** Published situation transitions applied when the event is due and true. */
  onDue?: readonly SituationTransitionOp[];
  /** At most one actor fate change per reference event (engine-compiled). */
  actorFate?: { actorId: string; lifeStatus: 'active' | 'dead' };
}

export interface ReferenceEventEvaluationInput {
  projections: readonly ReferenceEventProjectionV1[];
  situations: readonly SituationSnapshotEntry[];
  facts: ConditionFacts;
  causalWorldTimeOrder: number;
}

export interface ReferenceEventDecision {
  eventKey: string;
  situationId: string;
  action: 'suppress' | 'apply' | 'pending';
  reason: string;
  ops: readonly SituationTransitionOp[];
  actorFate?: ReferenceEventProjectionV1['actorFate'];
}

export function evaluateReferenceEvents(input: ReferenceEventEvaluationInput): ReferenceEventDecision[] {
  const byId = new Map(input.situations.map(entry => [entry.situationId, entry]));
  const decisions: ReferenceEventDecision[] = [];
  for (const projection of input.projections) {
    const owner = byId.get(projection.situationId);
    if (!owner) continue;
    if (owner.suppressedEventKeys[projection.eventKey]) continue; // already suppressed
    if (owner.processedEventKeys.includes(referenceEventProcessedKey(projection.eventKey))) continue; // already applied
    if (input.causalWorldTimeOrder < projection.worldTimeOrder) continue; // not yet due
    const condition = evaluateCondition(
      projection.condition ?? { kind: 'all', of: [{ kind: 'world_time_at_least', order: 0 }] },
      input.facts,
    );
    if (condition.unknown) {
      decisions.push({
        eventKey: projection.eventKey,
        situationId: projection.situationId,
        action: 'pending',
        reason: 'precondition_unknown',
        ops: [],
      });
      continue;
    }
    if (!condition.value) {
      decisions.push({
        eventKey: projection.eventKey,
        situationId: projection.situationId,
        action: 'suppress',
        reason: 'precondition_false',
        ops: [{
          kind: 'suppress_reference_event',
          situationId: projection.situationId,
          eventKey: projection.eventKey,
          reason: 'precondition_false',
        }],
      });
      continue;
    }
    decisions.push({
      eventKey: projection.eventKey,
      situationId: projection.situationId,
      action: 'apply',
      reason: 'precondition_true',
      ops: projection.onDue ?? [],
      actorFate: projection.actorFate,
    });
  }
  return decisions;
}

/** Branch-side marker that a reference event has been applied (idempotency).
 * Callers pass this as the applySituationTransitions eventKey. */
export function referenceEventProcessedKey(eventKey: string): string {
  return `ref:${eventKey}`;
}

/**
 * Campaign causal order: the highest canon worldTimeOrder referenced by the
 * branch's committed event history. Committed turn numbers and wall-clock
 * minutes are deliberately irrelevant.
 */
export function deriveCausalWorldTimeOrder(
  committedEventOrders: readonly number[],
): number {
  let highest = 0;
  for (const order of committedEventOrders) {
    if (Number.isFinite(order) && order > highest) highest = order;
  }
  return highest;
}
