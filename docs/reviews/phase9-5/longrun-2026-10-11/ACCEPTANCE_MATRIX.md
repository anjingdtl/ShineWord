# Phase 9.5 and affected Phase 9 acceptance

## 最新追加：精确副本生产链复验

| 子项 | 本轮结果 | 完整行状态 |
|---|---|---|
| BUG-95-001 正式新 revision / 采用 / 使用 | PASS — 精确旧拒绝输入、私有副本新 fork、进程内响应桩，经生产服务新建/采用 revision 并提交准备及消费者 | 真实模型与 Android NOT RUN，V95-09 仍保留 FAIL |
| BUG-95-009 新合法分支行动边界 | PASS — 精确 J1 v70 副本正式 fork，参与者载入，新失败行动正常提交，无 paused_system，原骰不继承 | Android NOT RUN；原 J1 freeze 保留，A28/G2 不转绿 |
| 事件无消费者内容修复指导 | PASS — 精确新发现拒绝点转成准备→正向条件消费者；严格 validator 保留 | A15/A36 的完整内容与独立玩家仍 FAIL |
| 工程 | 定向 33/33、core 1300/1300、mobile/typecheck/version/APK/diff PASS | 工程通过不能替代完整旅程 |

当前生产身份 c472f040b0744bae6edec171e6d4c42cae7609820308f88d13a49f1219115dad；APK 18881ec96e97f8e6c6ec5a0eb74cf9ed226c1ca41c4f8d08f30abab5fcf4e907，仅构建未安装。完整 A 矩阵仍 3 FAIL / 37 NOT RUN / 0 PASS。详情见 [定向复验追加](FOLLOWUP_VERIFICATION_2026-10-12.md)；后文为前次身份记录。

## 2026-10-12 修复身份补充

新源码 scope-v3 30d9ff5c0abbaf0bdd1e851d52d5cfa475b2c6f7b3f34aff658072984c84b7de；新 Debug APK ebf2a4aa38c16e6eb9d1ec5a7eea7c82aded733da6a111e5b4eb210e4f2ef4cc，仅构建未安装。完整证据见 [修复复验记录](REPAIR_VERIFICATION_2026-10-12.md)。下方完整验收结果继续保留，不把离线子用例转成整行 PASS。

| 范围 | 本次实际结果 | 完整验收状态 |
|---|---|---|
| 工程门禁 | verify:core 1298/1298、mobile typecheck、version、Debug build、diff check PASS | G0 工程层 PASS；不能证明玩家验收 |
| BUG-95-009 / V95-09 / A28 | 合法已采用参与者载入 + 四档角色预检；精确只读副本四档结算、原奖励及新 SQLite 选择/提交 PASS | Android 新合法分支同场景 NOT RUN；原冻结仍保留，V95-09/A28/G2 仍 FAIL |
| BUG-95-001 / V95-09 | 精确聚合错误可转成全部指引；延迟≥两段、required-main 硬依赖、匹配正向消费者的因果结构及反例 PASS | 正式新 revision 真实生成/采用/UI 使用 NOT RUN；供给故障仍 OPEN |
| A15/A36 | 方法级 ordinary-success 修复指导及普通成功准备/失败成本与可消费知识夹具 PASS | 真实完整旅程/独立玩家 NOT RUN，A15/A36 保留 FAIL |
| G1/G4、80 决定、save-10、10+10、独立玩家 | 本次没有长跑、端上或模型操作 | 原 NOT RUN/NOT COMPLETE 不变 |

完整 A01–A40 仍 **3 FAIL / 37 NOT RUN / 0 PASS**。工程 suite 中既有离线 100/300/1000 夹具不算当前端上 A40 验收。

**Cutoff:** 2026-10-12, after the user requested test work stop.
**Rule:** PASS applies only to the exact row contract with direct evidence. Historic Phase 9 PASS does not automatically transfer to this dirty source/APK identity. G/V95 and Phase 9 A01–A40 are separate matrices and their counts are not combined.

## G0–G4

| Gate | Result | Evidence and remaining condition |
|---|---|---|
| G0 — baseline, source, device and budget ready | PASS | Actual worktree, APK, device, provider profile fingerprint and private scoped 600-request authority recorded in BASELINE.md. The required scoped ledger was used; the retained app/data and private evidence boundary were respected. |
| G1 — safe L1 minimal vertical slice | NOT RUN | Narrow protocol/readiness and four-grade deterministic regressions passed; one real adopted method had Planner=0. The full G1 closeout and stable-use evidence are not complete. |
| G2 — opportunity projection and adversarial playability | FAIL | BUG-95-009 was reproduced: a visible stage-closing method successfully rolled, then actor-reference settlement failure froze J1 at v70. Current source preflight detects the same missing reward actor on the frozen snapshot, but final-APK live refusal/alternative-route replay was not run. Branch/merge causal-consumer acceptance is also incomplete. |
| G3 — local content generation feasibility (conditional M3) | N/A — NOT NEEDED | M3_DECISION.md keeps the experiment conditional. Existing stage-preparation regressions handled the observed structural gap; the real-play evidence did not establish repeated adopted-content exhaustion. No local-generation cost/quality experiment was started. |
| G4 — Android integration, recovery, quality and independent play | NOT RUN | APK was installed and player flows were exercised, but the final integration matrix, save-10 import/cold resume, 10+10 matched performance sample and independent player session are incomplete. |

