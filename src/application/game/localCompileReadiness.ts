import type { ActorCard } from '../../domain/characters/card';
import type { CampaignContentArtifactV1, CampaignPlanV1 } from '../../domain/campaignPlan/types';
import type { ContentEntry } from '../../domain/content/types';
import type { GameStateSnapshot } from '../../domain/state/types';
import type { PlannerProposal } from '../../domain/turns/proposal';
import { assertValidPlannerProposal } from '../../domain/turns/proposal';
import type { MethodTemplateV1, SituationDefinitionV1, SituationSnapshotEntry } from '../../domain/situations/types';
import { requireCompiledRules } from '../content/runtimeRules';
import { assessMethod, resolveMethodActor } from '../guidance/candidates';
import { outcomeSetHashFor } from '../campaignPlan/localCompile';
import { campaignContentBindingHash } from '../campaignPlan/contentBinding';
import { canonicalJsonOf, sha256HexOf } from '../campaignPlan/hashing';
import { campaignCompletionRewardBlocker } from '../campaignPlan/routeReadiness';

export interface LocalCompileMethodRef {
  situationId: string;
  methodId: string;
}

export interface LocalCompileSelectionV1 {
  proposal: PlannerProposal;
  selectedMethodRef: LocalCompileMethodRef;
  candidateRef: string;
  expectedStateVersion: number;
  methodOutcomeSetHash: string;
  campaignBindingHash: string;
}

export type LocalCompileReadiness =
  | { kind: 'ready'; selection: LocalCompileSelectionV1 }
  | { kind: 'legacy_l2' }
  | { kind: 'planner_required'; campaignBindingHash: string }
  | { kind: 'refused'; code: string };

export interface LocalCompileReadinessInput {
  state: GameStateSnapshot;
  plan: CampaignPlanV1 | null;
  artifacts: readonly CampaignContentArtifactV1[];
  situationDefinitions: ReadonlyArray<{ situationId: string; definition: SituationDefinitionV1 }>;
  selectedMethods: ReadonlyArray<{ situationId: string; method: MethodTemplateV1 }>;
  selectedMethodRef: LocalCompileMethodRef;
  candidateRef: string;
  turnId: string;
  playerIntent: string;
  playerCard: ActorCard;
  cards: readonly ActorCard[];
  entries: readonly ContentEntry[];
}

/** Stable contract identity for one locally compiled campaign method. */
export function localCompileCampaignBindingHash(
  state: GameStateSnapshot,
  method: MethodTemplateV1,
): string {
  return sha256HexOf(canonicalJsonOf({
    schema: 'local-compile-campaign-binding-v1',
    branchId: state.branchId,
    stateVersion: state.stateVersion,
    planBinding: state.campaignRuntime?.planBinding ?? null,
    campaignContentBinding: state.campaignContentBinding ?? null,
    ruleBindingHash: method.ruleBindingHash ?? null,
    methodOutcomeSetHash: outcomeSetHashFor(method),
  }));
}

/**
 * Pure local readiness gate. It accepts only the exact selected method in the
 * current published artifact/runtime binding and returns a PlannerProposal
 * whose authoritative difficulty/evidence fields came from the method.
 */
