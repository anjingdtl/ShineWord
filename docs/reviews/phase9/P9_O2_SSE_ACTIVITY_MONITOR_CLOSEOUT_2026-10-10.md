# P9-O2 Android SSE Activity Monitor Closeout — 2026-10-10

## Scope

Close the mobile transport gap in P9-O2: planning requests that opt into an SSE activity deadline must renew that deadline from complete SSE event frames received incrementally by the production Android transport.

This closes the transport implementation and Android smoke-check module only. It does not claim that all Phase 9 acceptance work is complete.

## Root cause and change

React Native 0.85.3 routes `fetch` through its XHR polyfill, but that fetch response is buffered and does not expose a streaming `body.getReader()`. The prior transport therefore cleared the SSE idle timer on this path and could not tell whether the provider was actively sending complete frames.

When `streamActivityTimeoutMs` is present and XHR is available, `FetchHttpTransport` now sends the same POST through React Native XHR. `onreadystatechange` and `onprogress` consume only the newly appended `responseText`, and `SseFrameMonitor` renews the idle deadline only at a completed event boundary. The absolute request deadline and idle deadline abort the active XHR. A status-zero terminal response remains a network failure. QA proxy identity headers are preserved. Requests without an SSE activity deadline keep the fetch transport.

The installed React Native 0.85.3 source confirms that setting `onreadystatechange` or `onprogress` enables incremental events and exposes `HEADERS_RECEIVED`, `LOADING`, and `DONE` states.

## Regression evidence

- `node --test tests/phase9-mobile-execution.test.cjs tests/phase9-request-deadline.test.cjs`: **26 passed, 0 failed**.
- New XHR cases prove that complete CRLF frames renew the idle deadline, partial progress without a complete frame does not renew it, local-proxy identity headers are attached, and status-zero completion is classified as a network failure.
- `npm run typecheck --prefix mobile`: passed.
- `npm run verify:core`: passed, **1249/1249 tests**.
- `npm run verify:version`: passed (`1.0.0`, versionCode `1000000`).
- `git diff --check`: passed.

## Android build and retained-data smoke check

- `npm run apk:debug --prefix mobile`: `BUILD SUCCESSFUL`; produced `dist/apk/debug/ShineWord-V1.0.0-debug.apk`.
- Installed with `adb install -r` on `emulator-5554` (package `com.shineword.app`).
- Local APK and pulled installed `base.apk` SHA-256 both equal `E866C4130CC35170C1FBE7F46BC948622FA768A9CC326FF415115E89226FAD1A`.
- Installed version remained `1.0.0` / `1000000`; `firstInstallTime` remained `2026-10-05 03:29:05`.
- The app launched to the book shelf. Existing `novel` project remained visible with 1504 chapters and 5/5 LLM batches. The campaign screen continued to show five campaigns, including the completed natural-ending journey at v16. No app crash or fatal exception appeared in the post-launch crash buffer.
- UI captures: `.tmp/phase9/simulator-longrun-20261010/p9-o2-installed-screen.png`, `p9-o2-installed-window.xml`, `p9-o2-campaigns-screen.png`, and `p9-o2-campaigns-window.xml`.

The configured real profile is low-tier and does not opt into the high/max extended-operation SSE path. No model/tier was substituted and no paid provider request was sent for this module. Thus the incremental frame behavior is covered with transport-level Android XHR regressions, and the rebuilt bundle is installed/launched on the emulator; a real high/max provider streaming call was not exercised.

## Changed files in this module

- `mobile/src/fetchTransport.ts`
- `tests/phase9-mobile-execution.test.cjs`
- `docs/reviews/phase9/P9_O2_SSE_ACTIVITY_MONITOR_CLOSEOUT_2026-10-10.md`
