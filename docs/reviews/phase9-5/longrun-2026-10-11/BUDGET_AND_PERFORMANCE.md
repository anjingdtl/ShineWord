# Physical request budget and performance

**Cutoff:** 2026-10-12. No provider request or performance run occurred during report writing.

## Scoped physical request ledger

- Manifest: F:/sw95/test-logs/phase9-5-longrun-2026-10-11/budget-manifest.json
- Scope: shineword-phase9-5-20261011
- Hard cap: 600 physical requests
- Spent: 453 / 600
- Completed: 453
- Sent/in-flight at stop: 0
- outcome_unknown: 0
- Remaining: 147, unused after the user's stop instruction

All counts are from the one persisted manifest; no new scope or reset was created. A completed physical attempt is not a player decision. The audit total of 236 branch-level submitted turns also is not an effective-decision count.

## Request-kind totals

| Request kind | Count |
|---|---:|
| world_extract | 2 |
| style_analyzer | 1 |
| opening_goal | 8 |
| campaign_plan | 109 |
| world_mapping | 1 |
| planner | 83 |
| narrator | 202 |
| memory_checkpoint | 36 |
| narrator_guidance | 9 |
| memory_repair | 2 |
| **Total** | **453** |

Every attempt in the scoped manifest has status completed. There was one recorded pre-dispatch profile fingerprint correction; it did not alter the 600 cap or reset spent. The manifest has no usage, token, cost or latency fields, so it cannot support an exact token/currency cost total. No provider price is inferred and missing usage is not treated as zero. The 600 figure is a request cap, not a monetary budget.

## Performance acceptance

- Matched baseline 10 + post-fix 10 samples under the same world/source/actor/state/model/reasoning/device conditions: NOT RUN.
- Separate action-to-rule, full narration, and next-opportunity latency summary with sample counts and percentiles: NOT RUN.
- A valid P95 or overall savings percentage: NOT CLAIMED.
- 100/300/1000 turn local storage/serialization growth under the current source identity: NOT RUN.
- Provider token/currency cost comparison: NOT RUN; usage/cost not recoverable from the scoped manifest summary.

Proxy/provider traffic count is still useful for reliability and routing. It must not be presented as “453 rounds,” “453 meaningful decisions,” a latency percentile, or an API spend amount.