## V95-01–V95-12

| ID | Result | Current evidence / gap |
|---|---|---|
| V95-01 | PASS | Main Session → runV2Turn → settlement/Narrator/atomic commit path is wired and the focused/full engineering suite passed. No second campaign progress authority was introduced. |
| V95-02 | PASS | LocalCompileReadiness requires explicit difficulty/evidence and validates visibility, permission, publication and bindings; missing legacy fields remain L2. Regression coverage is in the final recorded core run. |
| V95-03 | PASS | One real, normally generated/adopted Android method was selected. Both proxy and app ledger show Planner=0 and Narrator=1 for that turn. This is sample-specific; 83 Planner requests exist in the full scope for L2/background work. |
| V95-04 | PASS — deterministic | Same-rule L1/L2 parity coverage includes all four grades in deterministic production-path regressions. It is not a claim that every real story outcome or 80-action journey matched. |
| V95-05 | NOT RUN | The budget scope had no unknown/in-flight attempt, but the saved J1 turn is frozen after its roll. The full Android kill/restore/unknown/recovery/no-duplicate matrix was not run on the final APK. |
| V95-06 | PASS | Opportunity projection remains derived/read-only; targeted projection regressions and the J4B retained-artifact same-scenario UI replay passed. |
| V95-07 | NOT RUN | J4A/J4B branches exist, but a complete same-base fork → convergence → persistent different method/cost/condition chain was not independently scored under the final acceptance contract. |
| V95-08 | NOT RUN | No complete current-identity audit of canon time anchors, hidden facts and future-information leakage across all three intents. |
| V95-09 | FAIL | BUG-95-001 shows rejected follow-up content with no usable mainline route; BUG-95-009 shows an invalid closing route reaching post-roll settlement. A local event-consumer/readiness guard exists, but the failed branches were not fully replayed and accepted. |
| V95-10 | NOT RUN | This long-run identity has no save-10 export → Android system-picker import → cold-start → new player action acceptance. Older Phase 9 save evidence is reported separately and not carried over automatically. |
| V95-11 | N/A — NOT NEEDED | M3 was not started under the documented conditional gate; therefore no comparison or generation-cost claim is made. |
| V95-12 | NOT RUN | No independent participant completed the four-question playability interview. |

## Android player journeys

The five stored audit summaries report submissions and *candidate* meaningful decisions only:

| Journey | Saved state | Submitted turns | Audit candidates | Current judgment |
|---|---|---:|---:|---|
| J1 protection/rescue | main v70 | 54 | 31 | FAIL: turn-0071 is frozen after a successful roll due BUG-95-009; do not recover or alter it. |
| J2 investigation | main v39, failed ending | 33 | 16 | NOT RUN for 20-decision quota; preserve the natural ending. |
| J3 cooperation | main v15, completed ending | 11 | 6 | NOT RUN for 20-decision quota; preserve the natural ending. |
| J4A fork | v86 active | 70 | 37 | NOT RUN for 10 post-fork decisions; this audit includes inherited pre-fork turns. |
| J4B fork | v84 active | 68 | 36 | NOT RUN for 10 post-fork decisions; this audit includes inherited pre-fork turns. |

The candidate fields are not certified effective-decision counts. J4A/J4B contain inherited history, and turn IDs recur across branch/campaign namespaces. Therefore the branch totals cannot be added as unique player decisions. The contractual 80 decisions (J1/J2/J3 20 each and J4A/J4B 10 each) is NOT COMPLETE. A selected post-fix interval and per-intent six-dimension scorecards are also absent.

A short new story camp-mv51iswg-main reached v8. Its audit contains five submitted player turns and four candidate meaningful decisions; the fifth is a failed freeform action with no state/effect diff and is excluded. This does not replace the named journey quotas.

Two complete delayed-consequence chains with at least two effective decisions between scheduling and trigger, followed by real downstream consumption: NOT RUN. Queue entries, text-only events and counters are not accepted as consumption evidence.

## Affected Phase 9 A01–A40

The 2026-10-09 Phase 9 report historically recorded 29 PASS / 2 FAIL / 9 NOT RUN. That was a different source/APK identity. For this long-run branch, each row below describes the full row contract; current status is FAIL only where an unresolved failure is retained or directly reproduced, otherwise NOT RUN when the complete current-identity contract was not reaccepted. Narrow subcase evidence is noted but does not promote a full row.

