# Phase 9.5 — Player and simulator test follow-up

**Review date:** 2026-10-10
**Branch:** `feat/phase9-5-evidence-driven-runtime`
**Code head tested:** `33b5620d676d1282d8771ca946fd20db461614ad`
**Pull request:** [#12](https://github.com/anjingdtl/ShineWord/pull/12), open and not merged

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Full core verification | `PASS` | `npm run verify:core`: root typecheck plus 1,262 tests passed, 0 failed (165.3 s) |
| Phase 9.5 player-domain journey | `PASS` | Focused campaign, turn, projection, SQLite, stage-preparation and save/fork suites: 54 passed, 0 failed. This is the synthetic domain journey, not an Android UI session. |
| LLM/provider and ledger regression | `PASS` | Six focused files covering provider, probe, request budget, JSON, and ledger behavior: 119 passed, 0 failed. |
| Production provider to local mock | `PASS` | The production `OpenAICompatibleProvider` and `probeConnection` made loopback HTTP requests to a controlled synthetic provider. Counts: 1 connection probe, 1 Planner, 1 Narrator, 0 other. Responses passed turn ID, candidate reference and outcome assertions. |
| Model spend / private story use | `NONE` | All provider requests went to `127.0.0.1`; dummy key only. No external model call or private novel text was used. The TXT from another chat was not present in this workspace and is not automatically accessible across chats. |
| Mobile typecheck | `PASS` | `npm --prefix mobile run typecheck`, exit 0 |
| Version check | `PASS` | `npm run verify:version`: version `1.0.0`, version code `1000000` |
| Local Android debug APK | `PASS` | `npm --prefix mobile run apk:debug` succeeded. APK: 103,771,573 bytes; SHA-256 `5eb24d0e280c33e7343fbc94279bc78f76c6421988801c528535e48eed80d109`. |
| Android emulator launch smoke | `FAIL / INCONCLUSIVE` | APK installed and `MainActivity` launched, but the screen stayed blank and Android raised `Shine-TRPG isn't responding`. ActivityManager reported `failed to complete startup`; see environment findings below. |
| Android player flow / save import | `NOT RUN` | No usable React Native screen appeared, so profile setup, mock connection from the app, synthetic-save import, gameplay, restart and restore could not be exercised through the UI. |
| GitHub checks before this report-only follow-up | `PASS` | PR #12 Core Verify #119 and Android Verify #85 passed on code head `33b5620d676d1282d8771ca946fd20db461614ad`. Recheck checks after the follow-up commit. |

## Simulator evidence and limits

The test AVD was Android 36 Google Play x86_64 on Emulator 37.2.12. This host has no `/dev/kvm`, so the emulator ran with `-accel off` and SwiftShader; the display was reduced to 720 × 1600 to lower software-rendering work. The APK package was present and the activity became top-resumed, but an accessibility dump contained only an empty `FrameLayout` root. A later screenshot showed Android's app-not-responding dialog.

At 17:42:16 UTC, ActivityManager recorded:

```text
ANR in com.shineword.app
Reason: Process ... com.shineword.app ... failed to complete startup
CPU pressure some avg10=90.26%; CPU usage total=99%
```

The same boot also logged startup timeouts and ANRs for Android system and Google components. The emulator's CPU pressure makes this run inconclusive about normal-device startup performance, but the observed ShineWord launch is still a failed smoke test. No app JavaScript exception was found in the captured log window. Android restricted the ANR trace file from the shell account, so this run does not provide a usable app main-thread stack. The screenshot is [android-emulator-startup-anr-2026-10-10.png](artifacts/android-emulator-startup-anr-2026-10-10.png).

This evidence does not prove an Android product defect or prove the app is healthy on a physical device. It only shows that this no-KVM emulator could not reach a usable first-run screen during the run.

## Synthetic content and LLM boundary

The domain tests use fixed fictional campaign content (“青石巷”), fixed rules and deterministic dice. A synthetic `shineword-save-10` fixture was validated on the host; it was not imported into Android. The local mock HTTP smoke exercised the provider contract only. It did not configure or drive the Android app, and it was not a real LLM quality evaluation.

No real API key, private novel, user database, Phase 9 request balance or paid model was used. The mock server observed exactly three loopback requests in total: one probe, one Planner request and one Narrator request.

## Required next device run

1. Use a hardware-accelerated Android device or emulator with KVM and a known supported image; record API level and APK hash.
2. Configure the app to use a loopback mock endpoint and confirm the app's connection-probe result and request ledger.
3. Import the synthetic save, execute a legal action, a stale-option rejection and a failed action followed by an authored alternative.
4. Verify route-specific state after convergence, no duplicate roll/reward/resource cost, restart recovery, save export/import and natural ending.
5. Only after those steps, schedule an independent human-play review. Keep live-model testing separate and require a separately approved budget.

Until that run completes, Android player acceptance and human narrative quality remain `NOT RUN`.
