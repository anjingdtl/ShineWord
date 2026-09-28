# Progressive opening operations

## Default import and first turn

1. Install `dist/apk/release/ShineWord-V0.3.0-closeout.2-release.apk` and configure the API profile through the app's normal secure profile flow.
2. In the library, import the TXT. This streams normalized source into local shards and prepares only the bounded opening dossier. It does **not** start whole-novel extraction in the background.
3. When the dossier passes citation checks and the normal publish gate, the app routes to original-character creation. Finish character setup, create the campaign, and enter the first turn. The campaign stays bound to that published base package revision.
4. If the endpoint returns no usable JSON or a request times out, the opening is not published. The streamed source remains available for a retry; the UI must not be treated as playable merely because a world or character screen opened.

The tested GLM profile currently truncates or times out before returning a complete dossier. The product has not met the measured TTFP target for《白篱梦》with that profile; see [G0](reviews/progressive-opening/G0.md) and [G1](reviews/progressive-opening/G1.md).

## Reading the three books

- In a campaign, the player view uses the package revision locked by that campaign plus only its active branch deltas. Story-time, visibility, and discovery filters apply before display.
- The explicit editor mode can show GM secrets. Keep it out of player screenshots and shared sessions.
- **已整理** means the current visible scope contains source-linked entries. **未整理** means known extracted facts remain unmapped. **未发现** means no matching item in the currently visible scope; it means “not in the whole source” only when the UI confirms full-source completion.
- An unknown source-search result means local reviewed material had no match. It does not prove that the novel contains no answer.

## Optional full-source refinement

Use **可选：全量精编三宝书** from a world's overview only when the local streamed source is available. The app uses the selected profile's model budget, processes saved chunks, maps facts into a new base package, and publishes only through the standard validator. Source ranges must cover the normalized source continuously; only whitespace may be skipped between extractor chunks. A failed or interrupted run keeps its checkpoints and the previously published opening package.

Full refinement can take many requests and substantial time. It is never started automatically by opening import. A new full package does not rewrite a running campaign's locked package; use it for a new campaign. Review conflicts in the world review page before expecting publication.

## Release artifact and smoke install

The signed Release APK and verified SHA-256 are listed in [progressive opening status](reviews/progressive-opening/STATUS.md). On an Android device or emulator, install without clearing app data:

```powershell
adb install -r .\dist\apk\release\ShineWord-V0.3.0-closeout.2-release.apk
```

The G5 AVD smoke verified install and app launch only. It did not measure a successful real-novel opening or replace the outstanding lock-screen, offline-resume, first-ten-turn, and long-range device tests.
