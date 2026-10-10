# Phase 9.5 M4 — Adversarial test matrix

**Review date:** 2026-10-10
**Branch:** `feat/phase9-5-evidence-driven-runtime`
**Evidence scope:** local deterministic checks on the feature branch. The L1 fast path was gated off in M1 because the current content protocol cannot fully bind difficulty and evidence.

## Matrix

| Attack / acceptance claim | Evidence | Result |
| --- | --- | --- |
| L0 deterministic rules remain playable without model dispatch | `tests/scenario.test.cjs`: fixed world completes three deterministic turns without any LLM. | `PASS` |
| A published action changes its difficulty or evidence when moved to a local compiler | M0 RED witness compiles the same method with `hard` plus `lore-crates`, then with compiler defaults `normal` plus no evidence. M1 therefore enabled no L1 method and added no local fast path. | `BLOCKED BY PROTOCOL GAP`; no semantic shortcut shipped |
| L1 actions actually send zero Planner requests | No method qualifies and no L1 path is enabled. | `NOT RUN`; must be proven if/when the content protocol closes |
| Existing L2 action contract, roll and consequence semantics remain the baseline | `tests/phase9-5-baseline.test.cjs`: fixed-random four-grade Planner/Narrator execution against the full existing turn path; each case records both existing request roles. | `PASS` |
| A stale explicit method silently degrades into a different Planner action | Existing exact method binding and stale-choice regressions ran in `npm run verify:core`; M2 projection only reorders eligible refs. | `PASS` |
| A committed action rolls twice, grants rewards twice, or deducts resources twice on replay | `tests/sqlite.test.cjs`: SQLite replay is idempotent and does not spend resources twice; turn/roll/events/snapshot commit atomically. | `PASS` |
| A late transaction failure leaves a partial turn or state version | `tests/sqlite.test.cjs`: late-write failure rolls back `stateVersion` and state rows. | `PASS` |
| Restart after narration failure rerolls a persisted roll or repeats preparation | Existing prepared-turn and recovery suites ran in Core Verify; a persisted roll survives narrator failure and is reused after restart. | `PASS` |
| Projection creates a second campaign/graph progress authority | M2 source audit and deterministic fixture show projection is derived from `GameStateSnapshot`, verified plan and bound content; it writes no state. | `PASS` |
| Hidden plan details or world knowledge enter player-facing context | M2 hidden-title replay passed; `tests/turn-context.test.cjs` verifies narrator context excludes `worldKnowledge`. | `PASS` |
| Different routes merge into identical consequences at a shared stage | M2 fixed replay converges the same stage status while retaining route-specific relationship and deferred-consequence state. | `PASS` |
| Failure leaves no meaningful legal continuation, or repetition fabricates progress | M2 production-path replay commits a failed authored method, recommends another eligible authored method, and reports an unprepared successor as a content gap. No mechanical progress or generic no-effect method is synthesized. | `PASS` for fixed fixtures |
| Repeated guidance collapses distinct authored methods with different effects | RED test against the former title/signature dedupe dropped a route ref; exact-reference dedupe now retains both routes. | `PASS` after fix |
| Opportunity projection adds background LLM calls or agent roles | Controlled provider ledger observed the existing Planner and Narrator once each on each of two fresh actions; no added role or dispatch was introduced. | `PASS` for dispatch count; provider token cost not measured |
| M2 structural content gap proves the need for generation | The gap is an intentionally provisional synthetic successor. R69 stage-preparation tests exercise preparing the nearest missing successor. No real adopted campaign exhaustion was established. | `M3 NOT NEEDED` |
| Android debug APK assembles | PR #12 Android Verify run #85 and local `npm --prefix mobile run apk:debug` both completed successfully. | `PASS` |
| Android launch reaches usable UI in the no-KVM emulator | Android 36 x86_64 AVD installed and launched the APK, then stayed on a blank surface and raised a startup ANR under 90.26% guest CPU pressure; other system apps also timed out. | `FAIL / INCONCLUSIVE` |
| Android player flow, UI save import and human game quality | React Native controls never became available in the emulator; no independent tester or physical device was available. | `NOT RUN` |

## Local engineering evidence

`npm run verify:core` passed: 1,262 tests, 0 failures. Separate root and mobile typechecks passed. `npm run verify:version` passed (`1.0.0`, version code `1000000`). PR #12 Core Verify run #119 passed, and Android Verify run #85 built the debug APK successfully on GitHub Actions. A fresh local APK build also passed. The attempted emulator launch and its limits are recorded in `ANDROID_SAVE_VALIDATION.md` and `PLAYER_SIMULATOR_FOLLOWUP.md`.

These checks establish deterministic repository behavior only. They do not establish that L1 is active, that provider cost or latency fell, that Android behavior passed, or that end-user play quality meets the Phase 9 acceptance matrix.
