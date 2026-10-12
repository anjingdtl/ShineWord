# L1 parity and Planner dispatch evidence

**Cutoff:** 2026-10-12. Tests are stopped. This note records the available narrow proof and its boundary.

## Runtime contract

L1 accepts only a currently visible, published Method with explicit fixed difficulty and evidence policy, valid permission, matching current branch/state, published artifact, content binding and rule hash. Explicit fixed empty evidence is valid; missing fields never become normal difficulty or empty evidence. Old artifacts remain compatible and use L2. Free text, semantic remapping, incomplete policies and planner_required methods remain L2.

An eligible local proposal enters the existing CampaignSession → runV2Turn → frozen contract → persisted dice → full settlement → Narrator → atomic commit path. Recovery must retain method and rule binding. The readiness gate refuses a stale explicit selection locally rather than silently turning it into a different paid L2 action.

## Engineering evidence

- Protocol and implementation: L1_PROTOCOL.md; production areas include src/application/game/localCompileReadiness.ts, src/application/game/v2Compile.ts, src/application/game/v2Turn.ts, src/application/campaign/session.ts and src/domain/situations/types.ts.
- Deterministic regression coverage covers missing/legacy policies, explicit empty evidence, stale binding refusals, and four outcome grades. The final recorded core run passed 1293/1293; it was not rerun during report writing.
- The L1 route shares the established turn freeze, roll, settlement and commit machinery. No separate Graph completion state was introduced.
- A real GLM-generated non-toy campaign plan was created and adopted through Android. The player selected a visible method and committed a turn. Both proxy and app ledger record one Narrator attempt and zero Planner attempts for that turn.
- The selected sample had fixed normal difficulty and explicit empty evidence. A stale visible selection was separately rejected before dispatch and refreshed; it did not create a turn or provider attempt.

## Dispatch count

The whole 600-request scope contains 453 completed physical requests. Request-kind counts:

| Kind | Physical requests |
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

The single real L1 turn’s Planner=0 does not mean the app is globally zero-Planner. L2 and background planning remain in the product; 83 Planner requests are present in this same scope.

## Status

- One real adopted Android selection with Planner=0: PASS.
- Deterministic L1/L2 parity coverage for the four grades: PASS as an engineering regression.
- All-eligible-content zero-Planner proof, eligibility distribution, 20-action stable-use window and full G1 acceptance: NOT RUN / NOT COMPLETE.
- No request body, response body, secret, or player story text is included.
