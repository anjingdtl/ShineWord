# Android device, database preservation and recovery

**Cutoff:** 2026-10-12. No emulator/device interaction was made after the user asked to stop testing.

## Device and installed package

- Serial: emulator-5554; Android 17 / API 37.
- Package: com.shineword.app.
- Installed build: V1.0.0 / versionCode 1000000.
- Local APK: F:/sw95/dist/apk/debug/ShineWord-V1.0.0-debug.apk, 110,046,787 bytes, SHA-256 B8CD7B64992702A2C8658BEECAFD49124CBF9AAF89A13C863024E54C322E90E6.
- Existing device-side base.apk hash evidence matched that local APK. Build and install used the data-preserving debug install path; no pm clear or uninstall was performed.
- At stop, the app UI was on the campaign list. The new story branch camp-mv51iswg-main was saved at v8. J1/J2/J3/J4A/J4B heads and J1 frozen turn are listed in CHECKPOINT.md.

## Database and history preservation

- Original app data was not cleared. The prior baseline selected a separate QA database and left the original shineword.db present and untouched.
- The J1 v70 inspection snapshot is private at F:/sw95/test-logs/phase9-5-longrun-2026-10-11/device-db-after-j1-petition-tap-check-5554.sqlite; its SQLite PRAGMA quick_check returned ok.
- The newest v8 branch snapshot and sanitized audit are under F:/sw95/test-logs/phase9-5-longrun-2026-10-11/install-check/phase95-after-new-campaign-action5-20261012.db and phase95-after-new-campaign-action5-audit.json.
- Device snapshots, DB files, APKs, UI screenshots and full UI trees remain under the ignored private test-logs tree; they are not included in this public report.

## Recovery findings

- J1 is not a normal recoverable pending turn. turn-0071 already owns a persisted successful roll but no commit. Keep the contract, roll and paused_system journal exactly as saved. Do not tap recovery, retry, reroll, delete or edit it.
- The current source readiness blocker returns campaign_completion_reward_actor_unavailable for the original J1 frozen state when evaluated offline. This confirms the new guard can identify the defect; it does not show the final APK dismissed the action in UI or that the historical turn can commit.
- J2 and J3 reached natural terminal states; do not append actions to those story histories to meet sample quotas.
- BUG-95-007 stale-job requeue and BUG-95-008 opportunity replay were tested in their saved branch scenarios. See BUGS_AND_FIXES.md.

## Not accepted in this run identity

- save-10 export via the app UI, system file-picker import into a separate campaign, cold launch, then new player action: NOT RUN.
- Full crash/ANR/SQLite-integrity sweep after every phase of the 453-request run: NOT RUN. No related crash was reported in the summarized recorded play, but that is not a comprehensive clean-crash claim.
- Full lock-screen/background/weak-network lifecycle matrix: NOT RUN.
- Campaign save/restore, old content revisions and delayed-effect fork isolation under the current final identity: NOT RUN.
