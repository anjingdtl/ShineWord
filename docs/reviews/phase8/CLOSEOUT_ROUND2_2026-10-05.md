# Phase 8 收尾轮（Round 2）复检报告

| 项目 | 内容 |
|---|---|
| 日期 | 2026-10-05（Asia/Shanghai） |
| 基线 | `main@501bf20` 工作副本（本报告提交前 HEAD；本轮改动见文末） |
| 依据 | `docs/Shine-TRPG_PHASE8_CONSTRUCTION_PLAN.md`（§20–25）、`VERIFICATION_2026-10-05.md`（缺口来源） |
| 范围 | 补齐上一轮独立复验遗留的 5 项 NOT RUN（A05/A09/A11/A30/A36）+ 3 处文档时间线校准 + 全门禁复跑 |
| 新增测试 | `tests/phase8-closeout-round2.test.cjs`（6 用例） |
| 结论 | **PASS 36 / NOT RUN 0 / FAIL 0**（以 `ACCEPTANCE_MATRIX.md` 逐项为准） |

## 1. 逐项 NOT RUN → PASS

### A05 对抗泄漏样本（GM 秘密 / 隐藏别名 / 原著未来）

- 证据：`tests/phase8-closeout-round2.test.cjs`
  - `A05: the permission projection refuses GM secrets, hidden aliases and original-work future content`
  - `A05: no adversarial marker reaches the Planner/Narrator wire; the public control does`
- 夹具三类非公开资料：gm 可见性 lore（GM 秘密）、discoverable 未发现的别名条目（隐藏别名）、`revealAt='5'` 未来事实门控的公开 lore（原著未来）；公开 lore 为正对照。
- 断言：
  1. 权限投影 `projectPlayerEntriesAtAnchor(entries, facts, anchor=1, discovered=∅)` 拒绝 gm / 未发现 discoverable / 未来三类，并剥离公开场景内嵌的私有 `actors`/`visibleItems`/`clues` id 引用；发现集合放行后可正控。
  2. 生产 `CampaignSession.playTurn` 回合中，Planner/Narrator 实际 wire 与冻结的玩家投影（`executionMaterials.entries`）逐字段复核：三类 marker 零出现，公开 marker 出现。
- **设计注记（如实记录）**：冻结根另存本地权威投影 `authoritativeEntries`（供恢复期本地解析隐藏线索/任务引用，见 `session.ts:2185-2188` 注释「永远不传给 planner」）。该视图属本地权威、非模型面向，A05 只约束进入模型的材料；已由上文 wire 断言独立验证无泄漏。

### A09 Narrator + Prepared + repair 组合超窗

- 证据：`tests/phase8-closeout-round2.test.cjs`
  - `A09: Narrator + Prepared packet stacked over the envelope sheds from the same frozen pool and the dispatched wire fits`
  - `A09: when Narrator + repair still overflows, the repair is not dispatched (zero HTTP)`
- 走生产 `runV2Turn`：超声明窗口时可选 `situationPacket` 从同一冻结池裁撤，实际派发 wire 经 `verifyFinalWireRequest` 复核不超窗（narrator 恰 1 次派发）；叠加 repair 后仍不可行时抛 `BudgetInfeasibleError('final_wire_exceeded')` 且修复请求**零发送**（narrator 仍 1 次 HTTP），对齐 A08 fail-closed。

### A11 冻结后不漂移

- 证据：`tests/phase8-closeout-round2.test.cjs` `A11: a frozen turn bundle keeps its content hash across later memory and settings changes and cannot be replaced`
- 冻结后再写入故事记忆状态并改动设置（`UPDATE campaigns`），冻结根 `contentHash` 与载荷逐字节不变、重算一致；以不同载荷覆盖同 root 被 `hash_mismatch` 拒绝，同载荷写入幂等 → 恢复始终使用原冻结材料。

### A30 确定性重放

- 证据：`tests/phase8-closeout-round2.test.cjs` `A30: identical binding + state + action + roll produce a byte-identical Prepared resolution and commit exactly once`
- 相同 ruleBinding + 状态 + 行动 + roll：`compileProposal` 合同、`resolveRoll` 骰点、`prepareTurnResolution` 归约（nextState / committedTurn / 领域事件 / 生命事件）canonical 逐字节相同；二次 `commitPreparedTurn` 为 replay，`turns` 与 `branch_events` 计数不增（结果仅提交一次）。

### A36 设备端“故障后”横幅与恢复入口（真实设备走查）

