# Shine-TRPG 第九阶段改造方案：战役主线规划与持续后果

> 2026-10-09 当前收尾执行入口：[全通测试与修复收尾方案](Shine-TRPG_PHASE9_FULL_PASS_CLOSEOUT_PLAN.md)及[执行提示词](Shine-TRPG_PHASE9_FULL_PASS_CLOSEOUT_AGENT_PROMPT.md)。本文继续定义产品与验收合同；下方各批预算/状态是历史检查点，不能直接作为当前派发依据。已批准 A1/C-2 见 R69 优化方案。

2026-10-09 UTC 输入接入见[资产与访问证据](reviews/phase9/CLOUD_INPUTS_2026-10-09.md)：真实小说生产导入及完整冷读已完成；GLM配置已提供，云代理拒绝域名，新增模型请求/决定0。预算1210/1500、矩阵29 PASS / 2 FAIL / 9 NOT RUN及全部验收门槛保持。

2026-10-08 云端 R57–R59 执行记录见[续作报告](reviews/phase9/CLOUD_REVIEW_R57_R59_2026-10-08.md)：工程1167/1167通过，整体验收29 PASS / 2 FAIL / 9 NOT RUN；本方案真实旅程、质量、持续后果和性能门槛不变。

- 编写日期：2026-10-06（Asia/Shanghai）。
- 文档状态：V1.0，待实施；本文是开发与验收合同，不是功能完成报告。
- 项目目录：F:\ClaudeWorkSpace\projects\ShineWord。
- 复核基线：ShineWord V0.9.1，HEAD 5f49a7d653bdc98a910d7b0c0b33ec3ac483b1e0。
- 参考项目：F:\ClaudeWorkSpace\projects\TAVO-MINI，V3.0.8，HEAD cf278b315eb54595f7118de912aff6b6739de3f9。
- 配套执行提示词：[Shine-TRPG_PHASE9_AGENT_PROMPT.md](Shine-TRPG_PHASE9_AGENT_PROMPT.md)。
- 本次编写只进行了源码、历史报告与测试资产阅读；没有执行产品测试，没有调用测试 LLM，也没有读取密钥正文。

## 0. 产品目标与完成定义

用户导入小说、获得可玩世界、选择角色和开局时点后，输入“这次想做什么”。系统据此生成一场有长期方向的战役，并将近期目标转成可执行局面。玩家能用不同办法推进目标，实际行动改变后续规划，最后获得有事实依据的阶段成果和战役结局。

核心循环：

    用户意图 → 战役方向 → 当前阶段 → 可执行局面
        ↑                              ↓
    主动改目标 ← 后果与新机会 ← 行动、检定、原子结算

本期必须回答五个玩家问题：

1. 我现在为什么要做这件事？
2. 有哪些办法，我已知道的代价是什么？
3. 我的能力、线索、关系怎样帮助我？
4. 刚才的选择实际改变了什么？
5. 距离我的目标还有什么问题，事情变了以后怎么办？

“生成出一段大纲”“累计几十回合无异常”“JSON 合法”分别只证明生成、稳定性、结构合法。整阶段完成还要求主线真实消费、路径产生差异、后果持续出现、计划随行动调整，以及端上完整旅程。

## 1. 已确认方向、默认决策与范围

### 1.1 产品流程

完整 TXT 导入 → 已有流程构建可玩范围 → 选角色/锚点/同行者 → 填写意图 → 生成冒险提案 → 调整或开始 → 游玩与阶段进展 → 必要时重规划 → 结局与回顾。

“世界可玩”与“本次战役已准备好”是两个独立状态。小段建设继续生效；不要求开局前构建完整小说的所有章节。

冒险提案展示：核心目标、故事基调、初始处境、首个问题、篇幅档位。默认不展示隐藏阶段、幕后人物或可能结局。用户点击“开始冒险”即采用当前合格提案，不再叠加第二次确认弹窗。

### 1.2 本期默认决策

| 项目 | 决策 |
|---|---|
| 新战役入口 | 默认准备战役主线；意图为空时提供依据当前可见世界的推荐目标 |
| 目标未明确 | 可选“先探索，再决定目标”，同一规划模型生成探索型开局；目标状态明确为待选择 |
| 战役长度 | 短/中/长为节奏偏好；默认中篇，建议 3–5 个阶段，非必须逐项执行的剧情配额 |
| 规划粒度 | 全局方向与阶段问题粗规划；首阶段完整可玩，下一阶段只准备必要依赖 |
| 路线 | 当前重要问题至少两种机制上不同的可行或可准备办法；允许自由行动和提前解决 |
| 结局 | 条件驱动，允许完成、失败后结束、主动结束；结果在游玩中确定 |
| 主线偏离 | 可暂时搁置、继续探索、换办法、换目标；不能强行拉回旧剧情 |
| 原著关系 | 稳定世界规则与开局事实提供约束；开局后的原著走向是条件性参考 |
| 战役共享 | 同一世界可开不同战役；个人主线和设计补充只属于对应战役/分支 |
| 叙事风格 | 消费既有项目风格；风格不能改变规则、事实、权限和阶段完成条件 |

### 1.3 必做与后续范围

本期必做：意图合同、战役规划、近期内容编译与发布、阶段状态与结局、四档后果、方法 ID 接线、受限自由行动映射、事件驱动后续反应、主线重规划、UI、冻结恢复、回退分叉存档及真实验收。

本期成长体验使用已有技能/能力/物品/关系与奖励机制，证明一次获得和一次后续运用；本期 NPC 使用当前局面相关的目标、承诺、反应触发，证明人物会回应玩家。

完整职业树、全世界自主模拟、无限经济系统、任意新法术解释器、多人联机、无限分支预生成另列后续阶段。不能以这些延期为理由，删去本期路线差异、持续后果和自由行动验收。

## 2. 当前项目事实与改造落点

以下为静态源码复核。实施时必须重新核对，已有能力不重复建设。

