# Progressive opening operations

## Default import and first turn

1. Install `dist/apk/release/ShineWord-V0.3.0-progressive.2-release.apk` and configure the API profile through the app's normal secure profile flow. The key is stored through Android Keychain; profile metadata contains only the secure key reference.
2. In the library, import the TXT. This streams normalized source into local shards and prepares only the bounded opening dossier. It does **not** start whole-novel extraction in the background.
3. When the dossier passes citation checks and the normal publish gate, the app routes to original-character creation. Finish character setup, create the campaign, and enter the first turn. The campaign stays bound to that published base package revision.
4. If the endpoint returns no usable JSON or a request times out, the opening is not published. The streamed source remains available for a retry; the UI must not be treated as playable merely because a world or character screen opened. A failed preparation records a safe, desensitized stage code — `invalid_dossier:json_parse` / `:schema` / `:citation` / `:reference_closure` or `package_validation:publish` — plus redacted physical-request metrics, and never the prompt, the novel text, the key, or the model response.

The bounded `glm-5.3` endpoint probe returned a citation-valid dossier after two physical requests in 88.281 seconds, but this exceeded the 60-second median target before compile/publish/first turn. The final Release's real TXT opening attempt failed before package publication. TTFP has not met or been measured against the target; see [G0](reviews/progressive-opening/G0.md), [G1](reviews/progressive-opening/G1.md), and [status](reviews/progressive-opening/STATUS.md).

## Reading the three books

- In a campaign, the player view uses the package revision locked by that campaign plus only its active branch deltas. Story-time, visibility, and discovery filters apply before display.
- The explicit editor mode can show GM secrets. Keep it out of player screenshots and shared sessions.
- **已整理** means the current visible scope contains source-linked entries. **未整理** means known extracted facts remain unmapped. **未发现** means no matching item in the currently visible scope; it means “not in the whole source” only when the UI confirms full-source completion.
- An unknown source-search result means local reviewed material had no match. It does not prove that the novel contains no answer.

## “随探索补齐” local lookup

- Open a published campaign's world books, choose the relevant book, and enter a keyword or short phrase (up to 80 code points). Search reads the already imported source on-device and sends no novel text to a model.
- The first whole-source query builds its local index lazily. Android full-source indexing latency has not been measured. The query is cancellable and returns a count/status, not passage text.
- A hit is stored as an immutable exact-quote delta and remains undiscovered. Choose **记录为角色已知** to commit the selected excerpts as the current protagonist's branch knowledge. Only then do they appear in the player book and become eligible evidence on a later turn. Rewind restores the discovery state from that branch point.
- A miss means only that the local index found no match; it does not establish that the text or a rule is absent. Ordinary automatic turn lookup remains limited to source passages already visible on that branch. User lookup does not create rules or summarize the novel.

## Optional full-source refinement

Use **可选：全量精编三宝书** from a world's overview only when the local streamed source is available. The app uses the selected profile's model budget, processes saved chunks, maps facts into a new base package, and publishes only through the standard validator. Source ranges must cover the normalized source continuously; only whitespace may be skipped between extractor chunks. A failed or interrupted run keeps its checkpoints and the previously published opening package.

Full refinement can take many requests and substantial time. It is never started automatically by opening import. A new full package does not rewrite a running campaign's locked package; use it for a new campaign. Review conflicts in the world review page before expecting publication.

## Release artifact and smoke install

The signed Release APK and verified SHA-256 are listed in [progressive opening status](reviews/progressive-opening/STATUS.md). On an Android device or emulator, install without clearing app data:

```powershell
adb install -r .\dist\apk\release\ShineWord-V0.3.0-progressive.2-release.apk
```

Release verification covered first launch/profile setup, real TXT import through the document picker, local library launch with Wi-Fi disabled after force-stop, screen off/on resume, and an in-place v14-to-v15 update with existing AVD records preserved. The endpoint did not publish a package, so no first turn or first-ten-turn wait was measured. These checks do not replace long-range, active background-build, playable-campaign offline recovery, or on-device full-source index timing.
