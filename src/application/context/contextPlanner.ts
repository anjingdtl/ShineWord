/**
 * Turn context planner (plan §57, §102): collect -> filter -> relevance ->
 * elastic allocation (M1 kernel) -> freeze -> render.
 *
 * The kernel resolves the window/output/reasoning budget from REAL
 * capabilities; unknown capabilities fall back to the legacy fixed-budget
 * rendering so a bad profile can never make a campaign unplayable - the
 * fallback is explicit on the frozen context, never silent.
 */

import type { ContextCandidate } from './contextTypes';
import { clipTextToTokens, estimateTokens } from './tokenEstimate';
import { freezeTurnContext, type FrozenIncludedCandidate, type FrozenTurnContext } from './contextSnapshot';
import {
  BudgetInfeasibleError,
  type FrozenModelCapabilities,
  type LlmRequestPlanningInput,
  type OutputDemand,
} from '../llm/requestPlan';
import { planLlmRequest } from '../llm/requestBudgetKernel';
import { REASONING_POLICY_VERSION } from '../llm/reasoningPolicy';

export interface TurnContextPlanInput {
  requestKind: 'planner' | 'narrator';
  branchId: string;
  stateVersion: number;
  candidates: readonly ContextCandidate[];
  capabilities: FrozenModelCapabilities;
  businessOutputDemand: OutputDemand;
  /** Protocol tokens that must survive regardless of candidate pressure. */
  estimatedMandatoryInputTokens: number;
  reasoningBudget?: LlmRequestPlanningInput['reasoningBudget'];
  reasoningReserveTokens?: number;
  reasoningPolicy?: LlmRequestPlanningInput['reasoningPolicy'];
  providerWireMaxOutputTokens?: number;
  /** P8-1: collector refusals frozen onto the context for audit. */
  collectionDiagnostics?: readonly string[];
}

export interface TurnContextPlanResult {
  context: FrozenTurnContext;
  /** Output tokens the provider request should carry. */
  requestedOutputTokens: number;
  /** Wire budget includes the frozen reasoning reserve when supported. */
  wireOutputTokens: number;
  envelope: {
    hard: number;
    soft: number;
    burst: number;
  } | null;
}

/** Legacy fixed budgets, used only when capabilities are unknown. */
export const LEGACY_PLANNER_OUTPUT_TOKENS = 1200;
export const LEGACY_NARRATOR_OUTPUT_TOKENS = 1500;

