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
| A10 | Preview、真实 Send 和恢复一致性 | PASS | tests/phase8-reacceptance.test.cjs "Narrator repair is retained across restart; model drift blocks dispatch and original frozen intent stays identical"（重启后冻结 intent 逐字节不变、已付费结果复用、模型漂移阻断派发） | 重验收轮（2026-10-05） |
| A11 | 已冻结后记忆更新或设置变化 | NOT RUN | — | |
| A12 | PASS | tests/phase8-gaps.test.cjs G3 | 损坏信封显式失败且保留原信封 | |
| A13 | PASS | tests/m2-loop + recovery（骰点/合同复用）+ 设备 turn-0018 冻结根与 outbox 证据 | 恢复复用冻结材料与已付费产物 | |
| A14 | PASS | tests/phase8-gaps.test.cjs G4 outbox 故障注入 | outbox 失败整笔回滚 | |
| A15 | PASS | commitAtomic 唯一边界覆盖全部提交路径（G4）+ 设备 turn-0018 outbox v18 handoff | 权威提交 handoff 100% | |
| A16 | PASS | 真实旅程 fantasy 租约过期接管 + fencing-token 修复（fd0b7b2/ab2be05） | 晚响应/旧 token 不能推进 | |
| A17 | PASS | fantasy sent→outcome_unknown→人工批准→重放（真实 API 账本） | 不自动重发 | |
| A18 | PASS | daily a1+a2 修复序列 ≤3 HTTP；fantasy 恢复批同预算 | 重启不重置（账本持久） | |
| A19 | PASS | tests/phase8-p8-5.test.cjs A19 + G5 CAS | CAS 冲突整笔回滚 | |
| A20 | PASS | phase8-p8-5 "observations citing evidence outside the batch are rejected" + accepted-only 用例 | 拒绝观察不进接受集 | |
| A21 | PASS | phase8-p8-5 future/batch 外证据拒绝 | 批次外引用拒绝 | |
| A22 | PASS | phase8-p8-5 A22 evidence-time 用例 | 实体时间=v2/v8 各自证据 | |
| A23 | PASS | tests/phase8-gaps.test.cjs G6 + phase8-p8-5 A23 | known-change 空观察不推进 | |
| A24 | PASS | phase8-p8-5 A24 legitimate no_change | 安静批次显式推进 | |
| A25 | PASS | tests/phase8-p8-9-journey.test.cjs 100/300/1000 | 累积状态：commit 38/147/1039ms, read ≤4ms, handoff 100% | |
| A26 | PASS | tests/phase8-p8-6.test.cjs A26 组合与参数用例 | 未知模块/版本/依赖/参数/未类型化约束全拒 | |
| A27 | 三种世界组合和关闭战斗 | PASS | tests/phase8-reacceptance.test.cjs 三用例（禁技能/探索/社交即移除对应能力；发布-建役-SQLite 读保持三种模块选择；仅里程碑或禁用成长同时抑制战斗与叙事练习）+ phase8-p8-7 A27 | 三预设能力面差异经生产链路核验 |
| A28 | PASS | tests/phase8-p8-7.test.cjs A28 用例组 | 有界升降、阈值、未知轨道显式失败、克隆保真 | |
| A29 | PASS | phase8-p8-6 A29 发布拒绝用例 | 不可执行 effect 发布期拒绝 | |
| A30 | 相同绑定、状态、行动、roll 确定性 | NOT RUN | — | |
| A31 | PASS | tests/phase8-p8-8.test.cjs A31 | 仅 applied patch 跨分叉 | |
| A32 | PASS | tests/phase8-p8-8.test.cjs A32 + tests/phase8-save9.test.cjs save-9 hop | 记忆/覆盖随档恢复、零 LLM | |
| A33 | PASS | tests/phase8-save9.test.cjs A33 用例 | save-2..8 逐版本拒绝 | |
| A34 | 新空库 / 旧开发库 | PASS | tests/phase8-reacceptance.test.cjs 两用例（接受 Android 元数据而不误判旧库；不完整基线拒绝且不静默修复/替换）+ 设备 Maestro 流程 `fresh-baseline-reset`（旧库拒绝→创建新库→导入小说可见）+ ui-legacy-refused.xml + Keychain 重置前后 SHA-256 一致 | 移动端“创建新的开发数据库”入口 |
| A35 | PASS | 设备 V0.8.0 真实回合：冻结根+outbox+episodic_indexed+Planner/Narrator/记忆批次全部 succeeded（同一 composition root） | 移动端与主机同代码路径 | |
| A36 | 故障后的 UI 与报告诚实性 | NOT RUN | 核心与 UI 实现证据已备：GameInfoPanel 故事记忆状态横幅（已覆盖 X/Y、整理中、待整理、结果未知已停止自动重发且可能已计费）+ 稳定存档显式拒绝用例 | 设备端“故障后”横幅未单独截图，保留 NOT RUN，本轮不外推 |

