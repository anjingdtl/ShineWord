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
| Local Android debug APK | `NOT RUN` | `npm --prefix mobile run apk:debug` was attempted and stopped with `Android SDK not configured. Set ANDROID_HOME/ANDROID_SDK_ROOT or mobile/android/local.properties.` No Gradle build occurred. |
| Installed Android device / emulator journey | `NOT RUN` | No configured Android SDK/device was available in this environment. A successful typecheck is not device evidence. |
| GitHub Core Verify | `PASS` | PR #12, run #118, successful on code head `d37b2aef972a73fd48247f8de5128a74b5ff0ba4`. |
| GitHub Android Verify | `PASS` | PR #12, run #84, successful on code head `d37b2aef972a73fd48247f8de5128a74b5ff0ba4`; setup, mobile typecheck and `:app:assembleDebug` completed. |

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

The APK command's version prebuild rewrote the tracked generated `mobile/src/version.json`; that generated-only change was restored because it was not part of this task. The worktree was clean after restoration, and the recorded version check had already passed.

## Executable follow-up when an Android environment and tester are available

1. Install the CI-built debug APK on a supported Android device or emulator and record device/API/build details.
2. Import a synthetic `shineword-save-10` fixture; verify current turn, campaign state and a fork/history branch survive export and re-import.
3. Play one legal authored action, one stale-option rejection, and one failed action followed by the projected legal alternative. Confirm no duplicate roll, reward, resource deduction or Planner request on replay/recovery.
4. Reach a prepared successor and a terminal situation; verify route-specific consequences remain distinct after convergence and that a missing successor reports a content gap without an empty-action loop.
5. Repeat on an independently prepared save fixture and have an independent tester record any narrative-quality or usability issues. Do not use a real campaign database without separate authorization.

The Android workflow proves a CI debug APK build, not installation or gameplay. Until the follow-up journey runs, Android device and human-play acceptance remain `NOT RUN`.
