# Progressive opening delivery status

**Updated:** 2026-09-29 (Asia/Shanghai)
**Review baseline:** `8eccb11`; implementation was checked against the live repository HEAD and retained the user's existing working-tree files.

## Stage status

| Stage | Result | Evidence |
|---|---|---|
| G0 endpoint diagnostics | Implemented; endpoint usability for this profile is blocked | [G0 review](G0.md) |
| G1 bounded opening package | Implemented; fixtures publish and create a playable campaign; live 《白篱梦》 dossier not returned | [G1 review](G1.md) |
| G2 Chinese local retrieval | Implemented with local postings/aliases and explicit SQLite FTS5 capability check | [G2 review](G2.md) |
| G3 demand-driven queue | Implemented with current-action priority, bounded inputs/budgets, dedupe and stale-result fencing | [G3 review](G3.md) |
| G4 branch-bound immutable deltas | Implemented through snapshots, frozen contracts, saves, archives, fork and rewind | [G4 review](G4.md) |
| G5 preparation UI / optional full refinement | Implemented, 223 tests pass, signed Release installed and launched on an AVD | [G5 review](G5.md) |

## Delivery artifact

- APK: `dist/apk/release/ShineWord-V0.3.0-closeout.2-release.apk`
- Android package/version: `com.shineword.app`, version code `14`, version `0.3.0-closeout.2`
- Size: `46,982,026` bytes
- SHA-256: `0B3A9DFD4DAA5BF8B1705468D6629BC868A5FFD7DD645F17B2094B4988083D41`
- Release checks: configured certificate, one signer, v2 signature, and zip alignment verified by `mobile/scripts/build-apk.js`.
- Device smoke: installed on `Medium_Phone` without clearing app data; main activity resumed. No physical Android device was connected. The test AVD was stopped after the smoke check.

## Acceptance boundary

The source and fixture behavior is complete through a bounded playable opening, local retrieval, and immutable branch deltas. The current real GLM profile did not produce a dossier for the supplied novel in the bounded endpoint probes, so the target of median TTFP ≤60 seconds and P95 ≤120 seconds is **not met or measured**. Device import-to-first-turn, first-ten-turn expansion wait, full-refinement completion, lock-screen/offline recovery, and on-device save/fork/rewind still require a working model profile and a dedicated Android run.

Do not describe this artifact as unrestricted whole-novel exploration. Full-source refinement is explicit and optional. Existing campaigns remain on their locked package; branch additions are source-cited, immutable, and visible only within the applicable branch/time projection.
