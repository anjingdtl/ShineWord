# F4 — 前 10 回合 Progressive 验收

**阶段：** F4（真实可玩 Campaign 连续 ≥10 回合 + 按需资料 + 不可变增量绑定 + 生命周期）
**分支：** `feature/final-acceptance-closeout`
**日期：** 2026-09-29（Asia/Shanghai）

## 0. 结论先行

| 验收项 | 本轮结论 |
|---|---|
| F4 前 10 回合真实 Campaign（每回合耗时、资料请求、缓存命中、delta、binding stateVersion） | **NOT TESTED（设备+端点）** |
| F4.1 按需资料三态（已整理 / 未整理 / 未发现） | **代码级 PASS**；设备 NOT TESTED |
| F4.2 不可变增量绑定（Base + Expansion + Bindings；Turn N 冻结后不变化） | **代码级 PASS**；设备 NOT TESTED |
| F4.3 生命周期（强停重开 / 锁屏恢复 / 后台任务恢复） | **代码级 PARTIAL**；设备 NOT TESTED |

> 前 10 回合必须建立在「真实可玩 Campaign」之上；而真实闭环当前为 BLOCKED（见 [F3](F3_FIRST_PLAYABLE.md)）。故 F4 整体保持 **NOT TESTED**，不填任何推测耗时。

## 1. 前置阻断

F4 依赖 F3 产出的真实可玩开局。无开局 → 无真实 Campaign → 无 10 回合数据。本沙箱同时无设备、无端点（[F0 §5](F0_BASELINE.md#5-设备与模型可用性)）。

## 2. F4.1 按需资料三态 —— 代码级 PASS

文件：[progressive-preparation-status.test.cjs](file:///workspace/tests/progressive-preparation-status.test.cjs)、[progressive-search.test.cjs](file:///workspace/tests/progressive-search.test.cjs)

- `tri-state reports scoped organization, known unmapped material and a completed no-hit book separately`：**已整理 / 已知未映射 / 已查无命中** 三态分别报告，不混淆。
- `unknown terms report no local match without claiming that a fact is absent`：**搜索无命中 ≠ 原著不存在**。
- `explicit whole-source lookup publishes exact discoverable quotes and records knowledge on the branch`（[progressive-content.test.cjs](file:///workspace/tests/progressive-content.test.cjs)）：只有显式「记录为角色已知」才把精确引文写入**当前分支知识**；未确认命中不进入玩家书页或 Planner context。

## 3. F4.2 不可变增量绑定 —— 代码级 PASS

文件：[progressive-content.test.cjs](file:///workspace/tests/progressive-content.test.cjs)、[progressive-build-queue.test.cjs](file:///workspace/tests/progressive-build-queue.test.cjs)

- `branch delta publication, frozen Planner dependency, fork/save/archive restore and review isolation`：覆盖 Base/Delta manifest、**冻结合同依赖**、fork/save/archive 恢复、冲突进 review 与分支隔离。对应「Turn N 冻结 bindings → 后台 expansion 完成 → Turn N 不变 → Turn N+1 安全边界接纳」的语义。
- `visible source scope comes only from published entry citations visible at the story-time anchor`、`source search can index only published evidence ranges and never returns later source text`：未发布区间不会泄漏进可见范围或本地检索结果。
- `queue bounds top-k source input and enforces per-task and ten-turn provider budgets`：十回合 provider 预算有界，避免「每回合强制补书」。
- G4 文档：[G4.md](../progressive-opening/G4.md) 记录同一结论（代码与回归通过，端上存档旅程未全跑）。

## 4. F4.3 生命周期 —— 代码级 PARTIAL

- 恢复策略与租约：[recovery.test.cjs](file:///workspace/tests/recovery.test.cjs)、[recovery-policy.test.cjs](file:///workspace/tests/recovery-policy.test.cjs)、[progressive-build-queue.test.cjs](file:///workspace/tests/progressive-build-queue.test.cjs)（前台优先、晚回包 fencing、lease 续期）。
- **未验证（设备）**：Play 中强停 App → 重开（Campaign / branch / stateVersion / turn history / bindings / party / knowledge 恢复）；屏幕熄灭/锁屏恢复；后台 build 运行时的 foreground service / task state / lease / resume 且不重复执行同一 unit。
- 现有 G5 设备证据仅到「无 Wi-Fi 强停重开回到书库 / 屏幕熄灭唤醒后恢复」（见 [FINAL_AUDIT.md](../progressive-opening/FINAL_AUDIT.md)），**未覆盖活动 Campaign 与运行中 build**。

## 5. 关闭条件

需要：可用设备 + 一个能稳定产出可玩开局的端点配置 + 允许本地测试的小说。具备后按 §二十六～二十九执行，分别记录 machine 耗时、额外资料请求次数、local lookup P50/P95、cache hit/miss、delta created、binding stateVersion。

**不得**用固定 mock dossier 或改 DB 冒充真实 10 回合。