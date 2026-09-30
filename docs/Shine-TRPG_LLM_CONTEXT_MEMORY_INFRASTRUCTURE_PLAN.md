# Shine-TRPG LLM 上下文与长期记忆基础设施专项改造方案

> 文档状态：专项建设基线 / 可直接交付 Agent 施工  
> 项目：Shine-TRPG（GitHub：`anjingdtl/ShineWord`）  
> 参考成熟项目：`anjingdtl/tavo-mini`  
> 编制日期：2026-09-30  
> Shine-TRPG 审计基线：`main@c09066979d79d96e78e90c574ec1d9a36812cb66`  
> tavo-mini 参考基线：`main@0a4eabc645eb36b8fde5de1fb8bedb2739dec900`  
> 建设定位：在现有“统一世界构建 + 完整/循序构建 + Planner/Narrator + 本地规则权威”基础上，补齐统一 LLM 请求预算、弹性上下文、长期故事记忆、情节召回、JSON 韧性与物理请求审计基础设施。  
> 本方案不重写 D&D/本地规则、不改变 ActionContract 权威边界、不重做现有 P3/P4 UI，也不重新设计完整/循序世界构建主架构。

---

# 0. 建设结论

Shine-TRPG 当前已经具备：

- 小说 TXT 导入；
- 世界构建与三宝书；
- 原著人物、技能、事实、证据抽取；
- 完整构建 / 循序构建；
- Planner → 本地规则 → Narrator；
- GameStateSnapshot 权威状态；
- 基础长期摘要；
- 基础历史检索；
- Provider capability / reasoning / usage 基础；
- JSON mode；
- 世界构建物理请求调度；
- Android 后台构建；
- 分支 / rewind / save / content binding。

但随着项目进入真实长篇小说与长程 TRPG 游玩，当前 LLM 基础层仍存在四类结构性风险：

1. **上下文预算仍然分散在各业务调用点，缺少统一弹性分配。**
2. **故事长期记忆仍以“每 8 回合一次短摘要”为主，无法支撑 100～1000 回合的角色关系、承诺、冲突、伏笔和历史召回。**
3. **模型 JSON 输出入口仍存在严格模板脆弱性，合法但带包装、别名、尾逗号、双重编码或轻微枚举差异的结果可能被整次拒绝。**
4. **思维链、业务输出、模型最大输出、上下文窗口和 Provider wire budget 仍未统一进入一个请求预算内核，存在 reasoning 吃光业务输出、固定 token 数字误当模型能力等风险。**

因此，本专项最终目标不是增加新的玩法，而是建立一套统一的：

```text
Model Capability
      ↓
Request Budget Kernel
      ↓
Elastic Context Planner
      ↓
Frozen Request Context
      ↓
LLM Provider
      ↓
Response Normalizer
      ↓
Structured / Narrative Output Path
      ↓
Authority Gate
      ↓
Durable Request Ledger
```

并为每一轮游戏请求提供：

```text
Current State
+ Current Scene
+ Relevant Character Cards
+ Relevant Three Books
+ Story State Memory
+ Episodic Recall
+ Recent Turns
+ Relevant Canon Evidence
```

且这些材料必须根据**当前模型真实能力和当前请求目的进行弹性分配**。

---

# 1. 参考 tavo-mini 的成熟经验

本专项不是照搬 tavo-mini 业务代码，而是提炼其已经经过真实模型、长篇写作、长期记忆、JSON 异常、思维链和冷启动恢复验证的基础设施经验。

重点参考模块：

```text
tavo-mini/src/services/pipeline/elasticBudgetAllocator.ts
tavo-mini/src/services/context/hierarchicalContextAllocator.ts
tavo-mini/src/services/context/generation/allocateGenerationContextBudget.ts
tavo-mini/src/services/contextAutomationPolicy.ts

tavo-mini/src/services/storyMemory/
tavo-mini/src/services/episodicMemoryRetriever.ts

tavo-mini/src/utils/jsonExtractor.ts
tavo-mini/src/services/continuation/canon/canonJsonValidators.ts

tavo-mini/src/services/llm/providerCapabilities.ts
tavo-mini/src/services/continuation/canon/canonBudgetPolicy.ts
tavo-mini/src/services/storyMemory/storyMemoryBudget.ts
tavo-mini/src/services/storyMemory/storyMemoryRequestBudget.ts

tavo-mini/src/data/repositories/storyMemoryRequestAttemptRepository.ts
tavo-mini/src/services/storyMemory/storyMemoryAttemptPolicy.ts
```

核心经验如下。

## 1.1 上下文不是固定比例，而是“需求 + 水位 + 借用 + 回收”

采用：

```text
Soft 80%
Burst 95%
Hard 100%
```

并区分：

```text
mandatory
preferred
optional
```

未使用的预算可以回收，高优先级内容可以借用 Burst，但最终绝不能越过 Hard Limit。

## 1.2 Story Memory 与 Episodic Memory 必须分离

长期状态用于回答：

> “现在这个世界和这些人的关系是什么？”

情节记忆用于回答：

> “以前具体发生过什么？”

两者用途不同，不能都压成一个 120 字 summary。

## 1.3 容错应该发生在模型输入边界，严格应该发生在权威落库边界

模型输出应遵循：

```text
宽进
→ 规范化
→ 严格校验
→ 权威提交
```

而不是要求模型第一次输出就达到数据库级严格格式。

## 1.4 模型能力、任务需求和 Provider 协议必须分层

绝不能混淆：

```text
context window
model max output
reasoning reserve
business output demand
wire max_tokens
```

## 1.5 请求已经发出后必须可审计

App 强杀或网络中断后：

```text
sent
→ cold start
→ outcome_unknown
```

不能悄悄再请求一次，从而造成重复计费和双结果污染。

---

# 2. 本专项建设边界

## 2.1 本轮要建设

1. Unified Request Budget Kernel
2. Elastic Context Planner
3. Story Memory V2
4. Episodic Recall V2
5. JSON Resilience Layer
6. Reasoning / Output Budget Governance
7. Durable Physical Request Ledger
8. Planner / Narrator 接入统一 Context
9. Summarizer / Memory Maintenance 接入统一预算
10. 世界构建 LLM 调用逐步统一到同一能力解析和请求审计
11. Debug / Trace / Preview
12. 回归、长程与故障恢复测试

## 2.2 本轮不建设

- 不新增 TRPG 战斗规则；
- 不改变骰子数学；
- 不改变技能成长阈值；
- 不改变 ActionContract 的本地权威边界；
- 不把 LLM 变成数值真相来源；
- 不重新设计 UI 主题；
- 不重新拆 P3/P4 页面；
- 不重写完整 / 循序世界构建；
- 不新增新的小说解析模式；
- 不做云端向量数据库依赖；
- 不要求接入外部 Embedding 服务作为 MVP 前提；
- 不用长期记忆取代 GameStateSnapshot；
- 不让 Summary 覆盖 HP、资源、技能等权威数值。

---

# 3. 当前 Shine-TRPG 的具体差距

## 3.1 回合上下文是固定拼接

