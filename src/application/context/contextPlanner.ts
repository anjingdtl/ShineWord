/**
 * Turn context planner (plan §57, §102; P8-2 §10): collect -> filter ->
 * relevance -> elastic allocation (M1 kernel) with whole-item reclamation ->
 * freeze -> render.
 *
 * P8-2: the legacy full-context fallback is gone (plan B07). Every
 * BudgetInfeasibleError - unknown capabilities, mandatory over the window,
 * infeasible envelope - propagates as a typed failure and the caller must
 * stop before any HTTP dispatch. Whole-item candidates that cannot fit are
 * skipped and their allocation returns to the pool for the remaining items
 * (plan §10.2; T06), with the drop reason recorded on the frozen context.
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
    contextWindowTokens: number;
    safetyMarginTokens: number;
    hard: number;
    soft: number;
    burst: number;
  };
}

/** Bounded reclamation passes; deterministic inputs converge in <= 2. */
const MAX_RECLAMATION_PASSES = 4;

interface AllocationWalk {
  included: FrozenIncludedCandidate[];
  droppedEntries: Array<{ id: string; reason: string }>;
}

function allocateOnce(
  input: TurnContextPlanInput,
  candidates: readonly ContextCandidate[],
): ReturnType<typeof planLlmRequest> {
  return planLlmRequest({
    capabilities: input.capabilities,
    requestKind: input.requestKind === 'planner' ? 'planner' : 'narrator',
    estimatedMandatoryInputTokens: input.estimatedMandatoryInputTokens,
    businessOutputDemand: input.businessOutputDemand,
    contextDemands: candidates.map(candidate => ({
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
}

function walkAllocations(
  candidates: readonly ContextCandidate[],
  plan: ReturnType<typeof planLlmRequest>,
): { walk: AllocationWalk; kept: ContextCandidate[]; reclaimable: boolean } {
  const allocationById = new Map((plan.allocation?.allocations ?? []).map(entry => [entry.id, entry]));
  const included: FrozenIncludedCandidate[] = [];
  const droppedEntries: Array<{ id: string; reason: string }> = [];
  const kept: ContextCandidate[] = [];
  let reclaimable = false;
  for (const candidate of candidates) {
    const entry = allocationById.get(candidate.id);
    if (!entry || entry.allocated <= 0) {
      droppedEntries.push({ id: candidate.id, reason: 'unallocated' });
      // Unallocated items stay eligible: after whole-item reclamation frees
      // budget, a previously starved item may fit on the next pass.
      kept.push(candidate);
      continue;
    }
    if (candidate.clipMode === 'whole_item' && entry.allocated < candidate.estimatedTokens) {
      // Whole-or-nothing (plan §16): a half character card is worse than an
      // absent one. Mandatory floors are guaranteed by the allocator, so this
      // only happens to preferred/optional items.
      if (candidate.requirement !== 'mandatory') {
        droppedEntries.push({ id: candidate.id, reason: 'whole_item_too_large' });
        reclaimable = true;
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
    kept.push(candidate);
  }
  return { walk: { included, droppedEntries }, kept, reclaimable };
}

export function planTurnContext(input: TurnContextPlanInput): TurnContextPlanResult {
  let active = input.candidates;
  const droppedEntries: Array<{ id: string; reason: string }> = [];
  let plan: ReturnType<typeof planLlmRequest> | null = null;
  let walk: AllocationWalk = { included: [], droppedEntries: [] };

  for (let pass = 0; pass < MAX_RECLAMATION_PASSES; pass += 1) {
    plan = allocateOnce(input, active);
    const result = walkAllocations(active, plan);
    walk = result.walk;
    // Permanent drops leave the demand set; the next pass redistributes
    // their share to the survivors (plan §10.2.5).
    for (const entry of result.walk.droppedEntries) {
      if (entry.reason === 'whole_item_too_large') droppedEntries.push(entry);
    }
    active = result.kept;
    if (!result.reclaimable) break;
  }
  if (!plan) throw new BudgetInfeasibleError('no plan produced', 'envelope_infeasible');
  // Final verdict for items that never received an allocation.
  const includedIds = new Set(walk.included.map(item => item.id));
  const recordedIds = new Set(droppedEntries.map(entry => entry.id));
  for (const candidate of active) {
    if (!includedIds.has(candidate.id) && !recordedIds.has(candidate.id)) {
      droppedEntries.push({ id: candidate.id, reason: 'unallocated' });
    }
  }

  const estimatedTotal = walk.included.reduce((sum, item) => sum + estimateTokens(item.text), 0);
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
    included: walk.included,
    droppedCandidateIds: droppedEntries.map(entry => entry.id),
    droppedEntries,
    estimatedTokens: estimatedTotal,
    collectionDiagnostics: input.collectionDiagnostics,
  });
  return {
    context,
    requestedOutputTokens: plan.requestedOutputTokens,
    wireOutputTokens: plan.wireOutputTokens,
    envelope: {
      contextWindowTokens: plan.envelope.contextWindowTokens,
      safetyMarginTokens: plan.envelope.safetyMarginTokens,
      hard: plan.envelope.hardInputLimit,
      soft: plan.envelope.softInputLimit,
      burst: plan.envelope.burstInputLimit,
    },
  };
}
