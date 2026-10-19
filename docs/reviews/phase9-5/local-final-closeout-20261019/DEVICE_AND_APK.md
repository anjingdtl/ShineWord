# Android build and device evidence

Date: 2026-10-19 (Asia/Shanghai)

## M1 — current-main Debug build and install

- Source commit: `9030c2674eea12bc3882ebe8c1cc155342e722c0` (tree `ccae98c56d20f71f5c83d5ff3985e678e58d659c`).
- Command: `npm --prefix mobile run apk:debug`, with the project-required JDK 17 Unix-domain-socket temp setting.
- Result: standalone `ShineWord-V1.0.0-debug.apk`, 105.06 MB; package `com.shineword.app`, versionName `1.0.0`, versionCode `1000000`.
- Build artifact SHA-256: `FAD88428E42B1AEC82E97BAFF397A953F5650001872F78AA084FC813C513FC66`.
- Installed only to the synthetic M4 device using `adb -s emulator-5560 install -r`; installed `base.apk` was pulled back and had the same SHA-256. `-r` preserved the existing application data; the private SQLite file remained 1,822,720 bytes and its synthetic campaign still read at stateVersion 3. The real-novel device `emulator-5556` was not modified.
- Device: `ShineWord_M4FaultQA_20261018`, API 37, 1080×2400 at 420 dpi. Both existing ShineWord devices remain the only running AVDs.
- `maestro --device emulator-5560 test docs/reviews/phase9-5/local-final-closeout-20261018/evidence/android-open-library.yaml`: exit 0; launch, animation settle, and the `书库` visibility assertion completed.
- After launch, `com.shineword.app` had a running process and the Android crash buffer contained 0 lines.

## Scope boundary

This is a current-main build/install and library cold-launch smoke. It is not a complete M1 UI matrix or a release-device result. The current APK was not installed on the real-novel AVD in this pass, and no existing app data was cleared.

## Final branch M4 install and recovery UI

- The response-write experiment APK was EFA99A71AF8FF21509C9B7701214D9BA45D3A64342922B320E06CDE390CE9223. The later PlayHeader layout repair was rebuilt as SHA-256 `2DFAC97CCED93D0990489478A230359E7FE06AD727A4BFC984061F53AE6759CA` and installed on the same existing `ShineWord_M4FaultQA_20261018` AVD; local APK and installed `base.apk` hashes match.
- On synthetic branch camp-mvef22x8-main, a single Maestro guidance action exercised a Narrator-success ledger-write abort. The screen retained its recovery control and disabled composer; the persisted request is outcome_unknown and was not approved or replayed. Detailed snapshot/hash evidence is in M4_RESPONSE_WRITE_FAILURE.md.
- The primary novel device emulator-5556 still had the app process active and a 55 MB application database during final review. It was intentionally left running with its data untouched; the final branch APK was not installed over that active session.
- The M4 fault AVD remains on the synthetic recovery screen. The local mock server is stopped and TCP port 18591 has no listener.

## PlayHeader constrained-layout regression

- On the existing synthetic M4 campaign, font scale 2.0 previously removed the stacked campaign title from both screenshot and accessibility hierarchy. The layout repair was installed only on `emulator-5560`.
- Maestro `assertVisible` passed at font scale 2.0 and at a virtual 360dp width. The title is visible as a wrapped full-width row; neither case tapped the recovery control or submitted a player action.
- The app DB remained 2,338,816 bytes through reinstall. Final device settings were reset to physical 1080×2400, 420 dpi, font scale 1.0. Screenshots and flow are in `evidence/`.
