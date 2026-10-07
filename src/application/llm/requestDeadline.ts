import type { LlmRequestKind, ReasoningTier } from './types';

/** Buffered campaign planning includes a complete proposal, graph and situation.
 * Give the selected thinking tier a bounded operation deadline, separately from
 * the short-call default. These are waiting limits, not throughput predictions. */
export function physicalRequestTimeoutMs(baseTimeoutMs: number, kind: LlmRequestKind | undefined, tier: ReasoningTier): number {
  if (kind !== 'campaign_plan' || tier === 'low') return baseTimeoutMs;
  const planningDeadline = tier === 'max' ? 1_200_000 : 900_000;
  return Math.min(1_200_000, Math.max(baseTimeoutMs, planningDeadline));
}
