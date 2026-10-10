import type { CampaignContentArtifactV1, CampaignEffectSpec, CampaignPlanV1 } from './types';
import type { SituationCondition } from '../situations/types';

type Leaf = Exclude<SituationCondition, { kind: 'all' | 'any' | 'not' }>;
type ConditionLeaf = { leaf: Leaf; positive: boolean };

function conditionLeaves(condition: SituationCondition, positive = true): ConditionLeaf[] {
  if (condition.kind === 'not') return conditionLeaves(condition.of, !positive);
  if (condition.kind === 'all' || condition.kind === 'any') return condition.of.flatMap(child => conditionLeaves(child, positive));
  return [{ leaf: condition, positive }];
}

function nodeDistances(plan: CampaignPlanV1, startNodeId: string): Map<string, number> {
  const distances = new Map([[startNodeId, 0]]);
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = plan.nodes.find(candidate => candidate.nodeId === current);
    if (!node) continue;
    const next = [...node.nextNodeIds, ...plan.nodes.filter(candidate => candidate.statusDependencies.includes(current)).map(candidate => candidate.nodeId)];
    for (const id of next) {
      if (distances.has(id)) continue;
      distances.set(id, distances.get(current)! + 1);
      queue.push(id);
    }
  }
  return distances;
}

/**
 * Later main goals cannot reuse resolution of the opening scene as their own
 * completion evidence. The progress reducer intentionally evaluates early
 * completion, so this marker can otherwise skip the goal when the scene closes.
 */
export function validateLaterStageCompletionIsolation(plan: CampaignPlanV1): string[] {
  const retired = new Set(plan.retiredNodeIds ?? []);
  const starts = plan.nodes.filter(node => plan.startNodeIds.includes(node.nodeId) && node.situationRef);
  if (starts.length === 0) return [];
  const errors: string[] = [];
  for (const node of plan.nodes.filter(candidate => !retired.has(candidate.nodeId) && !plan.startNodeIds.includes(candidate.nodeId))) {
    const openingIds = new Set(starts.map(start => start.situationRef!));
    const reusesOpeningResolution = conditionLeaves(node.completion).some(({ leaf, positive }) => positive
      && leaf.kind === 'situation_status' && openingIds.has(leaf.situationId)
      && (leaf.status === 'resolved' || leaf.status === 'suppressed'));
    if (reusesOpeningResolution) {
      errors.push(`node ${node.nodeId}.completion: a later stage cannot complete from an opening situation resolved/suppressed marker; require evidence for this stage's objective.`);
    }
  }
  return errors;
}

function definitelyProduced(condition: SituationCondition, effects: readonly CampaignEffectSpec[]): boolean {
  if (condition.kind === 'all') return condition.of.every(child => definitelyProduced(child, effects));
  if (condition.kind === 'any') return condition.of.some(child => definitelyProduced(child, effects));
  // A negated or runtime campaign condition cannot be proven from one method's
  // effects alone; leave it to the later-stage guard below.
  if (condition.kind === 'not' || condition.kind === 'campaign_node_status') return false;
  switch (condition.kind) {
    case 'committed_event':
      return effects.some(effect => effect.template === 'record_event' && effect.eventType === condition.eventType);
    case 'knowledge_known':
      return effects.some(effect => effect.template === 'grant_knowledge' && effect.entryId === condition.entryId);
    case 'situation_status':
      return effects.some(effect => effect.template === 'situation_status'
        && effect.situationId === condition.situationId && effect.status === condition.status);
    case 'situation_counter_at_least':
      return effects.filter((effect): effect is Extract<CampaignEffectSpec, { template: 'situation_counter' }> =>
        effect.template === 'situation_counter' && effect.situationId === condition.situationId && effect.counterId === condition.counterId)
        .reduce((total, effect) => total + effect.delta, 0) >= condition.minimum;
    case 'promise_status':
      return effects.some(effect => 'situationId' in effect && effect.situationId === condition.situationId
        && 'promiseId' in effect && effect.promiseId === condition.promiseId
        && ((condition.status === 'open' && effect.template === 'promise_create')
          || (condition.status === 'fulfilled' && effect.template === 'promise_fulfill')
          || (condition.status === 'broken' && effect.template === 'promise_break')));
    case 'relationship_at_least':
      return effects.some(effect => effect.template === 'relationship_shift'
        && effect.fromActorId === condition.fromActorId && effect.toActorId === condition.toActorId
        && effect.delta >= condition.closeness);
    case 'item_owned_by':
      return effects.some(effect => effect.template === 'grant_item' && effect.itemId === condition.itemId
        && effect.toActorId === condition.actorId);
    case 'actor_condition':
      return effects.some(effect => effect.template === 'condition_apply'
        && effect.actorId === condition.actorId && effect.conditionId === condition.conditionId);
    default:
      return false;
  }
}

