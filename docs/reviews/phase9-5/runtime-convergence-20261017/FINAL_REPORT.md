# Phase 9.5 runtime convergence delivery

Engineering result: PASS-ENGINEERING for the scoped changes and local regression gates. Phase 9.5 complete acceptance: PARTIAL; independent review, real-material L1, historical assets and device/gameplay gates remain open.

- Fresh origin/main baseline: `1b460fb378614986a3896d487c78e6a180409764`.
- Branch: `codex/phase95-runtime-convergence-20261017`; code/test head: `4a1b169b7986a423656fa309f86e436eb2a05b87`. M6 report commit is discoverable with `git log -1` / final delivery response. Feature branch only; no force-push, main commit, release or automatic merge.
- PR URL, final branch SHA and exact-head Core/Android CI results are provided in the PR description and final delivery response. Reports are a pre-CI artifact snapshot; no stale success is used as final-head proof.

## Delivered changes

1. Session and compiler share exact player method selection. Fixed-policy text reaches the same L1 readiness as taps; refused input stays refused, legacy_l2/planner_required retain Planner. Arbitrary paraphrase remains constrained L2. Serialized contracts, rolls, events and state match in the nontrivial synthetic skill/evidence fixture.
2. Fixed a real settlement bug: action and deferred transition batches collided on `method:<turnId>`, skipping effects but discharging obligations. Consequences now use their existing idempotency identity in the same transition reducer. Three routes converge at stage-2 and two actual next-turn consumers change eligibility; two consequences in one turn both apply once.
3. Replan now reuses lifecycle node-condition reachability, eliminating the duplicate implementation. Graph remains read only; a proposed shallow aggregation wrapper was discarded.
4. Prepared public packet is built once and reused by Narrator and final guidance. Same-state Graph calls 4→1 and packet builds 2→1. Session -31 lines; total production source net -34; no new production file, runtime, store, reducer, schema or request ledger.
5. Added transaction-abort/recovery and state/content/plan/rule drift proofs. Mobile lock has 34 canonical download-host substitutions; every package version/integrity stays identical.

## Validation / review

Core baseline 1334/1334; final Core 1342/1342; version consistency and mobile TypeScript PASS; targeted recovery/budget/save/privacy 101/101. RED/GREEN for routing, dropped consequence effects and repeated projections are retained. No test weakened. Initial mirror-dependent install and incomplete-dependency typecheck failures are recorded, followed by successful canonical install/typecheck.

Two pre-construction reviews mapped authorities and adversarial gaps. A final second-pass diff review checked every production hunk against snapshot/contract/transaction/ledger/recovery invariants U01–U09. This review is by the implementing agent, not an independent author. External independent adversarial review and four-person gameplay testing remain NOT RUN.

Real provider calls=0; no budget scope/cap/cost authorization; no private keys, novel or saves read. Real decisions=0; testers=0/4. Real authored-material eligible L1 count is not established. No Android SDK/Gradle/adb/AVD here; APK build must come from current PR CI, device interaction remains NOT RUN. No old APK evidence reused.

## Evidence and next actions

- [BEFORE_AFTER](BEFORE_AFTER.md): diagrams, measured reductions, module groups and writer delta.
- [AUTHORITY_MAP](AUTHORITY_MAP.md), [UNIQUENESS_AUDIT](UNIQUENESS_AUDIT.md): authority, request and transaction boundaries.
- [ADVERSARIAL_CASES](ADVERSARIAL_CASES.md), [TEST_REPORT](TEST_REPORT.md), [TEST_RESULTS](TEST_RESULTS.json): reproducible cases, commands and scoped evidence.
- [ACCEPTANCE_DELTA](ACCEPTANCE_DELTA.md), [UNRESOLVED](UNRESOLVED.md): G1/G2/R3/R5 delta and remaining gates.

Next minimum safe work: independent reviewer inspects this PR; content QA supplies a legitimate identity-bound fixed-policy L1 sample and historical assets for offline replay; device QA runs exact-PR APK on an isolated AVD. Historical skipped-but-discharged consequences need separate evidence-based remediation review, never silent compensation. Real model/ledger testing waits for a new explicit budget and authorized material.

## Node commits

```
4a1b169b7986a423656fa309f86e436eb2a05b87 test(runtime): M5 verify rollback recovery and portable mobile dependencies
eec0613c920f90d44cc6577b76dd76a70fb5a699 refactor(runtime): M4 reuse the prepared public packet through final guidance
6f02d20ec2f8f874802e0674784593970a6340bf test(graph): M3 verify stale and private opportunity projection boundaries
97257c2a6279456a6d88d5620298bc261b5d0874 fix(settlement): M2 isolate deferred transition identities and prove causal joins
e47644dfb6890a6ba47644021a90e848c260ebda fix(runtime): M1 route exact method input through shared L1 readiness
16f24cd261f00c3ff8dcbfc9f2ab74699b74d6b8 docs(phase95): M0 freeze runtime authority and adversarial baseline
```
