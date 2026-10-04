# Phase 8 验收矩阵（A01–A36）

状态值：`PASS` / `FAIL` / `NOT RUN`。NOT RUN 不计入通过。每项须给出证据位置；最终状态见本文档末尾的结论表，历史快照不覆盖。

| 编号 | 场景 | 状态 | 证据 | 备注 |
|---|---|---|---|---|
| A01 | PASS | tests/phase8-p8-1.test.cjs "typed collector maps the active-situation label onto currentState"; G1 回归 | 【当前局面】mandatory 进入 currentState 板 | |
| A02 | PASS | phase8-p8-1 "typed collector reports unknown labels as diagnostics" + "reject unknown kinds and missing dependencies" | 诊断含被丢弃输入原文 | |
| A03 | PASS | phase8-p8-1 eligibility 五类拒绝用例 | future/foreign/dirty/seed/coverage_gap 全拒且不暴露 body | |
| A04 | PASS | phase8-p8-1 pending bridge + planMemoryCoverage 委托共享实现 | 覆盖缺口显式标记 | |
| A05 | GM 秘密、隐藏别名、原著未来 | NOT RUN | — | |
| A06 | PASS | phase8-p8-2 A06 用例 + contextPlanner 两遍回收 | 整项跳过、份额回收、后项可装 | |
| A07 | PASS | phase8-p8-2 A07 用例 | 同池服务两板块 | |
| A08 | PASS | phase8-p8-2 A08 用例 + phase2-campaign "unknown capabilities fail closed with zero HTTP" | 能力未知/mandatory 超窗零发送 | |
| A09 | Narrator 加 Prepared / repair 后超窗 | NOT RUN | — | |
| A10 | Preview、真实 Send 和恢复一致性 | NOT RUN | — | |
| A11 | 已冻结后记忆更新或设置变化 | NOT RUN | — | |
| A12 | PASS | tests/phase8-gaps.test.cjs G3 | 损坏信封显式失败且保留原信封 | |
| A13 | 骰点 / Prepared / 正文后强停复用 | NOT RUN | — | |
| A14 | PASS | tests/phase8-gaps.test.cjs G4 outbox 故障注入 | outbox 失败整笔回滚 | |
| A15 | 普通、休息、训练、NPC、队伍、局面全覆盖 | NOT RUN | — | |
| A16 | 同一 handoff 重复消费 / 两 worker | NOT RUN | — | |
| A17 | 请求 sent 后强停，lease 过期 | NOT RUN | — | |
| A18 | repair + reasoning + fallback ≤3 HTTP | NOT RUN | — | |
| A19 | PASS | tests/phase8-p8-5.test.cjs A19 + G5 CAS | CAS 冲突整笔回滚 | |
| A20 | PASS | phase8-p8-5 "observations citing evidence outside the batch are rejected" + accepted-only 用例 | 拒绝观察不进接受集 | |
| A21 | PASS | phase8-p8-5 future/batch 外证据拒绝 | 批次外引用拒绝 | |
| A22 | PASS | phase8-p8-5 A22 evidence-time 用例 | 实体时间=v2/v8 各自证据 | |
| A23 | PASS | tests/phase8-gaps.test.cjs G6 + phase8-p8-5 A23 | known-change 空观察不推进 | |
| A24 | PASS | phase8-p8-5 A24 legitimate no_change | 安静批次显式推进 | |
| A25 | PASS | tests/phase8-p8-9-journey.test.cjs 100/300/1000 | 累积状态：commit 38/147/1039ms, read ≤4ms, handoff 100% | |
| A26 | PASS | tests/phase8-p8-6.test.cjs A26 组合与参数用例 | 未知模块/版本/依赖/参数/未类型化约束全拒 | |
| A27 | 三种世界组合和关闭战斗 | NOT RUN | — | |
| A28 | PASS | tests/phase8-p8-7.test.cjs A28 用例组 | 有界升降、阈值、未知轨道显式失败、克隆保真 | |
| A29 | PASS | phase8-p8-6 A29 发布拒绝用例 | 不可执行 effect 发布期拒绝 | |
| A30 | 相同绑定、状态、行动、roll 确定性 | NOT RUN | — | |
| A31 | PASS | tests/phase8-p8-8.test.cjs A31 | 仅 applied patch 跨分叉 | |
| A32 | PASS | tests/phase8-p8-8.test.cjs A32 + tests/phase8-save9.test.cjs save-9 hop | 记忆/覆盖随档恢复、零 LLM | |
| A33 | PASS | tests/phase8-save9.test.cjs A33 用例 | save-2..8 逐版本拒绝 | |
| A34 | 新空库 / 旧开发库 | NOT RUN | — | |
| A35 | 核心夹具与移动端依赖装配 | NOT RUN | — | |
| A36 | 故障后的 UI 与报告诚实性 | NOT RUN | — | |

## 门禁对照

| 硬门禁 | 来源 | 状态 |
|---|---|---|
| mandatory / 最终 wire 不超声明窗口；未知能力零发送 | A08/A09 | NOT RUN |
| 冻结损坏零调用 | A12 | NOT RUN |
| 每逻辑记忆批次 ≤3 HTTP | A18 | NOT RUN |
| 权威提交 handoff 覆盖率 100% | A15 | NOT RUN |
| 接受观察证据可定位率 100% | A20/A21 | NOT RUN |
| 未来 / 非公开资料泄漏为 0 | A05/A21/A31 | NOT RUN |
| CAS 失败无覆盖副作用 | A19 | NOT RUN |
