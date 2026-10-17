# Adversarial register

Baseline `1b460fb378614986a3896d487c78e6a180409764`; new fixtures are synthetic, no private saves, model keys or novel data.

| Case | Pre-construction finding / intended evidence |
|---|---|
| A stale state/content/rule | existing local-compile/recovery binding tests; retain final preflight/CAS |
| B missing policies/evidence/IDs/GM | existing readiness and candidate guards; no defaults; extend input tests |
| C L1/L2/refused | RED exact free text dispatches Planner although tap skips; M1 |
| D text/tap/ambiguity | use existing punctuation normalization only; semantic paraphrase stays L2; ambiguous exact text must refuse |
| E four grades/Narrator | frozen outcomes/parity and prepared tests; Narrator only candidate text |
| F finite promise +10 vs +20 | existing plan-contract/causality validation; preserve one-time upper bound |
| G asymmetric promise/new closure | existing promise effect policy/local-compile tests; do not rewrite reducer |
| H orphan stage | existing lifecycle + replan tests; two identical reachability algorithms to share |
| I three-way join/two downstream consumers | coverage gap; add deterministic production settlement + eligibility proof |
| J double click/kill/replay | existing SQLite/journal/prepared fault tests; add affected exact-text recovery regression |
| K unknown | existing ledger race/recovery/budget suites; no paid calls or approval |
| L save/fork/GM/future | existing save8/9/10-compatible synthetic tests and anchor projection; real save-10 / Stage-1/8 BLOCKED-ASSET |
| M recover after refusal | existing guardTurn fail-if-no-durable-evidence; verify no permanent local lock |
| N unrelated functions | keep migrations/protocols/world build/source/style untouched; full core |
| O evidence inflation | synthetic decisions 0 real decisions, provider 0 real calls, participants 0/4 |

Independent human red-team/playtesting is not available here. M6 will perform a second diff-focused adversarial pass; it must not be labeled an independent participant review.

## M2 RED / root cause / GREEN

- Production defect RC02: `settleCampaignProgress` invoked `applySituationRuntime` for deferred transitions with the action's `method:<turnId>` key. The action had already stamped it, so consequence counters/promises were silently skipped and the consequence still discharged. Two consequence batches also collided with one another.
- RED: `node --test tests/phase9-5-runtime-convergence.test.cjs` before the fix: 0/2; permit route still unavailable and `permit_a` undefined despite discharged records. The correctly constructed fixture uses short synthetic authored content, real preparation candidate validation/adoption, then Session/SQLite commits. Initial fixture authoring mistakes (unsupported actor_condition candidate syntax, identical route effects, trying to replace inherited completion) were rejected by existing guards and corrected in the fixture; they are NOT production defects or RED evidence.
- Minimal fix: optional causal transition batch key; normal method key unchanged. Settlement supplies `consequence:<existing idempotencyKey>`, reusing the existing transition reducer and processedEventKeys. No new ledger or reducer; no historical repair of old discharged records.
- Three branches (`knowledge`, `permit`, `cost`) schedule pending consequences; the same authored `join` completes stage-1 and reaches the same active stage-2. Knowledge unlocks the manifest method; a deferred counter unlocks the permit method; the third branch loses 2 stamina and uses the manual route. Each illegal consumer is refused before provider dispatch, and each legal consumer commits stage-2 success. Assertions inspect state, event log and actual subsequent action, not Narrator prose.
- The schedule/trigger/effect/discharge event chain is asserted; replay neither dispatches nor changes state; two different transition batches both apply once. All action Planner fake-provider counts are 0. A separate fake planning job prepares the successor; it is explicitly NOT a real model request and is not hidden in ordinary turns.
- Reachability cleanup: removed duplicate replan `conditionPossibility`, using existing domain `conditionPossibilityForNodes`. Terminal/unknown/all/any/not and already-stranded behavior retained by lifecycle and replan suites.
- GREEN: `npm run build:core`; `node --test tests/phase9-5-runtime-convergence.test.cjs tests/phase9-5-consequence-lifecycle.test.cjs tests/phase9-5-local-compile.test.cjs tests/phase9-replan.test.cjs tests/phase9-adoption-settlement.test.cjs tests/phase9-settlement-closure.test.cjs tests/phase9-plan-contract-guard.test.cjs tests/phase9-causality-validation.test.cjs tests/phase9-journey-audit.test.cjs`: 60/60 pass, no skipped. Includes asymmetric once-only promises, finite supply, audit and old replan defenses.
- Diff review: action/roll hashes, module versions, schema, persistence and management commit boundaries unchanged. Compatibility limitation: previously discharged but skipped effects remain historical facts; do not replay them silently. Any remediation requires separate identity-bound review.
