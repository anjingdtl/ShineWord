import type {
  CampaignContentArtifactV1,
  CampaignIntentV1,
  CampaignNodeV1,
  CampaignPlanV1,
} from './types';
import { CAMPAIGN_PLAN_COMPILER_VERSION, CAMPAIGN_PLAN_SCHEMA } from './types';
import type { SituationCondition } from '../situations/types';
import { validateConditionShape } from '../situations/conditions';
import { committedSituationMarker, producesSituationMarker, ordinaryCompletionBeforeExit, type CompletionBaseline } from './ordinaryCompletion';
import { actorReferenceInScope as actorInScope } from './actorReferences';
import { validateCampaignClues } from './clues';

/**
 * Local hard gates for a compiled campaign plan (plan §6.3). Structural
 * validation only — semantic quality (intent fit, route appeal) is scored
 * separately and never claimed by these checks.
 */

export const MAX_PLAN_NODES = 12;
export const MAX_PLAN_ENDINGS = 4;
export const MIN_MAIN_NODES = 2;
function canonicalStructure(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sort(nested)])) : item;
  return JSON.stringify(sort(value));
}

export interface PlanValidationContext {
  /** Apply existing board gates to the newly materialized successor. The
   * immutable graph's original start nodes keep their meaning. */
  materializedNodeId?: string;
  /** World entry ids visible to the player at the opening anchor. */
  visibleWorldEntryIds: ReadonlySet<string>;
  /** Verified branch-bound lore ids plus the candidate's own definitions. */
  campaignKnowledgeEntryIds?: ReadonlySet<string>;
  adoptedCampaignEntryIds?: ReadonlySet<string>;
  availableFactIds?: ReadonlySet<string>;
  /** Actor ids present in the opening branch state. */
  openingActorIds: ReadonlySet<string>;
  /** Template ids usable as actor aliases (npc templates). */
  openingTemplateIds: ReadonlySet<string>;
  /** Situation entry ids the artifact itself defines. */
  artifactSituationIds?: ReadonlySet<string>;
  /** Location ids known at the anchor. */
  knownLocationIds?: ReadonlySet<string>;
  /** Protagonist opening skills (for first-stage method availability). */
  protagonistSkills?: ReadonlySet<string>;
  presentActorRefs?: readonly string[];
  protagonistSkillRanks?: Readonly<Record<string, string>>;
  /** Current-state assessment from the same eligibility gate used in play. */
  executableMethodIds?: ReadonlySet<string>;
  /** Promise identity belongs to its committed situation, never its id alone. */
  knownPromiseRefs?: ReadonlyArray<{ situationId: string; promiseId: string }>;
}

function artifactEffects(artifact: CampaignContentArtifactV1): import('./types').CampaignEffectSpec[] {
  return [...artifact.situations.flatMap(s => s.definition.methods.flatMap(m => Object.values(m.outcomeTemplates ?? {}).flatMap(o => o.effects))),
    ...artifact.consequenceTemplates.flatMap(c => c.effectSpecs)];
}

function promiseRefs(ctx: PlanValidationContext, artifact: CampaignContentArtifactV1): NonNullable<PlanValidationContext['knownPromiseRefs']> {
  return [...(ctx.knownPromiseRefs ?? []), ...artifactEffects(artifact).flatMap(e => e.template === 'promise_create'
    ? [{ situationId: e.situationId, promiseId: e.promiseId }] : [])];
}

/** New current content cannot rely on a local state change with no producer.
 * Other world/engine conditions remain governed by their existing contracts. */
function currentCompletionHasProducer(condition: SituationCondition, artifact: CampaignContentArtifactV1): boolean {
  const own = new Set(artifact.situations.map(s => s.entryId));
  const effects = artifactEffects(artifact);
  const possible = (c: SituationCondition): boolean => {
    if (c.kind === 'all') return c.of.every(possible);
    if (c.kind === 'any') return c.of.some(possible);
    if (c.kind === 'not') return true;
    if (!('situationId' in c) || !own.has(c.situationId)) return true;
    if (c.kind === 'situation_status') return c.status === 'active' || effects.some(e => e.template === 'situation_status' && e.situationId === c.situationId && e.status === c.status);
    if (c.kind === 'situation_counter_at_least') return c.minimum <= 0 || effects.some(e => e.template === 'situation_counter' && e.situationId === c.situationId && e.counterId === c.counterId && e.delta > 0);
    if (c.kind === 'promise_status') return effects.some(e => 'situationId' in e && e.situationId === c.situationId && 'promiseId' in e && e.promiseId === c.promiseId
      && (c.status === 'open' ? e.template === 'promise_create' : c.status === 'fulfilled' ? e.template === 'promise_fulfill' : e.template === 'promise_break'));
    return true;
  };
  return possible(condition);
}

/** A necessary authoring gate, not a simulation or a promise of winning rolls.
 * Reject a current stage whose own completion markers can ONLY be authored by
 * full_success. Counting ordinary successes cannot create a missing resolved
 * status/event. Existing adopted archives are deliberately not reinterpreted.
 */
