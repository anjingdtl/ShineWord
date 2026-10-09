import type { CampaignContentArtifactV1, CampaignEffectSpec, CampaignPlanV1 } from './types';
import type { MethodTemplateV1, SituationCondition } from '../situations/types';

export interface CompletionBaseline {
  playerActorId?: string;
  relationships?: ReadonlyArray<{ fromActorId: string; toActorId: string; closeness: number }>;
  discoveries?: ReadonlyArray<{ entryId: string; actorId: string }>;
  actorAliases?: ReadonlyArray<{ actorId: string; templateId?: string }>;
  situations?: ReadonlyArray<{
    situationId: string;
    status: import('../situations/types').SituationStatus;
    counters: Readonly<Record<string, number>>;
    promises: ReadonlyArray<{ promiseId: string; status: 'open' | 'fulfilled' | 'broken' }>;
  }>;
}

/** Undefined remains unknown; authoring must not invent a negative fact. */
export function committedSituationMarker(c: SituationCondition, baseline?: CompletionBaseline): boolean | undefined {
  if (!('situationId' in c)) return undefined;
  const situation = baseline?.situations?.find(s => s.situationId === c.situationId);
  if (!situation) return undefined;
  if (c.kind === 'situation_status') return situation.status === c.status;
  if (c.kind === 'promise_status') {
    const promise = situation.promises.find(p => p.promiseId === c.promiseId);
    return promise ? promise.status === c.status : undefined;
  }
  if (c.kind === 'situation_counter_at_least') {
    const value = situation.counters[c.counterId];
    return Number.isFinite(value) ? value! >= c.minimum : undefined;
  }
  return undefined;
}

export function producesSituationMarker(e: CampaignEffectSpec, c: SituationCondition): boolean {
  if (!('situationId' in c) || !('situationId' in e) || e.situationId !== c.situationId) return false;
  if (c.kind === 'situation_status') return e.template === 'situation_status' && e.status === c.status;
  if (c.kind === 'situation_counter_at_least') return e.template === 'situation_counter' && e.counterId === c.counterId && e.delta > 0;
  if (c.kind === 'promise_status') return 'promiseId' in e && e.promiseId === c.promiseId
    && (c.status === 'open' ? e.template === 'promise_create' : c.status === 'fulfilled' ? e.template === 'promise_fulfill' : e.template === 'promise_break');
  return false;
}

/** A liberal upper bound, not a shadow engine or a winning-roll promise.
 * Preparation may repeat; one closing method ends this situation's action
 * supply. Reject only if even that optimistic supply lacks a completion route.
 * This new-authoring gate never reinterprets adopted archives.
 */
