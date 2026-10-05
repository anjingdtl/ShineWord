# Phase 8 实施进度

| 日期 | 施工包 | 内容 | 检查结果 | Commit |
|---|---|---|---|---|
| 2026-10-04 | P8-0 | 基线复核（四子系统探索 + P7 收尾边界）；协议登记冻结（PROTOCOL_BASELINE.md）；六类最小回归建立（tests/phase8-gaps.test.cjs，开工 RED）；验收矩阵脚手架 | 见下 | 4f289a3 |
| 2026-10-04 | P8-1 | `turn-material-1` 类型化材料合同 + `turnMaterialCollector`（未知标签→诊断，G1 转绿）；`storyMemoryEligibility` 判别式检查点资格（未来/异支/脏/无指纹/覆盖缺口拒绝，G2 转绿）；`pendingBridge` 覆盖枚举与渲染；session 读门禁替换为资格+补桥；`listCommittedTurnsAfter` 分页读取；`planMemoryCoverage` 委托共享实现 | typecheck PASS；858 项测试 854 过 / 4 RED（G3–G6，归属 P8-3/4/5）；新增 phase8-p8-1 九项全过 | 9eac725 |
| 2026-10-04 | P8-2 | 删除 `renderLegacy` 全量回退（B07）；`computeRequestEnvelope` 改抛 `BudgetInfeasibleError('envelope_infeasible')`；分配器两遍回收（whole-item 跳过+回收+unallocated 重试，T06）；`finalWireVerifier` 最终消息校验接入 Planner/Narrator 发送点（§10.4）；记忆逐实体 compact 投影（B05：目标 mandatory、人物/关系逐项竞争）；去掉 recentStory 字符截断；测试夹具补能力声明、3 个 legacy 回退测试按新政策重写（A08：能力未知=零发送） | typecheck PASS；873 项测试 869 过 / 4 预期 RED（G3–G6）；新增 phase8-p8-2 六项全过 | 8b20ccc |
| 2026-10-04 | P8-3 | `frozenTurnMaterialsStore`（frozen-turn-materials-1）：持久化冻结根 + 规范化 payload SHA-256 + `FrozenMaterialsCorruptedError`（json_corrupt/hash_mismatch/missing_field），损坏保留原信封（G3 转绿）；迁移 33 建 frozen_turn_material_roots 与 frozen_turn_postprocess_outbox；`FrozenTurnIdentity` 关联结构登记；session 接线：bundle 先持久化再发送、恢复按 turnId 复用冻结 bundle（版本基线校验），不静默换资料（I05） | typecheck PASS；873 项测试 870 过 / 3 预期 RED（G4–G6）；迁移断言更新至 33 | 9154af9 |
| 2026-10-04 | P8-4 | commitAtomic 扩展为唯一提交边界（I02）：同事务采纳叙述候选 + 写入唯一 `turn-postprocess-handoff-1` handoff（publicEvidenceHash/bodyRevisionHash），outbox 写失败整笔回滚（G4 转绿，覆盖叙事/休息/训练/里程碑/遭遇/生命周期全部提交路径）；`TurnPostProcessingCoordinator`：分支串行 worker、租约+fencingToken 条件写入、outcome_unknown 不自动接管（I14）、本地 episodic 索引与记忆维护解耦；session 后台 IIFE 替换为 coordinator.processBranch；`SqliteStoryMemoryStore.saveStateCas` 指纹 CAS（G5 转绿）；4 个部分 schema 测试夹具升级为全量 BUILTIN_MIGRATIONS | typecheck PASS；873 项测试 872 过 / 1 预期 RED（G6） | （见 git log） |

