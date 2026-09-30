/**
 * Frozen turn context (plan §17): the immutable snapshot a planner (or
 * narrator) request was built from. Background world/memory updates after
 * the freeze can never mutate an in-flight turn's inputs.
 */

import type { ContextCandidate } from './contextTypes';
import { stableFingerprint } from '../llm/requestPlan';

export interface FrozenIncludedCandidate {
  id: string;
  board: ContextCandidate['board'];
  heading?: string;
  text: string;
  allocatedTokens: number;
  clipped: boolean;
}

export interface FrozenTurnContext {
  contextId: string;
  requestKind: 'planner' | 'narrator';
  branchId: string;
  stateVersion: number;
  modelProfileFingerprint: string;
  budgetPlanFingerprint: string;
  includedCandidateIds: string[];
  droppedCandidateIds: string[];
  included: FrozenIncludedCandidate[];
  estimatedTokens: number;
  /** True when the budget kernel was unavailable (unknown capabilities) and
   * the legacy fixed-budget path rendered the context instead. */
  legacyFallback: boolean;
  fallbackReason?: string;
}

export function freezeTurnContext(input: {
  requestKind: 'planner' | 'narrator';
  branchId: string;
  stateVersion: number;
  modelProfileFingerprint: string;
  budgetPlanFingerprint: string;
  included: FrozenIncludedCandidate[];
  droppedCandidateIds: string[];
  estimatedTokens: number;
  legacyFallback?: boolean;
  fallbackReason?: string;
}): FrozenTurnContext {
  const included = input.included;
  return {
    contextId: `ctx-${stableFingerprint({
      kind: input.requestKind,
      branch: input.branchId,
      version: input.stateVersion,
      profile: input.modelProfileFingerprint,
      budget: input.budgetPlanFingerprint,
      included: included.map(item => [item.id, item.allocatedTokens, item.clipped]),
    })}`,
    requestKind: input.requestKind,
    branchId: input.branchId,
    stateVersion: input.stateVersion,
    modelProfileFingerprint: input.modelProfileFingerprint,
    budgetPlanFingerprint: input.budgetPlanFingerprint,
    includedCandidateIds: included.map(item => item.id),
    droppedCandidateIds: [...input.droppedCandidateIds],
    included,
    estimatedTokens: input.estimatedTokens,
    legacyFallback: input.legacyFallback ?? false,
    fallbackReason: input.fallbackReason,
  };
}
