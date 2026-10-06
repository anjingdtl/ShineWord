import type {
  CampaignContentArtifactV1,
  CampaignEndingV1,
  CampaignIntentV1,
  CampaignNodeV1,
  CampaignPlanV1,
  CampaignRewardPolicyV1,
} from '../../domain/campaignPlan/types';
import {
  CAMPAIGN_CONTENT_SCHEMA,
  CAMPAIGN_PLAN_COMPILER_VERSION,
  CAMPAIGN_PLAN_SCHEMA,
} from '../../domain/campaignPlan/types';
import type { MethodOutcomeTemplateV1, SituationCondition, SituationDefinitionV1, MethodTemplateV1 } from '../../domain/situations/types';
import type { ContentEntry } from '../../domain/content/types';
import type { ConditionTemplateNode, CampaignPlanCandidateModelV1, StageSpec } from './candidateModel';
import { canonicalJsonOf, sha256HexOf } from './hashing';

/**
 * Local campaign compiler (plan §6.2/§6.3): turns a STRICTLY parsed candidate
 * model + trusted local context into the authoritative plan and content
 * artifact. Every reference is resolved locally; every number comes from
 * validated bounds. The output runs through validateCampaignPlan before any
 * candidate can become ready.
 */

export interface LocalCompileContext {
  worldId: string;
  packageRevision: number;
  packageContentHash: string;
  coverageWorldTimeOrder: number;
  ruleBindingHash: string;
  /** Player-visible entries at the anchor (visibility/anchor filtered upstream). */
  visibleEntries: readonly ContentEntry[];
  /** Opening actor ids (branch cards) and npc template ids in scope. */
  openingActorIds: ReadonlySet<string>;
  openingTemplateIds: ReadonlySet<string>;
  openingLocationId: string;
  protagonistSkills: ReadonlySet<string>;
  /** Canon fact ids available for provenance grounding. */
  availableFactIds: ReadonlySet<string>;
}

export interface LocalCompileOutput {
  plan: CampaignPlanV1;
  artifact: CampaignContentArtifactV1;
  /** Errors when references do not close locally; plan/artifact undefined then. */
  errors: string[];
}

const FIRST_SITUATION_ENTRY_ID = 'camp-sit-open';

export function firstSituationEntryId(): string {
  return FIRST_SITUATION_ENTRY_ID;
}

/** Collects campaign_node_status references from a compiled condition. */
function collectConditionNodeRefs(condition: unknown): string[] {
  if (!condition || typeof condition !== 'object') return [];
  const node = condition as { kind?: string; nodeId?: unknown; of?: unknown };
  if (node.kind === 'campaign_node_status' && typeof node.nodeId === 'string') return [node.nodeId];
  if (Array.isArray(node.of)) return node.of.flatMap(collectConditionNodeRefs);
  return [];
}
function compileCondition(
  node: ConditionTemplateNode,
  ctx: LocalCompileContext,
  situationAliases: ReadonlyMap<string, string>,
  errors: string[],
): SituationCondition | null {
  const resolveSituation = (id: string): string => situationAliases.get(id) ?? id;
  switch (node.kind) {
    case 'all':
    case 'any': {
      const children = (node.of ?? []).map(child => compileCondition(child, ctx, situationAliases, errors));
      if (children.some(child => child === null)) return null;
      return { kind: node.kind, of: children as SituationCondition[] };
    }
    case 'not': {
      const inner = (node.of ?? [])[0];
      const child = inner ? compileCondition(inner, ctx, situationAliases, errors) : null;
      return child ? { kind: 'not', of: child } : null;
    }
    case 'situation_resolved':
      return { kind: 'situation_status', situationId: resolveSituation(node.situationId!), status: 'resolved' };
    case 'situation_status':
      return { kind: 'situation_status', situationId: resolveSituation(node.situationId!), status: (node.status ?? 'resolved') as 'resolved' };
    case 'quest_succeeded':
      return { kind: 'quest_status', questId: node.questId!, status: 'succeeded' };
    case 'committed_event':
      return { kind: 'committed_event', eventType: node.eventType!, ...(node.payloadMatch ? { payloadMatch: node.payloadMatch } : {}) };
    case 'counter_at_least':
      return { kind: 'situation_counter_at_least', situationId: resolveSituation(node.situationId!), counterId: node.counterId!, minimum: node.minimum! };
    case 'promise_fulfilled':
      return { kind: 'promise_status', situationId: resolveSituation(node.situationId!), promiseId: node.promiseId!, status: 'fulfilled' };
    case 'knowledge_known':
      return { kind: 'knowledge_known', entryId: node.entryId! };
    case 'relationship_at_least':
      return { kind: 'relationship_at_least', fromActorId: node.fromActorId!, toActorId: node.toActorId!, closeness: node.closeness! };
    case 'item_owned':
      return { kind: 'item_owned_by', itemId: node.itemId!, actorId: node.actorId! };
    case 'actor_alive':
      return { kind: 'actor_alive', actorId: node.actorId! };
    case 'actor_dead':
      return { kind: 'not', of: { kind: 'actor_alive', actorId: node.actorId! } };
    case 'node_succeeded':
      return { kind: 'campaign_node_status', nodeId: node.nodeId!, status: 'succeeded' };
    default:
      errors.push(`condition: unknown template ${String((node as { kind: string }).kind)}.`);
      return null;
  }
}

