# M0 基线冻结 — LLM 上下文与长期记忆基础设施专项

> 记录日期：2026-09-30
> 分支：`feature/llm-context-memory-infrastructure`（自 `origin/main` 创建）
> 方案：`docs/Shine-TRPG_LLM_CONTEXT_MEMORY_INFRASTRUCTURE_PLAN.md`（main@9d0e85a 入库）

## 1. 环境基线

| 项 | 值 |
|---|---|
| HEAD（基线） | `9d0e85a5aef9fc17591c41b468d0417f25d22a74` |
| branch | `feature/llm-context-memory-infrastructure`（施工）/ `main`（远端同步基线） |
| SQLite schema version | **18**（`unified_build_p3_stages`，`src/infra/sqlite/builtinMigrations.ts:935`） |
| app version | `0.3.0-progressive.2`（versionCode 16） |
| Node | v24.18.0 |
| npm | 11.16.0 |
| Java | Temurin OpenJDK 17.0.19 |
| Gradle | 9.3.1（wrapper distribution） |
| Android SDK | `C:\Users\anjin\AppData\Local\Android\Sdk`（build-tools / ndk / platforms / platform-tools / emulator） |
| 可用 AVD | `Medium_Phone`、`ShineQA` |
| CI 工作流 | `.github/workflows/core-verify.yml`、`android-verify.yml` |

测试资源（存在、可读，不入库）：

| 资源 | 状态 |
|---|---|
| `C:\Users\anjin\Desktop\Ai工作坊\Test-API\GLM-TEST-KEY.TXT` | 存在 |
| `C:\Users\anjin\Desktop\Ai工作坊\《白篱梦》.TXT` | 存在，约 3.07 MB |
| `C:\Users\anjin\Desktop\Ai工作坊\凡人修仙传.txt` | 存在，约 22.5 MB |

## 2. 当前 LLM 请求链路现状（冻结）

### 2.1 Planner 请求方式

- V1 `src/application/game/llmTurn.ts:256-267`：`role:'Planner'`，`maxOutputTokens: 2200`（固定业务值，未经能力解析），`jsonMode: true`；输出经 `parseStrictJsonObject()` 一次性严格解析，失败即回合失败（无 repair）。
- V2 `src/application/game/v2Turn.ts:203-228`：`maxOutputTokens: 1200`；一轮 repair（校验错误回喂一次，二次失败终止）；提案本地编译为 ActionContract（`compileProposal`），权威值全部本地生成。
- 回合上下文由 `CampaignSession.buildWorldContext()`（`session.ts:951`）拼接为单个字符串，经 `worldContext` 字段传入。

### 2.2 Narrator 请求方式

- V1/V2 一致：`role:'Narrator'`，`maxOutputTokens: 1500`，`jsonMode: true`；小 envelope `{turnId, outcomeGrade, text}`，`parseStrictJsonObject()` + `validateNarrative()`。
- Narrator 复用与 Planner 同轮的上下文材料（playerIntent + frozenOutcome + roll），无独立预算。

### 2.3 Story Memory（现状 = 旧轨）

- `src/application/memory/summarizer.ts`：`SUMMARY_INTERVAL_TURNS = 8`（`retrieval.ts:105`），每 8 个 stateVersion 触发一次 LLM 摘要；输出 `{"summary": string}`，≤120 汉字；`maxOutputTokens: 800`；`extractJson()` 用 `indexOf('{')/lastIndexOf('}')` 手工截取。
- 存 `memories` 表（kind=`turn_range_summary`），无人物/关系/冲突/伏笔结构，无 patch、无 fingerprint、无 dirty/rebuild。

### 2.4 Episodic retrieval（现状）

- `src/application/memory/retrieval.ts`：字符 bigram overlap 单路评分；过滤顺序 visibility → time → branch/status → relevance（顺序正确）。
- `buildWorldContext()` 注入 recentHistory(每回合) + memories 作为候选，`limit: 8`，结果 `text.slice(0, 900)`；最近 6 回合每回合 `slice(0, 120)`；原著证据固定 `slice(0, 3)`（P3 后为 visibleEvidenceRanges 通道）。
- 无实体 boost、无 IDF、无 token 预算打包、无 100+ 回合长程回归。

### 2.5 JSON parser

