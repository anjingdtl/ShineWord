# Performance & Project Library v1 Review（planner-v2 / 项目化书库 / 安全删除）

日期：2026-10-01 · 分支：`feat/project-library-and-fast-progressive-build`

本轮两大方向同时收口：

- **A. 世界构建性能架构升级**：Storage Chunk 与 LLM Batch 彻底解耦（planner-v2 / `plan-analysis-1`），Progressive 改为 TTFP（首次可玩时间）优先。
- **B. 书库 UI 项目化重构**：书库 → 项目列表 → 项目工作区两级结构 + 项目级安全删除。

---

## 1. 性能 Baseline（旧 planner，完整原著 dry-run，无 LLM）

| 指标 | 数值 |
|---|---|
| 原著体积 | 3,065,535 bytes |
| 规范化 codepoint | 965,458（估算输入 token ≈ 965k，保守 1 token/cp） |
| 章节数 | 300 |
| Storage chunk 数 | 944（~1200 cp/块，保留为证据/持久化单位） |
| Progressive S1（30/30/40） | 106 章 / 295 chunks |
| 旧 planner 全书 extraction batch | **68**（每批固定 14 chunks ≈ 14.2k token；窗口无关） |
| 旧 planner S1 batch | **22** |

旧 planner 的根本约束：`maxChunksPerBatch = floor(maxContentOutputTokens × 0.7 ÷ estOutputPerChunk=800) ≈ 14`，即“800 output token / storage chunk”的预测模型把批次大小钉死，1M 窗口完全用不上。

## 2. Planner-v2（plan-analysis-1）

结构：`小说 → Chapter → Storage Chunk → AnalysisSlice → LLM Batch`

- **AnalysisSlice**：提交给模型的语义文本块 = 一个完整章节（或超长章的连续 chunk 片段，仅在超出批预算时切分）。slice 携带 `memberChunkIds/memberRanges`，证据 quote 经 slice 内偏移 → 绝对 startCp/endCp → 成员 storage chunk 精确归属（`llmGroupExtractor` 的 memberChunks 协议；线协议向后兼容，旧 run 不受影响）。
- **批次大小只由 token 预算决定**：
  `sourceTarget = min(contextWindow × sourceRatio, hardInputBudget, usableContentOutput ÷ density)`。无任何 chunk 数量上限（14/32 已废）。
- **探针式 source ratio**：初始 12% → 成功后 20% → 25% → 30% 封顶；截断/推理空转失败时 30% → 20% → 12% → 减半（下限 2%）。成长受 `capSourceRatioByDensity` 约束（预测输出必须装得进可用输出预算）。
- **Extraction Density Model**（取代 800/chunk）：初始保守 6%，`TokenDensityCalibrator` 在第 1/2/3 批后及每 3 批用实测 `contentOutputTokens / sourceInputTokens` 在线校准，材料变化 >25% 或比例可成长时对未领取尾部 replan（`replaceUnclaimedUnits` 单事务；completed/running/outcome_unknown 一律不动、不重放）。
- **截断分裂**：`densitySplitPartCount` 按密度预测拆分，替代按 chunk 数拆分。
- **向后兼容**：旧 run 按其冻结的 `plan-chunk-1`/`plan-resident-1` 继续运行与恢复；新 run（mode `group`）一律 v2。stage-plan-1 的 30/30/40 阶段边界与触发机制不变。

## 3. 完整原著新旧 dry-run 对比（parse + planner，无 LLM）

| 场景 | 旧批次 | 新批次（探针 12%） | 新批次（成长 30%） | 降幅（探针） |
|---|---|---|---|---|
| 1M 窗口 · 全书 | 68 | **9**（均 108k token/批，105 chunks/批） | 5 | **-86.8%** |
| 1M 窗口 · S1 开局 | 22 | **3** | 2 | -86.4% |
| 200k 窗口 · 全书 | 68 | 44 | 17 | -35.3% / -75.0%（成长） |

- 目标“全书 ≥60% 降幅”：1M 窗口 **-86.8%** 达标（9 批落在理想 10–20 区间）；200k 窗口需成长到 30% 后 -75.0% 达标。
- Opening 首次可玩：探针下 **3 批**（目标 1–5 批 ✓）。
- **实测密度口径**（真实 GLM smoke）：content 密度 ≈ 30%（4.7k out / 15.8k in），远高于 6% 初始假设——此时输出密度预算成为约束：以产品默认 16,384 content 输出（可用 13.9k）计，批输入上限 ≈ 46k token，全书约 21 批（仍 **-69%** vs 68）；声明更大 maxOutputTokens 的模型自动解锁更大批次。密度校准器会让批次在线收敛到该水平——系统按设计工作。

