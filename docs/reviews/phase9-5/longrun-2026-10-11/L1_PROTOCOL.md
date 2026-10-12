# Phase 9.5 L1 method protocol

**Updated:** 2026-10-12
**Status:** Production wiring and deterministic parity checks exist; one real GLM-generated method was adopted and committed from Android with Planner=0. Broader stability/coverage gates are incomplete.

## Scope

L1 applies only when a player selects a currently offered, published campaign method whose first step, difficulty, evidence, rules and content dependencies are fully determined locally. Free text, semantic remapping, incomplete policies, and methods that delegate a choice to Planner remain L2.

The route reuses CampaignSession.playTurn and runV2Turn. It still freezes and hashes the contract, persists/reuses the original roll, prepares complete settlement, invokes Narrator and commits through the existing atomic path. L1 removes only the Planner request for an eligible selected method.

## Additive method fields

Newly generated methods may declare:

- Difficulty: fixed band or planner_required.
- Evidence: fixed evidence ID list or planner_required.

An explicit fixed empty evidence list means “this method needs no evidence”; it is distinct from a missing field. Missing fields never default to normal difficulty or empty evidence. Both policies must be present and fixed for L1. planner_required routes that method through L2.

The compiler also binds the method to the rule hash used to compile its campaign content. Existing persisted artifacts without these fields or rule hash remain readable, continue through L2, and are not rewritten.

## Readiness and identity

LocalCompileReadiness is a pure gate over the selected method, current branch/state version, visibility, authorization, published artifact membership, campaign-content binding and active rule binding. It returns eligibility or a stable refusal; it does not mutate, call a model or fall back to another paid route.

Stale/hidden explicit choices are locally rejected and refreshed. The local proposal freezes the exact method first step, fixed difficulty, evidence list, turn/actor/state IDs and method reference. New identities cover method rules and content binding; legacy outcome hashes preserve old recovery. A mismatch refuses recovery rather than rewriting a turn.

## Compatibility and parity requirements

The required regression cases include:

1. Legacy missing policies stay on L2; malformed policies fail closed; explicit empty evidence remains distinct.
2. Stale branch/state/visibility/permission/artifact/rule bindings refuse before provider dispatch.
3. For the same fixed state/method/intent/dice stream, L1 and reference L2 agree on full_success, success, failure and severe_failure contracts and committed structured effects.
4. A real non-toy method generated/adopted through the normal Android flow is selected; proxy and app ledgers separately show Planner=0 and the expected Narrator/background requests.

## Evidence at stop

- Source implements the explicit policies and hash binding in src/domain/situations/types.ts, src/application/campaignPlan/candidateModel.ts, src/application/game/v2Compile.ts, src/application/game/localCompileReadiness.ts and src/application/campaign/session.ts.
- The focused and full core regressions passed in the final recorded engineering run (1293/1293 core tests). Mobile typecheck, version verification, APK build and git diff check also passed in that run.
- A real GLM-created/adopted method was selected in Android. Its committed turn used fixed normal difficulty and explicit empty evidence. The app ledger records one Narrator attempt; the proxy records one narrator and zero planner requests for that turn. This proves one eligible real sample, not all campaign actions.
- Across the full 453-request scope there were 83 planner attempts and 202 narrator attempts. Planner remains part of ordinary L2 and background planning; the product is not globally zero-Planner.
- The 20-action post-fix stability window, eligible-content distribution and the complete Phase 9.5 gates were not completed.

See L1_PARITY_AND_DISPATCH.md for the evidence boundary and open acceptance rows.
