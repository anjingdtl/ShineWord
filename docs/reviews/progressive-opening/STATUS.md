# Progressive opening delivery status

**Updated:** 2026-09-29 (Asia/Shanghai)
**Review baseline:** `8eccb11`; source and working tree were audited from the live `main` HEAD, including the later commits and existing user edits.

## Stage status

| Stage | Result | Evidence |
|---|---|---|
| G0 endpoint diagnostics | Instrumentation, profile-derived budgets, lease renewal, and cancellation fencing are implemented. A complete dossier is possible with `glm-5.3` at an 8,000 output cap, but took two requests and 88.281 seconds. | [G0 review](G0.md) |
| G1 bounded opening package | Fixture path compiles/publishes and creates a campaign. The real Release imported the supplied TXT and prepared an 8,000-code-point request, then failed before publication. | [G1 review](G1.md) |
| G2 Chinese local retrieval | Custom Chinese postings, entity aliases, adjacency, bounded paragraphs, and an SQLite FTS capability probe are implemented. Host FTS5 is verified; Android capability/result and full-source index latency are not independently measured. | [G2 review](G2.md) |
| G3 demand-driven retrieval | Current action, near-domain prefetch, and explicit player-initiated “随探索补齐” use bounded retrieval. Unconfirmed exact quotes remain hidden; no-match does not mean absent. | [G3 review](G3.md) |
| G4 branch-bound immutable deltas | Base/delta manifests, frozen Planner dependencies, save/archive/fork/rewind, discovery confirmation, and conflict review are covered by regression tests. | [G4 review](G4.md) |
| G5 product and Release | v15 signed Release built and installed. Offline library relaunch and screen wake passed; v14 AVD library/build records remained visible after in-place upgrade. A live first playable turn was not reached. | [G5 review](G5.md) |

## Release artifact

- APK: `dist/apk/release/ShineWord-V0.3.0-progressive.1-release.apk`
- Android package/version: `com.shineword.app`, version code `15`, version `0.3.0-progressive.1`
- Size: `47,009,334` bytes (44.83 MiB)
- SHA-256: `FC79302C8C14383CF6612C75EE185226BAF822BEEAA2DBD24C196638116F9EC1`
- Build evidence: signed with the configured certificate; one signer, v2 signature, and zip alignment passed the repository build script.
- Device evidence: new `ShineWord_Progressive_Release` API 37.1 AVD installed/launched the APK. The existing `Medium_Phone` AVD updated from v14 with `adb install -r`, retained its prior library/build records, and launched v15; its unassociated world-books screen showed the lookup card disabled with a campaign-binding message. No AVD data was wiped.

## Regression and review

- `npm test`: **224 passed, 0 failed**.
- `npm run typecheck`: passed.
- `npm run typecheck --prefix mobile`: passed.
- `git diff --check`: passed; Windows line-ending notices only.
- Release build initially hit the known Windows/JDK Gradle loopback IPC issue. Setting `TEMP` and `TMP` to `C:\tmp` for the build process resolved it; project signing/build configuration was not changed for the workaround.

## Acceptance boundary

The ≤60-second median / ≤120-second P95 TTFP target is **not met or measured**. One complete endpoint dossier took 88.281 seconds for extraction alone, before compile, publish, character setup, or the first turn. On the final Release, the real TXT import reached opening preparation but the endpoint returned an unusable result; the app kept a recoverable failure state and did not publish a partial package. The production-signed app disallowed `run-as`, so no database or response was exported to inspect that failure.

No on-device first playable turn, first-ten-turn cumulative wait, long-range exploration, active build continuation through process death/lock screen, offline retry of a playable campaign, or full-source local index latency is claimed. Unit/integration tests cover opening reference closure, unknown/missing data behavior, secret visibility, immutable deltas, freeze/commit concurrency, cancellation, save/archive/fork/rewind, and old-format compatibility. These are not substitutes for the outstanding Release scenarios.

Delivery is a bounded, playable-opening implementation with optional manual full refinement and explicit local source lookup. It does not claim completed unrestricted exploration of the entire novel.
