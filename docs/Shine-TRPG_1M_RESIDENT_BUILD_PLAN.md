# ShineWord 全量构建按 1M 大模型重新设计（最终建设方案）

状态：最终建设方案，待施工。2026-09-29 定稿。
模型基线：DeepSeek V4.1 Flash 与 GLM-5.3-Flash（规格为 2026-09-29 公开资料检索值，施工前以两家官方文档复核为准）。
关联：`Shine-TRPG_SKILL_GENRE_BINDING_AGENT_PROMPT.md`（技能题材绑定，本方案 Pass 2 与其 P0/P1 同里程碑施工）、`Shine-TRPG_PROGRESSIVE_WORLD_BUILD_PLAN.md`（渐进开局保持默认首开路径不变）。

## 一、目标模型基线（设计锚点）

| 项 | DeepSeek V4.1 Flash | GLM-5.3-Flash |
|---|---|---|
| 上下文窗口 | 1,048,576 token | 1,048,576 token |
| 最大输出 | 393,216（官方/Fireworks；DeepInfra 等网关 131,072） | 131,072（**内容 + 思维链合计**） |
| 思考模式 | 双模，可关闭 | **不可关闭**；`reasoning_effort` low/high/max，默认 max；最大思维链 131,072 |
| 上下文缓存 | 自动磁盘缓存，缓存读约 $0.003–0.007 /M | 智能缓存，命中 ¥0.23 /M（阿里云百炼）或 $0.03 /M |
| 价格（量级） | 输入 $0.15–0.30 /M，输出 $0.60–1.20 /M（峰谷价差 2×） | 输入 ¥0.8 /M，输出 ¥2.8 /M（百炼）；或 $0.15 / $0.50 |
| 吞吐 / 限流 | 约 230 tok/s | FlashX 约 200 tok/s；百炼 RPM 200 / TPM 3M |
| 结构化输出 | 支持 JSON mode | 支持 JSON 结构化输出 |

对设计的三个直接推论：

1. **输出预算必须含思维链**。GLM 的思维链计入 completion tokens 且不可关，默认 max 档可能把 128K 输出额度大量烧在思考上；DeepSeek 可关思考。同一套代码必须按模型分别处理。
2. **两家都支持上下文缓存**，resident（全书驻留）模式成立；但缓存读不是免费的——GLM 命中价约为输入价的 1/4，resident 每单元都要"重读"全书，N 个单元 = N × 1M cached tokens，经济学上 DeepSeek（约 1/50）几乎免费，GLM 上是为全书视野付费（量级 ¥5–12/次，可接受，见第九节账）。
3. **限流宽裕**：百炼 RPM 200 / TPM 3M，并发 3–4 远在限流内；但 resident 模式若缓存未命中，每个 worker 都会重复 1M prefill，可能撞 TPM——调度必须感知 TPM 窗口。

## 二、设计原点（三个不变量）

- **输入总量不变**：group 模式下每个 chunk 本来就只发送一次，输入总量 ≈ 全书一遍。1M 上下文买来的是**全书视野**（实体归并、技能体系、时间线的跨章一致性）与**缓存经济性**（prefill 只排一次队）。
- **输出总量不变**：全书抽取产出 ≈ chunk 数 × 每 chunk 事实输出，100 万字语料约 60–80 万 token。它决定请求数下限与 decode 时间下限（单流约 200 tok/s → 串行地板约 1 小时）。**并发是必需品，不是优化项。**
- **思维链是新增约束**：思考模型的 CoT 计入输出/上下文额度。预算公式必须从"输出预留"升级为"输出 + 思维链双预留"，否则 GLM 上会系统性截断（正文没写完、额度被思考耗尽）。

## 三、思维链预算设计（本期核心新增）

### 3.1 预算模型字段

`ModelBudget` 扩展为：

```
contextWindowTokens      // 1,048,576
maxContentOutputTokens   // 内容（JSON 正文）输出预算，默认 16,384
reasoningReserveTokens   // 思维链预留：GLM low 档初始 2,048（实测校准）；DeepSeek non-thinking = 0
reasoningEffort          // 请求透传：'off' | 'low' | 'high'（抽取='off'/'low'，映射/时间线='high'）
reserveTokens            // 结构化/格式漂移预留，2,000
```

打包公式：

```
bodyBudget = contextWindowTokens − maxContentOutputTokens − reasoningReserveTokens − reserveTokens − promptOverheadTokens
```

### 3.2 请求构造（按模型分流）

| 用途 | DeepSeek V4.1 Flash | GLM-5.3-Flash |
|---|---|---|
| Pass 1 范围抽取（bulk） | non-thinking 模式；max_tokens = 16,384 | `reasoning_effort: low`；max_tokens = 16,384 + 2,048 = 18,432 |
| Pass 2 全书规则映射 | thinking 模式（低档） | `reasoning_effort: high`；max_tokens 相应放大 |
| Pass 3 时间线 | 同 Pass 2 | 同 Pass 2 |
| `thinking.clear_thinking` | — | `false`（保留轮间思考上下文，官方建议） |

### 3.3 校准与护栏