export function validateOrdinarySuccessCompletion(plan: CampaignPlanV1, artifact: CampaignContentArtifactV1, baseline?: CompletionBaseline, materializedNodeId?: string): string[] {
  const start = plan.nodes.find(n => (materializedNodeId ? n.nodeId === materializedNodeId : plan.startNodeIds.includes(n.nodeId)) && n.coverage === 'concrete');
  if (!start) return [];
  const own = new Set(artifact.situations.map(s => s.entryId));
  const allEffects = artifactEffects(artifact);
  const effects: import('./types').CampaignEffectSpec[] = [];
  const methods = artifact.situations.flatMap(s => s.definition.methods);
  const possible = (c: SituationCondition): boolean => {
    if (c.kind === 'all') return c.of.every(possible);
    if (c.kind === 'any') return c.of.some(possible);
    // External/current facts and negative conditions cannot be disproved by
    // producer analysis alone. Leave them to the normal qualification gates.
    if (c.kind === 'not') return true;
    // The current stage cannot unlock its own producer by already succeeding.
    if (c.kind === 'campaign_node_status' && c.nodeId === start.nodeId) return c.status === 'active';
    if (c.kind === 'committed_event') {
      return !allEffects.some(e => e.template === 'record_event' && e.eventType === c.eventType)
        || effects.some(e => e.template === 'record_event' && e.eventType === c.eventType);
    }
    if (!('situationId' in c)) return true;
    const committed = committedSituationMarker(c, baseline);
    if (committed === true) return true;
    if (!own.has(c.situationId) && (committed !== false || !allEffects.some(e => producesSituationMarker(e, c)))) return true;
    if (c.kind === 'situation_status') return c.status === 'active'
      || effects.some(e => e.template === 'situation_status' && e.situationId === c.situationId && e.status === c.status);
    if (c.kind === 'situation_counter_at_least') return c.minimum <= 0
      || effects.some(e => e.template === 'situation_counter' && e.situationId === c.situationId && e.counterId === c.counterId && e.delta > 0);
    if (c.kind === 'promise_status') return effects.some(e => 'situationId' in e && e.situationId === c.situationId
      && 'promiseId' in e && e.promiseId === c.promiseId
      && (c.status === 'open' ? e.template === 'promise_create' : c.status === 'fulfilled' ? e.template === 'promise_fulfill' : e.template === 'promise_break'));
    return true;
  };
  // A delayed completion remains legal when ordinary successes can schedule
  // it AND produce its trigger. Unscheduled/circular/full-success-only
  // consequences must not smuggle a missing marker through the gate.
  const consumed = new Set<string>();
  const consumedMethods = new Set<import('../situations/types').MethodTemplateV1>();
  for (let pass = 0; pass < methods.length + artifact.consequenceTemplates.length; pass++) {
    let added = false;
    for (const method of methods) {
      if (!consumedMethods.has(method) && (!method.requires.condition || possible(method.requires.condition))) {
        consumedMethods.add(method); effects.push(...(method.outcomeTemplates?.success.effects ?? [])); added = true;
      }
    }
    for (const consequence of artifact.consequenceTemplates) {
      if (!consumed.has(consequence.consequenceId)
        && effects.some(e => e.template === 'schedule_consequence' && e.consequenceId === consequence.consequenceId)
        && possible(consequence.triggerCondition)) {
        consumed.add(consequence.consequenceId); effects.push(...consequence.effectSpecs); added = true;
      }
    }
    if (!added) break;
  }
  if (possible(start.completion) && !ordinaryCompletionBeforeExit(plan, artifact, baseline, materializedNodeId)) return [
    `artifact: current stage ${start.nodeId} cannot supply an ordinary completion route before its situation closes; a resolved/suppressed situation cannot repeat its methods to reach remaining counters, promises or relationships. Provide independent preparation and a final fulfillment route, or use the actual committed baseline.`,
  ];
  return possible(start.completion) ? [] : [
    `artifact: current stage ${start.nodeId} has no ordinary success producer for a completion route; provide success effects that satisfy completion, or a subsequent ordinary-success fulfillment method with independently producible prerequisites. Repeated counters/promises cannot replace a missing resolved status or event; full_success may remain a shortcut.`,
  ];
}

/** Expiration resolves a timed situation too. Resolution alone is not
 * evidence of success; every alternative using it needs a separate marker. */
