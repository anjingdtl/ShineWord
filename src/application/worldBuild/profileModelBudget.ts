import type { ApiProfile } from '../llm/types';
import { DEFAULT_GROUP_MAX_OUTPUT_TOKENS } from '../world/llmGroupExtractor';
import type { ModelBudget } from './groupPlanner';

/**
 * Turns the user's saved provider capability profile into the concrete
 * extraction planner budget. Profile output limits are clamped to the actual
 * extractor request cap so the planner does not reserve output the extractor
 * cannot request or omit a configured smaller limit.
 */
export function modelBudgetFromProfile(profile: ApiProfile): ModelBudget {
  const contextWindowTokens = profile.capabilities.contextWindow;
  const configuredOutputTokens = profile.capabilities.maxOutputTokens;
  if (!Number.isInteger(contextWindowTokens) || contextWindowTokens < 1) {
    throw new Error('Profile contextWindow must be a positive integer.');
  }
  if (!Number.isInteger(configuredOutputTokens) || configuredOutputTokens < 1) {
    throw new Error('Profile maxOutputTokens must be a positive integer.');
  }
  const maxOutputTokens = Math.min(configuredOutputTokens, DEFAULT_GROUP_MAX_OUTPUT_TOKENS);
  const budget = {
    contextWindowTokens,
    maxOutputTokens,
    reserveTokens: 2_000,
  };
  if (budget.contextWindowTokens - budget.maxOutputTokens - budget.reserveTokens - 1_500 <= 0) {
    throw new Error('Profile model budget leaves no room for extraction input.');
  }
  return budget;
}
