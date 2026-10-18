# PlayHeader large-text and narrow-viewport regression

Date: 2026-10-19 (Asia/Shanghai)

## RED

- Reproduced on the existing `ShineWord_M4FaultQA_20261018` API 37 AVD using synthetic campaign `M4QA1019C`.
- At Android font scale `2.0`, the stacked PlayHeader toolbar remained visible but the campaign title was absent from both the screenshot and accessibility hierarchy. Screenshot: `play-header-large-font-red.png`.
- The new layout regression initially failed because the shared header had no content-sized full-width title style for stacked mode.

## Minimal fix

- Added `headerTitleContainerStyle`: inline mode keeps `flex: 1`; stacked mode uses a full-width content-sized row.
- Kept the change in the shared header layout only. No Runtime state, validation, campaign data, or request behavior changed.

## GREEN

- `node --test tests/play-header-layout.test.cjs`: 2/2 passed.
- `npm --prefix mobile run typecheck`: passed.
- Standalone Debug APK built and installed only on `emulator-5560`. Local APK SHA-256 and installed `base.apk` SHA-256 both equal `2DFAC97CCED93D0990489478A230359E7FE06AD727A4BFC984061F53AE6759CA`.
- The same Maestro `assertVisible` flow passed at font scale `2.0` and at a virtual `360dp`-wide viewport. The complete title appeared in the accessibility tree; screenshots: `play-header-large-font-green.png` and `play-header-narrow-green.png`.
- Restored device settings: physical `1080×2400`, density `420`, font scale `1.0`.
- App database remained `2,338,816` bytes across the install. No player action was submitted and the visible `outcome_unknown` recovery control was not tapped. The primary novel AVD `emulator-5556` was not modified.

## Limits

This verifies PlayHeader title visibility on one API 37 emulator at two constrained layouts. It does not verify TalkBack speech/focus, all large-text screens, API 24, or a physical small-screen device.
