# Phase 9 Android Unicode input

Test-only instrumentation for emulator QA when `adb shell input text` cannot enter Chinese. It sets the focused, enabled, non-password `android.widget.EditText` in `com.shineword.app` through the Android accessibility API and verifies the result. It does not modify the app database or ship in the production APK.

Build and install from the repository root:

```powershell
./tools/phase9-android-text-input/build.ps1 -Serial emulator-5556
```

Focus the intended field using a fresh UI hierarchy first. Encode the non-secret text as UTF-8 Base64, then invoke:

```text
adb -s emulator-5556 shell am instrument -w -e textBase64 BASE64_TEXT com.shineword.qa.input/com.shineword.qa.input.TextInput
```

To clear the focused field, use `-e clear true` instead of `-e textBase64`. Require `textMatches=true`, no `error`, and an exact text match in a fresh UI hierarchy before saving or submitting. Do not use this helper for credentials. The APK and test signing key remain under ignored `.tmp/phase9/ui-text-helper`.