当前 `CampaignSession.buildWorldContext()` 主要将以下内容串接：

```text
公共 lore
公共 constraint
当前角色状态
当前位置 NPC
主目标
相关长期记忆 limit=8
已知线索
最近 6 回合
最多 3 个原著证据片段
```

其中仍存在固定：

```text
memory.text.slice(0, 900)
recent turn slice(0, 120)
source passages slice(0, 3)
```

该逻辑无法根据 32K / 64K / 128K / 200K / 1M 模型窗口自动扩缩。

## 3.2 Planner 输出仍有固定预算

当前仍存在类似：

```ts
maxOutputTokens: 2200
```

这属于业务任务固定预算，但目前没有经过统一的模型能力、reasoning reserve、safety margin 和 context pressure 计算。

## 3.3 Story Memory 过于扁平

当前：

```text
SUMMARY_INTERVAL_TURNS = 8
```

每 8 回合把若干 `publicSummary` 压缩为一条短 summary。

优点是简单、成本低、不存储错误数值；缺点是无角色状态模型、无关系生命周期、无冲突 / 承诺 / 伏笔 / 任务长期状态、无实体化 Memory、分支 dirty / rewind 后重建机制弱、长程历史召回能力不足。

## 3.4 Episodic Retrieval 过于简单

当前主要使用字符 bigram overlap。需要升级为：

```text
语义词项
+ 中文 n-gram
+ 人物实体 boost
+ 人物对 boost
+ 物品 boost
+ 任务/线索 boost
+ recency bucket
+ branch/time/visibility gate
```

## 3.5 JSON 主入口过严

当前 `parseStrictJsonObject()` 要求 trim 后以 `{` 开头、以 `}` 结尾且整个字符串只能是一个 JSON object。

对内部持久化 JSON 是正确的，但对 Provider 原始输出不够韧性。

## 3.6 Capability Probe 仍有模型窗口默认值风险

当前 probe 无法探测模型 context 时仍可能生成固定 `128000` 能力值。以后必须区分：

```text
declared
probed
derived
unknown
```

无法确认就不能伪装成“已验证 128K”。

---

# 4. 总体目标架构

```text
                      ┌───────────────────────┐
                      │  Frozen Model Profile │
                      │ Context / Output / CoT│
                      └───────────┬───────────┘
                                  │
                         ┌────────▼────────┐
                         │ Request Budget  │
                         │     Kernel      │
                         └────────┬────────┘
                                  │
                 ┌────────────────┼────────────────┐
                 │                │                │
        ┌────────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
        │ Input Envelope│ │Output Demand │ │Reason Reserve│
        └────────┬──────┘ └──────┬──────┘ └──────┬──────┘
                 └────────────────┼────────────────┘
                                  │
                         ┌────────▼────────┐
                         │ Context Planner │
                         └────────┬────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │             │           │          │              │
        ▼             ▼           ▼          ▼              ▼
 Current State   World Books  Story Memory Episodic    Canon Evidence
        │             │           │          │              │
        └─────────────────────────┼─────────────────────────┘
                                  │
                       Frozen Context Snapshot
                                  │
                                  ▼
                           LLM Provider
                                  │
                                  ▼
                       Response Normalizer
                                  │
                   ┌──────────────┴──────────────┐
                   ▼                             ▼
             Structured Path               Narrative Path
                   │                             │
          JSON Candidate Extractor               Text
                   │                             │
             Safe Repair                        │
                   │                             │
             Alias Normalize                    │
                   │                             │
             Schema Validate                    │
                   │                             │
            Semantic Validate                   │
                   └──────────────┬──────────────┘
                                  ▼
                           Authority Gate
                                  │
                                  ▼
                          Durable Ledger
```

---

# 5. 新增目录建议

建议新增：

```text
src/application/context/
├─ contextTypes.ts
├─ contextPolicy.ts
├─ modelEnvelope.ts
├─ elasticAllocator.ts
├─ candidateCollector.ts
├─ relevance.ts
├─ contextPlanner.ts
├─ contextRenderer.ts
├─ contextSnapshot.ts
├─ contextTrace.ts
└─ index.ts

src/application/memory/
├─ storyMemoryTypes.ts
├─ storyMemoryPolicy.ts
├─ storyMemoryRepository.ts
├─ storyMemoryMaintenance.ts
├─ storyMemoryCompiler.ts
├─ storyMemoryMerger.ts
├─ storyMemoryValidator.ts
├─ episodicIndex.ts
├─ episodicRetriever.ts
├─ memoryContextProvider.ts
└─ index.ts

src/application/llm/
├─ requestPlan.ts
├─ requestBudgetKernel.ts
├─ responseNormalizer.ts
├─ structuredOutput.ts
├─ requestLedger.ts
└─ failurePolicy.ts
```

已有 `src/application/llm/json.ts`、`src/application/llm/requestBudget.ts`、`src/application/memory/retrieval.ts`、`src/application/memory/summarizer.ts` 应优先演进，不为了目录漂亮而一次性大搬迁。

---

# 6. Unified Request Budget Kernel

## 6.1 目标

任何 LLM 业务请求，都不再自己随手指定一个 token 数。统一进入：

```ts
planLlmRequest()
```

输入：

```ts
interface LlmRequestPlanningInput {
  profile: FrozenApiProfile;
  requestKind:
    | 'planner'
    | 'narrator'
    | 'memory_checkpoint'
    | 'memory_repair'
    | 'world_extract'
    | 'world_mapping'
    | 'world_adjudication'
    | 'summarizer';

  estimatedMandatoryInputTokens: number;
  businessOutputDemand: OutputDemand;
  contextDemands?: ContextDemand[];
}
```

输出：

```ts
interface FrozenLlmRequestPlan {
  profileFingerprint: string;

  contextWindowTokens: number;
  modelMaxOutputTokens: number;
  providerWireMaxOutputTokens: number;

  reasoningReserveTokens: number;
  safetyMarginTokens: number;

  hardInputLimit: number;
  softInputLimit: number;
  burstInputLimit: number;

  allocatedInputTokens: number;
  requestedOutputTokens: number;

  contextPlanId: string;
  trace: RequestBudgetTrace;
}
```

---

# 7. 模型能力来源治理

必须建立来源字段：

```ts
type CapabilitySource =
  | 'user_declared'
  | 'provider_documented'
  | 'provider_probe'
  | 'derived'
  | 'unknown';
```

模型能力：

```ts
interface FrozenModelCapabilities {
  contextWindowTokens: number | null;
  contextWindowSource: CapabilitySource;

  maxOutputTokens: number | null;
  maxOutputSource: CapabilitySource;

  reportsUsage: boolean;
  supportsJsonMode: boolean;
  supportsPromptCache: boolean;

  reasoningMode: 'none' | 'optional' | 'always_on' | 'unknown';
  reasoningUsageReported: boolean;
}
```

硬规则：

1. `unknown` 不能转成 `128000`。
2. `max_output_tokens` 留空时，可根据 context 派生“运行时安全值”，但必须标记 source=`derived`。
3. 派生值不能反写用户配置。
4. Provider wire 限制不能反写模型能力。
5. Stage demand 不能反写模型能力。

