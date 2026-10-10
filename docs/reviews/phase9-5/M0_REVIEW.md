# Phase 9.5 M0 — Adversarial review and checkpoint decision

**Review date:** 2026-10-10
**Scope:** Read-only production audit, baseline test harness, and three M0 reports.

## Review sequence

1. **Source audit:** traced the production turn from `CampaignSession.playTurn` through content/method filtering, `runV2Turn`, contract freeze, roll journal, prepared settlement, Narrator, and SQLite atomic commit. Separately traced local rest/combat/training settlement and the campaign-plan job path.
2. **RED witness:** the new same-Method counterexample compiles one unchanged method with Planner `hard` / `['lore-crates']` and then with an omitted difficulty / `[]`. The resulting contract keeps `hard` vs. the current `normal` fallback and retains different evidence arrays. The published Method declares neither policy. This is the concrete reason an L1 implementation cannot be enabled safely from current content.
3. **Minimal harness change:** the existing synthetic production-session fixture now permits a supplied random source; its old all-sixes default remains unchanged. No production code, persistence schema, model routing, or game state was changed.
4. **GREEN baseline:** five M0 tests passed: four fixed-dice L2 grade baselines and the RED witness. The baseline asserts actual Planner/Narrator role dispatch, frozen difficulty, all four contract outcomes, and the committed evidence counter.
5. **Regression:** 108 focused existing/new tests passed across prepared commit/idempotency, relations, knowledge, clues, quest/rewards, delayed consequences, save-10/fork/restore, and roll recovery. `npm run build:core` and `git diff --check` passed.
6. **Adversarial re-review:** checklist below.

## Adversarial checklist

| Attack | Evidence and result |
| --- | --- |
| Did M0 add a second game-state or graph authority? | No production state was added or modified. The ownership audit identifies `GameStateSnapshot`/`CampaignRuntimeV1` as the existing authority. |
| Did M0 change legal action difficulty or evidence? | No. Only a test-fixture RNG injection point was added; its default remains the previous fixed 6. The new RED witness demonstrates the existing ambiguity without changing it. |
| Did M0 bypass cross-module settlement? | No runtime path was changed. Tests continue through the production session and its prepared settlement. |
| Does zero-Planner behavior remove narrative or hide another request? | No fast path exists yet. The baseline records the old Planner and Narrator calls separately; campaign-plan jobs are documented as a distinct request owner. |
| Did M0 make an empty/no-effect action look like progress? | No opportunity behavior or production action was added. Existing unrelated/no-change and empty-progress checks remain in the regression suite. |
| Can staged contracts, roll recovery, saves, or request history change? | No persistence or protocol code was changed. Existing frozen-roll, save-10, fork and restore regressions passed. |
| Was private content or a real paid model used? | No. Tests use synthetic in-memory content and a scripted provider; no credentials, user database, novel text, or historical unknown request was accessed. |
| Did engineering tests get presented as Android/player acceptance? | No. M0 is a source/test baseline only. The historical Phase 9 matrix remains unchanged, and current-main Actions evidence was absent. |

## M0 exit

**PASS — audit and baseline freeze complete.** This means the current call path, state ownership and semantic gaps are documented, and a reproducible L2 comparison harness exists. It does not mean a local L1 path is ready or that the whole game is accepted.

**M1 production gate:** blocked pending an additive content-protocol RFC for explicit difficulty and evidence policies. Preserve L2 for current methods, refuse stale explicit selections, and do not synthesize defaults. M2 can proceed independently as a read-only projection if its content inputs support meaningful deterministic eligibility and ranking.

**Checkpoint commit:** the Git commit containing this report is the M0 checkpoint; later M1/M2 work will be committed separately.