| 2026-10-04 | P8-5 | `storyMemoryObservationCompiler`：批次证据表（回合级+效果级）、确定性 known-change oracle、evidence/action 校验、accepted-only 派生；known-change 批次空观察不得推进 clean 并进受限修复轮（G6 转绿，T11/A23）；合法 no_change 显式推进（A24）；merger 实体时间改由引用证据推导（B10/T09）；`applyCheckpointAtomically` 单事务补丁+CAS 状态+applied 标记（B09，A19）；`forkStoryMemory` 仅重放 applied（B15/I13） | typecheck PASS；879 项全绿；新增 phase8-p8-5 六项 | 8536575 |
| 2026-10-04 | P8-6 | `moduleRegistry`（mechanism-manifest-1，8 模块 manifest+固定组合顺序）；`worldRuleConfiguration`（world-rule-config-1，有界参数 schema、类型化约束目标，纯文本阻止约束拒绝编译=B13）；`ruleConfigCompiler` 确定性 configHash+RuleBinding+能力表+公开投影；能力闭包：发布拒绝执行器未实现的 effect（B12/A29）；core 0.3.0、ActionContract 2.0（+ruleBinding）；**删除 V1 合同链**（llmTurn.ts/runLlmTurn），m2-loop/m4-game 夹具改 V2 提案链 | typecheck PASS；883 项全绿；新增 phase8-p8-6 六项 | 951a147 |
| 2026-10-04 | P8-7 | `pressure_track` 模块（A28：有界升降、阈值判定、未知轨道显式失败、克隆/持久化保真、planner 不可写）；三题材配置编译出不同能力面（A27：奇幻全机制/悬疑无战斗+压力/日常训练成长）；`renderRulePreview` 规则预览（启用/禁用/限制+出处）；cloneGameState 携带 pressureTracks | typecheck PASS；889 项全绿；新增 phase8-p8-7 六项 | ace6693 |
| 2026-10-04 | P8-8 | save-9 单协议：save-2..8 逐版本拒绝、无转换器（A33）；save-9 携带 Story Memory checkpoint+applied chain+后处理覆盖（入完整性摘要）；导入单事务重绑分支身份、零 LLM（A32）；`forkStoryMemory` 仅 applied（A31）；`dbBaseline` 新空库一次建全 + 旧开发库检测拒绝并提示开发重置（A34）；旧 save 兼容测试按单协议政策移除，新增 phase8-save9/phase8-p8-8 | typecheck PASS；890 项全绿 | 68474f7 |
| 2026-10-04 | P8-9a | 累积长旅程 100/300/1000（tests/phase8-p8-9-journey.test.cjs）：单分支连续累积，handoff 覆盖 100%、本地 episodic 索引 100%、记忆折叠至 head、分页下一回合读取 1000 回合 ≤4ms；A25 PASS | typecheck PASS；894 项全绿；metrics 见测试输出 | 71ab575 |
| 2026-10-04 | P8-9b | 真实 GLM 三组合旅程（私有驱动 .tmp/p8-real-journey.cjs：生产 CampaignSession + LedgeredProvider + 统一提交边界 + 协调器）：suspense 26 提交/3 批 clean through=24；fantasy 26 提交/3 批 clean through=24（sent→outcome_unknown→人工批准→lease 过期接管→重放成功的完整 A16/A17/A18 证据链，unknown 尝试保留审计）；daily 22 提交/7 批 clean through=22（修复轮验证拒绝+dirty 重建）；known-change 核对：三组合人物目标/关系/线程真实更新、实体时间随证据（v21–v24）、head 后零未覆盖 | 真实 API ~175 次物理 HTTP 全入账本；发现并修复协调器 fencing-token 旧值缺陷（fd0b7b2） | fd0b7b2 |
| 2026-10-05 | P8-RA | 重验收加固：可移植 SHA-256 身份指纹（Node/RN 同源）、稳定存档门禁（拒绝未完成回合/在途或未知请求/运行中记忆任务，移除静默兜底）、`storyMemoryChain` 记忆链校验、`runtimeRules` 预设工厂接入生产、规则配置硬化（伪造哈希/非整数参数/未类型化约束拒绝）、数据库单基线 version 100 + 旧库拒绝且不静默修复 + 移动端“创建新的开发数据库”入口、GameInfoPanel 记忆状态诚实 UI；新增 `tests/phase8-reacceptance.test.cjs`（22 项）；补跑真实 GLM 三组合各 24 回合复测 | `verify:core` 916/916；移动严格类型 0；`verify:version` PASS；Debug APK 构建成功；真实旅程 72 回合 0 失败 | 见 git log |

## P8-0 基线复核结论

- 开工 HEAD：`main@58a9825`（方案文档提交）；P7 收尾 `852 pass / 0 fail`，移动端类型检查与版本一致性在 P7 已通过。
- B01–B15 缺口在当前源码全部复核确认（关键行号）：B02 `candidateCollector.ts:87-119` 静默丢弃未知标签（`【当前局面】` session.ts:2150 中招）；B03 `planMemoryCoverage` 生产未调用，读门禁 `session.ts:1166-1175` 仅查 clean+≤8；B06 `lastTurnContexts`（session.ts:204）为内存调试快照、contextId 不含内容哈希；B07 `contextPlanner.ts:80-89,150-187` 任意 BudgetInfeasibleError 落入 renderLegacy 全量回退；B08 后台记忆 IIFE 仅 `session.ts:2483`（叙事路径），休息/训练/遭遇/生命周期提交无后处理；B09 `storyMemoryMaintenance.ts:314-324` insertPatch→saveState→markPatchApplied 三次独立写；B10 `storyMemoryMerger.ts` 各实体时间统一写批次终点；B12 content schema 接受 11 种 effect、编译器仅支持 6 种（`v2Compile.ts:50-57` vs `content/types.ts:192-203`）；B13 `v2Compile.ts:579-599` 世界限制为子串匹配；B14 save-8 只带旧 `memories`，不带 Story Memory V2；B15 `forkStoryMemory`（storyMemoryRepository.ts:194-237）不过滤 applied 状态。
- 额外发现：`modelEnvelope.ts:85-87` 信封不可行抛普通 Error（绕过 BudgetInfeasibleError 分流，直接打断回合）；`saveFile.ts:20-34` 导入接受 save-3..8（与单协议政策冲突，P8-8 收敛为仅 save-9）。

## P8-0 检查记录

- `npm run typecheck`：PASS。
- `npm test`（构建后全量）：基线 852 项全绿 + 新增 phase8-gaps 六项，六项按设计 **RED**（缺口复现，对应 PROTOCOL_BASELINE.md §7 表；RED 即 P8-0 门禁证据）。

## 开放问题

- （P8-0）无阻断项。
