import type { GameStateSnapshot } from '../../domain/state/types';
import type { ContentEntry } from '../../domain/content/types';
import type {
  SituationDefinitionV1,
  SituationSnapshotEntry,
} from '../../domain/situations/types';
import type { ActorCard } from '../../domain/characters/card';
import type { PreparedTurnResolution } from '../turns/commitTurn';
import { collectAllowedCandidates, type MethodCandidateContext } from './candidates';
import type { AllowedCandidateV1, GuidanceSeverity, PublicSituationPacketV1 } from './types';

/**
 * PublicSituationPacketV1 builder (P7 §3.6, plan §6.2). Every field is
 * derived from the PREPARED post-settlement state and this turn's committed
 * event list — never from the Planner context, never from GM-only entries.
 */

/** Event types that mark a major turning point (P7 §3.9, local-only). */
const MAJOR_EVENT_TYPES = new Set([
  'actor_death_resolved',
  'actor_recovered_from_critical',
  'actor_entered_critical_state',
  'quest_succeeded',
  'quest_failed',
  'situation_resolved',
  'situation_suppressed',
  'reference_event_suppressed',
  'reference_event_due',
  'promise_fulfilled',
  'promise_broken',
]);

export function detectSeverity(
  events: ReadonlyArray<{ eventType: string; payload: unknown }>,
  options: { keyItemIds?: ReadonlySet<string>; relationshipCrossed60?: boolean } = {},
): GuidanceSeverity {
  for (const event of events) {
    if (MAJOR_EVENT_TYPES.has(event.eventType)) return 'major';
    if (event.eventType === 'quest_reward_granted' && options.keyItemIds) {
      const itemId = (event.payload as { itemId?: string } | null)?.itemId;
      if (itemId && options.keyItemIds.has(itemId)) return 'major';
    }
    if (event.eventType === 'relationship_changed' && options.relationshipCrossed60) return 'major';
  }
  return 'normal';
}

export interface BuildSituationPacketInput {
  prepared: PreparedTurnResolution;
  situationDefinitions: ReadonlyArray<{ situationId: string; definition: SituationDefinitionV1 }>;
  playerCard: ActorCard;
  /** Names the player may see (for actorNotes wording only). */
  visibleActorNames: ReadonlyMap<string, string>;
  /** Entry ids whose ownership change counts as a key item swing. */
  keyItemIds?: ReadonlySet<string>;
  entries?: readonly ContentEntry[];
  cards?: readonly ActorCard[];
  allowedCandidates?: readonly AllowedCandidateV1[];
  preferredCandidateRef?: string;
}

function summarizeChanges(prepared: PreparedTurnResolution, names: ReadonlyMap<string, string>): string[] {
  const changes: string[] = [];
  const seen = new Set<string>(changes);
  for (const event of [...prepared.domainEvents, ...prepared.lifeEvents, ...prepared.extraEvents]) {
    if (changes.length >= 5) break;
    const text = describeEvent(event, names);
    if (text && !seen.has(text)) {
      seen.add(text);
      changes.push(text);
    }
  }
  return changes;
}

function describeEvent(event: { eventType: string; payload: unknown }, names: ReadonlyMap<string, string>): string | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.eventType) {
    case 'actor_death_resolved':
      return names.has(String(payload.actorId)) ? `${names.get(String(payload.actorId))} 已死亡。` : null;
    case 'actor_recovered_from_critical':
      return names.has(String(payload.actorId)) ? `${names.get(String(payload.actorId))} 脱离了危殆状态。` : null;
    case 'actor_entered_critical_state':
      return names.has(String(payload.actorId)) ? `${names.get(String(payload.actorId))} 陷入危殆。` : null;
    case 'knowledge_discovered':
      return '发现了新线索。';
    case 'quest_activated':
      return '新的任务开始了。';
    case 'quest_succeeded':
      return '完成了一项任务。';
    case 'quest_reward_granted':
      return '获得了任务酬劳。';
    case 'relationship_changed':
      return names.has(String(payload.toActorId)) ? `与 ${names.get(String(payload.toActorId))} 的关系发生了变化。` : null;
    case 'situation_activated':
      return `新局面展开了。`;
    case 'situation_resolved':
      return `一个局面告一段落。`;
    case 'situation_suppressed':
      return `某件事不再按原来的轨迹发展。`;
    case 'reference_event_suppressed':
      return `原本将发生的事被改变了。`;
    case 'reference_event_due':
      return `原定的命运时刻到来了。`;
    case 'promise_created':
      return `立下了一个承诺。`;
    case 'promise_fulfilled':
      return `兑现了一个承诺。`;
    case 'promise_broken':
      return `一个承诺被违背了。`;
    case 'situation_counter_changed':
      return null;
    default:
      return null;
  }
}

