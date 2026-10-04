import type {
  SituationCondition,
  SituationSnapshotEntry,
  SituationTransitionOp,
  SituationTransitionSet,
} from './types';
import { evaluateCondition, type ConditionFacts } from './conditions';

/**
 * Pure situation-state transitions (plan §4.3–4.4). The ONLY writer of
 * situation status/promises/counters/suppressions; invoked from the local
 * turn reducer inside the atomic commit. Every batch is idempotent through a
 * processedEventKeys stamp — a replayed commit can never double-apply.
 */

export interface TransitionApplyInput {
  situations: readonly SituationSnapshotEntry[];
  ops: readonly SituationTransitionOp[];
  /** Idempotency key for this batch; already-processed keys are no-ops. */
  eventKey: string;
  sourceTurnId: string;
  stateVersion: number;
  clockSeconds: number;
}

export interface TransitionApplyResult {
  situations: SituationSnapshotEntry[];
  applied: SituationTransitionOp[];
  /** Domain events for the branch log (emitted once per applied op). */
  events: Array<{ eventType: string; payload: Record<string, unknown> }>;
}

function cloneEntry(entry: SituationSnapshotEntry): SituationSnapshotEntry {
  return {
    ...entry,
    counters: { ...entry.counters },
    processedEventKeys: [...entry.processedEventKeys],
    promises: entry.promises.map(promise => ({ ...promise })),
    suppressedEventKeys: { ...entry.suppressedEventKeys },
  };
}

function statusEvent(
  situationId: string,
  previous: string,
  status: string,
  resolution: string | null,
  sourceTurnId: string,
): { eventType: string; payload: Record<string, unknown> } {
  const type = status === 'active' ? 'situation_activated'
    : status === 'eligible' ? 'situation_eligible'
      : status === 'resolved' ? 'situation_resolved'
        : status === 'suppressed' ? 'situation_suppressed' : 'situation_status_changed';
  return {
    eventType: type,
    payload: { situationId, previous, resolution, sourceTurnId },
  };
}

export function applySituationTransitions(input: TransitionApplyInput): TransitionApplyResult {
  // eventKey arrives pre-namespaced by the caller (`tx:`, `tick:`, `ref:` …)
  // so idempotency checks and stamps share one key space.
  const processedKey = input.eventKey;
  if (input.situations.some(entry => entry.processedEventKeys.includes(processedKey))) {
    return { situations: [...input.situations], applied: [], events: [] };
  }
  const situations = input.situations.map(cloneEntry);
  const byId = new Map(situations.map(entry => [entry.situationId, entry]));
  const applied: SituationTransitionOp[] = [];
  const events: TransitionApplyResult['events'] = [];

  for (const op of input.ops) {
    const owner = byId.get(op.situationId);
    if (!owner) continue;
    switch (op.kind) {
      case 'set_situation_status': {
        if (owner.status === op.status) break;
        const previous = owner.status;
        owner.status = op.status;
        owner.statusVersion += 1;
        if (op.status === 'active' && owner.activatedAtVersion === undefined) {
          owner.activatedAtVersion = input.stateVersion;
          // Pressure deadlines are durations from activation; freeze the
          // absolute due time once so later clock changes cannot rewrite it.
          const duration = op.dueClockSeconds;
          if (duration !== undefined) owner.dueAtClockSeconds = input.clockSeconds + duration;
        }
        if (op.status === 'resolved' || op.status === 'suppressed') {
          owner.resolvedAtVersion = input.stateVersion;
          if (op.resolution) owner.resolution = op.resolution;
        }
        applied.push(op);
        events.push(statusEvent(op.situationId, previous, op.status, op.resolution ?? null, input.sourceTurnId));
        break;
      }
      case 'situation_counter': {
        owner.counters[op.counterId] = (owner.counters[op.counterId] ?? 0) + op.delta;
        owner.statusVersion += 1;
        applied.push(op);
        events.push({
          eventType: 'situation_counter_changed',
          payload: {
            situationId: op.situationId,
            counterId: op.counterId,
            delta: op.delta,
            value: owner.counters[op.counterId],
          },
        });
        break;
      }
      case 'promise_create': {
        if (owner.promises.some(p => p.promiseId === op.promiseId)) break;
        owner.promises.push({
          promiseId: op.promiseId,
          promisorActorId: op.promisorActorId,
          promiseeActorId: op.promiseeActorId,
          description: op.description,
          status: 'open',
          dueClockSeconds: op.dueClockSeconds,
          createdAtVersion: input.stateVersion,
          sourceTurnId: input.sourceTurnId,
          idempotencyKey: `${op.situationId}:${op.promiseId}`,
        });
        owner.statusVersion += 1;
        applied.push(op);
        events.push({
          eventType: 'promise_created',
          payload: { situationId: op.situationId, promiseId: op.promiseId, sourceTurnId: input.sourceTurnId },
        });
        break;
      }
      case 'promise_fulfill':
      case 'promise_break': {
        const promise = owner.promises.find(p => p.promiseId === op.promiseId);
        if (!promise || promise.status !== 'open') break;
        promise.status = op.kind === 'promise_fulfill' ? 'fulfilled' : 'broken';
        promise.resolvedAtVersion = input.stateVersion;
        owner.statusVersion += 1;
        applied.push(op);
        events.push({
          eventType: op.kind === 'promise_fulfill' ? 'promise_fulfilled' : 'promise_broken',
          payload: { situationId: op.situationId, promiseId: op.promiseId, sourceTurnId: input.sourceTurnId },
        });
        break;
      }
      case 'suppress_reference_event': {
        if (owner.suppressedEventKeys[op.eventKey]) break;
        owner.suppressedEventKeys[op.eventKey] = {
          reason: op.reason,
          atStateVersion: input.stateVersion,
          sourceTurnId: input.sourceTurnId,
        };
        owner.statusVersion += 1;
        applied.push(op);
        events.push({
          eventType: 'reference_event_suppressed',
          payload: { eventKey: op.eventKey, reason: op.reason, situationId: op.situationId, sourceTurnId: input.sourceTurnId },
        });
        break;
      }
      default:
        break;
    }
  }

  if (applied.length > 0) {
    for (const entry of situations) {
      if (!entry.processedEventKeys.includes(processedKey)) {
        entry.processedEventKeys.push(processedKey);
      }
    }
  }
  return { situations, applied, events };
}

