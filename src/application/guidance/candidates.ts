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
import { SHORT_REST_MINUTES } from '../../domain/rules/restPolicy';

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

export function resolveMethodActor(ref: string, state: GameStateSnapshot, cards: readonly ActorCard[]): string | null {
  if (state.actors[ref]) return ref;
  const matches = cards.filter(card => card.templateId === ref && state.actors[card.actorId]);
  if (matches.length === 1) return matches[0]!.actorId;
  if (matches.length > 1) return null;
  const conventionalId = `actor-${ref.replace(/^npc-/, '')}`;
  return state.actors[conventionalId] ? conventionalId : null;
}

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
): AllowedCandidateV1 & { eligible: boolean; visible: boolean } {
  const { state, playerCard } = context;
  const blockers: string[] = [];
  const player = state.actors[playerCard.actorId];
  if (!player || player.lifeStatus === 'critical' || player.lifeStatus === 'dead'
    || player.lifeStatus === 'incapacitated' || player.conditions.includes('disabled')) blockers.push('需要先得到援救并恢复行动能力');
  const requires = method.requires ?? {};

  const requiredSkill = requires.skillId ?? method.firstStep.skillId;
  if (requiredSkill) {
    const cardKey = Object.keys(playerCard.skills ?? {})
      .find(key => key.replace(/^skill-/, '') === requiredSkill.replace(/^skill-/, ''));
    const rank = cardKey ? playerCard.skills?.[cardKey] : undefined;
    const skillEntry = context.entries.find(entry => entry.kind === 'skill'
      && entry.entryId.replace(/^skill-/, '') === requiredSkill.replace(/^skill-/, ''));
    const skill = skillEntry?.definition as { name?: string; allowUntrained?: boolean } | undefined;
    if ((!cardKey && !skill?.allowUntrained) || !meetsRank(rank, requires.minRank)) {
      blockers.push(`需要技能 ${skill?.name ?? requiredSkill}${requires.minRank ? '（达到所需熟练程度）' : ''}`);
    }
  }
  const requiredItem = requires.itemId ?? method.firstStep.itemId;
  if (requiredItem && state.itemOwners[requiredItem] !== playerCard.actorId) {
    const item = context.entries.find(entry => entry.entryId === requiredItem && entry.visibility === 'public');
    blockers.push(`需要物品 ${(item?.definition as { name?: string } | undefined)?.name ?? '（尚未持有）'}`);
  }
  if (method.firstStep.abilityId && !playerCard.abilities.includes(method.firstStep.abilityId)) blockers.push('需要先掌握相关能力');
  if (method.firstStep.targetEntryId) {
    const actorId = resolveMethodActor(method.firstStep.targetEntryId, state, [...context.cardsByName.values()]);
    const target = actorId ? state.actors[actorId] : undefined;
    if (!target || target.locationId !== state.actors[playerCard.actorId]?.locationId || target.lifeStatus === 'dead') blockers.push('行动对象需要在场且存活');
  }
  if (method.firstStep.destinationId && !context.entries.some(entry => entry.kind === 'scene'
    && (entry.definition as { locationId: string }).locationId === method.firstStep.destinationId)) blockers.push('需要先找到通往目的地的路径');
  if (requires.knowledgeEntryId) {
    const known = (state.discoveries ?? []).some(
      record => record.actorId === playerCard.actorId && record.entryId === requires.knowledgeEntryId);
    if (!known) blockers.push('需要先发现相关线索');
  }
  if (requires.relationshipTo && requires.minCloseness !== undefined) {
    const closeness = (state.relationships ?? []).find(
      rel => rel.fromActorId === playerCard.actorId && rel.toActorId === requires.relationshipTo)?.closeness;
    if (closeness === undefined || closeness < requires.minCloseness) {
      blockers.push('需要先增进与相关人物的关系');
    }
  }
  if (requires.actorAlive) {
    const actorId = resolveMethodActor(requires.actorAlive, state, [...context.cardsByName.values()]);
    const actor = actorId ? state.actors[actorId] : undefined;
    if (!actor || actor.lifeStatus === 'dead') blockers.push('相关人物需要仍然存活');
  }
  if (requires.actorAt) {
    const actorId = resolveMethodActor(requires.actorAt.actorId, state, [...context.cardsByName.values()]);
    const actor = actorId ? state.actors[actorId] : undefined;
    if (!actor || actor.locationId !== requires.actorAt.locationId) {
      blockers.push('相关人物需要到达指定地点');
    }
  }
  if (requires.condition) {
    const facts = snapshotConditionFacts({
      actors: state.actors,
      cards: [...context.cardsByName.values()],
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
      cards: [...context.cardsByName.values()],
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
        visible: false,
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
    visible: true,
  };
}

/** Stable base actions always legal in free play (reading entries excluded). */
export function baseActionCandidates(state: GameStateSnapshot, playerCard: ActorCard, visibleActorIds?: ReadonlySet<string>, entries: readonly ContentEntry[] = [], preferredLocationIds: readonly string[] = []): AllowedCandidateV1[] {
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
    && (!visibleActorIds || visibleActorIds.has(actor.actorId))
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
  // The move compiler permits travel to published player-visible scenes.
  // Offer one such destination so a quiet decision point can lead elsewhere.
  const destinations = entries.filter(entry => entry.kind === 'scene' && entry.visibility === 'public')
    .map(entry => (entry.definition as { name: string; locationId: string }))
    .filter(scene => scene.locationId !== state.actors[playerCard.actorId]?.locationId)
    .sort((a, b) => Number(preferredLocationIds.includes(b.locationId)) - Number(preferredLocationIds.includes(a.locationId)));
  const destination = destinations[0];
  if (destination) candidates.push({
    ref: `action:move:${destination.locationId}`, actionId: 'move', destinationId: destination.locationId,
    title: `前往${destination.name}`.slice(0, 24), goal: '在已知地点寻找新的互动或线索',
    firstStepIntent: `前往${destination.locationId}`, actionKind: 'move',
    tradeoffs: '移动会推进世界时钟；到达后再决定具体行动', preparation: '目的地已知',
    availability: 'available', blockers: [],
  });
  {
    candidates.push({
      ref: 'action:short_rest',
      actionId: 'short_rest',
      title: '原地短休',
      goal: '恢复体力',
      firstStepIntent: '稍作休息恢复体力',
      actionKind: 'observe',
      tradeoffs: `推进世界时钟 ${SHORT_REST_MINUTES} 分钟；期间局势可能继续变化`,
      preparation: '无',
      availability: 'available',
      blockers: [],
    });
  }
  const player = state.actors[playerCard.actorId];
  if (!player || player.lifeStatus === 'critical' || player.lifeStatus === 'dead' || player.lifeStatus === 'incapacitated' || player.conditions.includes('disabled')) {
    for (const candidate of candidates) { candidate.availability = 'needs_preparation'; candidate.blockers = ['需要先得到援救并恢复行动能力']; }
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
    if (definition.locationId && definition.locationId !== context.state.actors[context.playerCard.actorId]?.locationId) continue;
    for (const method of definition.methods) {
      const assessed = assessMethod(situationId, method, context);
      const { eligible, visible, ...candidate } = assessed;
      void eligible;
      if (!visible) continue;
      push(candidate);
    }
  }
  const preferredLocations = situationDefinitions.filter(s => context.situationStatuses.get(s.situationId)?.status === 'active')
    .map(s => s.definition.locationId).filter((id): id is string => typeof id === 'string');
  for (const candidate of baseActionCandidates(context.state, context.playerCard, new Set(context.cardsByName.keys()), context.entries, preferredLocations)) {
    push(candidate);
  }
  return collected;
}
