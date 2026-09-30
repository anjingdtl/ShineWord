import type { ApiProfile } from '../llm/types';
import { normalizeReasoningTier } from '../llm/types';
import { reasoningDialectForModel, REASONING_POLICY_VERSION, resolveReasoningPolicy } from '../llm/reasoningPolicy';
import { DEFAULT_OUTPUT_DEMANDS } from '../llm/requestDemands';
import type { ModelBudget } from './groupPlanner';

export const DEFAULT_CONTENT_OUTPUT_TOKENS = 16_384;

/** Resolve one frozen run's group-planning output and world-extract reserve. */
export function modelBudgetFromProfile(profile: ApiProfile): ModelBudget {
  const contextWindowTokens = profile.capabilities.contextWindow;
  const capabilityMax = profile.capabilities.maxOutputTokens;
  if (contextWindowTokens === undefined) {
    throw new Error('Profile contextWindow is unknown (capability-source governance): declare it in the provider profile.');
  }
  if (!Number.isInteger(contextWindowTokens) || contextWindowTokens < 1) {
    throw new Error('Profile contextWindow must be a positive integer.');
  }
  if (typeof capabilityMax !== 'number' || !Number.isInteger(capabilityMax) || capabilityMax < 1) {
    throw new Error('Profile maxOutputTokens must be a positive integer.');
  }
  const reasoningTier = normalizeReasoningTier(profile.reasoningTier ?? profile.reasoningEffort);
  const reasoningDialect = profile.reasoningDialect ?? reasoningDialectForModel(profile.model ?? '');
  const reasoning = resolveReasoningPolicy({
    providerDialect: reasoningDialect,
    model: profile.model,
    tier: reasoningTier,
    requestKind: 'world_extract',
    modelMaxOutputTokens: capabilityMax,
    contextWindowTokens,
    minimumBusinessOutputTokens: DEFAULT_OUTPUT_DEMANDS.world_extract.minimum,
  });
  const maxContentOutputTokens = Math.min(
    Math.floor(profile.contentOutputTokens ?? DEFAULT_CONTENT_OUTPUT_TOKENS),
    capabilityMax - reasoning.reserveTokens,
  );
  if (maxContentOutputTokens < DEFAULT_OUTPUT_DEMANDS.world_extract.minimum) {
    throw new Error(
      `Profile model budget leaves less than ${DEFAULT_OUTPUT_DEMANDS.world_extract.minimum} business tokens for world extraction.`,
    );
  }

  const budget: ModelBudget = {
    contextWindowTokens,
    maxContentOutputTokens,
    reasoningReserveTokens: reasoning.reserveTokens,
    reasoningEffort: reasoningTier,
    reasoningTier,
    reasoningDialect,
    reasoningPolicyVersion: reasoning.policyVersion ?? REASONING_POLICY_VERSION,
    supportsPromptCache: profile.capabilities.supportsPromptCache ?? false,
    reserveTokens: 2_000,
  };
  if (budget.contextWindowTokens - budget.maxContentOutputTokens
    - budget.reasoningReserveTokens - budget.reserveTokens - 1_500 <= 0) {
    throw new Error('Profile model budget leaves no room for extraction input.');
  }
  return budget;
}