function compileOutcomeTemplates(
  method: { outcomes: CampaignPlanCandidateModelV1['firstSituation']['methods'][number]['outcomes'] },
  situationAliases: ReadonlyMap<string, string>,
  errors: string[],
): Record<'full_success' | 'success' | 'failure' | 'severe_failure', MethodOutcomeTemplateV1> | null {
  const out: Partial<Record<'full_success' | 'success' | 'failure' | 'severe_failure', MethodOutcomeTemplateV1>> = {};
  for (const grade of ['full_success', 'success', 'failure', 'severe_failure'] as const) {
    const spec = method.outcomes[grade];
    if (!spec) { errors.push(`outcome ${grade}: missing.`); return null; }
    const effects = spec.effects.map(effect => {
      if ('situationId' in effect && typeof effect.situationId === 'string') {
        return { ...effect, situationId: situationAliases.get(effect.situationId) ?? effect.situationId } as typeof effect;
      }
      return effect;
    });
    out[grade] = {
      achieved: grade === 'full_success' || grade === 'success',
      resultFact: spec.resultFact,
      effects,
    };
  }
  return out as Record<'full_success' | 'success' | 'failure' | 'severe_failure', MethodOutcomeTemplateV1>;
}

function compileMethods(
  model: CampaignPlanCandidateModelV1,
  ctx: LocalCompileContext,
  situationAliases: ReadonlyMap<string, string>,
  errors: string[],
): MethodTemplateV1[] {
  const skillIds = new Set(ctx.visibleEntries.filter(entry => entry.kind === 'skill').flatMap(entry => [entry.entryId, entry.entryId.replace(/^skill-/, '')]));
  const abilityIds = new Set(ctx.visibleEntries.filter(entry => entry.kind === 'ability').flatMap(entry => [entry.entryId, entry.entryId.replace(/^ability-/, '')]));
  const itemIds = new Set(ctx.visibleEntries.filter(entry => entry.kind === 'item').map(entry => entry.entryId));
  const methods: MethodTemplateV1[] = [];
  for (const method of model.firstSituation.methods) {
    if (method.firstStep.skillId && !skillIds.has(method.firstStep.skillId) && !skillIds.has(method.firstStep.skillId.replace(/^skill-/, ''))) {
      errors.push(`method ${method.methodId}: skill ${method.firstStep.skillId} not visible at the anchor.`);
      continue;
    }
    if (method.firstStep.abilityId && !abilityIds.has(method.firstStep.abilityId) && !abilityIds.has(method.firstStep.abilityId.replace(/^ability-/, ''))) {
      errors.push(`method ${method.methodId}: ability ${method.firstStep.abilityId} not visible at the anchor.`);
      continue;
    }
    if (method.firstStep.targetEntryId && !ctx.openingTemplateIds.has(method.firstStep.targetEntryId) && !ctx.openingActorIds.has(method.firstStep.targetEntryId)) {
      errors.push(`method ${method.methodId}: target ${method.firstStep.targetEntryId} not in the opening scope.`);
      continue;
    }
    if (method.firstStep.destinationId) {
      const locationIds = new Set(ctx.visibleEntries.filter(entry => entry.kind === 'scene')
        .map(entry => (entry.definition as { locationId?: string }).locationId).filter((id): id is string => typeof id === 'string'));
      locationIds.add(ctx.openingLocationId);
      if (!locationIds.has(method.firstStep.destinationId)) {
        errors.push(`method ${method.methodId}: destination ${method.firstStep.destinationId} not a visible scene.`);
        continue;
      }
    }
    // Dangling schedule_consequence refs (model named a consequence it never
    // defined, or the consequence was dropped) are removed here instead of
    // failing the plan — scheduling is optional enrichment.
    const knownConsequenceIds = new Set(model.consequences.map(c => c.consequenceId));
    const methodWithCleanEffects = {
      ...method,
      outcomes: Object.fromEntries(Object.entries(method.outcomes).map(([grade, outcome]) => [grade, {
        ...outcome,
        effects: outcome.effects.filter(effect => !(effect.template === 'schedule_consequence' && !knownConsequenceIds.has(effect.consequenceId))),
      }])),
    } as unknown as typeof method;
    const outcomeTemplates = compileOutcomeTemplates(methodWithCleanEffects, situationAliases, errors);
    if (!outcomeTemplates) continue;
    methods.push({
      methodId: method.methodId,
      title: method.title,
      goal: method.goal,
      firstStep: { ...method.firstStep },
      requires: {
        ...method.requires,
        ...(method.requires.skillId && !skillIds.has(method.requires.skillId) && !skillIds.has(method.requires.skillId.replace(/^skill-/, ''))
          ? (errors.push(`method ${method.methodId}: requires skill ${method.requires.skillId} not visible.`), { skillId: undefined as never })
          : {}),
      },
      tradeoffs: method.tradeoffs,
      preparation: method.preparation,
      outcomeTemplates,
    });
  }
  void itemIds;
  // Playability floor (plan §6.3): at least TWO mechanically different
  // methods. When the model returns same-shape variants (same actionKind +
  // skill + target), keep one and append a generic direct-engagement route
  // so the two-route gate always holds on the FIRST playable stage.
  const signatures = new Set(methods.map(method =>
    `${method.firstStep.actionKind}:${method.firstStep.skillId ?? '-'}:${method.firstStep.targetEntryId ?? '-'}:${method.firstStep.destinationId ?? '-'}`));
  if (methods.length >= 1 && signatures.size < 2) {
    methods.push({
      methodId: 'direct-approach',
      title: '直接行动',
      goal: `直接面对并处理：${model.firstSituation.situationTitle}`,
      firstStep: { intent: `直接介入处理：${model.firstSituation.situationTitle}`, actionKind: 'interact' },
      requires: {},
      tradeoffs: '不绕路、不收集额外信息，直接承担风险',
      preparation: '无',
      outcomeTemplates: {
        full_success: { achieved: true, resultFact: '你直接介入并稳住了局面。', effects: [] },
        success: { achieved: true, resultFact: '你直接介入，事情有了进展。', effects: [] },
        failure: { achieved: false, resultFact: '直接介入没有奏效。', effects: [] },
        severe_failure: { achieved: false, resultFact: '鲁莽的直接介入让局面更糟。', effects: [] },
      },
    });
  }
  return methods;
}

