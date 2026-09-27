# M3 Review / Fix 报告

日期：2026-09-27  
Review 分支：`phase/m3-novel-world`

## M3 实现范围

按建设方案第 4、5、12 节完整落地小说世界构建：

### 数据层（migration 003 world）

- `worlds`（源文件 SHA-256、normalize/chapter 版本、构建状态机）、`source_chapters`、`source_chunks`（偏移、字符数、内容哈希、抽取状态）。
- `entities` / `entity_aliases`（类型约束、别名评分与证据）。
- `canon_facts`（五类状态 explicit/inference/speculation/conflict/user_supplement、confidence、valid_from/valid_to/reveal_at/scope、value 判别键）/ `fact_sources`（章节 + 码点偏移 + 引文 + 引文哈希）。
- `canon_events`（世界时序、叙述章节、canon/pending/invalidated）/ `event_dependencies` / `divergence_markers`。
- `world_rule_mappings`（attribute/skill/power_tier/resource 四类映射 + 证据 + 规则版本）。
- `knowledge_records`（witnessed/told/public/inferred 四来源，NPC 认知基础，M4 接入可见性过滤）。
- `world_jobs`（任务恢复：内容哈希、抽取器版本、模型指纹、attempts、usage、结果、错误）。

### TXT 导入（`src/application/import/txtImport.ts`）

- 编码探测：BOM（UTF-8/UTF-16LE/BE）→ UTF-8 有效性探测 → GBK 回退。
- 归一化：换行统一、全角缩进剔除、零宽字符剔除、空行收敛（`normalize-1`）。
- 分章：标准（第X章/卷/回）→ 宽松（Chapter N / 1234、标题）→ 兜底（固定码点预算切段），策略随结果记录（`chapter-split-1`）。
- 分块：段落边界对齐、目标 1200 码点、SHA-256 内容哈希。
- 偏移体系：全书偏移为 Unicode code point 偏移（`CodePointOffsetIndex` 采样索引，O(n) 构建 / O(stride) 查询），杜绝 UTF-16 单元混用。
- 真实小说验证：《白篱梦》100 万字 / 300 章 / 944 块导入 94ms，章节偏移连续。

### 抽取与验证（`src/application/world/`）

- Extractor 协议：LLM 只输出实体提案 + 事实提案（含 verbatim 引文）+ 事件 + 规则映射；**模型不提供偏移**，本地把引文解析为绝对码点跨度。
- 证据校验：引文必须在归一化原文中逐字存在且跨度复现一致 —— source location = 100% 由本地强制，不依赖模型自觉。
- 状态策略：speculation 永不升为 canon；explicit 无有效证据即拒绝（记入 rejected）。
- 冲突策略：多值谓词（skill/relationship/owns_item）按值内判别键共存；单值谓词（home/faction/rank/…）值变化时新事实标记 conflict，旧事实保留。
- 实体合并：同名同类型仅产生候选（exact 1.0 / alias 0.9），不自动合并；合并需显式执行且禁止跨类型。
- 事件依赖：跨 chunk 全局解析；`markEventsPendingAfter` 把锚点事件之后的事件全部置 pending（进入游戏后原作事件不再视为必然）。
- 开局：原创角色（六属性基础 1 + 4 自由点、单项上限校验）/ 原著角色（位置取自 canon 事实、技能只来自世界映射且必须带证据引用，speculation/conflict 不参与）。

### 构建管线（`buildWorldFromTxt`）

- 每 chunk 一个任务：内容哈希 + 抽取器版本复用（同哈希同版本直接复用结果）、attempts 记录、失败标记 failed、重跑恢复。
- 并发 1~2，交互请求优先原则保持。
- 状态机 importing → extracting → merging（仅收集候选）→ ready。

### 设备端（mobile）

