# C3 分组优化与可恢复映射

日期：2026-09-28。基于 C2 提交后的工作区。全部命令本机实测。

## 目标与出口（对照总控方案 C3 行）

全文覆盖、正确证据、超长章、预算、有限并发、限流、断点、跨批归并、usage 汇总；对照质量不回退。

## 实现

### 1. 预算驱动的分组规划（`src/application/worldBuild/groupPlanner.ts`）

- `ModelBudget`（contextWindow / maxOutputTokens / reserve）+ 每请求开销 → 组正文预算；保守 token 估算（最坏每码点 1 token，`estimateTokens` 对 CJK/ASCII 区分供校准用）。
- 连续块打包为组（默认上限 64 段/组），**覆盖账本不变量由构造保证并断言**：每个块恰落入一组、顺序不变。
- 章节 / 物理块 / 模型组三层解耦（计划 §7.1）：组携带 segments（chunkId、chapterId、范围），请求体 ≤ 预算。

### 2. 分段协议组抽取器（`src/application/world/llmGroupExtractor.ts`）

- 一次请求携带编号段 `[S<n> <章节标题>]`；模型返回 `segment` + 逐字 `quote`。
- 本地把 quote 定位到**其声称段内**的偏移并换算绝对码点；跨段错配（quote 存在但不在声称段）计为 `rejectedQuotes` 拒绝，不迁移、不采信。
- 事件/规则映射同样携带段归属（chunkId），供逐块提交归位。

### 3. 协调器组路径与截断拆分（`coordinator.ts`，`PIPELINE_VERSION = pipeline-closeout-c3`）

- `createExtractionRun(mode:'group')`：每组建一个 extract_group unit，input_hash=成员范围哈希（拆分后子单元按各自范围重算，避免 UNIQUE 冲突）。
- `executeRun`：多范围 unit 走组路径——先做逐块 done 快路径过滤（已完成块不进请求），构建 segments → 组抽取 → **按证据所属块分区**逐块走 C1 原子 `commitChunkResult`（部分组提交也按块崩溃安全）→ fenced unit 完成。
- 截断/超长错误（`truncation` 分类）：`replaceUnitWithChildren` 事务化对半拆分；父单元 canceled 且**退出有效计数**（`units_total + children - 1`，父与子不同时计数）；单块不能再拆时按退避重试/needs_review。
- 修复了组路径中的异步过滤缺陷（`filter` 内 Promise 恒真导致假完成——由回归覆盖）。

### 4. 映射分批可恢复与跨批归并（`buildPackageFromCanon.ts`）

- **逐批输入瘦身**：每批只带该批事实的 subject + 事实值中点名的实体 + 相关事件（≤300），不再每批携带全世界。
- **逐批 checkpoint**：批完成即写 `world_jobs(kind='rule_mapping', job-map-<world>-b<n>)`，contentHash=批事实 id 集 + mappingVersion 指纹；重跑只补未完成批（`skippedBatches` 记账）。
- **跨批归并**：同 entryId 后批并入 provenance（sourceFactIds 并集），定义冲突记 review 拒绝，不再 first-wins 静默丢弃。
- **usage 汇总**：逐批 usage 数组 + 跳过批从 checkpoint 恢复；多批聚合计数（单批保持原始形态，兼容既有断言）。

### 5. mobile

`sourceImport.ts` 建组模式 run，`runExtraction` 同时装配单块回退与组抽取器。

## 回归证据

| 门禁 | 结果 |
|---|---|
| `npm run verify:core` | **181 tests / 181 pass / 0 fail**（175 + 6 新增） |
| `npm run typecheck --prefix mobile` | PASS |

`tests/closeout-c3.test.cjs`（6 项）：

| 用例 | 覆盖 |
|---|---|
| 规划器 | 覆盖不变量、顺序、段数上限、预算上界、紧预算→更多组 |
| 分段协议 | 段内 quote→绝对偏移精确；跨段错配拒收（rejectedQuotes=1）；事件段归属 |
| 组模式端到端 | 多块组真实出现、run 完成、逐块 job done、世界 ready |
| 截断拆分 | 父 canceled、子补完、`units_done == units_total`（无重复计数）、世界 ready |
| 映射断点 | 批 2 失败→checkpoint 在；重跑仅 1 次请求、发布成功、usage 聚合 |
| 跨批归并 | 同 entryId 两批→单条目、两个 sourceFactIds 均保留 |

既有 175 项回归不回退（映射 usage 单批形态兼容、C2 协调器路径经异步过滤修复后恢复）。

## 边界与移交

- 有限并发 >1、429 Retry-After 精确遵循与真实 Provider 侧行为、双模型对照质量与请求/费用统计属 C7 实测；当前并发=1（顺序组）符合默认保守策略。
- 组模式的**真实模型质量对照**（1200cp 单块 vs 组请求的召回/引文质量）需要真实 LLM 样本，C7 用测试配置执行；合成 FixtureExtractor 不能替代。
- 映射尚未接入 run/unit 底座（用 world_jobs checkpoint 实现断点）；整合到统一 runner 是后续重构项，不影响当前断点正确性。