function compileNodes(
  model: CampaignPlanCandidateModelV1,
  ctx: LocalCompileContext,
  situationAliases: ReadonlyMap<string, string>,
  errors: string[],
): CampaignNodeV1[] {
  const nodes: CampaignNodeV1[] = [];
  for (const stage of model.stages) {
    const activation = stage.activation ? compileCondition(stage.activation, ctx, situationAliases, errors) : null;
    if (stage.activation && activation === null) continue;
    const completion = compileCondition(stage.completion, ctx, situationAliases, errors);
    if (completion === null) continue;
    const failure = stage.failure ? compileCondition(stage.failure, ctx, situationAliases, errors) : null;
    if (stage.failure && failure === null) continue;
    const cancellation = stage.cancellation ? compileCondition(stage.cancellation, ctx, situationAliases, errors) : null;
    if (stage.cancellation && cancellation === null) continue;
    const sourceFactIds = (stage.provenance.sourceFactIds ?? []).filter(id => ctx.availableFactIds.has(id));
    // Canon grounding is only claimed when the cited facts are LOCALLY
    // verifiable; unverifiable citations downgrade to design_fill instead of
    // rejecting the stage (创作补充不得伪装原著引用 — but a rejected stage is
    // worse than an honest design_fill).
    const provenance = sourceFactIds.length > 0
      ? { kind: 'canon_inspired' as const, sourceFactIds, rationale: stage.provenance.rationale }
      : { kind: 'design_fill' as const, sourceFactIds: [], rationale: `${stage.provenance.rationale}（原著引用未能本地核实，按设计补充处理）` };
    nodes.push({
      nodeId: stage.nodeId,
      role: stage.role,
      title: stage.title,
      publicObjective: stage.publicObjective,
      gmPurpose: stage.gmPurpose,
      activation,
      completion,
      failure,
      cancellation,
      statusDependencies: stage.dependsOn,
      alternativeNodeIds: stage.alternatives,
      nextNodeIds: stage.next,
      situationRef: stage.situationRef,
      rewardPolicyRefs: stage.rewardPolicyRefs,
      consequenceRefs: stage.consequenceRefs,
      coverage: stage.coverage,
      visibility: 'public',
      provenance,
    });
  }
  return nodes;
}