export function evaluateLocalCompileReadiness(input: LocalCompileReadinessInput): LocalCompileReadiness {
  const { state, selectedMethodRef, candidateRef } = input;
  const methodMatches = input.selectedMethods.filter(item => item.situationId === selectedMethodRef.situationId
    && item.method.methodId === selectedMethodRef.methodId);
  if (methodMatches.length !== 1 || candidateRef !== `method:${selectedMethodRef.situationId}:${selectedMethodRef.methodId}`) {
    return { kind: 'refused', code: 'method_not_currently_selected' };
  }
  const { method } = methodMatches[0]!;
  const actorBlocker = campaignCompletionRewardBlocker({
    state, plan: input.plan, artifacts: input.artifacts,
    situationId: selectedMethodRef.situationId, method,
  });
  if (actorBlocker) {
    return { kind: 'refused', code: actorBlocker === 'campaign_method_actor_unavailable'
      ? actorBlocker : 'campaign_completion_reward_unavailable' };
  }
  const hasAnyPolicy = method.difficultyPolicy !== undefined || method.evidencePolicy !== undefined
    || method.evidenceAllowlist !== undefined || method.ruleBindingHash !== undefined;
  if (!hasAnyPolicy) return { kind: 'legacy_l2' };
  if (!method.difficultyPolicy || !method.evidencePolicy || !method.evidenceAllowlist || !method.ruleBindingHash) {
    return { kind: 'refused', code: 'method_policy_incomplete' };
  }
  if (!isLocalPolicyShapeValid(method)) return { kind: 'refused', code: 'method_policy_invalid' };

  const runtime = state.campaignRuntime;
  const contentBinding = state.campaignContentBinding;
  const plan = input.plan;
  if (!runtime || !plan || runtime.campaignStatus !== 'active'
    || runtime.planBinding.planId !== plan.planId
    || runtime.planBinding.revision !== plan.revision
    || runtime.planBinding.contentHash !== plan.contentHash
    || !contentBinding || contentBinding.artifactIds.length === 0
    || !/^[a-f0-9]{64}$/i.test(contentBinding.contentHash)) {
    return { kind: 'refused', code: 'campaign_content_binding_mismatch' };
  }
  if (plan.ruleBindingHash !== method.ruleBindingHash) return { kind: 'refused', code: 'rule_binding_mismatch' };
  const { contentHash: planContentHash, ...planBody } = plan;
  if (planContentHash !== sha256HexOf(canonicalJsonOf(planBody))) {
    return { kind: 'refused', code: 'campaign_content_binding_mismatch' };
  }
  const boundArtifacts = input.artifacts.filter(artifact => contentBinding.artifactIds.includes(artifact.artifactId));
  if (boundArtifacts.length !== contentBinding.artifactIds.length
    || new Set(contentBinding.artifactIds).size !== contentBinding.artifactIds.length
    || boundArtifacts.some(artifact => {
      const { contentHash, ...body } = artifact;
      return contentHash !== sha256HexOf(canonicalJsonOf(body));
    })
    || campaignContentBindingHash(boundArtifacts) !== contentBinding.contentHash) {
    return { kind: 'refused', code: 'campaign_content_binding_mismatch' };
  }
  if (!state.ruleConfiguration) return { kind: 'refused', code: 'rule_binding_missing' };
  let currentRuleBindingHash: string;
  try {
    currentRuleBindingHash = sha256HexOf(canonicalJsonOf(requireCompiledRules(state.ruleConfiguration).binding));
  } catch {
    return { kind: 'refused', code: 'rule_binding_invalid' };
  }
  if (currentRuleBindingHash !== method.ruleBindingHash) return { kind: 'refused', code: 'rule_binding_mismatch' };

  // A replan can add a later stage while an earlier stage remains active.
  // The current branch then binds artifacts from more than one plan revision;
  // only newly introduced stages live in the current plan's artifact. Prefer
  // the current revision when it defines this situation, otherwise resolve
  // the still-active situation from the composite branch binding.
  const boundSituationSources = boundArtifacts.flatMap(artifact => artifact.situations
    .filter(situation => situation.entryId === selectedMethodRef.situationId)
    .map(situation => ({ artifact, situation })));
  const currentRevisionSources = boundSituationSources.filter(({ artifact }) =>
    artifact.planId === plan.planId && artifact.planRevision === plan.revision);
  const authoritativeSources = currentRevisionSources.length > 0 ? currentRevisionSources : boundSituationSources;
  const activeSources = authoritativeSources.filter(({ situation }) =>
    runtime.nodeStates.find(node => node.nodeId === situation.nodeId)?.status === 'active');
  const publishedMethods = activeSources
    .map(({ situation }) => situation.definition.methods.find(item => item.methodId === selectedMethodRef.methodId))
    .filter((published): published is MethodTemplateV1 => published !== undefined);
  const publishedMethod = publishedMethods.length === 1 ? publishedMethods[0] : undefined;
  if (!publishedMethod || outcomeSetHashFor(method) !== outcomeSetHashFor(publishedMethod)) {
    return { kind: 'refused', code: 'method_published_binding_mismatch' };
  }
  const situation = input.situationDefinitions.find(item => item.situationId === selectedMethodRef.situationId);
  const status = (state.situations ?? []).find(item => item.situationId === selectedMethodRef.situationId);
  if (!situation || status?.status !== 'active') return { kind: 'refused', code: 'situation_not_active' };

  const situationStatuses = new Map<string, SituationSnapshotEntry>((state.situations ?? []).map(item => [item.situationId, item]));
  const assessed = assessMethod(selectedMethodRef.situationId, method, {
    state,
    playerCard: input.playerCard,
    cardsByName: new Map(input.cards.map(card => [card.actorId, card])),
    entries: input.entries,
    situationStatuses,
    causalWorldTimeOrder: state.causalWorldTimeOrder ?? 0,
  });
  if (!assessed.visible || !assessed.eligible) return { kind: 'refused', code: 'method_not_visible_or_eligible' };

  if (method.difficultyPolicy.kind === 'planner_required' || method.evidencePolicy.kind === 'planner_required') {
    return { kind: 'planner_required', campaignBindingHash: localCompileCampaignBindingHash(state, method) };
  }
  if (!['simple', 'normal', 'challenging', 'peak'].includes(method.difficultyPolicy.band)
    || !Array.isArray(method.evidenceAllowlist)
    || new Set(method.evidenceAllowlist).size !== method.evidenceAllowlist.length
    || method.evidencePolicy.evidenceIds.some(id => !method.evidenceAllowlist!.includes(id)
      || !input.entries.some(entry => entry.entryId === id))) {
    return { kind: 'refused', code: 'fixed_policy_evidence_invalid' };
  }

  const step = method.firstStep;
  const targetId = step.targetEntryId ? resolveMethodActor(step.targetEntryId, state, input.cards) : undefined;
  if (step.targetEntryId && !targetId) return { kind: 'refused', code: 'method_target_unavailable' };
  const proposal: PlannerProposal = {
    proposalVersion: '2.0',
    turnId: input.turnId,
    expectedStateVersion: state.stateVersion,
    actorId: input.playerCard.actorId,
    actionKind: step.actionKind,
    intent: input.playerIntent,
    evidenceIds: [...method.evidencePolicy.evidenceIds],
    ...(step.skillId ? { skillId: step.skillId } : {}),
    ...(step.abilityId ? { abilityId: step.abilityId } : {}),
    ...(targetId ? { targetId } : {}),
    ...(step.destinationId ? { destinationId: step.destinationId } : {}),
    ...(step.actionKind === 'skill_check' ? { difficultyBand: method.difficultyPolicy.band } : {}),
    candidateRef,
  };
  try {
    assertValidPlannerProposal(proposal);
  } catch {
    return { kind: 'refused', code: 'local_proposal_invalid' };
  }
  return {
    kind: 'ready',
    selection: {
      proposal,
      selectedMethodRef,
      candidateRef,
      expectedStateVersion: state.stateVersion,
      methodOutcomeSetHash: outcomeSetHashFor(method),
      campaignBindingHash: localCompileCampaignBindingHash(state, method),
    },
  };
}

