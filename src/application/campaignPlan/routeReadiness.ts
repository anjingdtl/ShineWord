import type { ActorCard } from '../../domain/characters/card';
import { createActorReferenceResolver } from '../../domain/characters/actorIdentity';
import type { CampaignContentArtifactV1, CampaignPlanV1 } from '../../domain/campaignPlan/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { MethodTemplateV1, SituationCondition, SituationStatus } from '../../domain/situations/types';
import { hasUnconsumedSuccessEventMethod, hasUnconsumedSuccessEventType } from '../../domain/campaignPlan/causalityValidation';
import { preparePromiseSafeOutcomes } from '../../domain/campaignPlan/promiseEffectPolicy';
import type { ContentEntry, SceneDefinition } from '../../domain/content/types';
import { isTemplateValidAtAnchor } from '../campaign/recruitment';

export const CAMPAIGN_COMPLETION_REWARD_ACTOR_UNAVAILABLE = 'campaign_completion_reward_actor_unavailable';
export const CAMPAIGN_METHOD_EVENT_UNCONSUMED = 'campaign_method_event_unconsumed';
export const CAMPAIGN_METHOD_PROMISE_ALREADY_CREATED = 'campaign_method_promise_already_created';
export const CAMPAIGN_METHOD_PROMISE_ALREADY_RESOLVED = 'campaign_method_promise_already_resolved';
export const CAMPAIGN_METHOD_ACTOR_UNAVAILABLE = 'campaign_method_actor_unavailable';

/** Player-visible adopted participants are an explicit scene roster, even when the
 * immutable world scene predates the campaign. No template or identity is invented. */
export function campaignActorPreparationTemplates(input: {
  state: GameStateSnapshot;
  artifacts: readonly CampaignContentArtifactV1[];
  entries: readonly ContentEntry[];
  worldTimeOrder?: number;
}): ContentEntry[] {
  const { state } = input;
  const player = state.party?.find(member => member.controller === 'player');
  const location = player && state.actors[player.actorId]?.locationId;
  if (!location) return [];
  const isKnown = (entry: ContentEntry): boolean => entry.visibility === 'public'
    || entry.visibility === 'discoverable' && (state.discoveries ?? []).some(d => d.actorId === player!.actorId && d.entryId === entry.entryId);
  const bound = new Set(state.campaignContentBinding?.artifactIds ?? []);
  const active = new Set((state.situations ?? []).filter(s => s.status === 'active').map(s => s.situationId));
  const refs = new Set(input.entries.filter(e => isKnown(e) && e.kind === 'scene'
    && (e.definition as SceneDefinition).locationId === location)
    .flatMap(e => (e.definition as SceneDefinition).actors));
  for (const artifact of input.artifacts.filter(a => bound.has(a.artifactId))) {
    for (const situation of artifact.situations) {
      if (state.campaignRuntime?.campaignStatus === 'active' && active.has(situation.entryId) && situation.definition.locationId === location
        && state.campaignRuntime.nodeStates.some(n => n.nodeId === situation.nodeId && n.status === 'active')) {
        for (const ref of situation.definition.participantEntryIds ?? []) refs.add(ref);
      }
    }
  }
  return input.entries.filter(e => e.kind === 'actor_template' && isKnown(e)
    && refs.has(e.entryId) && isTemplateValidAtAnchor(e, input.worldTimeOrder ?? state.causalWorldTimeOrder));
}

