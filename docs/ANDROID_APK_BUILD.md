# Android APK build

## Prerequisites

- Node.js 24.3.0 or newer
- JDK 17
- Android SDK Platform 36 and Build Tools 36.0.0
- Android NDK 27.1.12297006
- `ANDROID_HOME` or `ANDROID_SDK_ROOT` pointing to the SDK; `mobile/android/local.properties` can provide `sdk.dir` for a local checkout

Gradle 9.3.1 is pinned by the checked-in Gradle Wrapper. Run dependency commands from `mobile`; `npm ci` uses the checked-in lockfile and applies the Android compatibility patches during `postinstall`.

## Build

From the repository root:

```powershell
npm ci --prefix mobile --no-audit --no-fund
npm run apk:debug
```

The debug APK is written to `dist/apk/debug/ShineWord-V0.2.0-p2.8-debug.apk`.

## Signed release APK

Release builds use the existing `tavo-mini` keystore at `E:\AiWorkSpace\tavo-mini\android\keystores\tavo-mini-release.keystore`. The keystore remains outside this repository. The Windows User-scope signing variables are:

- `SHINE_WRITER_RELEASE_STORE_FILE`
- `SHINE_WRITER_RELEASE_STORE_PASSWORD`
- `SHINE_WRITER_RELEASE_KEY_ALIAS`
- `SHINE_WRITER_RELEASE_KEY_PASSWORD`

The configured keystore certificate SHA-256 is `017b3fbed4001083f2f70a0c51e8e463322df66b095e1c3a476fdd0d86dc2a0a`. Gradle fails closed when a release task is requested and any signing variable or the keystore is missing. Debug builds do not read release signing variables.

Run the PowerShell helper to load User-scope variables into the current process without printing their values:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mobile\scripts\build-release-apk.ps1
```

The signed release APK is written to `dist/apk/release/ShineWord-V0.2.0-p2.8-release.apk`. Both output paths are ignored by Git.
