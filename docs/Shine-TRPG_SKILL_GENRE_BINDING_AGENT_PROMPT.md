# 技能与导入小说题材绑定：自主施工提示词

复制下面整段给负责实现的本地Agent：

```text
请在 E:\AiWorkSpace\ShineWord 自主完成“技能与导入小说题材绑定”的建设，实际实现、测试、审查与交付，不要只重写方案。

审查基线：HEAD 5a75379（2026-09-29，docs(closeout): publish r7 device progress）。开工先跑 git status / git log 确认工作区，保留用户未提交的修改，不假设源码与基线一致。

【一、产品目标】

用户导入任意题材的小说 TXT（修仙、科幻、武侠、悬疑等）。无论走“完整构建”还是“渐进开局”，玩家在角色设定阶段能选择的技能都必须来自这部小说本身，并可溯源到原著证据。禁止出现：导入科幻小说，可选技能却是剑术、医术、潜行这一套。

【二、已核实的事实基线（不必重新调研，但必须用测试复核）】

技能条目挂在世界包上，不是固定表：
- src/domain/characters/card.ts:61  SkillCatalog = Record<string, SkillDefinition>；SkillDefinition 见 src/domain/content/types.ts:163。
- src/domain/characters/card.ts:93  createOriginalCard，第114-118行：任一 initialSkills 不在 catalog 即抛 "Unknown skill ... the world must define every learnable skill."。
- src/domain/characters/card.ts:7   INITIAL_SKILL_BUDGET = 3（初始技能上限3项，novice）；SKILL_RANK_DIE 为 d4–d12。
- src/domain/characters/card.ts:238 rollSpecForSkill：技能定义里的 attribute 决定骰数、rank 决定骰面；SkillNotDefinedError/SkillNotTrainedError 在208/216行。
- src/domain/characters/card.ts:229 resolveSkillKey 兼容 "x" 与 "skill-x" 两种写法。

catalog 的 key 约定（重要，别踩坑）：
- src/application/campaign/createCampaign.ts:144-151 只取 kind==='skill' && visibility==='public' 且 isEntryVisibleAtAnchor 通过的条目；同时以 entry.entryId（如 skill-stealth）和去前缀形式（stealth）两个 key 写入 catalog。
- 同文件 156行 publicSkillIds = new Set(Object.keys(catalog))；canon 卡片在244-245 / 296-297行按此集合过滤技能。
- 结论：world_rule_mappings.mapping.skillId 写 stealth 或 skill-stealth 都能通过过滤，但必须与 catalog 的 key 一致，或能被 resolveSkillKey 解析。

可见性默认值与锚点规则：
- src/application/worldPackage/buildPackageFromCanon.ts:227-245 makeEntry，visibility 默认 'public'。
- src/application/campaign/recruitment.ts:59-66 isEntryVisibleWithFactIndex：要求条目 provenance 及其 fieldProvenance 引用的“全部” sourceFactIds 在该锚点可见；当 sourceFactIds 为空数组时 every() 返回 true，所以 design_fill 条目在任何锚点都可见。
- 推论：mapper 产出的、证据来自后段章节的技能，会在早期锚点被系统隐藏（这是当前实现，也是 P2 要处理的耦合）。

路径A：完整构建有题材映射
- buildPackageFromCanon.ts:135 CANON_MAPPER_ROLE = 'WorldMapper'；提示词 MAPPER_SYSTEM 在137-155行，要求输出 skills[]，字段为 id/name/description/attribute/allowUntrained/requirements/powerTier/provenanceKind/evidenceFactIds/rationale。
- 模型调用在772行；输入事实上限 MAX_PROMPT_FACTS = 800（133行），输出上限 MAPPING_MAX_OUTPUT_TOKENS = 6000（134行）。
- 本地清洗 cleanSkill 在352-391行：attribute 必须归一化进六属性（ATTRIBUTE_SYNONYMS，79行），powerTier 必须属于 {ordinary,enhanced,supernatural}（POWER_TIER_SYNONYMS，95行），否则整条 rejectEntry。
- src/application/llm/types.ts:3 已把 'WorldMapper' 列入角色枚举；调用点另有 mobile/src/sourceImport.ts:692 与 mobile/src/worldImport.ts:363。
- 兜底：DEFAULT_SKILLS 在168-177行（8项题材无关技能：潜行/剑术/医术/交涉/观察/学识/坚韧/运动），provenanceKind = design_fill；补齐逻辑在1049-1053行，仅补 mapper 未采纳的 id。

路径B：渐进开局没有题材映射（当前默认路径）
- src/application/worldPackage/progressiveOpening.ts:94-103 DOSSIER_SYSTEM 明文：“不得创建或改写骰点、属性、技能、成长、伤害或其他游戏规则；规则由本地规则集提供。”
- progressiveOpening.ts:263 compileProgressiveOpeningPackage，第328行 const entries = createProgressiveBaselineEntries(); 技能只来自 DEFAULT_SKILLS；随后只追加 lore 与 scene 两条条目。
- 该函数以 buildScope.strategy='progressive'、scope='opening' 发布。
- progressiveOpening.ts:16 OPENING_EVIDENCE_BUDGET_CODE_POINTS = 1600；提示词要求4个 quote 逐字出自开头1600码点内。
- progressiveOpening.ts:320-325 有注释说明为何开篇事实的 revealAt 必须为 null（否则 location 查询为空、开局向导死路）。

路径C：原著角色通路已断开（本任务的核心缺陷）
- src/application/ports/worldStore.ts:133-142 StoredRuleMapping；186-187行 saveRuleMapping / listRuleMappings。
- src/infra/sqlite/sqliteWorldStore.ts:733 有 saveRuleMapping 完整实现；表 world_rule_mappings 的 DDL 见 migrations/003_world.sql:140 与 src/infra/sqlite/builtinMigrations.ts:250。
- 但 saveRuleMapping 在生产代码中零调用方；全仓唯一调用是 tests/phase2-acceptance.test.cjs:397。
- 抽取阶段：src/domain/world/types.ts:122-127 ExtractionResult 含 ruleMappings；src/application/worldBuild/coordinator.ts:602 把 group.ruleMappings 组装进 ExtractionResult；但 src/application/world/extraction.ts:90 的 applyExtraction 返回体 ResolvedExtraction（57-62行）不含 ruleMappings，该字段在此被丢弃。
- 消费端：src/application/campaign/createCampaign.ts:214 listRuleMappings -> src/application/world/opening.ts:60 buildOpening。canon 分支159-170行按 mappingKind==='skill' 取 mapping.mapping.skillId 与 rank，并要求 evidenceRefs 全部在该锚点可见；172-186行取 mappingKind==='attribute' 的属性值，缺失则回落 BASE_ATTRIBUTE_POINTS = 1（opening.ts:6）。
- 已确认后果：生产环境 world_rule_mappings 恒为空 -> canon 主角 skills 为 {}、六属性全部为1。

校验与溯源现状：
- src/application/worldPackage/validate.ts:60-63 要求 provenance.kind 与 rationale 非空；66行要求 entryId 无空白；不校验 sourceFactIds 非空。
- buildPackageFromCanon.ts:275-291 cleanProvenance 只把 evidenceFactIds 过滤到 ctx.knownFactIds，允许空数组。
- src/application/world/extraction.ts:33-51 checkEvidence：source.sliceRange(startOffset, endOffset) 与 quote 不等即失败、事实整条丢弃。这是“来源位置100%”的硬保证，不得放宽。
- UI 溯源：mobile/src/ui/features/world-detail/WorldBooksPanel.tsx:65-71 PROVENANCE_LABELS（原文/归纳/规则映射/设计补全/用户设定），423行渲染“来源：…”。
- 存档禁入键：src/application/export/saveFile.ts:108 FORBIDDEN_SAVE_KEYS = apikey/api_key/key/secret/token/authorization，118行命中即抛。不得绕过。

工程门禁与约定：
- npm run verify:core = typecheck + 构建 + node --test tests/*.test.cjs（现有38个测试文件），当前全绿。
- mobile/ 有独立 typecheck（npm --prefix mobile run typecheck）。
- 迁移必须双写：migrations/*.sql 与 src/infra/sqlite/builtinMigrations.ts 内容一致，tests/migrations.test.cjs 会校验。
- src/domain/rules/ruleset.ts 当前 SHINEWORD_RULESET_VERSION = '0.2.0'；六属性名见 src/domain/rules/types.ts:12 AttributeName。

【三、必须解决的问题】

P0 打通规则映射落库，让原著角色开局真正拿到原著技能
- 让 applyExtraction 保留并解析 ruleMappings：targetKey 经 entity 解析为 targetEntityId；evidenceRefs 必须做与事实同等强度的校验（对每条引文执行 checkEvidence 式逐字+码点区间比对），无法解析的记入 rejected 且不得阻塞同 chunk 的事实/事件提交。
- 解析结果随同一事务落库：优先扩展 src/application/ports/worldStore.ts:118 CommitChunkResultInput，新增 ruleMappings 字段，并在 sqliteWorldStore.commitChunkResult（端口方法见同文件217行）的事务内 INSERT ... ON CONFLICT。不要做“先提交 chunk、再单独写映射”的双写，否则崩溃时静默不一致。
- mappingId 必须稳定派生以保证重复抽取/续跑幂等，例如 map-${worldId}-${targetEntityId}-${mappingKind}-${skillOrAttributeToken}。
- rulesetVersion 写当前 SHINEWORD_RULESET_VERSION；status 写 'active'。
- 保持 tests/phase2-acceptance.test.cjs canon 用例的语义不变，并新增一条“不直接调用 saveRuleMapping、而走抽取->提交生产通路”的测试。

P1 让渐进开局也具备题材技能
- 在 compileProgressiveOpeningPackage 发布前新增一步“开篇范围规则映射”：输入限定为开篇范围内的证据事实，复用 WorldMapper 提示词与 cleanSkill 清洗链路，产出 skills[]（必要时可含 actorTemplates/items）。
- 产出条目仍须 provenance + evidenceFactIds，visibility 默认 public，并同样写入 world_rule_mappings 供 canon 角色使用。
- 时序约束（关键）：玩家选择初始技能发生在 createCampaign，之后只能通过学习获得新技能。所以题材技能必须在开局包首次发布时就包含，不能设计成“后台慢慢补技能”，否则玩家永远选不到。
- 技能条目必须能通过 isEntryVisibleAtAnchor：保持开篇事实 revealAt = null 的既有处理，不要为了可见性放宽该规则。
- 不得因此放开 DOSSIER_SYSTEM 的既有禁令：场景与叙事文本仍不得由模型改写规则数值。技能条目的 attribute/powerTier 属 rule_mapping 级数据，必须标注 rule_mapping，不得标成 explicit。

P2 解开“技能定义可用性”与“剧情时间锚点”的耦合
- 现状：isEntryVisibleWithFactIndex 要求条目引用的全部事实在锚点可见。若一条技能的证据来自第300章、开局锚点在第1章，该技能会被隐藏，玩家在开局看不到 —— 这与“技能应反映固有可学能力”相冲突。
- 必须显式决策并实现其一（见 D1），并配对照测试。

P3 溯源展示
- 确认玩家可见的开局选技能界面能标注来源类型（复用 PROVENANCE_LABELS）；若未展示，补上，保证“这条技能是原著原文/归纳/规则映射/设计补全”对用户可见。

【四、必须显式决策的开放问题（不许跳过，必须在报告中写明选择与理由）】

D1 技能条目的证据绑定粒度与可见性策略：
  (a) 技能条目 provenance.sourceFactIds 引其首次出现的事实 —— 最严格，但直接受 P2 影响；
  (b) 技能条目证据留空、另建 lore 条目承载证据 —— 开局可见性不受锚点限制，但弱化“技能有原著依据”的可核查性；
  (c) 引入独立的“技能可用时点”字段（如 availableFromOrder），与证据可见性解耦，可见性只看该字段。
  建议 (c)，但必须评估迁移成本与存档向后兼容，并在报告中说明。
D2 六属性是否可扩展：当前硬编码6项（buildPackageFromCanon.ts:68、domain/rules/types.ts:12 AttributeName）。题材特有维度（灵根、义体等级）是否新增为属性？建议本期不做，仅列为后续项，理由是牵动 ruleset、卡片、存档与 UI 三处。
D3 渐进开局新增技能对既有战役的可见性：已开局战役 packageRevision 已锁定。建议新增技能仅对新建战役生效，老战役保持只读一致；若选择其他方案，说明兼容路径。
D4 技能目录是否允许随内容版本演进：BranchContentManifest 已有 contentVersion/deltas（src/domain/content/types.ts:89、progressiveDelta.ts）。若允许增量追加技能，必须同时明确 createOriginalCard 之外的学习途径（trainSkill）与存档往返语义。

【五、硬约束（不可破坏）】

1. 确定性：技能生成不得影响骰点。骰点仍由本地引擎以设备安全随机数产生，RollRecord 先持久化再调用叙事模型，同一行动永不重掷（src/application/turns/resolveOrReuseRoll.ts、commitTurn.ts）。
2. 模型只能提议，本地是唯一权威：不得放宽 cleanSkill 的枚举闸门、cleanProvenance 的过滤、checkEvidence 的逐字比对、validate.ts 的发布校验中的任何一条。
3. 不得让无证据条目冒充 explicit；design_fill 必须如实标注。
4. 分支隔离与正史不可变：canon_events 不被分支改写，分歧走 branch_canon_overrides。
5. 存档兼容：saveFile 的禁入键扫描不得绕过；旧存档必须可读。
6. 迁移幂等且双写，已发布 APK 的存量 shineword.db 必须能升级。
7. 密钥只存 Keychain；不得把小说原文、API Key、Authorization 或原始模型响应写入日志、数据库、存档或截图。

【六、验收标准（必须给出可复现命令与输出）】

1. npm run verify:core 全绿（含新增测试）；npm --prefix mobile run typecheck 通过。
2. 新增回归测试至少覆盖：
   T1 两条题材不同的语料经完整构建后，技能集合不同，且各含至少1条 sourceFactIds 非空的技能。
   T2 渐进开局：仅用开篇范围发布的开局包中含至少 M 条非 DEFAULT_SKILLS 的题材技能（M 由你按语料可行性标定并在报告说明理由）。
   T3 原著角色开局：走 createCampaign -> buildOpening canon 分支，断言技能非空，且每条技能的 evidenceRefs 在该锚点可见。
   T4 防泄漏：构造一条晚于锚点的证据事实，断言其对应映射不生效（技能不出现）。
   T5 幂等：同一 chunk 重复提交两次，world_rule_mappings 行数不增加。
   T6 迁移：tests/migrations.test.cjs 通过；构造含既有空 world_rule_mappings 表的旧库，升级后可读。
   T7 无密钥泄漏：跑一次存档导出，断言禁入键扫描仍生效。
   T8 provenance 真实性：断言 design_fill 技能不会被标为 explicit。
   测试语料可用 tests/fixtures/ 下小样或新增两个合成语料，单个不超过 50KB，禁止提交第三方小说全文。
3. 端到端证据：用真实端点跑一次“导入 -> 完整构建 -> 开局”和一次“导入 -> 渐进开局 -> 开局”，记录命令、耗时与两条路径的技能列表差异。若端点不可用，如实列为未验，不得用单元测试冒充端到端验收。
4. 更新 docs/DEVELOPMENT_STATUS.md；新增或更新对应 docs/reviews/ 报告。
5. 报告必须包含 D1–D4 每条决策的选择与理由，以及未取证项显式清单。

【七、禁止事项】

- 不得用题材关键词硬编码字典（“含‘修仙’则加技能”之类）。必须数据驱动：一切技能从抽取事实映射而来。
- 不得放宽任何既有校验以让测试变绿，尤其不得绕过 checkEvidence 或把 needs_review 改名成 published。
- 不得修改 dist/ 构建产物；不得跳过 hooks（--no-verify）。
- 不得删除或改写 tests/phase2-acceptance.test.cjs:397 这条既有断言来适配新实现；如确需调整，须在报告中说明理由并保留原语义。
- 不得清理用户设备或数据库。scripts/full-novel-build.cjs 会删除目标目录旧库，禁止对含既有成果的目录使用。
- 不自动推送远端，不公开发布。

【八、交付物与提交粒度】

- 源码改动 + 迁移（migrations/ 与 builtinMigrations.ts 双写）+ 新增测试。
- 按 P0 -> P1 -> P2 -> P3 分阶段实施，每阶段走“实现 -> Review -> Fix -> 回归 -> 证据 -> 独立提交”。
- 交付分阶段报告与最终报告、npm run verify:core 与 mobile typecheck 的完整输出、题材对照实测证据（技能集合差异）、未取证项清单。
- 稳定不变的部分（骰点、成长、固定合同、RollRecord、分支隔离、已有包不可变性、应用 ID、密钥存储）不得回退。
```

---

## 使用说明

- 提示词内所有 `文件:行号` 均已在本仓库（HEAD `5a75379`）核实，可直接作为定位索引。
- 若接手 Agent 的仓库路径不同，请替换第一段的 `E:\AiWorkSpace\ShineWord`。
- 若已有可用测试小说与模型端点，建议在提示词里追加一节“测试资源”，格式参照 `docs/Shine-TRPG_PROGRESSIVE_WORLD_BUILD_AGENT_PROMPT.md`（配置路径、语料路径、尺度、禁止提交的禁区）。
- 本次任务未要求修改任何源码；本文件为分析产出的施工提示词。
