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

## Acceptance still pending

- Android device/AVD visual review of the new settings controls, themes, text fit, and 44dp interaction target.
- Android force-stop/relaunch persistence of Max.
- Full application behavior is not yet tier-coupled; R3–R5 integrate the selected tier with budgets and request paths.

The debug artifact is the standard React Native debug APK, which expects Metro to provide JavaScript. Its native APK bytes do not demonstrate that a device rendered the changed screen; that UI gate remains pending.
