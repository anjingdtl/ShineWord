# Phase 8 验收矩阵（A01–A36）

状态值：`PASS` / `FAIL` / `NOT RUN`。NOT RUN 不计入通过。每项须给出证据位置；最终状态见本文档末尾的结论表，历史快照不覆盖。

| 编号 | 场景 | 状态 | 证据 | 备注 |
|---|---|---|---|---|
| A01 | PASS | tests/phase8-p8-1.test.cjs "typed collector maps the active-situation label onto currentState"; G1 回归 | 【当前局面】mandatory 进入 currentState 板 | |
| A02 | PASS | phase8-p8-1 "typed collector reports unknown labels as diagnostics" + "reject unknown kinds and missing dependencies" | 诊断含被丢弃输入原文 | |
| A03 | PASS | phase8-p8-1 eligibility 五类拒绝用例 | future/foreign/dirty/seed/coverage_gap 全拒且不暴露 body | |
| A04 | PASS | phase8-p8-1 pending bridge + planMemoryCoverage 委托共享实现 | 覆盖缺口显式标记 | |
| A05 | GM 秘密、隐藏别名、原著未来 | PASS | tests/phase8-closeout-round2.test.cjs 两个用例：`A05: the permission projection refuses GM secrets...`（权限投影 `projectPlayerEntriesAtAnchor` 拒绝 gm/discoverable/未来并剥离 scene 嵌套引用）+ `A05: no adversarial marker reaches the Planner/Narrator wire...`（生产回合 Planner/Narrator wire 与冻结玩家投影逐字段复核无泄漏，公开条目为正对照） | 收尾轮（2026-10-05）；本地真实链路，非合成 |
| A06 | PASS | phase8-p8-2 A06 用例 + contextPlanner 两遍回收 | 整项跳过、份额回收、后项可装 | |
| A07 | PASS | phase8-p8-2 A07 用例 | 同池服务两板块 | |
| A08 | PASS | phase8-p8-2 A08 用例 + phase2-campaign "unknown capabilities fail closed with zero HTTP" | 能力未知/mandatory 超窗零发送 | |
| A09 | Narrator 加 Prepared / repair 后超窗 | PASS | tests/phase8-closeout-round2.test.cjs → 见 `A09: Narrator + Prepared packet stacked over the envelope sheds from the same frozen pool and the dispatched wire fits`（超窗时可选用 Prepared packet 从同一冻结池裁撤，实际派发 wire 经 `verifyFinalWireRequest` 复核不超声明窗口）+ `A09: when Narrator + repair still overflows, the repair is not dispatched (zero HTTP)`（叠加 repair 后不可行 → `final_wire_exceeded` 且修复请求零发送） | 收尾轮（2026-10-05） |
| A10 | Preview、真实 Send 和恢复一致性 | PASS | tests/phase8-reacceptance.test.cjs "Narrator repair is retained across restart; model drift blocks dispatch and original frozen intent stays identical"（重启后冻结 intent 逐字节不变、已付费结果复用、模型漂移阻断派发） | 重验收轮（2026-10-05） |
| A11 | 已冻结后记忆更新或设置变化 | PASS | tests/phase8-closeout-round2.test.cjs `A11: a frozen turn bundle keeps its content hash across later memory and settings changes and cannot be replaced`（冻结后写入记忆状态 + 改设置，`contentHash` 与载荷逐字节不变、重算一致；不同材料写入同 root 被拒、同材料幂等） | 收尾轮（2026-10-05） |
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
| A30 | 相同绑定、状态、行动、roll 确定性 | PASS | tests/phase8-closeout-round2.test.cjs `A30: identical binding + state + action + roll produce a byte-identical Prepared resolution and commit exactly once`（contract/prepared/nextState/事件流 canonical 逐字节相同；二次提交为 replay、turn 与 branch_events 计数不增） | 收尾轮（2026-10-05） |
| A31 | PASS | tests/phase8-p8-8.test.cjs A31 | 仅 applied patch 跨分叉 | |
| A32 | PASS | tests/phase8-p8-8.test.cjs A32 + tests/phase8-save9.test.cjs save-9 hop | 记忆/覆盖随档恢复、零 LLM | |
| A33 | PASS | tests/phase8-save9.test.cjs A33 用例 | save-2..8 逐版本拒绝 | |
| A34 | 新空库 / 旧开发库 | PASS | tests/phase8-reacceptance.test.cjs 两用例（接受 Android 元数据而不误判旧库；不完整基线拒绝且不静默修复/替换）+ 设备 Maestro 流程 `fresh-baseline-reset`（旧库拒绝→创建新库→导入小说可见）+ ui-legacy-refused.xml + Keychain 重置前后 SHA-256 一致 | 移动端“创建新的开发数据库”入口 |
| A35 | PASS | 设备 V0.8.0 真实回合：冻结根+outbox+episodic_indexed+Planner/Narrator/记忆批次全部 succeeded（同一 composition root） | 移动端与主机同代码路径 | |
| A36 | 故障后的 UI 与报告诚实性 | PASS | 核心与 UI 实现证据 + 设备走查（emulator-5554，API 37）：打开战役 `novel-copy`（分支 `novel-copy-main`）游戏信息面板，横幅显示「故事记忆已覆盖 8/9 回合。 1 项请求结果未知，已停止自动重发；可能已计费。」并提供「恢复未知结果的记忆整理」入口，点击弹出计费告知「先前请求可能已经计费……累计最多三次物理请求」。设备库回拉对照：`frozen_turn_postprocess_outbox` = 1×outcome_unknown + 8×succeeded；`llm_request_attempts` 记忆请求 `qa-memory#a1` = outcome_unknown 且未批准；记忆 through=8、branch v9。证据：`.tmp/closeout-round2/a36-07-banner.png`、`a36-07-banner.xml`、`a36-08-restore-dialog.png`、`android-a36-live.sqlite`（私有，不入库） | 收尾轮（2026-10-05）；设备真实截图，非合成 |