function everyTriggerRouteHasLaterMainGate(
  condition: SituationCondition,
  distances: ReadonlyMap<string, number>,
  plan: CampaignPlanV1,
): boolean {
  if (condition.kind === 'not') return false;
  if (condition.kind === 'all') return condition.of.some(child => everyTriggerRouteHasLaterMainGate(child, distances, plan));
  if (condition.kind === 'any') return condition.of.length > 0 && condition.of.every(child => everyTriggerRouteHasLaterMainGate(child, distances, plan));
  return condition.kind === 'campaign_node_status' && condition.status === 'succeeded'
    && distances.get(condition.nodeId)! >= 2
    && plan.nodes.some(node => node.nodeId === condition.nodeId && node.role === 'main');
}

function effectMatchesCondition(effect: CampaignEffectSpec, leaf: Leaf): boolean {
  switch (effect.template) {
    case 'grant_knowledge':
      return leaf.kind === 'knowledge_known' && leaf.entryId === effect.entryId;
    case 'grant_item':
      return leaf.kind === 'item_owned_by' && leaf.itemId === effect.itemId && leaf.actorId === effect.toActorId;
    case 'relationship_shift':
      return leaf.kind === 'relationship_at_least' && effect.delta > 0
        && leaf.fromActorId === effect.fromActorId && leaf.toActorId === effect.toActorId && leaf.closeness > 0;
    case 'situation_counter':
      return leaf.kind === 'situation_counter_at_least' && effect.delta > 0
        && leaf.situationId === effect.situationId && leaf.counterId === effect.counterId;
    case 'situation_status':
      return leaf.kind === 'situation_status' && leaf.situationId === effect.situationId && leaf.status === effect.status;
    case 'promise_create':
      return leaf.kind === 'promise_status' && leaf.status === 'open'
        && leaf.situationId === effect.situationId && leaf.promiseId === effect.promiseId;
    case 'promise_fulfill':
      return leaf.kind === 'promise_status' && leaf.status === 'fulfilled'
        && leaf.situationId === effect.situationId && leaf.promiseId === effect.promiseId;
    case 'promise_break':
      return leaf.kind === 'promise_status' && leaf.status === 'broken'
        && leaf.situationId === effect.situationId && leaf.promiseId === effect.promiseId;
    case 'record_event':
      return leaf.kind === 'committed_event' && leaf.eventType === effect.eventType;
    case 'condition_apply':
      return leaf.kind === 'actor_condition' && leaf.actorId === effect.actorId && leaf.conditionId === effect.conditionId;
    default:
      return false;
  }
}

function hasPositiveConsumer(condition: SituationCondition, effect: CampaignEffectSpec): boolean {
  return conditionLeaves(condition).some(({ leaf, positive }) => positive && effectMatchesCondition(effect, leaf));
}

function canonical(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sort(nested)])) : item;
  return JSON.stringify(sort(value));
}

function hasCoReachableConsequenceSchedulers(
  consequences: readonly CampaignContentArtifactV1['consequenceTemplates'][number][],
  sourcesByConsequence: ReadonlyMap<string, readonly {
    methodKey: string;
    outcomeGrade: 'success' | 'full_success';
    nodeId: string;
    effects: readonly CampaignEffectSpec[];
  }[]>,
  plan: CampaignPlanV1,
): boolean {
  const retired = new Set(plan.retiredNodeIds ?? []);
  const sourceNodes = consequences.map(consequence => (sourcesByConsequence.get(consequence.consequenceId) ?? [])
    .filter(source => {
      const node = plan.nodes.find(candidate => candidate.nodeId === source.nodeId);
      return Boolean(node && node.role === 'main' && !retired.has(node.nodeId));
    }));
  for (let left = 0; left < sourceNodes.length; left++) {
    for (let right = left + 1; right < sourceNodes.length; right++) {
      for (const first of sourceNodes[left]!) for (const second of sourceNodes[right]!) {
        const sameSuccessfulOutcome = first.methodKey === second.methodKey
          && first.outcomeGrade === second.outcomeGrade;
        if (sameSuccessfulOutcome && first.nodeId === second.nodeId) return true;
        // A stage resolves one situation, so different methods in that scene
        // are alternatives. They can only co-schedule across distinct main
        // stages when the campaign graph has a directed route between them.
        if (first.nodeId === second.nodeId) continue;
        if (nodeDistances(plan, first.nodeId).has(second.nodeId)
          || nodeDistances(plan, second.nodeId).has(first.nodeId)) return true;
      }
    }
  }
  return false;
}

/**
 * Long plans promise delayed consequences, not decorative templates. Require
 * ordinary-success scheduling, a genuinely later main-stage trigger, distinct
 * sources/triggers/effects, and a downstream condition that consumes an effect.
 */
