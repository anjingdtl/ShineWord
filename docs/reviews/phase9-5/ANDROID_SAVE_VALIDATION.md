# Phase 9.5 M4 — Android and save validation

**Review date:** 2026-10-11
**Branch:** `feat/phase9-5-evidence-driven-runtime`

## Results

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Root TypeScript | `PASS` | `npm run typecheck`, exit 0 |
| Mobile TypeScript | `PASS` | `npm --prefix mobile run typecheck`, exit 0 |
| Product version | `PASS` | `npm run verify:version`, exit 0; `version=1.0.0`, `versionCode=1000000` |
| Core Verify | `PASS` | Latest `npm run verify:core`, 1,266 tests passed, 0 failed |
| Local Android debug APK | `PASS` | Earlier build on code head `46ddafc` succeeded. APK is 103,771,573 bytes, SHA-256 `5eb24d0e280c33e7343fbc94279bc78f76c6421988801c528535e48eed80d109`. No mobile source changed in this follow-up. |
| Current-workspace APK rebuild | `BLOCKED` | The command stopped before Gradle because Android SDK is not configured. |
| Android target availability | `BLOCKED` | `adb`, the emulator binary and `/dev/kvm` are unavailable in this workspace; no new Android UI run was possible. |
| Android emulator launch smoke | `FAIL / INCONCLUSIVE` | Android 36 x86_64 AVD without KVM installed and launched the APK, but stayed on a blank React Native surface and raised an app-not-responding dialog during startup. See [player simulator follow-up](PLAYER_SIMULATOR_FOLLOWUP.md). |
| Android player flow / save import | `NOT RUN` | The app did not present usable UI controls, so first-run setup, save import, gameplay, and UI-level restart/restore were not exercised. |
| GitHub Core Verify | `PASS` | PR #12, run #120, successful on code head `46ddafc73c3b686604d82fe02e537090c99ddd71`. |
| GitHub Android Verify | `PASS` | PR #12, run #86, successful on code head `46ddafc73c3b686604d82fe02e537090c99ddd71`; setup, mobile typecheck and `:app:assembleDebug` completed. |
| Current PR Core Verify | `PASS` | PR #12, run #121, successful on source/test-harness head `55f78046b5e398ef155a6539aca34fd5b0bab295`. |
| Current PR Android Verify | `PASS` | PR #12, run #87, successful on source/test-harness head `55f78046b5e398ef155a6539aca34fd5b0bab295`; setup, mobile typecheck and `:app:assembleDebug` completed. |

## Save and recovery boundary

This feature branch does not change save serialization, migrations, database ownership or the existing `shineword-save-10` protocol. The full Core Verify run included the existing save, fork, SQLite, replay and recovery suites, including:

- `tests/phase9-fork-save-history.test.cjs`
- `tests/phase9-sqlite.test.cjs`
- `tests/sqlite.test.cjs`
- `tests/phase8-save9.test.cjs`
- `tests/phase7-save8.test.cjs`
- `tests/phase6-save-compatibility.test.cjs`
- `tests/recovery.test.cjs`
- `tests/play-recovery.test.cjs`

The feature adds no save migration. These automated fixtures are regression coverage; they are not an import/export check against a real user save. No private user database or campaign was read.

The APK command's version prebuild rewrote the tracked generated `mobile/src/version.json`; that generated-only change was restored because it was not part of this task. The current APK hash and emulator launch evidence are recorded in [player simulator follow-up](PLAYER_SIMULATOR_FOLLOWUP.md). A later rebuild attempt in this workspace stopped before Gradle because the Android SDK is not configured.

## Executable follow-up when an Android environment and tester are available

1. Install the CI-built debug APK on a supported Android device or emulator and record device/API/build details.
2. Import a synthetic `shineword-save-10` fixture; verify current turn, campaign state and a fork/history branch survive export and re-import.
3. Play one legal authored action, one stale-option rejection, and one failed action followed by the projected legal alternative. Confirm no duplicate roll, reward, resource deduction or Planner request on replay/recovery.
4. Reach a prepared successor and a terminal situation; verify route-specific consequences remain distinct after convergence and that a missing successor reports a content gap without an empty-action loop.
5. Repeat on an independently prepared save fixture and have an independent tester record any narrative-quality or usability issues. Do not use a real campaign database without separate authorization.

The Android workflow and local build prove APK assembly. The no-KVM emulator launch was attempted but did not reach usable UI; Android player and human-play acceptance remain `NOT RUN`.
