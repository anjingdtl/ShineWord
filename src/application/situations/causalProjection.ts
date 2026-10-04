import type { ContentEntry } from '../../domain/content/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type {
  SituationDefinitionV1,
  SituationSnapshotEntry,
} from '../../domain/situations/types';
import {
  applySituationTransitions,
  tickSituationStatuses,
} from '../../domain/situations/transitions';
import {
  evaluateReferenceEvents,
  referenceEventProcessedKey,
  type ReferenceEventProjectionV1,
} from '../../domain/situations/referenceEvents';
import { snapshotConditionFacts } from '../../domain/situations/conditions';

/**
 * Branch causal projection (plan §4, P7-1). Runs INSIDE the turn reduction
 * (via the session's authoritative reducer) on the fully-reduced next state:
 * initializes newly adopted situations as dormant, ticks statuses, applies
 * method-bound transitions, re-evaluates due canon future references and —
 * only when the branch itself changed the precondition — suppresses them.
 * All writes happen on the nextState that the same atomic commit persists.
 */

export interface SituationDefinitionRef {
  situationId: string;
  definition: SituationDefinitionV1;
}

export interface ApplySituationRuntimeInput {
  /** Published situation definitions visible to this branch (content-bound). */
  definitions: readonly SituationDefinitionRef[];
  nextState: GameStateSnapshot;
  sourceTurnId: string;
  playerActorId: string;
  /**
   * Method transitions bound to THIS turn by the local compiler
   * (contract.methodRef); empty on turns without a method match.
   */
  methodOps: readonly import('../../domain/situations/types').SituationTransitionOp[];
}

export interface ApplySituationRuntimeResult {
  situations: SituationSnapshotEntry[];
  events: Array<{ eventType: string; payload: unknown }>;
  /** Actor fate changes from due reference events (caller applies to actors). */
  actorFates: ReadonlyArray<{ actorId: string; lifeStatus: 'active' | 'dead'; eventKey: string }>;
}

function initialEntry(situationId: string, sourceTurnId: string): SituationSnapshotEntry {
  return {
    situationId,
    status: 'dormant',
    counters: {},
    processedEventKeys: [],
    promises: [],
    suppressedEventKeys: {},
    sourceTurnId,
    statusVersion: 0,
  };
}

function resolvedReferenceKeys(situations: readonly SituationSnapshotEntry[]): string[] {
  const keys: string[] = [];
  for (const entry of situations) {
    for (const key of entry.processedEventKeys) {
      if (key.startsWith('ref:')) keys.push(key.slice(4));
    }
  }
  return keys;
}

/**
 * Resolve a reference-event fate actor id against the branch: mapper-compiled
 * ids may be entity ids or npc entry ids; the branch state keys runtime
 * actors. Unresolvable fates are skipped (never applied to a guessed actor).
 */
function resolveFateActor(actorId: string, state: GameStateSnapshot): string | null {
  if (state.actors[actorId]) return actorId;
  for (const card of state.cards ?? []) {
    const cardRecord = card.card as { actorId?: string; templateId?: string } | null;
    if (!cardRecord || typeof cardRecord.templateId !== 'string') continue;
    if (cardRecord.templateId === actorId || cardRecord.templateId === `npc-${actorId.replace(/^npc-/, '')}`) {
      return state.actors[card.actorId] ? card.actorId : null;
    }
  }
  return null;
}