- usage 记录细分：`completion_tokens_details.reasoning_tokens` 与实际内容 token 分别落 unit 的 usageJson；前 3 个单元后校准一次 `reasoningReserveTokens` 与 `estOutputPerChunk`，之后每 10 组滑动更新。
- 截断分类已有 `completionState: 'reasoning_only'` 分支（"模型只返回推理内容，正文未完成"）——GLM 上触发该分支时，处理策略为**先升 reasoningReserve 重试一次，再对半拆分**（现为直接拆分），避免在低思考档位下无效拆分。
- GLM 上禁止把 `max_tokens` 设到接近 131,072：思维链长度不可控，留至少 8K 安全边际。

## 四、resident / windowed 双模式架构

### 4.1 模式选择

| 模式 | 条件 | 行为 |
|---|---|---|
| resident | 全书估算 token + 开销 ≤ contextWindow × 0.85（约 ≤89 万 token） | 全书作为字节稳定前缀驻留，逐范围抽取 |
| windowed | 装不下 | 输出预算打包的滑动窗口（重叠区去重），即修复后的 group 模式 |

全书 token 估算沿用保守 1 token/码点（CJK）；两家 tokenizer 实际约 0.6–0.8，故 100 万字语料必进 resident。

### 4.2 resident 请求结构（缓存命中的关键）

```
messages = [
  system(静态抽取规范),                    // 全 run 字节级稳定
  user(全书规范化正文),                    // 全 run 字节级稳定 → 前缀缓存
  user("仅抽取第 k..m 章（chunk 范围）的事实")   // 每单元唯一，数百 token
]
```

- 前两条消息所有单元字节一致：DeepSeek 自动磁盘缓存、GLM 智能缓存均按前缀命中；probe 用同一长提示发两次、读 `cached_tokens` 是否 >0 自动判定，不支持则 resident 自动退化 windowed。
- 首个请求即 prime（不引入独立 prime job，避免双写状态）；其 prefill 约 1M token，是全局最贵一次。
- **缓存 TTL**：两家自动缓存 TTL 均为分钟级滑动窗口。resident run 的单元必须背靠背连续执行（并发 3–4 同时保活缓存）；暂停超 TTL 续建需重新 prefill 一次——接受为明确的"续建成本"，UI 如实展示（决策 D3）。

### 4.3 四段流水线与模型分工

| Pass | 内容 | 规模 | 模型与思考档 |
|---|---|---|---|
| 0 全书实体注册表 | 全书人物/势力/地点/能力体系清单（JSON），落库为 entity 种子；注入后续抽取"优先使用注册表 key" | 1 请求，输出 ≤8K | GLM high 或 DeepSeek thinking |
| 1 范围抽取（主体） | 输出预算切范围，N worker 并发；实体引用注册表 | 15–50 请求 | DeepSeek non-thinking 或 GLM low |
| 2 全书规则映射 | WorldMapper V2 读全书产 ruleMappings/skills，解除 800 facts 输入上限——**同时是技能题材绑定（问题 1）的解药** | 1–3 请求 | GLM high 或 DeepSeek thinking |
| 3 时间线与事件依赖 | 全书视野补 event 依赖/排序，替代本地猜测式 resolveEventProposals | 1 请求 | GLM high 或 DeepSeek thinking |

所有 pass 遵守"模型只能提议，本地是唯一权威"：provenance、checkEvidence 逐字校验、validate 发布门、G04 诚实门全部保留。

## 五、打包器 v2：输出预算 + 思维链双驱动

- `planExtractGroups` 改为：`chunksPerGroup = clamp(maxContentOutputTokens × 0.7 / estOutputPerChunk, 4, maxGroupSegments)`。
- `estOutputPerChunk` 初值 800 token，按 unit usageJson 实测在线校准（同 3.3）。
- `maxGroupSegments` 含义改为"证据归属可靠性上限"，默认 32。
- 解除 `profileModelBudget.ts` 的 8K 硬钳（`DEFAULT_GROUP_MAX_OUTPUT_TOKENS` 改为按 profile 的 maxContentOutputTokens 注入）。

## 六、并发与限流调度

- coordinator 新增 N 个 worker 循环：默认 3，profile 可配 1–4。租约后台续期、`claimUnit` 原子、`commitChunkResult` 逐 chunk 单事务、429 分类退避全部复用。
- 调度约束：`N × 每请求 prompt tokens ≤ TPM × 0.7`。resident 缓存命中时每请求 prompt 计费为 cached tokens，但 TPM 是否对缓存流量打折按供应商口径；保守按全量计入，故 N 默认 3 而非更大。
- 抽取用 Flash 级模型（200–230 tok/s），映射/叙事不受本调度影响。

## 七、改动清单（文件级）

