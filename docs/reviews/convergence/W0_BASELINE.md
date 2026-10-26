# W0 基线仪器与 LLM 调用普查（启动收束）

> 工作包：W0（StartupTrace + 普查测试 + §2.2 核实 + 冷启动测量）｜分支：`codex/startup-convergence-w0`
> 施工日期：2026-10-26｜HEAD 基线：`e7f5e9d`（main，方案核对基线 `3fb323b` 之后一个 docs 提交）
> 证据目录：本文件 + `test-logs/convergence-w0/`（本机临时目录，不入库）

## 1. 开工基线门禁

| 门禁 | 结果 |
|---|---|
| `npm run verify:core`（改动前） | PASS 1377/1377（0 fail/skip） |
| `npm run verify:core`（W0/W1 改动后） | PASS 1385/1385（新增 8 项：普查 4 + trace 4） |
| `npm run verify:version` | PASS（1.0.0 / versionCode 1000000 / build 0） |
| `npm run typecheck --prefix mobile` | PASS |
| 远端 CI（§2.2 第 1 项） | `main@e7f5e9d` Core Verify run 40264400115 success；`3fb323b` Android Verify run 40262290496 success；无未合并 PR（§2.2 第 7 项） |

## 2. 测量环境

- 设备：**模拟器**（ShineQA AVD，API 37，x86_64 + WHPX，`emulator-5554`）。非真机；耗时数据不代表真机性能。
- APK：`ShineWord-V1.0.0-debug.apk`（standalone debug，`adb install -r` 保留数据升级），SHA-256 `018b832a6bd9eab0a85cc5f839ba91ec64662b93e7b6d54f8f169efcc7e9118b`（埋点修正后）。首个不含 trace 输出的构建 `b4ddf8ef…` 已作废，原因见 §5。
- 冷启动采样：force-stop → 12s 等待 → 读 logcat `ReactNativeJS` 的 `[startup-trace]` 行，5 次有效（另有 6 次因 §5 原因无效）。

## 3. 冷启动分段耗时（C-02，模拟器，n=5，已有数据的库升级安装）

| 指标 | run1 | run2 | run3 | run4 | run5 | p50 | p95（n=5 近似最大值） |
|---|---|---|---|---|---|---|---|
| `app_boot_begin` → `app_boot_end`（首屏可判定）ms | 2083 | 1825 | 1450 | 1310 | 1463 | 1463 | ≈2083 |
| `profile_loaded`（AsyncStorage 读档）ms | 11 | 13 | 12 | 13 | 5 | 12 | ≈13 |
| `db_runtime_ready`（schema+FTS5 探测+ledger/风格恢复+store 构建）ms | 889 | 630 | 394 | 358 | 437 | 437 | ≈889 |
| `fts5` | false | false | false | false | false | — | — |

结论（R4/H1 判定）：

- **H1 结构性成立但量级小**：`AppSessionContext` 确实串行等 `loadApiProfile` → `getDatabaseRuntime()`（`mobile/src/ui/state/AppSessionContext.tsx:42-59`、`mobile/src/database.ts:69-140`），但模拟器上 db runtime 仅 0.36–0.89 s，首屏总耗时 1.3–2.1 s。**冷启动不是"启动慢"的主因**；S5（开始故事）才是。W5 的改动空间约 ≤0.9 s，C-14 目标值据此定为"boot_end p95 相对本次基线（≈2.1 s）下降，幅度以数据为准"。
- `boot_end` 与 `db_runtime_ready` 之间的 ~0.4–1.2 s 主要是 JS bundle 求值与 RN 首帧渲染（`app_boot_begin` 在模块求值时记录），非数据库路径。
- 本次为**已有数据的升级安装**；首次运行（空库建 schema）未单独采样，标注 NOT RUN。

## 4. "开始故事"与回合基线（§2.2 第 2 项对应）

按方案 W0 约定，LLM 路径耗时**沿用既有账本数字，未发起新的付费请求**（来源 `docs/reviews/phase9-5/local-final-closeout-20261018/PERFORMANCE_AND_ACCESSIBILITY.md`）：

| 指标 | 数值 | 备注 |
|---|---|---|
| `campaign_plan`（S5） | 42 次成功，均值 97,873 ms，min 31,405 / max 193,203 | 真实账本；非匹配输入基准 |
| Planner（S7） | 8 次，均值 8,946 ms | n 小 |
| Narrator（S7） | 17 次，均值 12,140 ms | n 小 |
| L1/L2 合成对比 | L1 均值 6,705 ms / L2 8,901 ms（各 30 次） | 合成样本 |

B 段（向导挂载→开始故事→可行动）在 LLM 路径下的设备分段测量：**NOT RUN**（需真实 `opening_goal`/`campaign_plan` 请求，属付费调用；本地路径完成后用同一仪器零成本复测，见 W3 验收 C-08）。

## 5. 与方案/文档的冲突记录（以代码为准，待回改方案）