---

# 8. Request Envelope

定义：

```text
C = ContextWindow
O = Provider-valid Output Reservation
R = Reasoning Reserve
S = Safety Margin

HardInput = C - O - R - S
SoftInput = HardInput × 0.80
BurstInput = HardInput × 0.95
```

如果 Provider 计费/协议将 reasoning 包含在 completion 中，则实现需要按 Provider adapter 决定：

```text
O_business + R_reasoning <= wire completion budget
```

或者：

```text
O_wire = business + reasoning reserve
```

不能双减，必须由 Provider adapter 明确声明。

---

# 9. Safety Margin

禁止统一写死一个数字。建议：

```ts
function deriveSafetyMargin(contextWindow: number): number
```

参考：

```text
小窗口：至少 512～1024
中窗口：窗口的 1～2%
大窗口：设置合理上限，避免浪费过多
```

最终应测试 32K / 64K / 128K / 200K / 1M。

---

# 10. Output Demand

每一种任务声明自己的“业务需求”，而不是声明模型能力。例如：

```text
planner:
  minimum = 900
  target  = 1800
  maximum = 4000

narrator:
  minimum = 800
  target  = 2500
  maximum = 8000

memory_checkpoint:
  根据事件数量动态

world_extract:
  根据 batch chunks / 预计 facts 数动态
```

然后：

```text
requestedOutput = min(
  business maximum,
  model capability,
  provider wire ceiling,
  context headroom after mandatory input
)
```

如果 `requestedOutput < business minimum`，则 BLOCK，而不是发送一个注定失败的请求。

---

# 11. Reasoning Budget Governance

## 11.1 不允许把思维链与正文混在一起

必须单独记录：

```text
completionTokens
reasoningTokens
businessContentTokens
```

如果 Provider 只给 completion 总数，则 `reasoningTokens = unavailable`，不能猜成 0。

## 11.2 reasoning-only 分类

定义：

```text
finish_reason=length + reasoning_content 非空 + content 为空
→ reasoning_only
```

## 11.3 Shine-TRPG 当前政策

当前统一原则：

> 不因自动恢复流程关闭模型思维。

因此不要照搬 tavo-mini 旧 StoryMemory 中的 `reasoning_only → disable thinking`，而采用：

```text
Attempt 1:
正常 reasoning tier

reasoning_only
↓
Attempt 2:
提高 wire output / reasoning reserve
同时降低 optional context

仍 reasoning_only
↓
Attempt 3:
缩小任务本身
  - Planner：进一步瘦 Context
  - Memory：split batch
  - Extract：split group
  - Mapping：split entities

仍失败
↓
明确 capability insufficient
```

物理请求必须有上限。建议 Planner/Narrator ≤2 次，Memory/Extract ≤3 次。

---

# 12. Elastic Context Planner

## 12.1 Board 设计

Shine-TRPG 推荐六大 Board：

```text
1. authority
2. currentState
3. worldKnowledge
4. storyMemory
5. recentHistory
6. sourceEvidence
```

### authority

包括 ActionContract schema 摘要、可执行 actionTypes、合法 skillId、合法 locationId、规则约束、状态版本、content binding。

Requirement：`mandatory`

### currentState

包括玩家、同组成员、当前地点、当前资源、conditions、lifeStatus、当前 encounter、当前任务。

Requirement：`mandatory`

### worldKnowledge

包括相关三宝书、相关人物卡、相关公开世界规则、地点资料、任务资料。

Requirement：`preferred`

### storyMemory

包括长期人物关系、重要承诺、当前冲突、活跃线索、已知长期目标、相关伏笔。

Requirement：`preferred`

### recentHistory

包括最近若干完整回合。

Requirement：`preferred / optional`

### sourceEvidence

包括已经可见、时间锚合法的原著片段。

Requirement：依据当前行动动态决定 `optional / preferred`。

---

# 13. Board 默认权重建议

不要把以下数值当永久协议，只作为首版默认并通过测试校准：

| Board | Soft Share | Priority | Requirement |
|---|---:|---:|---|
| authority | 12% | 100 | mandatory |
| currentState | 18% | 95 | mandatory |
| worldKnowledge | 22% | 80 | preferred |
| storyMemory | 20% | 85 | preferred |
| recentHistory | 16% | 70 | preferred |
| sourceEvidence | 12% | 75 | optional/preferred |

Soft Share 不是硬上限。如果 authority 实际只需 4%，释放的预算必须进入 Global Elastic Pool。

---

# 14. Item 级预算

Board 内部也不能 FIFO。例如人物卡：

```text
score =
priority
× relevance
× explicitBoost
× recencyBoost
× currentSceneBoost
```

用户当前明确提及的人物：`explicitBoost = 1.5～2.0`。

当前同队人物获得 currentSceneBoost；远处无关 NPC 低分或不激活。

---

# 15. 上下文候选统一结构

```ts
interface ContextCandidate {
  id: string;

  board:
    | 'authority'
    | 'currentState'
    | 'worldKnowledge'
    | 'storyMemory'
    | 'recentHistory'
    | 'sourceEvidence';

  text: string;
  estimatedTokens: number;

  requirement:
    | 'mandatory'
    | 'preferred'
    | 'optional';

  priority: number;
  relevance: number;

  minTokens: number;
  targetTokens: number;
  maxTokens: number;

  clipMode:
    | 'none'
    | 'whole_item'
    | 'sentence'
    | 'text';

  provenance: {
    sourceType: string;
    sourceId: string;
    stateVersion?: number;
  };
}
```

---

# 16. Whole Item 优先

人物、关系、任务、事实不能简单字符截断。

例如人物卡 1200 tokens 只分到 600，如果直接截一半，可能名字还在但技能或关系已经被截掉。

因此：

- 人物卡：whole item；
- 关系：whole item；
- quest：whole item；
- Memory beat：whole item；
- 原著 passage：允许句子级裁剪；
- Recent narrative：可 text clip。

---

# 17. Frozen Context Snapshot

一轮 Planner 请求开始后，必须冻结：

```ts
interface FrozenTurnContext {
  contextId: string;
  branchId: string;
  stateVersion: number;

  contentDependency: ContentDependencyBinding;

  modelProfileFingerprint: string;
  budgetPlanFingerprint: string;

  includedCandidateIds: string[];
  droppedCandidateIds: string[];

  renderedContext: string;
  estimatedTokens: number;
}
```

作用：

1. Planner 与后续审计有明确输入；
2. Rewind / crash resume 可以知道当时看到了什么；
3. 后台世界包更新不能污染当前已经开始的 Turn；
4. 调试时可以复现“为什么模型会这么判断”。

---

# 18. Context Render 格式

默认不要把整个 Context 渲染成巨大 JSON。推荐：

```text
【行动协议】
...

【当前局面】
...

【队伍】
...

【当前地点】
...

【相关人物】
...

【世界规则】
...

【长期故事状态】
...

【相关往事】
...

【原著证据】
...
```

只有真正机器需要处理的 ID / contract 子结构才保留 JSON。

