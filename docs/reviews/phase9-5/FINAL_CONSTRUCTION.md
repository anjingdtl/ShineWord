# ShineWord Phase 9.5 — Construction conclusion

**Review date:** 2026-10-11
**Base:** latest fetched `origin/main` at `a2809bc735cbaace22a87206f509c0387b9bfbd3` (the V2.0 plan checkpoint and current main at audit time).
**Feature branch:** `feat/phase9-5-evidence-driven-runtime`
**Original feature code head reviewed by PR CI:** `33b5620d676d1282d8771ca946fd20db461614ad`.
**Latest source/test-harness follow-up:** `55f78046b5e398ef155a6539aca34fd5b0bab295` (local Core Verify and both applicable PR checks passed).
**Pull request:** [#12](https://github.com/anjingdtl/ShineWord/pull/12) — open against `main`, not merged.

## Decision summary

- **M0 — PASS.** Audited and froze the real turn path, state ownership, Phase 9 drift and content/action protocol gaps. Added deterministic four-grade L2 baseline evidence. Checkpoint commit: `da15d6f`.
- **M1 — GATED, no L1 implementation.** Existing Method content does not authoritatively bind difficulty and evidence. The same method can compile with different semantics when those fields are present versus defaulted. No method safely qualifies, so no fast path or zero-Planner claim was introduced. The additive content-protocol RFC and gate are recorded. Commit: `01784da`.
- **M2 — PASS for deterministic opportunity projection.** Added a read-only projection from current authoritative state and existing bound content, integrated it with existing guidance, preserved distinct authored method references and route-specific outcomes, and surfaced content gaps. It adds no persisted graph, progress ledger or LLM role. Commit: `e6e22f3`.
- **M3 — NOT NEEDED.** Synthetic M2 exhaustion did not establish that adopted content remains insufficient despite existing R69 successor preparation. No paid model experiment or Phase 9 balance use occurred. Commit: `9f9224f`.
- **M4 — CORE PASS; ANDROID PLAYER FLOW NOT RUN.** Latest local Core Verify passed 1,266 tests. Root/mobile typechecks and version validation pass. A local APK build passed on `46ddafc`, and earlier CI built the APK; a fresh APK rebuild in the current workspace stops before Gradle because the Android SDK is not configured. A no-KVM Android 36 emulator installed and launched the app, then raised a startup ANR while the React Native surface stayed blank. The UI-level gameplay and save import remain unverified. See [player simulator follow-up](PLAYER_SIMULATOR_FOLLOWUP.md).

## Local validation

| Command | Result |
| --- | --- |
| `npm run verify:core` | `PASS` — latest run: 1,266 tests, 0 failures |
| `npm run typecheck` | `PASS` |
| `npm --prefix mobile run typecheck` | `PASS` |
| `npm run verify:version` | `PASS` — version `1.0.0`, code `1000000` |
| `npm --prefix mobile run apk:debug` | `PASS` on code head `46ddafc` — APK 103,771,573 bytes, SHA-256 `5eb24d0e280c33e7343fbc94279bc78f76c6421988801c528535e48eed80d109`; current workspace lacks Android SDK for a rebuild |
| Phase 9.5 campaign/player-domain subset | `PASS` — 54 passed, 0 failed |
| Provider, connection-probe, budget and ledger subset | `PASS` — 119 passed, 0 failed |
| Production provider against loopback mock | `PASS` — 1 probe, 1 Planner, 1 Narrator; no external call or model cost |
| User novel offline preflight | `PASS` — explicit GB18030 decode; first 12 chapter headings sliced to 79,055 bytes and imported locally without a key or network request |
| Smoke input safety regressions | `PASS` — 4 tests cover GB18030 slicing, decode failure, missing headings and size-cap rejection |
| Live GLM extraction / narrative quality | `NOT RUN` — separate request-count and spend caps are not approved |
| Android emulator startup | `FAIL / INCONCLUSIVE` — app ANR on no-KVM TCG; no usable UI |
| Android player flow and UI save import | `NOT RUN` |
| `git diff --check` | `PASS` after M4 evidence edits (`git diff --check` and `git diff --cached --check`) |
| PR #12 Core Verify #121 | `PASS` — source/test-harness head `55f78046b5e398ef155a6539aca34fd5b0bab295` |
| PR #12 Android Verify #87 | `PASS` — mobile typecheck and Android debug APK build completed on GitHub Actions |

No physical Android device, independent playtester, real model request, real campaign save or Phase 9 request budget was used. The supplied novel was processed only by the local no-key preflight; no prose was printed, committed or uploaded. L1 Planner-dispatch savings and real provider cost/latency are therefore unmeasured. The Android emulator launch failure is retained as evidence and not recast as a pass. See `ADVERSARIAL_TEST_MATRIX.md`, `ANDROID_SAVE_VALIDATION.md` and `PLAYER_SIMULATOR_FOLLOWUP.md` for evidence and limits.

## Remaining scope and risks

1. L1 remains deliberately unavailable until authored content has explicit, closed difficulty and evidence policies that can be frozen and validated without changing existing semantics. Its zero-Planner ledger proof remains `NOT RUN`.
2. CI and a prior local build assembled the Android debug APK. The current workspace cannot rebuild because Android SDK is absent. The no-KVM emulator launch hit a startup ANR; Android player flow, UI save import and independent human testing remain `NOT RUN`.
3. M2 proves deterministic behavior on synthetic fixed fixtures, not sustained human play quality or real adopted-campaign content supply.
4. Phase 9 acceptance history remains untouched: the 29 PASS / 2 FAIL / 9 NOT RUN matrix and simulator/request ledgers were not rewritten or consumed as 9.5 evidence.
5. M5 and real-model content generation are outside this authorization.

## Delivery gate

The feature branch is pushed and PR #12 is open against `main`; Core Verify #121 and Android Verify #87 passed on source/test-harness head `55f7804`. The follow-up changes the standalone LLM smoke harness and its tests, but does not change game runtime or save protocol. No merge is authorized by this task.