- 设备：emulator-5554，AVD `ShineWord_P8_Reacceptance`，API 37（Android 17）；安装本轮 Debug APK（SHA-256 `3a22dd4ca06bb79e93e6072e595c1a69b1eae3853bdec3c86c32f8bf7ff633f6`）。
- 复现路径（详见 `ACCEPTANCE_MATRIX.md` 的“A36 设备走查方法”）：全新安装 → 真实 GLM 端点配置 profile（密钥仅注入、不落日志）→ 强停 → 经 `run-as cp` 置入内置“故障后”状态的运行时夹具库 → 重启 → 书库 → 战役 → 打开战役 `novel-copy`（分支 `novel-copy-main`）→ 游玩 → 游戏菜单 → 游戏信息面板。
- 观察证据（真实截图）：
  - 横幅：**「▲ 故事记忆已覆盖 8/9 回合。 1 项请求结果未知，已停止自动重发；可能已计费。」**
  - 恢复入口：**「恢复未知结果的记忆整理」**；点击弹出计费告知 **「先前请求可能已经计费。恢复会再次发送请求，原账本保留，累计最多三次物理请求。」**（按钮：暂不恢复 / 确认恢复）。
- UI↔DB 对照（`adb exec-out run-as cat` 回拉设备库 + `node:sqlite`）：`frozen_turn_postprocess_outbox` = 1×outcome_unknown + 8×succeeded；`llm_request_attempts` 记忆请求 `qa-memory#a1` = `memory_checkpoint`/`outcome_unknown` 且 `replay_approved_at` 为空；记忆 `through=8`、branch `v9`。
- 私有证据（不入库，`.tmp/closeout-round2/`）：`a36-07-banner.png`、`a36-07-banner.xml`、`a36-08-restore-dialog.png`、`a36-08-restore-dialog.xml`、`android-a36-live.sqlite`、`a36-*.xml` 系列、夹具与流程脚本。

## 2. 文档时间线校准

1. `ACCEPTANCE_CLOSEOUT.md` 第 9 行“迁移 33”→ 加时间标注：33 为 0.8.0 发布时点，现行为单基线 version 100（指向“重验收与加固轮”与 P8-RA 节），历史叙述保留。
2. 同文档设备证据段“增量迁移至 33 且 P7 数据保留”→ 加“（2026-10-04 证据，早于单基线政策）”并注明已随 version 100 收敛为旧库显式拒绝 + 新建库。
3. `FINAL_REPORT.md` §3“32 PASS / 1 部分 / 3 NOT RUN”→ 标注为历史快照、以矩阵逐项为准；追加“重验收轮”与“收尾轮（Round 2）”两段校准更新（最终 36/0）。

## 3. 门禁输出摘要（全部实跑）

| 门禁 | 结果 | 关键输出 |
|---|---|---|
| `npm run verify:core`（typecheck + build + 全量测试） | ✅ PASS | `# tests 922 / # pass 922 / # fail 0 / # skipped 0`（`916 → 922`，新增 6） |
| `npm run typecheck --prefix mobile` | ✅ PASS | 严格模式 0 错误 |
| `npm run verify:version` | ✅ PASS | `version=0.8.0 versionCode=80000` |
| `git diff --check` | ✅ PASS | 0 行 |
| `npm run apk:debug --prefix mobile` | ✅ PASS | `BUILD SUCCESSFUL in 21s`；产物 `mobile/android/app/build/outputs/apk/debug/app-debug.apk`（SHA-256 `3a22dd4c…633f6`） |

（输出日志：`.tmp/closeout-round2/core.log`、`mobile-typecheck.log`、`apk-debug.log`、`emulator.log`。）

## 4. 开放项与遗留（不冒充完成）

1. **真机 NOT RUN**：全部设备证据来自 emulator-5554（API 37.1）；不写“全设备稳定”。
2. **小说自动映射质量未评分**：结论仍为“人工配置组合通过”。
3. **同源多项目语义未定**（`BUG-IMPORT-DEDUP-1` 已修诚实提示，世界归属模型待产品决策）。
4. **BUG-SCHED-1**（结算等待无进度反馈，低、产品决策）保留。
5. **设备旧项目政策**：P7 旧项目不再增量迁移；新协议战役须新建项目。

## 5. 交付物

- `tests/phase8-closeout-round2.test.cjs`（新增 6 用例）
- `docs/reviews/phase8/ACCEPTANCE_MATRIX.md`（A05/A09/A11/A30/A36 行 + 门禁对照 + 收尾轮段落 + 设备走查方法）
- `docs/reviews/phase8/ACCEPTANCE_CLOSEOUT.md`（时间线校准 + 收尾轮段落）
- `docs/reviews/phase8/FINAL_REPORT.md`（§3 计数校准）
- `CHANGELOG.md`（[Unreleased] 追加收尾轮条目）
- 本报告