## 门禁对照

> 2026-10-05 校准：原表将若干已有 PASS 证据的门禁误标 NOT RUN，此行状态按其来源项的实际证据重列，不改变来源项判定。

| 硬门禁 | 来源 | 状态 |
|---|---|---|
| mandatory / 最终 wire 不超声明窗口；未知能力零发送 | A08（PASS）/ A09（未跑） | PASS（能力未知/mandatory 超窗零发送，A08）；Narrator+repair 超窗用例 A09 未单独跑 |
| 冻结损坏零调用 | A12 | PASS |
| 每逻辑记忆批次 ≤3 HTTP | A18 | PASS（真实 API 账本） |
| 权威提交 handoff 覆盖率 100% | A15 / A35 | PASS（主机 1000 回合 + 设备 v18 + 本轮真实旅程 24/24） |
| 接受观察证据可定位率 100% | A20 / A21 | PASS |
| 未来 / 非公开资料泄漏为 0 | A05（未跑）/ A21 / A31 | PASS（A21/A31）；A05 GM 秘密/隐藏别名/原著未来未跑 |
| CAS 失败无覆盖副作用 | A19 | PASS |

## 重验收轮证据（2026-10-05）

第八阶段收尾后追加的“重验收与引擎加固轮”。工程门禁：`npm run verify:core` **916/916 全绿**（含新增 `tests/phase8-reacceptance.test.cjs`）；移动端严格类型检查 0；`npm run verify:version` PASS（0.8.0 / 80000）；Debug APK 独立构建成功。

加固要点（详见 CHANGELOG [Unreleased]）：

- 请求预算/缓存身份指纹由 FNV-1a 32 位改为可移植 SHA-256（`src/domain/identity/sha256.ts`），Node 与 React Native 同源；规则配置哈希跨端可复现（世界 ID 重绑定不变、参数变化即变）。
- 稳定存档门禁：导出前校验分支归属、无未完成冻结回合、无 `prepared`/`sent`/未批准 `outcome_unknown` 物理请求、无 `running`/`outcome_unknown` 记忆后处理；移除静默 try/catch 兜底；导入时 `storyMemoryChain` 校验记忆检查点与补丁链。
- 世界规则配置硬化：`runtimeRules` 预设工厂接入生产链路；伪造哈希 `configuration_hash_mismatch`、参数须安全整数、`untrainedPolicy` 收敛 `forbid`、约束条件引用类型化；能力表驱动的行动/效果门。
- 数据库单基线（version 100）：新空库一次装全；旧/不完整库显式拒绝且**绝不静默修复**；容忍 `android_metadata`；移动端新增“创建新的开发数据库”入口（改选新文件，旧数据/API 配置/Keychain 保留）。

本轮新关闭的验收项（矩阵状态以上表为准）：**A10**（恢复一致性）、**A27**（三世界组合与关闭战斗）、**A34**（新空库/旧开发库，含设备 Maestro 走查）。**A36** 核心与 UI 实现证据齐备，但设备端“故障后”横幅未单独截图，保守保留 NOT RUN。

**真实 GLM 旅程复测（替换此前被 `fetch failed` 中断的残缺证据）**：生产 `CampaignSession` + `LedgeredProvider` + 统一提交边界 + `TurnPostProcessingCoordinator`，确定性迷你世界，GLM-5.3-Flash：

| 组合 | 权威提交 | 回合失败 | 最终记忆 | 物理请求（账本） | outbox |
|---|---|---|---|---|---|
| 现代悬疑（pressure_track，无战斗） | 24 | 0 | clean through=23 | 25 planner + 25 narrator + 3 memory | 23 succeeded + 1 pending |
| 奇幻冒险（含战斗） | 24 | 0 | clean through=24 | 24 planner + 24 narrator + 3 memory | 24 succeeded |
| 日常关系（训练成长） | 24 | 0 | clean through=24 | 26 planner + 24 narrator + 3 memory | 24 succeeded |

三组合合计 72 回合、0 失败；记忆三组合各 3 个 succeeded 批次并推进至 clean；全部物理请求入 `llm_request_attempts` 账本。私有驱动与旅程数据库在忽略目录 `.tmp/phase8-reacceptance-20261005/`（不入库）。

**本轮校准后的汇总**：PASS **31** / NOT RUN **5**（A05、A09、A11、A30、A36） / FAIL **0**。（此前 FINAL_REPORT §3 记为“32 PASS / 1 部分 / 3 NOT RUN”，与本文档项目行计数不一致——本文档以逐项证据为准：A10 已因本轮用例转 PASS，A34 已因设备走查转 PASS，A27 已因三预设用例转 PASS；A05/A09/A11/A30 仍无独立端到端证据，保留 NOT RUN；A36 见上。）