1. **`verify:core` 计数过期**：方案与 progress.md 记 1334；实际 HEAD 基线 **1377**，W0 后 1385。README/progress 中"1334/1334"等数字为历史提交记载。
2. **standalone debug 的 `__DEV__` 为 false**：`mobile/android/app/build.gradle` 用 `shinewordStandaloneDebug=true` 清空 `debuggableVariants`，debug APK 的 JS bundle 以 dev=false 打包，且 minifier 会把 `__DEV__` 死分支 DCE。因此 StartupTrace 的 logcat sink **不能按 `__DEV__` 门控**，本实现改为无条件安装（输出字段为白名单标量：计数/时长/枚举值/turnId，无 Key/正文/玩家输入，满足红线 8）。方案 W0 的"开发构建输出"按此修正。
3. **memory 类请求不阻塞回合（§2.2 第 3 项，已证实）**：`memory_checkpoint`/`memory_repair` 只经 `TurnPostProcessingCoordinator` 消费，回合提交后 `void processBranch(...)` 单飞（`src/application/campaign/session.ts:3303`），租约+fencing，失败不落回合。`summarizer` 的 `summarizeRange` **当前无生产调用点**（仅测试引用）。
4. **registry/timeline/world_adjudication 不在开局依赖链（§2.2 第 4 项，已证实）**：mobile 生产路径按 segment 构建（`mobile/src/sourceImport.ts:1303` 起段记录存在时），`buildRegistry`/`onTimeline` 直接跳过（L1382-1398 `if (segmentRecord) return`）；`OpeningSurveyService`（registry 类）仅在 `openingPolicyVersion` 非 `opening-90s-1/2/3` 的旧配置下触发（L1357-1366），当前策略 `opening-90s-3` 不走。`world_adjudication` **当前无任何生产调用点**（仅策略配置引用）。
5. **`getWorldSetup` 不需要真实 provider（§2.2 第 5 项，已证实）**：方法体只读 `worldStore`（`session.ts:3639-3710+`）；`CampaignSession` 构造器要求 provider，但仓库已有只读 stub 模式（`mobile/src/runtime.ts` `createSessionNoop()`/`stubProfile()`），W2 直接复用。
6. **校验器最小集（§2.2 第 6 项）**：清单见 `src/domain/campaignPlan/`：`validateCampaignPlan`（planValidation.ts:388，含结构/泄露/可达性/依赖环/终局出口）、`validateContentArtifact`（同文件:536，首阶段 ≥2 机制不同 method、≥1 开局可执行、completion 有本地效果生产者且不可仅凭时限达成）、`validateOrdinarySuccessCompletion`（:156）、`validateEndingCompletionOrder`（endingValidation.ts:24）、`validateCampaignPlanCausality`（causalityValidation.ts:364，内含 `validateLaterStageCompletionIsolation`/`validateLongCampaignConsequenceCausality`）。W3 提交 2 施工前须逐条逆向出本地模板最小集。

## 6. 交付物清单（W0/W1）

- `src/application/observability/startupTrace.ts`：进程内环形缓冲（容量 128，O(1) 写入，字段白名单标量、字符串截断 64），不落库不进备份；sink 注入式。
- `mobile/src/startupTraceSink.ts`：logcat 单行 JSON sink（无条件安装，理由见 §5.2）。
- 埋点：`App.tsx`（boot begin/end）、`AppSessionContext.tsx`（profile_loaded）、`database.ts`（db_runtime_ready）、`OpeningScreen.tsx`（wizard_mounted/goal_ready/start_pressed）、`campaignPlanning.ts`（plan_ready{source}/adopt_done）、`PlayScreen.tsx`（play_first_render/first_action_enabled，含 actChoices/guidanceSteps 计数）、`v2Turn.ts`（turn_planner_start/end、turn_narrator_start/end）。
- `tests/llm-usage-census.test.cjs`（C-01）：解析 `LlmRequestKind` 联合 → 逐一要求 `LLM_USAGE_POLICY` 条目；background_enhance 禁 UI 阻塞；`opening_goal`/`campaign_plan` 必须为非阻塞后台档（K2）；策略表不得含联合外键。
- `src/application/llm/usagePolicy.ts`（W1）：14 种请求全部登记，与方案附录 A 一致；`world_adjudication`/`summarizer` 的 owner 注明"当前无生产调用点"。
- `tests/startup-trace.test.cjs`：环形缓冲边界、字段净化、抛错 sink 不影响主路径。

## 7. 未验范围与下一步

- 冷启动首次运行（空库）未采样：NOT RUN。真机/API24：NOT RUN。
- B 段 LLM 路径设备分段（向导→提案→采用）：NOT RUN（付费）；W3 提交 3 后用同仪器对本地路径做 p95 测量（C-08）。
- 下一步：C1 = W2（向导去 LLM 化）并行 W5 测量（本轮已有冷启动数据，W5 改动前还需首屏可交互后延迟项的对比口径确认）。
