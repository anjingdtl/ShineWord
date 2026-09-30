# R0 基线冻结 — V0.4.0 Reasoning & LLM Governance

日期：2026-09-30
基线分支：`main`
远端：`origin/main`
基线提交：`77cdc9dd42b84dc23b3b8047b90b41590487f3ca`
应用版本：V0.4.0 / versionCode 40000

## 基线来源与工作区保护

- 按要求运行 `git fetch --all --prune`、确认 `main`、`git pull --ff-only` 并查看最近 20 个提交。
- fetch 后 `HEAD...origin/main` 为 `0 0`；最新远端提交与提示词给出的 SHA 相同，未回退到旧提交。
- 从上述 HEAD 创建 `feature/reasoning-governance-closeout`。本文件是本轮第一个候选提交。
- 开工前已有的 `.workbuddy/memory/2026-09-28.md`、`.zcodeignore` 修改，以及 `.workbuddy/memory/2026-09-29.md`、两个阶段提示文档、`docs/architecture/`、`test-logs/` 未跟踪内容均保留，未暂存或纳入本轮。

## 基线工程门禁

| 门禁 | 结果 |
|---|---|
| `npm run verify:core` | PASS：core typecheck、build 通过；399/399 测试通过，0 失败，约 19.4 秒 |
| `npm run typecheck --prefix mobile` | PASS |
| `npm run apk:debug --prefix mobile` | PASS：V0.4.0 Debug APK 构建成功，96,218,115 bytes，SHA256 `35A0EF17A819BD8F0D89242503D428525911E808A0459FD99AE4BED98CA5C971` |
| `npm run verify:version` | PASS：0.4.0 / 40000 |

APK 位于 `dist/apk/debug/ShineWord-V0.4.0-debug.apk`，为基线构建产物，不纳入源码提交。构建脚本只将生成文件 `mobile/src/version.json` 的 buildTime 更新为本次时间；已恢复该由本次构建产生的单文件差异。上述测试没有读取 API Key 或小说文件。

## 当前 Reasoning 类型与 Provider 行为

- `src/application/llm/types.ts` 中 `ApiProfile.reasoningEffort` 和 `LlmRequest.reasoningEffort` 仍为 `'off' | 'low' | 'high'`；没有统一的产品层 `ReasoningTier`，也没有 `max`。
- `src/application/worldBuild/groupPlanner.ts` 另定义同名 `ReasoningEffort`，也是 `'off' | 'low' | 'high'`。
- `src/application/llm/openAICompatible.ts` 根据模型名选择 `deepseek`、`glm`、`generic` 方言。当前映射把 `undefined`/`off` 都规范成 low；GLM 与 generic 只发 low/high，因而不能表达 max。GLM 同时设置 `thinking.clear_thinking=false`；DeepSeek 仍用 `thinking.type=enabled` 和分档 `budget_tokens`。未知兼容端点也默认发 `reasoning_effort`，没有参数不支持时的明确错误分类。
- Provider 的 `reasoning_only` 重试保持原请求 reasoningEffort，但只在 Provider 内把 `max_tokens` 最多增长两次；它看不到 Context plan，也不会收缩 optional context。

## Profile UI 与持久化

- `mobile/src/ui/features/profile/ProfileFormCard.tsx` 只有预设、端点、模型、API Key 字段，没有思考档位选择，也没有高级能力输入。
- `mobile/src/profileStore.ts` 继续使用 `shineword.api.profile.v1`，读取时直接 cast 为 `ApiProfile`，没有旧档归一化迁移。
- GLM/DeepSeek 预设声明 1M context、131072 最大输出和固定的低档 reserve；预设显示文字固定为 low。
- 自定义档案保存时无用户输入也会写入 `contextWindow=128000`、`maxOutputTokens=8192`。这些值没有 capability source 字段，且 UI 不可见。
- 密钥引用为 `llm.default`，Keychain 流程独立于 AsyncStorage Profile JSON；本轮设置改造需保留该隔离并复用已有 keyRef。

## Planner、Narrator 与弹性预算

