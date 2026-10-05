# Phase 8 独立复验检查报告

| 项目 | 内容 |
|---|---|
| 复验日期 | 2026-10-05（Asia/Shanghai） |
| 复验基线 | `main@501bf20`（工作区干净，仅 `.workbuddy/` 未跟踪） |
| 复验依据 | `docs/Shine-TRPG_PHASE8_CONSTRUCTION_PLAN.md`（方案 v1.0） |
| 复验性质 | 独立复验：重跑全部工程门禁 + 抽查源码/测试证据名实相符；不重复真实 LLM 旅程与设备实测（沿用既有证据身份） |

## 1. 本轮实跑门禁结果

| 门禁 | 结果 | 关键输出 |
|---|---|---|
| `npm run verify:core`（typecheck + build + 全量测试） | ✅ PASS | 916 项测试 916 过 / 0 失败（含 `phase8-reacceptance` 22 项） |
| `npm run typecheck --prefix mobile` | ✅ PASS | 严格模式 0 错误 |
| `npm run verify:version` | ✅ PASS | version=0.8.0 / versionCode=80000 |
| `git diff --check` | ✅ PASS | 0 行违规 |
| `npm run apk:debug --prefix mobile` | ✅ PASS | BUILD SUCCESSFUL（1m59s） |

## 2. 单协议基线源码核对（方案 §7.4 / §18.2）

| 协议项 | 方案要求 | 源码证据 | 结论 |
|---|---|---|---|
| core | `shineword-core@0.3.0` | `src/domain/rules/ruleset.ts:20` `SHINEWORD_RULESET_VERSION = '0.3.0'`；`worldRuleConfiguration.ts:189-190` core_mismatch 拒绝 | ✅ |
| ActionContract | 2.0（含 RuleBinding），唯一版本 | `src/domain/turns/types.ts:57` `protocolVersion: '2.0'`；`contracts.ts:154` 非 2.0 拒绝 | ✅ |
| Proposal | 单一已登记版本 | `proposal.ts:20,111` 仅接受 `2.0` | ✅ |
| Save | save-9 唯一协议，旧版逐版本拒绝 | `saveFile.ts:32` `SAVE_SCHEMA_VERSION='shineword-save-9'`；:35 起 save-2..8 逐版本拒绝文案、无转换器 | ✅ |
| SQLite | 单基线建库 | `dbBaseline.ts:5-6` `DB_BASELINE_VERSION` + `PHASE8_BASELINE_FIRST_VERSION = 100`；旧库显式拒绝不静默修复 | ✅ |
| 旧执行链清理 | 无 legacy fallback / 旧解析器 | 全仓 `renderLegacy` / `llmTurn` / `runLlmTurn` 零残留；`contextPlanner.ts:6-7,155` 不可行即抛 `BudgetInfeasibleError('envelope_infeasible')` | ✅ |

## 3. §19 拟议模块落地核对

| 拟议模块 | 实际文件 | 结论 |
|---|---|---|
| `domain/rules/moduleRegistry.ts` | 同名存在（8 模块 manifest） | ✅ |
| `domain/rules/worldRuleConfiguration.ts` | 同名存在 | ✅ |
| `domain/rules/modules/*` | `modules/pressureTrack.ts`（新可选机制） | ✅ |
| `application/content/ruleConfigCompiler.ts` | 同名存在 | ✅ |
| `application/context/turnMaterialCollector.ts` | 同名存在 | ✅ |
| `application/context/frozenTurnMaterials.ts` | 实际为 `frozenTurnMaterialsStore.ts`（命名差异，职责一致） | ✅ |
| `application/game/turnPostProcessing.ts` | 同名存在（分支串行协调器） | ✅ |
| 记忆资格 / 观察编译 | `memory/storyMemoryEligibility.ts`、`memory/storyMemoryObservationCompiler.ts` | ✅ |

备注：`session.ts:211` 仍保留 `lastTurnContexts` 字段，但注释明确为"调试快照、永不持久化"，权威冻结已移交 `RootFrozenMaterialsStore`（B06 的处理方式），不构成回归。

## 4. A01–A36 验收矩阵状态

与 `ACCEPTANCE_MATRIX.md`（2026-10-05 校准版）一致，本轮抽查 A01/A02/A03/A04/A08/A12 证据名实相符：