目标是降低 JSON token 税、提高可读性、降低模型格式压力。

---

# 19. Story Memory V2

## 19.1 设计原则

Story Memory V2 是从已经 committed 的游戏历史中派生出来的长期叙事状态。

它不是权威数值状态。

绝不能覆盖：

```text
HP
stamina
skill rank
inventory ownership
location
conditions
quest counters
lifeStatus
```

这些仍从 `GameStateSnapshot` 读取。

---

# 20. Story Memory V2 数据结构

```ts
interface StoryMemoryState {
  schemaVersion: 2;

  branchId: string;
  throughStateVersion: number;

  characters: Record<string, StoryMemoryCharacter>;
  relationships: Record<string, StoryMemoryRelationship>;

  narrative: {
    currentArc: StoryArc | null;
    currentObjective: string;

    activeConflicts: Record<string, StoryConflict>;
    openThreads: Record<string, StoryThread>;
    foreshadowing: Record<string, StoryForeshadowing>;

    recentCompletedBeats: StoryBeat[];
    recentResolvedThreads: StoryResolvedThread[];

    archiveDigest: string;
  };

  metadata: {
    status: 'empty' | 'clean' | 'dirty' | 'rebuilding' | 'failed';
    dirtyFromStateVersion: number | null;
    fingerprint: string;
    lastAppliedPatchId: string | null;
    updatedAt: string;
  };
}
```

---

# 21. StoryMemoryCharacter

只存叙事长期信息：

```ts
interface StoryMemoryCharacter {
  actorId: string;
  stableIdentitySummary: string;

  currentNarrativeState: {
    emotionalState: string;
    currentGoal: string;
    concerns: string[];
    promises: string[];
    secretsKnownToPlayer: string[];
  };

  importantExperiences: string[];
  lastChangedStateVersion: number;
}
```

location、HP、items 等实时权威字段不要复制进入 Story Memory 主状态。如果为了叙事需要地点描述，只能作为叙事材料，不得参与规则判断。

---

# 22. StoryMemoryRelationship

```ts
interface StoryMemoryRelationship {
  relationshipId: string;
  fromActorId: string;
  toActorId: string;
  relationType: string;
  currentNarrativeState: string;
  trustNarrative: string;
  importantPromises: string[];
  unresolvedTensions: string[];
  publicStatus: 'public' | 'secret' | 'misunderstood';
  lastChangedStateVersion: number;
}
```

---

# 23. Story Memory 更新节奏

不要固定“每 8 回合必定更新”。使用 Smart Cadence。

触发条件：

```text
A. 距离 checkpoint >= 8 回合
B. 发生高重要度事件
C. 关系显著变化
D. Quest/Conflict open/resolve
E. 同伴加入/离队/死亡
F. Rewind / branch dirty
G. pending token 超阈值
H. 用户手动整理
```

普通小回合可以暂不触发 LLM Memory。

---

# 24. Memory 更新批次

Memory 的“何时触发”和“一次处理多少回合”必须分开。

例如每 8 回合触发，不代表一次请求必须吃 8 回合。根据模型窗口拆成 `3 + 3 + 2` 也是合法的。

---

# 25. Story Memory Patch

LLM 不返回整个完整 Memory，而返回 Patch：

```ts
interface StoryMemoryPatch {
  schemaVersion: 2;

  range: {
    fromStateVersion: number;
    toStateVersion: number;
  };

  characterUpdates: unknown[];
  relationshipUpdates: unknown[];
  conflictChanges: unknown[];
  threadChanges: unknown[];
  foreshadowingChanges: unknown[];
  completedBeats: unknown[];
}
```

优点：

- 输出更小；
- JSON 更稳定；
- 可重试；
- 可审核；
- 可确定性 merge；
- 方便 branch invalidation。

---

# 26. Story Memory Evidence

Memory Patch 每一项必须能回指：

```text
turnId
stateVersion
```

例如：

```ts
evidenceTurnIds: string[]
```

不要求复制整段正文。Memory 的真实性来自 committed turn，而不是模型自由回忆。

---

# 27. Story Memory Merger

本地 deterministic merge：

```text
Previous Memory
+
Validated Patch
=
Next Memory
```

LLM 不负责生成 stable ID、决定数据库主键、修改 stateVersion。稳定 ID 应本地产生。

---

# 28. Story Memory Dirty / Rebuild

### Branch rewind

例如：

```text
Memory 已整理到 v80
用户 rewind 到 v55
```

不能继续使用 v56～v80 的长期记忆。必须将 branch memory 标记为 `invalid after v55`，新分支从最近安全 checkpoint 重建。

### Patch fingerprint

每次 merge：

```text
baseFingerprint
→ patch
→ resultFingerprint
```

防止旧 patch 应用到新状态。

---

# 29. No-Stall Memory

这是本专项硬原则之一。

正常回合不能因为“Memory 后台还没总结完”而无法玩。

### Safe lag

如果 Story Memory through v64、当前 v68，且 v65～v68 原始回合完整：

```text
使用：
Story Memory v64
+ Recent v65～v68
```

继续游戏，同时后台补 Memory。

### Hard gap

如果 Memory 到 v64，但历史 v65～v68 缺失或损坏，则 fail closed，不能假装这些回合不存在。

---

# 30. Episodic Memory V2

## 30.1 用途

回答：

> “以前发生过什么与当前问题最相关？”

而不是：

> “最近发生了什么？”

---

# 31. Episodic 数据来源

每个 committed Turn 生成本地可检索条目：

```ts
interface EpisodicTurnRecord {
  branchId: string;
  turnId: string;
  stateVersion: number;

  publicSummary: string;
  narrativeText: string;

  actorIds: string[];
  locationIds: string[];
  questIds: string[];
  entryIds: string[];
  itemIds: string[];
  keywords: string[];

  invalidAtStateVersion: number | null;
}
```

可以从 ActionContract、Turn settlement、Narrative、Discovery/Quest events 确定性抽取大部分字段，不需要每回合额外发一次 LLM。

---

# 32. Episodic 检索算法 V1

首版不要上外部 embedding。沿用 tavo-mini 已验证的本地策略：

```text
中文 unigram
+ bigram
+ trigram
+ 英文 token
```

再叠加：

```text
文本相似度
人物命中 boost
人物对 boost
物品 boost
Quest boost
地点 boost
当前目标 boost
近期性
```

---

# 33. Episodic 评分

示意：

```text
finalScore =
semanticScore
+ actorBoost
+ actorPairBoost
+ questBoost
+ itemBoost
+ locationBoost
+ threadBoost
+ recencyBoost
```

必须 deterministic。

---

# 34. 人物别名与歧义

必须使用 actorId 作为最终实体身份。名字只是召回入口。

例如两个 NPC 都叫“老李”，不能只凭字符串把两个人混在一起。

如果 alias 对应多个 actor，则标记 ambiguous，不得自动给予人物 boost。

---

# 35. Hybrid Top-K

推荐：

```text
60% 相关度最高
20% 当前人物历史
20% 最近历史
```

当 `topK < 5` 时优先相关度，但保证至少一个 recent，避免当前故事突然断裂。

