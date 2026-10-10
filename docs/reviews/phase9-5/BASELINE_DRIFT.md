# Phase 9.5 M0 — Baseline drift and frozen evidence

**Audit date:** 2026-10-10
**Repository:** `anjingdtl/ShineWord`
**Working branch:** `feat/phase9-5-evidence-driven-runtime`
**Design checkpoint:** `a2809bc735cbaace22a87206f509c0387b9bfbd3`

## Git baseline

- Fetched the remote `main` before reading or changing source. At audit time, `origin/main`, local `main`, and the V2.0 design checkpoint all resolve to `a2809bc735cbaace22a87206f509c0387b9bfbd3`.
- The pre-existing local checkout had been at `a82a0eaaf485a1739ed05d26b20ea0f62b127add`; it was fast-forwarded after fetch. Work is isolated on the required feature branch. `main` was not edited.
- Comparing `89bb0c8` with the checkpoint shows the V2.0 plan document as the only tree change. The production source at the V2.0 checkpoint therefore matches the simulator-stop code tree, while the design checkpoint itself is one documentation commit newer.
- The design document’s marked code baseline (`89bb0c8`) is not being treated as the current branch head. All implementation findings below were checked against the fetched `a2809bc` tree.

## Changes since Phase 9’s earlier records

The current `main` includes the following later Phase 9 records and code that must remain part of the baseline:

- campaign-plan unknown-outcome recovery closeout, with explicit recovery controls and migration 102;
- Android XHR/SSE activity monitoring closeout;
- stage-preparation closeout;
- a recorded real Android long-run of 9 actions (8 successful, 1 failed), stages 1–7 completed, two delayed consequences consumed, and save-10 export completed;
- R69 continuation and candidate-repair records.

These records close named work items and journeys only. The Phase 9 acceptance matrix remains **29 PASS / 2 FAIL / 9 NOT RUN**; historical A01–A40 status is not changed by this branch. The diagnosis names A15 and A36 as failures and calls out incomplete A19/A38 evidence. The recorded Android journey is useful evidence for its exact route, not proof of the whole acceptance matrix or of a different 9.5 runtime path.

The simulator stop record lists a separate 78/200 simulator ledger, zero reserved requests, and one unknown `campaign_plan` outcome. That request was neither recovered nor replayed during this audit. The Phase 9 contract ledger’s unused balance is not Phase 9.5 authorization and will not be used.

## Production turn path at the checkpoint

For a fresh free-play action, the production path is:

1. `CampaignSession.playTurn` checks campaign/branch ownership, pending interaction state, current actor and location, and available choices.
2. The session resolves the branch-bound world package and adopted campaign artifacts, filters retired situations through `projectPlayableSituations`, and assesses published methods against the current snapshot: rules, actor state, skill/rank, items, knowledge, relationships, targets, locations, and conditions.
3. `runV2Turn` sends a Planner request for a fresh uncached free-play action. Invalid proposals may take the existing bounded repair path. Proposal parsing and local compilation validate the action and bind an offered method; the Planner does not author the method’s frozen outcome effects.
4. The compiled `ActionContract` is serialized, hashed, and staged with its content/rule bindings. A rules roll is resolved once or reused from the turn journal.
5. `CampaignSession.prepareResolution` prepares the complete next snapshot: contract effects, relationship/discovery/quest updates, situation runtime, campaign progress and rewards, deferred consequences, and closure/ending checks.
6. Narrator receives the frozen grade and compiled result. Its candidate is retained for the existing recovery path.
7. `commitPreparedTurn` commits the prepared object in the SQLite transaction with the turn, state snapshot/projections, campaign events, narrative adoption, and outbox. The transaction and idempotency checks prevent a replay from applying the state transition twice.
8. Post-commit guidance and campaign replan work are queued. A queued replan is a separate campaign-planning path; it is not a Planner call made by the action compiler and must be counted separately when measuring model traffic.

An already committed turn returns its saved narrative. A staged/frozen turn verifies its contract and reuses its roll; recovery does not silently compile a new proposal. The M1 fast path must enter the same preparation, narration, and atomic commit path and must preserve those boundaries.

The two model roles on the ordinary fresh L2 path are Planner and Narrator. The fixture can observe them independently from local campaign planning. M1’s zero-Planner claim must be backed by the actual request ledger for the action; it does not mean zero total model traffic if an independently scheduled campaign-plan job later runs.

## M0 parity foundation

`tests/phase9-5-baseline.test.cjs` freezes a deterministic reference for the current L2 `sweep` method across all four grades. It injects fixed dice and a scripted provider, then records the selected difficulty, frozen four-grade contract, grade, evidence counter and actual Planner/Narrator dispatches. The shared fixture accepts an injected random source so later local-vs-L2 tests can replay the same roll inputs.

The existing regression fixtures cover the other authoritative effects needed for a parity comparison:

| State or boundary | Existing evidence |
| --- | --- |
| Relations and route-specific outcome | `tests/phase9-turns.test.cjs`, `tests/phase9-flow.test.cjs`, `tests/phase9-adoption-settlement.test.cjs` |
| Knowledge, clue visibility, branch isolation | `tests/phase9-clues.test.cjs`, `tests/phase9-turns.test.cjs` |
| Items and actor/resource effects | `tests/phase9-closeout.test.cjs`, `tests/phase7-prepared-turn.test.cjs` |
| Quest/campaign progress and exactly-once rewards | `tests/phase9-flow.test.cjs`, `tests/phase9-adoption-settlement.test.cjs` |
| Delayed consequence schedule, later trigger, and follow-up | `tests/phase9-closeout.test.cjs`, `tests/phase9-settlement-closure.test.cjs` |
| Roll reuse after narrator failure/restart | `tests/recovery.test.cjs` |
| Prepared-state reduction and exactly-once commit | `tests/phase7-prepared-turn.test.cjs` |
| Save-10 export/restore, forked history and frozen contracts | `tests/phase9-sqlite.test.cjs`, `tests/phase9-fork-save-history.test.cjs`, `tests/phase9-closeout.test.cjs` |

The fixture databases are in-memory synthetic test data. No private database, novel body, credential, real model request, or historical unknown request was read or used.

## CI and external evidence

The repository has `Core Verify` on every pull request and `Android Verify` for source/mobile changes. The connected GitHub commit-status query and workflow-run query returned no status rows or workflow runs attached to the current `main` checkpoint; no open Phase 9.5 PR exists at M0. This is **no attached CI evidence**, not a claim that an unobserved workflow passed or failed. The later PR’s CI must be checked after it exists.

## M0 findings and boundaries

- The stable resolution pipeline and state authority already exist. A modular rewrite or second campaign graph database is unsupported by the current source and not required by V2.0.
- Published methods carry eligibility and outcome effects, but do not yet declare enough policy to safely remove Planner from even one method family. See [`ACTION_CONTRACT_GAPS.md`](./ACTION_CONTRACT_GAPS.md).
- The current read projection of playable situations is a useful seed for M2; it does not itself produce ranked opportunities or define a second authoritative graph.
- M0 freezes the path and test evidence. It does not certify Android behavior, complete Phase 9, or claim parity for a local path that does not yet exist.