export function ordinaryCompletionBeforeExit(
  plan: CampaignPlanV1, artifact: CampaignContentArtifactV1, baseline: CompletionBaseline = {}, materializedNodeId?: string,
): boolean {
  const start = plan.nodes.find(n => (materializedNodeId ? n.nodeId === materializedNodeId : plan.startNodeIds.includes(n.nodeId)) && n.coverage === 'concrete');
  const situation = artifact.situations.find(s => s.entryId === start?.situationRef);
  if (!start || !situation) return true;
  const sid = situation.entryId, methods = situation.definition.methods;
  const allEffects = [...methods.flatMap(m => Object.values(m.outcomeTemplates ?? {}).flatMap(o => o.effects)),
    ...artifact.consequenceTemplates.flatMap(c => c.effectSpecs)];
  const actor = (id: string): string => {
    if (['pc', 'player', 'self', '__player__', '玩家'].includes(id)) return baseline.playerActorId ?? 'pc';
    const template = id.replace(/^npc-/, '');
    const aliases = baseline.actorAliases?.filter(a => a.templateId === template) ?? [];
    return aliases.length === 1 ? aliases[0]!.actorId : template;
  };
  const sameRelationship = (e: CampaignEffectSpec, c: Extract<SituationCondition, { kind: 'relationship_at_least' }>) =>
    e.template === 'relationship_shift' && actor(e.fromActorId) === actor(c.fromActorId) && actor(e.toActorId) === actor(c.toActorId);
  const initialCloseness = (c: Extract<SituationCondition, { kind: 'relationship_at_least' }>) =>
    baseline.relationships?.find(r => actor(r.fromActorId) === actor(c.fromActorId) && actor(r.toActorId) === actor(c.toActorId))?.closeness ?? 0;
  const closes = (m: MethodTemplateV1) => (m.outcomeTemplates?.success.effects ?? []).some(e =>
    e.template === 'situation_status' && e.situationId === sid && ['resolved', 'suppressed'].includes(e.status));
  const repeatable: CampaignEffectSpec[] = [];
  const possible = (c: SituationCondition, once: readonly CampaignEffectSpec[] = []): boolean => {
    if (c.kind === 'all') return c.of.every(child => possible(child, once));
    if (c.kind === 'any') return c.of.some(child => possible(child, once));
    // Negative and externally supplied facts cannot be disproved here.
    if (c.kind === 'not') return true;
    const available = [...repeatable, ...once];
    if (c.kind === 'relationship_at_least') {
      if (!allEffects.some(e => sameRelationship(e, c))) return true;
      if (repeatable.some(e => sameRelationship(e, c) && e.template === 'relationship_shift' && e.delta > 0)) return c.closeness <= 100;
      const gain = once.reduce((sum, e) => sum + (sameRelationship(e, c) && e.template === 'relationship_shift' ? Math.max(0, e.delta) : 0), 0);
      return Math.min(100, initialCloseness(c) + gain) >= c.closeness;
    }
    if (c.kind === 'knowledge_known') {
      // Opening character knowledge is finalized by creation. An absent
      // baseline must not be interpreted as proof that it is unknown.
      if (!baseline.discoveries) return true;
      if (baseline.discoveries?.some(d => d.entryId === c.entryId && (!baseline.playerActorId || d.actorId === baseline.playerActorId))) return true;
      return !allEffects.some(e => e.template === 'grant_knowledge' && e.entryId === c.entryId)
        || available.some(e => e.template === 'grant_knowledge' && e.entryId === c.entryId);
    }
    if (c.kind === 'committed_event') return !allEffects.some(e => e.template === 'record_event' && e.eventType === c.eventType)
      || available.some(e => e.template === 'record_event' && e.eventType === c.eventType);
    if (!('situationId' in c)) return true;
    const committed = committedSituationMarker(c, baseline);
    if (committed === true) return true;
    if (c.situationId !== sid && (committed !== false || !allEffects.some(e => producesSituationMarker(e, c)))) return true;
    if (c.kind === 'situation_status') return (c.situationId === sid && c.status === 'active')
      || available.some(e => producesSituationMarker(e, c));
    if (c.kind === 'situation_counter_at_least') {
      const repeats = repeatable.filter((e): e is Extract<CampaignEffectSpec, { template: 'situation_counter' }> =>
        e.template === 'situation_counter' && e.situationId === c.situationId && e.counterId === c.counterId);
      if (repeats.some(e => e.delta > 0)) return true;
      const changes = once.filter((e): e is Extract<CampaignEffectSpec, { template: 'situation_counter' }> =>
        e.template === 'situation_counter' && e.situationId === c.situationId && e.counterId === c.counterId);
      const initial = baseline.situations?.find(s => s.situationId === c.situationId)?.counters[c.counterId] ?? 0;
      return initial + changes.reduce((sum, e) => sum + Math.max(0, e.delta), 0) >= c.minimum;
    }
    if (c.kind === 'promise_status') return available.some(e => producesSituationMarker(e, c));
    return true;
  };
  const addConsequences = (once: CampaignEffectSpec[], consumed: Set<string>): boolean => {
    let changed = false;
    for (const c of artifact.consequenceTemplates) {
      if (!consumed.has(c.consequenceId)
        && [...repeatable, ...once].some(e => e.template === 'schedule_consequence' && e.consequenceId === c.consequenceId)
        && possible(c.triggerCondition, once)) {
        consumed.add(c.consequenceId); once.push(...c.effectSpecs); changed = true;
      }
    }
    return changed;
  };
  const canSupply = (m: MethodTemplateV1): boolean => {
    if (m.requires.condition && !possible(m.requires.condition)) return false;
    const prefix: CampaignEffectSpec[] = [];
    for (const effect of m.outcomeTemplates?.success.effects ?? []) {
      if ((effect.template === 'promise_fulfill' || effect.template === 'promise_break') && effect.situationId === sid
        && ![...repeatable, ...prefix].some(e => e.template === 'promise_create' && e.situationId === sid && e.promiseId === effect.promiseId)) return false;
      prefix.push(effect);
    }
    return true;
  };
  const consumedMethods = new Set<MethodTemplateV1>(), consumedConsequences = new Set<string>();
  for (let pass = 0; pass < methods.length + artifact.consequenceTemplates.length; pass++) {
    let changed = false;
    for (const m of methods) if (!closes(m) && !consumedMethods.has(m) && canSupply(m)) {
      consumedMethods.add(m); repeatable.push(...(m.outcomeTemplates?.success.effects ?? [])); changed = true;
    }
    const deferred: CampaignEffectSpec[] = [];
    // Treat deferred effects optimistically too: this is a necessary gate,
    // not an assertion that every combination can actually be played.
    if (addConsequences(deferred, consumedConsequences)) { repeatable.push(...deferred); changed = true; }
    if (!changed) break;
  }
  if (possible(start.completion)) return true;
  for (const m of methods) {
    if (!closes(m) || !canSupply(m)) continue;
    const once = [...(m.outcomeTemplates?.success.effects ?? [])], consumed = new Set(consumedConsequences);
    for (let pass = 0; pass < artifact.consequenceTemplates.length; pass++) if (!addConsequences(once, consumed)) break;
    if (possible(start.completion, once)) return true;
  }
  return false;
}