- `src/application/llm/json.ts` `parseStrictJsonObject()`：trim 后必须整体是单个 JSON object。用于 Provider 原始输出（Planner/Narrator/Summarizer）与内部持久化两个场景，前者过严（无 fence/prose/trailing-comma/double-encode 容忍）。
- Summarizer 自带 `extractJson()`（首尾大括号截取，无平衡解析）。

### 2.6 LLM provider

- `src/application/llm/openAICompatible.ts` `OpenAICompatibleProvider`：OpenAI 兼容 chat/completions；reasoning 方言 deepseek/glm/generic（2026-09-30 政策：思维永不关闭，'off' 降为最低 tier）；`reasoning_content` 与正文严格分离；`reasoning_only` 自动重试 ≤2 次、预算 ×1.5（受 `maxPhysicalRequests` 上限约束）；物理请求指标（脱敏）经 `onPhysicalRequest` 回调。
- `src/application/llm/resilient.ts`：传输层重试（network/5xx 可重试，timeout 不重试——正确方向）；`FaultInjectionTransport` 测试设施。
- `src/application/llm/scheduledProvider.ts` `RateScheduledProvider`：全局 RPM/TPM 调度包装（世界构建与前台共享）。

### 2.7 usage recorder（现状）

- `session.ts:1506` → `gameStore.recordLlmUsage({branchId, turnId, role, requestSeq, model, inputTokens, outputTokens, estimated})`；按逻辑回合记录，无 attempt 粒度、无 status 生命周期、无 outcome_unknown、无 reasoning/cached 拆分入库。

### 2.8 world build budget（现状）

- `src/application/worldBuild/profileModelBudget.ts`：`DEFAULT_CONTENT_OUTPUT_TOKENS=16_384`、`GLM_REASONING_RESERVE_TOKENS=2_048`、`UNCONTROLLABLE_REASONING_HEADROOM_TOKENS=8_192`、`reserveTokens=2_000`；`capabilityMax` 直接取 `profile.capabilities.maxOutputTokens`，`contextWindowTokens` 直接取 `profile.capabilities.contextWindow`。
- **已知风险（本专项 M1 要修）**：`profile.capabilities.contextWindow` 来自 `probeCapabilities()` 的硬编码 `128_000`（`capabilities.ts:178`），探测不出时伪装成已知 128K；`maxOutputTokens` 探测默认 `8_192`（`capabilities.ts:151`）。
- 世界构建物理请求已有 `world_build_runs`/`world_build_units` 断点续跑表（migration 13+），但仅覆盖世界构建，不含 Planner/Narrator/Memory。

### 2.9 其他关键常量（M1 复查清单）

- `llmTurn.ts:265` Planner 2200；`llmTurn.ts:360` / `v2Turn.ts:305` Narrator 1500；`v2Turn.ts:215` PlannerV2 1200；`summarizer.ts:57` 800。
- `requestBudget.ts`：`TurnRequestBudget` 仅限物理请求次数（默认 4/回合），无 token 语义。

## 3. M0 门禁结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 依赖安装 | `npm install` | PASS |
| 核心回归 | `npm run verify:core` | **PASS — 296/296 tests, 0 fail**（duration ≈21.7s，含 typecheck） |
| 类型检查（core） | `npm run typecheck` | PASS（verify:core 内含） |
| mobile 依赖 | `npm install --prefix mobile` | PASS |
| 类型检查（mobile） | `npm run typecheck --prefix mobile` | PASS |
| 空白检查 | `git diff --check` | PASS（仅 CRLF 提示，无 whitespace error） |
| Debug APK | `npm run apk:debug --prefix mobile` | **PASS** — BUILD SUCCESSFUL in 52s，产物 `dist\apk\debug\ShineWord-V0.3.0-progressive.2-debug.apk`（91.78 MB，2026-09-30 08:53） |

## 4. 基线结论

- Baseline 全绿，可以进入 M1（Unified Request Budget Kernel）。
- 本专项新增迁移编号定为 **19**（当前最高 18）。
- 新增验收目录 `docs/reviews/llm-memory/`（本文件为首篇）。
- 已知与方案 §3 差距清单：上下文固定拼接、Planner 固定 2200/1200、8 回合扁平摘要、bigram 单路召回、严格 JSON 入口、探测假 128K、无统一物理请求账本 —— 与方案一一对应，M1–M5 逐项解决。