- 原生 `ShineWordFiles` 模块：SAF `ACTION_OPEN_DOCUMENT` 文件选择（仅 text/*）、ContentResolver 全量读取、64MB 上限、base64 桥接。
- `worldImport.ts`：设备端 UTF-8 手写解码（Hermes 无 TextDecoder）、GBK 明确报错提示转换、构建进度回调、世界书架 UI（预览：章数/字数/编码/SHA → 构建 → 摘要）。
- GLM Provider 适配：`vendorOptions.thinkingDisabled`（GLM 推理模型耗尽输出预算导致空 content 的问题）。

## Review 发现的问题与 Fix

1. **P1 分章边界**：文档开头即章节标题时标题被吞为"开篇"。修复：起始位置的标题直接命名第一章。
2. **P1 世界 resume 自毁**：`createWorld` 用 `INSERT OR REPLACE`，SQLite REPLACE 先 DELETE 后 INSERT，外键级联清空全部子表（chunks/jobs），重跑管线等于重置世界。修复：`ON CONFLICT DO UPDATE`。
3. **P1 动态 import**：`extractChunkText` 内 `await import(...)` 在 Metro 下尝试加载独立 chunk 报 "Could not load bundle"。修复：静态导入。
4. **P1 事件依赖跨 chunk 丢失**：依赖解析按单 chunk 事件表进行，后置事件的依赖全部被拒。修复：事件收集后全局解析再入库。
5. **P2 冲突误判**：同角色不同技能的境界事实（ability_tier {skill,tier}）被误判冲突。修复：多值/单值谓词分别按判别键/谓词整体判冲突。
6. **P2 GLM 空输出**：GLM-5.3-Flash 为推理模型，思考耗尽 maxOutputTokens 后 content 为空。修复：`vendorOptions.thinkingDisabled` + extractor 输出上限 6000。
7. **P3 Hermes 兼容**：core 中 TextEncoder / mobile 中 TextDecoder 缺失。修复：core 增加 `utf8Bytes` 纯实现；mobile 手写 UTF-8 解码，GBK 拒绝并提示。
8. **P3 测试适配器事务串行化**：Node 测试适配器并发事务互相踩踏。修复：与 RN 适配器一致的 promise 链串行化。

## 测试结果

### Core Verify

- tests: 54 / pass: 54 / fail: 0，typecheck pass
- 覆盖：编码探测（含 GBK）、归一化、码点偏移索引、小型/中型 fixture 分章分块与哈希、管线持久化与证据完整性（逐条引文 SHA + 跨度复现）、召回率（小型小说标注 25 条 → ≥90% 断言通过）、中型小说 286 条标注 → 200+ 事实入库与事件依赖失效传播、失败块恢复与成功任务复用（失败块 1 个、重跑仅重抽 1 块）、冲突/去重策略、证据篡改拒绝（篡改引文/跨度漂移/跨章越界）、speculation 保留、实体合并候选确定性（同名提案、跨类型拒绝、不自动合并）、两类角色开局（自由点上限、canon 位置与技能派生、speculation 排除、时间过滤）。

### 真实 LLM 世界构建（GLM-5.3-Flash，本地验证脚本）

- 素材：《白篱梦》（希行）前 3.6 万字 → 6 章 → 11 块。
- 结果：11/11 块成功，91 条事实全部通过证据校验入库（84 explicit / 7 inference）、72 实体、29 事件；拒绝提案 6。
- 结论：端到端真实管线（解析 → 抽取 → 证据校验 → 落库）在真实长篇小说上成立。

### Android 构建

- mobile typecheck PASS；`:app:assembleDebug` BUILD SUCCESSFUL（Gradle 9.3.1）。

### 模拟器 Smoke（Medium_Phone / API 37.1）

| # | 场景 | 结果 |
|---|---|---|
| 1 | 世界书架入口与渲染 | ✅ |
| 2 | SAF 文件选择器（原生模块）选 TXT | ✅ |
| 3 | 导入预览：章数/字数/编码/SHA-256 | ✅（4 章 830 字 utf-8，SHA 与宿主解析一致） |
| 4 | 真实 GLM 抽取（设备直连 API） | ✅（2 块 → 初次 4 块含标题自动提取） |
| 5 | 构建摘要：实体 29 / 事实 40 / 事件 8 / 失败块 0 / 拒绝 1 | ✅ |
| 6 | 设备 DB 证据完整性 | ✅（40 条事实 40 条 source，全部带引文哈希） |
| 7 | 事件时序（order）落库 | ✅ |

（首次设备构建发现动态 import 与设备旧 schema 两个问题，修复 + 清数据后全绿；失败原因链保留在 world_jobs.error 中。）

## 已知限制

- 设备端仅支持 UTF-8 小说，GBK 提示先转换（Hermes 无 TextDecoder；原生解码桥接后置）。
- 实体合并为候选收集，未接入 UI 审核流（M4 世界管理页处理）。
- `world_rule_mappings` 的 LLM 映射提案字段由 extractor 输出但管线尚未消费入库（入库接口已就绪，M4 成长系统接入时启用）。
- `knowledge_records` 已建表并有写入接口，可见性过滤随 M4 Memory/NPC 认知实现。
- 20 万字全书基准与 100 万字压力测试（构建侧）按计划归入 M5 性能验收；M3 已验证 1M 字导入 94ms。
- 200 条人工标记事实测试集由自创 fixture + 生成器构成（286 条），真实小说的标注集验收以 GLM 抽样人工核对代替（44/91 条抽样内容与原文一致）。

## M3 出口结论

建设方案出口条件"测试原著能生成可检查世界并创建两类角色"已满足：

- 真实小说（《白篱梦》）经真实 LLM 抽取生成可检查世界：事实 100% 带证据定位，speculation 与 conflict 隔离。
- 两类角色开局实现并有测试：原创角色点数受限分配、原著角色从 canon 事实与映射派生且不泄露未掌握能力。
- 时间边界：事件依赖 + `markEventsPendingAfter` 保证进入游戏后原作后续事件降级为候选。
- 设备端 SAF 导入 → 构建 → 持久化闭环在模拟器全部通过。