## 4. Playability Gate 与 TTFP

- `evaluatePlayabilityGate`：纯确定性（无“能不能开局”的付费请求）——检查核心人物/地点（带事实）、Canon 事实 ≥20、事件 ≥1、阻断性审查 =0。
- v2 阶段 run 每完成一批触发 `onBatchCommitted`：gate 通过 → 立即以已抽取的连续前缀发布 Opening Package（每世界进程内串行 + 已发布版本复核，恰好一次）→ “开始冒险”立即出现；后续批次继续后台构建。
- 固定“完成 30% 才能开局”的条件已移除。

## 5. 真实 API 最小 Smoke（≤ 少量请求，12-13 章子集）

### GLM（GLM-5.3-Flash）：PASS
- 31,773 cp / 31 chunks → **2 批**规划，3 次真实请求（2 抽取 + 1 映射）全部 200。
- 批 1：input 15,809 / output 4,702 / cached 384，60.7s；批 2：input 7,673 / output 3,228，44.6s。
- 提交 53 实体 / 37 事实 / 14 事件（证据链经 slice→chunk 归属校验）。
- **Gate：playable = true**。映射发布被 1 条 canon-conflict 阻断（质量门预期行为，进审查队列）。

### DeepSeek（deepseek-v4-flash）：链路 PASS / 配置需调优
- 3 批规划；1 批完成（33 实体/39 事实/8 事件，gate=true）；7 次请求后按 cap 停止。
- **发现**：v4-flash 每次推理消耗 12–15k token（reasoning 占比 ~85%），16k 输出预算下内容空间不足 → 触发储备 bump 重试与截断分裂（自适应阶梯全部按设计工作）。结论：DeepSeek 配置需声明更大 `maxOutputTokens`/content 预算——属 Provider/Capability policy 配置项（`reasoningPolicy` 已有方言机制承载），未在业务层散落 provider 分支。

密钥仅内存使用：未进 Git/SQLite/日志/报告/截图。

## 6. 项目化书库 UI

- 书库顶层 = 纯项目列表：`+ 导入小说` / `导入世界包` / 搜索 / 紧凑项目卡（章数 · 状态 · 更新时间 · 进入项目 / 继续冒险 / 开始冒险 · ⋯ 菜单）。全局 BuildTaskCard 堆叠已移除。
- `ProjectHubScreen`（新路由）：主按钮 + 仅本项目的构建任务卡（暂停/继续/停止/明细/高级详情）+ 资料/三宝书/审查/世界包入口（复用 WorldDetailScreen 各 Panel，未重写）。
- `ProjectStatusProjection`（`mobile/src/projectLibrary.ts`）：world + 任务 + 战役 + 审查的单一投影，UI 只消费投影。
- 任务 UI 去 chunk 化：主指标“LLM x/y 批 · 正在分析第 N 批”；高级详情展示 `章节 / 原文块 / LLM 批次（三者口径不同）`、当前批章节范围、平均响应、input/output/reasoning token、缓存命中量/比例、并发。
- 导入完成自动进入新项目 Hub；构建详情只在该项目内。
- 兼容：一个 World = 一个 Project（worldId 即 projectId），无新表；旧世界升级后自动成为项目。

## 7. 项目删除

- `ProjectDeletionService`（核心 `src/application/project/projectDeletion.ts`）：单事务级联删除 world 全部依赖（含 11 张无外键 branch 表、branches 子树、campaign 图、stage plans/states、runs/units、review、progressive deltas、llm 账本），提交后 `PRAGMA foreign_key_check` 必须 0。
- 共享 Source 保护：事务内按 run/stage-plan/其他世界引用计数，引用归零才删 `imported_sources`（segments/chapters/chunks 级联）。
- 构建中项目：`ProjectDeletionBlockedError` 阻止直删；UI“停止并删除”→ 持久化 stop → 等待执行器安全结束在途付费请求（≤30s 轮询，超时提示稍后重试，绝不强删）。
- 二次确认对话框完整列出十类被删数据 + “原始手机 TXT 文件不会被删除”。
- 幂等：重复删除 no-op 成功，不破坏 DB。

