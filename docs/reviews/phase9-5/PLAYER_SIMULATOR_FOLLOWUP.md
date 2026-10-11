# Phase 9.5 — Player and simulator test follow-up

**Review date:** 2026-10-11
**Branch:** `feat/phase9-5-evidence-driven-runtime`
**Original simulator-run code head:** `33b5620d676d1282d8771ca946fd20db461614ad`
**Pull request:** [#12](https://github.com/anjingdtl/ShineWord/pull/12), open and not merged

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Full core verification | `PASS` | Latest `npm run verify:core`: root typecheck plus 1,266 tests passed, 0 failed (120.9 s). |
| Phase 9.5 player-domain journey | `PASS` | Focused campaign, turn, projection, SQLite, stage-preparation and save/fork suites: 54 passed, 0 failed. This is the synthetic domain journey, not an Android UI session. |
| LLM/provider and ledger regression | `PASS` | Six focused files covering provider, probe, request budget, JSON, and ledger behavior: 119 passed, 0 failed. |
| User novel source preflight | `PASS` | Local `--dry-extract` run with explicit GB18030 decoding selected a 79,055-byte sample containing 12 chapter headings; the streaming importer parsed 13 segments including its preface segment. No key file or network provider was used. |
| Live GLM quality run on supplied novel | `NOT RUN` | No model request was sent. A bounded request count and spend cap have not been approved. |
| Production provider to local mock | `PASS` | The production `OpenAICompatibleProvider` and `probeConnection` made loopback HTTP requests to a controlled synthetic provider. Counts: 1 connection probe, 1 Planner, 1 Narrator, 0 other. Responses passed turn ID, candidate reference and outcome assertions. |
| Model spend / private story use | `NONE` | All provider requests went to `127.0.0.1`; dummy key only. The newly supplied novel file was used only in the local dry preflight; no prose was printed, committed or sent to a provider. |
| Mobile typecheck | `PASS` | `npm --prefix mobile run typecheck`, exit 0 |
| Version check | `PASS` | `npm run verify:version`: version `1.0.0`, version code `1000000` |
| Local Android debug APK | `PASS` | Earlier build on code head `46ddafc` succeeded. APK: 103,771,573 bytes; SHA-256 `5eb24d0e280c33e7343fbc94279bc78f76c6421988801c528535e48eed80d109`. No mobile source changed in this follow-up. |
| APK rebuild in current workspace | `BLOCKED` | `npm --prefix mobile run apk:debug` stopped before Gradle because Android SDK is not configured. The command's generated `mobile/src/version.json` timestamp was restored. |
| Android target availability in current workspace | `BLOCKED` | `adb`, the emulator binary and `/dev/kvm` are unavailable here; no new Android UI run was possible. |
| Android emulator launch smoke | `FAIL / INCONCLUSIVE` | APK installed and `MainActivity` launched, but the screen stayed blank and Android raised `Shine-TRPG isn't responding`. ActivityManager reported `failed to complete startup`; see environment findings below. |
| Android player flow / save import | `NOT RUN` | No usable React Native screen appeared, so profile setup, mock connection from the app, synthetic-save import, gameplay, restart and restore could not be exercised through the UI. |
| GitHub checks before this source follow-up | `PASS` | PR #12 Core Verify #120 and Android Verify #86 passed on code head `46ddafc73c3b686604d82fe02e537090c99ddd71`. Recheck checks after the follow-up commit. |

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

No real API key, user database, Phase 9 request balance or paid model was used. The mock server observed exactly three loopback requests in total: one probe, one Planner and one Narrator. The newly supplied novel was only decoded and imported in the local no-key dry run; live GLM evaluation and narrative quality remain `NOT RUN` pending an approved request and spend cap.

## Attachment follow-up

The current smoke harness previously decoded every novel as UTF-8 and silently accepted a missing chapter split, which could have sent the whole source file. The follow-up adds explicit UTF-8/GB18030 selection, fail-closed chapter detection, a 256 KiB sample limit, and a no-key offline mode. Details and sanitized counters are in [ATTACHMENT_LOCAL_PREFLIGHT.md](ATTACHMENT_LOCAL_PREFLIGHT.md).

## Required next device run

1. Use a hardware-accelerated Android device or emulator with KVM and a known supported image; record API level and APK hash.
2. Configure the app to use a loopback mock endpoint and confirm the app's connection-probe result and request ledger.
3. Import the synthetic save, execute a legal action, a stale-option rejection and a failed action followed by an authored alternative.
4. Verify route-specific state after convergence, no duplicate roll/reward/resource cost, restart recovery, save export/import and natural ending.
5. Only after those steps, schedule an independent human-play review. Keep live-model testing separate and require a separately approved budget.

Until that run completes, Android player acceptance and human narrative quality remain `NOT RUN`.
