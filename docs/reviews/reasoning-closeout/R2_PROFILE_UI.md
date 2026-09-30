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
- Android Debug UI on `Medium_Phone` (`com.shineword.app.codexqa`): PASS for Low / High / Max selection, Max reserve preview, expandable advanced settings, unknown custom capability fields, and no visible clipping in the inspected dark appearance. The segmented control and advanced-settings control were clickable through the accessibility tree.
- Android persistence: PASS. Selected Max, force-stopped the debug app, relaunched it, and confirmed `profile-reasoning.max` remained selected in the profile UI.
- Android key safety: no API key was entered or read. A save attempt with blank Keychain key stopped at the expected “请输入 API Key（将只写入系统 Keychain）” validation; no provider request was made.
- Release AVD `ShineQA` was left unchanged. The Debug QA package used a temporary local application id suffix which was removed from the tracked Gradle file after installation; no extra emulator was started.

## Acceptance still pending

- Light-appearance visual review and device-level 44dp hit-target measurement remain pending.
- Full application behavior is not yet tier-coupled; R3–R5 integrate the selected tier with budgets and request paths.

The standard React Native debug APK expects Metro to provide JavaScript. The device UI evidence above came from the isolated local Debug QA install with Metro available; it does not demonstrate a real provider request.