---

# 36. Episodic Token Budget

检索命中后，还要过 Context Budget，不能 Top 10 全部拼进去。

流程：

```text
按相关度优先
→ whole item fit
→ 到 token 上限停止
→ 最后按时间顺序展示
```

即：**选择按相关度，展示按时间线。**

---

# 37. Recent Window

即使有 Episodic Memory，也保留最近 4～8 回合，具体数量由预算决定。

Recent Window 是连续剧情桥梁；Episodic 是远程召回，两者不可互相替代。

---

# 38. 三层记忆最终结构

```text
L0 Authority
GameStateSnapshot
永远权威
        │
        ▼
L1 Story State Memory
人物关系 / 承诺 / 冲突 / 伏笔 / 长期目标
        │
        ▼
L2 Episodic Memory
历史具体事件
        │
        ▼
L3 Recent Window
最近连续回合
```

LLM 上下文：

```text
L0 + L1 + relevant L2 + L3
```

---

# 39. JSON Resilience Layer

新增或演进：

```text
src/application/llm/responseNormalizer.ts
src/application/llm/structuredOutput.ts
```

---

# 40. Structured Output Pipeline

```text
Raw Provider Content
↓
strip reasoning wrappers
↓
strip markdown fence
↓
find balanced JSON candidates
↓
parse candidates
↓
optional safe repair
↓
transport unwrapping
↓
field alias normalization
↓
schema validation
↓
semantic validation
↓
authority validation
```

---

# 41. Balanced JSON

禁止继续用：

```ts
text.indexOf('{')
text.lastIndexOf('}')
```

必须实现理解 `{}`、`[]`、字符串、转义和嵌套。

例如：

```text
下面是结果：
{"text":"他说：{不要走}"}
完成。
```

应该能正确提取。

---

# 42. Markdown Fence

支持 fenced JSON 和无 `json` 标签的 fence。

---

# 43. Reasoning Wrapper

Provider 若把 reasoning 混进 content，例如 `<think>...</think>`，可以剥离已知 wrapper。

但不允许把 `reasoning_content` 当业务正文。

---

# 44. Trailing Comma Repair

允许：

```json
{
  "a": 1,
}
```

修为合法 JSON，只允许字符串外修复。

---

# 45. Double Encoded JSON

允许最多 2 层：

```json
"{\"a\":1}"
```

变成对象。超过 2 层视为异常。

---

# 46. 字段别名

只允许白名单归一。例如 ActionContract：

```text
type → op
effectType → op
to → locationId
resource → resourceId
condition → conditionId
```

前提：canonical field 缺失时才提升 alias。绝不能 alias 覆盖模型已经给出的 canonical 字段。

---

# 47. 枚举别名

可以支持经过真实 Provider 观察确认的：

```text
"普通" → "normal"
"公开" → "public"
```

但必须白名单、测试、记录来源。禁止任意自然语言随便猜 enum。

---

# 48. Strict Validator 仍必须保留

JSON 韧性并不意味着放松 ActionContract 权威。例如 Planner 即使经过 normalize，最终仍必须：

```text
assertValidActionContract()
```

本地规则仍是最后真相。

---

# 49. Narrative Path

Narrator 尽量减少结构化负担。

当前小 Envelope：

```json
{
  "turnId": "...",
  "outcomeGrade": "...",
  "text": "..."
}
```

可以保留。

不要扩成 Narrator 同时返回角色状态、关系状态、奖励、任务状态、Inventory、Memory。Narrator 不拥有这些权威。

---

# 50. Story Memory JSON

Memory Patch 可以使用 JSON，但避免“大一统全状态 JSON”。应使用小 patch + 数组项 + 明确 ID，并支持 batch split。

---

# 51. Durable Physical Request Ledger

建议统一表：

```sql
llm_request_attempts
```

而不是只给 Story Memory 建。

---

# 52. Ledger Schema 建议

```sql
CREATE TABLE llm_request_attempts (
  attempt_id TEXT PRIMARY KEY,
  logical_request_id TEXT NOT NULL,

  request_kind TEXT NOT NULL,

  campaign_id TEXT,
  branch_id TEXT,
  world_id TEXT,
  state_version INTEGER,

  model_profile_fingerprint TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL,

  failure_class TEXT,
  error_code TEXT,
  http_status INTEGER,
  provider_request_id TEXT,

  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cached_input_tokens INTEGER,
  estimated_usage INTEGER NOT NULL DEFAULT 0,

  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
```

status：

```text
prepared
sent
succeeded
failed
outcome_unknown
cancelled
```

---

# 53. Ledger 生命周期

请求前：`prepared`。

真正写 transport 前：`sent`。

成功：`succeeded`。

明确失败：`failed`。

App 被杀后冷启动发现 sent/prepared 未收尾：`outcome_unknown`，不能自动重发。

---

# 54. Logical Request ID

一轮业务任务，例如 Planner Turn 80：

```text
planner:campaign-x:branch-y:v80
```

若有 bounded retry，attempt 1、attempt 2 都属于同一个 logical request。

---

# 55. Retry Policy

### 可以自动 retry

```text
明确未送达 network connect failure
429
5xx
reasoning_only 的 bounded recovery
length 的 bounded recovery
```

### 不应自动 retry

```text
timeout 且无法确认 Provider 是否已执行
App process killed
outcome_unknown
content_filter
协议成功但 semantic result 已经进入 commit 临界区
```

---

# 56. Timeout

不能简单 `timeout → 再发一次`，因为服务端可能已经执行完成。

需要标记 `outcome_unknown`，或 Provider 有 request-id 查询能力时再做恢复。

---

# 57. Planner 集成

现状：

```text
buildWorldContext()
→ String
→ Planner
```

改成：

```text
collectTurnContextCandidates()
↓
filterVisibilityAndTime()
↓
retrieveMemory()
↓
allocateContext()
↓
freezeTurnContext()
↓
renderTurnContext()
↓
Planner
```

---

# 58. Planner 上下文推荐内容

Mandatory：

```text
turnId
expectedStateVersion
actorId
合法 ActionType
当前角色本地权威状态
当前地点
技能 catalog 摘要
规则 contract
```

Preferred：

```text
当前队伍
相关 NPC
相关任务
相关 Story Memory
最近回合
```

Optional：

```text
原著证据
较远 Episodic recall
次要世界资料
```

---

# 59. Narrator 上下文

Narrator 不需要 Planner 全量 Context。应单独生成：

```text
Frozen ActionContract
Roll Grade
Effects actually committed
必要当前场景
最近故事
相关 Memory
```

不要重复给整个三宝书、全部技能定义、所有世界资料。

---

# 60. Planner 与 Narrator 预算分离

Planner：重逻辑、小输出。

Narrator：中等上下文、较大正文输出。

不能共用同一固定 token 预算。

---

# 61. Memory Maintenance 请求

Memory 请求采用：

```text
Previous Story Memory subset
+
Committed Turns batch
+
Memory Patch protocol
```

必须使用统一预算。如果 batch 过大则 split，而不是删除关键字段。

---

# 62. World Build 接入