| 文件 | 改动 | 量级 |
|---|---|---|
| `worldBuild/groupPlanner.ts` | 输出预算打包 + 在线校准 | 小 |
| `worldBuild/profileModelBudget.ts` | 解除 8K 硬钳；新增 reasoningReserve/reasoningEffort/cache 字段 | 小 |
| `worldBuild/coordinator.ts` | `mode: 'resident'`；N worker 并发循环；reasoning_only 先升预留再拆分 | 中 |
| `world/llmGroupExtractor.ts` | resident 变体（全书前缀 + 范围指令）；输出上限由 budget 注入 | 中 |
| `llm/types.ts` / `capabilities.ts` | profile 新字段；probe 补 `cached_tokens` 与 `reasoning_tokens` 探测 | 小 |
| `application/llm/openAICompatible.ts` | 请求透传 reasoning 参数（DeepSeek thinking 开关 / GLM reasoning_effort、clear_thinking） | 小 |
| `mobile/src/profileStore.ts` + 设置 UI | 双模型预设（DeepSeek V4.1 Flash / GLM-5.3-Flash）、输出与并发档位 | 小 |
| 新增 `world/bookRegistry.ts`（Pass 0）；WorldMapper V2（复用 buildPackageFromCanon 清洗链） | 中 |
| 测试 | 打包器输出预算与 CoT 预留用例；mock provider 断言前缀字节一致与 reasoning 参数透传；并发幂等提交；截断率回归 | 中 |

## 八、量化估算（100 万字 / 944 chunks，每 chunk 输出按 600–800 token 估）

### 时间账

| 方案 | 请求数 | 时间 |
|---|---|---|
| 现状（128k profile，串行，8k 输出） | 60–95+（含截断拆分浪费） | 1–3 小时（实测约 2h） |
| 打包器 v2 + 16k 输出 + 并发 3 | 40–50 | 25–40 分钟 |
| resident + 16k 输出 + 并发 3（本方案） | 20–30 | **12–20 分钟**（含 1M prime 一次，decode 主导） |

### token / 费用账（resident，25 单元，量级估算）

| 项 | DeepSeek V4.1 Flash | GLM-5.3-Flash（百炼价） |
|---|---|---|
| prime prefill 1M | $0.15–0.30 | ¥0.8 |
| 25 单元缓存读 25M | $0.08–0.15（$0.003–0.006/M） | ¥5.75（¥0.23/M） |
| 内容输出 ~70 万 token | $0.42–0.84（峰谷） | ¥1.96 |
| 思维链（low，~1k × 25） | 0（non-thinking） | ¥0.07 |
| **合计量级** | **$0.7–1.3** | **¥8–9** |

注：resident 在 GLM 上比 windowed 输入成本（约 ¥0.8）贵，差额即"全书视野"的价格；DeepSeek 缓存极便宜，resident 几乎免费。两模型都以输出 token 为费用主体，该部分与方案无关、不可压缩（除非降召回）。

## 九、不变式与风险

1. 长上下文注意力衰减：范围指令明确章节边界 + checkEvidence 逐字校验兜底（错引即丢）+ 召回率实测（≥90% 既有标准），不达标退化 windowed。
2. 思维链失控（GLM）：reasoning_effort 强制 low（抽取）；reasoning_only 分支先升预留重试；max_tokens 距 131,072 上限留 8K 安全边际。
3. 缓存 TTL / 网关不转发缓存：probe 探测，不支持自动退化 windowed；暂停续建重付一次 prime（UI 明示）。
4. 超长大输出 JSON 破损：复用现有 parse + repair；16k 档风险低。
5. 限流：TPM 按 0.7 系数保守占用；429 退避已有。

## 十、决策记录（已定）

- **D1 模型组合**：DeepSeek V4.1 Flash + GLM-5.3-Flash 双基线。抽取主力 DeepSeek non-thinking（缓存近免费、输出余量大）；GLM 为备选/对照（思考不可关，靠 reasoning_effort=low 约束）。映射/时间线等难任务用高档思考（任一模型）。
- **D2 输出档**：内容输出默认 16,384 token/请求；GLM 侧 max_tokens = 16,384 + 思维链预留。不上 32k+ 档（decode 时间与 JSON 可靠性不划算）。
- **D3 续建成本**：接受"暂停超 TTL 后续建重付一次 prime"，UI 明示。
- **D4 合并排期**：Pass 0/2 与技能题材绑定的 P0/P1 同一里程碑施工（共享全书视野基础设施）。

## 十一、验收指标（可复现）

1. 同一 1M profile 下，截断拆分次数 ≤2 次（100 万字语料；现状 >20 次）。
2. mock provider 断言 resident 单元请求前两条消息字节一致；reasoning 参数按模型正确透传（DeepSeek non-thinking / GLM low）。
3. 真实端点记录 prime 之后 `cached_tokens` 命中率 >80%；GLM 上 reasoning_tokens 均值 ≤ 预留的 1.5 倍。
4. 端到端耗时：100 万字全量构建 ≤20 分钟（并发 3，16k 档），与现状对比记录；费用与第八节账对照（±50% 内）。
5. 质量不回退：引文定位 100%、事实召回 ≥90%；实体归并冲突数较现状下降（报告数值）。
6. 与技能题材绑定联动：两条不同题材语料构建后技能集合不同，各含 ≥1 条 sourceFactIds 非空技能（对齐 T1）。
7. `npm run verify:core` 全绿；`npm --prefix mobile run typecheck` 通过；迁移双写一致。
