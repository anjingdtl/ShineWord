# Test report — local deterministic engineering evidence

Baseline `1b460fb378614986a3896d487c78e6a180409764`; production/M5 test/lockfile checkpoint `4a1b169b7986a423656fa309f86e436eb2a05b87`. M6 adds reports and strengthens the existing parity assertion to compare the full GameStateSnapshot (11/11 affected tests pass; no test count change). Final delivery SHA and current-head CI URLs/results are recorded in the PR description and delivery response, without creating a self-referential report commit.

| Gate | Result | Evidence |
|---|---|---|
| Root clean install | PASS-LOCAL | npm ci --ignore-scripts --no-audit --no-fund |
| Baseline verify:core | PASS-ENGINEERING | 1334 tests, 1334 pass, 0 fail/skip/cancel; 141550.96534 ms |
| M1 routing parity | PASS-ENGINEERING | 20/20 local-compile + phase9-turns + baseline |
| M2 causality/settlement/replan | PASS-ENGINEERING | 60/60; three branches, two downstream consumers, multi-batch transitions, existing finite supply/asymmetric reward defenses |
| M3 Graph | PASS-ENGINEERING | 23/23 opportunity-projection + runtime-convergence + blocker-repair |
| M4 packet reuse | PASS-ENGINEERING | 53/53; prepared/guidance/budget regressions and 4→1 projection count |
| M5 new affected-path tests | PASS-ENGINEERING | 14/14 local-compile + runtime-convergence |
| M5 existing recovery/budget/save/privacy | PASS-ENGINEERING | 101/101; command below |
| Final npm run verify:core | PASS-ENGINEERING | 1342 tests, 1342 pass, 0 fail/skip/cancel; +8 tests; 159687.313553 ms |
| npm run verify:version | PASS-LOCAL | version=1.0.0 versionCode=1000000 (build 0) |
| Mobile ci | PASS-LOCAL after registry fix | 581 packages; postinstall patches ran; exactly 34 canonical URL substitutions, no version/integrity changes |
| npm --prefix mobile run typecheck | PASS-LOCAL | exit 0 after completed install |
| git diff --check | PASS-LOCAL | no whitespace errors |
| Local Android APK / AVD | NOT RUN | no SDK/Gradle/adb/AVD; JDK21 alone insufficient |
| Current-head Core Verify / Android Verify | External check | must inspect exact final SHA on PR; live results are in PR description, not inferred from local tests or old SHA |
| Independent author/human red-team | NOT RUN | second diff pass by implementing agent is documented separately |

## Reproduce

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run verify:core
npm run verify:version
npm --prefix mobile ci --no-audit --no-fund
npm --prefix mobile run typecheck
node --test tests/phase9-5-*.test.cjs tests/phase9-turns.test.cjs tests/phase9-replan.test.cjs tests/phase9-adoption-settlement.test.cjs tests/phase9-settlement-closure.test.cjs tests/phase9-plan-contract-guard.test.cjs tests/phase9-causality-validation.test.cjs tests/phase9-journey-audit.test.cjs
node --test tests/phase4-interaction-orchestrator.test.cjs tests/play-recovery.test.cjs tests/recovery-policy.test.cjs tests/phase6-ledger-races.test.cjs tests/phase9-ledger-integrity.test.cjs tests/phase9-budget-authority.test.cjs tests/phase9-planning-budget.test.cjs tests/phase9-fork-save-history.test.cjs tests/phase8-save9.test.cjs tests/phase7-save8.test.cjs tests/phase6-save-compatibility.test.cjs tests/phase9-anchor-fact-visibility.test.cjs tests/phase9-actor-identity.test.cjs tests/phase8-gaps.test.cjs
git diff --check
```

Stage-specific RED/GREEN commands, root causes and review conclusions: [ADVERSARIAL_CASES](ADVERSARIAL_CASES.md). Prior existing R0/R1/R2/R4 tests remain part of the full 1342 run. No existing assertion was changed or removed.

## Data identities / failure provenance

- Existing synthetic helper SHA-256 `5243163547419b5fdef7ab169069c568439ea50f368d83b87a1fc19bf36d5619`.
- Three-branch/recovery test SHA-256 `d92c2c0b9fd8a82482647b104e2c66e16eef6035a48e033623fe27c46582390a`.
- Each fixture compiles and adopts published synthetic campaign content into its own SQLite database; providers/RNG are local test controls. M2 successor preparation is an explicit fake campaign planning job, not a hidden extra player-turn request.
- M1 RED: exact text unexpectedly calls Planner; tap does not. M2 RED: permit qualification remains false despite discharged record, and two counters are undefined. M4 RED: projection count 4 !== 1. Saved diagnostic extracts and summary hashes are in TEST_RESULTS.json.
- First mobile installs received HTTP 403 from the mirror host, then were stopped; first typecheck on incomplete dependencies failed TS2307. After canonical registry substitution, install and typecheck succeeded. These failures are retained as environment evidence, not hidden as successful runs.
- Real paid/model HTTP calls=0; private ledger inspected=0; approved unknown replay=0; real player decisions=0; independent participants=0/4. A fake complete() invocation is not a real HTTP request, a billed model call or a gameplay PASS.
