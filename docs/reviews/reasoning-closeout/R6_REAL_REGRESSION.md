# R6 — Real GLM and layered regression

Date: 2026-09-30

Candidate source commit before this R6 commit: `7d94987118e430f84d6aea13699fa1f50cab7722`
Candidate package version used for the first signed Release install: V0.4.0 / versionCode 40000.

## Real GLM gate

- The runner read the configured GLM key file in-process only. It never prints or persists the key, Authorization header, prompt, provider response text, or novel excerpts. Its output is the sanitized companion file `R6_REAL_GLM_METRICS.json`.
- Three direct Planner calls returned HTTP 200 with captured request parameters `reasoning_effort=low/high/max`, `thinking.clear_thinking=false`, and `max_tokens=6,048/12,192/28,576`. Cold-start reserves were 2,048/8,192/24,576; the same-model hard input limits decreased from 1,034,336 to 1,028,192 to 1,011,808. Actual reasoning usage was observed, not asserted to be monotonic.
- 《白篱梦》 was locally analyzed and used for three real turns, selecting Low, High, and Max in sequence. The report records only file metadata, token counts, timing, context IDs, provider parameters, and redacted outcome flags. Planner, Narrator, Max Story Memory checkpoint, and Episodic Recall all ran. The three planner context IDs were distinct; mandatory state was retained.
- The refreshed R6 run also sent the progressive-opening dossier through the
  common `world_extract` plan and Ledger. Its Low request used a 4,096-token
  reserve, 8,000 business-output tokens, and a 12,096-token wire ceiling; the
  succeeded ledger row recorded the same tier/reserve/wire values and 464
  provider-reported reasoning tokens. The dossier response passed strict local
  JSON, quote, and chapter-span validation before package compilation.
- A live opening response is not treated as trusted evidence by itself. One
  earlier bounded post-fix attempt ended in `OpeningPreparationError` after
  two completed HTTP responses; its fine-grained code was not captured and the
  response text was not saved. The refreshed run passed on its first physical
  request. Deterministic tests separately verify one bounded JSON/evidence
  repair increments the Ledger attempt number under the same logical request ID.
- The three turn fixture records successful HTTP/provider completion and the
  requested tier/context routing. Its action grades were `failure`; this closeout
  does not claim game-outcome quality from those intents.
- 凡人修仙传 was locally analyzed for pressure only. No API requests were issued against this long novel. The Max allocation reduced optional input capacity compared with Low while retaining mandatory input.
- The sanitized live gate used 11 provider requests against a bounded runner allowance of 28. It did not run every possible model/request-tier combination.

## Android Debug AVD

- Only `Medium_Phone` was used for Debug. The app ran as the isolated QA package `com.shineword.app.codexqa`, leaving the existing production package and its data untouched.
- The UI showed Low / High / Max and the Planner reserve preview changed to 2K / 8K / 24K. Low and High taps near the upper and lower edges of the segment still selected the requested tier. The default `SegmentedControl` now uses the theme’s 44dp minimum height.
- Max survived force-stop and cold launch. Dark Chinese-ink and light Manga themes were visually reviewed; low-contrast preset text found in the light theme was fixed to use the raised-card foreground and reviewed again.
- No key was entered in the Android app, and no device LLM call was made.

## Signed Release candidate

- Release JavaScript was explicitly regenerated with `createBundleReleaseJsAndAssets --rerun-tasks`, then `assembleRelease` succeeded.
- The repository release script verified package metadata, the configured certificate, one signer, V2 signature, and 4-byte alignment. V0.4.0 candidate APK: 47,329,982 bytes; SHA-256 `ADE52ED53BAFB8D13790E298481DCFBB48FB5CD9A1C1BD8E36B8B9610E29A886`.
- Only `ShineQA` was used for Release. Its preinstalled `com.shineword.app` had the same version and signing certificate. `adb install -r` succeeded, preserving app data; force-stop and cold launch succeeded, and the release JS entrypoint started. High and Max each changed the visible reserve preview as expected.
- This stage report records the pre-version-bump Release candidate. The V0.4.1 package, final release AVD update, CI after version bump, and final matrix are closed in `FINAL_REPORT.md`.

## Final V0.4.1 signed Release verification

- Version gates reported `0.4.1` / versionCode `40100`. The release JavaScript
  bundle was regenerated with `createBundleReleaseJsAndAssets --rerun-tasks`
  before `assembleRelease`; the repository APK script then verified package
  metadata, the expected signing certificate, one signer, V2 signature, and
  4-byte alignment.
- Final artifact:
  `dist/apk/release/ShineWord-V0.4.1-release.apk`, package
  `com.shineword.app`, 47,328,370 bytes, SHA-256
  `6E463DE8CCC89C4DF52C79E43BEB888CD7E1BB66C781DDC1030F4EBF38D5E828`.
  The public certificate digest matched the repository's configured release
  certificate. No signing secret was printed or recorded.
- Only the `ShineQA` Release AVD was running. The V0.4.1 APK installed with
  `adb install -r`, package inspection returned versionName `0.4.1` and
  versionCode `40100`, and `am start -W` reported `LaunchState: COLD` for
  `com.shineword.app/.MainActivity`. No app crash markers were found in the
  fresh launch logs. The AVD was shut down afterwards; `adb devices` was empty.
- Post-version gates: Core 441/441, root typecheck, mobile typecheck,
  `verify:version`, `git diff --check`, and V0.4.1 Debug APK build passed.
  Core Verify run `36687226389` and Android Verify run `36687226621` passed for
  code/version commit `9da19591d9f2d2b3f0dee9b256f93114387f47fe`.
- This verifies a signed release APK build and installation, not a GitHub
  Release publication. No tag or public Release was created in this closeout.

## External validation boundaries

- DeepSeek was not tested against a live service because this run had no DeepSeek credentials. Its dialect mapping is covered by deterministic tests only.
- The real GLM test was run from the host-side application/provider pipeline, not from Android. Device Keychain import of the test key is not implemented and was not attempted.
- Real-world usage observations are samples, not a calibration claim; all cold-start reserves remain based on policy, and unknown reasoning usage remains unknown.