/** Block an event-only success when no public campaign goal or delayed effect consumes that event. */
export function campaignMethodEventConsumerBlocker(input: {
  state: GameStateSnapshot;
  plan: CampaignPlanV1 | null | undefined;
  artifacts: readonly CampaignContentArtifactV1[];
  situationId: string;
  method: MethodTemplateV1;
}): string | null {
  const { state, situationId, method } = input;
  const playerActorId = state.party?.find(member => member.controller === 'player')?.actorId;
  const cards = (state.cards ?? []).map(row => ({ ...(row.card as ActorCard), actorId: row.actorId }));
  const resolveReference = createActorReferenceResolver({ actors: state.actors, cards });
  const resolveMethodActor = (id: string): string => {
    if (['pc', 'player', 'self', '__player__', '玩家'].includes(id)) return playerActorId ?? id;
    const named = cards.find(card => card.name === id);
    return named?.actorId ?? resolveReference(id);
  };
  const ownerSituationId = (ref: string, fallbackSituationId = situationId): string =>
    ['self', '__self__'].includes(ref) ? fallbackSituationId : ref;
  const promiseFor = (ref: { situationId: string; promiseId: string }, fallbackSituationId = situationId) =>
    (state.situations ?? []).find(item => item.situationId === ownerSituationId(ref.situationId, fallbackSituationId))?.promises
      ?.find(item => item.promiseId === ref.promiseId);
  const alreadyCreated = (promise: { situationId: string; promiseId: string }): boolean => Boolean(promiseFor(promise));
  const successfulPromiseTransitions = (candidate: MethodTemplateV1, grade: 'success' | 'full_success') => [
    ...(candidate.onSuccess ?? []).flatMap(effect => effect.kind === 'promise_create'
      || effect.kind === 'promise_fulfill' || effect.kind === 'promise_break'
      ? [{ kind: effect.kind, situationId: effect.situationId, promiseId: effect.promiseId }] : []),
    ...(candidate.outcomeTemplates?.[grade]?.effects ?? []).flatMap(effect => effect.template === 'promise_create'
      || effect.template === 'promise_fulfill' || effect.template === 'promise_break'
      ? [{ kind: effect.template, situationId: effect.situationId, promiseId: effect.promiseId }] : []),
  ];
  const successfulGrades = ['success', 'full_success'] as const;
  const transitionsBySuccessfulGrade = successfulGrades.map(grade => successfulPromiseTransitions(method, grade));
  const hasRepeatedCreation = transitionsBySuccessfulGrade.some(transitions =>
    transitions.some(effect => effect.kind === 'promise_create' && alreadyCreated(effect)));
  const hasTerminalResolution = transitionsBySuccessfulGrade.some(transitions =>
    transitions.some(effect => {
      if (effect.kind !== 'promise_fulfill' && effect.kind !== 'promise_break') return false;
      const status = promiseFor(effect)?.status;
      return status === 'fulfilled' || status === 'broken';
    }));
  const hasOpenPromiseResolution = transitionsBySuccessfulGrade.some(transitions => transitions.some(effect => {
    if (effect.kind !== 'promise_fulfill' && effect.kind !== 'promise_break') return false;
    return promiseFor(effect)?.status === 'open';
  }));
  const promisePolicy = preparePromiseSafeOutcomes({ state, situationId, method, resolveActor: resolveMethodActor });
  const isUsefulAfterPromisePolicy = (grade: typeof successfulGrades[number]): boolean => {
    const effects = promisePolicy.effectsByGrade[grade] ?? method.outcomeTemplates?.[grade]?.effects ?? [];
    return effects.some(effect => {
      if (effect.template === 'promise_create') return !alreadyCreated({
        situationId: effect.situationId, promiseId: effect.promiseId,
      });
      if (effect.template === 'promise_fulfill' || effect.template === 'promise_break') {
        const status = promiseFor({ situationId: effect.situationId, promiseId: effect.promiseId })?.status;
        return status === 'open';
      }
      if (effect.template === 'grant_knowledge') {
        const actorId = resolveMethodActor(effect.actorId ?? '__player__');
        return !(state.discoveries ?? []).some(discovery => discovery.entryId === effect.entryId && discovery.actorId === actorId);
      }
      if (effect.template === 'record_event') return Boolean(input.plan
        && !hasUnconsumedSuccessEventType(input.plan, input.artifacts, situationId, effect.eventType));
      return true;
    });
  };
  const everySuccessfulGradeIsIdempotent = successfulGrades.every(grade => !isUsefulAfterPromisePolicy(grade));
  if (everySuccessfulGradeIsIdempotent && hasRepeatedCreation && !hasOpenPromiseResolution) return CAMPAIGN_METHOD_PROMISE_ALREADY_CREATED;
  if (everySuccessfulGradeIsIdempotent && hasTerminalResolution) return CAMPAIGN_METHOD_PROMISE_ALREADY_RESOLVED;

  if (!input.plan) return null;
  const { plan, artifacts } = input;
  if (hasUnconsumedSuccessEventMethod(plan, artifacts, situationId, method)) return CAMPAIGN_METHOD_EVENT_UNCONSUMED;

  // A previously useful clue grant becomes a no-op after this branch has
  // learned it. If the rest of ordinary success only records an event with no
  // campaign consumer, the route would otherwise remain repeatable forever.
  if ((method.successEffects?.length ?? 0) > 0 || (method.onSuccess?.length ?? 0) > 0) return null;
  const effects = method.outcomeTemplates?.success?.effects ?? [];
  if (effects.length === 0) return null;
  const isKnown = (entryId: string, reference?: string): boolean => {
    const actorId = !reference || ['pc', 'player', 'self', '__player__', '玩家'].includes(reference)
      ? playerActorId : resolveReference(reference);
    return Boolean(actorId && (state.discoveries ?? []).some(discovery =>
      discovery.entryId === entryId && discovery.actorId === actorId));
  };
  const allOrdinaryEffectsAreNoOps = effects.every(effect => {
    if (effect.template === 'record_event') {
      return hasUnconsumedSuccessEventType(plan, artifacts, situationId, effect.eventType);
    }
    if (effect.template === 'grant_knowledge') return isKnown(effect.entryId, effect.actorId);
    return false;
  });
  return allOrdinaryEffectsAreNoOps ? CAMPAIGN_METHOD_EVENT_UNCONSUMED : null;
}

