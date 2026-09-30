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
- This governance boundary strips any deprecated `reasoningEffort` compatibility
  property before dispatch; the provider sees only the frozen `reasoningTier`.
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
- Progressive opening dossier generation (the source-import opening path) now
  uses the same `world_extract` Budget Kernel. Its protocol stays mandatory;
  the source excerpt is a separate mandatory elastic demand with a 1,600-code-
  point evidence floor. Low/High/Max reserve is frozen before that source
  range is allocated, so Max reduces the excerpt instead of shrinking its
  reserve to preserve the full 8,000-code-point candidate.
- Progressive opening uses an 8,000-token business-output ceiling; its wire
  ceiling is the Kernel's `business output + reasoning reserve`. Requests carry
  the frozen tier, reserve, policy version, `world_extract` kind, and a stable
  `world-opening-dossier:<worldId>:<sourceSha>` logical ID through
  `LedgeredProvider`. The one bounded evidence/JSON repair creates the next
  physical attempt under the same logical ID.
- Opening dossier output still passes strict JSON parsing and the original
  first-scene quote and chapter-span checks before package compilation.

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
- Progressive opening-specific coverage now checks all three tiers, the
  64K-window Max source shrink with the evidence floor intact, exact wire
  output composition, and ledger attempt numbers across a bounded repair.
- After the progressive-opening follow-up, `npm run verify:core` passed
  441/441, mobile typecheck passed, and `npm run apk:debug --prefix mobile`
  built successfully. The refreshed real GLM check records the opening
  `world_extract` request and ledger alongside the other R6 calls.

## Review notes

- No active streaming, unified-build, or progressive-opening import path sends
  an extraction or mapping request without the shared budget and ledger
  wrapper. The progressive-opening path was the final exception found in the
  R6 audit and is closed by the follow-up above.
- No `indexOf('{')` / `lastIndexOf('}')` extraction parser remains in the
  World Extract, Group Extract, Registry, Timeline, or book-mapping paths.
- The default planner fixture's 128K capability remains a named legacy test
  fixture; custom profiles continue to require declared/known capabilities.
- The existing `reasoningEffort` field remains only as an input compatibility
  surface in World Build planning; it is normalized into the product tier and
  is not persisted in new frozen run configs.

## R5/R6 boundary

R5 originally deferred real GLM completion, on-device checks, release APK
verification, and CI. The R6 report records those later checks. The progressive
opening governance fix was added during the R6 audit, then covered by the
deterministic tests and refreshed host-side GLM run referenced there.
