import type { ApiProfile } from '../llm/types';
import type { ModelBudget } from './groupPlanner';

/** Content output budget when the profile does not declare one (plan §3.1). */
export const DEFAULT_CONTENT_OUTPUT_TOKENS = 16_384;
/** Non-thinking models reserve nothing for chain-of-thought. */
export const DEFAULT_REASONING_RESERVE_TOKENS = 0;
/** GLM-style models cannot disable thinking; low effort starts here (§3.1). */
export const GLM_REASONING_RESERVE_TOKENS = 2_048;
/**
 * Keep max_tokens this far below the hard output ceiling while reasoning
 * cannot be disabled (§3.3): chain-of-thought length is not locally
 * controllable, so a ceiling-hugging budget systematically truncates.
 */
export const UNCONTROLLABLE_REASONING_HEADROOM_TOKENS = 8_192;

/**
 * Turns the user's saved provider capability profile into the concrete
 * extraction planner budget (1M plan §3.1). The legacy 8k hard clamp is gone:
 * the content output budget comes from the profile (default 16,384) and is
 * only bounded by the model's real output ceiling, minus the chain-of-thought
 * reserve and - for models that cannot disable thinking - the safety
 * headroom to that ceiling.
 */
export function modelBudgetFromProfile(profile: ApiProfile): ModelBudget {
  const contextWindowTokens = profile.capabilities.contextWindow;
  const capabilityMax = profile.capabilities.maxOutputTokens;
  if (contextWindowTokens === undefined) {
    throw new Error(
      'Profile contextWindow is unknown (capability-source governance): declare it in the provider profile.',
    );
  }
  if (!Number.isInteger(contextWindowTokens) || contextWindowTokens < 1) {
    throw new Error('Profile contextWindow must be a positive integer.');
  }
  if (typeof capabilityMax !== 'number' || !Number.isInteger(capabilityMax) || capabilityMax < 1) {
    throw new Error('Profile maxOutputTokens must be a positive integer.');
  }
  const reasoningReserveTokens = Math.max(
    0,
    Math.floor(profile.reasoningReserveTokens ?? DEFAULT_REASONING_RESERVE_TOKENS),
  );
  const reasoningEffort = profile.reasoningEffort ?? 'off';
  let maxContentOutputTokens = Math.min(
    profile.contentOutputTokens ?? DEFAULT_CONTENT_OUTPUT_TOKENS,
    capabilityMax - reasoningReserveTokens,
  );
  if (reasoningEffort !== 'off') {
    const safeCeiling = capabilityMax - UNCONTROLLABLE_REASONING_HEADROOM_TOKENS;
    maxContentOutputTokens = Math.min(maxContentOutputTokens, safeCeiling - reasoningReserveTokens);
  }
  if (!Number.isInteger(maxContentOutputTokens) || maxContentOutputTokens < 1) {
    throw new Error('Profile model budget leaves no content output room.');
  }
  const budget: ModelBudget = {
    contextWindowTokens,
    maxContentOutputTokens,
    reasoningReserveTokens,
    reasoningEffort,
    supportsPromptCache: profile.capabilities.supportsPromptCache ?? false,
    reserveTokens: 2_000,
  };
  if (budget.contextWindowTokens - budget.maxContentOutputTokens
    - budget.reasoningReserveTokens - budget.reserveTokens - 1_500 <= 0) {
    throw new Error('Profile model budget leaves no room for extraction input.');
  }
  return budget;
}
