# Phase 9.5 M1 — L1 equivalence gate

**Decision date:** 2026-10-10
**Result:** `NOT ENABLED — CONTENT PROTOCOL GAP`

## Gate evidence

The synthetic L2 reference fixes the same card, action, campaign content, rule version, dice and random sequence, then covers `full_success`, `success`, `failure` and `severe_failure`. All four cases pass through `CampaignSession.playTurn`, the current proposal/compiler path, contract freeze, roll journal, prepared settlement, Narrator and SQLite commit. The ledger records the expected Planner and Narrator roles for each fresh turn.

The companion RED witness holds the published Method constant and varies only the Planner’s fields. Current compilation freezes either `difficultyBand: hard` and `evidenceIds: ['lore-crates']`, or the compiler’s legacy `normal` fallback and an empty evidence list. The Method has neither `difficultyPolicy` nor `evidenceBinding`. Those two contracts can roll different grades or trigger different discovery/quest progression while claiming the same published Method.

## Readiness result

There are **zero current methods qualified for L1**. Skill-check methods lack a content-owned difficulty policy and all Method families lack an explicit evidence policy. A no-roll `talk` method avoids only the difficulty gap; it still needs a declared evidence policy and its relation/campaign/consequence effects must pass through the same settlement code.

No production `LocalCompileReadiness` bypass or Planner suppression is installed in this checkpoint. Current valid actions keep the L2 behavior. Existing explicit stale method references continue to be rejected by local compilation; the existing rejection is not converted into a paid Planner fallback.

## Protocol improvement RFC

Before enabling L1, version the campaign method contract additively with:

- a required, closed difficulty policy for rolled actions;
- a required, closed evidence binding policy, including explicit no-evidence semantics;
- validation of all referenced IDs against the currently bound and player-visible content;
- a content hash/outcome-set binding that includes both policies, the rule binding, and relevant dependencies;
- an L2-vs-L1 golden suite using the same fixed state/random source and comparing grades, relationship/knowledge/item/quest/situation/campaign effects, rewards, delayed consequences, persistence/recovery, and request-ledger counts.

Legacy artifacts with no policy remain on L2. Do not synthesize `normal` or `[]` to qualify them. The RFC does not request a save format or database authority change. The protocol extension itself is not implemented here; M2 can proceed without it.

## Acceptance matrix

| M1 requirement | Evidence | Status |
| --- | --- | --- |
| L1 legal method dispatches zero Planner requests | No L1 implementation; no claim of zero dispatch | `NOT RUN` |
| No missing difficulty/evidence defaults | RED witness identifies both defaults/inputs; implementation intentionally absent | `BLOCKED` |
| Stale explicit method is refused | Existing `tests/phase9-turns.test.cjs` compile test remains green | `PASS` |
| Existing Narrator/frozen contract/Prepared/roll reuse/atomic settlement remain intact | Existing L2 baseline and recovery tests pass | `PASS` for L2 baseline only |
| Four grades match local path | No local path exists to compare | `NOT RUN` |
| Relationships, tasks, rewards and delayed outcomes match local path | No local path exists to compare; legacy settlement regressions pass | `NOT RUN` |
| Content protocol can safely describe a non-toy local method | Current Method schema omits required policy fields | `FAIL — RFC REQUIRED` |

## Review and decision

The M1 gate is **correctly stopped before production routing changes**. Adding a fake readiness pass would violate the design’s semantic-equivalence requirement. This is a protocol blocker, not a test environment or model-budget issue. No real model request, request ledger balance, or Android claim was used. Revisit M1 only after review and implementation of the additive content protocol and its golden equivalence suite.
