# P7-0 基线重核与冻结合同

日期：2026-10-04（Asia/Shanghai）。本文是第七阶段施工的协议冻结依据（方案 §11 P7-0）。

## 1. 基线重核结果

| 项目 | 核验值 |
|---|---|
| HEAD | `main@8648d4d`（与方案核验基线一致） |
| 分支/工作区 | `main`，仅未跟踪 `docs/Shine-TRPG_PHASE7_CONSTRUCTION_PLAN.md`（保留，随 P7-0 一并提交） |
| 协议 | V0.6.0 / versionCode 60000；`shineword-save-7`；SQLite 迁移最大编号 31（`phase6_free_turn_interaction_fence`）；世界包 schema 2/3 |
| 测试基线 | 门禁命令 `npm run verify:core`（施工前 797 通过，以实际重跑为准） |
| 端上基线 | `com.shineword.app`，模拟器 `emulator-5554`（API 37.1，WHPX） |
| 测试资源 | 智谱 GLM-5.3-Flash（endpoint/model/key 见本地文件，不入库）；《放开那个女巫》GBK 全本 7,178,905 字节 |

关键接线事实（与方案 §2 的差异：无）。`runV2Turn` 时序为 committed-resume → 冻结合同 → 骰点 → Narrator → settlement → 原子提交；Prepared 归约插入在骰点之后、Narrator 之前（方案 §8.2）。

## 2. 版本冻结

| 项 | 冻结值 |
|---|---|
| 应用版本 | `0.7.0` / versionCode `70000` |
| SQLite 迁移 | 新增 **32** `phase7_situation_state_and_guidance`（表 `branch_situations`；`turn_narratives` 加列 `guidance_json TEXT` 可空） |
| 存档协议 | **`shineword-save-8`**；v8 = v7 + 可选 `state.situations` + 每回合可空 `guidance`；v7 旧档导入后 situations 从空开始 |
| 世界包 schema | 含 `situation` 条目的新发布包为 **`world-package-4`**；2/3 旧包照常加载（无局面玩法，走本地安全引导） |
| 引导请求 kind | `narrator_guidance`（调度 P1，低于 P0 玩家行动；账本身份 `guidance:{branchId}:{decisionPointId}`） |

## 3. 冻结合同

### 3.1 局面内容定义 `SituationDefinitionV1`（新 EntryKind `situation`）

- `definition`：`{ title, summary（玩家安全）, gmBrief（仅 GM）, locationId?, participantEntryIds[], activation: Condition, knowledgeCondition?: Condition, signs: [{text, requiresKnowledgeEntryId?}], pressure: {deadlineClockSeconds?, pressureEventKey?, description}, methods: MethodTemplateV1[], transitions: {onSuccess?, onPartial?, onFailure?, onExpire?}, followUpSituationIds[], referenceEventKeys[] }`
- 可见性：`gm`（阅读页玩家视图走安全投影；signs/summary/methods 文本必须玩家安全，发布校验强制）。
- `MethodTemplateV1`：`{ methodId, title, goal, firstStep: {intent, actionKind, skillId?, itemId?, abilityId?, targetEntryId?, destinationId?}, requires: {skillId?, minRank?, itemId?, knowledgeEntryId?, relationshipTo?, minCloseness?, actorAlive?, actorAt?, condition?}, tradeoffs, preparation, visibility?: Condition }`。模板只描述首步尝试；两条办法必须在 goal/firstStep/requires 至少一处实质不同，发布去重。
- 依赖规则：`situation → skill | item | actor_template | scene | quest | lore | condition`。
- provenance：参与者/动机/事件引用 explicit/inferred；门槛、时间、消耗 rule_mapping；互动窗口、压力规则、办法与条件结果 design_fill（禁止为凑路径数编造原著没有的技能/人物/秘密）。

### 3.2 局面状态 `BranchSituationStateV1`（GameStateSnapshot.situations）

`{ situationId, status: 'dormant'|'eligible'|'active'|'resolved'|'suppressed', activatedAtVersion?, resolvedAtVersion?, resolution?, counters: Record<string,number>, processedEventKeys: string[], promises: PromiseRecord[], sourceTurnId, statusVersion }`
- `PromiseRecord`：`{ promiseId, promisorActorId, promiseeActorId?, description, status: 'open'|'fulfilled'|'broken', dueClockSeconds?, createdAtVersion, resolvedAtVersion?, sourceTurnId, idempotencyKey }`。
- 持久化：`branch_situations` 投影表（同回合事务 DELETE+重灌，随快照 JSON 一起盖章），分叉/回退/存档随快照走。

### 3.3 条件白名单（v1，禁 eval/脚本/动态 SQL）

