# Phase 9.5 local closeout baseline

Date: 2026-10-19 (Asia/Shanghai)

## M0 — source and machine state

- Fresh `git fetch origin --prune` reported `origin/main=9030c2674eea12bc3882ebe8c1cc155342e722c0`. The primary checkout `F:\ClaudeWorkSpace\projects\ShineWord` was clean on that same commit, with 0 ahead / 0 behind. Its files and the other registered worktrees were left in place.
- Work continues in the existing isolated checkout `F:\sw95local-20261018`; the new branch `fix/phase95-local-final-closeout-20261019` starts at the exact `origin/main` commit and tree (`ccae98c56d20f71f5c83d5ff3985e678e58d659c`).
- Runtime: Node 24.14.1, npm 11.14.1, Temurin JDK 17.0.19, Android SDK under `%LOCALAPPDATA%\Android\Sdk`, ADB 37.0.0-14910828. `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Temp\shineword-qa` was used for Gradle.
- Registered AVD inventory remains at 3: `Medium_Phone`, `ShineWord_M4FaultQA_20261018`, and `ShineWord_Phase95_LocalFinal_20261018`. The two ShineWord AVDs (`emulator-5560`, `emulator-5556`) were online; no AVD was added.
- At 2026-10-19 06:37 +08:00, F: had 545.39 GiB free and Windows reported 5.26 GiB available RAM.
- The authorized novel file was present at 7,178,905 bytes with SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`. The local GLM configuration file was present (154 bytes; last modified 2026-10-18 14:58 +08:00). Its contents and credential fingerprint were not emitted or committed.

## M0/M1 command evidence

| Command or check | Result |
|---|---|
| `git fetch origin --prune`; compare local `main` and `origin/main` | PASS; both `9030c2674eea12bc3882ebe8c1cc155342e722c0`, clean |
| root `npm ci --ignore-scripts --no-audit --no-fund` | PASS |
| `npm run verify:core` | PASS; 1,361 tests, 0 failed, 34.6 s test duration |
| `npm run verify:version` | PASS; V1.0.0 / versionCode 1000000 |
| `npm --prefix mobile ci --no-audit --no-fund` | PASS |
| `npm --prefix mobile run typecheck` | PASS |
| standalone Debug APK build | PASS; see [DEVICE_AND_APK.md](DEVICE_AND_APK.md) |

This baseline is a fresh local run on the exact current main tree. It does not promote prior PR checks, real-model tests, or QA-driven actions into player acceptance.

## Final branch regression

- Refreshed origin after local work: origin/main remained 9030c2674eea12bc3882ebe8c1cc155342e722c0; the closeout branch is based directly on it. The primary checkout stayed clean and other worktrees were not modified.
- Final branch Core Verify: 1,364/1,364 passed, 0 failed. Mobile typecheck and version check passed.
- Focused ledger, lease, SQLite stale-worker fencing, and memory worker regression suite: 64/64 passed.
- The two confirmed play error-message defects were fixed on this branch and covered by the final Core run. The response-write fault injection itself produced no code defect.
- Real GLM allowance in the session was explicitly raised by the user. The known provider ledger remains 113 physical requests: 112 HTTP 200 and one old-profile HTTP 401; two separate host transport attempts remain identity-less unknown and were not repeated. Real GLM HTTP 429 remains 0. Cost cannot be derived from the application ledger. No real GLM request was made during the final M4 response-write injection.
- Exact final PR SHA and hosted checks are maintained in PR #17 after the final documentation commit.
