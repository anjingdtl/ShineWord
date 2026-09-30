# R2 — Profile UI and persistence

## Changes

- The shared profile form now has one product tier field: `reasoningTier` / `setReasoningTier`; the settings page and first-run page use the same Low / High / Max segmented control.
- Saving a profile requires the selected `reasoningTier`. Preset profiles default to Low, while the user can choose another tier before saving.
- `shineword.api.profile.v1` stays in use, so the existing Keychain reference remains `llm.default` and no API key re-entry or Keychain migration is required.
- The loader normalizes historical `reasoningEffort: 'off'` to `reasoningTier: 'low'`, preserves endpoint/model/keyRef and known preset capabilities, and writes the normalized profile back to the same storage key.
- The previous custom-profile sentinel pair (128,000 context / 8,192 output) is removed during migration for the old `Default` custom profile. The old form generated that pair without user input. Other valid positive capability values are retained.
- Custom models may leave context and maximum output blank. Blank values stay absent in storage; the old automatic 128K/8192 values are no longer generated. Entered values must be positive integers.
- Advanced settings disclose an explicit `unsupported` reasoning-parameter mode. Such profiles fail before network send instead of pretending the endpoint accepts the tier parameter. Automatic adapter routing remains the default.
- The settings card shows the Planner cold-start reserve estimate and an approximate input-envelope preview when context and output capabilities are known. It also says that settings apply to later requests and active World Build runs keep their frozen configuration.
- The provider accepts an explicit request output cap when profile maximum output is unknown. A profile does not gain a persisted capability from that fallback; World Build continues to require a declared output ceiling.

## Verification

- `npm run verify:core`: PASS, 415 tests.
- `npm run typecheck --prefix mobile`: PASS.
- `npm run apk:debug --prefix mobile`: PASS, V0.4.0 / versionCode 40000, 96,218,115 bytes, SHA256 `35A0EF17A819BD8F0D89242503D428525911E808A0459FD99AE4BED98CA5C971`.
- Profile migration/store unit coverage: legacy off mapping and persistence, endpoint/model/keyRef preservation, preset capability preservation, custom sentinel removal, explicit custom capability retention, unknown capability preservation, required explicit tier on save, and no newly persisted `off`.
- Android Debug UI on `Medium_Phone` (`com.shineword.app.codexqa`): PASS for Low / High / Max selection and 2K / 8K / 24K Planner reserve previews. The isolated Debug QA APK used a bundled JS artifact; no additional AVD was started.
- Touch and appearance review: default segmented controls now set `minHeight` to the 44dp theme minimum. On the 420dpi, 1080×2400 emulator, taps near both vertical edges selected Low and High successfully. Dark and white-panel Manga themes were visually reviewed. Review caught low-contrast preset labels on Manga cards; they now use `theme.onRaised.primary`, and the post-fix screenshot shows both preset labels clearly.
- The settings screen showed the custom model’s context and output capabilities as unknown, the advanced settings disclosure, and the frozen-run notice without text overflow.
- Android persistence: PASS. Selected Max, force-stopped the Debug QA app, cold launched it, and confirmed the 24K Max reserve preview remained.
- Release AVD `ShineQA`: the signed V0.4.0 candidate installed over the same-signed V0.4.0 app with `adb install -r`, cold launched, and exposed the Low / High / Max settings; High and Max changed the preview to 8K and 24K. No key was entered. Final V0.4.1 release validation is recorded in R6 after version bump.
- Android key safety: no API key was entered or read. A save attempt with blank Keychain key stopped at the expected “请输入 API Key（将只写入系统 Keychain）” validation; no provider request was made.
- Release AVD `ShineQA` was left unchanged. The Debug QA package used a temporary local application id suffix which was removed from the tracked Gradle file after installation; no extra emulator was started.

## Scope and final closure

The usual debuggable React Native variant can load JavaScript from Metro. For deterministic visual verification, the temporary local QA build bundled JavaScript and disabled packager access only for that build; the temporary Android host/build settings were restored immediately. This document does not claim that the Android device made a real LLM request. Real GLM API and final V0.4.1 release evidence are in `R6_REAL_REGRESSION.md` and `FINAL_REPORT.md`.