现有世界构建已经有：

```text
profileModelBudget
groupPlanner
rateScheduler
```

不要推倒。

本专项做的是：

1. 让它复用统一 capability resolver；
2. 让物理请求进入统一 ledger；
3. 将 reasoning/output 统计口径统一；
4. 将 JSON normalizer 复用；
5. 保留现有 batch / coverage / evidence 逻辑。

---

# 63. 数据库迁移建议

建议新增 migration：

```text
19_context_memory_v2
```

具体编号以施工时最新 schema 为准。

新增表：

```text
story_memory_states
story_memory_patches
episodic_turn_index
llm_request_attempts
```

---

# 64. story_memory_states

```sql
branch_id TEXT PRIMARY KEY
through_state_version INTEGER NOT NULL
state_json TEXT NOT NULL
state_fingerprint TEXT NOT NULL
status TEXT NOT NULL
dirty_from_state_version INTEGER
last_applied_patch_id TEXT
updated_at TEXT NOT NULL
```

---

# 65. story_memory_patches

```sql
patch_id TEXT PRIMARY KEY
branch_id TEXT NOT NULL
from_state_version INTEGER NOT NULL
to_state_version INTEGER NOT NULL
base_fingerprint TEXT NOT NULL
result_fingerprint TEXT
patch_json TEXT NOT NULL
status TEXT NOT NULL
created_at TEXT NOT NULL
applied_at TEXT
```

---

# 66. episodic_turn_index

```sql
branch_id TEXT NOT NULL
turn_id TEXT NOT NULL
state_version INTEGER NOT NULL
search_text TEXT NOT NULL
metadata_json TEXT NOT NULL
invalid_at_state_version INTEGER
PRIMARY KEY(branch_id, turn_id)
```

首版不要求 FTS5，可以以后评估。

---

# 67. Branch / Rewind 规则

Branch 创建时只继承 rewind point 之前的 Memory。之后的 Story Memory / Episodic Turn 不能带入新分支。

建议使用 valid through stateVersion，而不是物理删除历史。

---

# 68. Memory Maintenance Background

Memory 更新应 Return First。

玩家回合 commit 后：

```text
保存结果
→ 返回 UI
→ enqueue Memory maintenance
```

不要让用户等 Memory LLM。

---

# 69. Memory Queue

初版可使用已有后台任务基础设施。

任务 ID：

```text
story-memory:<campaignId>:<branchId>
```

要求：

- 同 branch 串行；
- 不重复；
- 可恢复；
- 可取消；
- crash-safe；
- outcome_unknown 阻断自动重复请求。

---

# 70. Context Trace

每轮保存脱敏 trace：

```ts
interface ContextTrace {
  contextId: string;
  requestKind: string;

  model: {
    contextWindow: number;
    maxOutput: number;
    reasoningReserve: number;
  };

  envelope: {
    soft: number;
    burst: number;
    hard: number;
  };

  boards: Array<{
    board: string;
    demand: number;
    allocated: number;
    reclaimed: number;
    borrowed: number;
  }>;

  includedIds: string[];
  droppedIds: string[];
  estimatedTokens: number;
}
```

禁止 trace 保存 API Key、Authorization、整本小说、敏感原文全文、完整模型 reasoning。

---

# 71. 开发者 Context Preview

建议 Debug / Internal 模式增加“本轮上下文”查看：

```text
模型窗口
输出预算
思维预算
输入预算
各 Board 分配
命中哪些人物
命中哪些 Memory
哪些内容被裁掉
为什么被裁掉
```

这对后续模型调优非常重要。

---

# 72. Token 估算

首版沿用本地估算即可，但必须记录 `estimated` vs `provider usage`，长期校准。

不要把估算值伪装成 Provider 实际值。

---

# 73. Usage Ledger

每物理请求分别记录：

```text
input
cached input
output
reasoning
```

这样才能分析为什么某次大量 completion 却没有正文。

---

# 74. Prompt Cache

如果 Provider 报告 `cached_tokens`，可计算：

```text
cache ratio = cachedInputTokens / inputTokens
```

但缓存只影响成本/速度，不能因为有 Cache 就塞入无关上下文。

---

# 75. 错误分类统一

建议：

```ts
type LlmFailureClass =
  | 'network_connect'
  | 'timeout_unknown'
  | 'http_rate_limit'
  | 'http_server'
  | 'http_client'
  | 'content_filter'
  | 'reasoning_only'
  | 'length'
  | 'empty'
  | 'no_choices'
  | 'invalid_transport_json'
  | 'invalid_business_json'
  | 'schema_invalid'
  | 'semantic_invalid'
  | 'budget_infeasible'
  | 'cancelled';
```

---

# 76. JSON 错误与预算错误不能混

例如：

```text
finish_reason=length
JSON 未闭合
```

主要原因是 output truncated，而不是模型 JSON 能力差。因此恢复优先从预算 / split 入手，而不是立即修改 schema。

---

# 77. JSON 自动修复边界

允许：

```text
fence
wrapper prose
balanced candidate
trailing comma
double encoding
field aliases
known enum aliases
```

不允许：

```text
自动补缺失关键业务字段
自动发明 actorId
自动猜 stateVersion
自动猜数值
自动补 outcomes
```

这些属于语义内容，必须让模型 repair 或直接失败。

---

# 78. Schema 最小化原则

任何新结构化请求上线前必须问：

> 这个字段是否真的需要模型生成？

能本地得到的 turnId、stateVersion、actorId、stable ids、timestamps、fingerprints 不要让模型生成。

---

# 79. Planner ActionContract 改造原则

模型只负责：

```text
意图解释
actionType
skillId
difficultyBand
outcome semantic proposal
```

本地负责：

```text
合法 ID
规则值
roll
资源验证
effect legality
最终 settlement
```

保持现有正确方向。

---

# 80. Story Memory 质量门

必须建立原创 QA fixtures，至少覆盖：

```text
人物首次出现
别名
关系建立
关系恶化
承诺
秘密
冲突开启
冲突解决
伏笔
伏笔兑现
任务中断
同伴死亡
误会纠正
branch rewind
```

---

# 81. Long Story Recall 测试

构造 30 / 100 / 300 / 1000 回合。

关键事件安排在 v3、v18、v73、v260 等远距离位置。

在 v300 查询相关人物/物品时，必须能召回早期关键事件。

---

# 82. Recall 性能门

初始目标：

```text
30 turns  < 100ms
100       < 300ms
300       < 800ms
1000      < 2500ms
```

CI 可按机器性能放宽，但必须防 O(N²)。移动端实际再单独测。

---

# 83. Context Budget 测试矩阵

至少：

```text
32K
64K
128K
200K
1M
```

测试：

```text
mandatory 不丢
never > hard
soft reclaim
burst borrow
optional shrink
whole-item packing
deterministic output
```

---

# 84. Reasoning Budget 测试

模拟：

```text
completion=8192
reasoning=8000
content=0
```

必须 classify reasoning_only、bounded recovery、不提交空业务结果。

---

# 85. JSON Regression

至少覆盖：

