# M0 baseline / 2026-10-17 UTC

- Repository: https://github.com/anjingdtl/ShineWord; fresh fetch origin/main = `1b460fb378614986a3896d487c78e6a180409764`.
- Worktree initially clean; local work branch had the same HEAD. Created `codex/phase95-runtime-convergence-20261017` directly from origin/main; no main edits.
- GitHub connector verified PR #13 closed + merged=true, head/merge `c94e62e1dd7f6ceea4ca92253d68d6a500b1780d`. Old Draft/open report text is historical.
- Node v24.19.0; root/mobile package version 1.0.0. No AGENTS.md found under workspace. No adb available.
- `npm ci --ignore-scripts --no-audit --no-fund`: PASS; full `npm run verify:core` running at M0 capture (final outcome in TEST_REPORT).
- `gh` API calls receive Forbidden through current environment. Git transport and connected GitHub tools work; use those for PR/CI. No credentials inspected.
- Runtime has no configured model secret bindings. Real provider calls: 0; authorized budget absent. All new evidence uses existing synthetic campaign fixture / isolated SQLite.

## Measurable baseline

| Measure | Before |
|---|---|
| Fixed campaign method, explicit tap | 0 Planner + 1 Narrator fake-provider invocation |
| Same method, exact free input | 1 Planner (RED assertion catches dispatch before response) |
| Replan / disposition node-condition possibility algorithm | 2 implementations |
| Campaign action commit | prepareTurnResolution → commitPreparedTurn → commitAtomic |
| Mutable Graph state / additional request ledger | 0 introduced / 0 introduced |
| Real production-content eligible L1 sample count | NOT MEASURED; supplied repository fixture is synthetic, not user content |
| Synthetic routing classes | existing tests exercise ready / legacy_l2 / planner_required / refused; exhaustive material distribution NOT MEASURED |
| Matched real cost/latency / 80 player decisions | NOT MEASURED / 0 |

## Two pre-construction reviews

1. Uniqueness review: preserve snapshot, compiler, settlement, SQLite atomic commit, ledger and frozen identity. Changes are pure selection/shared-condition reuse and evidence; no new store, reducer, protocol or kernel.
2. Adversarial review: exact text bypasses readiness today; duplicate node reachability is identical today (maintenance risk, not an observed behavioral bug). Test state/content/rule drift, ambiguity, refused input, replay and causal consumers before broad cleanup. Existing R0/R1/R2/R4 fixes remain in scope for regression, never replaced.

M0 RED: `node --test --test-name-pattern='convergence: exact free' tests/phase9-5-local-compile.test.cjs` fails `an exact fixed method must not dispatch Planner`, stack Session → runV2Turn → requestPlanner. Tap half passes. No physical network call occurred. Test will be committed with M1 fix.