/**
 * True when one of the method's authored outcome grades can satisfy a direct
 * completion leaf. The success-only form is used to rank player routes; the
 * all-grade form is used by the pre-roll settlement guard.
 */
export function methodCanSatisfyCompletion(
  method: MethodTemplateV1,
  condition: SituationCondition,
  statuses: ReadonlyMap<string, { status: SituationStatus }>,
  includeFailureGrades = false,
): boolean {
  const targets = collectCompletionTargets(condition, statuses);
  if (targets.length === 0) return false;
  const grades = includeFailureGrades
    ? ['full_success', 'success', 'failure', 'severe_failure'] as const
    : ['full_success', 'success'] as const;
  const effects = grades.flatMap(grade => method.outcomeTemplates?.[grade]?.effects ?? []);
  const transitions = [
    ...(method.onSuccess ?? []),
    ...(includeFailureGrades ? method.onFailure ?? [] : []),
  ];
  return targets.some(target => target.kind === 'situation_status'
    ? effects.some(effect => effect.template === 'situation_status'
      && effect.situationId === target.situationId && effect.status === target.status)
      || transitions.some(transition => transition.kind === 'set_situation_status'
        && transition.situationId === target.situationId && transition.status === target.status)
    : effects.some(effect => effect.template === 'record_event'
      && effect.eventType === target.eventType
      && (!target.payloadMatch || Object.entries(target.payloadMatch).every(([key, value]) =>
        key === 'summary' && effect.summary === value))));
}

/**
 * Check the actor references that will be applied if this method closes an
 * active campaign node. The settlement layer remains authoritative and
 * fail-closed; this gate keeps an unusable closure route out of play before a
 * roll can be created.
 */
