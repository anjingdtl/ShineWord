import type { ContentEntry } from '../../domain/content/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { ActorCard } from '../../domain/characters/card';
import type {
  MethodTemplateV1,
  SituationDefinitionV1,
  SituationSnapshotEntry,
} from '../../domain/situations/types';
import { evaluateCondition, snapshotConditionFacts } from '../../domain/situations/conditions';
import type { AllowedCandidateV1 } from './types';

/**
 * Local candidate eligibility (P7 §3.6, plan §7.2): every displayed path is
 * checked against the CURRENT prepared state — skills the actor holds, items
 * owned, knowledge known, actors alive and present. The LLM can only pick
 * from this list; it can never add entries or flip availability.
 */

export interface MethodCandidateContext {
  state: GameStateSnapshot;
  playerCard: ActorCard;
  /** Cards visible in the current scene/party (actor-id keyed). */
  cardsByName: ReadonlyMap<string, ActorCard>;
  entries: readonly ContentEntry[];
  situationStatuses: ReadonlyMap<string, SituationSnapshotEntry>;
  causalWorldTimeOrder: number;
}

const RANK_ORDER = ['untrained', 'novice', 'trained', 'expert', 'master'] as const;

function meetsRank(actual: string | undefined, required: string | undefined): boolean {
  if (!required) return true;
  const actualIndex = RANK_ORDER.indexOf((actual ?? 'untrained') as typeof RANK_ORDER[number]);
  const requiredIndex = RANK_ORDER.indexOf(required as typeof RANK_ORDER[number]);
  return actualIndex >= requiredIndex;
}

export function assessMethod(
  situationId: string,
  method: MethodTemplateV1,
  context: MethodCandidateContext,
): AllowedCandidateV1 & { eligible: boolean } {
  const { state, playerCard } = context;
  const blockers: string[] = [];
  const requires = method.requires ?? {};

  if (requires.skillId) {
    const cardKey = Object.keys(playerCard.skills ?? {})
      .find(key => key === requires.skillId || key.replace(/^skill-/, '') === requires.skillId!.replace(/^skill-/, ''));
    const rank = cardKey ? playerCard.skills?.[cardKey] : undefined;
    if (!cardKey || !meetsRank(rank, requires.minRank)) {
      blockers.push(`需要技能 ${requires.skillId}${requires.minRank ? `（${requires.minRank}）` : ''}`);
    }
  }
  if (requires.itemId && state.itemOwners[requires.itemId] !== playerCard.actorId) {
    blockers.push(`需要物品 ${requires.itemId}`);
  }
  if (requires.knowledgeEntryId) {
    const known = (state.discoveries ?? []).some(
      record => record.actorId === playerCard.actorId && record.entryId === requires.knowledgeEntryId);
    if (!known) blockers.push(`需要先发现 ${requires.knowledgeEntryId}`);
  }
  if (requires.relationshipTo && requires.minCloseness !== undefined) {
    const closeness = (state.relationships ?? []).find(
      rel => rel.fromActorId === playerCard.actorId && rel.toActorId === requires.relationshipTo)?.closeness;
    if (closeness === undefined || closeness < requires.minCloseness) {
      blockers.push(`需要与 ${requires.relationshipTo} 的关系达到 ${requires.minCloseness}`);
    }
  }
  if (requires.actorAlive) {
    const actor = state.actors[requires.actorAlive];
    if (!actor || actor.lifeStatus === 'dead') blockers.push(`需要 ${requires.actorAlive} 仍然在场且存活`);
  }
  if (requires.actorAt) {
    const actor = state.actors[requires.actorAt.actorId];
    if (!actor || actor.locationId !== requires.actorAt.locationId) {
      blockers.push(`需要 ${requires.actorAt.actorId} 位于 ${requires.actorAt.locationId}`);
    }
  }
  if (requires.condition) {
    const facts = snapshotConditionFacts({
      actors: state.actors,
      itemOwners: state.itemOwners,
      discoveries: state.discoveries,
      relationships: state.relationships,
      questProgress: state.questProgress,
      situations: state.situations,
      playerActorId: playerCard.actorId,
      causalWorldTimeOrder: context.causalWorldTimeOrder,
    });
    const result = evaluateCondition(requires.condition, facts);
    if (!result.value || result.unknown) blockers.push('前提条件尚未成立');
  }

  // Method-level visibility gate (e.g. a lead only offered once discovered).
  if (method.visibility) {
    const facts = snapshotConditionFacts({
      actors: state.actors,
      itemOwners: state.itemOwners,
      discoveries: state.discoveries,
      relationships: state.relationships,
      questProgress: state.questProgress,
      situations: state.situations,
      playerActorId: playerCard.actorId,
      causalWorldTimeOrder: context.causalWorldTimeOrder,
    });
    const visible = evaluateCondition(method.visibility, facts);
    if (!visible.value || visible.unknown) {
      return {
        ref: `method:${situationId}:${method.methodId}`,
        situationId,
        methodId: method.methodId,
        title: method.title,
        goal: method.goal,
        firstStepIntent: method.firstStep.intent,
        actionKind: method.firstStep.actionKind,
        ...(method.firstStep.skillId ? { skillId: method.firstStep.skillId } : {}),
        tradeoffs: method.tradeoffs,
        preparation: method.preparation,
        availability: 'needs_preparation',
        blockers,
        eligible: false,
      };
    }
  }

  return {
    ref: `method:${situationId}:${method.methodId}`,
    situationId,
    methodId: method.methodId,
    title: method.title,
    goal: method.goal,
    firstStepIntent: method.firstStep.intent,
    actionKind: method.firstStep.actionKind,
    ...(method.firstStep.skillId ? { skillId: method.firstStep.skillId } : {}),
    tradeoffs: method.tradeoffs,
    preparation: method.preparation,
    availability: blockers.length === 0 ? 'available' : 'needs_preparation',
    blockers,
    eligible: blockers.length === 0,
  };
}

