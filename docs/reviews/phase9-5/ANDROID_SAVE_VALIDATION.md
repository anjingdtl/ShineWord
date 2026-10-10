# Phase 9.5 M4 — Android and save validation

**Review date:** 2026-10-10
**Branch:** `feat/phase9-5-evidence-driven-runtime`

## Results

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Root TypeScript | `PASS` | `npm run typecheck`, exit 0 |
| Mobile TypeScript | `PASS` | `npm --prefix mobile run typecheck`, exit 0 |
| Product version | `PASS` | `npm run verify:version`, exit 0; `version=1.0.0`, `versionCode=1000000` |
| Core Verify | `PASS` | `npm run verify:core`, 1,262 tests passed, 0 failed |
| Local Android debug APK | `PASS` | `npm --prefix mobile run apk:debug` succeeded. APK is 103,771,573 bytes, SHA-256 `5eb24d0e280c33e7343fbc94279bc78f76c6421988801c528535e48eed80d109`. |
| Android emulator launch smoke | `FAIL / INCONCLUSIVE` | Android 36 x86_64 AVD without KVM installed and launched the APK, but stayed on a blank React Native surface and raised an app-not-responding dialog during startup. See [player simulator follow-up](PLAYER_SIMULATOR_FOLLOWUP.md). |
| Android player flow / save import | `NOT RUN` | The app did not present usable UI controls, so first-run setup, save import, gameplay, and UI-level restart/restore were not exercised. |
| GitHub Core Verify | `PASS` | PR #12, run #119, successful on code head `33b5620d676d1282d8771ca946fd20db461614ad`. |
| GitHub Android Verify | `PASS` | PR #12, run #85, successful on code head `33b5620d676d1282d8771ca946fd20db461614ad`; setup, mobile typecheck and `:app:assembleDebug` completed. |

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

The APK command's version prebuild rewrote the tracked generated `mobile/src/version.json`; that generated-only change was restored because it was not part of this task. The worktree was clean after restoration. The current APK hash and emulator launch evidence are recorded in [player simulator follow-up](PLAYER_SIMULATOR_FOLLOWUP.md).

## Executable follow-up when an Android environment and tester are available

1. Install the CI-built debug APK on a supported Android device or emulator and record device/API/build details.
2. Import a synthetic `shineword-save-10` fixture; verify current turn, campaign state and a fork/history branch survive export and re-import.
3. Play one legal authored action, one stale-option rejection, and one failed action followed by the projected legal alternative. Confirm no duplicate roll, reward, resource deduction or Planner request on replay/recovery.
4. Reach a prepared successor and a terminal situation; verify route-specific consequences remain distinct after convergence and that a missing successor reports a content gap without an empty-action loop.
5. Repeat on an independently prepared save fixture and have an independent tester record any narrative-quality or usability issues. Do not use a real campaign database without separate authorization.

The Android workflow and local build prove APK assembly. The no-KVM emulator launch was attempted but did not reach usable UI; Android player and human-play acceptance remain `NOT RUN`.