export function applySituationRuntime(input: ApplySituationRuntimeInput): ApplySituationRuntimeResult {
  const state = input.nextState;
  const existing = state.situations ?? [];
  const byId = new Map(existing.map(entry => [entry.situationId, entry]));
  // New definitions initialize dormant: no retroactive rewards, debts or
  // deaths; evaluation only reads what the branch has already committed.
  let situations = [...existing];
  for (const definition of input.definitions) {
    if (!byId.has(definition.situationId)) {
      situations.push(initialEntry(definition.situationId, input.sourceTurnId));
    }
  }

  const events: ApplySituationRuntimeResult['events'] = [];
  const actorFates: Array<{ actorId: string; lifeStatus: 'active' | 'dead'; eventKey: string }> = [];
  const clockSeconds = state.clockSeconds ?? state.clockMinutes * 60;
  const causalOrder = state.causalWorldTimeOrder ?? 0;

  const buildFacts = (snapshot: GameStateSnapshot) => snapshotConditionFacts({
    actors: snapshot.actors,
    itemOwners: snapshot.itemOwners,
    discoveries: snapshot.discoveries,
    relationships: snapshot.relationships,
    questProgress: snapshot.questProgress,
    situations: snapshot.situations ?? situations,
    playerActorId: input.playerActorId,
    resolvedReferenceEventKeys: resolvedReferenceKeys(snapshot.situations ?? situations),
    causalWorldTimeOrder: causalOrder,
  });

  // 1. Method-bound transitions for this turn (idempotent per turn).
  if (input.methodOps.length > 0) {
    const applied = applySituationTransitions({
      situations,
      ops: input.methodOps,
      eventKey: `method:${input.sourceTurnId}`,
      sourceTurnId: input.sourceTurnId,
      stateVersion: state.stateVersion,
      clockSeconds,
    });
    if (applied.applied.length > 0) {
      situations = applied.situations;
      events.push(...applied.events);
    }
  }

  // 2. Status tick (dormant→eligible→active, precondition falsified, expiry).
  const tick = tickSituationStatuses({
    definitions: input.definitions.map(definition => ({
      situationId: definition.situationId,
      activation: definition.definition.activation,
      knowledgeCondition: definition.definition.knowledgeCondition,
      pressure: definition.definition.pressure,
      transitions: definition.definition.transitions,
    })),
    situations,
    facts: buildFacts({ ...state, situations }),
    stateVersion: state.stateVersion,
    clockSeconds,
    sourceTurnId: input.sourceTurnId,
  });
  situations = tick.situations;
  events.push(...tick.events);

  // 3. Due canon future references re-evaluated against BRANCH facts.
  const projections: ReferenceEventProjectionV1[] = [];
  for (const definition of input.definitions) {
    for (const projection of definition.definition.referenceEvents ?? []) {
      projections.push(projection);
    }
  }
  if (projections.length > 0) {
    const decisions = evaluateReferenceEvents({
      projections,
      situations,
      facts: buildFacts({ ...state, situations }),
      causalWorldTimeOrder: causalOrder,
    });
    for (const decision of decisions) {
      if (decision.action === 'pending') continue;
      if (decision.action === 'suppress') {
        const applied = applySituationTransitions({
          situations,
          ops: decision.ops,
          eventKey: `ref:${decision.eventKey}`,
          sourceTurnId: input.sourceTurnId,
          stateVersion: state.stateVersion,
          clockSeconds,
        });
        situations = applied.situations;
        events.push(...applied.events);
        continue;
      }
      // action === 'apply': the reference event fires on this branch.
      const applied = applySituationTransitions({
        situations,
        ops: [
          ...(decision.ops ?? []),
          // Stamp the processed key through a no-op-safe op list is not
          // possible; stamp explicitly below.
        ],
        eventKey: `ref:${decision.eventKey}`,
        sourceTurnId: input.sourceTurnId,
        stateVersion: state.stateVersion,
        clockSeconds,
      });
      situations = applied.situations;
      if (applied.applied.length > 0) {
        events.push(...applied.events);
      } else {
        // onDue may be empty; still stamp the key so the event cannot refire.
        situations = situations.map(entry =>
          entry.situationId === decision.situationId
            && !entry.processedEventKeys.includes(referenceEventProcessedKey(decision.eventKey))
            ? {
              ...entry,
              processedEventKeys: [...entry.processedEventKeys, referenceEventProcessedKey(decision.eventKey)],
              statusVersion: entry.statusVersion + 1,
            }
            : entry);
      }
      events.push({
        eventType: 'reference_event_due',
        payload: {
          eventKey: decision.eventKey,
          situationId: decision.situationId,
          sourceTurnId: input.sourceTurnId,
        },
      });
      if (decision.actorFate) {
        const resolved = resolveFateActor(decision.actorFate.actorId, state);
        if (resolved) {
          actorFates.push({ actorId: resolved, lifeStatus: decision.actorFate.lifeStatus, eventKey: decision.eventKey });
        }
      }
    }
  }

  return { situations, events, actorFates };
}