export function validateLongCampaignConsequenceCausality(plan: CampaignPlanV1, artifact: CampaignContentArtifactV1): string[] {
  if (plan.lengthPreference !== 'long') return [];
  const errors: string[] = [];
  const consequences = artifact.consequenceTemplates;
  if (consequences.length < 2) errors.push('long plan: at least two executable delayed consequences are required.');
  const sourcesByConsequence = new Map<string, {
    methodKey: string;
    outcomeGrade: 'success' | 'full_success';
    nodeId: string;
    effects: readonly CampaignEffectSpec[];
  }[]>();
  for (const situation of artifact.situations) {
    const sourceNode = plan.nodes.find(node => node.situationRef === situation.entryId);
    for (const method of situation.definition.methods ?? []) {
      for (const grade of ['success', 'full_success'] as const) {
        const effects = method.outcomeTemplates?.[grade]?.effects ?? [];
        for (const schedule of effects.filter((effect): effect is Extract<CampaignEffectSpec, { template: 'schedule_consequence' }> =>
          effect.template === 'schedule_consequence')) {
          const rows = sourcesByConsequence.get(schedule.consequenceId) ?? [];
          rows.push({ methodKey: `${situation.entryId}:${method.methodId}`, outcomeGrade: grade,
            nodeId: sourceNode?.nodeId ?? '', effects });
          sourcesByConsequence.set(schedule.consequenceId, rows);
        }
      }
    }
  }
  const triggerKeys = new Set<string>();
  const effectKeys = new Set<string>();
  const retired = new Set(plan.retiredNodeIds ?? []);
  for (const consequence of consequences) {
    const sources = sourcesByConsequence.get(consequence.consequenceId) ?? [];
    if (sources.length === 0) {
      errors.push(`consequence ${consequence.consequenceId}: no ordinary-success method schedules this consequence.`);
      continue;
    }
    const distancesBySource = sources.map(source => source.nodeId ? nodeDistances(plan, source.nodeId) : new Map<string, number>());
    if (!sources.every((source, index) => source.nodeId
      && everyTriggerRouteHasLaterMainGate(consequence.triggerCondition, distancesBySource[index]!, plan))) {
      errors.push(`consequence ${consequence.consequenceId}: trigger must wait for a required main stage at least two stages after its scheduling action on every trigger path.`);
    }
    for (const source of sources) {
      if (definitelyProduced(consequence.triggerCondition, source.effects)) {
        errors.push(`consequence ${consequence.consequenceId}: the scheduling action already satisfies its trigger; delay it to a later decision.`);
        break;
      }
    }
    const triggerKey = canonical(consequence.triggerCondition);
    if (triggerKeys.has(triggerKey)) errors.push(`consequence ${consequence.consequenceId}: long consequences need distinct triggers.`);
    triggerKeys.add(triggerKey);
    const effectKey = canonical(consequence.effectSpecs);
    if (effectKeys.has(effectKey)) errors.push(`consequence ${consequence.consequenceId}: long consequences need distinct authoritative effects.`);
    effectKeys.add(effectKey);

    const triggerNodes = conditionLeaves(consequence.triggerCondition).filter(({ leaf, positive }) => positive
      && leaf.kind === 'campaign_node_status' && leaf.status === 'succeeded')
      .map(({ leaf }) => (leaf as Extract<Leaf, { kind: 'campaign_node_status' }>).nodeId);
    const consumers = new Set<string>();
    for (const triggerNodeId of triggerNodes) {
      const downstream = new Set(nodeDistances(plan, triggerNodeId).keys());
      for (const node of plan.nodes.filter(candidate => downstream.has(candidate.nodeId)
        && !retired.has(candidate.nodeId) && candidate.nodeId !== triggerNodeId)) {
        if (consequence.effectSpecs.some(effect => hasPositiveConsumer(node.completion, effect)
          || (node.activation !== null && hasPositiveConsumer(node.activation, effect)))) consumers.add(node.nodeId);
      }
      for (const ending of plan.possibleEndings) {
        const hasLaterGoal = conditionLeaves(ending.condition).some(({ leaf, positive }) => positive
          && leaf.kind === 'campaign_node_status' && leaf.status === 'succeeded'
          && (leaf.nodeId === triggerNodeId || downstream.has(leaf.nodeId)));
        if (hasLaterGoal && consequence.effectSpecs.some(effect => hasPositiveConsumer(ending.condition, effect))) {
          consumers.add(`ending:${ending.endingId}`);
        }
      }
    }
    if (consumers.size === 0) errors.push(`consequence ${consequence.consequenceId}: no later stage or ending consumes its authoritative effect.`);
  }
  if (consequences.length >= 2 && !hasCoReachableConsequenceSchedulers(consequences, sourcesByConsequence, plan)) {
    errors.push('long plan: at least two delayed consequences must be co-schedulable in one journey (the same successful outcome or sequentially reachable required main stages); alternative methods or outcome grades cannot jointly schedule them.');
  }
  return errors;
}

export function validateCampaignPlanCausality(plan: CampaignPlanV1, artifact: CampaignContentArtifactV1): string[] {
  return [
    ...validateLaterStageCompletionIsolation(plan),
    ...validateLongCampaignConsequenceCausality(plan, artifact),
  ];
}