`all{of[]}` / `any{of[]}` / `not{of}` / `actor_alive{actorId}` / `actor_at{actorId,locationId}` / `item_owned_by{itemId,actorId}` / `knowledge_known{entryId,actorId?}` / `relationship_at_least{fromActorId,toActorId,closeness}` / `quest_status{questId,status}` / `situation_status{situationId,status}` / `reference_event_resolved{eventKey}` / `world_time_at_least{order}`。
- 求值结果三值：`true|false|unknown`；引用的数据不存在 → `unknown`，unknown 不激活事件（方案 §4.3）。
- 规模上限：AST ≤ 24 节点、深度 ≤ 6（发布校验强制）；`situation_status` 只读已存状态，不递归求值，结构上无环。
- `world_time_at_least` 的 order 来自**战役因果进度**（分支已结算事件引用的 canon 事件 worldTimeOrder 最大值），不是回合数或世界时钟分钟数。

### 3.4 局面转换效果白名单（engine-only，本地编译器产生）

`set_situation_status{situationId,status,resolution?}` / `situation_counter{situationId,counterId,delta}` / `promise_create{...}` / `promise_fulfill{promiseId}` / `promise_break{promiseId}` / `suppress_reference_event{eventKey,reason}`。每个提交事件带 `eventKey` 幂等键（`processedEventKeys` 去重）；文本永远不能产生这些效果。

### 3.5 Prepared 归约 `PreparedTurnResolutionV1`（内存结构，不落独立表）

`{ contract, contractHash, outcomeGrade, rollRecord?, settlement?, nextState（已版本+1、已应用全部效果/发现/局面转换）, committedTurnDraft, domainEvents, lifeEvents, decisionPoint }`。
- 在骰点后、Narrator 前由纯本地归约器一次性计算；commit 阶段**应用同一对象**（不再二次归约），stateVersion CAS + fence 照旧。
- 崩溃恢复：合同与骰点已持久化，Prepared 从相同输入确定性重算；不重掷骰点、不改冻结合同。
- settlement 在归约前一次性计算并放入 Prepared；奖励/关系只有一次写入。

### 3.6 玩家安全局势包 `PublicSituationPacketV1`（进入 Narrator 请求）

`{ changes: string[], opportunities: [{text,situationId?}], pressures: [{text,deadlineClockSeconds?}], actorNotes: [{actorId,note}], allowedCandidates: AllowedCandidateV1[] }`。
- `AllowedCandidateV1`：`{ ref, methodId?, actionId?, title, goal, firstStepIntent, actionKind, skillId?, tradeoffs, preparation, availability: 'available'|'needs_preparation', blockers[] }`。ref 命名空间：`method:{situationId}:{methodId}` 或 `action:{actionId}`。
- 每字段由本地投影生成并过权限过滤；GM-only 名称、未发现条目、未来事件不得进入。

### 3.7 Narrator 输出 v2 与路径候选 `NextStepCandidateV1`

- 同一 Narrator 请求输出 `{turnId, outcomeGrade, text, situationSummary?: {changes[], opportunities[], pressures[]}, nextSteps?: [{candidateRef, title, rationale, tradeoffs, firstStepIntent}]}`；`nextSteps` ≤ 6。
- 正文与 nextSteps 分别校验：正文规则不变；nextSteps 校验 candidateRef ∈ 允许集、字段长度上限（title 24 / rationale 80 / tradeoffs 120 / firstStepIntent 160）、实体名只允许出现在玩家可见集合、数字除本地注入的固定消耗说明外剥离。
- 正文有效而路径非法：保留正文，丢弃非法路径，本地引导兜底；**不为修路径重发 Narrator**（方案 §8.4）。

### 3.8 持久化引导 `TurnGuidanceV1`（turn_narratives.guidance_json）

`{ guidanceVersion: 'turn-guidance-1', decisionPoint: {campaignId, branchId, playerActorId, sourceTurnId, decisionPointId, stateVersion, contentBindingHash, knowledgeHash, contextHash}, severity: 'normal'|'major', situationSummary, steps: [{source:'llm'|'local', candidateRef, title, rationale, tradeoffs, firstStepIntent, actionKind, availability, methodId?, actionId?, blockers?}], degraded, degradationReason? }`。
- `decisionPointId = {branchId}:{nextStateVersion}`；正文与引导同一条 turn_narratives 行持久化，允许 guidance 为空。
- 展示数量政策（核心投影统一，UI 不再截断）：normal ≤ 3、major ≤ 4；先实质去重再截断。

### 3.9 重大变故识别（本地，事件类型阈值）

`actor_death_resolved` / `actor_recovered_from_critical` / `quest_succeeded` / `quest_failed` / `situation_resolved` / `situation_suppressed` / `reference_event_suppressed` / `promise_fulfilled` / `promise_broken` / 关键物品得失（活跃局面 methods/pressure 引用的 itemId 发生 owner 变更）/ 关系跨越 60 门槛。同一操作多事件在决策点合并为一组引导。