## 8. 模拟器 UI 测试（Medium_Phone / API 37.1 / debug APK + Metro）

| Case | 结果 |
|---|---|
| 1 项目列表（3 项目、搜索、进入/返回、无全局任务堆叠） | PASS |
| 2 项目构建隔离（Hub 只见本项目任务；批为主指标；B 构建期间 A 可玩） | PASS |
| 3 删除普通项目（完整二次确认；立即消失；重启后仍不存在） | PASS |
| 4 删除构建中项目（停止并删除流；无崩溃；无 ghost 通知） | PASS |
| 5 强杀重启（列表正确；A 可玩保留；C 任务可恢复） | PASS |
| 6 TTFP（批 1 完成 → Gate → “开始冒险”出现，不等 30%） | PASS |

设备 DB 终态核验：删除后 worlds/runs/sources/canon 仅剩存活项目，**foreign_key_check = 0**。logcat 无 FATAL/SQLite 约束/未处理 Promise 拒绝；无 Authorization/Bearer/小说正文输出。

## 9. APK 与自动测试

- APK：`dist/apk/debug/ShineWord-V0.4.1-debug.apk`（gradle assembleDebug PASS；debug 变体按项目约定经 Metro 加载 JS，`adb reverse tcp:8081`）。
- 自动测试：**566 / 566 PASS**（`npm run verify:core`），含新增：
  - `tests/analysis-planner-v2.test.cjs`（12）：大批合并/无 14·32 上限/100 chunks 单批/超长章切片/顺序/覆盖无洞无重/双路由/阶梯/密度校准/密度分裂/quote→member chunk 绝对偏移/replan 守护（completed 恰好一次）/TTFP 钩子仅阶段 run 触发。
  - `tests/project-deletion.test.cjs`（10）：任务 §36 A–O 全覆盖（共享 Source 双向、fk_check、幂等）。
  - `tests/project-projection.test.cjs`（1）：3 世界→3 项目、按世界 SQL 隔离、排序/搜索、战役/可玩状态。
- `npm run typecheck` / `npm --prefix mobile run typecheck` / `npm run verify:version` 全绿。

## 10. 额外发现（后续跟进）

1. **DeepSeek 输出预算**：建议 DeepSeek 预设将 `maxOutputTokens` 提至 ≥32k（推理模型内容空间）。
2. **章节口径小差异**：Hub 高级详情的“原著覆盖 N 章”（unit ranges 聚合）与项目卡章数（world mirror chapters）在 loose 切分小说上可能不同——展示层口径，非本轮回归，建议后续统一来源。
3. `mapper` 冲突审查（canon-conflict）在小书样本上出现率较高，世界包发布被正确阻断；可考虑为小书放宽冲突合并策略（产品决策）。
4. planner-v2 的 ratio 成长在“输出密度高”的模型上会被密度上限自然限制（设计使然）；声明大输出预算的模型才能吃到 30% 窗口批次。

## 工具

- `scripts/perf-dryrun.cjs`：新旧 planner 对比 dry-run（无 LLM、脱敏输出）。
- `scripts/llm-smoke.cjs`：真实 API 最小链路 smoke（`--key-file/--novel` 参数化，本地路径与密钥不进 Git；请求上限 + signal 熔断）。

## 11. Closeout（2026-10-01）

分支：`fix/project-library-closeout` → `main`。施工前 fetch 确认 main 为
`42185812c6c139ff50d71685da4261c978861c8c`，功能分支为
`e132a070e0b335b7042ffa5069047d00f31e3cdd`（ahead 3 / behind 0），无新增开放 PR。
本节覆盖上一轮验收发现的尾项；不重做 planner，不增加产品规则或数据库迁移。

### 修复与证据

