# Phase 8 实施进度

| 日期 | 施工包 | 内容 | 检查结果 | Commit |
|---|---|---|---|---|
| 2026-10-04 | P8-0 | 基线复核（四子系统探索 + P7 收尾边界）；协议登记冻结（PROTOCOL_BASELINE.md）；六类最小回归建立（tests/phase8-gaps.test.cjs，开工 RED）；验收矩阵脚手架 | 见下 | 4f289a3 |
| 2026-10-04 | P8-1 | `turn-material-1` 类型化材料合同 + `turnMaterialCollector`（未知标签→诊断，G1 转绿）；`storyMemoryEligibility` 判别式检查点资格（未来/异支/脏/无指纹/覆盖缺口拒绝，G2 转绿）；`pendingBridge` 覆盖枚举与渲染；session 读门禁替换为资格+补桥；`listCommittedTurnsAfter` 分页读取；`planMemoryCoverage` 委托共享实现 | typecheck PASS；858 项测试 854 过 / 4 RED（G3–G6，归属 P8-3/4/5）；新增 phase8-p8-1 九项全过 | 9eac725 |
| 2026-10-04 | P8-2 | 删除 `renderLegacy` 全量回退（B07）；`computeRequestEnvelope` 改抛 `BudgetInfeasibleError('envelope_infeasible')`；分配器两遍回收（whole-item 跳过+回收+unallocated 重试，T06）；`finalWireVerifier` 最终消息校验接入 Planner/Narrator 发送点（§10.4）；记忆逐实体 compact 投影（B05：目标 mandatory、人物/关系逐项竞争）；去掉 recentStory 字符截断；测试夹具补能力声明、3 个 legacy 回退测试按新政策重写（A08：能力未知=零发送） | typecheck PASS；873 项测试 869 过 / 4 预期 RED（G3–G6）；新增 phase8-p8-2 六项全过 | 8b20ccc |
| 2026-10-04 | P8-3 | `frozenTurnMaterialsStore`（frozen-turn-materials-1）：持久化冻结根 + 规范化 payload SHA-256 + `FrozenMaterialsCorruptedError`（json_corrupt/hash_mismatch/missing_field），损坏保留原信封（G3 转绿）；迁移 33 建 frozen_turn_material_roots 与 frozen_turn_postprocess_outbox；`FrozenTurnIdentity` 关联结构登记；session 接线：bundle 先持久化再发送、恢复按 turnId 复用冻结 bundle（版本基线校验），不静默换资料（I05） | typecheck PASS；873 项测试 870 过 / 3 预期 RED（G4–G6）；迁移断言更新至 33 | 9154af9 |
| 2026-10-04 | P8-4 | commitAtomic 扩展为唯一提交边界（I02）：同事务采纳叙述候选 + 写入唯一 `turn-postprocess-handoff-1` handoff（publicEvidenceHash/bodyRevisionHash），outbox 写失败整笔回滚（G4 转绿，覆盖叙事/休息/训练/里程碑/遭遇/生命周期全部提交路径）；`TurnPostProcessingCoordinator`：分支串行 worker、租约+fencingToken 条件写入、outcome_unknown 不自动接管（I14）、本地 episodic 索引与记忆维护解耦；session 后台 IIFE 替换为 coordinator.processBranch；`SqliteStoryMemoryStore.saveStateCas` 指纹 CAS（G5 转绿）；4 个部分 schema 测试夹具升级为全量 BUILTIN_MIGRATIONS | typecheck PASS；873 项测试 872 过 / 1 预期 RED（G6） | （见 git log） |

## P8-0 基线复核结论

- 开工 HEAD：`main@58a9825`（方案文档提交）；P7 收尾 `852 pass / 0 fail`，移动端类型检查与版本一致性在 P7 已通过。
- B01–B15 缺口在当前源码全部复核确认（关键行号）：B02 `candidateCollector.ts:87-119` 静默丢弃未知标签（`【当前局面】` session.ts:2150 中招）；B03 `planMemoryCoverage` 生产未调用，读门禁 `session.ts:1166-1175` 仅查 clean+≤8；B06 `lastTurnContexts`（session.ts:204）为内存调试快照、contextId 不含内容哈希；B07 `contextPlanner.ts:80-89,150-187` 任意 BudgetInfeasibleError 落入 renderLegacy 全量回退；B08 后台记忆 IIFE 仅 `session.ts:2483`（叙事路径），休息/训练/遭遇/生命周期提交无后处理；B09 `storyMemoryMaintenance.ts:314-324` insertPatch→saveState→markPatchApplied 三次独立写；B10 `storyMemoryMerger.ts` 各实体时间统一写批次终点；B12 content schema 接受 11 种 effect、编译器仅支持 6 种（`v2Compile.ts:50-57` vs `content/types.ts:192-203`）；B13 `v2Compile.ts:579-599` 世界限制为子串匹配；B14 save-8 只带旧 `memories`，不带 Story Memory V2；B15 `forkStoryMemory`（storyMemoryRepository.ts:194-237）不过滤 applied 状态。
- 额外发现：`modelEnvelope.ts:85-87` 信封不可行抛普通 Error（绕过 BudgetInfeasibleError 分流，直接打断回合）；`saveFile.ts:20-34` 导入接受 save-3..8（与单协议政策冲突，P8-8 收敛为仅 save-9）。

## P8-0 检查记录

- `npm run typecheck`：PASS。
- `npm test`（构建后全量）：基线 852 项全绿 + 新增 phase8-gaps 六项，六项按设计 **RED**（缺口复现，对应 PROTOCOL_BASELINE.md §7 表；RED 即 P8-0 门禁证据）。

## 开放问题

- （P8-0）无阻断项。
