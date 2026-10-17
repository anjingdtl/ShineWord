# U01–U09 uniqueness audit

Scope: audited baseline `1b460fb` and production delta M1 `e47644d`, M2 `97257c2`, M4 `eec0613`; existing tests are local synthetic engineering evidence. No claim that every old store method is writer-isolated. [Authority map](AUTHORITY_MAP.md), [adversarial cases](ADVERSARIAL_CASES.md), [test report](TEST_REPORT.md).

| Constraint | Result | Evidence / retained boundary |
|---|---|---|
| U01 one authoritative snapshot | PASS-ENGINEERING | no state/store/schema added; all new facts land in existing situations/campaignRuntime and one atomic snapshot |
| U02 one action contract | PASS-ENGINEERING | shared player selection → same four-state readiness → compileProposal → ActionContract; no fake difficulty/evidence; legacy and planner_required tests retained |
| U03 one rules/reward/effect meaning | PASS-ENGINEERING | same reduceTurnResolution/settleCampaignProgress; removed duplicated node-condition semantics; repaired batch identity so real deferred transitions execute once |
| U04 one commit fact boundary | PASS-ENGINEERING | no commit/store changes; packet reuse cannot trigger reduction; injected outbox abort rolls all effects/events back; recovery reuses exact contract and candidate |
| U05 one request identity | PASS-ENGINEERING (delta) | no provider/ledger/budget changes; local input can avoid dispatch; unknown/refusal/budget tests pass; historical private ledger not inspected |
| U06 Graph from bound facts | PASS-ENGINEERING | original read-only projection preserved; stale/private/three-branch eligibility regressions; packet reused only within prepared call, no persisted Graph cache |
| U07 original recovery identity | PASS-ENGINEERING / BLOCKED-ASSET | no hash/roll/save rewrite; current synthetic old-save/fork/bad-dependency suites; historical save-10/Stage-1/8 assets absent; old discharged effects not retroactively replayed |
| U08 one production path | PASS-ENGINEERING | no new TurnKernel/files; CampaignSession → runV2Turn remains; legacy deterministic/management/encounter operations retain their existing legal boundaries |
| U09 manifests are not isolation | PASS-ENGINEERING | all eight manifests, versions/order/schema/hash inputs untouched; four groups document responsibilities only |

## Two review rounds before implementation

M0 first mapped writers, request origins and transactional/frozen boundaries. Second review reproduced exact-text Planner dispatch and marked three-way consequence consumption as a coverage gap. That new causal test discovered the real dropped-transition defect. Existing correct settlement/recovery functions were reused; Graph wrapper proposal was discarded for adding indirection without measurable benefit.

## Final second-pass adversarial review

Reviewed every changed production hunk against old frozen recovery, current content/rule/version drift, ambiguous exact methods, untrusted Planner refs, automatic actions, Narrator packet shedding, same-turn multi-consequence transitions, transaction abort, retries and old discharged rows. Preserved checks on both sides of async work; no removal of CAS/fence/budget/unknown guards; no test expectation weakened. Risks and evidence limits are recorded in UNRESOLVED.

This is a second pass by the implementing agent. Independent external reviewer / four-person gameplay review: NOT RUN; do not relabel this audit as independent participant approval.
