# Phase 9 实施进度（P9-0–P9-7）

| 更新 | 2026-10-06（Asia/Shanghai） |
|---|---|
| 基线 | `main@5f49a7d` + 本轮工作树（P9 各包提交前以 HEAD+工作树内容为身份） |
| 方案 | `docs/Shine-TRPG_PHASE9_CONSTRUCTION_PLAN.md` v1.0 |

## 状态总览

| 施工包 | 状态 | 交付 |
|---|---|---|
| P9-0 基线 | ✅ 完成 | BASELINE.md / PROTOCOL_BASELINE.md / `.tmp/phase9/test-manifest.json`（400 请求预算）；基线 922 测试全绿 |
| P9-1 域层 | ✅ 完成 | `src/domain/campaignPlan/`（types/planValidation/progressReducer/campaignEffects）；条件 4 新叶子；`MethodTemplateV1.outcomeTemplates` 四档模板；核心 0.4.0 / 合同 3.0 升级；`tests/phase9-domain.test.cjs` 13 用例 |
| P9-2 SQLite | ✅ 完成 | 基线 101（5 张战役表）；`SqliteCampaignPlanStore`（setup/job lease+fence+单飞/candidate/revision/artifact）；快照携带 campaignRuntime/campaignContentBinding；save-10 往返；`tests/phase9-sqlite.test.cjs` 6 用例 |
| P9-3 规划 | ✅ 完成 | requestKind `campaign_plan` 四处注册；`candidateModel`（严格解析）/`localCompile`/`generationService`（2 物理上限+一次修复）/`planningService`（冻结+恢复点）/`adoption`（幂等原子采用）/`contentResolver`（统一合成）；`tests/phase9-planning.test.cjs` 3 用例 |
| P9-4 回合消费 | ✅ 完成 | candidateRef/methodId 稳定绑定（点选+同义自由输入）；`contract.campaignEffects` 四档冻结；`methodOpsForContract` 模板化；`applyCampaignSettlement`（知识/关系/延迟后果+进度+奖励同一提交）；开局采用即激活首阶段局面；`tests/phase9-turns.test.cjs` 3 用例 |
| P9-5 重规划 | ✅ 完成 | `replanService`（本地触发矩阵、单飞合并、稳定边界 CAS 采用、管理提交）；fork 重绑 runtime.branchId；`changeCampaignGoal`/`getCampaignProgress` 会话 API；`tests/phase9-replan.test.cjs` 4 用例 |
| P9-6 UI | ✅ 完成 | `mobile/src/campaignPlanning.ts`（同一生产服务）；OpeningScreen 两段式开始（真实阶段→提案卡→开始冒险）；`CampaignProgressCard`；移动端 typecheck 通过 |
| P9-7 真实测试 | 🔄 进行中 | 见下 |

测试计数：922（基线）→ 951（P9-1..P9-5 后全绿）。

## 关键实现决策（与方案的差异都已在 PROTOCOL_BASELINE.md ADR 登记）

1. **ActionContract 3.0**：`candidateRef` + `methodRef.outcomeSetHash` + `campaignEffects`（每档 transitions/knowledgeGrants/relationshipShifts/scheduledConsequences，投骰前冻结）。
2. **四档结果执行链**：模板效果经 `compileCampaignEffects` 拆为 EffectOperation（进 outcome.effects）+ 局面迁移（`methodOpsForContract`）+ 引擎授予（`applyCampaignSettlement` 同步归约内应用），全部落在 prepare→commit 单次归约。
3. **进度求值位置**：`prepareResolution` 的 `applyAuthoritativeState` 内同步执行（预载计划/工件/事件史），保证不变量 4（同一提交包含状态、局面、主线进度、后果、奖励、事件）。
4. **开局即激活**：`createCampaign` 采用路径先 tick 战役局面再跑采用期进度求值，首个回合即可看到并选择主线办法。
5. **重规划采用**是管理提交（`{branch}:manage-replan:{n}` 管理回合 + `campaign_plan_adopted` 事件 + branches.state_version CAS）。

## P9-7 真实测试结论（2026-10-06 收口）

- 真实旅程 **90 个有效玩家决策**（smoke 10 + J1 20 + J2 20 + J3 20 + J4 10+10），预算 313/400；两次条件驱动自然结局（J3 pyrrhic turn-0017 / J1 failure turn-0002）。详见 REAL_JOURNEYS.md。
- 设备走查（emulator-5556, API 37, V1.0.0）：导入→审查→构建→开局两段式→提案卡→采用→主线卡→真实回合→冷启动恢复，全链路截图 `.tmp/phase9/device-01…26`。设备决策 2 个（时长止损，完整 20+10 重放列入复跑条件）。
- 门禁终值：verify:core **951/951**、mobile typecheck 0 错、verify:version `1.0.0/1000000`、apk:debug EXIT=0（V1.0.0 APK SHA-256 `2FF199…12DC9`）、git diff --check 干净。
- 验收：**PASS 30 / PART 7 / NOT RUN 1 / FAIL 0**（ACCEPTANCE_MATRIX.md）。真实 GLM replan 候选往返为最大遗留（严格门禁 fail-closed 正确）。

## 已知限制（如实）

- P9-5 的 replan LLM 候选生成（`runReplanJob`）已实现并有本地治理，但真实 GLM replan 往返在 P9-7 旅程中验证。
- rest/train 等本地生命周期提交暂不跑战役进度求值（诚实 no_change；playTurn 全链路已覆盖）。
- UI 的跨重启提案恢复（`findReadyProposalForWorld`）已提供但未接入向导（本轮以重新生成为主路径）。