### 3.10 兼容政策

- 旧包（world-package-2/3）加载：无 situation 条目 → 玩法照旧，引导走本地候选（基础行动+已知资源），不阻塞。
- 旧存档（save-7）导入：situations 空；不追溯构造战役经历、不补发奖励/债务/死亡。
- 新战役采用含 situation 的新内容：安全边界显式采用，局面初始化为 dormant，仅从当前已提交事实开始评估。
- 旧应用读 save-8：显式拒绝（"当前版本不支持 shineword-save-8"），不静默丢字段。
- 回退分叉：新分支局面状态从回退点快照恢复；历史路径不可在新分支提交（decisionPoint 绑定 branchId+stateVersion）。

### 3.11 附属引导（本地动作/NPC 自动步骤后的决策点）

- 仅用于"已提交且玩家可行动但无对应 Narrator"的决策点；每个决策点去重（logical id `guidance:{branchId}:{decisionPointId}`，成功缓存身份含 API/模型指纹）。
- 低于 P0；玩家行动不被其阻塞；迟到结果核对 decisionPoint 身份，过期不替换当前建议。
- unknown 按既有精确恢复流程；换 API/模型不绕过。

## 4. 固定验收夹具（三题材）

`tests/fixtures/phase7/situationFixtures.cjs`（合成夹具，明确不冒充真实小说；真实材料验收在 P7-7 用《放开那个女巫》）：

1. **追查/救援（fixture `rescue`）**：师门遭袭——同伴重伤（不救则原著未来 order 30 死亡参考事件）、信物被夺（追踪线索可见）、城中援助者（关系门槛）。办法：救治（医术+时间，追踪窗口收缩）/ 追踪（追踪技能+可见线索，救治压力保持）/ 求援（关系≥40 或筹码物品）/ 撤离（移动条件）。预期分歧：救下后 order 30 参考事件抑制、同伴存活；未救则死亡事件成立且后续局面改写。
2. **交涉/关系（fixture `parley`）**：军需官守着补给不放行（忠于职责，可观察行为：按章程办事）。办法：交涉（社交技能）/ 以物易物（持有关键物品）/ 先完成委托（任务状态门槛）。预期分歧：不同路线的关系数值、承诺与物资归属差异。
3. **探索/成长（fixture `ruin`）**：废墟密门（观察可得线索：门上有旧纹样）。办法：观察+学识检定（需要已知线索）/ 攀爬（敏捷技能，风险）/ 寻找工具（物品依赖，needs_preparation）。预期分歧：发现条目、练习奖励与门后局面激活路径差异。

夹具内标出：原著基线（explicit 事实+引文哈希）、未来参考（canon 事件 order>anchor）、秘密（GM-only 条目）、设计补全（design_fill 办法）、合法路径与预期持久后果（每条路线的断言清单）。

## 5. 时序冻结（settlement/发现/奖励/NPC 接入 Prepared）

1. 冻结合同（现有 stageRollTurn）。
2. 骰点 resolveOrReuseRoll（不变）。
3. **Prepared 归约**：clone 状态 → applyEffects（合同效果）→ 领域归约（现有 updateCommittedState 通道：发现/任务/关系/冷却）→ 局面转换（新）→ 生命事件 → 版本+1 → decisionPoint 绑定。
4. settlementFor 一次计算并入 Prepared。
5. PublicSituationPacket + 本地允许候选（从 Prepared 的 nextState 生成）。
6. Narrator（正文+路径，同一请求）→ 分别校验。
7. commitPreparedTurn（应用 Prepared 对象；CAS+fence+账本去重）。
8. markCommitted（正文与引导同回合标记提交）；展示仅在提交后。

NPC 自动步骤与本地动作（rest/train/迁移）继续走既有 commitResolvedTurn；其决策点由附属引导任务（§3.11）补 LLM 引导，玩家无需等待。

## 6. 验收样例（P7-0 出口）

"救下原著会死的人"（fixture `rescue`）：
- 旧未来事件 `evt-companion-death`（order 30，条件 `actor_alive{companion}`）在同伴被救（lifeStatus 保持 active、伤势资源恢复）后求值为 false → 激活评估时记录 `suppressed`，原因 `precondition_false`，canon 事件与原文引文不改写；
- 同伴在分支快照中仍存活（A01）；
- 下一步路径允许引用：`method:rescue:heal`（若已救治则不再出现）、`method:rescue:seek-aid`、基础行动；不允许引用 GM-only 的刺客身份条目（A09）。

协议可执行验证样例：`tests/phase7-contracts.test.cjs`（条件求值三值/上限、效果幂等、引导校验拒绝越权引用）。