- **PASS 31** / **FAIL 0** / **NOT RUN 5**：A05、A09、A11、A30、A36
- 硬门禁对照：7 项硬门禁中 5 项有直接 PASS 证据；"未来/非公开资料泄漏为 0"由 A21/A31 旁证（A05 对抗样本未跑）；"最终 wire 不超窗"由 A08 旁证（A09 组合场景未跑）

### ⚠️ 按方案 §24 字面门禁的判断

方案要求"发布前所有 A01–A36 有结论与证据，硬门禁全部通过"，且"NOT RUN 不计入通过"。**5 项 NOT RUN 意味着字面发布门禁尚未完全闭合**，需补齐证据或明确豁免：

| 编号 | 缺口 | 建议 |
|---|---|---|
| A05 | GM 秘密 / 隐藏别名 / 原著未来的对抗性泄漏样本未跑 | 补一组对抗样本用例（权限投影拒绝 + 正文复核） |
| A09 | Narrator + Prepared + repair 叠加后超窗的最终 wire 用例未单列 | 在 `phase8-reacceptance` 补组合超窗用例 |
| A11 | 冻结后记忆更新 / 设置变化不漂移的前后 hash 用例未单列 | 补冻结前后内容 hash 对照用例 |
| A30 | 相同绑定/状态/行动/roll 的确定性重放未单列 | 补确定性重放用例（同输入 → 同 Prepared/事件） |
| A36 | 设备端"故障后"诚实 UI 横幅未单独截图 | 设备走查截图补齐（核心与 UI 实现证据已备） |

## 5. 已知开放项与遗留 BUG（来自 closeout / longrun，非本轮新发现）

1. **BUG-SCHED-1（低，未修）**：单回合"正在结算"极端尾部最长 ~5 分钟无进度反馈；根因是 provider 300s 超时为 reasoning 模型合法上限，UI 进度反馈待产品决策。
2. **真机 NOT RUN**：全部设备证据来自 emulator-5554（API 37.1）；按方案 §22.4 不得外推"全设备稳定"。
3. **小说自动映射质量未评分**：本期结论为"人工配置组合通过"，与方案 §24 的写法一致，未冒充自动映射通过。
4. **同源多项目语义未定**：`BUG-IMPORT-DEDUP-1` 已修诚实提示，但"同名新项目"需产品决策 + world 归属模型扩展。
5. **设备旧项目政策**：P7 旧项目经增量迁移可打开（0.2.0 语义原样保留），新协议战役须新建项目——已在 closeout 开放项 5 声明。

## 6. 文档一致性问题（轻微，建议校准）

1. `ACCEPTANCE_CLOSEOUT.md` 第 9 行仍将"迁移 33"写作当前政策，与同文档 P8-RA 节"数据库单基线 version 100"及 `CHANGELOG.md` [Unreleased] 矛盾（33 是 0.8.0 发布时点，100 是 10-05 加固后的现行政策）。
2. 同文档"设备证据"段保留 10-04 的"增量迁移至 33 且 P7 数据保留"叙述，与现行"旧库显式拒绝"政策并置，虽有开放项 5 解释，仍易误读。
3. `FINAL_REPORT.md` §3 记"32 PASS / 1 部分 / 3 NOT RUN"，与矩阵校准后的 31 / 5 不一致（矩阵已声明以逐项为准，但报告原文未回改）。

## 7. 复验结论

**第八阶段工程建设主体完成，质量证据链名实相符。** 本轮重跑的全部工程门禁（916 测试、双端类型、版本一致性、diff 检查、Debug APK）与文档声明一致；单协议基线、§19 模块、legacy 清理均在源码中真实落地；205 轮设备长程与真实 GLM 三组合旅程证据（含 3 个真实 BUG 的修复与回归）身份清晰。

**未发现新 BUG、未发现阻断性建设缺口。** 剩余工作为：

- 5 项 NOT RUN 验收项（A05/A09/A11/A30/A36）——按方案字面门禁需补齐或豁免后才算"发布门禁全闭合"；
- 1 项低严重度 UX 遗留（BUG-SCHED-1）与 2 项产品决策项；
- 3 处文档时间线校准（见 §6）。
