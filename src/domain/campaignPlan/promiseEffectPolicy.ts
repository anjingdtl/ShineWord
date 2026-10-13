import type { GameStateSnapshot } from '../state/types';
import type { MethodTemplateV1 } from '../situations/types';
import type { CampaignEffectSpec } from './types';

export interface PromiseEffectClaimV1 {
  key: string;
  situationId: string;
  promiseId: string;
  requires: 'exists' | 'resolved';
}

export interface PromiseSafeOutcomesV1 {
  effectsByGrade: Partial<Record<'success' | 'full_success', CampaignEffectSpec[]>>;
  claimsByGrade: Partial<Record<'success' | 'full_success', PromiseEffectClaimV1[]>>;
}

function ownerSituationId(ref: string, fallback: string): string {
  return ref === 'self' || ref === '__self__' ? fallback : ref;
}

function promiseRefKey(situationId: string, promiseId: string): string {
  return `${situationId}\u0000${promiseId}`;
}

function oneTimeRewardTarget(effect: CampaignEffectSpec, resolveActor: (id: string) => string): string | undefined {
  switch (effect.template) {
    case 'situation_counter': return `counter:${effect.situationId}:${effect.counterId}`;
    case 'relationship_shift': return `relationship:${resolveActor(effect.fromActorId)}:${resolveActor(effect.toActorId)}`;
    case 'grant_item': return `item:${effect.itemId}:${resolveActor(effect.toActorId)}`;
    case 'resource_change': return `resource:${resolveActor(effect.actorId)}:${effect.resourceId}`;
    case 'condition_apply': return `condition:${resolveActor(effect.actorId)}:${effect.conditionId}`;
    case 'condition_remove': return `condition:${resolveActor(effect.actorId)}:${effect.conditionId}`;
    default: return undefined;
  }
}

function claimKey(situationId: string, promiseId: string, target: string): string {
  return `campaign-promise-effect:v1:${encodeURIComponent(situationId)}:${encodeURIComponent(promiseId)}:${encodeURIComponent(target)}`;
}

/**
 * Freeze one-time side rewards with the promise fact that authorizes them.
 * Keys intentionally omit method id, artifact revision and roll grade, so a
 * changed version or asymmetric success grade cannot release the same target
 * reward again. Independent knowledge and stage-closing facts remain intact.
 */
export function preparePromiseSafeOutcomes(input: {
  state: GameStateSnapshot;
  situationId: string;
  method: MethodTemplateV1;
  resolveActor?: (id: string) => string;
}): PromiseSafeOutcomesV1 {
  const grades = ['success', 'full_success'] as const;
  const resolveActor = input.resolveActor ?? (id => id);
  const raw: Record<'success' | 'full_success', CampaignEffectSpec[]> = {
    success: [...(input.method.outcomeTemplates?.success?.effects ?? [])],
    full_success: [...(input.method.outcomeTemplates?.full_success?.effects ?? [])],
  };
  const promiseRefs = new Map<string, { situationId: string; promiseId: string; kindsByGrade: Set<'success' | 'full_success'>; requires: 'exists' | 'resolved' }>();
  for (const grade of grades) for (const effect of raw[grade]) {
    if (effect.template !== 'promise_create' && effect.template !== 'promise_fulfill' && effect.template !== 'promise_break') continue;
    const situationId = ownerSituationId(effect.situationId, input.situationId);
    const key = promiseRefKey(situationId, effect.promiseId);
    const ref = promiseRefs.get(key) ?? { situationId, promiseId: effect.promiseId, kindsByGrade: new Set<'success' | 'full_success'>(), requires: 'exists' as 'exists' | 'resolved' };
    ref.kindsByGrade.add(grade);
    if (effect.template !== 'promise_create') ref.requires = 'resolved';
    promiseRefs.set(key, ref);
  }
  const statePromises = new Map((input.state.situations ?? []).flatMap(situation =>
    (situation.promises ?? []).map(promise => [promiseRefKey(situation.situationId, promise.promiseId), promise.status] as const)));
  const existingKeys = new Set(input.state.campaignRuntime?.grantedRewardKeys ?? []);
  const targetsByRef = new Map<string, Set<string>>();
  for (const [refKey, ref] of promiseRefs) {
    const targets = new Set<string>();
    // If any successful grade makes the promise transition, a matching target
    // in either success grade is the same bundled reward identity.
    for (const grade of ref.kindsByGrade) for (const effect of raw[grade]) {
      const target = oneTimeRewardTarget(effect, resolveActor);
      if (target) targets.add(target);
    }
    targetsByRef.set(refKey, targets);
  }

  const effectsByGrade: PromiseSafeOutcomesV1['effectsByGrade'] = {};
  const claimsByGrade: PromiseSafeOutcomesV1['claimsByGrade'] = {};
  for (const grade of grades) {
    const kept: CampaignEffectSpec[] = [];
    const claims: PromiseEffectClaimV1[] = [];
    for (const effect of raw[grade]) {
      const target = oneTimeRewardTarget(effect, resolveActor);
      const pairedRefs = target ? [...promiseRefs.entries()].filter(([refKey, ref]) =>
        targetsByRef.get(refKey)?.has(target) && ref.kindsByGrade.size > 0) : [];
      if (pairedRefs.length > 0 && !pairedRefs.some(([, ref]) => ref.kindsByGrade.has(grade))) {
        // A success grade cannot collect a promise-bundled reward while
        // omitting the promise fact that makes that reward available.
        continue;
      }
      const usedRef = pairedRefs.find(([refKey, ref]) => {
        const status = statePromises.get(refKey);
        const alreadyEstablished = ref.requires === 'resolved'
          ? status === 'fulfilled' || status === 'broken'
          : status !== undefined;
        return existingKeys.has(claimKey(ref.situationId, ref.promiseId, target!)) || alreadyEstablished;
      });
      if (usedRef) continue;
      kept.push(effect);
      if (target) for (const [refKey, ref] of pairedRefs) {
        if (!ref.kindsByGrade.has(grade)) continue;
        const status = statePromises.get(refKey);
        const gradeHasCreation = raw[grade].some(candidate => candidate.template === 'promise_create'
          && ownerSituationId(candidate.situationId, input.situationId) === ref.situationId && candidate.promiseId === ref.promiseId);
        const gradeHasResolution = raw[grade].some(candidate => (candidate.template === 'promise_fulfill' || candidate.template === 'promise_break')
          && ownerSituationId(candidate.situationId, input.situationId) === ref.situationId && candidate.promiseId === ref.promiseId);
        if (gradeHasCreation || gradeHasResolution || status === 'fulfilled' || status === 'broken') {
          claims.push({ key: claimKey(ref.situationId, ref.promiseId, target), situationId: ref.situationId,
            promiseId: ref.promiseId, requires: gradeHasCreation && !gradeHasResolution ? 'exists' : 'resolved' });
        }
      }
    }
    effectsByGrade[grade] = kept;
    claimsByGrade[grade] = [...new Map(claims.map(claim => [claim.key, claim])).values()];
  }
  return { effectsByGrade, claimsByGrade };
}