function completionCanUseDeadlineAlone(condition: SituationCondition, artifact: CampaignContentArtifactV1): boolean {
  const timed = new Set(artifact.situations.filter(s => s.definition.pressure?.deadlineClockSeconds !== undefined)
    .map(s => s.entryId));
  const includesDeadline = (c: SituationCondition): boolean => {
    if (c.kind === 'all' || c.kind === 'any') return c.of.some(includesDeadline);
    if (c.kind === 'not') return false;
    return c.kind === 'situation_status' && c.status === 'resolved' && timed.has(c.situationId);
  };
  const outcomeEffects = (grades: readonly ('success' | 'full_success' | 'failure' | 'severe_failure')[]) =>
    artifact.situations.flatMap(s => s.definition.methods.flatMap(m =>
      grades.flatMap(grade => m.outcomeTemplates?.[grade]?.effects ?? [])));
  const successfulEffects = outcomeEffects(['success', 'full_success']);
  const failedEffects = outcomeEffects(['failure', 'severe_failure']);
  const markerKey = (...parts: string[]) => JSON.stringify(parts);
  const successfulCounters = new Set(successfulEffects.flatMap(e => e.template === 'situation_counter' && e.delta > 0
    ? [markerKey(e.situationId, e.counterId)] : []));
  const failedCounters = new Set(failedEffects.flatMap(e => e.template === 'situation_counter' && e.delta > 0
    ? [markerKey(e.situationId, e.counterId)] : []));
  const successfulPromises = new Set(successfulEffects.flatMap(e => e.template === 'promise_fulfill'
    ? [markerKey(e.situationId, e.promiseId)] : []));
  const failedPromises = new Set(failedEffects.flatMap(e => e.template === 'promise_fulfill'
    ? [markerKey(e.situationId, e.promiseId)] : []));
  const successEvents = new Set(successfulEffects.flatMap(e => e.template === 'record_event' ? [e.eventType] : []));
  const failureEvents = new Set(failedEffects.flatMap(e => e.template === 'record_event' ? [e.eventType] : []));
  const withoutMarker = (c: SituationCondition): boolean => {
    if (c.kind === 'all') return c.of.every(withoutMarker);
    if (c.kind === 'any') return c.of.some(withoutMarker);
    if (c.kind === 'situation_counter_at_least' && timed.has(c.situationId) && c.minimum > 0
      && successfulCounters.has(markerKey(c.situationId, c.counterId))
      && !failedCounters.has(markerKey(c.situationId, c.counterId))) return false;
    if (c.kind === 'promise_status' && timed.has(c.situationId) && c.status === 'fulfilled'
      && successfulPromises.has(markerKey(c.situationId, c.promiseId))
      && !failedPromises.has(markerKey(c.situationId, c.promiseId))) return false;
    if (c.kind === 'committed_event' && successEvents.has(c.eventType) && !failureEvents.has(c.eventType)) return false;
    return true;
  };
  return includesDeadline(condition) && withoutMarker(condition);
}

export function validateCampaignIntent(intent: CampaignIntentV1): string[] {
  const errors: string[] = [];
  if (intent.schemaVersion !== 'campaign-intent-1') errors.push('intent: unknown schemaVersion.');
  if (!intent.setupId) errors.push('intent: setupId required.');
  if (!Number.isInteger(intent.intentRevision) || intent.intentRevision < 1) {
    errors.push('intent: intentRevision must be a positive integer.');
  }
  if (intent.goalMode === 'declared' && intent.normalizedIntent.trim().length === 0) {
    errors.push('intent: declared goal requires non-empty normalizedIntent.');
  }
  if (intent.goalMode === 'exploration_pending' && intent.rawIntent.trim().length > 0 && intent.normalizedIntent.trim().length === 0) {
    errors.push('intent: rawIntent present but normalizedIntent empty.');
  }
  if (intent.normalizedIntent.length > 300) errors.push('intent: normalizedIntent exceeds 300 chars.');
  if (intent.userConstraints.length > 8) errors.push('intent: at most 8 userConstraints.');
  if (intent.userConstraints.some(c => typeof c !== 'string' || c.length === 0 || c.length > 200)) {
    errors.push('intent: userConstraints must be 1..200 chars each.');
  }
  if (intent.requestedCanonTargets.some(t => typeof t !== 'string' || t.length === 0 || t.length > 120)) {
    errors.push('intent: requestedCanonTargets must be 1..120 chars each.');
  }
  if (!['short', 'medium', 'long'].includes(intent.lengthPreference)) {
    errors.push('intent: unknown lengthPreference.');
  }
  if (!intent.protagonistBinding.actorId) errors.push('intent: protagonistBinding.actorId required.');
  if (!['original', 'canon'].includes(intent.protagonistBinding.kind)) errors.push('intent: unknown protagonist kind.');
  if (intent.protagonistBinding.kind === 'canon' && !intent.protagonistBinding.canonEntityId) {
    errors.push('intent: canon protagonist requires canonEntityId.');
  }
  if (!Number.isFinite(intent.openingAnchor.worldTimeOrder)) errors.push('intent: anchor worldTimeOrder required.');
  if (!intent.openingAnchor.locationId) errors.push('intent: anchor locationId required.');
  if (!intent.sourceCoverageBinding.worldId || !Number.isInteger(intent.sourceCoverageBinding.packageRevision)) {
    errors.push('intent: sourceCoverageBinding incomplete.');
  }
  return errors;
}


function validateNodeCondition(
  node: CampaignNodeV1,
  field: 'activation' | 'completion' | 'failure' | 'cancellation',
  errors: string[],
): void {
  const condition = node[field] as SituationCondition | null;
  if (condition === null) return;
  validateConditionShape(condition, errors, `node.${node.nodeId}.${field}`);
}

