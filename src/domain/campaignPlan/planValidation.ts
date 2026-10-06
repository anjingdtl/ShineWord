import type {
  CampaignContentArtifactV1,
  CampaignIntentV1,
  CampaignNodeV1,
  CampaignPlanV1,
} from './types';
import { CAMPAIGN_PLAN_COMPILER_VERSION, CAMPAIGN_PLAN_SCHEMA } from './types';
import type { SituationCondition } from '../situations/types';
import { validateConditionShape } from '../situations/conditions';

/**
 * Local hard gates for a compiled campaign plan (plan §6.3). Structural
 * validation only — semantic quality (intent fit, route appeal) is scored
 * separately and never claimed by these checks.
 */

export const MAX_PLAN_NODES = 12;
export const MAX_PLAN_ENDINGS = 4;
export const MIN_MAIN_NODES = 2;

export interface PlanValidationContext {
  /** World entry ids visible to the player at the opening anchor. */
  visibleWorldEntryIds: ReadonlySet<string>;
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
      if (!ctx.openingActorIds.has(condition.actorId) && !ctx.openingTemplateIds.has(condition.actorId)) {
        errors.push(`${prefix}: actor ${condition.actorId} not in opening scope.`);
      }
      return;
    }
    case 'item_owned_by':
      if (!ctx.visibleWorldEntryIds.has(condition.itemId)) {
        errors.push(`${prefix}: item ${condition.itemId} not a visible world entry.`);
      }
      return;
    case 'knowledge_known':
      if (!ctx.visibleWorldEntryIds.has(condition.entryId)) {
        errors.push(`${prefix}: knowledge ${condition.entryId} not a visible world entry.`);
      }
      return;
    case 'situation_status':
    case 'promise_status':
    case 'situation_counter_at_least': {
      if (!ctx.visibleWorldEntryIds.has(condition.situationId)
        && !(ctx.artifactSituationIds?.has(condition.situationId) ?? false)) {
        errors.push(`${prefix}: situation ${condition.situationId} not in world or campaign content.`);
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
    validateConditionReferences(node.activation, ctx, errors, `node ${node.nodeId}.activation`);
    validateConditionReferences(node.completion, ctx, errors, `node ${node.nodeId}.completion`);
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
  for (const ending of plan.possibleEndings) {
    validateConditionShape(ending.condition, errors, `ending ${ending.endingId}`);
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
  if (artifact.schemaVersion !== 'campaign-content-1') errors.push('artifact: unknown schemaVersion.');
  if (artifact.namespace !== 'campaign') errors.push('artifact: namespace must be campaign.');
  if (artifact.planId !== plan.planId) errors.push('artifact: planId mismatch.');
  const situationIds = new Set(artifact.situations.map(s => s.entryId));
  for (const situation of artifact.situations) {
    if (!situation.definition.methods || situation.definition.methods.length === 0) {
      errors.push(`artifact ${situation.entryId}: situation needs methods.`);
    }
  }
  const startNode = plan.nodes.find(node => plan.startNodeIds.includes(node.nodeId) && node.coverage === 'concrete');
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
  const methods = startSituation.definition.methods ?? [];
  if (methods.length < 2) {
    errors.push('artifact: first stage needs ≥2 methods (至少两条机制不同的路线).');
  }
  const signatures = new Set<string>();
  for (const method of methods) {
    signatures.add(`${method.firstStep.actionKind}:${method.firstStep.skillId ?? '-'}:${method.firstStep.targetEntryId ?? '-'}:${method.firstStep.destinationId ?? '-'}`);
  }
  if (signatures.size < 2) {
    errors.push('artifact: first-stage methods are mechanically identical (同效果路线不算差异).');
  }
  const protagonistSkills = ctx.protagonistSkills ?? new Set<string>();
  const executableAtStart = methods.some(method => {
    const skill = method.requires.skillId;
    if (!skill) return true;
    return protagonistSkills.has(skill) || protagonistSkills.has(skill.replace(/^skill-/, ''))
      || method.requires.minRank === 'untrained';
  });
  if (!executableAtStart) {
    errors.push('artifact: no first-stage method executable at start (至少一个当前可执行入口).');
  }
  // Situation transitions must reference artifact or world situations only.
  for (const situation of artifact.situations) {
    for (const method of situation.definition.methods ?? []) {
      for (const grade of ['full_success', 'success', 'failure', 'severe_failure'] as const) {
        const template = method.outcomeTemplates?.[grade];
        if (!template) continue;
        if (typeof template.achieved !== 'boolean') errors.push(`artifact: outcome ${grade} achieved must be boolean.`);
        if (!template.resultFact.trim()) errors.push(`artifact: outcome ${grade} resultFact required.`);
        for (const spec of template.effects) {
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
          if (spec.template === 'grant_knowledge' && !ctx.visibleWorldEntryIds.has(spec.entryId)) {
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
  }
  return errors;
}