- **Playability conflict preflight**：Gate 接受 `conflictFactCount`，同时直接检查 facts 的 conflict 状态，避免漏传或旧计数绕过。每批后的 TTFP Hook 保留，满足条件即可 Opening。
- **Mapping provider zero-call**：`buildPackageFromCanon` 在场景编译、付费 WorldMapper 请求前检查全世界 conflict，写入/更新 blocking `canon-conflict` 并给出固定、可恢复错误；保留 Canon，不发布 Package。确认 conflict → Provider 0 次调用 / 无发布；解决真实 conflict 后下一次 Mapping 成功，旧 issue resolve。正常 retry 的 stale issue 机制保留。
- **Library fast poll**：完整刷新负责 Session / Campaign / Branch / World / 项目投影。每 1.5 秒快速读取仅查询动态项目的本地 runs / units 更新时间 / worlds / published revision；不构造 Provider、不创建 Session、不查 Campaign/Branch、不访问网络或 Keychain。新 Opening 发布或 Run 完成后补一次完整刷新。合并只更新构建字段，保留 campaign、branch、playable、章数、标题和 package revision，直到完整刷新更新它们。
- **生命周期**：仅 focused 且存在 dynamic run 时启用单 timer；blur/unmount 清理 timer，忽略离焦后的异步结果；in-flight guard 串行化快速与完整刷新。首次进入、重新 focus、导入/删除完成及下拉刷新走完整刷新。
- **Project status aggregation**：Library 与 Hub 复用 `deriveProjectStatus` / 标签；review/failed/retry > running/queued > waiting > paused > stopped > completed。按 worldId 汇总全部有效 Run，含已完成阶段；canceled/superseded 历史不重复计入。Library 展示项目总完成/总批次，Hub 继续保留每个任务卡。
- **Project action menu**：Library / Hub 的 ⋯ 先打开项目操作菜单，选择“删除项目”才进入原有删除确认。生产组件事件测试确认三步分离。
- **Legacy source cleanup**：事务内按 `world.source_sha256 = imported_sources.raw_sha256` 补充候选 Source，继续原有 run / plan / world 引用保护。无 run/plan 的 legacy 项目删后无残留；共享 Source 删除第一个世界后保留、最后一个世界后删除。

### 自动验证

| 项目 | Closeout 结果 |
|---|---|
| `npm run verify:core` | **577 / 577 PASS**（原有全量 + 新增回归；0 skip） |
| Root typecheck | PASS |
| Mobile typecheck | PASS |
| `npm run verify:version` | PASS，0.4.1 / 40100 保持 |
| `git diff --check` | PASS |
| 本环境 Debug APK | NOT TESTED：未配置 Android SDK，构建命令在环境预检阶段退出 |
| GitHub Core Verify | **PASS**：[run 36772033269](https://github.com/anjingdtl/ShineWord/actions/runs/36772033269)，CI 同样 577 / 577，0 skip |
| GitHub Android Verify | **PASS**：[run 36772033217](https://github.com/anjingdtl/ShineWord/actions/runs/36772033217)，Mobile typecheck / `assembleDebug` 成功 |

测试位置：`analysis-planner-v2`（Gate conflict 输入与实际 facts）、`phase2-package-build`
（zero-call / 无发布 / Canon 保留 / conflict 解决后恢复）、`project-projection`
（多 Run 隔离与优先级 / 0→1 批 / running→paused / completion 单次完整刷新 /
Opening 提前发布 / timer 与请求生命周期）、`project-library-ui`（卡片显示和三步删除）、
`project-deletion`（legacy fallback / legacy shared source），均纳入全量 `verify:core`。

### 独立 Self Review

| 检查 | 结论 |
|---|---|
| A 已知 conflict 是否仍触发 WorldMapper | 否；Gate 与 Mapping preflight 双重拦截，zero-call 回归 PASS |
| B fast poll 是否调用 Session / Provider / Campaign / Branch | 否；生产快速读取路径计数回归 PASS |
| C 是否丢 campaign / branch | 否；合并保留稳定字段及 campaign 对象引用 |
| D Library / Hub 状态是否一致 | 是；共享同一聚合和状态投影函数 |
| E 多 Run 是否正确聚合 | 是；有效 Run 合计、worldId 隔离，旧 paused 不覆盖当前 running |
| F Legacy Source 是否清理 | 是；无 run / plan 回归 PASS |
| G Shared Source 是否保护 | 是；既有与 legacy 双世界回归 PASS，foreign_key_check = 0 |
| H planner-v2 是否回退 | 否；planner / coordinator 未修改，既有 ratio / 密度 / shrink / frozen run / TTFP 回归全通过 |
| I 密钥 / 真实小说 / 本地测试路径泄露 | 未引入；仅使用确定性测试夹具，本轮未调用真实 API |

Self Review 无剩余 P0/P1。

PR：[ShineWord #9](https://github.com/anjingdtl/ShineWord/pull/9)，保持开放、未合并。
上述 CI 验证的代码提交为 `1cdd0340163c7afd1b398136c121d4ad457f9213`；本节的最终报告提交只更新文档，代码树保持一致，最终 HEAD 的 CI 结果另在 PR Checks 核对。
