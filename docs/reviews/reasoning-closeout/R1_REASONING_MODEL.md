# R1 — Unified Reasoning Domain Model

阶段日期：2026-09-30
基线：`77cdc9dd42b84dc23b3b8047b90b41590487f3ca`

## 交付

- 在 `src/application/llm/types.ts` 定义唯一产品档位 `ReasoningTier = low | high | max`，并集中定义 legacy `LegacyReasoningEffort = off | low | high` 和 `normalizeReasoningTier()`。`off` 与缺失值只在兼容边界归一为 `low`。
- 新增 `reasoningPolicy.ts`，集中 provider 方言、按请求种类划分的 cold-start reserve、wire ceiling clamp、最小保留线、校准统计接口、版本和 policy 错误类型。不能满足所选 tier 的最小 reserve 时返回 capability-insufficient 错误，不会自动降档。
- 将业务输出最小值统一从 `requestDemands.ts` 提供，供预算策略复用，避免输出需求和 reserve policy 各自维护一份最小正文数字。
- `LlmRequest` / `ApiProfile` 增加 `reasoningTier` 和可选 `reasoningDialect`；旧 `reasoningEffort` 字段仅保留兼容用途。World Build 旧类型改为指向中心 legacy 类型，不再自定义另一份 `'off' | 'low' | 'high'` union。
- Provider 将显式 request tier 优先于 Profile tier；历史 Profile / request 仍可走 `off → low` 兼容归一。GLM 每档原样发出 `reasoning_effort`，并保留 `thinking.clear_thinking=false`；generic 发出 `reasoning_effort`；配置为 `unsupported` 时在发请求前明确失败。端点以 400 明确拒绝 `reasoning_effort`/`thinking` 时，给出“端点可能不支持思考档位参数”的可操作错误，不会自动重试或关闭思考。
- DeepSeek Chat Completions adapter 改为官方文档定义的 `thinking.type=enabled` + `reasoning_effort=low|high|max`。之前的 `thinking.budget_tokens` 映射不再用于该 OpenAI-compatible dialect。

## Cold-start reserve

以下均为初始预算策略，不代表模型能力。Reserve 上限受模型输出、Provider wire ceiling、Context window 和业务最小输出共同约束；任务种类可有不同 reserve，同一任务的 `low < high < max`。

| Request kind | Low | High | Max |
|---|---:|---:|---:|
| Planner | 2,048 | 8,192 | 24,576 |
| Narrator | 1,024 | 4,096 | 12,288 |
| Memory checkpoint / repair | 2,048 | 8,192 | 24,576 |
| World extract | 4,096 | 16,384 | 49,152 |
| World mapping | 4,096 | 12,288 | 32,768 |
| World adjudication | 2,048 | 8,192 | 24,576 |
| Summarizer | 1,024 | 4,096 | 12,288 |

Policy 也定义每档最低 reserve。当 wire capacity 可容纳目标值但不够完整时，可 clamp 到该档最低 reserve 并记录 `reserveClamped=true`；低于最低 reserve 则明确阻断，不把 Max 冒充为 High/Low。输出含 `effectiveTier`、`reserveTokens`、`reserveSource`、`p95ReasoningTokens` 与 `policyVersion`。

校准接口只接受按同一模型指纹、tier、request kind 预先聚合的 usage stats；样本至少 8 条后可按 `max(coldStartMinimum, ceil(P95 × 1.25))` 提议 reserve，并限制使用 32 条 rolling window。当前阶段只交付接口与确定性单测，尚未从 Ledger 读取或持久化校准统计，也不会把缺失 reasoning usage 当 0。

## Provider 协议依据

- [智谱 GLM-5.3-Flash 官方模型文档](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)列出 1M context、128K 最大输出、`reasoning_effort=max` 推荐值、`thinking.type` 仅支持 enabled，并建议 `thinking.clear_thinking=false`。
- [DeepSeek Chat Completions 官方 API 文档](https://api-docs.deepseek.com/api/create-chat-completion/)列出 `thinking.type=enabled/disabled` 与 `reasoning_effort=low/high/max`。
- 依据 DeepSeek 官方文档更新 adapter 参数，不等于完成真实 DeepSeek 验收；本阶段 DeepSeek 为 **UNIT TEST PASS / REAL NOT TESTED**。

## 验收结果

| 检查 | 结果 |
|---|---|
| 单一产品 ReasoningTier | PASS：low / high / max |
| Legacy `off` 兼容归一 | PASS：统一边界函数和单测；Profile store migration 留给 R2 |
| GLM provider 参数 | PASS：实际序列化请求单测覆盖三档及 `clear_thinking=false` |
| DeepSeek provider 参数 | PASS：实际序列化请求单测覆盖三档且 thinking enabled；REAL NOT TESTED |
| Generic / unsupported | PASS：三档字段与显式 unsupported / HTTP 400 错误单测 |
| Reserve 初始策略 | PASS：各 request kind 三档单调、任务间独立、wire clamp 和 capability insufficient 单测 |
| 动态 P95 实际接入 | NOT TESTED：当前只有 policy 接口和模拟统计测试 |
| Core | PASS：`npm run verify:core`，407/407 |
| Mobile typecheck | PASS：`npm run typecheck --prefix mobile` |

本阶段没有加入设置页、Profile schema migration、Play/Memory 预算调用、World RunConfig 迁移，也没有运行真实 GLM/DeepSeek。以上由 R2–R6 分别完成或如实标记。
