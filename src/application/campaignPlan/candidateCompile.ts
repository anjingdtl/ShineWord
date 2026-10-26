/**
 * Candidate compile + validate (convergence plan W3, commit 1).
 *
 * Extracted verbatim from the `runCandidateJob` closure so the compile and
 * validation pipeline is callable for ANY candidate source — the LLM job and
 * the local baseline builder (W3 commit 2) run the exact same checks with the
 * exact same error strings. This module must stay source-agnostic: it never
 * asks where `model` came from.
 */
import { canonicalJsonOf, sha256HexOf } from './hashing';
import { compileCampaignPlan } from './localCompile';
import { validateCampaignPlan, validateOrdinarySuccessCompletion } from '../../domain/campaignPlan/planValidation';
import { validateEndingCompletionOrder } from '../../domain/campaignPlan/endingValidation';
import { validateCampaignPlanCausality } from '../../domain/campaignPlan/causalityValidation';
import type { CampaignPlanCandidateModelV1 } from './candidateModel';
import type { FrozenPlanJob, } from './jobFreeze';
import { thawPlanContext } from './jobFreeze';
import { assessMethod } from '../guidance/candidates';
import { openingRelationshipFor } from '../campaign/recruitment';

/** Job identity the closure needed for plan ids and context assembly. */
export interface CandidateCompileJobScope {
  jobId: string;
  setupId: string;
  branchId: string | null;
  now: () => string;
  committedEvents: ReadonlyArray<{ eventType: string; payload: unknown }>;
}