export interface SituationTickDefinition {
  situationId: string;
  activation: SituationCondition;
  knowledgeCondition?: SituationCondition;
  pressure?: { deadlineClockSeconds?: number };
  transitions: SituationTransitionSet;
}

export interface SituationTickInput {
  definitions: readonly SituationTickDefinition[];
  situations: readonly SituationSnapshotEntry[];
  facts: ConditionFacts;
  stateVersion: number;
  clockSeconds: number;
  sourceTurnId: string;
}

export interface SituationTickResult {
  situations: SituationSnapshotEntry[];
  ops: SituationTransitionOp[];
  events: TransitionApplyResult['events'];
}

/**
 * Periodic situation evaluation at every committed turn boundary:
 * - dormant → eligible when activation is definitively true (unknown stays dormant);
 * - eligible → active when the knowledge condition is satisfied (or absent);
 * - precondition definitively false after eligibility → suppressed with audit;
 * - active situations past their frozen pressure deadline run onExpire;
 * - resolved/suppressed are terminal.
 *
 * Ops are applied through applySituationTransitions so idempotency and event
 * emission stay on a single path.
 */
export function tickSituationStatuses(input: SituationTickInput): SituationTickResult {
  const ops: SituationTransitionOp[] = [];
  const byId = new Map(input.situations.map(entry => [entry.situationId, entry]));
  for (const definition of input.definitions) {
    const entry = byId.get(definition.situationId);
    if (!entry || entry.status === 'resolved' || entry.status === 'suppressed') continue;
    const activation = evaluateCondition(definition.activation, input.facts);
    if (entry.status === 'dormant') {
      if (activation.value && !activation.unknown) {
        // Situations without a knowledge gate go straight to active: the
        // opening intervenable point must not wait an extra tick.
        const knowledge = definition.knowledgeCondition
          ? evaluateCondition(definition.knowledgeCondition, input.facts)
          : { value: true, unknown: false };
        ops.push(knowledge.value && !knowledge.unknown
          ? {
            kind: 'set_situation_status',
            situationId: definition.situationId,
            status: 'active',
            dueClockSeconds: definition.pressure?.deadlineClockSeconds,
          }
          : { kind: 'set_situation_status', situationId: definition.situationId, status: 'eligible' });
      }
      continue;
    }
    if (entry.status === 'eligible') {
      if (!activation.value && !activation.unknown) {
        ops.push({
          kind: 'set_situation_status',
          situationId: definition.situationId,
          status: 'suppressed',
          resolution: 'activation_precondition_false',
        });
        continue;
      }
      const knowledge = definition.knowledgeCondition
        ? evaluateCondition(definition.knowledgeCondition, input.facts)
        : { value: true, unknown: false };
      if (knowledge.value && !knowledge.unknown) {
        ops.push({
          kind: 'set_situation_status',
          situationId: definition.situationId,
          status: 'active',
          dueClockSeconds: definition.pressure?.deadlineClockSeconds,
        });
      }
      continue;
    }
    if (entry.status === 'active') {
      if (!activation.value && !activation.unknown) {
        ops.push({
          kind: 'set_situation_status',
          situationId: definition.situationId,
          status: 'suppressed',
          resolution: 'activation_precondition_false',
        });
        continue;
      }
      const dueAt = entry.dueAtClockSeconds;
      if (dueAt !== undefined && input.clockSeconds >= dueAt) {
        ops.push(...(definition.transitions.onExpire ?? []));
        if (!(definition.transitions.onExpire ?? []).some(
          op => op.kind === 'set_situation_status' && op.situationId === definition.situationId,
        )) {
          ops.push({
            kind: 'set_situation_status',
            situationId: definition.situationId,
            status: 'resolved',
            resolution: 'pressure_deadline_passed',
          });
        }
      }
    }
  }
  if (ops.length === 0) {
    return { situations: [...input.situations], ops: [], events: [] };
  }
  const applied = applySituationTransitions({
    situations: input.situations,
    ops,
    eventKey: `tick:${input.stateVersion}`,
    sourceTurnId: input.sourceTurnId,
    stateVersion: input.stateVersion,
    clockSeconds: input.clockSeconds,
  });
  return { situations: applied.situations, ops: applied.applied, events: applied.events };
}