1. strict valid JSON
2. prose + JSON
3. fenced JSON
4. trailing comma
5. nested braces in strings
6. escaped quotes
7. array + object nesting
8. double encoded JSON
9. field alias
10. enum alias
11. unrelated JSON before real JSON
12. truncated JSON
13. no JSON
14. malicious extra field
15. missing mandatory semantic field

---

# 86. Physical Request Ledger 测试

覆盖：

```text
prepared → sent → success
prepared → sent → fail
sent → crash → outcome_unknown
outcome_unknown 不自动重试
retry attempt_no 递增
logical_request_id 一致
重复 commit 不发生
```

---

# 87. Memory No-Stall 测试

场景一：

```text
Memory behind 4 turns
Recent history 完整
→ Play 继续
→ Maintenance queued
```

场景二：

```text
Memory behind
Recent history 缺失
→ Hard Gap
→ 不向 Planner 提供伪造连续历史
```

---

# 88. Branch Test

```text
main v100
Memory v96

rewind v60
→ fork branch-B
```

branch-B 不得召回 main v61～v100 的 Story Memory / Episodic event。这是硬门。

---

# 89. Visibility / Secret Gate

Memory 不能突破已有权限边界。

任何 Memory candidate 必须先：

```text
visibility
→ time
→ branch
→ status
```

再做 relevance。

禁止先 semantic search 再过滤秘密，因为这样容易在 trace / cache 中让秘密数据进入错误路径。

---

# 90. Phase 划分

本专项建议拆为七阶段：

```text
M0 Baseline
M1 Budget Kernel
M2 JSON + Request Ledger
M3 Story Memory V2
M4 Episodic Recall V2
M5 Turn Context Integration
M6 Full Regression / Device / Long Run
```

---

# 91. M0：基线冻结

输出：

```text
docs/reviews/llm-memory/M0_BASELINE.md
```

记录：

```text
HEAD
Schema
App version
Core tests
Mobile typecheck
APK
当前 Planner/Narrator 请求结构
当前 Memory 表
当前 Request usage 表
```

必须先全绿。

---

# 92. M1：Unified Budget Kernel

实现：

```text
modelEnvelope
elasticAllocator
contextPolicy
requestBudgetKernel
```

暂时不改 Play，先纯函数测试。

必须通过：

```text
B01 capability unknown fail-closed
B02 32K
B03 128K
B04 1M
B05 mandatory protection
B06 reclaim
B07 burst
B08 hard overflow
B09 deterministic
B10 reasoning reserve
```

---

# 93. M1.1 移除新的固定模型能力

施工时扫描：

```text
128000
8192
4096
4000
```

区分：

```text
合法协议需求
测试 fixture
模型能力假默认
```

仅删除第三类。

---

# 94. M2：JSON Resilience Layer

先实现：

```text
balancedJson
safeTrailingCommaRepair
doubleDecode
aliases
structured parse pipeline
```

再将 Planner、Summarizer、World Extract 逐步接入。不要一次性改所有请求。

---

# 95. M2.1 Strict Internal JSON 不变

以下仍保持 strict：

```text
persisted ActionContract JSON
DB state JSON
signed/fingerprinted package
```

只改 Raw LLM → App 入口。

---

# 96. M2.2 Request Ledger

与 JSON 同阶段建设。先让 Planner、Narrator、Memory 进入 ledger，世界构建下一阶段再迁移。

---

# 97. M3：Story Memory V2

新增 schema / repository / patch / merge。

先不替换旧 Summary，进行“双轨验证”：

```text
旧 Memory Summary
+
新 Story Memory V2
```

但 Planner 首期仍只读旧 Memory，直到验证完成。

---

# 98. M3.1 Memory Backfill

对旧 Campaign 不要求重跑全部历史 LLM。

可以从现有 Turn history 按 batch 后台构建 Story Memory，期间 Play 使用旧路径。

---

# 99. M3.2 Memory 切换 Gate

只有满足：

```text
Story Memory clean
throughStateVersion 足够
fingerprint valid
```

Planner 才使用新 Memory。

否则使用旧 summary / recent history fallback。

---

# 100. M4：Episodic Recall V2

构建：

```text
episodicIndex
entity terms
idf cache
retriever
hybrid selection
budget packing
```

完全本地化，不得每次召回新增 LLM 请求。

---

# 101. M4.1 Index 更新

Turn committed 后本地同步创建 episodic index row，不依赖异步 LLM。

---

# 102. M5：Planner Context 集成

将 `buildWorldContext()` 演进为 `TurnContextService`：

```text
collect
filter
retrieve
allocate
freeze
render
```

旧函数最终删除或变成 facade。

---

# 103. M5.1 Narrator Context

Planner 完成后单独生成 Narrator Context，不要复用 Planner 巨大 Context。

---

# 104. M5.2 世界证据

现有：

```text
visibleEvidenceRanges
LocalSourceSearchService
```

保留。

搜索结果变成 `sourceEvidence candidates` 进入 Context Allocator，不再固定 `.slice(0,3)` 作为最终限制。

---

# 105. M5.3 三宝书

World entries 转 ContextCandidate，根据当前地点、当前人物、玩家 intent、Quest、Memory thread 激活。

避免所有公共 Lore 全塞。

---

# 106. M6：全量回归

必须执行：

```text
npm run verify:core
npm run typecheck
npm run typecheck --prefix mobile
npm run apk:debug --prefix mobile
git diff --check
```

若 Release 环境可用：

```text
apk release
apksigner
zipalign
install -r
cold launch
```

---

# 107. 长程实测

至少建立：

```text
100 回合 deterministic fixture
300 回合 fixture
1000 回合 synthetic fixture
```

验证：

```text
Context 不爆
Recall 不退化
Memory 不错分支
Request ledger 不重复
```

---

# 108. 真实模型测试

至少 DeepSeek + GLM 各完成：

```text
Planner
Narrator
Memory Patch
JSON variant
reasoning usage
```

不要求本专项重新跑整本小说四矩阵，但必须至少验证真实 TRPG 10 回合，其中包含 1 次 Memory checkpoint 和 1 次早期事件 recall。

---

# 109. 真实长程游戏 QA

推荐构造：

```text
Turn 1：A 对 B 做出承诺
Turn 7：发现线索 X
Turn 18：B 离队
Turn 31：再次出现 B
Turn 45：承诺冲突
Turn 70：X 再次出现
Turn 100：询问最初承诺
```

要求 Turn 100 能召回 Turn 1 的承诺，并结合当前 Story Memory 判断关系状态。

---

# 110. 预算可观测性验收

每轮 Debug trace 可以看到：

```text
Context Window: 128000
Reasoning Reserve: 4096
Output: 3200
Hard Input: ...
Actual Input: ...

authority       demand / allocated
currentState    demand / allocated
worldKnowledge  demand / allocated
storyMemory     demand / allocated
recentHistory   demand / allocated
sourceEvidence  demand / allocated
```

---

# 111. DoD：Budget Kernel

必须：

