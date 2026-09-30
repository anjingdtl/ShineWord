# M1 Review — Unified Request Budget Kernel

> 阶段：M1（弹性请求预算内核）
> 基线：`3fde845`（M0）
> 本阶段提交：见 git log `feat(llm): add unified elastic request budget kernel` 等

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `src/application/llm/requestPlan.ts` | `CapabilitySource` / `FrozenModelCapabilities` / `OutputDemand` / `ContextDemand`(context) / `RequestEnvelope` / `FrozenLlmRequestPlan` / `RequestBudgetTrace` / `BudgetInfeasibleError` / `stableFingerprint`（FNV-1a canonical JSON） |
| `src/application/llm/capabilityResolver.ts` | `resolveModelCapabilities()`：declared > documented > probed > unknown 字段级优先级；`deriveMaxOutputTokens()`（C/4，clamp [1024,16384]，标 derived 不回写） |
| `src/application/llm/requestBudgetKernel.ts` | `planLlmRequest()` 统一入口 + `DEFAULT_OUTPUT_DEMANDS` 八类业务需求表 |
| `src/application/context/contextTypes.ts` | 六 Board / 三档 requirement / clipMode / ContextDemand / 分配结果结构 |
| `src/application/context/modelEnvelope.ts` | `HardInput = C − O − R − S`，Soft 80% / Burst 95%；`deriveSafetyMargin()`（小窗 ≥1024、中窗 1.5%、大窗 min(1%,8192)）；reasoning `inside_completion`（wire=O+R，输入侧只减一次）/ `separate`（R 不占输入窗口）两种方言 |
| `src/application/context/elasticAllocator.ts` | 确定性四阶段分配：mandatory floor → minimum（preferred/optional 软门控）→ target（soft 内）→ burst（仅 mandatory/preferred）→ max（仅 mandatory）；`sum ≤ hard` 恒成立；id 稳定排序保证字节级确定性 |
| `src/application/context/contextPolicy.ts` | 六 Board 默认权重（plan §13 校准起点）+ `boardDemand()` 工厂 |

## 2. M1.1 假能力值摘除

- `capabilities.ts`：`probeCapabilities()` 不再输出 `contextWindow: 128_000`；`probes.contextWindow = { tokens: null, source: 'unknown' }` 一等证据。
- `types.ts`：`LlmProviderCapabilities.contextWindow` 改为可选；`profileModelBudget.ts` 缺失时抛错（fail closed，错误信息指引到 profile 声明）。

## 3. 固定数字复查结论（128000 / 8192 / 4096 / 2200 扫描）

| 位置 | 值 | 判定 |
|---|---|---|
| `capabilities.ts:153` probe 默认 ceiling | 8192 | 探测参数默认（验证 wire 接受度的声明值）；resolver 侧 probed 输出不被当作能力来源除非显式传入。**保留** |
| `groupPlanner.ts:34` DEFAULT_MODEL_BUDGET | 128K | 显式回退默认（生产走 `modelBudgetFromProfile`，此处仅测试/兜底）。**保留**，M6 复查 coordinator 兜底路径 |
| `mobile/profileStore.ts:104-105` custom 默认 | 128K/8192 | user_declared profile 默认（用户可见可改）。**保留** |
| `llmTurn.ts:265/360`、`v2Turn.ts:215/305` | 2200/1500/1200 | 业务 output demand，**未经 kernel**——按方案 §92 M1 不改 Play。**M5 路由到 `DEFAULT_OUTPUT_DEMANDS` + kernel**（遗留 TODO） |
| `timelinePass` / `bookRegistry` MAX_OUTPUT_TOKENS | 8192 | 业务 demand。**保留**（M6 世界构建统一时迁移） |
| `profileModelBudget` HEADROOM / ladder / openAICompatible thinking tiers | 8192/4096/2048… | 安全策略与厂商方言参数。**保留** |
| `byteShaAdapter` / `textDecode` CHUNK | 8192 | 字节块大小，非 token。**保留** |
| `modelEnvelope` margin cap | 8192 | 派生安全边际上限。**保留** |

无第三类（假能力默认）残留于新代码；旧 Play 固定值列入 M5。

## 4. 测试矩阵结果（`tests/llm-budget-kernel.test.cjs`，24 用例全绿）

- **B01** unknown capability → `context_window_unknown` fail-closed ✅
- **B02** 32K mandatory 整项保留 ✅
- **B03** preferred 达到 target ✅
- **B04** optional 先收缩到 floor / starved 标记 ✅
- **B05** 未用 mandatory 份额回流弹性池（无固定配额）✅
- **B06** preferred 可借入 burst 区、optional 不可 ✅
- **B07** 总量永不过 hard；mandatory floor 超 hard → infeasible ✅
- **B08** 同输入字节级一致（含乱序输入、plan id 一致）✅
- **B09** reasoning 双方言只减一次 ✅
- **B10** wire 上限封顶 + 不可行 fail-closed ✅
- **B11** 32K 小任务可规划 ✅
- **B12** 1M 不无脑塞满（分配 ≤ 需求总量）✅
- **矩阵** 32K/64K/128K/200K/1M 全部通过（mandatory 全保、optional ≤ burst、≤ hard、确定性）✅
- 能力来源优先级 / derived 不回写 / 安全边际分档 / envelope 比例 / probe 不伪造 / fingerprint 稳定 ✅

## 5. 门禁

- `npm run verify:core`：**320/320 PASS**（296 基线 + 24 新增）
- `npm run typecheck --prefix mobile`：PASS
- `git diff --check`：PASS

## 6. 遗留（转后续阶段）

1. Play 链路（Planner 2200/1200、Narrator 1500、Summarizer 800）→ M5 接入 kernel。
2. `world_extract`/`world_mapping` 世界构建预算 → M6 统一（复用 resolver + ledger）。
3. `groupPlanner.DEFAULT_MODEL_BUDGET` 兜底 → M6 复查是否强制必填。
