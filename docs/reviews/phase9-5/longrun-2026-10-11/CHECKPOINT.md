# Stop checkpoint and repair handoff

## 最新：定向复验后安全检查点

- 源码 scope-v3 c472f040b0744bae6edec171e6d4c42cae7609820308f88d13a49f1219115dad；Debug APK 18881ec96e97f8e6c6ec5a0eb74cf9ed226c1ca41c4f8d08f30abab5fcf4e907，V1.0.0 / 1000000，仅构建未安装。
- 精确 BUG-95-001 输入在私有副本的正式新 fork 中完成严格新 revision 编译/采用及准备→消费者行动；精确 J1 v70 副本新 fork 完成参与者载入和新失败行动提交。原真实 J1/turn-0071 及其骰点未恢复，仍禁止点击恢复/重试。
- 新发现的事件无消费者诊断已补定点修复指导。定向 33/33、core 1300/1300、移动 typecheck、version、APK、diff PASS。
- 私有证据：test-logs/phase9-5-followup-2026-10-12/。exact-replan-a 是保留失败副本，exact-replan-c 是最终通过副本；不能把这些副本写回设备或原证据。
- 原 SQLite 文件、原预算文件哈希未变，真实请求 0，scope cap/spent/completed 仍 600/453/453。离线响应桩不计真实有效决定或真实 Planner=0 样本。
- adb devices 当前无连接设备。原 AVD 保留；只读启动命令被自动审批拒绝，未启动、安装或操作 Android UI。端上 NOT RUN；真实模型和独立玩家验收未开放。
- 没有 commit/push/merge/release、版本号更改或长跑重启。完整详情见 [定向复验追加](FOLLOWUP_VERIFICATION_2026-10-12.md)；下方为前次安全检查点。

## 2026-10-12 离线修复后检查点

- 世恒哥授权的源码修复及工程检查已完成。新源码 scope-v3 30d9ff5c0abbaf0bdd1e851d52d5cfa475b2c6f7b3f34aff658072984c84b7de；新本地 Debug APK ebf2a4aa38c16e6eb9d1ec5a7eea7c82aded733da6a111e5b4eb210e4f2ef4cc，V1.0.0 / 1000000，仅构建未安装。完整记录见 [修复复验记录](REPAIR_VERIFICATION_2026-10-12.md)。
- 最终 core 1298/1298、移动 typecheck、version、Debug build、diff check PASS；精确只读 J1 内存副本四档结算及原普通成功奖励 PASS。
- BUG-95-009 已补已采用参与者初始化来源及四档预检。BUG-95-001 已补聚合诊断拆分和定点消费者指导。A15/A36 的修复指导及固定玩法夹具通过；完整玩法/端上同场景仍未验收。
- 原 J1 v70/turn-0071、success 骰点、paused_system 保留，禁止恢复/重试/重掷。只读 SQLite 文件检查前后 SHA-256 相同。设备没有被操作、重装或改数据库，原最后 UI/存档仍以停测记录为准，没有重新读取实时 UI。
- 原真实预算 scope 600/453、453 completed、0 unknown/in-flight 保留；新增真实请求 0，未重置/改写账本。
- Android 新合法分支同场景、BUG-95-001 正式新 revision 采用/使用、独立玩家与完整矩阵：NOT RUN。继续这些事项需要另行授权；本次不恢复长跑。
- 没有 commit/push/merge/release/版本号改动；buildTime 自动生成变化已单列。既有修改和旧失败证据没有丢弃。

以下是修复前的停测检查点，作为历史边界保留。

**Updated:** 2026-10-12, Asia/Shanghai
**Reason:** 世恒哥要求结束测试，汇总报告并将阻滞点交由另一个 Agent 修复。

## Safe current state

- Worktree: F:/sw95, branch codex/phase9-5-emulator-longrun, HEAD 6710e3007fc73df16b9f647b62affd7336a0c37b.
- Current source fingerprint and Debug APK identity are in BASELINE.md.
- Emulator: emulator-5554, Android 17 / API 37, package com.shineword.app. Last UI: campaign list. The app remains installed with all data retained. Do not clear/uninstall or overwrite its database.
- One scoped budget only: F:/sw95/test-logs/phase9-5-longrun-2026-10-11/budget-manifest.json. Scope shineword-phase9-5-20261011, cap 600, spent 453, completed 453, unknown 0, in-flight 0. No provider request is pending. The unused 147 are not authorization to resume this test after the user's stop.
- Latest new playable story branch camp-mv51iswg-main is saved at v8 and remains active. The UI was returned to campaign list to preserve the screen state. Do not submit another action unless the user later resumes play-testing.
- No commit, push, merge, release, version bump or shutdown has occurred.

