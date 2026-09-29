# 1M 全书驻留构建：云端 Agent 施工提示词

复制下面整段给云端 Agent（Codex Cloud / Devin 等）。它会克隆远端仓独立施工，走分支 + PR，不直推 main。

```text
请在仓库 https://github.com/anjingdtl/ShineWord 完成「全量构建按 1M 大模型重新设计（全书驻留构建）」的施工：实际实现、测试、审查与交付，不要只重写方案。

【工作方式与基线】
- 克隆仓库后，基于最新 origin/main 创建分支 feature/1m-resident-build（本提示词撰写时 main 为 b64c406；main 可能已前进，一律以克隆时最新为准）。
- 所有工作在该分支提交；完成后推送分支并向 main 开 PR。禁止直接 push 到 main。若施工期间 main 前进，PR 前 rebase 到最新 main。
- 提交信息风格遵循仓库历史（type(scope): summary，如 "feat(worldBuild): ..."）。禁止 --no-verify。
- 注意：另一 Agent 在作者本地工作区有未提交的在建修改（mobile UI 与 campaign 交互层），它们不在远端仓，你看不到也不需要它们；不要尝试还原或等待。

【设计依据（必读）】
- docs/Shine-TRPG_1M_RESIDENT_BUILD_PLAN.md —— 最终建设方案（在仓内，b64c406 起）。本任务即实现该文档。其中的模型规格、预算公式、四段流水线、改动清单、风险与验收指标以它为准。
- docs/Shine-TRPG_SKILL_GENRE_BINDING_AGENT_PROMPT.md —— 背景参考。本任务只承接其中"ruleMappings 落库"这一基础设施（见 P4），不做其 P1（渐进开局题材技能）——那是紧随其后的独立任务，不要顺手做。

【已核实的事实基线（行号基于 b64c406；如漂移以符号名定位，开工先 git log 确认）】
- 打包器：src/application/worldBuild/groupPlanner.ts:71-126 planExtractGroups 只按输入窗口打包（bodyBudget = contextWindow − maxOutputTokens − reserveTokens − overhead），maxGroupSegments 默认 64；DEFAULT_MODEL_BUDGET（21-25 行）为 128k/8k/2k。estimateTokens 保守按 1 token/CJK 码点。
- 输出硬钳：src/application/worldBuild/profileModelBudget.ts:20 Math.min(configured, DEFAULT_GROUP_MAX_OUTPUT_TOKENS)；src/application/world/llmGroupExtractor.ts:22 DEFAULT_GROUP_MAX_OUTPUT_TOKENS = 8_000。GROUP_SYSTEM（24-36 行）schema 已含 ruleMappings 字段；LlmGroupExtractor 在 92 行起。
- 协调器：src/application/worldBuild/coordinator.ts executeRun（230 行起）主循环严格串行（claimUnit → LLM → commit → 下一个）；租约获取/续期 237-272；截断事务性对半拆分 413-445；isChunkDone 幂等快速路径 533-543；commitGroupResult 按 chunk 分区提交 577-614；commitResolvedChunk 的 worldStore.commitChunkResult 单事务在 617-664。错误分类 classifyExtractionError 666 行起，已有 truncation/rate_limit/config 类。
- 抽取落库：src/application/world/extraction.ts ResolvedExtraction（57-62 行）不含 ruleMappings —— group.ruleMappings 在 coordinator.ts:602 被组装进 ExtractionResult 后在此丢弃。checkEvidence（33-51 行）做逐字+码点区间比对，是"来源定位 100%"的硬保证，不得放宽。
- 规则映射存储：src/application/ports/worldStore.ts:133-142 StoredRuleMapping、186-187 saveRuleMapping/listRuleMappings；src/infra/sqlite/sqliteWorldStore.ts:733 有完整实现；表 DDL 在 migrations/003_world.sql:140 与 src/infra/sqlite/builtinMigrations.ts:250（两处必须保持一致）。生产代码当前零调用方。
- 全书映射（现有）：src/application/worldPackage/buildPackageFromCanon.ts CANON_MAPPER_ROLE（135）、MAPPER_SYSTEM（137-155）、调用点 772、MAX_PROMPT_FACTS=800（133）、MAPPING_MAX_OUTPUT_TOKENS=6000（134）、cleanSkill 352-391（attribute 六属性归一化、powerTier ∈ {ordinary,enhanced,supernatural}，否则整条 reject）、DEFAULT_SKILLS 168-177、补位 1049-1053、cleanProvenance 275-291。
- 能力探测与 provider：src/application/llm/capabilities.ts probeCapabilities（当前硬编码 128k/8192 返回）；src/application/llm/types.ts LlmProviderCapabilities（contextWindow/maxOutputTokens）；src/application/llm/openAICompatible.ts OpenAICompatibleProvider。错误侧已有 completionState: 'reasoning_only' 分支（coordinator.ts safeProviderFailureText 686-694 有对应文案）。
- 移动端入口：mobile/src/sourceImport.ts runExtraction（608 行起）调 executeRun；createExtractionRun 调用在 189-203（mode:'group'、budget: modelBudgetFromProfile(profile)）；mobile/src/profileStore.ts 为 profile 存取。
- 测试门禁：npm run verify:core = typecheck + 构建 + node --test tests/*.test.cjs（38 个测试文件，当前全绿）；mobile 侧 npm --prefix mobile run typecheck；迁移双写由 tests/migrations.test.cjs 校验。

【施工内容（按 P0→P5 分阶段，每阶段"实现→测试→Review→Fix→回归→独立提交"）】

P0 预算模型与打包器 v2
- ModelBudget 扩展字段：maxContentOutputTokens（默认 16,384）、reasoningReserveTokens（GLM 初始 2,048；non-thinking 0）、reasoningEffort（'off'|'low'|'high'）、supportsPromptCache（probe 判定）。打包公式：bodyBudget = contextWindow − maxContentOutputTokens − reasoningReserveTokens − reserveTokens − overhead。
- planExtractGroups 改为输出预算驱动：chunksPerGroup = clamp(maxContentOutputTokens × 0.7 / estOutputPerChunk, 4, maxGroupSegments)；maxGroupSegments 默认改 32（含义变为证据归属可靠性上限）。estOutputPerChunk 初值 800，用 unit usageJson 实测在线校准（前 3 单元后一次，之后每 10 组滑动）。
- 解除 profileModelBudget 与 llmGroupExtractor 的 8k 硬钳，改由 budget 注入。

P1 provider 请求层
- types/capabilities/openAICompatible：请求透传 reasoning 参数——DeepSeek 系 non-thinking 开关、GLM 系 reasoning_effort 与 thinking.clear_thinking=false；GLM 侧 max_tokens = maxContentOutputTokens + reasoningReserveTokens，且距模型输出上限留 ≥8k 安全边际。
- usage 采集细分：completion_tokens_details.reasoning_tokens 与 prompt_tokens_details.cached_tokens 落入 LlmPhysicalRequestMetric 与 unit usageJson。
- probe v2：同一长提示（≥1024 token）连发两次，cached_tokens>0 判定支持前缀缓存；探测输出上限行为。探测不出的字段允许 profile 手工声明。

P2 coordinator：resident 模式 + 并发
- CreateRunInput 新增 mode:'resident'。resident 单元请求结构：messages[0]=system（静态）、messages[1]=user（全书规范化正文）、messages[2]=user（范围指令），前两条全 run 字节级稳定（同一规范化文本、同一路径读取，禁止逐单元拼接差异）。
- 模式选择：全书估算 token + 开销 ≤ contextWindow×0.85 → resident，否则 windowed（即 P0 修复后的 group 模式）；probe 判定无缓存支持时 resident 自动退化 windowed，并在 run 记录中注明。
- N worker 并发执行单元（默认 3，profile 可配 1–4）：复用现有租约（后台续期）与 claimUnit 原子认领；commitChunkResult 保持逐 chunk 单事务。调度约束 N × 每请求 prompt tokens ≤ TPM×0.7（保守按缓存流量也计入 TPM）。429 走既有 rate_limit 退避。
- reasoning_only 截断分支改为：先把 reasoningReserveTokens 升一档重试一次，仍失败再事务性对半拆分。
- 单元必须背靠背连续执行以保活缓存；暂停超 TTL 续建重付一次 prime 为已接受行为（不另做优化）。

P3 Pass 0 全书实体注册表
- 新增 src/application/world/bookRegistry.ts：resident 模式下一次请求产全书人物/势力/地点/能力体系清单（JSON，输出 ≤8k），落库为 entity 种子（走既有 upsertEntity，provenance 标注 rule_mapping）。
- 范围抽取请求注入注册表摘要："实体 key 优先使用注册表"，降低跨组碎片化；entityMerge 逻辑不变。

P4 Pass 2 全书规则映射 + ruleMappings 落库（同时关闭技能题材绑定的 P0）
- applyExtraction 保留并解析 ruleMappings：targetKey 经 entity 解析为 targetEntityId；evidenceRefs 逐条做 checkEvidence 同级校验（逐字+码点区间），失败记 rejected，不得阻塞同 chunk 的 facts/events 提交。
- 扩展 CommitChunkResultInput 新增 ruleMappings 字段，在 commitChunkResult 同一事务内 INSERT ... ON CONFLICT 落 world_rule_mappings；mappingId 稳定派生（map-${worldId}-${targetEntityId}-${mappingKind}-${skillOrAttributeToken}）保证幂等；rulesetVersion 写当前 SHINEWORD_RULESET_VERSION；status='active'。
- WorldMapper V2：resident 模式下以全书视野执行规则映射（复用 MAPPER_SYSTEM 与 cleanSkill/cleanProvenance 清洗链、validate 发布门），产出 skills 等条目与 ruleMappings；解除 MAX_PROMPT_FACTS=800 的输入截断。windowed 模式保持现有批量映射路径不变。

P5 Pass 3 时间线 + profile 预设与文档
- 时间线 pass：全书视野补 event 依赖/排序（1 请求，输出仅提议，本地 resolveEventProposals 的既有规则兜底）。
- mobile profileStore + 设置 UI：新增 DeepSeek V4.1 Flash 与 GLM-5.3-Flash 预设（contextWindow 1,048,576；输出/思维链/并发档位按方案文档第三节）。
- 更新 docs/DEVELOPMENT_STATUS.md；新增 docs/reviews/ 施工报告（含决策记录与未取证项清单）。

【验收标准（必须给出可复现命令与输出）】
1. npm run verify:core 全绿（含新增测试）；npm --prefix mobile run typecheck 通过；tests/migrations.test.cjs 通过。
2. 新增回归测试至少覆盖：
   T1 打包器：944 chunks（每块 1,200 码点）+ 1M 预算，组大小由输出预算决定（估算输出 ≤ 预算×0.7），不再触发 64 段上限；16k 输出档下组内 chunk 数 ∈ [4, 32]。
   T2 前缀稳定：mock provider 记录全部请求体，断言 resident 各单元 messages[0] 与 messages[1] 字节一致。
   T3 reasoning 透传：DeepSeek profile 请求带 non-thinking；GLM profile 带 reasoning_effort=low 与 clear_thinking=false，max_tokens = 内容预算+预留。
   T4 并发幂等：2 worker 跑同一批单元，每 chunk 仅提交一次；world_rule_mappings 重复提交行数不增。
   T5 ruleMappings 落库：走"抽取→提交"生产通路（不直接调 saveRuleMapping），证据校验失败记 rejected 且不阻塞 facts；保留 tests/phase2-acceptance.test.cjs:397 既有语义。
   T6 reasoning_only：第一次触发升预留重试，第二次仍失败才对半拆分（mock 模拟）。
   T7 缓存探测退化：cached_tokens=0 时 resident 自动退化 windowed 并记录原因。
   T8 诚实性：design_fill 不标 explicit；checkEvidence 未被放宽（错引事实仍被丢弃）。
   测试语料用 tests/fixtures/ 小样或合成语料，单个 ≤50KB，禁止提交第三方小说全文。
3. 端到端证据：若真实端点（DeepSeek V4.1 Flash 或 GLM-5.3-Flash）可用，跑一次 100 万字级语料全量构建，记录：请求数、截断拆分次数（目标 ≤2）、prime 后 cached_tokens 命中率（目标 >80%）、GLM reasoning_tokens 均值（目标 ≤1.5 倍预留）、端到端耗时（目标 ≤20 分钟，并发 3）、费用与方案文档第八节账对照。端点不可用则如实列为未验，不得用单元测试冒充端到端验收。
4. PR 描述包含：改动摘要、各阶段提交列表、T1–T8 证据、端到端数据或未验声明、未取证项清单。

【硬约束（不可破坏）】
1. 确定性：骰点由本地引擎以设备安全随机数产生，RollRecord 先持久化再调叙事模型，同一行动永不重掷。本任务不应触碰该路径，若意外涉及必须说明。
2. 模型只能提议，本地是唯一权威：不得放宽 cleanSkill 枚举闸门、cleanProvenance 过滤、checkEvidence 逐字比对、validate 发布校验中的任何一条。
3. 无证据条目不得冒充 explicit；design_fill 如实标注。
4. 分支隔离与正史不可变：canon_events 不被分支改写。
5. 存档兼容：saveFile 禁入键扫描不得绕过；旧存档必须可读。
6. 迁移幂等且双写（migrations/*.sql 与 builtinMigrations.ts 一致）；已发布 APK 的存量 shineword.db 必须能升级。本任务预期不需要新表（world_rule_mappings 已存在），如确需 schema 变更必须单独说明理由。
7. 密钥只存 Keychain；不得把小说原文、API Key、Authorization 或原始模型响应写入日志、数据库、存档、截图或 PR 描述。

【禁止事项】
- 不得用题材关键词硬编码字典生成技能；一切技能从抽取事实映射而来。
- 不得放宽任何既有校验让测试变绿；不得删除或改写 tests/phase2-acceptance.test.cjs:397 的既有断言。
- 不得修改 dist/ 构建产物；不得跳过 hooks；不得直接 push main；不得 force-push 共享分支。
- 不得提交第三方小说全文、密钥、端点地址以外的任何敏感信息。
- 不得做超出本提示词范围的"顺手优化"（特别是渐进开局的题材技能、六属性扩展）；发现另行记录为后续项。

【交付物】
feature/1m-resident-build 分支 + 向 main 的 PR；分阶段提交；verify:core 与 mobile typecheck 完整输出；T1–T8 证据；端到端数据或未验声明；docs/reviews/ 施工报告（含未取证项清单）。
```

---

## 使用说明

- 提示词内 `文件:行号` 已在本仓库 main@b64c406 核实；云端 Agent 以符号名定位为准。
- 本提示词与 `docs/Shine-TRPG_1M_RESIDENT_BUILD_PLAN.md`（设计）、`docs/Shine-TRPG_SKILL_GENRE_BINDING_AGENT_PROMPT.md`（技能题材绑定，后续任务）配套。
- 云端 Agent 需要仓库的读写权限（开 PR）；模型端点不可用时它会按提示词如实标注未验项。
