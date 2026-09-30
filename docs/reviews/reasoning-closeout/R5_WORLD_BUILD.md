# R5 — World Build Governance

## Scope

This stage applies the shared reasoning policy, request budget kernel,
structured-output parser, and request ledger to World Build. Existing chapter
batching, group planning, RPM/TPM scheduling, concurrency, retry, lease, and
fencing behavior remain the run coordinator's authorities.

## Changes

- New runs persist `run-config-2`: `reasoningTier`, provider dialect, and a
  versioned per-request-kind reserve map for extraction, mapping, adjudication,
  timeline, and registry work. Endpoint, model, `keyRef`, and declared model
  capabilities remain frozen; the API key is not copied into the run record.
- `run-config-1` is still readable. Its `reasoningEffort: off` becomes `low`;
  endpoint, model, `keyRef`, output/context capabilities, and other run fields
  remain available. New World Build configs write only `reasoningTier`.
- `modelBudgetFromProfile` derives the extraction business-output budget from
  the selected tier's world-extract reserve. Missing context or output
  capability still fails before a request; it is not replaced with a guessed
  context window.
- `governWorldBuildRequest` sends the exact frozen tier and request-kind
  reserve through `planLlmRequest`, and supplies the exact wire output ceiling,
  policy version, and stable logical request ID. World Extract IDs use
  `world-extract:<runId>:<unitId>:<route>`; registry, timeline, and mapping
  requests use stable run/checkpoint identities. Each provider completion is
  bounded to one physical dispatch, so application-level reserve recovery is
  auditable as the next attempt under that same ID.
- Chunk/group/resident extraction, registry, timeline, and both stage/full
  world-package mapping paths run through the existing scheduler and
  `LedgeredProvider`. Mapping, registry, timeline, and extraction checkpoint
  identities include the reasoning tier so a newly selected tier cannot
  silently reuse a same-model checkpoint produced under another tier.
- A `reasoning_only` extraction retries once at the same frozen tier with a
  1.5 reserve multiplier. If the increased reserve makes a multi-range request
  infeasible, the existing coordinator splits its source ranges; it does not
  lower the tier or disable thinking. Unknown reasoning-token usage is skipped
  by the output-density calibrator instead of being treated as zero.
- Resident-mode viability now accounts for the reasoning reserve, business
  output, safety margin, and existing prompt-overhead estimate. A whole-book
  prefix that no longer fits degrades to the existing windowed batch planner.
- World Extract and Group Extract share `parseStructuredOutput`; Registry,
  Timeline, and book mapping use the same parser. Segment/chunk quote matching
  and evidence validation remain local and unchanged, so tolerant JSON
  extraction cannot make a fabricated quote acceptable.

## Verification

- Added deterministic coverage for Low/High/Max World Build provider tiers,
  per-kind reserves, wire-output composition, stable logical IDs, and a bounded
  same-tier retry reserve increase.
- Added migration coverage for legacy `off` and preservation of endpoint,
  model, key reference, context, and output capability.
- Added a wrapped-JSON fixture with a false segment quote; parsing succeeds,
  but the quote is still rejected.
- Targeted tests passed: `reasoning-worldbuild-governance`,
  `progressive-opening-g0`, `resident-build-p0`, `resident-build-p2`, and
  `unified-build-p1` (31/31 in the last targeted run).
- Core and mobile typechecks passed after the code changes. Full Core regression,
  final search audit, Android build/AVD checks, real GLM calls, and CI are
  recorded separately in R6 and the final report.

## Review notes

- No World Build path in the active streaming or legacy device importer sends
  extraction or mapping requests without the shared budget and ledger wrapper.
- No `indexOf('{')` / `lastIndexOf('}')` extraction parser remains in the
  World Extract, Group Extract, Registry, Timeline, or book-mapping paths.
- The default planner fixture's 128K capability remains a named legacy test
  fixture; custom profiles continue to require declared/known capabilities.
- The existing `reasoningEffort` field remains only as an input compatibility
  surface in World Build planning; it is normalized into the product tier and
  is not persisted in new frozen run configs.

## Not yet verified

This stage does not claim real GLM Low/High/Max completion, on-device frozen-run
behavior under a live profile edit, release APK verification, or CI status.
Those checks belong to R6.