## Journey state

| Journey | Branch / saved head | State at stop |
|---|---|---|
| J1 protection/rescue | camp-mv3mw9hk-main / v70 | Active stage 6. turn-0071 is frozen and uncommitted after a successful roll; journal paused_system. Preserve exact contract and roll. Do not tap recovery, retry, reroll, or mutate this branch. |
| J2 investigation | camp-mv3khpat-main / v39 | Naturally ended in failed campaign state. Preserve ending; do not extend the same story to hit a quota. |
| J3 cooperation | camp-mv3iwgv7-main / v15 | Naturally completed. Preserve ending. |
| J4A branch | camp-mv3mw9hk-bmv4g8y2p / v86 | Active. |
| J4B branch | camp-mv3mw9hk-bmv4g9u9a / v84 | Active. |
| Latest short new story | camp-mv51iswg-main / v8 | Active and saved; five submitted player turns, four audit candidates, one failure without state/effect change (excluded). |

## Confirmed evidence and remaining blocker

1. BUG-95-003 through BUG-95-008 have code or same-scenario closure evidence as summarized in BUGS_AND_FIXES.md. The status is scoped to each reproduced path, not full campaign acceptance.
2. BUG-95-009 remains the principal hard blocker. The historical J1 branch has a persisted successful roll and an uncommitted turn. Current source preflight detects the unavailable reward actor against that exact read-only snapshot and refuses the route before roll. An Android replay on the final APK was not run; the legacy turn stays frozen.
3. BUG-95-001 manual replan failure remains open for same-scenario replay.
4. Historical Phase 9 A15 and A36 failures remain unresolved; this task did not reaccept them. The one no-effect failure in the v8 audit is an observation, not a confirmed repeated softlock.
5. Longrun 80 effective decisions, full causal-consumer proof, export/import/cold-resume, stable 20-action window, exact 10+10 performance comparison and independent human test remain incomplete.

## Evidence roots

- Private, ignored evidence: F:/sw95/test-logs/phase9-5-longrun-2026-10-11/
- Public report package: F:/sw95/docs/reviews/phase9-5/longrun-2026-10-11/
- Frozen J1 read-only snapshot: F:/sw95/test-logs/phase9-5-longrun-2026-10-11/device-db-after-j1-petition-tap-check-5554.sqlite
- Latest v8 branch snapshot and sanitized audit: F:/sw95/test-logs/phase9-5-longrun-2026-10-11/install-check/phase95-after-new-campaign-action5-20261012.db and phase95-after-new-campaign-action5-audit.json
- Per-journey sanitized audits: F:/sw95/test-logs/phase9-5-longrun-2026-10-11/install-check/current-audit-J1.json, current-audit-J2.json, current-audit-J3.json, current-audit-J4A.json, current-audit-J4B.json
- Budget manifest: F:/sw95/test-logs/phase9-5-longrun-2026-10-11/budget-manifest.json

## Repair handoff order

1. Preserve J1 v70 / turn-0071 / original success roll. Do not try recovery. Verify the current reward-actor preflight on exact frozen inputs offline; then prove a safe refusal and alternate choice using a new branch and the final APK.
2. Reproduce BUG-95-001 on an immutable copy of its rejected replan input. Improve candidate-specific structural repair without loosening causal validation; verify a new adopted plan and actual player opportunity.
3. Examine A15's historical repeated-big-success gating and daily/failure alternatives before declaring normal play stable. Do not improve dice odds to force content.
4. Treat the v8 no-effect failure as triage evidence only until it repeats or produces a clear player-facing blocker.
5. Only after user authorizes resumed testing, continue the unfinished G/V95/Phase 9 rows with the same source identity discipline and any approved budget. The 453/600 scope must never be reset or silently reused for another run.
6. Do not claim 9.5/Phase 9 complete until the acceptance matrix is closed; independent player A36/V95-12 must be performed by a real participant.

## Test stop record

There were no test, build, install, emulator or provider operations after the user's stop request. This checkpoint and the report files are documentation-only changes.