function isLocalPolicyShapeValid(method: MethodTemplateV1): boolean {
  const difficulty = method.difficultyPolicy as unknown as Record<string, unknown>;
  const evidence = method.evidencePolicy as unknown as Record<string, unknown>;
  const reference = (value: unknown): value is string => typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
  const difficultyValid = difficulty.kind === 'fixed'
    ? ['simple', 'normal', 'challenging', 'peak'].includes(String(difficulty.band))
      && Object.keys(difficulty).every(key => key === 'kind' || key === 'band')
    : difficulty.kind === 'planner_required' && Object.keys(difficulty).every(key => key === 'kind');
  const allowlist = method.evidenceAllowlist;
  const allowlistValid = Array.isArray(allowlist) && allowlist.length <= 16
    && allowlist.every(reference) && new Set(allowlist).size === allowlist.length;
  const evidenceValid = evidence.kind === 'fixed'
    ? Array.isArray(evidence.evidenceIds) && evidence.evidenceIds.length <= 16
      && evidence.evidenceIds.every(reference) && new Set(evidence.evidenceIds).size === evidence.evidenceIds.length
      && Object.keys(evidence).every(key => key === 'kind' || key === 'evidenceIds')
    : evidence.kind === 'planner_required' && Object.keys(evidence).every(key => key === 'kind');
  const fixedEvidenceInAllowlist = evidence.kind !== 'fixed'
    || (Array.isArray(evidence.evidenceIds) && evidence.evidenceIds.every((id: unknown) =>
      typeof id === 'string' && method.evidenceAllowlist!.includes(id)));
  return difficultyValid && evidenceValid && allowlistValid
    && typeof method.ruleBindingHash === 'string' && /^[a-f0-9]{64}$/i.test(method.ruleBindingHash)
    && fixedEvidenceInAllowlist;
}
