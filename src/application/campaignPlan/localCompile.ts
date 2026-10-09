import type {
  CampaignContentArtifactV1,
  CampaignClueArtifactV1,
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
import { actorReferenceInScope } from '../../domain/campaignPlan/actorReferences';

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
  /** Exact ids loaded from this snapshot's verified artifact binding, never a prefix heuristic. */
  campaignEntryIds?: ReadonlySet<string>;
  /** Opening actor ids (branch cards) and npc template ids in scope. */
  openingActorIds: ReadonlySet<string>;
  openingTemplateIds: ReadonlySet<string>;
  openingLocationId: string;
  protagonistSkills: ReadonlySet<string>;
  protagonistActorId?: string;
  /** Public, living actors at the actual current location, including aliases. */
  presentActorRefs?: readonly string[];
  protagonistSkillRanks?: Readonly<Record<string, string>>;
  /** Director-only actor details at the anchor; never a public projection. */
  actorMaterials?: ReadonlyArray<{ actorId: string; name: string; description: string; goal: string }>;
  openingFacts?: ReadonlyArray<{ factId: string; subject: string; predicate: string; value: unknown }>;
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
  knowledgeAliases: ReadonlyMap<string, string>,
): SituationCondition | null {
  const resolveSituation = (id: string): string => situationAliases.get(id) ?? id;
  const actor = (id: string): string => ['pc','player','self','__player__','玩家'].includes(id)
    ? ctx.protagonistActorId ?? [...ctx.openingActorIds][0] ?? id : id;
  switch (node.kind) {
    case 'all':
    case 'any': {
      const children = (node.of ?? []).map(child => compileCondition(child, ctx, situationAliases, errors, knowledgeAliases));
      if (children.some(child => child === null)) return null;
      return { kind: node.kind, of: children as SituationCondition[] };
    }
    case 'not': {
      const inner = (node.of ?? [])[0];
      const child = inner ? compileCondition(inner, ctx, situationAliases, errors, knowledgeAliases) : null;
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
      return { kind: 'knowledge_known', entryId: knowledgeAliases.get(node.entryId!) ?? node.entryId! };
    case 'relationship_at_least':
      return { kind: 'relationship_at_least', fromActorId: actor(node.fromActorId!), toActorId: actor(node.toActorId!), closeness: node.closeness! };
    case 'item_owned':
      return { kind: 'item_owned_by', itemId: node.itemId!, actorId: actor(node.actorId!) };
    case 'actor_alive':
      return { kind: 'actor_alive', actorId: actor(node.actorId!) };
    case 'actor_dead':
      return { kind: 'not', of: { kind: 'actor_alive', actorId: actor(node.actorId!) } };
    case 'node_succeeded':
      return { kind: 'campaign_node_status', nodeId: node.nodeId!, status: 'succeeded' };
    default:
      errors.push(`condition: unknown template ${String((node as { kind: string }).kind)}.`);
      return null;
  }
}

function compileEffect(effect: import('../../domain/campaignPlan/types').CampaignEffectSpec,
  situationAliases: ReadonlyMap<string, string>, knowledgeAliases: ReadonlyMap<string, string>): typeof effect {
  if (effect.template === 'grant_knowledge') return { ...effect, entryId: knowledgeAliases.get(effect.entryId) ?? effect.entryId };
  if ('situationId' in effect) return { ...effect, situationId: situationAliases.get(effect.situationId) ?? effect.situationId } as typeof effect;
  return effect;
}

export function campaignClueEntryId(planId: string, revision: number, clueId: string): string {
  return `camp-clue-${sha256HexOf(canonicalJsonOf({ planId, revision, clueId })).slice(0, 24)}`;
}

function compileOutcomeTemplates(
  method: { outcomes: CampaignPlanCandidateModelV1['firstSituation']['methods'][number]['outcomes'] },
  situationAliases: ReadonlyMap<string, string>,
  errors: string[],
  knowledgeAliases: ReadonlyMap<string, string>,
): Record<'full_success' | 'success' | 'failure' | 'severe_failure', MethodOutcomeTemplateV1> | null {
  const out: Partial<Record<'full_success' | 'success' | 'failure' | 'severe_failure', MethodOutcomeTemplateV1>> = {};
  for (const grade of ['full_success', 'success', 'failure', 'severe_failure'] as const) {
    const spec = method.outcomes[grade];
    if (!spec) { errors.push(`outcome ${grade}: missing.`); return null; }
    const effects = spec.effects.map(effect => compileEffect(effect, situationAliases, knowledgeAliases));
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
  knowledgeAliases: ReadonlyMap<string, string>,
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
    if (method.firstStep.targetEntryId && !actorReferenceInScope(method.firstStep.targetEntryId, ctx)) {
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
    const outcomeTemplates = compileOutcomeTemplates(method, situationAliases, errors, knowledgeAliases);
    if (!outcomeTemplates) continue;
    const { condition: requirement, ...requires } = method.requires;
    const condition = requirement ? compileCondition(requirement, ctx, situationAliases, errors, knowledgeAliases) : null;
    if (requirement && !condition) continue;
    methods.push({
      methodId: method.methodId,
      title: method.title,
      goal: method.goal,
      firstStep: { ...method.firstStep },
      requires: {
        ...requires,
        ...(requires.knowledgeEntryId ? { knowledgeEntryId: knowledgeAliases.get(requires.knowledgeEntryId) ?? requires.knowledgeEntryId } : {}),
        ...(condition ? { condition } : {}),
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
  return methods;
}

function compileNodes(
  model: CampaignPlanCandidateModelV1,
  ctx: LocalCompileContext,
  situationAliases: ReadonlyMap<string, string>,
  errors: string[],
  knowledgeAliases: ReadonlyMap<string, string>,
): CampaignNodeV1[] {
  const nodes: CampaignNodeV1[] = [];
  for (const stage of model.stages) {
    const activation = stage.activation ? compileCondition(stage.activation, ctx, situationAliases, errors, knowledgeAliases) : null;
    if (stage.activation && activation === null) continue;
    const completion = compileCondition(stage.completion, ctx, situationAliases, errors, knowledgeAliases);
    if (completion === null) continue;
    const failure = stage.failure ? compileCondition(stage.failure, ctx, situationAliases, errors, knowledgeAliases) : null;
    if (stage.failure && failure === null) continue;
    const cancellation = stage.cancellation ? compileCondition(stage.cancellation, ctx, situationAliases, errors, knowledgeAliases) : null;
    if (stage.cancellation && cancellation === null) continue;
    const sourceFactIds = stage.provenance.sourceFactIds ?? [];
    // A false citation is a validation failure, not permission to rewrite the
    // model's provenance. Share the same contract as campaign clues.
    if (sourceFactIds.some(id => !ctx.availableFactIds.has(id))
      || (stage.provenance.kind === 'canon_inspired' && sourceFactIds.length === 0)
      || (stage.provenance.kind === 'design_fill' && sourceFactIds.length > 0)) {
      errors.push(`stage ${stage.nodeId}: provenance must use locally verified facts or an honest design_fill.`);
    }
    const provenance = { ...stage.provenance, sourceFactIds: [...sourceFactIds] };
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
  situationId?: string;
  /** Preparation materializes this successor instead of replacing the opener. */
  firstSituationNodeId?: string;
}): LocalCompileOutput {
  const { model, intent, ctx } = input;
  const errors: string[] = [];
  const situationEntryId = input.situationId ?? FIRST_SITUATION_ENTRY_ID;
  const situationAliases = new Map<string, string>([['self', situationEntryId]]);
  const knowledgeAliases = new Map<string, string>();
  const clues: CampaignClueArtifactV1[] = [];
  for (const clue of model.clues ?? []) {
    if (knowledgeAliases.has(clue.clueId) || ctx.visibleEntries.some(e => e.entryId === clue.clueId)) {
      errors.push(`clue ${clue.clueId}: duplicate alias or collision with the existing catalog.`); continue;
    }
    for (const id of clue.sourceEntryIds) {
      if (!ctx.visibleEntries.some(e => e.entryId === id)) errors.push(`clue ${clue.clueId}: source ${id} is outside the bound catalog.`);
    }
    const sourceFactIds = clue.provenance.sourceFactIds ?? [];
    if (sourceFactIds.some(id => !ctx.availableFactIds.has(id))
      || (clue.provenance.kind === 'canon_inspired' && sourceFactIds.length === 0)
      || (clue.provenance.kind === 'design_fill' && sourceFactIds.length > 0)) {
      errors.push(`clue ${clue.clueId}: provenance must use locally verified facts or an honest design_fill.`);
    }
    const entryId = campaignClueEntryId(input.planId, input.revision, clue.clueId);
    knowledgeAliases.set(clue.clueId, entryId);
    clues.push({ entryId, definition: { name: clue.title, title: clue.title, text: clue.text },
      provenance: { ...clue.provenance, sourceFactIds }, dependencyIds: [...clue.sourceEntryIds] });
  }
  const nodes = compileNodes(model, ctx, situationAliases, errors, knowledgeAliases);
  const methods = compileMethods(model, ctx, situationAliases, errors, knowledgeAliases);
  const endings: CampaignEndingV1[] = [];
  for (const ending of model.endings) {
    const condition = compileCondition(ending.condition, ctx, situationAliases, errors, knowledgeAliases);
    if (condition === null) continue;
    endings.push({
      endingId: ending.endingId, title: ending.title,
      publicDescription: ending.publicDescription,
      condition, outcomeKind: ending.outcomeKind,
    });
  }
  // Missing exits are validation errors; the compiler cannot invent a success ending.
  const startNodes = nodes.filter(node => node.activation === null).map(node => node.nodeId);
  // Wire the concrete start stage to the first situation.
  const concreteStart = input.firstSituationNodeId
    ? nodes.find(node => node.nodeId === input.firstSituationNodeId)
    : nodes.find(node => startNodes.includes(node.nodeId) && node.coverage === 'concrete')
      ?? nodes.find(node => startNodes.includes(node.nodeId));
  if (input.firstSituationNodeId && !concreteStart) errors.push('prepared successor is missing from the candidate graph');
  if (concreteStart) {
    concreteStart.situationRef = situationEntryId;
    concreteStart.coverage = 'concrete';
  }
  // Materialized coverage is a compiler fact, not a model assertion. Only the
  // first situation is compiled here; other unbuilt stages remain provisional.
  for (const node of nodes) {
    if (node !== concreteStart && !ctx.visibleEntries.some(e => e.kind === 'situation' && e.entryId === node.situationRef)) node.coverage = 'provisional';
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
    .map(reward => ({
      policyId: reward.policyId, nodeId: reward.nodeId,
      description: reward.description, rewards: reward.rewards.map(spec => ({ ...spec,
        ...(spec.kind === 'knowledge' ? { targetId: knowledgeAliases.get(spec.targetId) ?? spec.targetId } : {}),
        ...(spec.toActorId && ['pc','player','self','__player__','玩家'].includes(spec.toActorId)
          ? { toActorId: intent.protagonistBinding.actorId } : {}) })),
    }));
  const artifactDraft: Omit<CampaignContentArtifactV1, 'contentHash'> = {
    schemaVersion: CAMPAIGN_CONTENT_SCHEMA,
    artifactId: `camp-art-${input.planId}-r${input.revision}`,
    campaignId: `pending:${intent.setupId}`,
    scope: 'campaign',
    planId: input.planId,
    planRevision: input.revision,
    namespace: 'campaign',
    situations: [{ entryId: situationEntryId, nodeId: concreteStart?.nodeId ?? nodes[0]?.nodeId ?? '', definition: situationDefinition }],
    ...(clues.length ? { clues } : {}),
    rewardPolicies,
    consequenceTemplates: model.consequences.map(consequence => ({
      consequenceId: consequence.consequenceId,
      description: consequence.description,
      triggerCondition: compileCondition(consequence.trigger, ctx, situationAliases, errors, knowledgeAliases) ?? { kind: 'world_time_at_least', order: 0 },
      effectSpecs: consequence.effects.map(effect => compileEffect(effect, situationAliases, knowledgeAliases)),
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
  if (clues.length || ctx.campaignEntryIds?.size) {
    const referenced = new Set(clues.flatMap(clue => clue.dependencyIds));
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        if (ctx.visibleEntries.some(entry => entry.entryId === value)) referenced.add(value);
      } else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect([nodes, endings, methods, artifactDraft.consequenceTemplates, rewardPolicies]);
    const campaignEntryIds = [...referenced].filter(id => ctx.campaignEntryIds?.has(id)).sort();
    artifactDraft.dependencies = { worldEntryIds: [...new Set([...artifactDraft.dependencies.worldEntryIds,
      ...[...referenced].filter(id => !ctx.campaignEntryIds?.has(id))])].filter(id => !ctx.campaignEntryIds?.has(id)).sort(),
      ...(campaignEntryIds.length ? { campaignEntryIds } : {}) };
  }
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
    unresolvedDependencies: nodes.filter(node => node.coverage === 'provisional').map(node => ({
      nodeId: node.nodeId, kind: 'content_prep' as const, description: `为“${node.publicObjective}”准备当前事实下的可执行局面。`,
    })),
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
