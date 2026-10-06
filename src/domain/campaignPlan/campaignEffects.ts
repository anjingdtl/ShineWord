import type { CampaignEffectSpec, CompiledCampaignEffects } from './types';
import type { EffectOperation } from '../turns/types';
import type { SituationTransitionOp } from '../situations/types';

/**
 * Local compiler for campaign effect specs (plan §6.2): the model selects
 * template ids + references; this module turns them into the executable
 * projection (engine effects + situation transitions + engine-origin grants)
 * and rejects anything outside the whitelist. No numbers are invented here —
 * deltas and ids come from the validated artifact.
 */

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;

export function compileCampaignEffects(
  specs: readonly CampaignEffectSpec[],
  ctx: { actorResolver?: (actorId: string) => string | undefined } = {},
): CompiledCampaignEffects {
  const effects: EffectOperation[] = [];
  const transitions: SituationTransitionOp[] = [];
  const knowledgeGrants: Array<{ entryId: string; actorId: string }> = [];
  const relationshipShifts: Array<{ fromActorId: string; toActorId: string; delta: number }> = [];
  const scheduledConsequences: string[] = [];
  const resolve = (actorId: string): string => ctx.actorResolver?.(actorId) ?? actorId;
  for (const spec of specs) {
    switch (spec.template) {
      case 'situation_status':
        transitions.push({ kind: 'set_situation_status', situationId: spec.situationId, status: spec.status, ...(spec.resolution ? { resolution: spec.resolution } : {}) });
        break;
      case 'situation_counter':
        transitions.push({ kind: 'situation_counter', situationId: spec.situationId, counterId: spec.counterId, delta: spec.delta });
        break;
      case 'promise_create':
        transitions.push({
          kind: 'promise_create', situationId: spec.situationId, promiseId: spec.promiseId,
          promisorActorId: resolve(spec.promisorActorId),
          ...(spec.promiseeActorId ? { promiseeActorId: resolve(spec.promiseeActorId) } : {}),
          description: spec.description,
        });
        break;
      case 'promise_fulfill':
        transitions.push({ kind: 'promise_fulfill', situationId: spec.situationId, promiseId: spec.promiseId });
        break;
      case 'promise_break':
        transitions.push({ kind: 'promise_break', situationId: spec.situationId, promiseId: spec.promiseId });
        break;
      case 'grant_knowledge':
        knowledgeGrants.push({ entryId: spec.entryId, actorId: resolve(spec.actorId ?? '__player__') });
        break;
      case 'grant_item':
        effects.push({ op: 'grantItem', itemId: spec.itemId, actorId: resolve(spec.toActorId) });
        break;
      case 'relationship_shift':
        relationshipShifts.push({ fromActorId: resolve(spec.fromActorId), toActorId: resolve(spec.toActorId), delta: spec.delta });
        break;
      case 'condition_apply':
        effects.push({ op: 'applyCondition', actorId: resolve(spec.actorId), conditionId: spec.conditionId });
        break;
      case 'condition_remove':
        effects.push({ op: 'removeCondition', actorId: resolve(spec.actorId), conditionId: spec.conditionId });
        break;
      case 'resource_change':
        if (spec.amount < 0) {
          effects.push({ op: 'consumeResource', actorId: resolve(spec.actorId), resourceId: spec.resourceId, amount: -spec.amount });
        } else {
          effects.push({ op: 'restoreResource', actorId: resolve(spec.actorId), resourceId: spec.resourceId, amount: spec.amount });
        }
        break;
      case 'clock_advance':
        effects.push({ op: 'advanceClock', minutes: spec.minutes });
        break;
      case 'record_event':
        if (!EVENT_TYPE_PATTERN.test(spec.eventType)) {
          throw new Error(`campaign effect record_event: illegal eventType ${spec.eventType}.`);
        }
        effects.push({ op: 'recordEvent', eventType: spec.eventType, summary: spec.summary.slice(0, 200) });
        break;
      case 'schedule_consequence':
        scheduledConsequences.push(spec.consequenceId);
        break;
      case 'suppress_reference_event':
        transitions.push({ kind: 'suppress_reference_event', situationId: spec.situationId, eventKey: spec.eventKey, reason: spec.reason });
        break;
      default:
        throw new Error(`campaign effect: unknown template ${String((spec as { template: string }).template)}.`);
    }
  }
  return { effects, transitions, knowledgeGrants, relationshipShifts, scheduledConsequences };
}

/** Relationship deltas are bounded so a single outcome cannot flip a stance wildly. */
export const RELATIONSHIP_SHIFT_BOUND = 3;

export function clampRelationshipDelta(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  return Math.max(-RELATIONSHIP_SHIFT_BOUND, Math.min(RELATIONSHIP_SHIFT_BOUND, Math.round(delta)));
}
