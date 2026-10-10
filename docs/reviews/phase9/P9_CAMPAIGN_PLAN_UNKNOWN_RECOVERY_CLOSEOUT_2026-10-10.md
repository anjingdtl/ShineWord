# P9 campaign-plan unknown recovery closeout — 2026-10-10

## Scope

Close the explicit recovery path for `campaign_plan` requests whose provider outcome is unknown, covering both opening plans and adopted-campaign replans. Recovery is a user-confirmed operation; narrator, memory, and other unknown request kinds remain outside this flow.

## Production path

- The read-only preview binds the source job, exact frozen root and payload hash, active provider profile fingerprint, current campaign/branch/state version and plan revision, and the original physical attempt IDs. It reports only the source job's remaining request budget and does not write approval or send HTTP.
- Explicit confirmation atomically writes the approval/link audit, creates a linked job and frozen root, carries forward any valid raw candidate, and annotates the original unknown attempts without changing their `outcome_unknown` result.
- The linked job can dispatch only within the original remaining budget. Repeated confirmation is idempotent, including concurrent replanning UI clicks and confirmation after adoption. Replan candidate adoption still uses the existing stable-boundary fence.
- Android opening and play screens expose a confirmation prompt that explains the unknown charge and remaining plan budget before recovery. The data migration is additive (schema 102) and the baseline installer upgrades a valid version-101 database in place.

## Regression and build evidence

- `node --test tests/phase9-planning-budget.test.cjs tests/phase9-sqlite.test.cjs`: **29 passed, 0 failed**. This includes opening recovery through adoption/export, adopted-branch replan recovery through adoption/export, preview with zero sends, retained source unknown attempt, concurrent/double-confirm idempotence, and a stale base-state zero-dispatch fence.
- `npm run typecheck --prefix mobile`: passed.
- `npm run verify:core`: passed, **1249/1249 tests**.
- `npm run verify:version`: passed (`1.0.0`, versionCode `1000000`).
- `npm run apk:debug --prefix mobile`: build succeeded. The local and installed APK hashes matched at `E866C4130CC35170C1FBE7F46BC948622FA768A9CC326FF415115E89226FAD1A`.
- Retained-data Android launch and campaign-list smoke check passed; five existing campaigns remained visible, including the v16 naturally completed journey. Installation preserved `firstInstallTime`; crash buffer contained no app fatal exception.
- No real provider request or unknown result was created to force the recovery UI on the preserved user database. The exact preview/approval/recovery lifecycle is exercised against production SQLite and application services with controlled provider responses.

## Evidence

Emulator package/identity and UI captures are in `.tmp/phase9/simulator-longrun-20261010/`, including the pulled installed APK, book-shelf screenshot/window, and campaign-list screenshot/window. These captures are not provider-quality evidence and do not claim a live unknown-replay interaction.

## Files in this module commit

- `src/application/campaignPlan/unknownReplayRecovery.ts`
- `src/application/campaign/session.ts`
- `src/application/project/dbBaseline.ts`
- `src/infra/sqlite/builtinMigrations.ts`
- `mobile/src/campaignPlanning.ts`
- `mobile/src/ui/features/play/CampaignProgressCard.tsx`
- `mobile/src/ui/features/play/hooks/usePlayController.ts`
- `mobile/src/ui/screens/OpeningScreen.tsx`
- `mobile/src/ui/screens/PlayScreen.tsx`
- Recovery, migration, and fixture regressions under `tests/`.