| ID | Contract | Historical 2026-10-09 | Current identity |
|---|---|---|---|
| A01 | Same novel/start, distinct intent | PASS | NOT RUN — different goals were created, but full comparable route/quality contract not reaccepted. |
| A02 | Original/canonical and alternate start | NOT RUN | NOT RUN — full real start/canon qualification absent. |
| A03 | Partial ready and later-source dependencies | NOT RUN | NOT RUN — full late-source build/adopt/play chain absent. |
| A04 | Explicit goal and open exploration | PASS | NOT RUN — UI opening flow evidence is narrower than full row. |
| A05 | Future-plan death does not mutate history | PASS | NOT RUN — not reaccepted on final identity. |
| A06 | Save a canonically doomed character and keep them alive | NOT RUN | NOT RUN — no completed rescue/survival proof. |
| A07 | Invalid/truncated candidate repair | PASS | NOT RUN — plan-specific fixes passed; full recovery contract not reaccepted. |
| A08 | Stop before ready and recover placeholder | PASS | NOT RUN — final-identity cold recovery matrix absent. |
| A09 | Double start / transaction interruption | PASS | NOT RUN — no final-identity UI fault-injection replay. |
| A10 | Two paths and later consequences | NOT RUN | NOT RUN — branch-specific persistent convergence proof absent. |
| A11 | Clicked method and synonym free text | PASS | NOT RUN — one L1 method and freeform action exist, but paired equivalence not shown. |
| A12 | Reasonable template-external combination | NOT RUN | NOT RUN — no qualifying novel combination sample. |
| A13 | Invalid/offsite/stale references | PASS | NOT RUN — one stale visible selection was safely refused/refreshed; full row absent. |
| A14 | Four deterministic roll grades | PASS | NOT RUN — L1 parity subtests passed; full original Phase 9 contract not reaccepted. |
| A15 | No-risk/daily recovery/continuous failures | FAIL | FAIL — historical failure remains open; no current full replay cleared it. |
| A16 | changed/no_change closure | PASS | NOT RUN — no final-identity full settlement reacceptance. |
| A17 | Early resolution, bypass and rewards | PASS | NOT RUN — no current end-to-end bypass/reward replay. |
| A18 | Deviate, pause, change goal and resume | PASS | NOT RUN — no full current-identity scenario. |
| A19 | Two delayed duties/relationships used downstream | NOT RUN | NOT RUN — no two effective-delay consumer chains proven. |
| A20 | In-flight replan and fact change | PASS | NOT RUN — stale same-trigger retry was fixed/replayed narrowly; full row not reaccepted. |
| A21 | Trigger merge, background competition and failure | PASS | NOT RUN — current full lifecycle matrix not run. |
| A22 | Goal/order/rule/style identity | PASS | NOT RUN — current artifact-identity matrix not reaccepted. |
| A23 | Schema/archive and stage recovery | PASS | NOT RUN — current-identity export/restore matrix absent. |
| A24 | Corrupt frozen data | PASS | NOT RUN — current-identity corruption boundary not reaccepted. |
| A25 | Over-window materials and unknown capability | PASS | NOT RUN — full provider-capability matrix absent. |
| A26 | Per-request/task/total budget ledger | NOT RUN | NOT RUN — this run’s separate 600-request physical scope is fully accounted, but Phase 9’s independent ledger contract was not reaccepted. |
| A27 | reasoning-only, 429, network and unknown outcome | PASS | NOT RUN — no full final-identity network/unknown replay. |
| A28 | Roll, adoption, commit and lease interruption | PASS | FAIL — J1 turn-0071 persisted a successful roll then failed settlement before commit. Current pre-roll guard found the blocker offline, but final-APK live replay is absent. |
| A29 | Unverified response / unadopted repair | PASS | NOT RUN — no current failure/recovery boundary replay. |
| A30 | Delete/change intent/source while work is active | PASS | NOT RUN — current cancellation/fencing matrix absent. |
| A31 | Rewind/fork isolation | PASS | NOT RUN — J4 forks exist, but full current save/fork isolation contract was not checked. |
| A32 | Save/export/import/bad save | PASS | NOT RUN — no current Phase 9.5 save-10 round trip. |
| A33 | Hidden identity/aliases/logging | PASS | NOT RUN — no complete current-identity disclosure audit. |
| A34 | Stage/natural ending UI agreement | PASS | NOT RUN — J2/J3 ended naturally, but the full UI/state ending contract was not reaccepted. |
| A35 | Lifecycle, keyboard, small screen, theme and font | PASS | NOT RUN — no complete current-device lifecycle matrix. |
| A36 | Three-intent six-dimension quality | FAIL | FAIL — scorecards and independent player review are missing; the historical failure remains unresolved. |
| A37 | Turn/planning latency | NOT RUN | NOT RUN — no matched baseline-10 vs fix-10 sample. |
| A38 | Final source/APK/real evidence | NOT RUN | NOT RUN — build/install identity is known, but complete acceptance is incomplete. |
| A39 | Three isolated campaigns in one world | PASS | NOT RUN — complete current identity isolation audit absent. |
| A40 | Local accumulation at 100/300/1000 turns | PASS | NOT RUN — no current-identity production-path accumulation run. |

**Current full A01–A40 summary:** 3 FAIL / 37 NOT RUN / 0 PASS. This is not the historic Phase 9 29/2/9 result. A narrow engineering or UI subcase can be closed in BUGS_AND_FIXES.md without marking its entire A row PASS.
