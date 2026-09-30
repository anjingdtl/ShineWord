# R4 — Planner, Narrator, and Story Memory

Date: 2026-09-30

## Implemented

- `CampaignSession` normalizes the saved profile tier once for each turn context build and sends the same frozen tier to Planner and Narrator. Legacy `off` normalizes to `low`.
- Planner and Narrator have independent cold-start reserves and business-output demands. Their provider `max_tokens` ceilings are the kernel's `business output + reasoning reserve` wire amounts. `FrozenTurnContext` records tier and reserve, and its ID changes with the frozen budget plan.
- A classified `reasoning_only` Planner or Narrator completion allows one application-managed retry at the same tier. The retry uses a 1.5x reserve policy, replans elastic context, and caps each provider call at one physical transport attempt so the ledger can record both attempts separately. If the reserve cannot increase within declared capability, the retry is not sent.
- Story Memory checkpoint and repair requests now use `planLlmRequest`; the fixed 1,600-token output path is gone. Their full previous-memory view, turn batch, and JSON patch protocol are mandatory whole items. If a checkpoint cannot fit, the worker halves its turn batch until it fits or one turn remains. A request-cap stop reports `partial` coverage rather than `clean`.
- Memory repairs use `requestKind=memory_repair`; checkpoint and repair retain a stable logical request ID for a bounded range and the ledger increments attempt number. Reasoning-only retry keeps the same tier and request ID, raises the reserve by 1.5x, and either fits the complete batch or returns it to the batch-splitting path.
- The retained range summarizer uses the same Budget Kernel, explicit reasoning tier, JSON mode, and request ledger. It no longer has a standalone fixed 800-token request.
- Ledger schema migration 23 adds frozen reserve, policy version, and wire output fields. Known token usage from failed reasoning-only attempts is retained; if any physical usage field is missing, that aggregate remains `NULL`, not zero. Known failed usage can feed the tier- and request-kind-scoped rolling calibration query.

## Verification

- `npm run verify:core`: PASS, 436/436 tests.
- `npm run typecheck --prefix mobile`: PASS.
- `git diff --check`: PASS; Git emitted only its normal LF/CRLF working-copy notices.
- Focused tests cover Low/High/Max Planner and Narrator requests, distinct context IDs and reserves, Planner `reasoning_only` recovery with same tier and smaller-or-equal context, Memory checkpoint/repair policy, Memory Max batch shrinking, Memory `reasoning_only` recovery, range summarization, migration compatibility, and failed-request token usage.

## Stage boundary

- This report contains deterministic local fixtures only. Real GLM requests are deferred to R6.
- World Build policy freezing, shared JSON extraction, and World Build ledger coverage remain R5 work.
- PR CI for this R4 commit set is pending until the stage commits are pushed.