/** Stable base actions always legal in free play (reading entries excluded). */
export function baseActionCandidates(state: GameStateSnapshot, playerCard: ActorCard): AllowedCandidateV1[] {
  const candidates: AllowedCandidateV1[] = [];
  candidates.push({
    ref: 'action:observe',
    actionId: 'observe',
    title: '观察周围',
    goal: '了解当前环境与可见异常',
    firstStepIntent: '观察周围环境，留意任何异常',
    actionKind: 'observe',
    tradeoffs: '花费少量时间',
    preparation: '无',
    availability: 'available',
    blockers: [],
  });
  const sameLocationNpcs = Object.values(state.actors).filter(actor =>
    actor.actorId !== playerCard.actorId
    && actor.locationId === state.actors[playerCard.actorId]?.locationId
    && actor.lifeStatus !== 'dead');
  if (sameLocationNpcs.length > 0) {
    candidates.push({
      ref: 'action:talk',
      actionId: 'talk',
      title: '与在场者交谈',
      goal: '获取信息或推进关系',
      firstStepIntent: '与在场的人聊聊当前的局面',
      actionKind: 'talk',
      tradeoffs: '花费时间；话题选择影响对方态度',
      preparation: '无',
      availability: 'available',
      blockers: [],
    });
  }
  if ((state.actors[playerCard.actorId]?.resources.stamina ?? 0) < 3) {
    candidates.push({
      ref: 'action:short_rest',
      actionId: 'short_rest',
      title: '原地短休',
      goal: '恢复体力',
      firstStepIntent: '稍作休息恢复体力',
      actionKind: 'observe',
      tradeoffs: '推进世界时钟 30 分钟',
      preparation: '无',
      availability: 'available',
      blockers: [],
    });
  }
  return candidates;
}

/**
 * Collect allowed candidates from ACTIVE situations (eligible situations are
 * surfaced as opportunities, not yet as methods — the player first needs the
 * knowledge condition) plus stable base actions. Deduped by first-step
 * signature; ordering: situation methods first, base actions after.
 */
export function collectAllowedCandidates(input: {
  situationDefinitions: ReadonlyArray<{ situationId: string; definition: SituationDefinitionV1 }>;
  context: MethodCandidateContext;
}): AllowedCandidateV1[] {
  const { situationDefinitions, context } = input;
  const collected: AllowedCandidateV1[] = [];
  const seenSignatures = new Set<string>();
  const push = (candidate: AllowedCandidateV1): void => {
    const signature = `${candidate.actionKind}|${candidate.skillId ?? ''}|${candidate.title}`;
    if (seenSignatures.has(signature)) return;
    seenSignatures.add(signature);
    collected.push(candidate);
  };
  for (const { situationId, definition } of situationDefinitions) {
    const entry = context.situationStatuses.get(situationId);
    if (!entry || entry.status !== 'active') continue;
    for (const method of definition.methods) {
      const assessed = assessMethod(situationId, method, context);
      const { eligible, ...candidate } = assessed;
      void eligible;
      push(candidate);
    }
  }
  for (const candidate of baseActionCandidates(context.state, context.playerCard)) {
    push(candidate);
  }
  return collected;
}