- `session.ts` 将已声明 reasoningEffort 粗略转成 `reasoningMode`，再把 Profile 的单个 `reasoningReserveTokens` 分别传给 Planner 与 Narrator 的 `planTurnContext()`；它没有冻结产品档位。
- `v2Turn.ts` 发出的 Planner 和 Narrator `LlmRequest` 都没有 `reasoningEffort`，Provider 因此实际使用默认 low。Planner 与 Narrator 请求有各自的输出需求和 Context，但实际 thinking 档位未从 Profile 透传。
- `planLlmRequest()` 支持 `inside_completion` 与 reasoning reserve，`computeRequestEnvelope()` 对该方言以 `C - (business output + reserve) - safety` 计算 Hard Input，一次扣减 reasoning。
- 当前 `planTurnContext()` 返回业务 `requestedOutputTokens`，Play 请求直接把该值作为 `maxOutputTokens`；没有使用 Envelope 的 `wireOutputTokens`，所以保留量未完整加到 Provider wire 上限。
- Context plan fingerprint 包含 capability fingerprint、mandatory tokens 和分配项；没有显式包含 reasoning tier/reserve。`FrozenTurnContext` 也没有 reasoning 元数据。
- 现有 budget kernel 有 planner/narrator/memory/world 各类业务输出需求表，能力未知时 Play 会进入显式 legacy Context fallback；World Build 预算解析则对缺失窗口 fail closed。

## Story Memory 与 Summarizer

- Story Memory Patch 已使用 `parseStructuredOutput()`，请求有 `memory_checkpoint` Ledger metadata，但 `storyMemoryMaintenance.ts` 固定 `maxOutputTokens: 1600`，未调用 `planLlmRequest()`。
- Memory checkpoint 与 repair 使用同一固定输出值；维护接口未接收冻结 Profile/reasoning policy，Provider 请求未设置 reasoningEffort。批次固定最多 8 turns，失败时有一次 JSON/业务修复轮次；尚未根据模型预算动态缩小批次。
- 旧 summarizer 有 Ledger metadata，使用统一 JSON parser；需核对输出预算及 reasoning policy 接入状态后纳入统一改造。

## World Build

- `profileModelBudget.ts` 从 Profile 读取 context、max output、固定 reasoning reserve 和 `reasoningEffort`；缺失 context 会 fail closed。`FrozenRunConfig` 冻结 `reasoningEffort` 和 reserve，`reviveRunConfig()` 对历史缺字段默认生成 `off`。
- Group extractor 可发送 low/high，但没有 max；其 JSON 入口复用 `parseExtractorJson()`。单 chunk extractor 不发送 reasoningEffort；registry/timeline 各自有 reasoning 默认值。因此不同 World Build 路径没有共同冻结的用户档位。
- `llmExtractor.ts` 的 `parseExtractorJson()` 仍使用 `indexOf('{')` / `lastIndexOf('}')`；Group Extractor 复用它。Quote 仍在本地按声明 segment/chunk 做逐字查找，伪造或跨段 quote 会被拒绝，后续迁移须保留此语义。
- World Build 请求没有统一 `LlmRequest.ledger` metadata；抽取单位会把部分 request metrics 序列化进 unit usage，但并不等同于 `llm_request_attempts`。
- 现有 group/chapter planner、rate scheduler、bounded split/retry、run lease/fencing 与 FrozenRunConfig 是保留边界。本轮扩展时不得绕过或重复调度这些路径。

## 基线结论

V0.4.0 已提供通用 Budget Kernel、Elastic Turn Context、Structured Output 与 Play Request Ledger，但 Reasoning 档位没有从设置页到 Provider 的统一冻结路径。当前 Provider 默认把缺省档位映射为 low；Play 的 Context 会预留 Profile 固定 reserve，但实际 Provider tier 没有随请求发送，且 wire output 没有加上 reserve。Story Memory 仍固定 1600；World Build 已冻结部分旧 reasoning 配置，但抽取、registry、timeline 路径不一致，旧 JSON parser 与统一 Request Ledger 尚未接入。自定义 Profile 的 128K/8192 默认与未知能力治理不符。

本基线只描述从 `77cdc9d` 采集的代码、工程门禁及文档证据，不预先宣告 R1–R6 结果。CI、真实 GLM 三档、设备 UI/持久化、Release 签名将在后续阶段分别验证；当前尚无本分支 CI 运行。
