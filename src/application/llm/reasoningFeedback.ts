import type { LlmProvider, LlmRequestKind } from './types';
import type { ReasoningPolicySelection, ReasoningUsageFeedback } from './reasoningPolicy';
import { REASONING_USAGE_ROLLING_WINDOW } from './reasoningPolicy';
import { REASONING_ONLY_RESERVE_MULTIPLIER } from './reasoningPolicy';
import { LlmRequestFailure } from './types';

/** Read once at a NEW material root. Restoring a root must not consult newer history. */
export async function freezeReasoningUsageFeedback(
  provider: LlmProvider, requestKind: LlmRequestKind, selection: ReasoningPolicySelection,
): Promise<ReasoningPolicySelection> {
  if (selection.usageFeedback !== undefined || selection.reserveTokensOverride !== undefined) return selection;
  const observations = await provider.readReasoningUsage?.({ requestKind, tier: selection.tier });
  if (!observations?.length) return selection;
  const feedback: ReasoningUsageFeedback = { completed: [], exhausted: [] };
  for (const sample of observations.slice(0, REASONING_USAGE_ROLLING_WINDOW)) {
    if (!Number.isSafeInteger(sample.reasoningTokens) || sample.reasoningTokens < 0) continue;
    if (sample.completion === 'complete') feedback.completed.push(sample.reasoningTokens);
    if (sample.completion === 'exhausted' && sample.reasoningTokens > 0) feedback.exhausted.push(sample.reasoningTokens);
  }
  return feedback.completed.length + feedback.exhausted.length
    ? { ...selection, usageFeedback: feedback } : selection;
}

/** One classified exhausted response may enlarge the reserve; it is not a P95 sample. */
export function recoverReasoningPolicy(
  selection: ReasoningPolicySelection, initialReserve: number, observedReasoningTokens?: number | null,
): ReasoningPolicySelection {
  const observed = typeof observedReasoningTokens === 'number' && Number.isSafeInteger(observedReasoningTokens)
    && observedReasoningTokens > 0 ? observedReasoningTokens : 0;
  const completed = selection.usageFeedback?.completed ?? [];
  const exhausted = selection.usageFeedback?.exhausted ?? [];
  const lowerBound = Math.max(observed, ...exhausted);
  return { ...selection,
    ...(lowerBound > 0 ? { usageFeedback: { completed: completed.length ? [Math.max(...completed)] : [], exhausted: [lowerBound] } } : {}),
    reserveMultiplier: 1,
    reserveTokensOverride: Math.max(Math.ceil(initialReserve * REASONING_ONLY_RESERVE_MULTIPLIER),
      Math.ceil(lowerBound * REASONING_ONLY_RESERVE_MULTIPLIER)),
  };
}

export function observedReasoningTokensFromFailure(error: unknown): number | undefined {
  if (!(error instanceof LlmRequestFailure)) return undefined;
  const metric = error.requestMetrics.at(-1);
  return metric?.usage?.estimated === false ? metric.usage.reasoningTokens : undefined;
}
