# Phase 8 实施进度

| 日期 | 施工包 | 内容 | 检查结果 | Commit |
|---|---|---|---|---|
| 2026-10-04 | P8-0 | 基线复核（四子系统探索 + P7 收尾边界）；协议登记冻结（PROTOCOL_BASELINE.md）；六类最小回归建立（tests/phase8-gaps.test.cjs，开工 RED）；验收矩阵脚手架 | 见下 | 4f289a3 |
| 2026-10-04 | P8-1 | `turn-material-1` 类型化材料合同 + `turnMaterialCollector`（未知标签→诊断，G1 转绿）；`storyMemoryEligibility` 判别式检查点资格（未来/异支/脏/无指纹/覆盖缺口拒绝，G2 转绿）；`pendingBridge` 覆盖枚举与渲染；session 读门禁替换为资格+补桥；`listCommittedTurnsAfter` 分页读取；`planMemoryCoverage` 委托共享实现 | typecheck PASS；858 项测试 854 过 / 4 RED（G3–G6，归属 P8-3/4/5）；新增 phase8-p8-1 九项全过 | （见 git log） |

## P8-0 基线复核结论

- 开工 HEAD：`main@58a9825`（方案文档提交）；P7 收尾 `852 pass / 0 fail`，移动端类型检查与版本一致性在 P7 已通过。
- B01–B15 缺口在当前源码全部复核确认（关键行号）：B02 `candidateCollector.ts:87-119` 静默丢弃未知标签（`【当前局面】` session.ts:2150 中招）；B03 `planMemoryCoverage` 生产未调用，读门禁 `session.ts:1166-1175` 仅查 clean+≤8；B06 `lastTurnContexts`（session.ts:204）为内存调试快照、contextId 不含内容哈希；B07 `contextPlanner.ts:80-89,150-187` 任意 BudgetInfeasibleError 落入 renderLegacy 全量回退；B08 后台记忆 IIFE 仅 `session.ts:2483`（叙事路径），休息/训练/遭遇/生命周期提交无后处理；B09 `storyMemoryMaintenance.ts:314-324` insertPatch→saveState→markPatchApplied 三次独立写；B10 `storyMemoryMerger.ts` 各实体时间统一写批次终点；B12 content schema 接受 11 种 effect、编译器仅支持 6 种（`v2Compile.ts:50-57` vs `content/types.ts:192-203`）；B13 `v2Compile.ts:579-599` 世界限制为子串匹配；B14 save-8 只带旧 `memories`，不带 Story Memory V2；B15 `forkStoryMemory`（storyMemoryRepository.ts:194-237）不过滤 applied 状态。
- 额外发现：`modelEnvelope.ts:85-87` 信封不可行抛普通 Error（绕过 BudgetInfeasibleError 分流，直接打断回合）；`saveFile.ts:20-34` 导入接受 save-3..8（与单协议政策冲突，P8-8 收敛为仅 save-9）。

## P8-0 检查记录

- `npm run typecheck`：PASS。
- `npm test`（构建后全量）：基线 852 项全绿 + 新增 phase8-gaps 六项，六项按设计 **RED**（缺口复现，对应 PROTOCOL_BASELINE.md §7 表；RED 即 P8-0 门禁证据）。

## 开放问题

- （P8-0）无阻断项。