export function campaignCompletionRewardBlocker(input: {
  state: GameStateSnapshot;
  plan: CampaignPlanV1 | null | undefined;
  artifacts: readonly CampaignContentArtifactV1[];
  situationId: string;
  method: MethodTemplateV1;
  /** Projection only: verified templates that the next new action can load.
   * Dispatch/local compile omit this and require persisted actors. */
  preparableActorTemplateIds?: ReadonlySet<string>;
}): string | null {
  const { state, plan, situationId, method } = input;
  const runtime = state.campaignRuntime;
  if (!plan || !runtime || runtime.campaignStatus !== 'active') return null;
  const resolveReference = createActorReferenceResolver({ actors: state.actors,
    cards: (state.cards ?? []).map(c => ({ ...(c.card as ActorCard), actorId: c.actorId })) });
  const playerActorId = state.party?.find(member => member.controller === 'player')?.actorId ?? '';
  const campaignActor = (reference: string): string | null => {
    const actorId = ['pc', 'player', 'self', '__player__', '玩家'].includes(reference)
      ? playerActorId : resolveReference(reference);
    return state.actors[actorId] ? actorId
      : input.preparableActorTemplateIds?.has(reference) ? reference : null;
  };
  // Compile every authored grade before rolling, including costs/relationships
  // in failure grades that the selected success path never exercises.
  const authoredEffects = [
    ...Object.values(method.outcomeTemplates ?? {}).flatMap(outcome => outcome.effects),
    ...(method.successEffects ?? []), ...(method.onSuccess ?? []), ...(method.onFailure ?? []),
  ];
  for (const effect of authoredEffects) {
    for (const key of ['actorId', 'fromActorId', 'toActorId', 'promisorActorId', 'promiseeActorId'] as const) {
      const ref = (effect as unknown as Record<string, unknown>)[key];
      if (typeof ref === 'string' && !campaignActor(ref)) return CAMPAIGN_METHOD_ACTOR_UNAVAILABLE;
    }
    if ('template' in effect && effect.template === 'grant_knowledge' && !campaignActor(effect.actorId ?? playerActorId)) {
      return CAMPAIGN_METHOD_ACTOR_UNAVAILABLE;
    }
  }
  const statuses = new Map((state.situations ?? []).map(item => [item.situationId, item] as const));
  const closingNodeIds = new Set(plan.nodes
    .filter(node => node.situationRef === situationId
      && runtime.nodeStates.find(item => item.nodeId === node.nodeId)?.status === 'active'
      && methodCanSatisfyCompletion(method, node.completion, statuses, true))
    .map(node => node.nodeId));
  if (closingNodeIds.size === 0) return null;

  const boundIds = new Set(state.campaignContentBinding?.artifactIds ?? plan.contentArtifactRefs);
  const boundArtifacts = input.artifacts.filter(artifact => boundIds.has(artifact.artifactId));
  // Match settlement.ts: reward policies come from the current plan artifact,
  // falling back to the first branch-bound artifact for historical plans.
  const rewardArtifact = boundArtifacts.find(artifact => artifact.planId === runtime.planBinding.planId
    && artifact.planRevision === runtime.planBinding.revision) ?? boundArtifacts[0];
  if (!rewardArtifact) return null;
  const policies = rewardArtifact.rewardPolicies.filter(policy => closingNodeIds.has(policy.nodeId));
  if (policies.length === 0) return null;

  for (const policy of policies) {
    for (const reward of policy.rewards) {
      if (reward.kind === 'relationship') {
        // Settlement skips relationship rewards without a destination actor.
        if (!reward.toActorId) continue;
        if (!campaignActor(reward.targetId) || !campaignActor(reward.toActorId)) {
          return CAMPAIGN_COMPLETION_REWARD_ACTOR_UNAVAILABLE;
        }
        continue;
      }
      // An already-owned item is a no-op in settlement and does not resolve an
      // actor. Other reward kinds always resolve their recipient first.
      if (reward.kind === 'item' && state.itemOwners[reward.targetId] !== undefined) continue;
      if (!campaignActor(reward.toActorId ?? playerActorId)) {
        return CAMPAIGN_COMPLETION_REWARD_ACTOR_UNAVAILABLE;
      }
    }
  }
  return null;
}

type CompletionTarget =
  | { kind: 'situation_status'; situationId: string; status: SituationStatus }
  | { kind: 'committed_event'; eventType: string; payloadMatch?: Readonly<Record<string, string>> };

function collectCompletionTargets(
  condition: SituationCondition,
  statuses: ReadonlyMap<string, { status: SituationStatus }>,
): CompletionTarget[] {
  if (condition.kind === 'all' || condition.kind === 'any') {
    return condition.of.flatMap(child => collectCompletionTargets(child, statuses));
  }
  if (condition.kind === 'not') return [];
  if (condition.kind === 'situation_status') {
    return statuses.get(condition.situationId)?.status === condition.status ? [] : [{
      kind: condition.kind, situationId: condition.situationId, status: condition.status,
    }];
  }
  if (condition.kind === 'committed_event') return [{
    kind: condition.kind, eventType: condition.eventType,
    ...(condition.payloadMatch ? { payloadMatch: condition.payloadMatch } : {}),
  }];
  return [];
}
