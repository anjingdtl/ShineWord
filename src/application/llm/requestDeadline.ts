import type { LlmRequestKind, ReasoningTier } from './types';

/** Buffered campaign planning includes a complete proposal, graph and situation.
 *  Whole-book world-build passes (extraction, mapping, adjudication, timeline,
 *  registry) share the same class of single long-thinking request: the 1M
 *  resident design runs them at elevated tiers, and real GLM high-tier passes
 *  have run 465-710s - both a device world_extract and a host world_mapping
 *  ended outcome_unknown at the base 300s deadline before this extension.
 *  Give the selected thinking tier a bounded operation deadline, separately
 * from the short-call default. These are waiting limits, not throughput
 * predictions. */
const EXTENDED_OPERATION_KINDS: readonly LlmRequestKind[] = [
  'campaign_plan', 'world_extract', 'world_mapping', 'world_adjudication', 'timeline', 'registry',
];

export { EXTENDED_OPERATION_KINDS };

export function physicalRequestTimeoutMs(baseTimeoutMs: number, kind: LlmRequestKind | undefined, tier: ReasoningTier): number {
  if (!kind || !EXTENDED_OPERATION_KINDS.includes(kind) || tier === 'low') return baseTimeoutMs;
  const planningDeadline = tier === 'max' ? 1_200_000 : 900_000;
  return Math.min(1_200_000, Math.max(baseTimeoutMs, planningDeadline));
}