## 门禁对照

> 2026-10-05 校准：原表将若干已有 PASS 证据的门禁误标 NOT RUN，此行状态按其来源项的实际证据重列，不改变来源项判定。

| 硬门禁 | 来源 | 状态 |
|---|---|---|
| mandatory / 最终 wire 不超声明窗口；未知能力零发送 | A08（PASS）/ A09（PASS，收尾轮） | PASS（A08；A09 收尾轮补：Narrator+Prepared+repair 叠加超窗时可选载荷从同一冻结池裁撤，仍不可行则 `final_wire_exceeded` 零发送） |
| 冻结损坏零调用 | A12 | PASS |
| 每逻辑记忆批次 ≤3 HTTP | A18 | PASS（真实 API 账本） |
| 权威提交 handoff 覆盖率 100% | A15 / A35 | PASS（主机 1000 回合 + 设备 v18 + 本轮真实旅程 24/24） |
| 接受观察证据可定位率 100% | A20 / A21 | PASS |
| 未来 / 非公开资料泄漏为 0 | A05（PASS，收尾轮）/ A21 / A31 | PASS（A05 收尾轮对抗样本：权限投影拒绝 gm/隐藏别名/原著未来 + 生产 wire 逐字段无泄漏；A21/A31 旁证） |
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

## 收尾轮证据（2026-10-05 Round 2）

第八阶段收尾后第二轮：补齐上一轮独立复验遗留的全部 5 项 NOT RUN，逐项转 PASS。同一工作副本上执行；`CLOSEOUT_ROUND2_2026-10-05.md` 为逐项证据与门禁输出摘要。

- **A05（对抗泄漏样本）**：新增 `tests/phase8-closeout-round2.test.cjs` 两个用例。权限投影 `projectPlayerEntriesAtAnchor` 对 gm 秘密、未发现的可隐藏别名、原著未来（`revealAt` 未来事实）三类非公开资料全部拒绝，并剥离公开场景内嵌的私有 id 引用；随后走生产 `CampaignSession` 回合，对 Planner/Narrator 实际 wire 与冻结的玩家投影逐字段复核：三类 marker 零出现，公开条目为正对照。**设计注记**：冻结根同时保留本地权威投影 `authoritativeEntries`（供恢复期本地解析隐藏线索/任务引用），该视图按 §11 设计只用于本地权威，永不进入 Planner/Narrator（已由 wire 断言独立验证）。
- **A09（组合超窗）**：新增两用例走生产 `runV2Turn`。Narrator + Prepared packet 叠加超声明窗口时，可选的 situationPacket 从同一冻结池裁撤后实际派发 wire 经 `verifyFinalWireRequest` 复核不超窗；当叠加 repair 后仍不可行时以 `final_wire_exceeded` **零发送**（narrator 仅 1 次 HTTP，修复请求未派发），对齐 A08 fail-closed。
- **A11（冻结后不漂移）**：新增用例在冻结后写入记忆状态并改动设置，冻结根 `contentHash` 与载荷逐字节不变、重算一致；以不同材料覆盖同一 root 被拒（`hash_mismatch`），同材料幂等——恢复始终使用原冻结材料。
- **A30（确定性重放）**：新增用例以相同 ruleBinding + 状态 + 行动 + roll 重放：编译合同、Prepared 归约（nextState/committedTurn/事件流）canonical 逐字节相同；二次提交为 replay，`turns`/`branch_events` 计数不增（结果仅提交一次）。
- **A36（设备故障后 UI）**：emulator-5554（API 37）实机走查，见 A36 行证据。

**收尾轮汇总（覆盖上述校准，以逐项证据为准）**：PASS **36** / NOT RUN **0** / FAIL **0**。核心回归 **922** 项（`916 → 922`，新增 6 项）。设备证据来自 emulator-5554（API 37.1），真机仍为开放项（NOT RUN）。

## A36 设备走查方法（可复现）

1. 冷启动 AVD `ShineWord_P8_Reacceptance`（`-no-snapshot`），`adb install -r` 本轮 Debug APK；`pm` 层面全新安装（清空旧数据）。
2. 启动应用进入模型配置，用真实 GLM 端点配置 profile（密钥仅注入、不落日志不外显）。
3. 强停应用，将内置「故障后」状态的运行时夹具库（`frozen_turn_postprocess_outbox`=1×outcome_unknown、业务记忆请求=outcome_unknown 且未批准、记忆 through=8/branch v9）经 `run-as cp` 置为 `databases/shineword.db`。
4. 重启应用 → 书库 → 战役 → 打开战役 `novel-copy` → 进入游玩 → 游戏菜单 → 打开游戏信息面板；截图横幅与恢复入口；点击恢复入口截取计费告知弹窗。
5. 以 `adb exec-out run-as ... cat` 回拉设备库，用 `node:sqlite` 核对横幅对应行，形成 UI↔DB 对照。