export function compileCampaignPlan(input: {
  model: CampaignPlanCandidateModelV1;
  intent: CampaignIntentV1;
  ctx: LocalCompileContext;
  planId: string;
  revision: number;
  parentRevision: number | null;
  createdAt: string;
}): LocalCompileOutput {
  const { model, intent, ctx } = input;
  const errors: string[] = [];
  const situationAliases = new Map<string, string>([['self', FIRST_SITUATION_ENTRY_ID]]);
  const nodes = compileNodes(model, ctx, situationAliases, errors);
  const methods = compileMethods(model, ctx, situationAliases, errors);
  const endings: CampaignEndingV1[] = [];
  for (const ending of model.endings) {
    const condition = compileCondition(ending.condition, ctx, situationAliases, errors);
    if (condition === null) continue;
    endings.push({
      endingId: ending.endingId, title: ending.title,
      publicDescription: ending.publicDescription,
      condition, outcomeKind: ending.outcomeKind,
    });
  }
  // Completion pass: a terminal main stage that no ending references gets a
  // synthesized success ending on its own success — completing the final
  // stage IS the natural campaign exit (plan §5.2: the compiler guarantees
  // the explicit exit instead of rejecting the whole plan).
  const endingNodeRefs = new Set(endings.flatMap(ending => collectConditionNodeRefs(ending.condition)));
  for (const node of nodes) {
    if (node.role !== 'main' || node.nextNodeIds.length > 0) continue;
    if (endingNodeRefs.has(node.nodeId)) continue;
    endings.push({
      endingId: 'end-auto-' + node.nodeId,
      title: node.title + ' · 完成',
      publicDescription: '完成「' + node.title + '」后，这段冒险迎来它的结局。',
      condition: { kind: 'campaign_node_status', nodeId: node.nodeId, status: 'succeeded' },
      outcomeKind: 'success',
    });
  }
  const startNodes = nodes.filter(node => node.activation === null).map(node => node.nodeId);
  // Wire the concrete start stage to the first situation.
  const concreteStart = nodes.find(node => startNodes.includes(node.nodeId) && node.coverage === 'concrete')
    ?? nodes.find(node => startNodes.includes(node.nodeId));
  if (concreteStart) {
    concreteStart.situationRef = concreteStart.situationRef ?? FIRST_SITUATION_ENTRY_ID;
  }
  const situationDefinition: SituationDefinitionV1 = {
    title: model.firstSituation.situationTitle,
    summary: model.firstSituation.summary,
    gmBrief: model.firstSituation.gmBrief,
    locationId: ctx.openingLocationId,
    participantEntryIds: [...ctx.openingTemplateIds].slice(0, 5),
    activation: { kind: 'world_time_at_least', order: 0 },
    signs: model.firstSituation.signs,
    pressure: {
      description: model.firstSituation.pressureDescription,
      ...(model.firstSituation.deadlineClockSeconds ? { deadlineClockSeconds: model.firstSituation.deadlineClockSeconds } : {}),
    },
    methods,
    transitions: {},
  };
  const rewardPolicies: CampaignRewardPolicyV1[] = model.rewards
    .filter(reward => nodes.some(node => node.nodeId === reward.nodeId))
    .map(reward => ({
      policyId: reward.policyId, nodeId: reward.nodeId,
      description: reward.description, rewards: reward.rewards,
    }));
  const artifactDraft: Omit<CampaignContentArtifactV1, 'contentHash'> = {
    schemaVersion: CAMPAIGN_CONTENT_SCHEMA,
    artifactId: `camp-art-${input.planId}-r${input.revision}`,
    campaignId: `pending:${intent.setupId}`,
    scope: 'campaign',
    planId: input.planId,
    planRevision: input.revision,
    namespace: 'campaign',
    situations: [{ entryId: FIRST_SITUATION_ENTRY_ID, nodeId: concreteStart?.nodeId ?? nodes[0]?.nodeId ?? '', definition: situationDefinition }],
    rewardPolicies,
    consequenceTemplates: model.consequences.map(consequence => ({
      consequenceId: consequence.consequenceId,
      description: consequence.description,
      triggerCondition: compileCondition(consequence.trigger, ctx, situationAliases, errors) ?? { kind: 'world_time_at_least', order: 0 },
      effectSpecs: consequence.effects.map(effect =>
        'situationId' in effect && typeof effect.situationId === 'string'
          ? { ...effect, situationId: situationAliases.get(effect.situationId) ?? effect.situationId } as typeof effect
          : effect),
      visibility: consequence.visibility,
    })),
    dependencies: {
      worldEntryIds: [...new Set(methods.flatMap(method => [
        method.firstStep.skillId,
        method.requires.skillId,
        (method.firstStep as { targetEntryId?: string }).targetEntryId,
      ].filter((id): id is string => typeof id === 'string')))],
    },
    provenance: { kind: 'design_fill', sourceFactIds: [], rationale: 'campaign plan compilation' },
    createdAt: input.createdAt,
  };
  const artifact: CampaignContentArtifactV1 = {
    ...artifactDraft,
    contentHash: sha256HexOf(canonicalJsonOf(artifactDraft as unknown as Record<string, unknown>)),
  };
  const intentHash = sha256HexOf(canonicalJsonOf(intent as unknown as Record<string, unknown>));
  const planDraft: Omit<CampaignPlanV1, 'contentHash'> = {
    schemaVersion: CAMPAIGN_PLAN_SCHEMA,
    planId: input.planId,
    revision: input.revision,
    parentRevision: input.parentRevision,
    intentHash,
    baseWorldBinding: {
      worldId: ctx.worldId,
      packageRevision: ctx.packageRevision,
      packageContentHash: ctx.packageContentHash,
      coverageWorldTimeOrder: ctx.coverageWorldTimeOrder,
    },
    ruleBindingHash: ctx.ruleBindingHash,
    longTermGoal: model.proposal.longTermGoal,
    publicPitch: model.proposal.publicPitch,
    gmPremise: model.proposal.gmPremise,
    tone: model.proposal.tone,
    lengthPreference: intent.lengthPreference,
    startNodeIds: startNodes.slice(0, 2),
    nodes,
    possibleEndings: endings,
    unresolvedDependencies: [],
    contentArtifactRefs: [artifact.artifactId],
    compilerVersion: CAMPAIGN_PLAN_COMPILER_VERSION,
    createdAt: input.createdAt,
  };
  const plan: CampaignPlanV1 = {
    ...planDraft,
    contentHash: sha256HexOf(canonicalJsonOf(planDraft as unknown as Record<string, unknown>)),
  };
  return { plan, artifact, errors };
}

/** Stable outcome-set identity frozen into contracts (A14/A22). */
export function outcomeSetHashFor(method: MethodTemplateV1): string {
  return sha256HexOf(canonicalJsonOf((method.outcomeTemplates ?? {}) as unknown as Record<string, unknown>)).slice(0, 32);
}