function collectConditionNodeRefs(condition: SituationCondition | null): string[] {
  if (!condition) return [];
  switch (condition.kind) {
    case 'all':
    case 'any':
      return condition.of.flatMap(collectConditionNodeRefs);
    case 'not':
      return collectConditionNodeRefs(condition.of);
    case 'campaign_node_status':
      return [condition.nodeId];
    default:
      return [];
  }
}

/** Condition leaves must reference entries/actors that exist in allowed scopes. */
function validateConditionReferences(
  condition: SituationCondition | null,
  ctx: PlanValidationContext,
  errors: string[],
  prefix: string,
): void {
  if (!condition) return;
  switch (condition.kind) {
    case 'all':
    case 'any':
      condition.of.forEach((child, i) => validateConditionReferences(child, ctx, errors, `${prefix}[${i}]`));
      return;
    case 'not':
      validateConditionReferences(condition.of, ctx, errors, `${prefix}.not`);
      return;
    case 'actor_alive':
    case 'actor_at':
    case 'actor_condition': {
      if (!actorInScope(condition.actorId, ctx)) {
        errors.push(`${prefix}: actor ${condition.actorId} not in opening scope.`);
      }
      return;
    }
    case 'item_owned_by':
      if (!ctx.visibleWorldEntryIds.has(condition.itemId)) {
        errors.push(`${prefix}: item ${condition.itemId} not a visible world entry.`);
      }
      if (!actorInScope(condition.actorId, ctx)) errors.push(`${prefix}: item owner actor is outside scope.`);
      return;
    case 'relationship_at_least':
      for (const id of [condition.fromActorId, condition.toActorId]) {
        if (!actorInScope(id, ctx)) errors.push(`${prefix}: relationship actor ${id} is outside scope.`);
      }
      if (condition.closeness < 0 || condition.closeness > 100) errors.push(`${prefix}: unreachable relationship threshold; closeness must be within 0..100.`);
      return;
    case 'knowledge_known':
      if (!ctx.visibleWorldEntryIds.has(condition.entryId) && !ctx.campaignKnowledgeEntryIds?.has(condition.entryId)) {
        errors.push(`${prefix}: knowledge ${condition.entryId} not a visible world entry.`);
      }
      return;
    case 'quest_status':
      if (!ctx.visibleWorldEntryIds.has(condition.questId)) errors.push(`${prefix}: quest ${condition.questId} is outside scope.`);
      return;
    case 'situation_status':
    case 'promise_status':
    case 'situation_counter_at_least': {
      if (!ctx.visibleWorldEntryIds.has(condition.situationId)
        && !(ctx.artifactSituationIds?.has(condition.situationId) ?? false)) {
        errors.push(`${prefix}: situation ${condition.situationId} not in world or campaign content.`);
      }
      if (condition.kind === 'promise_status' && ctx.knownPromiseRefs
        && !ctx.knownPromiseRefs.some(p => p.situationId === condition.situationId && p.promiseId === condition.promiseId)) {
        errors.push(`${prefix}: unknown promise ${condition.situationId}:${condition.promiseId}.`);
      }
      return;
    }
    default:
      return;
  }
}