export function planTurnContext(input: TurnContextPlanInput): TurnContextPlanResult {
  let plan: ReturnType<typeof planLlmRequest> | null = null;
  let fallbackReason: string | undefined;
  try {
    plan = planLlmRequest({
      capabilities: input.capabilities,
      requestKind: input.requestKind === 'planner' ? 'planner' : 'narrator',
      estimatedMandatoryInputTokens: input.estimatedMandatoryInputTokens,
      businessOutputDemand: input.businessOutputDemand,
      contextDemands: input.candidates.map(candidate => ({
        id: candidate.id,
        board: candidate.board,
        requirement: candidate.requirement,
        priority: candidate.priority,
        relevance: candidate.relevance,
        estimatedTokens: candidate.estimatedTokens,
        minTokens: candidate.minTokens,
        targetTokens: candidate.targetTokens,
        clipMode: candidate.clipMode,
      })),
      reasoningBudget: input.reasoningBudget,
      reasoningReserveTokens: input.reasoningReserveTokens,
      reasoningPolicy: input.reasoningPolicy,
      providerWireMaxOutputTokens: input.providerWireMaxOutputTokens,
    });
  } catch (error) {
    if (!(error instanceof BudgetInfeasibleError)) throw error;
    // Unknown/unusable capabilities -> legacy path, explicitly flagged.
    plan = null;
    fallbackReason = `${error.code}: ${error.message}`;
  }

  if (!plan) {
    return renderLegacy(input, fallbackReason);
  }

  const allocationById = new Map((plan.allocation?.allocations ?? []).map(entry => [entry.id, entry]));
  const included: FrozenIncludedCandidate[] = [];
  const dropped: string[] = [];
  for (const candidate of input.candidates) {
    const entry = allocationById.get(candidate.id);
    if (!entry || entry.allocated <= 0) {
      dropped.push(candidate.id);
      continue;
    }
    if (candidate.clipMode === 'whole_item' && entry.allocated < candidate.estimatedTokens) {
      // Whole-or-nothing (plan §16): a half character card is worse than an
      // absent one; mandatory floors are guaranteed by the allocator.
      if (candidate.requirement !== 'mandatory') {
        dropped.push(candidate.id);
        continue;
      }
    }
    const clipped = entry.allocated < candidate.estimatedTokens;
    const text = clipped
      ? clipTextToTokens(candidate.text, entry.allocated)
      : candidate.text;
    included.push({
      id: candidate.id,
      board: candidate.board,
      heading: candidate.heading,
      text,
      allocatedTokens: entry.allocated,
      clipped,
    });
  }
  const estimatedTotal = included.reduce((sum, item) => sum + estimateTokens(item.text), 0);
  const context = freezeTurnContext({
    requestKind: input.requestKind,
    branchId: input.branchId,
    stateVersion: input.stateVersion,
    modelProfileFingerprint: plan.capabilitiesFingerprint,
    budgetPlanFingerprint: plan.contextPlanId,
    reasoning: plan.reasoningPolicy ? {
      tier: plan.reasoningPolicy.tier,
      effectiveTier: plan.reasoningPolicy.effectiveTier,
      reserveTokens: plan.reasoningPolicy.reserveTokens,
      policyVersion: plan.reasoningPolicy.policyVersion,
    } : undefined,
    included,
    droppedCandidateIds: dropped,
    estimatedTokens: estimatedTotal,
    collectionDiagnostics: input.collectionDiagnostics,
  });
  return {
    context,
    requestedOutputTokens: plan.requestedOutputTokens,
    wireOutputTokens: plan.wireOutputTokens,
    envelope: {
      hard: plan.envelope.hardInputLimit,
      soft: plan.envelope.softInputLimit,
      burst: plan.envelope.burstInputLimit,
    },
  };
}

function renderLegacy(input: TurnContextPlanInput, fallbackReason?: string): TurnContextPlanResult {
  const included: FrozenIncludedCandidate[] = input.candidates.map(candidate => ({
    id: candidate.id,
    board: candidate.board,
    heading: candidate.heading,
    text: candidate.text,
    allocatedTokens: candidate.estimatedTokens,
    clipped: false,
  }));
  const context = freezeTurnContext({
    requestKind: input.requestKind,
    branchId: input.branchId,
    stateVersion: input.stateVersion,
    modelProfileFingerprint: 'legacy',
    budgetPlanFingerprint: 'legacy',
    reasoning: input.reasoningPolicy ? {
      tier: input.reasoningPolicy.tier,
      effectiveTier: input.reasoningPolicy.tier,
      reserveTokens: null,
      policyVersion: REASONING_POLICY_VERSION,
    } : undefined,
    included,
    droppedCandidateIds: [],
    estimatedTokens: included.reduce((sum, item) => sum + estimateTokens(item.text), 0),
    legacyFallback: true,
    fallbackReason,
    collectionDiagnostics: input.collectionDiagnostics,
  });
  return {
    context,
    requestedOutputTokens: input.requestKind === 'planner'
      ? LEGACY_PLANNER_OUTPUT_TOKENS
      : LEGACY_NARRATOR_OUTPUT_TOKENS,
    wireOutputTokens: input.requestKind === 'planner'
      ? LEGACY_PLANNER_OUTPUT_TOKENS
      : LEGACY_NARRATOR_OUTPUT_TOKENS,
    envelope: null,
  };
}
