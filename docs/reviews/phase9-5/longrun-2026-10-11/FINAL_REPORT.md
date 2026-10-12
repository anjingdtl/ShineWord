# Phase 9.5 long-run final report

## 最新定向复验 — 2026-10-12

已继续直接验证：精确旧候选在私有副本中新建分支，通过生产服务建立并采用正式新 revision，准备行动及独立消费者实际提交。另发现问路方法成功只有无消费者事件，补了具体修复指导；新内容保留真实行动范围，不提前关闭阶段或伪造远期目标完成。严格 validator 未放宽。

精确 J1 v70 在副本中正式分叉后，原路线完成参与者载入及新行动提交，不再因角色缺失冻结。该夹具结果为 failure，正常按规则提交；没有恢复原 turn-0071 或使用其骰点。原数据库文件及副本内旧候选/计划/工件/快照/回合/骰点逐值保留。

定向 33/33、core 1300/1300、移动类型、版本、Debug build、diff PASS；真实请求 0，原预算仍 453/600。当前源码 scope-v3 c472f040b0744bae6edec171e6d4c42cae7609820308f88d13a49f1219115dad，APK 18881ec96e97f8e6c6ec5a0eb74cf9ed226c1ca41c4f8d08f30abab5fcf4e907，仅构建未安装。

Android 只读模拟器启动被自动审批拒绝，端上 NOT RUN。真实模型能否遵循新指导、A15/A36 完整玩法、独立玩家与其余完整验收仍未证明，不宣布阻滞全清除。详情见 [定向复验追加](FOLLOWUP_VERIFICATION_2026-10-12.md)；以下保留前次修复和停测报告。

## Repair addendum — 2026-10-12

最新源码修复了 BUG-95-009 的参与者初始化遗漏：已采用局面的合法参与者在新行动边界载入，四档方法效果及收尾奖励在投骰前检查。精确 J1 只读输入的内存副本四档结算通过，普通成功保留原奖励；新 SQLite 战役的选择→载入→提交通过。原 J1 v70/turn-0071、成功骰点及 paused_system 没有被恢复或改写。

BUG-95-001 的三项因果诊断实际被聚合成一个字符串，定点修复正则没有命中。已拆分诊断并补充 trigger 改动后重新定位下游消费者的要求，严格校验保持；精确候选指引和离线因果正反例通过。快照中的该候选绑定 J3 v3，旧 J2 归属叙述保留但不作为此次修复依据。

普通成功/关闭前可达性诊断现有可执行的方法级修复说明；固定内容回归证明普通成功准备及带代价的失败线索被不同后续方法真实消费。A15/A36 历史玩法和独立玩家验收仍 FAIL。

最终 verify:core 1298/1298、移动 typecheck、version、Debug 构建及 diff check PASS。新源码 scope-v3 30d9ff5c0abbaf0bdd1e851d52d5cfa475b2c6f7b3f34aff658072984c84b7de；新 APK ebf2a4aa38c16e6eb9d1ec5a7eea7c82aded733da6a111e5b4eb210e4f2ef4cc，仅构建、未安装。真实请求/Android 操作均为零。

端上新合法分支同场景、BUG-95-001 正式新 revision 生成/采用/使用：NOT RUN。代码及工程证据不等于所有阻滞已清除；完整 A 矩阵仍 3 FAIL / 37 NOT RUN / 0 PASS，G2 FAIL/G4 NOT RUN 保留。详细命令、文件、身份和风险见 [修复复验记录](REPAIR_VERIFICATION_2026-10-12.md)。以下为用户停测时点的保留报告，不将旧工程/APK 身份改写成本次身份。

**Report date:** 2026-10-12 (Asia/Shanghai)
**Disposition:** Testing stopped at the user's request. Evidence review and documentation are complete; product acceptance is not complete.

## Answer to the playability question

Yes. There is one confirmed hard blocker, one unresolved plan-supply blocker, and multiple acceptance gaps that still prevent calling the app normally playable end to end.

The most severe confirmed blocker is BUG-95-009. In J1 at committed v70, the player selected a visible stage-closing method and rolled successfully. Settlement then could not resolve a relationship/reward actor referenced by the closing node. The state remained v70; turn-0071 stayed frozen and uncommitted with the successful roll retained. A usable session cannot safely continue from that route. Current source now checks branch-bound completion reward actors before dispatch and returns campaign_completion_reward_actor_unavailable for that exact frozen snapshot, but the final APK was not replayed in a new branch to prove the action is refused and a safe alternative remains. Treat it as open.

BUG-95-001 is also open for revalidation: the earlier manual follow-up plan after an investigation success was rejected because required delayed consequences were too early and had no downstream consumer. A newer structural repair helped a separate opening flow, but the failed replan scenario itself was not replayed.

A one-off failed freeform action in the saved v8 story committed without a state/effect change. It was excluded from the decision audit. This is a useful quality signal, not enough evidence to call it a persistent softlock or invent a root cause.