export function compileAndValidateCandidate(
  frozen: FrozenPlanJob,
  model: CampaignPlanCandidateModelV1,
  scope: CandidateCompileJobScope,
): { compiled: ReturnType<typeof compileCampaignPlan>; errors: string[] } {
  const ctx = thawPlanContext(frozen);
  const baseRuntime = frozen.baseState?.campaignRuntime;
  const compiled = compileCampaignPlan({ model, intent: frozen.intent, ctx,
    planId: baseRuntime ? `plan-replan-${sha256HexOf(scope.branchId!).slice(0, 24)}` : `plan-${scope.setupId}`,
    revision: baseRuntime ? baseRuntime.planBinding.revision + 1 : 1,
    parentRevision: baseRuntime?.planBinding.revision ?? null, createdAt: scope.now(),
    ...(frozen.preparedNodeId ? { firstSituationNodeId: frozen.preparedNodeId } : {}),
    ...(baseRuntime ? { situationId: `camp-sit-${sha256HexOf(scope.jobId).slice(0, 16)}` } : {}) });
  if (baseRuntime && frozen.basePlan) {
    const terminal = new Set(baseRuntime.nodeStates.filter(n => ['succeeded','failed','superseded','cancelled'].includes(n.status)).map(n => n.nodeId));
    const retired = new Set(frozen.basePlan.retiredNodeIds ?? []);
    for (const situation of compiled.artifact.situations) {
      if (terminal.has(situation.nodeId) || retired.has(situation.nodeId)) {
        compiled.errors.push(`firstSituation targets committed or retired node ${situation.nodeId}; provide a current unfinished stage`);
      }
    }
    const targetId = frozen.preparedNodeId;
    if (targetId) {
      const target = compiled.plan.nodes.find(node => node.nodeId === targetId);
      if (!target) compiled.errors.push('prepared successor is missing');
      if (compiled.artifact.rewardPolicies.some(policy => policy.nodeId !== targetId)) compiled.errors.push('preparation reward is outside the frozen successor');
      for (const situation of compiled.artifact.situations) {
        situation.definition.activation = { kind: 'any', of: [
          { kind: 'campaign_node_status', nodeId: targetId, status: 'active' },
          { kind: 'campaign_node_status', nodeId: targetId, status: 'suspended' },
        ] };
      }
      const { contentHash: _artifactHash, ...artifactBody } = compiled.artifact;
      compiled.artifact.contentHash = sha256HexOf(canonicalJsonOf(artifactBody));
      compiled.plan = { ...frozen.basePlan, planId: compiled.plan.planId, revision: compiled.plan.revision,
        parentRevision: compiled.plan.parentRevision, createdAt: compiled.plan.createdAt,
        contentArtifactRefs: [...compiled.plan.contentArtifactRefs, ...frozen.basePlan.contentArtifactRefs],
        unresolvedDependencies: frozen.basePlan.unresolvedDependencies.filter(d => d.nodeId !== targetId),
        nodes: frozen.basePlan.nodes.map(node => node.nodeId === targetId && target ? { ...node,
          coverage: 'concrete', situationRef: target.situationRef,
          rewardPolicyRefs: [...new Set([...(node.rewardPolicyRefs ?? []), ...target.rewardPolicyRefs])],
          consequenceRefs: [...new Set([...(node.consequenceRefs ?? []), ...target.consequenceRefs])] } : node) };
    } else {
      const newNodeIds = new Set(compiled.plan.nodes.filter(n => !terminal.has(n.nodeId)).map(n => n.nodeId));
      compiled.plan.retiredNodeIds = frozen.basePlan.nodes.filter(n => !newNodeIds.has(n.nodeId)).map(n => n.nodeId);
      compiled.plan.nodes = [...frozen.basePlan.nodes.filter(n => !newNodeIds.has(n.nodeId)), ...compiled.plan.nodes.filter(n => !terminal.has(n.nodeId))];
      compiled.plan.startNodeIds = compiled.plan.startNodeIds.filter(id => !terminal.has(id));
      compiled.plan.contentArtifactRefs = [...compiled.plan.contentArtifactRefs, ...frozen.basePlan.contentArtifactRefs];
    }
    const { contentHash: _hash, ...body } = compiled.plan;
    compiled.plan.contentHash = sha256HexOf(canonicalJsonOf(body));
  }
  const state = frozen.baseState;
  const cards = (state?.cards ?? []).map(row => row.card as import('../../domain/characters/card').ActorCard);
  const playerCard = cards.find(card => card.actorId === frozen.intent.protagonistBinding.actorId);
  const openingRelationships = frozen.intent.companionBindings.flatMap(companion => {
    const entry = ctx.visibleEntries.find(e => e.entryId === companion.templateId && e.kind === 'actor_template');
    const relationship = entry ? openingRelationshipFor(entry, frozen.intent.openingAnchor.worldTimeOrder) : null;
    return relationship ? [{ fromActorId: companion.actorId, toActorId: frozen.intent.protagonistBinding.actorId,
      closeness: relationship.closeness }] : [];
  });
  const executableMethodIds = state && playerCard ? new Set(compiled.artifact.situations.flatMap(s => s.definition.methods
    .filter(method => assessMethod(s.entryId, method, { state, playerCard,
      cardsByName: new Map(cards.filter(c => ctx.presentActorRefs?.includes(c.actorId)).map(c => [c.actorId, c])),
      entries: ctx.visibleEntries, situationStatuses: new Map((state.situations ?? []).map(s => [s.situationId, s])),
      causalWorldTimeOrder: ctx.coverageWorldTimeOrder }).eligible).map(method => method.methodId))) : undefined;
  const errors = [...compiled.errors, ...validateCampaignPlan(compiled.plan, {
    ...(frozen.preparedNodeId ? { materializedNodeId: frozen.preparedNodeId } : {}),
    visibleWorldEntryIds: new Set(ctx.visibleEntries.filter(e => !ctx.campaignEntryIds?.has(e.entryId)).map(e => e.entryId)),
    campaignKnowledgeEntryIds: new Set(ctx.visibleEntries.filter(e => e.kind === 'lore' && ctx.campaignEntryIds?.has(e.entryId)).map(e => e.entryId)),
    adoptedCampaignEntryIds: ctx.campaignEntryIds, availableFactIds: ctx.availableFactIds, openingActorIds: ctx.openingActorIds,
    openingTemplateIds: ctx.openingTemplateIds, artifactSituationIds: new Set([...compiled.artifact.situations.map(s => s.entryId), ...(frozen.baseState?.situations ?? []).map(s => s.situationId)]), protagonistSkills: ctx.protagonistSkills,
    presentActorRefs: ctx.presentActorRefs, protagonistSkillRanks: ctx.protagonistSkillRanks,
    executableMethodIds,
    completionBaseline: { committedEvents: scope.committedEvents },
    knownPromiseRefs: (frozen.baseState?.situations ?? []).flatMap(s => (s.promises ?? []).map(p => ({ situationId: s.situationId, promiseId: p.promiseId }))),
    knownLocationIds: new Set(ctx.visibleEntries.filter(e => e.kind === 'scene').map(e => (e.definition as { locationId: string }).locationId)) }, compiled.artifact),
    ...validateOrdinarySuccessCompletion(compiled.plan, compiled.artifact, {
      playerActorId: frozen.intent.protagonistBinding.actorId,
      relationships: state?.relationships ?? openingRelationships, discoveries: state?.discoveries,
      actorAliases: state ? cards : frozen.intent.companionBindings,
      situations: state?.situations,
      committedEvents: scope.committedEvents,
    }, frozen.preparedNodeId), ...validateEndingCompletionOrder(compiled.plan, compiled.artifact),
    // The full frozen journey was validated when adopted. A scoped stage
    // materialization contains only one playable situation, so re-running
    // the global delayed-consequence minimum against this partial artifact
    // would reject valid preparation even though all inherited plan nodes,
    // endings, and consequence refs remain frozen and unchanged.
    ...(frozen.preparedNodeId ? [] : validateCampaignPlanCausality(compiled.plan, compiled.artifact))];
  return { compiled, errors };
}