| 编号 | 已有基础 / 当前缺口 | 主要落点 | 第九阶段处理 |
|---|---|---|---|
| B01 | 开局已有目标输入和推荐；CreateCampaignInput.goal 为字符串 | OpeningScreen、QuickOpeningConfirm、openingGoalSuggestions、createCampaign | 扩展成可恢复的开局准备与意图合同；采用时原子创建战役 |
| B02 | Situation 有条件、方法、压力、参考事件；快速开局兜底 transitions 为空 | situations/types、compileOpeningSituation | 用有执行效果的首阶段接替主线模式的空局面；兜底只标“环境探索” |
| B03 | 方法已有 ref，但实际编译仍依赖标准化文本匹配 | guidance/types、v2Compile::compileSelectedProposal / bindSituationMethod | 选择路径传稳定 ID；自由文本经受限映射取得本地验证的绑定 |
| B04 | ActionContract 已有四档结果；方法层主要 onSuccess/onFailure；部分通用效果相同 | turns/types、situations/types、campaign/session | 重要方法按四档编译真实后果，覆盖进入执行链全过程 |
| B05 | 已有发现、关系、任务、成长、招募、条件和物品来源 | campaign/session、state/types、progression/growth | 复用结算，主线读取这些事实并提供实际运用机会 |
| B06 | 记忆已有 currentArc/currentObjective/冲突/线索/伏笔 | memory/storyMemoryTypes 等 | 作为已发生故事的派生回顾；主线进度另有确定性所有者 |
| B07 | 权限化材料、预算、冻结、Prepared、commit+outbox 已存在 | context/*、game/v2Turn、turns/commitTurn、turnPostProcessing | 加入规划材料和结果投影，复用统一治理 |
| B08 | 世界内容发布与分支采用已有安全边界 | segmentPublication、branchContentStore | 新增分支局面内容作用域，共用解析和门禁，不写回世界 canon |
| B09 | UI 已有这次变化、眼下局势、下一步 | GuidanceCard、TurnCard、playProjection | 增加主线卡和持久后果回显；来自已提交结构化数据 |
| B10 | 新项目为单一数据库基线 100；存档 save-9；只注册当前协议 | builtinMigrations、database、saveFile | 新协议统一登记；旧开发库明确拒绝，保留文件并使用新测试库 |
| B11 | 长测存在约五分钟尾部等待；自动小说映射质量仍未评分 | phase8 LONGRUN / CLOSEOUT_ROUND2 | 真实阶段反馈、请求统计、自动生成内容独立评分 |

源码索引：

- [createCampaign.ts](../src/application/campaign/createCampaign.ts)
- [OpeningScreen.tsx](../mobile/src/ui/screens/OpeningScreen.tsx)
- [compileOpeningSituation.ts](../src/application/worldPackage/compileOpeningSituation.ts)
- [v2Compile.ts](../src/application/game/v2Compile.ts)
- [session.ts](../src/application/campaign/session.ts)
- [turnMaterialTypes.ts](../src/application/context/turnMaterialTypes.ts)
- [第八阶段最新收尾](reviews/phase8/CLOSEOUT_ROUND2_2026-10-05.md)

## 3. TAVO-MINI 踩坑与本期采用方式

### 3.1 经验映射

来源 S01–S13 见文末。历史规格提出的问题、源码合同和已完成验收分别标注，不能将旧文档状态当作当前运行结论。

| 编号 | 参考证据与教训 | ShineWord 的具体约束 | 验收 |
|---|---|---|---|
| T01 | S01 记录四五十章整理正常但主线仍空；模板未显式要求 currentObjective，空数组合法 | 意图、阶段、完成条件进入明确 schema；区分 no_change / changed / invalid；已知变化必须产生对应进度 | A04、A16 |
| T02 | S02 测试明确大纲为未来规划，并禁止为了旧大纲回滚历史 | 计划不进入已发生事实；死亡、位置、物品、知识由已提交分支状态决定 | A05、A06 |
| T03 | S02/S03 写作场景要求服务大纲、不能改变主线 | TRPG 调整为玩家目标引导与条件性阶段图；玩家合法结果可跳过、替代原计划 | A17、A18 |
| T04 | S03 指纹覆盖标题/正文/顺序/启用集/合同；S04 已证 V5 写入、序列化、解析不一致 | 编写/序列化/读取/恢复/导出同一 schema；实际内容、选项、规则、材料与角色投影都进入身份 | A22、A23 |
| T05 | S05 已证损坏冻结被当未冻结，改读 live DB 后继续生成 | 区分首次未冻结与损坏；损坏保留证据并零发送，不重新读取实时资料拼新请求 | A24 |
| T06 | S03/S06 不可静默裁掉完整约束；S10 记录固定比例可能误阻断；S04 记录批次预算曾不随章数增长 | 用户完整意图与当前必需骨架保留；阶段/条目结构化选取；单请求与整个任务总额分开核算 | A25、A26 |
| T07 | S06 已有“残缺 JSON 当自由文本”的污染防线；一次结构修复使用原材料；S13 要求修复保留大纲校验字段 | 形似 JSON 但无效不得伪装提案；修复不删约束、不换目标，使用同一冻结池和共享请求额度 | A07、A27 |
| T08 | S07 预览恢复不得把 placeholder 行当有效计划 | UI、采用服务、后端只读同一个已校验 candidate；占位行、空 synopsis 无法进入 ready | A08 |
| T09 | S08/S09 明确生成成功、采用持久化、PostWriting 完成不同；采用与重试需幂等 | proposal_ready / adopted / progress_committed / postprocess_succeeded 分开；重复点击不建两场战役、不重复奖励 | A09、A28 |
| T10 | S10 记录 QA artifact 恢复白名单遗漏，造成 Revision 被跳过 | 校验结果和修复理由为 durable artifact；恢复不补跑已成功 LLM，不跳过未完成校验 | A23、A29 |
| T11 | S11 相邻续写模式的用户反馈：机械覆盖 Beat、字数配额和过度修订损伤创作 | 阶段问题和节奏作为方向；不要求每回合推进主线、不把固定字数/固定反转数当文学质量 | A36 |
| T12 | S09 重新绑定真实 Production SHA、APK、LLM 证据，废止旧验收 | 最终报告分开记录代码树身份、APK hash、设备版本、每段真实旅程；修复后重跑受影响链路 | A38 |
| T13 | S12 覆盖批次尾部漂移、任务完成未采用、租约并发的恢复行为 | 重规划有 baseState/basePlan/content hash；后台只能生成候选，采用在分支稳定边界做 CAS | A20、A21、A30 |

### 3.2 借鉴边界

借鉴 TAVO 的冻结、预算、校验、任务恢复、采用和证据方法。以下写作约定必须改为 TRPG 语义：

- “必须执行章纲”改为“围绕目标提供机会；接受玩家已造成的结果”。
- “规划第 N 章”改为“规划一个问题及其进入/完成/失败/替代条件”。
- “正文写到某事件就算发生”改为“规则结算提交事件后，正文才能描述结果”。
- 全量大纲不得静默裁断的经验，转为关键骨架完整与按权限选取阶段；无需每回合注入隐藏终局全文。
- 不复制 Writer/Review/FactCheck/Proof 长链；普通回合继续由现有 Planner 与 Narrator 协作。

## 4. 权威、归属与不可破坏的规则

| 数据 | 唯一所有者 | 允许的使用 |
|---|---|---|
| 世界开局事实与稳定规律 | 当前采用的世界包与出处 | 约束规划与行动；事实有适用时间 |
| 游戏数值、知识、人物命运与物品 | 本地规则和已提交分支快照 | 规划读取；不能直接覆写 |
| 战役意图与偏好 | 玩家输入及版本记录 | 规划必须响应；用户可修改 |
| 未发生的阶段和局面提案 | CampaignPlan 服务 | 未来规划；只有采用后才能供后续回合消费 |
| 当前目标和阶段进度 | CampaignProgressReducer | 由已提交事件/条件求值；模型不能直接判成功 |
| 已发生的叙事记忆 | 既有 Story Memory 链 | 总结、召回，不独立维护另一份任务进度 |
| 玩家可见内容 | 角色知识与公开投影 | 大纲中的秘密不因进入上下文就变为已知 |
| 文风 | 冻结 Writer Style | 影响表达，不影响状态或权限 |

全局不变量：

1. 计划永远不能证明其中的事件已经发生，也不能给角色授予能力或预知。
2. 任何进度变化必须有事件、状态条件或明确用户操作的依据；回合计数不自动完成阶段。
3. 同一世界的两场战役互不污染；同一战役的分支在分叉点之后互不污染。
4. 同一提交包含玩法状态、局面、主线进度、后果、奖励、事件与后处理 handoff。
5. 已冻结回合绑定具体 plan/runtime/content revision；后台更新不改变此回合。
6. 旧基状态的规划候选不能无校验覆盖新状态；不能覆盖已完成节点或真实历史。
7. 冻结损坏、权限不明、依赖不闭合、必需材料超窗时停止对应请求，不能伪装成功。
8. 请求账本的结果未知语义、RNG journal、Prepared、CAS、唯一奖励规则沿用。
9. 生成、校验、采用、阶段完成、记忆整理、UI 展示各有真实状态，不能共用一个 completed。
10. 普通行动不固定新增主线导演或主线检查 LLM 请求。
11. 玩家偏离主线不会被当作“不遵守大纲”而取消合法行动。
12. 未被验证的模型文字不能直接成为关键线索、物品或后果。

## 5. 战役规划模型与状态生命周期

### 5.1 三层模型

CampaignIntent：用户想体验什么；CampaignPlan：未来有哪些问题和机会；CampaignRuntime：实际进行到了哪里。

建议类型如下（字段为合同方向，实施时补全严格判别类型；不是允许任意 JSON 的接口）：

    CampaignIntentV1
      setupId, intentRevision, rawIntent, normalizedIntent
      protagonistBinding, openingAnchor, companionBindings
      tone, lengthPreference, explorationPreference
      userConstraints[], requestedCanonTargets[]
      knowledgePolicy, sourceCoverageBinding

    CampaignPlanV1
      planId, revision, parentRevision, intentHash
      baseWorldBinding, ruleBinding, compiledOpeningHash
      longTermGoal, publicPitch, gmPremise
      startNodeIds[], nodes[], possibleEndings[]
      unresolvedDependencies[], contentArtifactRefs[]
      sourceEvidenceRefs[], compilerVersion, contentHash

    CampaignNodeV1
      nodeId, role: main | optional
      publicObjective, gmPurpose
      activation, completion, failure, cancellation
      statusDependencies[], alternativeNodeIds[], nextNodeIds[]
      situationRefs[], rewardPolicyRefs[], consequenceRefs[]
      coverage: concrete | provisional
      visibility, provenance

    CampaignRuntimeV1
      branchId, planBinding, intentRevision, stateVersion
      campaignStatus, primaryNodeId, nodeStates[]
      completedEvidence[], deferredConsequences[]
      processedEventKeys[], lastProgressVersion
      replanReasonCodes[], publicObjectiveProjection

主线阶段状态：planned → available → active → succeeded / failed / superseded / cancelled；active 可进入 suspended 并恢复。无关节点不因主线变动自动失败。

战役状态：preparing → active；active 可 paused / completed / failed / ended。主线暂停时仍允许符合规则的探索。结局来自条件成立或用户明确结束，不靠模型宣称。

### 5.2 条件与节点图

- 复用 SituationCondition AST，按实际缺口增加可信叶子条件，例如 campaign_node_status、committed_event、promise_status、situation_counter_at_least。
- 每个条件的 actor/item/entry/node/event 引用必须存在、属于允许作用域，并满足时间边界。
- 主路径图必须存在至少一条结构可达的终局路径；可达只证明条件和内容闭包，不承诺骰点一定成功。
- 阶段前置采用 all/any 等显式结构，允许替代方案；不能把建议顺序写成强制直线。
- 终局节点不得依赖自己；非法环拒绝。重复日常委托用新的局面实例表达，不让已完成主线节点复活。
- 远期节点可 provisional，只保留方向和缺失依赖；不可激活、不可显示确定奖励或保证出场人物。
- 节点的完成/失败/取消有明确退出方式。暂时无路可走标 blocked reason，并提供相关补充内容或新办法。

### 5.3 身份、计划版本与运行状态

阶段 nodeId 在未替换含义时保持稳定；重规划不能靠换 ID 重发奖励。变更含义时显式标 supersedes，并保留旧记录。

plan revision 是不可变定义；runtime 记录其执行情况。定义字段不承载“当前已经成功”，runtime 不复制整份未来剧情。

开局前使用独立 setupId 保存草案和任务。角色、地点、意图改变会使旧 candidate 变 stale。生成草案不创建半成品战役，也不触发角色资源或知识变化。

## 6. 生成、编译和采用

### 6.1 开局输入

输入包括完整用户意图、合法开局投影、已采用世界与规则、可用人物/地点/技能、相关原文证据、权限政策、篇幅与风格偏好。

用户可以提到角色尚不知道的未来事件。该信息作为玩家偏好进入私有规划，不自动写入角色知识。公开引子必须通过当前角色可感知的信息引向目标。

超长小说先使用稳定索引检索与意图相关的材料；依赖未构建时提交既有段建设任务。首阶段依赖齐全后即可开始；远期覆盖不够明确标 provisional，不编造后半本事实。

### 6.2 生成合同

默认一次 campaign_plan 请求同时产生：冒险提案、全局阶段草案、首阶段局面提案与必要依赖声明。模型只选择可信条件/效果模板与合法引用，权威数值由本地规则和已发布定义编译。

流水线为：

    freeze inputs → generate candidate → strict parse
      → schema/reference/capability/visibility validation
      → local compile → playability and intent checks
      → proposal_ready → adopt

结构或局部合同失败最多一次修复；修复使用原冻结材料、候选和错误列表。首次生成加修复共享默认两次物理 HTTP 上限，包含 provider fallback/formatter/reasoning recovery，实际派发前统一扣额。

额度用尽时保存可诊断失败；玩家主动重试建立关联的新 attempt group。结果未知必须遵循现有显式重试入口，不能计作未发送自动再来。

原文依赖建设单独归属既有构建任务，有独立预算与账本；不得把它藏在“规划一次调用”统计里。

### 6.3 本地门禁与语义检查

硬门禁：

- schema 完整、没有未知权威字段、ID 闭包有效、规则能力可执行。
- 初始目标非空；首阶段可进入；至少一个当前可执行入口，以及第二种可行或有具体准备路径的办法。
- 重要方法的风险、成本和结果模板能落地；不同标题但同一效果的路线不算差异。
- 首阶段有完成/失败/退出条件及至少一个后续接点。
- 隐藏人物、秘密、未来事实不能进入公开提案、标题、取舍或建议。
- 关键条件引用缺失、残缺 JSON、占位计划、没有任何实质效果的主线路线拒绝进入 ready。
- 创作补充有 design_fill 来源，不能伪装原著引用。

目标贴合、人物行为合理、路线是否有吸引力需要独立语义样本审阅。不能宣称结构校验能够完全判断文学质量。首版不把主观评审变成每回合固定请求。

### 6.4 原子开局采用

复用 createCampaign 的单事务，增加已校验 plan/content/runtime 初始写入。事务前再次核对 setup intent hash、开局投影 hash、世界绑定、候选 hash 与状态。

同一 setupId + candidateHash 最多创建一场战役；重复点击返回同一结果。事务失败不残留 campaign、分支、角色、进度或奖励。

UI 默认只需要“开始冒险”一次操作。重新生成、修改意图或切换角色之后，旧 ready 提案必须被明确失效，不能仍用旧按钮开始。

## 7. 近期内容与世界材料的组合

新增 CampaignContentArtifactV1，保存本战役的局面、线索组织、关系反应和后果定义。复用现有条目 schema、能力注册、出处检查与发布门禁；增加 scope、namespace 和 branch binding。

- 世界原著条目继续由世界发布层拥有，个人主线不写入 canon/world package。
- 战役内容 ID 使用独立命名空间；引用必须分清 world entry 与 campaign entry。
- 同一统一解析器负责“已采用世界 + 当前分支战役内容”的只读合成；Planner、规则、投影、存档使用同一合成结果。
- 本期优先引用世界已存在的人物、地点、物品和能力。可设计新的局面与线索；不能凭空给玩家唯一宝物或改变力量境界。
- 需要未实例化的已知人物登场时，通过有条件的本地实例化事件进入状态；仅有计划中的出场安排不能让其立即在场。
- 人物模板、奖励物品或线索定义已发布，不代表玩家已获得、已知道或人物已执行行动。
- 后台准备默认只覆盖下一阶段的必要内容，最多保留两段待采用近期材料；远期继续用粗节点。
- 有效旧内容可继续提供探索和相关支线。当前目标确实没有合法入口时才阻塞其推进，并给出具体恢复入口。

阶段切换前提前准备依赖；内容 ready 与 branch adopted 分开。任何采用都在无在途冻结回合的稳定边界完成。

## 8. 行动、检定与可见后果

### 8.1 选项和自由输入共用合同

推荐行动提交 candidateRef / situationId / methodId 及显示时绑定的 stateVersion、planHash；文本保留为用户历史，不作为唯一方法身份。

自由输入由现有 Planner 返回目标、手段、对象、证据及可选 methodRef/affordanceRef。编译器重新核对资格、目标、资源、当前局面和知识；模型选中 ID 不意味着获得执行权限。

首期自由手段支持组合已有的调查、谈判、欺骗、干扰、潜入、救治、保护、交易等语义入口；实际支持集合由规则模块公开能力决定。没有可信映射时说明能处理哪一步，不得把无法裁定的行动默认为成功互动。

同义表达应与点选相同办法得到相同结构合同；真正不同的创意可通过局面可交互条件组合出新的合法办法。不能把任意自然语言理解能力列为已实现承诺。

### 8.2 四档后果合同

重要 Method 使用按 RollGrade 索引的完整 outcomeTemplates，每项分别定义 achieved、effectTemplateRefs、situationTransitions、consequenceRefs、publicResultFacts。

- 完全成功：达成目标，可增加优势或机会。
- 成功：达成目标；是否带代价由该方法已配置风险决定。
- 失败：目标未达成，可改变信息、警戒、位置或可用办法。
- 严重失败：形成更明显损失或危机，同时尊重世界死亡/失能规则。

不要求所有动作四档效果互异；无风险行动无需投骰，日常互动也可只影响关系。质量门检查的是重要决策的实质区别。

结果模板在投骰前冻结。结算后不能为了让大纲好看更改骰点、补发奖励、把死亡改成昏迷。

失败后新办法必须有状态依据，不能保证每次失败都无损前进。带代价的成功仍然完成目标，Narrator 不能把成功描述成彻底失败。

### 8.3 后果与人物回应

复用 branch events，增加最小 DeferredConsequence 记录：triggerCondition、sourceEventRefs、affectedActors、effectTemplateRefs、visibility、status、idempotencyKey。

例：玩家请某人担保，先产生可验证承诺；阶段后该人物提出兑现请求；玩家履约或拒绝后，关系和后续办法改变。

NPC 的目标、底线和触发条件只作用于当前相关局面；规则提交主动反应，Narrator 表达该反应。每个触发只执行一次；连续反应有本地步数上限，达到玩家决策点即停，不能自动替玩家花费关键物品或作重大选择。

## 9. 主线进度、奖励与结局

CampaignProgressReducer 读取本次 Prepared 后的状态和权威事件，求值条件并生成进度效果。主线进度、奖励去重、延迟后果与原玩法效果一起提交。

- 同一事务中多节点满足时使用稳定拓扑顺序；一个事务处理有界节点数量，不能递归无限激活。
- 收到无关行动时输出 no_change；不能每回合硬造主线推进。
- 已有证据满足目标时允许提前完成，标注被跨越节点的 superseded 原因，后续重规划。
- 奖励按 branch + stableNodeId + rewardPolicyId 去重；改名、重规划和冷启动不能重新发放。
- 物品、能力和知识仍需合法来源；阶段奖励不能突破规则资格。
- 本期必须展示一次既有成长或关系/情报奖励，并在后续真实选择中用到，证明奖励能改变办法。
- 结束后生成基于已提交事件的回顾，区分完成、代价、未完成心愿；不能将原计划终局作为实际结局。
- 结局回顾可复用 Narrator 的阶段表达；若另发请求必须入账并按显式 requestKind 计数。
- 用户可选择保留世界继续另一段冒险；下一目标创建新意图/规划版本，既有经历继续保留。

UI 主线事实以 runtime 为准；Story Memory 可引用“某阶段在某事件后完成”，不得反过来仅因记忆称完成就改变 runtime。

## 10. 重规划：触发、粒度与并发

### 10.1 触发矩阵

| 变化 | 处理 |
|---|---|
| 普通观察、移动、交谈，阶段条件未变 | 本地检查进度，不调用重规划 |
| 阶段正常完成，下一阶段内容已足够 | 本地切换；缺内容时安排受限准备 |
| 关键人物死亡/被救，原目标失去前提 | 标记受影响节点，生成未来部分修订候选 |
| 玩家用另一办法提前解决问题 | 接受事实，取消不再需要的节点，补充相关后果 |
| 玩家暂时去做支线 | 保留主线，可暂停；不能仅凭回合数强制重规划或惩罚 |
| 玩家明确改目标/要求换方向 | 新 intentRevision；重规划公开提案，用户采用 |
| 新世界段提供相关新事实 | 先检查与当前分支适用性，只修受影响未来，不按世界最新包覆盖历史 |
| 当前无进展 | 本地提示已有办法或缺少准备；主动请求“换个思路”可触发规划 |

### 10.2 重规划协议

Job 绑定 baseStateVersion、basePlanHash、intentHash、contentManifestHash、knowledgePolicyHash、triggerEventRefs。输出 changed / no_change / needs_material，并附原因；不得只返回空补丁作为所有问题的解决办法。

只替换未完成且受影响的未来节点；已提交事件、完成证据、已发奖励、承诺和玩家意图不会被候选覆写。

同一分支同一触发集合合并成一个任务；一个分支同类规划任务单飞。重试次数、依赖建设次数有界，达到上限展示诚实状态，不能“生成→发现过期→再生成”无限循环。

### 10.3 稳定边界采用

后台只能保存 candidate，不能更新 activePlan。采用前：

1. 确认没有在途冻结回合、未结算 Prepared 或未知物理请求。
2. 校验 basePlan、intent 和 content binding。
3. 当前状态已前进时，先本地重新求值候选涉及的 actor/item/knowledge/node 条件。
4. 无冲突时产生新的绑定并再次本地校验；有语义冲突标 stale，不直接采用，也不暗中重新调用模型。
5. 使用 CAS 和同一分支提交入口原子写 plan binding、runtime、内容采用及事件。

该采用是无世界时间消耗的管理提交，具有独立事件身份并复用本地提交/outbox；若现有 branch_events 必须关联 turn，应使用明确的管理 turn 类型，不能伪造一段玩家正文或另开旁路写状态。

目标变更需用户操作；仅修正未来内部安排且不改变玩家已选目标的候选可在上述边界自动采用，并在必要时公开说明变化。

## 11. 上下文、权限、冻结与记忆

新增类型化材料 campaign_direction、campaign_progress、campaign_opportunities；新增 authorityDomain 为 campaign_plan，并明确其非事实性质。每种材料使用可信 renderer。

| 消费者 | 必需内容 | 禁止混入 |
|---|---|---|
| CampaignPlanner | 完整意图、开局/当前状态、规则、相关证据、当前规划及触发变化 | 不相关全书全文、无来源的未来断言 |
| Turn Planner | 当前目标、可执行机会、合法条件和当前状态 | 靠隐藏结局引导玩家、未经允许的秘密名称 |
| Narrator | 已结算结果、公开目标、公开进展和可见后果 | 完整 GM 大纲、未公开阶段、未发生事件 |
| Memory | 已提交事件、公开经历与合法证据 | 未采用候选、未来计划、修复失败内容 |

当前意图关键约束、目标骨架、活动节点和本次执行依赖为 mandatory。远期阶段按节点 whole-item 选择；不按字符截断 JSON，不把完整主线作为一个可丢弃大块。

冻结根增加 planBinding、runtimeHash、campaignContentRefs、projectionVersion、intentHash 和知识边界。恢复读取原根；任务期间改目标/风格/API/计划不改变旧请求。

当前故事记忆中的 currentObjective 是派生叙事描述；若落后，以 runtime 投影为准。记忆修复不能反向写进度。保留既有 known-change、accepted-only、Pending Bridge 和证据时间规则。

API 能力与预算策略分离；不根据文件名 GLM-TEST 推测模型 ID 或窗口。所有新 requestKind 必须注册到能力、需求、优先级、账本、最后请求校验和诊断路径。

## 12. 持久化、恢复、分叉与存档

### 12.1 建议存储结构

| 对象 | 主要字段 / 职责 |
|---|---|
| campaign_setups | 开局草案、角色投影、intent revision、currentCandidateId；开局前存在 |
| campaign_plan_jobs | 类型、冻结根、base bindings、status、lease/fence、nextRetryAt、预算 |
| campaign_plan_candidates | 原始结果引用、解析结果、校验/修复 artifact、候选 hash；不可直接游玩 |
| campaign_plan_revisions | 不可变计划、父版本、source setup/trigger、hash |
| campaign_content_artifacts | 作用域、不可变局面定义、依赖、出处、可见性、hash |
| GameStateSnapshot 扩展 | planBinding、campaignRuntime、deferredConsequences、content binding |
| branch_events 扩展 | 进度、采用、目标变更、后果、结局等事件类型 |

表名可在 P9-0 按仓库规范调整；必须保持上述职责及完整存档语义。branch 当前查询表只作为快照的事务同步投影，不能成为第二份真相。

### 12.2 任务状态与恢复

状态至少区分 queued、running、candidate_ready、adopted、retryable_failed、outcome_unknown、invalid、stale、cancelled。每次状态迁移都持久化。

恢复点必须覆盖：冻结后未发送、已发送结果未知、响应完成未验证、验证完成未 ready、ready 未采用、采用事务前后、进度提交后 outbox 未处理。

已成功阶段复用 durable artifact；无法验证 artifact 时显式失败。不得用空列表补字段、无条件回到生成阶段、重复已成功付费请求，或把未采用候选当 active。

删除 setup/campaign 时取消待派发任务；已在途结果到达后通过删除/世代 fence 拒绝回写。世界删改、源范围变化同样使相关候选失效，错误原因可诊断。

### 12.3 回退、分叉和导出

- 任意回退点读取该点 plan/runtime/content binding；不能查询最新计划填入历史快照。
- 分叉只继承分叉点及之前已采用的计划、进度、已发生后果及尚待触发的合法后果。
- 父分支后台候选、未来知识、后续奖励不得进入子分支。
- 分支 ID 和引用通过类型化重绑处理；原始证据身份保留，内容 hash 按新绑定规则重算并验证。
- 稳定存档包含意图、被历史快照引用的规划版本、采用记录、战役内容、runtime、后果与证据。
- 在途规划可暂停且无未知请求后形成稳定存档；不导出 lease、API key 或活动进程状态。可选未采用草案若导出，必须单独标 draft 且导入后重新验证。
- 导入、回退、分叉、冷启动后公开主线和实际可执行办法与对应快照一致。
- 派生索引允许重建；计划正文、进度证据、已采用内容不能靠模型重新生成恢复。

### 12.4 协议与开发数据政策

沿用第八阶段的单一当前协议，建议登记如下；P9-0 在 PROTOCOL_BASELINE.md 固化实际常量与更改理由：

| 项目 | 当前 | 本期目标 |
|---|---|---|
| Campaign Intent / Plan / Runtime / Content / Job | 无 | 各一个 V1 严格 schema |
| core | 0.3.0 | 0.4.0（新增阶段/后果规则语义） |
| Proposal / ActionContract | 2.0 | 3.0（稳定方法绑定与结果模板身份） |
| World package | shineword-world-package-5 | shineword-world-package-6（共享局面 schema 更新） |
| Turn material | turn-material-1 | turn-material-2（规划权威域与投影） |
| Save | shineword-save-9 | shineword-save-10 |
| SQLite 开发基线 | 100 | 101，新空库一次安装；旧基线明确拒绝 |
| Story Memory | schema 3 | 字段语义不变则保持 3，增加消费边界验证 |
| 产品版本 | V0.9.1 | 按 VERSIONING.md；本方案含不兼容变更，目标候选 V1.0.0 |

阶段编号不等于产品版本。文档编写不升版本；实施完成后按真实兼容性和验收结果登记。若 P9-0 发现某协议完全无需更改，应在 ADR 中用真实依赖证明并同步登记表，不能保留名义新版本和旧生产路径。

旧开发数据库不自动清空或覆盖。测试建立新数据库/隔离 AVD，保留用户文件和 Keychain 配置。旧存档明确说明不支持，不静默转换，不注册双执行链。

## 13. 移动端体验

开局增加“这次冒险”步骤，支持意图、偏好、生成、提案摘要、修改和开始。已有快速/完整开局入口必须调用同一服务，不能各自实现规划。

生成中显示真实状态：准备相关资料 / 规划冒险 / 校验可玩性 / 已准备好。提供取消、返回和恢复；不显示虚假百分比。按钮防重复，状态由持久任务读取。

游玩页新增紧凑主线卡：

- 当前公开目标和当前阶段问题。
- 最近一条已提交进展，例如“证人已同意作证”。
- 展开后的已完成阶段、已知待办、暂停/继续/调整目标入口。
- 不用“第 2/5 章”承诺未公开的固定剧情，也不显示隐藏最终结局。
- 无主线变化时不重复插入大段“没有变化”正文；玩家仍能查看当前目标。
- 提示新机会时说明与已知经历的关系，例如“此前的担保使这条办法可用”。

结果卡的实质变化从 commit event/runtime 差异投影。叙事可以补充情绪和细节，不能虚构推进百分比。

故障区分“资料尚未齐全”“提案校验失败”“云端结果未知”“候选已过期”。可以继续的既有玩法保持可用；主线必须阻塞时说明具体受影响目标和恢复入口。

验证四主题、360dp/411dp、1.3×/2×字体、键盘、安全区域、返回/前后台/冷启动和长文本；防止目标和路径按钮挤出屏幕。

## 14. 代码组织与施工包

建议增加以下目录；文件名可按实际拆分调整，但必须有单一职责与生产接线：

- src/domain/campaignPlan/：types、conditions、progressReducer、consequences。
- src/application/campaignPlan/：intent、materials、requestCompiler、validator、contentCompiler、generationService、adoption、replanPolicy、publicProjection。
- src/infra/sqlite/：setup/plan/job/artifact stores；使用既有事务接口。
- mobile/src/ui/features/opening/：IntentForm、CampaignProposalCard、PlanningStatus。
- mobile/src/ui/features/play/：CampaignProgressCard；复用 GuidanceCard。
- tests/phase9-*.test.cjs：核心、真实 SQLite、故障、权限、存档与入口集成。
- docs/reviews/phase9/：基线、逐包记录、验收矩阵、真实旅程、质量与最终报告。

所有业务入口应从 session/runtime 调用服务。不要继续将规划、请求、恢复、UI 文案和 SQL 堆入 CampaignSession 的同一个方法。

| 施工包 | 交付内容 | 依赖 | 完成证据 |
|---|---|---|---|
| P9-0 | 基线、协议、状态机、权威、测试矩阵、请求预算 | 无 | 基线命令与源码核对；人工金样本冻结 |
| P9-1 | domain/schema、本地编译器、进度与四档后果、条件闭包 | P9-0 | 有效/非法/替代/提前完成的确定性测试 |
| P9-2 | SQLite、setup/job、冻结、恢复、幂等开局、存档骨架 | P9-1 | 真实 SQLite 故障矩阵，无孤儿状态 |
| P9-3 | LLM 规划与修复、源依赖、小段准备、主线内容发布 | P9-2 | 真正入口生成并编译首阶段 |
| P9-4 | 回合消费、方法 ID、自由行动、主线进度、持续后果 | P9-3 | 两路线与一次创意办法产生真实差异 |
| P9-5 | 重规划、分支隔离、回退/存档完整闭环 | P9-4 | 死亡/救活/提前解决/换目标/过期候选测试 |
| P9-6 | 开局/主线 UI、等待恢复、主题与可访问性 | P9-3 起可穿插，最终依赖 P9-5 | 模拟器实际旅程与截图 |
| P9-7 | 三意图真实测试、自动映射质量、性能、缺陷修复与最终回归 | P9-1–6 | A01–A40 逐项判定、最终源码/APK/LLM 对齐 |

每包先定位现状和必要失败场景，再实现与回归。人工金样本用于分离“引擎不支持”和“自动内容没生成好”；最终自动映射必须独立通过，不能用金样本替代。

## 15. 功能与故障验收矩阵

| ID | 场景 | 必须观察到的结果 |
|---|---|---|
| A01 | 同一小说、同一开局、不同用户意图 | 目标、首阶段问题和关键机会有语义差异，非只换标题 |
| A02 | 原著角色/原创角色及更换起点 | 规划消费真实角色资格；无未来能力或身份继承 |
| A03 | 完整导入、部分世界 ready、目标依赖后段 | 按需补建；真实记录覆盖，未知远期不伪装已知 |
| A04 | 当前目标已明确 / 探索待选 | schema、UI、回合材料均正确，不能静默全空 |
| A05 | 提案计划“某人死亡”但尚未行动 | 角色仍按当前状态存活；记忆无死亡经历 |
| A06 | 玩家救下原著将死角色 | 后续计划尊重存活，不借原著强行补死 |
| A07 | 截断 JSON、非法引用、删字段式修复 | 不能 ready；修复保留意图和必需合同，额度有界 |
| A08 | ready 前强停、占位行恢复 | 完整候选恢复；占位计划不可开始 |
| A09 | 双击开始、事务中断、重新进入 | 至多一个战役，无半成品卡/奖励/主线 |
| A10 | 同一问题两种路线 | 至少两项权威状态/后续机会差异及后续回响 |
| A11 | 点选与同义自由输入 | 同一办法绑定与资格一致，文本改写不丢后果 |
| A12 | 一次模板外但能力允许的组合办法 | 使用已支持可交互条件，出现可解释的合法结果 |
| A13 | 非法方法 ID、跨场景目标、过期按钮 | 拒绝或重新求资格，不越权 |
| A14 | 重要行动四档固定骰点 | 预先冻结的四档结果正确提交，不靠 Narrator 补效果 |
| A15 | 无风险动作、日常互动、连续失败 | 无无意义强投骰；失败不无限复制同一场景 |
| A16 | 已知完成证据 / 无关动作 | 进度 changed / no_change 正确；缺语义更新不能假成功 |
| A17 | 提前解决、绕过中间阶段 | 目标认可，跳过记录明确，已得奖励不重发 |
| A18 | 主动偏离、暂停、切换目标 | 玩家仍可合法行动；原目标/新目标版本可追溯 |
| A19 | 人情、承诺、一次奖励的后续用途 | 后续行动受其影响；至少隔两次玩家决定仍有效 |
| A20 | 重规划时继续游玩，关键条件变化 | 旧候选 stale 或本地重新验证，不能覆盖新事实 |
| A21 | 多个触发、后台竞争、规划失败 | 合并/单飞/有界重试；既有合法回合不会被无故锁死 |
| A22 | 改标题/目标/顺序/规则/风格后恢复 | 必须变化的身份变化；已冻结旧任务材料保持一致 |
| A23 | schema 往返、校验 artifact、阶段恢复 | 内容与版本完整，已完成 LLM 阶段不重复 |
| A24 | 冻结 hash/JSON 损坏 | 保留坏信封、明确失败、零新 HTTP |
| A25 | 必需意图或骨架超窗、模型能力未知 | 请求前阻止；不裁用户意图、不伪造能力 |
| A26 | 大规划和累计任务预算 | 单请求与总额独立；所有物理请求有账；额度不随重启重置 |
| A27 | reasoning-only、429、网络异常、结果未知 | 分类准确；修复/退避有界；未知不自动重发 |
| A28 | 检定后/采用前/进度 commit 后强停、outbox lease 过期 | 复用原骰点与冻结合同；原子事实可读；后处理恢复且不重复发奖励 |
| A29 | 响应完成但校验未完成、修复完成未采用 | 正确从 durable artifact 继续，不跳过或补造成功 |
| A30 | setup/战役删除、意图修改、源依赖替换 | 旧 worker 不回写；相关候选明确失效 |
| A31 | 历史回退与两个分支 | plan/runtime/知识/后果均按分叉点隔离 |
| A32 | 稳定导出→导入→继续、坏引用/旧版本 | 完整恢复或明确拒绝；不重新生成历史计划 |
| A33 | 隐藏身份、阶段标题、别名、取舍和日志 | 公开投影不泄漏；Narrator 不收全量秘密大纲 |
| A34 | 第一阶段完成及至少一种战役结束 | UI、状态、事件、回顾一致，无自动假结局 |
| A35 | 前后台、键盘、小屏、主题、字体、冷启动 | 可读可操作、状态真实，主线卡与实际进度一致 |
| A36 | 自动生成三意图内容质量 | 独立语义评分通过；没有机械阶段配额和强制回轨 |
| A37 | 常规回合和重规划调用/耗时 | 无固定新增每回合导演调用；费用与时间可对账 |
| A38 | 最终代码、APK、真实旅程证据 | 真实身份一致；后续源码变更重跑受影响验收 |
| A39 | 三意图同一世界多战役 | 设计补充、人物反应、目标、知识互不污染 |
| A40 | 100/300/1000 回合本地累积 | 查询/快照/去重有界，无全历史重复注入或无限规划任务 |

## 16. 本地开发和真实测试资源

### 16.1 用户指定资源

- LLM 配置文件：C:\Users\Administrator\Desktop\AIstudio\Test-key\GLM-TEST.txt。
- 小说文件：C:\Users\Administrator\Desktop\AIstudio\放开那个女巫.txt。
- 编写时只确认两个文件存在。小说大小 7,178,905 bytes。
- 小说原始文件 SHA-256：7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4。
- 此 hash 是原始字节身份，不代替生产导入后的规范化文本 hash/码点范围。

执行 agent 可在本地读取该配置并用于本方案真实 API 测试。应解析 endpoint/model/key 字段，仅记录脱敏配置身份与模型非敏感能力。文件格式不确定时用只输出字段是否存在的解析探测，不整文件回显。未知能力须按既有能力登记流程确认，不从“GLM-TEST”文件名猜模型。

密钥只进入内存/系统安全存储；不写源码、文档、命令参数、日志、SQLite、截图、备份或提交。小说与真实回合全文保留在已忽略测试目录；公开报告使用 hash、计数、短评和必要的脱敏摘录。

本轮撰写文档没有调用该配置。以下测试由实施 agent 执行，不能把文件存在当作 API 可用。

### 16.2 分层测试

1. 纯规则测试：图结构、条件、方法绑定、四档结果、去重、事件推导；使用固定 RNG，覆盖失败与提前解决。
2. 真实 SQLite 集成：原子采用/提交、CAS、lease/fence、恢复、删除、跨分支、导出导入；只 mock LLM/RNG 边界。
3. 生产 session 集成：从开局服务到实际 submit/commit/projection，不直接往终态表塞成功记录来代替流程。
4. 真实 GLM 测试：真实解析、预算、HTTP、账本、校验、内容生成和回合消费；区分主机生产服务证据与设备 UI 证据。
5. Android 设备/模拟器：先枚举设备再选择 serial，记录 API 与设备类型，不假定 emulator-5554 永远存在。
6. 自动内容质量评审：人工金样本与自动生成样本分别评分，不能混合通过率。

### 16.3 最小真实旅程

先做一次 10 个玩家决策的冒烟，发现问题修复后再扩展。最终矩阵：

| 旅程 | 材料与意图 | 最少有效玩家决策 | 必须覆盖 |
|---|---|---:|---|
| J1 | 指定小说；保护一个在已验证开局局面中受威胁的人 | 20 | 重要介入、四档之一的有代价结果、人物后续反应、阶段完成 |
| J2 | 同小说；调查一个已验证异常/冲突及相关证据 | 20 | 线索改变办法、自由输入、替代路线、阶段进展 |
| J3 | 同小说；建立合作或推进一项符合世界的日常/建设目标 | 20 | 非战斗主线、关系/承诺、所得资源的后续用途 |
| J4-A/B | 从 J1 或 J2 的同一稳定快照分两条路线 | 各 10 | 分支差异、至少两个持久后果、回退/存档、至少一次重规划 |

合计至少 80 个有效玩家决策；重复轮询、自动 NPC 步、空动作刷数、重试同一未提交回合不计数。可以复用通过的冒烟区间，但必须绑定同一未失效代码版本。三意图只证明这一本小说中的玩法方向，不宣称三种题材泛化通过。

至少 J1 的 20 决策和 J4 中一个 10 决策分支由 Android UI 完成，其余可使用与移动端相同生产服务/数据库的主机驱动。设备 UI 必须另外覆盖生成、编辑、采用、阶段变化、暂停/换目标、恢复、存档入口。

至少一场选择短篇并自然达到可验证结局；若 20 次决定未结束，继续至条件成立，不能修改状态凑完成。命运改写场景若原文没有确定的死亡事件，只能报告“解除处境/救援”，不能冒称改写原著死亡。

新项目通过生产导入完整 TXT；仅按依赖构建必要段。J1/J2/J3 的最终样本必须使用自动规划内容，手工补齐的样本单独列诊断，修复后重跑自动入口。

### 16.4 故障与长程

受控故障注入覆盖 A07–A09、A20–A32。不能为了测试稳定性反复向真实服务发送无意义请求；HTTP 分类与大多数崩溃点先在本地可控传输验证，再选择一次真实 Android 冷启动恢复证明接线。

100/300/1000 累积测试使用本地确定性旅程，检查快照大小、查询时长、活动/归档节点、后果队列和任务数量；不要求为每个压力轮调用真实模型。

禁止卸载/清空用户 App 数据。使用专用测试数据库或隔离模拟器；保留旧开发数据库，使用正式新基线入口。不能以 adb 替换用户数据库掩盖迁移或恢复问题。

### 16.5 命令门禁

按 package.json 实际存在的脚本执行并记录退出码：

    npm run verify:core
    npm run typecheck --prefix mobile
    npm run verify:version
    npm run apk:debug --prefix mobile
    git diff --check

根 verify:core 已含核心类型检查、编译与测试，未发生相关变化时不重复全量跑同一套。新增定向测试通过后执行完整门禁；之后源码修复只重跑受影响检查并在最终交付补齐必要集成验证。

设备缺席或 API 不可用时仍完成独立开发与本地验证，对受影响项记录 NOT RUN / BLOCKED、原因和复跑条件；不得标整阶段通过。

## 17. 质量、体验与性能验收

### 17.1 质量评分

每个自动生成计划和对应实际旅程各审一次，0–4 分，必须有实例说明：

| 维度 | 观察内容 |
|---|---|
| 意图贴合 | 首阶段和主要阻力能解释与用户目标的关系 |
| 路线差异 | 不同路线使用不同条件、代价或结果 |
| 自由度 | 合理替代、提前完成和暂时偏离被系统接纳 |
| 后果持续 | 过去选择至少隔两次决定仍影响人物或办法 |
| 世界与角色 | 引用正确、人物动机合理、无未来能力或知识泄漏 |
| 节奏与可理解性 | 玩家知道当前问题，日常与高潮节奏符合所选体验 |

工程验收参考目标：每维至少 3 分；世界事实冲突、重大泄漏、强制回滚合法结果为一票否决。评分由实施者按证据逐条给出，不把 LLM 自评当作唯一结论。

用户可用性与主观爽感另列：用户或独立试玩者能说出目标、自己改变的事和下一步期待；尚无人试玩时标未验，不用工程评分代替用户反馈。工程与真实模型内容门均通过后，可报告技术验收完成；“玩家体验验证通过”须有独立试玩证据。

### 17.2 时间和请求

记录开局准备、资料建设、首次规划、首次可操作场景、每回合结算与重规划分别耗时。区分排队、模型、修复、本地、后台，不把所有等待归一个平均数。

以同模型/档位/设备/已构建范围取至少 10 个基线回合和 10 个新回合对照；报告样本数、中位数和尾部，不用极小样本声称稳定 P95。

硬约束：普通回合不固定增加 campaign_plan 请求；所有真实 HTTP 100% 入账；已完成请求恢复无重复；隐藏自动修复调用为零。速度软目标：普通回合中位数增加不超过 15%；开局规划初始目标 60 秒内，依赖补建单独计；达不到时报告实测与原因，不伪造进度或削掉关键材料。

真实测试启动前将有界总物理请求数写入本地测试 manifest，建议默认 400 次，涵盖构建、规划、回合、记忆和修复；所有子驱动共用计数。该数为防失控上限，不是模型上下文窗口或价格承诺。耗尽时保存检查点，先排除重试风暴和测试冗余；需要扩大测试开销时报告剩余矩阵，不能静默移除上限。

## 18. 交付证据、风险与实施收尾

交付文件：

- docs/reviews/phase9/BASELINE.md：源码/环境/脚本/输入身份、已有失败、工作区保护。
- PROTOCOL_BASELINE.md：当前唯一协议、数据所有者、状态机、预算和 ADR。
- IMPLEMENTATION_PROGRESS.md：P9-0–P9-7 已做、未做、变更原因。
- ACCEPTANCE_MATRIX.md：A01–A40，PASS / FAIL / NOT RUN / BLOCKED，证据路径及范围。
- REAL_JOURNEYS.md：J1–J4 的意图、计划、决定、状态变化、调用/token/耗时、结局。
- CONTENT_QUALITY.md：自动与人工样本分列评分，用户体验未验项。
- FINAL_REPORT.md：最终代码身份、APK hash、设备、真实请求、遗留、复跑条件及结论。

私有资产放 .tmp/phase9/ 或 test-logs/phase9/，写可重复执行的脱敏驱动、manifest 和故障重放说明；不要把密钥和整本小说复制进跟踪目录。

重点风险及处理：

| 风险 | 处理 |
|---|---|
| 主线变成强制轨道 | 条件性节点与替代路线，已发生事实优先，偏离/提前完成必测 |
| 大纲看似丰富、实际动作无效果 | 本地可玩性编译与权威状态差异验收 |
| 剧透或角色全知 | 分角色投影、秘密标题/别名测试、未来计划不进记忆 |
| 不完整原著导致编造 | 覆盖与依赖显式建模，近期精编、远期 provisional |
| 重规划过期与无限付费 | 单飞、触发合并、冻结、CAS、有界物理请求 |
| 多份“当前主线”漂移 | runtime 为进度唯一权威，记忆和 UI 为消费面 |
| 历史计划被最新版本覆盖 | 快照精确绑定，分叉/存档全链路验证 |
| 指标迫使内容模板化 | 规则硬门与内容评分分开，阶段数/字数为偏好 |

当前任务只交付方案与提示词。后续执行的默认交付范围为本地实现、自动测试、真实 LLM、Debug APK 与 Android QA、报告；不从参考项目文档继承 push main、签名发版或上传 Release 的指令。

完成必须同时满足本期必做功能、适用的 A01–A40 工程门与真实旅程门；所有未验项如实列出。不得删除失败用例、放宽门槛、替换真实样本或改名包装来宣称完成。

## 附录 A：TAVO-MINI 参考资产

以下链接为本机参考项目，本文只读取它们；历史文档的局部执行指令不作为本项目操作授权。

| 来源 | 文件与证据属性 |
|---|---|
| S01 | [主线可靠性 SPEC](F:/ClaudeWorkSpace/projects/TAVO-MINI/docs/superpowers/specs/2026-07-22-story-memory-mainline-reliability-spec.md)：历史症状与根因记录；[合同测试](F:/ClaudeWorkSpace/projects/TAVO-MINI/__tests__/storyMemoryMainlineContract.test.ts)、[生命周期测试](F:/ClaudeWorkSpace/projects/TAVO-MINI/__tests__/storyMemoryMainlineLifecycle.test.ts) 为当前参考测试资产 |
| S02 | [outlinePipelineSnapshot.test.ts](F:/ClaudeWorkSpace/projects/TAVO-MINI/__tests__/outlinePipelineSnapshot.test.ts)：计划/事实分离与旧大纲不回滚历史的断言；同时展示写作特有的主线约束 |
| S03 | [outlineContextBuilder.ts](F:/ClaudeWorkSpace/projects/TAVO-MINI/src/services/outlineContextBuilder.ts)、[packing 测试](F:/ClaudeWorkSpace/projects/TAVO-MINI/__tests__/outlinePackingAndStages.test.ts)、[fail-closed 测试](F:/ClaudeWorkSpace/projects/TAVO-MINI/__tests__/outlineFailClosed.test.ts)：身份、完整性、预算与读取失败 |
| S04 | [大纲模式架构精准修复方案](F:/ClaudeWorkSpace/projects/TAVO-MINI/docs/optimization/ShineWriter_大纲模式架构精准修复方案_20260815.md)：含实测回写；V5 往返、共享决议、批次预算等已证问题 |
| S05 | [REG-001 损坏冻结回归](F:/ClaudeWorkSpace/projects/TAVO-MINI/qa/generation-regressions/REG-001-corrupt-envelope-silent-refreeze/README.md)：已修复缺陷与红绿证据 |
| S06 | [multiChapterBatch/planner.ts](F:/ClaudeWorkSpace/projects/TAVO-MINI/src/services/multiChapterBatch/planner.ts)、[plannerCompiler.ts](F:/ClaudeWorkSpace/projects/TAVO-MINI/src/services/multiChapterBatch/plannerCompiler.ts)：冻结材料、严格解析、一次修复和完整用户意图 |
| S07 | [multiChapterBatchPlanHydration.test.ts](F:/ClaudeWorkSpace/projects/TAVO-MINI/__tests__/multiChapterBatchPlanHydration.test.ts)：持久计划与占位行区别 |
| S08 | [outlineFinalizePostWritingIntegration.test.ts](F:/ClaudeWorkSpace/projects/TAVO-MINI/__tests__/outlineFinalizePostWritingIntegration.test.ts)、[outlinePostWritingOutbox.test.ts](F:/ClaudeWorkSpace/projects/TAVO-MINI/__tests__/outlinePostWritingOutbox.test.ts)：采用、幂等、正文身份漂移与后处理 |
| S09 | [Pipeline Behavior Final Seal](F:/ClaudeWorkSpace/projects/TAVO-MINI/docs/optimization/TAVO-MINI_第二期_Pipeline-Behavior_Final-Seal_验收报告_20260821.md)：真实六样本与代码/APK/LLM 身份结论 |
| S10 | [CHANGELOG](F:/ClaudeWorkSpace/projects/TAVO-MINI/CHANGELOG.md)：QA durable preload 修复、冻结恢复、固定大纲比例和多阶段治理历史 |
| S11 | [V4 创作松绑方案](F:/ClaudeWorkSpace/projects/TAVO-MINI/docs/tavo-mini-v4-creative-loosening-redesign.md)：相邻续写模式的用户反馈与设计教训，非本轮重新实测结论 |
| S12 | [multiChapterBatchFaultMatrix.test.ts](F:/ClaudeWorkSpace/projects/TAVO-MINI/__tests__/multiChapterBatchFaultMatrix.test.ts)：崩溃、采用、尾部漂移、租约、重试和规模测试 |
| S13 | [outlineAssessmentValidation.test.ts](F:/ClaudeWorkSpace/projects/TAVO-MINI/__tests__/outlineAssessmentValidation.test.ts)：有大纲时校验字段必须存在、修复保持合同 |

## 附录 B：本次方案编写的验证范围

- 已核对两个仓库 HEAD、ShineWord 版本和当前关键协议常量。
- 已阅读上述 TAVO 参考资产中的相关实现、测试或历史问题段落；未运行 TAVO 测试，不给其当前版本新增“通过”结论。
- 已核对测试配置路径存在；未读取其正文或验证 API 连通。
- 已核对指定小说存在、大小与原始字节 SHA-256。
- 本方案完成后的检查仅针对文档完整性、链接、需求追踪和 diff；实现、性能、设备与真实 LLM 验收均待执行。
