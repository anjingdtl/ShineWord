# R3 — Reasoning and Elastic Budget Coupling

## Policy and request envelope

- `planLlmRequest()` accepts an explicit `{ tier, providerDialect, model }` policy selection and resolves it once through `resolveReasoningPolicy()`.
- All currently supported OpenAI-compatible reasoning adapters use the `inside_completion` output dialect. For each plan, `wireOutputTokens = businessOutputTokens + reasoningReserveTokens`.
- The kernel limits wire output by the model output ceiling, provider wire ceiling, context window, safety margin, and mandatory input floor. The resulting hard input limit is `C - wireOutputTokens - S`; the reasoning reserve is counted once.
- The frozen plan returns both business output and the exact wire output cap, plus the resolved tier, effective tier, reserve, source, clamp state, provider parameters, and policy version. The trace records the same decision.
- Context plan IDs and `FrozenTurnContext.contextId` include tier and reserve. Low and Max therefore cannot share a frozen plan identity when their budgets differ.
- If the context window is unknown, context planning retains the explicit legacy fixed-budget fallback. Its frozen reasoning metadata records the selected tier and `reserveTokens: null`; it does not invent a capability or claim an exact elastic reserve.

## Cold-start schedule

The policy uses per-request-kind targets. These are starting budget values, not claims about model capability.

| Request kind | Low | High | Max |
| --- | ---: | ---: | ---: |
| Planner | 2,048 | 8,192 | 24,576 |
| Narrator | 1,024 | 4,096 | 12,288 |
| Memory checkpoint / repair | 2,048 | 8,192 | 24,576 |
| World extract | 4,096 | 16,384 | 49,152 |
| World mapping | 4,096 | 12,288 | 32,768 |
| World adjudication | 2,048 | 8,192 | 24,576 |
| Summarizer | 1,024 | 4,096 | 12,288 |

Reserves clamp to the available model, provider, context, and mandatory-input capacity only while preserving the request kind and tier minimum. If that minimum cannot fit alongside the business output minimum, the policy raises `ReasoningCapabilityInsufficientError` before dispatch.

## Usage calibration foundation

- Ledger migration 22 adds a nullable `reasoning_tier` column and an index over profile fingerprint, tier, request kind, and time. The profile fingerprint distinguishes endpoint, model, dialect, and declared capability values while persisting only hashed endpoint identity. Existing rows remain NULL for tier and are not reclassified.
- `LedgeredProvider` persists the frozen request tier and the provider-reported `reasoningTokens`. Missing usage remains SQL NULL.
- `listRecentReasoningTokens()` reads only successful, known samples for the exact profile/tier/request-kind tuple. `reasoningUsageStatsFromSamples()` builds P50/P90/P95/max over those samples; the policy accepts P95 and waits for at least eight samples before applying `max(coldStartMinimum, ceil(P95 × 1.25))`.
- Runtime retrieval and injection of historical samples is left for a later calibration integration. The cold-start policy remains the active path until a caller supplies these statistics.

## Verification

- `npm run verify:core`: PASS, 428 tests.
- `npm run typecheck --prefix mobile`: PASS.
- Five-window planner matrix: PASS at 32K, 64K, 128K, 200K, and 1M. Reserves increase Low < High < Max; hard input decreases in the reverse order; wire ceiling and single-count invariants hold.
- Small output capability clamp / capability-insufficient cases: PASS.
- 32K Max world-extraction clamp with a mandatory input floor: PASS; hard input remains non-negative and wire output remains within context, safety, and model limits.
- Context-pressure fixture: PASS; Max receives less optional evidence than Low while the mandatory protocol floor remains intact.
- Ledger migration preserves historical rows as unknown; tier-scoped queries omit missing usage instead of coercing it to zero: PASS.

## Review boundary

This stage establishes the common budget and calibration interfaces. R4 wires the frozen plan into Planner, Narrator, and Memory provider requests; R5 applies the same policy to World Build. Those runtime paths are not claimed as complete by this stage.