- [ ] 模型能力来源明确；
- [ ] 无 128K 假默认；
- [ ] Soft/Burst/Hard 生效；
- [ ] Mandatory 永不被 optional 挤掉；
- [ ] Budget deterministic；
- [ ] Context 不越 Hard；
- [ ] output demand 与 capability 分离；
- [ ] reasoning reserve 显式；
- [ ] Provider wire 与 model ability 分离。

---

# 112. DoD：Story Memory V2

- [ ] 结构化人物叙事状态；
- [ ] 关系；
- [ ] 冲突；
- [ ] 线索；
- [ ] 伏笔；
- [ ] Patch；
- [ ] deterministic merger；
- [ ] fingerprint；
- [ ] dirty/rebuild；
- [ ] branch isolation；
- [ ] No-Stall；
- [ ] 不覆盖 GameState 权威值。

---

# 113. DoD：Episodic Recall

- [ ] 中文 n-gram；
- [ ] entity boost；
- [ ] actorId disambiguation；
- [ ] hybrid Top-K；
- [ ] token packing；
- [ ] 30/100/300/1000 回归；
- [ ] branch/time/visibility 先过滤；
- [ ] 无额外 LLM。

---

# 114. DoD：JSON

- [ ] prose wrapper；
- [ ] fence；
- [ ] balanced JSON；
- [ ] trailing comma；
- [ ] double encoding；
- [ ] alias；
- [ ] enum alias；
- [ ] truncated 分类；
- [ ] strict semantic validator 保留；
- [ ] 不自动发明业务字段。

---

# 115. DoD：Reasoning

- [ ] reasoning_only 检测；
- [ ] reasoning usage 记录；
- [ ] bounded retry；
- [ ] 不无限加预算；
- [ ] 不自动关闭 thinking；
- [ ] 输入收缩与 batch split；
- [ ] capability insufficient 可行动错误。

---

# 116. DoD：Request Ledger

- [ ] prepared；
- [ ] sent；
- [ ] succeeded；
- [ ] failed；
- [ ] outcome_unknown；
- [ ] cancelled；
- [ ] logical request；
- [ ] attempt_no；
- [ ] cold-start recover；
- [ ] timeout 不盲目重发。

---

# 117. 禁止事项

本专项禁止：

1. 为通过测试把 context window 写死 128K；
2. 把 Provider 报告 unknown 当 0；
3. 把 reasoningTokens unavailable 写成 0；
4. 把所有 Memory 拼成一个巨大 JSON；
5. 每回合新增一次 Memory LLM；
6. 每回合新增一次 Episodic LLM；
7. 用 Embedding API 作为基础必需依赖；
8. Summary 覆盖权威数值；
9. 先做 semantic search 再过滤秘密；
10. Rewind 后继续使用未来 Memory；
11. JSON repair 自动补业务字段；
12. Planner/Narrator 输出任意状态数值并直接落库；
13. 自动重放 outcome_unknown 请求；
14. 无限 retry；
15. 因模型 reasoning 多就关闭 thinking；
16. 将 reasoning_content 当正文；
17. 将 Debug trace 保存 API Key；
18. 将真实小说全文保存到日志；
19. 为了“利用 1M”而把无关资料塞满；
20. 为了省 token 而删除 mandatory 协议。

---

# 118. 建议 Commit 结构

```text
docs(llm): freeze context-memory infrastructure baseline

feat(llm): add unified request budget kernel
test(llm): cover elastic model request envelopes

feat(llm): add resilient structured output normalization
feat(llm): add durable physical request ledger

feat(memory): add story memory v2 state and patch model
feat(memory): add deterministic story memory merger
test(memory): cover dirty rebuild and branch isolation

feat(memory): add episodic recall v2
test(memory): add long-story recall regression

feat(context): add elastic turn context planner
feat(play): route planner and narrator through frozen context

feat(world): reuse shared llm governance infrastructure

test(llm): add reasoning and output-budget regressions
test(app): add long-session memory and recall journey

docs(llm): publish final infrastructure acceptance
```

---

# 119. 文档交付

本方案建议入库路径：

```text
docs/Shine-TRPG_LLM_CONTEXT_MEMORY_INFRASTRUCTURE_PLAN.md
```

验收目录：

```text
docs/reviews/llm-memory/
├─ M0_BASELINE.md
├─ M1_BUDGET_KERNEL.md
├─ M2_JSON_LEDGER.md
├─ M3_STORY_MEMORY.md
├─ M4_EPISODIC_RECALL.md
├─ M5_TURN_CONTEXT.md
├─ M6_FINAL_REGRESSION.md
└─ FINAL_REPORT.md
```

---

# 120. 最终验收结论格式

最终 `FINAL_REPORT.md` 必须明确：

```text
Budget Kernel       PASS / PARTIAL / BLOCKED
JSON Resilience     PASS / PARTIAL / BLOCKED
Request Ledger      PASS / PARTIAL / BLOCKED
Story Memory V2     PASS / PARTIAL / BLOCKED
Episodic Recall V2  PASS / PARTIAL / BLOCKED
Planner Context     PASS / PARTIAL / BLOCKED
Narrator Context    PASS / PARTIAL / BLOCKED
Branch/Rewind       PASS / PARTIAL / BLOCKED
Long-run 100        PASS / PARTIAL / BLOCKED
Long-run 300        PASS / PARTIAL / BLOCKED
Long-run 1000       PASS / PARTIAL / BLOCKED
DeepSeek real       PASS / PARTIAL / BLOCKED
GLM real            PASS / PARTIAL / BLOCKED
Android             PASS / PARTIAL / BLOCKED
```

禁止只写“已完成”。

---

# 121. 本专项完成后的目标状态

完成后，Shine-TRPG 每一轮游戏应从：

```text
固定几段世界信息
+ 固定 6 回合
+ 固定 8 条摘要
+ 固定 Planner 2200 token
```

升级为：

```text
冻结模型能力
↓
根据本轮任务动态算输入/输出/思维预算
↓
筛选当前真正相关的：
    权威状态
    场景
    人物
    三宝书
    Story Memory
    Episodic Memory
    Recent Turns
    原著证据
↓
弹性预算
↓
冻结上下文
↓
请求 LLM
↓
韧性解析
↓
严格语义验证
↓
本地权威执行
↓
请求账本
↓
后台长期记忆维护
```

最终达到：

> **模型窗口越大，系统可以自然吸收更多真正有价值的资料；模型窗口越小，系统能主动收缩而不破坏本轮权威信息。**

以及：

> **游戏从 10 回合扩展到 100、300、1000 回合后，角色关系、重要承诺、长期目标、历史冲突和早期事件仍然可以被正确召回。**

---

# 122. 总体实施优先级

最高优先级：

```text
M1 Budget Kernel
+
M3 Story Memory V2
```

第二优先级：

```text
M4 Episodic Recall
+
M2 JSON / Ledger
```

第三优先级：

```text
M5 Planner/Narrator 全链路接入
```

原因：

> 如果没有统一预算和长期记忆，继续扩展世界构建、战斗、角色卡或 UI，都无法解决长程游戏最核心的 LLM 稳定性问题。

本专项应作为 Shine-TRPG 下一轮核心基础设施建设任务执行。