export function buildSituationPacket(input: BuildSituationPacketInput): PublicSituationPacketV1 | null {
  const { prepared, situationDefinitions, playerCard } = input;
  const state: GameStateSnapshot = prepared.nextState;
  const situationStatuses = new Map<string, SituationSnapshotEntry>((state.situations ?? [])
    .map(entry => [entry.situationId, entry]));
  const causalOrder = state.causalWorldTimeOrder ?? 0;

  const context: MethodCandidateContext = {
    state,
    playerCard,
    cardsByName: new Map((input.cards ?? []).map(card => [card.actorId, card])),
    entries: input.entries ?? [],
    situationStatuses,
    causalWorldTimeOrder: causalOrder,
  };
  const candidates = input.allowedCandidates ?? collectAllowedCandidates({ situationDefinitions, context });
  // Bound model input even after many regions have been built. Keep current
  // situation methods and legal base actions within a fixed public envelope.
  const allowedCandidates = [...candidates.filter(c => c.methodId).slice(0, 8), ...candidates.filter(c => !c.methodId).slice(0, 4)];
  if (input.preferredCandidateRef) allowedCandidates.sort((a, b) => Number(b.ref === input.preferredCandidateRef) - Number(a.ref === input.preferredCandidateRef));
  if (allowedCandidates.length === 0 && situationDefinitions.length === 0) return null;

  const opportunities: Array<{ text: string; situationId?: string }> = [];
  const pressures: Array<{ text: string; deadlineClockSeconds?: number }> = [];
  const actorNotes: Array<{ actorId: string; note: string }> = [];
  const clockSeconds = state.clockSeconds ?? state.clockMinutes * 60;
  for (const { situationId, definition } of situationDefinitions) {
    const entry = situationStatuses.get(situationId);
    if (!entry) continue;
    if (definition.locationId && definition.locationId !== state.actors[playerCard.actorId]?.locationId) continue;
    if (entry.status === 'active') {
      opportunities.push({ text: definition.summary, situationId });
      if (definition.pressure.description) {
        pressures.push({
          text: definition.pressure.description,
          ...(entry.dueAtClockSeconds !== undefined
            ? { deadlineClockSeconds: Math.max(0, entry.dueAtClockSeconds - clockSeconds) }
            : {}),
        });
      }
    }
    if (entry.status !== 'active') continue;
    for (const promise of entry.promises) {
      if (promise.status === 'open') {
        pressures.push({ text: `待兑现的承诺：${promise.description}` });
      }
    }
  }
  // Player-adjacent actor notes: only observable life states, no GM traits.
  for (const [actorId, name] of input.visibleActorNames) {
    const actor = state.actors[actorId];
    if (!actor) continue;
    if (actor.lifeStatus === 'critical') actorNotes.push({ actorId, note: `${name} 伤势危殆，亟需救治` });
    else if (actor.lifeStatus === 'dead') actorNotes.push({ actorId, note: `${name} 已经死亡` });
    else if (actor.conditions.includes('bleeding')) actorNotes.push({ actorId, note: `${name} 正在流血` });
  }

  const candidateIds = new Set(allowedCandidates.map(candidate => candidate.ref));
  void candidateIds;

  return {
    changes: summarizeChanges(prepared, new Map([...input.visibleActorNames, [playerCard.actorId, playerCard.name]])),
    opportunities: opportunities.slice(0, 5),
    pressures: pressures.slice(0, 5),
    actorNotes: actorNotes.slice(0, 5),
    allowedCandidates,
  };
}

export type { AllowedCandidateV1 };