export function validateCampaignPlan(
  plan: CampaignPlanV1,
  ctx: PlanValidationContext,
  artifact?: CampaignContentArtifactV1,
): string[] {
  const errors: string[] = [];
  if (artifact) ctx = { ...ctx, knownPromiseRefs: promiseRefs(ctx, artifact),
    campaignKnowledgeEntryIds: new Set([...(ctx.campaignKnowledgeEntryIds ?? []), ...(artifact.clues ?? []).map(c => c.entryId)]),
    artifactSituationIds: new Set([...(ctx.artifactSituationIds ?? []), ...artifact.situations.map(s => s.entryId)]) };
  if (plan.schemaVersion !== CAMPAIGN_PLAN_SCHEMA) errors.push('plan: unknown schemaVersion.');
  if (plan.compilerVersion !== CAMPAIGN_PLAN_COMPILER_VERSION) errors.push('plan: unknown compilerVersion.');
  if (!plan.planId) errors.push('plan: planId required.');
  if (!Number.isInteger(plan.revision) || plan.revision < 1) errors.push('plan: revision must be positive.');
  if (plan.parentRevision !== null && (plan.parentRevision >= plan.revision)) {
    errors.push('plan: parentRevision must be smaller than revision.');
  }
  if (!plan.longTermGoal.trim()) errors.push('plan: longTermGoal required (公开目标非空).');
  if (plan.publicPitch.trim().length < 10) errors.push('plan: publicPitch too short.');
  if (!plan.gmPremise.trim()) errors.push('plan: gmPremise required.');
  if (!['short', 'medium', 'long'].includes(plan.lengthPreference)) errors.push('plan: unknown lengthPreference.');
  if (plan.nodes.length < MIN_MAIN_NODES) errors.push(`plan: at least ${MIN_MAIN_NODES} nodes required.`);
  if (plan.nodes.length > MAX_PLAN_NODES) errors.push(`plan: at most ${MAX_PLAN_NODES} nodes.`);
  if (plan.possibleEndings.length === 0) errors.push('plan: at least one possible ending required.');
  if (plan.possibleEndings.length > MAX_PLAN_ENDINGS) errors.push(`plan: at most ${MAX_PLAN_ENDINGS} endings.`);

  // Public projections must not leak GM premise / hidden titles.
  const publicBlob = `${plan.longTermGoal}\n${plan.publicPitch}\n${plan.nodes.map(n => `${n.title}\n${n.publicObjective}`).join('\n')}`;
  const gmSecretLines = [plan.gmPremise, ...plan.nodes.map(n => n.gmPurpose)]
    .flatMap(text => text.split(/[。；;\n]/))
    .map(s => s.trim())
    .filter(s => s.length >= 12);
  for (const secret of gmSecretLines) {
    if (publicBlob.includes(secret)) errors.push('plan: GM-only premise leaked into public projection.');
  }

  const nodeIds = new Set(plan.nodes.map(node => node.nodeId));
  if (nodeIds.size !== plan.nodes.length) errors.push('plan: duplicate nodeIds.');
  for (const node of plan.nodes) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(node.nodeId)) errors.push(`plan: illegal nodeId ${node.nodeId}.`);
    if (!node.title.trim() || node.title.length > 40) errors.push(`node ${node.nodeId}: title 1..40 chars.`);
    if (!node.publicObjective.trim() || node.publicObjective.length > 160) {
      errors.push(`node ${node.nodeId}: publicObjective 1..160 chars.`);
    }
    if (!node.gmPurpose.trim()) errors.push(`node ${node.nodeId}: gmPurpose required.`);
    if (!['main', 'optional'].includes(node.role)) errors.push(`node ${node.nodeId}: unknown role.`);
    if (!['concrete', 'provisional'].includes(node.coverage)) errors.push(`node ${node.nodeId}: unknown coverage.`);
    if (node.role === 'main' && node.coverage === 'provisional' && node.nodeId === plan.startNodeIds[0]) {
      errors.push(`node ${node.nodeId}: the first stage must be concrete (首阶段完整可玩).`);
    }
    if (node.visibility !== 'public') errors.push(`node ${node.nodeId}: only public node visibility supported.`);
    validateNodeCondition(node, 'activation', errors);
    validateNodeCondition(node, 'completion', errors);
    validateNodeCondition(node, 'failure', errors);
    validateNodeCondition(node, 'cancellation', errors);
    if (!plan.retiredNodeIds?.includes(node.nodeId)) {
      for (const field of ['completion', 'failure', 'cancellation'] as const) {
        if (collectConditionNodeRefs(node[field]).includes(node.nodeId)) errors.push(`node ${node.nodeId}.${field}: self-dependent progress condition.`);
      }
    }
    validateConditionReferences(node.activation, ctx, errors, `node ${node.nodeId}.activation`);
    validateConditionReferences(node.completion, ctx, errors, `node ${node.nodeId}.completion`);
    validateConditionReferences(node.failure, ctx, errors, `node ${node.nodeId}.failure`);
    validateConditionReferences(node.cancellation, ctx, errors, `node ${node.nodeId}.cancellation`);
    for (const ref of [...node.statusDependencies, ...node.alternativeNodeIds, ...node.nextNodeIds]) {
      if (!nodeIds.has(ref)) errors.push(`node ${node.nodeId}: unknown node ref ${ref}.`);
    }
    if (node.nextNodeIds.includes(node.nodeId) || node.statusDependencies.includes(node.nodeId)) {
      errors.push(`node ${node.nodeId}: self reference.`);
    }
    if (node.provenance.kind === 'canon_inspired' && node.provenance.sourceFactIds.length === 0) {
      errors.push(`node ${node.nodeId}: canon_inspired requires source fact ids.`);
    }
  }
  const endingConditions = new Map<string, string>();
  for (const ending of plan.possibleEndings) {
    const conditionKey = canonicalStructure(ending.condition);
    const duplicate = endingConditions.get(conditionKey);
    if (duplicate) {
      errors.push(`plan: endings ${duplicate} and ${ending.endingId} have identical conditions; each outcome needs its own reachable evidence.`);
    } else {
      endingConditions.set(conditionKey, ending.endingId);
    }
    validateConditionShape(ending.condition, errors, `ending ${ending.endingId}`);
    validateConditionReferences(ending.condition, ctx, errors, `ending ${ending.endingId}`);
    for (const nodeId of collectConditionNodeRefs(ending.condition)) {
      if (!nodeIds.has(nodeId)) errors.push(`ending ${ending.endingId}: unknown node ref ${nodeId}.`);
      if (nodeId === ending.endingId) errors.push(`ending ${ending.endingId}: self-dependent ending.`);
    }
    if (!['success', 'pyrrhic', 'failure', 'open'].includes(ending.outcomeKind)) {
      errors.push(`ending ${ending.endingId}: unknown outcomeKind.`);
    }
  }

  // Start nodes and structural reachability to an ending path.
  if (plan.startNodeIds.length === 0) errors.push('plan: startNodeIds required.');
  for (const startId of plan.startNodeIds) {
    if (!nodeIds.has(startId)) errors.push(`plan: unknown start node ${startId}.`);
  }
  const reachable = new Set<string>();
  const queue = [...plan.startNodeIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id) || !nodeIds.has(id)) continue;
    reachable.add(id);
    const node = plan.nodes.find(n => n.nodeId === id)!;
    queue.push(...node.nextNodeIds, ...node.alternativeNodeIds);
  }
  for (const node of plan.nodes.filter(n => n.role === 'main')) {
    if (plan.retiredNodeIds?.includes(node.nodeId)) continue;
    if (!reachable.has(node.nodeId)) {
      errors.push(`plan: main node ${node.nodeId} unreachable from start (主路径必须结构可达).`);
    }
  }
  // At least one ending must be structurally reachable (terminal path exists).
  const endingReachable = plan.possibleEndings.some(ending =>
    collectConditionNodeRefs(ending.condition).some(nodeId => reachable.has(nodeId))
    || ending.condition.kind === 'any'
    || collectConditionNodeRefs(ending.condition).length === 0);
  if (!endingReachable) errors.push('plan: no ending condition references a reachable node (终局路径必须存在).');
  // statusDependencies must be acyclic.
  const depColor = new Map<string, number>();
  const visitDeps = (id: string): void => {
    const color = depColor.get(id) ?? 0;
    if (color === 1) { errors.push(`plan: statusDependencies cycle at ${id}.`); return; }
    if (color === 2 || !nodeIds.has(id)) return;
    depColor.set(id, 1);
    const node = plan.nodes.find(n => n.nodeId === id);
    for (const dep of node?.statusDependencies ?? []) visitDeps(dep);
    depColor.set(id, 2);
  };
  for (const node of plan.nodes) visitDeps(node.nodeId);
  // Terminal main nodes must have an exit: success/failure condition or a next hop.
  for (const node of plan.nodes.filter(n => n.role === 'main' && n.nextNodeIds.length === 0)) {
    if (plan.retiredNodeIds?.includes(node.nodeId)) continue;
    const endingTouches = plan.possibleEndings.some(e => collectConditionNodeRefs(e.condition).includes(node.nodeId));
    if (!endingTouches) {
      errors.push(`plan: terminal main node ${node.nodeId} has no ending condition (节点需要明确退出方式).`);
    }
  }

  if (artifact) errors.push(...validateContentArtifact(plan, artifact, ctx));
  return errors;
}