## What the long run established

- One 600-request scope was enforced. It spent 453 physical requests; all 453 completed, with no unknown or in-flight attempt. This is not 453 player decisions.
- Five branch audits list 236 submitted turns and 126 branch-level candidate meaningful decisions. The candidates overlap through forked history and are not individually certified under the effective-decision rule. The 80-decision goal is NOT COMPLETE.
- A real GLM-generated/adopted Android method was selected and committed with Planner=0 for that turn. The product remains mixed L1/L2/background: this scope contains 83 Planner requests.
- The exact-scene-evidence opening-plan bug, duplicate delayed-trigger/no-consumer opening plan, stale preparation retry suppression, and planId-based hidden active route were each repaired at code/test level; the latter two have same-scenario replay evidence. The Windows scoped-budget lock contention bug was also repaired and tested.
- A stale guidance selection was safely rejected before dispatch, then a refreshed visible choice succeeded.
- The user data and old story histories were preserved. The J1 frozen roll and J2/J3 endings were not rewritten.

## Test and acceptance status

Last recorded engineering gate on this identity: verify:core 1293/1293, mobile typecheck, version verification, Debug APK build and git diff check all passed. They were not rerun during this report-only phase.

Phase 9.5 gates: G0 PASS; G1 NOT RUN as a complete gate; G2 FAIL; G3 NOT NEEDED under the recorded conditional decision; G4 NOT RUN. V95-specific results and gaps are in ACCEPTANCE_MATRIX.md and L1_PARITY_AND_DISPATCH.md.

Current full Phase 9 A01–A40 matrix is 3 FAIL / 37 NOT RUN / 0 PASS for this report's strict current-identity reacceptance. A15 and A36 remain unresolved prior failures; A28 is the current long-run settlement freeze. This is separate from the historical 2026-10-09 report of 29 PASS / 2 FAIL / 9 NOT RUN. The historical counts are not reused as current passes.

The following acceptance requirements remain incomplete: 80 certified effective UI decisions and required per-journey quotas; two delayed consequence chains actually consumed downstream; three six-dimension story scorecards; independent human test V95-12/A36; current-identity save-10 export/import/cold-resume; matched performance 10+10; local 100/300/1000 growth; full recovery/lifecycle/Phase 9 reacceptance.

## Root-cause repair handoff

Priority for the next repair Agent:

1. BUG-95-009: retain J1 v70 and turn-0071 untouched. Verify all completion reward actor references before rolling; add a deterministic rejection regression; then use a new branch and final APK to prove the invalid route is locally hidden/rejected and a playable alternative is offered. Do not claim the old turn recovered.
2. BUG-95-001: make replan repair guidance actionable for the exact delay/consumer errors, without weakening causal validation. Generate a new revision, adopt it, and use its opportunity.
3. Reassess A15 no-risk/daily/continuous-failure behavior; its historic failure remains open until the same player-facing loop has a valid recovery route.
4. Triage the v8 no-effect failure if it repeats; do not treat this single sample as an established universal bug.
5. Resume remaining L1 stability, two-branch causal use, save/import, performance and independent-player criteria only if the user later resumes testing.

The detailed reproduction, root-cause path, current source guard and evidence roots are in BUGS_AND_FIXES.md. The safe stop state and immutable objects are in CHECKPOINT.md. Private databases, screenshots, UI dumps, source novel, prompts, model responses and credentials remain out of this report.

## Deliverables

- BASELINE.md — source/APK/device/budget identity and report cutoff.
- ACCEPTANCE_MATRIX.md — separate G/V95 and Phase 9 matrices.
- PLAYER_JOURNEYS.md — branch states, decision-count caveats and evidence paths.
- BUGS_AND_FIXES.md — reproduction and root causes for confirmed blockers.
- L1_PROTOCOL.md and L1_PARITY_AND_DISPATCH.md — protocol, compatibility and dispatch evidence.
- BUDGET_AND_PERFORMANCE.md — physical request ledger and unavailable performance claims.
- DEVICE_SAVE_RECOVERY.md — package/data state and recovery boundary.
- CHECKPOINT.md — preserved handoff state.

No product code or tests were changed/run during documentation. No commit, push, merge or release was made.

## Carryover playability root cause

The unresolved A15/A36 risk is content-level as well as an acceptance gap. Prior Phase 9 evidence found generic opening Methods with no authoritative effects, and other generated stages whose normal success only incremented an unconsumed counter while completion was gated on full_success. These shapes can make turns narratively busy without giving the player a new usable fact or route. A later sample must prove ordinary-success progression, a meaningful failure alternative and real downstream use; dice manipulation and counter-only version growth do not count. The exact historical diagnosis is documented in BUGS_AND_FIXES.md. This previous-code evidence remains a warning and retained FAIL, not proof that every current story repeats it.