/**
 * First-stage playability gates (plan §6.3): the concrete start situation
 * must expose ≥2 mechanically different methods, one executable at start.
 */
export function validateContentArtifact(
  plan: CampaignPlanV1,
  artifact: CampaignContentArtifactV1,
  ctx: PlanValidationContext,
): string[] {
  const errors: string[] = [];
  ctx = { ...ctx, knownPromiseRefs: promiseRefs(ctx, artifact),
    campaignKnowledgeEntryIds: new Set([...(ctx.campaignKnowledgeEntryIds ?? []), ...(artifact.clues ?? []).map(c => c.entryId)]),
    artifactSituationIds: new Set([...(ctx.artifactSituationIds ?? []), ...artifact.situations.map(s => s.entryId)]) };
  if (artifact.schemaVersion !== 'campaign-content-1') errors.push('artifact: unknown schemaVersion.');
  if (artifact.namespace !== 'campaign') errors.push('artifact: namespace must be campaign.');
  if (artifact.planId !== plan.planId) errors.push('artifact: planId mismatch.');
  errors.push(...validateCampaignClues(artifact, { worldEntryIds: ctx.visibleWorldEntryIds,
    campaignEntryIds: ctx.adoptedCampaignEntryIds, factIds: ctx.availableFactIds }));
  for (const id of artifact.dependencies.campaignEntryIds ?? []) {
    if (!ctx.adoptedCampaignEntryIds?.has(id)) errors.push(`artifact: dependency ${id} is not in this branch's adopted content.`);
  }
  const knownKnowledge = (id: string): boolean => ctx.visibleWorldEntryIds.has(id) || !!ctx.campaignKnowledgeEntryIds?.has(id);
  const situationIds = new Set([...artifact.situations.map(s => s.entryId), ...(ctx.artifactSituationIds ?? [])]);
  const promises = promiseRefs(ctx, artifact);
  const checkEffectActors = (spec: import('./types').CampaignEffectSpec): void => {
    if ((spec.template === 'promise_fulfill' || spec.template === 'promise_break')
      && !promises.some(p => p.situationId === spec.situationId && p.promiseId === spec.promiseId)) {
      errors.push(`artifact: unknown promise ${spec.situationId}:${spec.promiseId}; use its committed situation or create it explicitly.`);
    }
    if (spec.template === 'resource_change' && !['hp','stamina'].includes(spec.resourceId)) errors.push('artifact: resource_change requires hp or stamina; unknown resources cannot be settled.');
    for (const field of ['actorId','toActorId','fromActorId','promisorActorId','promiseeActorId'] as const) {
      const id = (spec as unknown as Record<string, unknown>)[field];
      if (typeof id === 'string' && !['pc','player','self','__player__','玩家'].includes(id) && !actorInScope(id, ctx)) {
        errors.push(`artifact: effect actor ${id} is outside scope.`);
      }
    }
  };
  for (const situation of artifact.situations) {
    if (!situation.definition.methods || situation.definition.methods.length === 0) {
      errors.push(`artifact ${situation.entryId}: situation needs methods.`);
    }
  }
  const startNode = plan.nodes.find(node => (ctx.materializedNodeId ? node.nodeId === ctx.materializedNodeId : plan.startNodeIds.includes(node.nodeId)) && node.coverage === 'concrete');
  const startSituation = startNode
    ? artifact.situations.find(s => s.entryId === startNode.situationRef)
    : artifact.situations[0];
  if (!startNode) {
    errors.push('artifact: no concrete start node situation (首阶段必须可玩).');
    return errors;
  }
  if (!startSituation) {
    errors.push(`artifact: start node ${startNode.nodeId} has no situation (situationRef unresolved).`);
    return errors;
  }
  if (!currentCompletionHasProducer(startNode.completion, artifact)) {
    errors.push(`artifact: current stage ${startNode.nodeId} completion has no local effect producer; provide a realizable outcome path.`);
  }
  if (completionCanUseDeadlineAlone(startNode.completion, artifact)) {
    errors.push(`artifact: current stage ${startNode.nodeId} can mistake a pressure deadline for success; require independent success evidence on every completion route.`);
  }
  const methods = startSituation.definition.methods ?? [];
  if (methods.length < 2) {
    errors.push('artifact: first stage needs ≥2 methods (至少两条机制不同的路线).');
  }
  const signatures = new Set<string>();
  for (const method of methods) {
    const outcomes = Object.entries(method.outcomeTemplates ?? {}).map(([grade, outcome]) => [grade, outcome.effects.map(spec => {
      if (spec.template === 'record_event') return { template: spec.template, eventType: spec.eventType };
      if (spec.template === 'situation_status') { const { resolution, ...effect } = spec; return effect; }
      return spec;
    })]);
    signatures.add(`${method.firstStep.actionKind}:${method.firstStep.skillId ?? '-'}:${method.firstStep.targetEntryId ?? '-'}:${method.firstStep.destinationId ?? '-'}:${canonicalStructure(outcomes)}`);
  }
  if (signatures.size < 2) {
    errors.push('artifact: first-stage methods are mechanically identical (同效果路线不算差异).');
  }
  const protagonistSkills = ctx.protagonistSkills ?? new Set<string>();
  const executableAtStart = methods.some(method => {
    if (ctx.executableMethodIds) return ctx.executableMethodIds.has(method.methodId);
    const req = method.requires;
    const step = method.firstStep;
    if (ctx.presentActorRefs && step.targetEntryId && !ctx.presentActorRefs.includes(step.targetEntryId)) return false;
    if (ctx.knownLocationIds && step.destinationId && !ctx.knownLocationIds.has(step.destinationId)) return false;
    // A gated route remains useful, but cannot prove an unprepared entrance.
    if (req.itemId || step.itemId || step.abilityId || req.knowledgeEntryId || req.relationshipTo
      || req.condition || req.actorAt || method.visibility) return false;
    if (ctx.presentActorRefs && req.actorAlive && !ctx.presentActorRefs.includes(req.actorAlive)) return false;
    const skill = req.skillId ?? (step.actionKind === 'skill_check' ? step.skillId : undefined);
    if (!skill) return true;
    const ranks = ['untrained', 'novice', 'trained', 'expert', 'master'];
    const actual = Object.entries(ctx.protagonistSkillRanks ?? {}).find(([id]) => id.replace(/^skill-/, '') === skill.replace(/^skill-/, ''))?.[1];
    const held = protagonistSkills.has(skill) || protagonistSkills.has(skill.replace(/^skill-/, ''));
    return (held || req.minRank === 'untrained')
      && (!req.minRank || ranks.indexOf(actual ?? (held ? 'novice' : 'untrained')) >= ranks.indexOf(req.minRank));
  });
  if (!executableAtStart) {
    errors.push('artifact: no first-stage method executable at start (至少一个当前可执行入口).');
  }
  // Situation transitions must reference artifact or world situations only.
  for (const situation of artifact.situations) {
    for (const method of situation.definition.methods ?? []) {
      if (method.requires.knowledgeEntryId && !knownKnowledge(method.requires.knowledgeEntryId)) {
        errors.push(`artifact: method ${method.methodId} requires unknown knowledge ${method.requires.knowledgeEntryId}.`);
      }
      for (const [field, condition] of [['requires.condition', method.requires.condition], ['visibility', method.visibility]] as const) {
        if (!condition) continue;
        const prefix = `method.${method.methodId}.${field}`;
        validateConditionShape(condition, errors, prefix);
        validateConditionReferences(condition, ctx, errors, prefix);
        for (const nodeId of collectConditionNodeRefs(condition)) {
          if (!plan.nodes.some(node => node.nodeId === nodeId)) errors.push(`${prefix}: unknown campaign node ${nodeId}.`);
        }
      }
      for (const grade of ['full_success', 'success', 'failure', 'severe_failure'] as const) {
        const template = method.outcomeTemplates?.[grade];
        if (!template) continue;
        if (typeof template.achieved !== 'boolean') errors.push(`artifact: outcome ${grade} achieved must be boolean.`);
        if (!template.resultFact.trim()) errors.push(`artifact: outcome ${grade} resultFact required.`);
        for (const spec of template.effects) {
          checkEffectActors(spec);
          if (spec.template === 'situation_status' || spec.template === 'situation_counter'
            || spec.template === 'promise_create' || spec.template === 'promise_fulfill'
            || spec.template === 'promise_break' || spec.template === 'suppress_reference_event') {
            if (!situationIds.has(spec.situationId) && !ctx.visibleWorldEntryIds.has(spec.situationId)) {
              errors.push(`artifact: effect references unknown situation ${spec.situationId}.`);
            }
          }
          if (spec.template === 'schedule_consequence') {
            const exists = artifact.consequenceTemplates.some(c => c.consequenceId === spec.consequenceId)
              || plan.nodes.some(n => n.consequenceRefs.includes(spec.consequenceId));
            if (!exists) errors.push(`artifact: schedule references unknown consequence ${spec.consequenceId}.`);
          }
          if (spec.template === 'grant_item' && !ctx.visibleWorldEntryIds.has(spec.itemId)) {
            errors.push(`artifact: grant_item references unknown item ${spec.itemId}.`);
          }
          if (spec.template === 'grant_knowledge' && !knownKnowledge(spec.entryId)) {
            errors.push(`artifact: grant_knowledge references unknown entry ${spec.entryId}.`);
          }
        }
      }
    }
  }
  for (const policy of artifact.rewardPolicies) {
    if (!plan.nodes.some(n => n.nodeId === policy.nodeId)) {
      errors.push(`artifact: reward policy ${policy.policyId} references unknown node.`);
    }
    for (const reward of policy.rewards) {
      if (!['skill_rank','item','knowledge','relationship','resource_cap'].includes(reward.kind)) errors.push('artifact: unknown reward kind.');
      if (reward.toActorId && !actorInScope(reward.toActorId, ctx)) errors.push(`artifact: reward actor ${reward.toActorId} is outside scope.`);
      if (reward.kind === 'relationship' && (!reward.toActorId || !actorInScope(reward.targetId, ctx))) errors.push('artifact: relationship reward requires two actors in scope.');
      if (reward.kind === 'resource_cap' && !['hp','stamina'].includes(reward.targetId)) errors.push('artifact: unknown resource cap reward.');
      if (reward.kind === 'knowledge' && !knownKnowledge(reward.targetId)) errors.push(`artifact: reward knowledge ${reward.targetId} is outside scope.`);
      if (['item','skill_rank'].includes(reward.kind) && !ctx.visibleWorldEntryIds.has(reward.targetId)
        && ![...ctx.visibleWorldEntryIds].some(id => id.replace(/^skill-/, '') === reward.targetId)) errors.push(`artifact: reward target ${reward.targetId} is outside scope.`);
      if (reward.rank && !['untrained','novice','trained','expert','master'].includes(reward.rank)) errors.push('artifact: unknown skill reward rank.');
      if (reward.delta !== undefined && (!Number.isInteger(reward.delta) || Math.abs(reward.delta) > (reward.kind === 'relationship' ? 3 : 10))) errors.push('artifact: reward delta outside bounds.');
    }
  }
  for (const consequence of artifact.consequenceTemplates) {
    validateConditionShape(consequence.triggerCondition, errors, `consequence.${consequence.consequenceId}`);
    validateConditionReferences(consequence.triggerCondition, ctx, errors, `consequence.${consequence.consequenceId}`);
    for (const effect of consequence.effectSpecs) {
      checkEffectActors(effect);
      if (effect.template === 'schedule_consequence') errors.push('artifact: nested consequence scheduling is not supported.');
      if ('situationId' in effect && !situationIds.has(effect.situationId) && !ctx.visibleWorldEntryIds.has(effect.situationId)) errors.push('artifact: consequence situation is outside scope.');
      if (effect.template === 'grant_item' && !ctx.visibleWorldEntryIds.has(effect.itemId)) errors.push('artifact: consequence item is outside scope.');
      if (effect.template === 'grant_knowledge' && !knownKnowledge(effect.entryId)) errors.push('artifact: consequence knowledge is outside scope.');
    }
  }
  return errors;
}
