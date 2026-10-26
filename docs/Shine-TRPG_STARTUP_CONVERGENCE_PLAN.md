# ShineWord 启动流程收束方案（Startup Convergence Plan）

> 版本：V1.0｜编制日期：2026-10-26（Asia/Shanghai）｜状态：**设计提案，未实施**
> 仓库：<https://github.com/anjingdtl/ShineWord>
> 核对基线：`main@3fb323ba3de2482ef0725473f354d597aa14ee9e`（2026-10-26 11:03 +0800，`chore(phase9): extend android input instrumentation`）。实施时必须重新读取 HEAD，不得假设不变。
> 用途：交给施工 agent 做"收束建设"的唯一执行入口。本文是计划与验收合同，不是完成报告。
> 本次编制只做了只读审计：浅克隆（depth 1）读取代码与文档；**未运行 `verify:core`（沙箱无法安装依赖）、未核验远端 CI、未触碰设备、未发起任何模型请求**。

---

## 0. 一句话目标

**把 LLM 从"启动关键路径"和"低价值回合路径"里移出去。** 从世界可开局到玩家第一次可行动，只走本地确定性路径；LLM 只做两类事：（a）必须理解原著或写文字的创作任务，（b）带超时与本地回退的后台增强。

---

## 1. 结论摘要

当前项目的问题不是某个函数慢，而是**架构把"准备游戏"建模成了一串 LLM 作业**。代码里已经长出了本地路径（`startup_local` 本地映射、`compileOpeningSituation`、L1 本地合同编译），但没有接进启动主路径。

三个根因：

| 编号 | 根因 | 直接证据 |
|---|---|---|
| R1 | "开始故事"被设计成**一次长思考 LLM 请求 + 玩家二次确认**。`campaign_plan` 一次性要求模型产出提案、阶段图和首个局面。 | 42 次成功样本平均 **97,873 ms**（最小 31,405 / 最大 193,203）；高档位硬上限 900–1200 s；早期诊断记录开局类样本 2/3 超时。之后还要再点一次"开始冒险"才采用。 |
| R2 | **本地可确定的事也交给了 LLM**：开局目标建议、可本地绑定的回合 Planner、低信息量回合的叙事。 | `opening_goal` 在向导挂载与每次改锚点时自动发请求；`planner_required` 方法与自由输入必走 Planner（平均 8.9 s）；Narrator 平均 12.1 s 且先于提交。 |
| R3 | 治理设施（账本、冻结、fencing、unknown 审批）按"每次 LLM 都昂贵且可能重复计费"设计，于是**所有准备工作都被塞进 job 模型**，本地编译路径没有位置。 | `candidateJob.ts` 的编译/校验逻辑写在 `runCandidateJob` 的闭包里，只能经由 LLM 作业进入；`campaignPlanning.ts` 只有 LLM 路径。 |

另有一个**未量化的怀疑项**（R4）：冷启动串行构建整个数据库运行时，且首次运行必须配置 API 才能进入。见 §3 S0，需 W0 先测量再动手。

收束方案共 8 个工作包（W0–W7），核心是 **W3：本地优先的开局计划**——点一次"开始故事"，本地编译、本地校验、本地采用，LLM 版主线降级为后台增强。预期把"点击到可行动"从 **≥31 s（平均约 98 s，外加二次点击）** 降到 **≤3 s、零 LLM 请求**。目标值是设计目标，不是实测。

---

## 2. 证据基线与边界

### 2.1 已核实的数据（来自仓库内文档，均有来源）

| 指标 | 数值 | 来源 | 注意 |
|---|---|---|---|
| `campaign_plan` 耗时 | 42 次成功，均值 97,873 ms，min 31,405，max 193,203 | `docs/reviews/phase9-5/local-final-closeout-20261018/PERFORMANCE_AND_ACCESSIBILITY.md` | 来自真实账本，但**不是匹配输入的基准** |
| Planner 耗时 | 8 次，均值 8,946 ms | 同上 | n 很小 |
| Narrator 耗时 | 17 次，均值 12,140 ms | 同上 | n 很小 |
| L1 与 L2 对比 | L1 均值 6,705 ms，L2 均值 8,901 ms（合成 30 次，并发 1） | `docs/reviews/phase9-5/longrun-2026-10-11/L1_PARITY_AND_DISPATCH.md` | 合成样本，不代表真实小说包 |
| 开局世界准备 | 导入 9.142 s + 构建 42.859 s = 52.046 s，n=1 | `README.md` | README 明确"不能宣称稳定 90 秒" |
| `campaign_plan` 超时配置 | high 档 900 s，max 档 1200 s | `src/application/llm/requestDeadline.ts` | 等待上限，不是吞吐预测 |
| 物理尝试上限 | `campaign_plan` 每逻辑请求最多 2 次 | `generationService.ts:551` | |
| 阶段 9.5 状态 | PARTIAL | `progress.md` | 工程门禁通过，真实旅程与外部试玩未闭合 |

### 2.2 本次编制**没有**核实的事（施工 agent 必须自行核实）

1. 远端 CI 当前状态（`gh` 在本会话被拒；README 与 `progress.md` 中的"1334/1334"等数字是历史提交记载）。
2. 冷启动各阶段的实际耗时（**没有任何测量**，S0 的结论全是代码阅读推断）。
3. `memory_checkpoint` / `memory_repair` / `summarizer` 是否阻塞回合（只确认了请求种类存在，未读完 `session.ts` 4175 行）。
4. `registry` / `timeline` / `world_adjudication` 是否在"开局可玩"之前被依赖（`openingPolicy` 显示开局是单个有界请求，倾向不依赖，未逐一验证）。
5. `session.getWorldSetup` 内部是否真的需要 provider（向导每次改锚点都 `createSession(profile, await buildProvider(profile))`）。
6. 本地基线计划要满足的 validator 最小集合（见 W3 风险）。
7. 完整提交历史（浅克隆），以及是否有未合并 PR。

### 2.3 证据等级与状态标签

沿用阶段 9.5 的约定：`PASS / FAIL / PARTIAL / NOT RUN / BLOCKED / UNKNOWN`。证据类别分开登记：**代码、自动化测试、构建/APK、模拟器 UI、真实模型请求、真实旅程、外部试玩**；设备要写明"模拟器/真机"。自动化通过不能代替设备体验，反之亦然。

---

## 3. 现状链路与 LLM 使用审计

"启动流程"在本项目里有两段：**A 段**＝导入小说到世界可开局（本质需要 LLM 理解原著）；**B 段**＝世界可开局到玩家第一次可行动（本应零 LLM）。问题主要出在 B 段，A 段需要降低阻塞感。

| 阶段 | 入口代码 | 用 LLM？ | 阻塞玩家？ | 现状数据 | 判定 |
|---|---|---|---|---|---|
| S0 冷启动 | `mobile/App.tsx`、`ui/state/AppSessionContext.tsx`、`mobile/src/database.ts:createRuntime` | 否 | **是**（Bootstrap 屏等待 `loadApiProfile` + `getDatabaseRuntime`） | **未测量** | 疑似可拆：运行时构建含 baseline schema、FTS5 探测、`recoverInterruptedAttempts`、`recoverAllInterruptedAnalyses` |
| S0' 首次运行 | `App.tsx`：无 profile → `FirstRunScreen` | 否 | 是 | — | 无 API 就进不了应用；产品决策项（§10 D1） |
| S1 导入 TXT | `mobile/src/sourceImport.ts` | 否 | 否（后台） | 导入 9.142 s（n=1）；桌面基准 760 万码点 1.5 s | 保持 |
| S2 开局抽取 | `worldBuild/openingPolicy.ts`（`opening-90s-3`，单请求 ≤6400 码点） | `world_extract` | 有进度 | 构建 42.859 s（n=1） | **必须用 LLM**（语义理解原著）；只需保证有进度、可后台 |
| S3 开局映射 | `buildPackageFromCanon.ts`，`mappingMode:'startup_local'` | 否（零 mapping 调用） | — | — | **已经本地**，是正确方向 |
| S3' 后段构建 | `world_mapping`、`registry`、`timeline`、`world_adjudication` | 是 | 否（应为后台 P2） | 历史上 GLM high 档单请求 465–710 s | 应确认不在开局依赖链上（W0 核实） |
| S4 向导 | `OpeningScreen.tsx:158-190` → `openingGoalSuggestions.ts` | **`opening_goal`** | 否（但每次改锚点重发） | — | **不应自动发**；可由世界包本地生成 |
| S5 开始故事 | `OpeningScreen.tsx:339 create()` → `campaignPlanning.ts:prepareCampaignPlan` → `planningService.runOpeningPlanJob` → `candidateJob.runCandidateJob` | **`campaign_plan`** | **是**（preparing → planning → validating） | 均值 97.9 s，31–193 s | **核心问题**，移出关键路径 |
| S6 提案卡 + 采用 | `adoptCampaignPlan` → `adoption.adoptOpeningPlan` | 否 | 需二次点击 | — | 采用本身是本地原子事务（好）；二次确认多余 |
| S7 首回合 | `session.ts:3049-3076`：`evaluateLocalCompileReadiness` | L1 `ready` → 无 Planner；`planner_required` / 自由输入 → **Planner** → **Narrator** | 是 | Planner 均值 8.9 s；Narrator 均值 12.1 s | Planner 应收窄；Narrator 保留但要有期限与回退 |
| S8 回合后 | `session.ts:1548`、`stagePreparation.ts`、`guidance/ancillary.ts` | `campaign_plan`（后继预备）、`narrator_guidance`（异步升级） | 否（后台单飞） | — | 方向正确，W3 复用它 |

### 3.1 已有、可复用的本地能力（不要重造）

| 能力 | 位置 | 说明 |
|---|---|---|
| 本地开局局面编译 | `worldPackage/compileOpeningSituation.ts`（109 行） | 产出一个保守的 `design_fill` 局面，含多个不同 method，只引用世界包已有条目 |
| 本地开局人物编译 | `worldPackage/compileOpeningActors.ts` | 机械参数用规则集基础值，不声称原著战力 |
| 本地映射模式 | `buildPackageFromCanon.ts` 的 `mappingMode: 'startup_local'` | 零 mapping 调用 |
| L1 本地合同编译 | `game/localCompileReadiness.ts:evaluateLocalCompileReadiness` | method 策略为 fixed 时直接产出 `PlannerProposal`，不调用 Planner |
| 方法匹配 | `game/v2Compile.ts:170 resolvePlayerMethodIndex` | 玩家意图 → method |
| 本地动作无 Narrator | `guidance/ancillary.ts`（休息/训练/转移用本地指引，LLM 升级可选） | |
| 无叙事回合的展示 | `campaign/storyEntry.ts:projectStoryEntry`（`mechanicalOnly`） | |
| 后继阶段后台预备 | `campaignPlan/stagePreparation.ts`、`replanService.ts` | 单飞、边界采用 |
| 计划编译与校验 | `campaignPlan/localCompile.ts:compileCampaignPlan`、`domain/campaignPlan/planValidation.ts` 等 | 与模型来源无关 |
| 原子采用 | `campaignPlan/adoption.ts:adoptOpeningPlan` | 幂等，哈希校验 |

---

## 4. 收束目标与指标

| 编号 | 指标 | 基线 | 目标 | 度量方式 |
|---|---|---|---|---|
| K1 | 点"开始故事"→ 可交互游玩页（≥2 个可执行 method）| ≥31 s，均值约 98 s，另加一次点击 | **p95 ≤ 3 s，单次点击** | `StartupTrace`（W0）；模拟器注明 |
| K2 | B 段（世界可开局→第一次可行动）LLM 请求数 | ≥2（`opening_goal` + `campaign_plan`） | **0** | `llm_request_attempts` 前后差分 |
| K3 | 向导就绪（目标建议可见）| 依赖 LLM 返回 | **≤100 ms，本地** | trace |
| K4 | 每回合阻塞 LLM 请求数 | L1：Narrator 1；非 L1：Planner + Narrator 2 | 本地可绑定输入 ≤1；本地动作 0 | 账本 + 回合 trace |
| K5 | LLM 失败/超时对启动与回合的阻断 | 启动会进入 `outcome_unknown` 死路 | **启动路径零阻断**；回合内 Narrator 有硬期限与回退（经 W4c 评审后） | 故障注入测试 |
| K6 | 新编译方法中 L1 可绑定比例 | 未统计 | 本地基线 **100%**；LLM 计划由 W0 先出基线，再定上限 | `evaluateLocalCompileReadiness` 统计 |
| K7 | 离线可玩 | 无 | 已构建世界在无网络下可完成 10 回合（无叙事时用本地模板） | 飞行模式测试 |
| K8 | 兼容与门禁 | `save-10`、DB 101+102 | **不变**；`verify:core`、`verify:version` 全绿 | CI |
| K9 | LLM 请求种类登记 | 14 种，无统一策略 | 每种在策略表有条目，新增未登记即测试失败 | 普查测试（W0/W1） |

所有"目标"栏是设计目标。任何"已达成"的声明必须附 §2.3 规定的证据。

---

## 5. 目标架构

### 5.1 LLM 四档分层（单一事实源：策略表）

| 档位 | 含义 | 可否阻塞 UI | 失败时 | 现有请求种类归属（目标） |
|---|---|---|---|---|
| T-A 本地确定性 | 选择、编译、绑定、校验、采用、默认值、调度 | 可 | 不会因模型失败 | 启动 B 段全部；开局目标；本地基线计划；L1 合同 |
| T-B 前台可降级 | 玩家正在等的创作输出 | 可，**必须有期限与本地回退** | 回退本地模板，不进入 unknown 死路 | `narrator`、`planner`（仅自由输入且无本地匹配） |
| T-C 后台增强 | 提升质量但不挡路 | **不可** | 静默保留本地结果 | `campaign_plan`（后继/个性化）、`opening_goal`（显式点击"AI 换一批"）、`narrator_guidance` 升级、`memory_*`、`summarizer`、`style_analyzer`、`world_mapping`、`world_adjudication`、`registry`、`timeline` |
| T-D 创作一次性 | 必须理解原著、耗时长但只做一次 | 有进度，可后台 | 现有恢复机制 | `world_extract`（开局抽取） |

### 5.2 目标启动链路

```
[A 段 · 一次性]  导入 TXT ─▶ 开局抽取(T-D, 有进度) ─▶ startup_local 映射(T-A) ─▶ 世界可开局
                                                      └─▶ 后段构建 / 全书 registry·timeline(T-C, 后台)

[B 段 · 全本地]  向导(本地目标建议, T-A)
                   └─ 点"开始故事" ─▶ 本地基线计划编译(T-A)
                                        ─▶ 复用 compile/validate ─▶ 写候选 ─▶ adoptOpeningPlan
                                        ─▶ 进入游玩页 (≤3 s, 0 LLM)

[游玩中]        点 method ─▶ L1 本地合同(T-A) ─▶ 骰点/结算 ─▶ Narrator(T-B, 有期限)
                自由输入 ─▶ 本地匹配(T-A) ─命中▶ L1 ；未命中▶ Planner(T-B) ─▶ …
                回合提交后 ─▶ stagePreparation 后台预备后继阶段(T-C)，稳定边界采用
```

### 5.3 设计原则

1. **关键路径只有本地。** 任何会让"可行动"变慢的 LLM 调用都要在策略表中显式豁免并说明理由。
2. **本地结果是地板，LLM 是升级。** 与 `timelinePass.ts` 注释里"local resolver 是地板，LLM 是升级"一致，把它推广到开局计划。
3. **复用，不新造。** 不新建引擎、不新建数据库表、不改存档协议；本地计划与 LLM 计划走**同一套** compile → validate → candidate → adopt。
4. **诚实声明取舍。** 本地基线不理解自由文本目标；个性化由后台增强补；界面文案不得假装已理解。
5. **不放宽任何校验器。** 本地模板必须自己通过现有 validator；过不了就改模板或提出增量协议评审，不改 validator。

---

## 6. 工作包

每个工作包给出：目标、现状证据、改动、触及文件、验收、测试、风险与不做、依赖。文件行号为 `3fb323ba` 的位置，施工时需重新核对。

### W0 基线仪器与 LLM 调用普查（先做）

**目标**：把"感觉慢"变成数据，并给 R4 的怀疑项一个证实或证伪。

**改动**
1. **`StartupTrace`**：进程内环形缓冲；开发构建输出单行 JSON 到 logcat。事件点：`app_boot_begin/end`、`db_runtime_ready`、`profile_loaded`、`wizard_mounted`、`wizard_goal_ready`、`start_pressed`、`plan_ready{source:local|llm}`、`adopt_done`、`play_first_render`、`first_action_enabled`、`turn_planner_start/end`、`turn_narrator_start/end`。**不写入存档与备份，不含正文、不含 API Key。**
2. **LLM 普查测试** `tests/llm-usage-census.test.cjs`：解析 `src/application/llm/types.ts` 的 `LlmRequestKind` 联合类型，要求每个值在 W1 的策略表中有条目；新增未登记 → 测试失败。
3. **核实 §2.2 的 1、3、4、5 项**，把结果写入 `docs/reviews/convergence/W0_BASELINE.md`。
4. **冷启动与"开始故事"基线**：在固定设备身份上采 ≥5 次冷启动。LLM 路径的 `campaign_plan` 耗时**沿用账本既有数字**，**不得为采基线发起新的付费请求**，除非用户另行授权并给出预算范围。

**触及文件**：`mobile/App.tsx`、`mobile/src/database.ts`、`mobile/src/ui/state/AppSessionContext.tsx`、`mobile/src/ui/screens/OpeningScreen.tsx`、`mobile/src/campaignPlanning.ts`、`src/application/campaign/session.ts`（仅埋点）。

**验收**：`W0_BASELINE.md` 含各阶段耗时表（注明模拟器/真机、APK 哈希）；普查测试在缺策略条目时失败。
**风险**：埋点改变时序——埋点必须是 O(1) 内存写。
**依赖**：无。

### W1 LLM 使用策略表 + 守卫（policy as code）

**目标**：把 §5.1 变成代码，防止之后又悄悄把 LLM 放回关键路径。

**改动**
- 新增 `src/application/llm/usagePolicy.ts`：`LLM_USAGE_POLICY: Record<LlmRequestKind, { tier: 'creative_once' | 'foreground_degradable' | 'background_enhance'; uiBlockingAllowed: boolean; localFallback: string | null; owner: string }>`。附录 A 给出初始值。
- 守卫：测试环境下，若请求带"UI 阻塞"标记而策略不允许，则断言失败；生产环境仅记录到 trace，**不改变运行行为**。可复用现有 `request.scheduling.priority`（P0/P1/P2）与 `role` 字段表达。

**验收**：K9 满足；策略表与附录 A 一致；`verify:core` 绿。
**不做**：不在生产环境因策略冲突拒绝请求。
**依赖**：W0（共用普查测试）。

### W2 向导去 LLM 化（`opening_goal`）

**现状证据**：`OpeningScreen.tsx:158-190` 的 `useEffect` 在依赖 `[worldId, anchorEventId, profile]` 变化时，先 `createSession(profile, await buildProvider(profile))`，再调用 `suggestOpeningGoals`。注释自称"纯增强"，但它占用 P1 调度、账本与缓存，并随每次改锚点重发。

**改动**
1. 新增纯函数 `localOpeningGoals(input): string[]`（≤2 条，每条 ≤28 字，动词开头）：由已发布世界包的开局局面 `methods[].goal`、锚点事件标题、在场人物名模板化生成。输入与现有 `OpeningGoalSuggestionInput` 对齐。
2. 向导挂载与改锚点时**只用本地结果**，不发请求。
3. 新增显式按钮"AI 换一批"，点击才调用原 `suggestOpeningGoals`（保留治理、缓存与账本）；失败保持静默，仍显示本地结果。
4. 评估 `session.getWorldSetup` 是否真的需要 provider；若不需要，调用点不再 `buildProvider`/`createSession`（§2.2 第 5 项）。

**验收**：向导挂载到目标可见 ≤100 ms；挂载与改锚点阶段 `llm_request_attempts` 增量 = 0；点"AI 换一批"才产生 1 次 `opening_goal` 请求。
**测试**：更新 `tests/opening-goal-suggestions.test.cjs`、`tests/phase6-opening-goal-governance.test.cjs`；新增本地生成的确定性与长度/去重测试。
**风险**：本地目标比 LLM 目标单调——可接受，这是增强项。
**依赖**：无（可与 W0 并行）。

### W3 本地优先的开局计划（核心）

**目标**：点一次"开始故事"，本地编译并采用一个合法战役计划，进入游玩；LLM 版主线转为后台增强。

**现状证据**
- 流程是 `create()`（`OpeningScreen.tsx:339`）→ `prepareCampaignPlan`（`campaignPlanning.ts`）→ `runOpeningPlanJob` → `runCandidateJob`，之后提案卡，再 `adoptCampaignPlan`。
- 编译与校验逻辑集中在 `candidateJob.ts` 的闭包 `compile`（约 L218–L309）：`compileCampaignPlan` → `validateCampaignPlan` → `validateOrdinarySuccessCompletion` → `validateEndingCompletionOrder` → `validateCampaignPlanCausality`。这段与"模型输出来自哪里"无关，但被锁在 LLM 作业里。
- 候选落库与置 `proposal_ready` 在 L396–L405；`adoptOpeningPlan` 要求候选通过 `isIntactReadyCandidate`（哈希自洽）、`setup.currentCandidateId` 一致、对应 job 为 `candidate_ready`。

**改动（分三个提交，前两个必须保持行为不变）**

*提交 1：纯重构，无行为变化。* 把 `compile` 闭包抽成导出函数 `compileAndValidateCandidate(frozenContext, model)`（返回 `{ compiled, errors }`），LLM 路径改为调用它。现有 `tests/phase9-*` 必须原样通过。

*提交 2：本地基线模型。* 新增 `src/application/campaignPlan/localBaselinePlan.ts`：
- `buildLocalBaselineModel(ctx, intent): CampaignPlanCandidateModelV1`，产出严格符合 `candidateModel.ts` 第 165 行起的模型形状，再经**同一个** `compileAndValidateCandidate`。
- 内容：
  - `proposal`：标题取"世界名·锚点标题"；`longTermGoal` 取玩家 `normalizedIntent`，`goalMode === 'exploration_pending'` 时用固定的默认目标；`tone` 取意图或"沿原著"。
  - `stages`：1 个 `main` 起始阶段（局面取 `compileOpeningSituation` 的结果）+ 1 个 `coverage:'provisional'` 的后继阶段，**交给现有 `stagePreparation` 在游玩中后台预备**。
  - `firstSituation.methods`：**每个 method 显式写 `difficultyPolicy` 与 `evidencePolicy`**（无骰动作固定 `normal` / 显式 `evidenceIds: []`；有骰动作用固定档位），确保 `evaluateLocalCompileReadiness` 返回 `ready`。这是对**新编译产物**显式写入，符合协议；不得对旧产物补默认值（见 `docs/reviews/phase9-5/L1_EQUIVALENCE_ACCEPTANCE.md`）。
  - `provenance` 一律用诚实的 `design_fill`，不伪造 `canon_inspired` 引用。
  - `endings`、`consequences`、`rewards`：取通过 `validateEndingCompletionOrder` 与 `validateCampaignPlanCausality` 所需的**最小集**。施工 agent 必须先阅读这些校验器，列出最小集再写模板。
- 本地路径写库：插入 `jobKind:'opening_plan'`、`physicalRequestBudget: 0`、状态 `candidate_ready` 的 job；`upsertCandidate({ stage:'ready', rawResponseRef:'local-baseline-1', … })`；`campaign_setups.status='proposal_ready'`。**不领 lease、不走账本、不冻结模型材料。** 之后 `adoptOpeningPlan` 原样复用。

*提交 3：流程切换。* `campaignPlanning.ts` 新增 `prepareLocalCampaignBaseline` 与 `startLocalCampaign`（本地编译 + 采用，一次完成）。`OpeningScreen` 的"开始故事"默认走本地路径，成功后直接进入游玩页。**高级向导保留"AI 定制主线（较慢）"入口**，走原 LLM 路径与提案卡，行为不变。

**后台增强**：优先让基线里的 `provisional` 后继阶段触发现有 `evaluateStagePreparationTarget`（`stagePreparation.ts`）。不新增触发器。若验证后发现玩家自由文本目标的个性化不足，再评估 `enqueueReplan` 新增触发原因，**需单独评审**。失败或 `outcome_unknown` 不得影响游玩（现有行为：`Legal play stays available`）。

**验收**
- A. 对 ≥3 个世界夹具（含 `tests/fixtures`），本地基线通过 `validateCampaignPlan`、因果与结局校验，零错误。
- B. 采用后，对所有可见 method，`evaluateLocalCompileReadiness` 返回 `ready`。
- C. 点击到游玩页 p95 ≤3 s，`llm_request_attempts` 增量 = 0。
- D. `save-10` 往返、分叉、导出导入测试通过；DB 迁移 101+102 不变。
- E. 原 LLM 路径回归不变。
- F. 游玩页"战役主线卡"对本地基线不出现虚假的"AI 已规划"字样。

**风险与取舍**
- **校验器最小集可能迫使模板偏厚。** 对策：先逆向列出最小集；若无法用诚实的 `design_fill` 满足，**提出增量协议评审**，不放宽校验器。
- 本地基线的叙事质量低于 LLM 主线——这是明确的取舍，由后台增强补齐。
- `intentHash` 绑定：本地路径必须用与 LLM 路径相同的 `intent` 哈希流程，否则 `adoptOpeningPlan` 的漂移检查会拒绝。

**依赖**：提交 1 无依赖；W1 的策略表需把 `campaign_plan` 标为 `background_enhance`。

### W4 回合热路径收束

**4a 自由输入的本地路由**
- 现状：`session.ts:3043` 用 `resolvePlayerMethodIndex` 匹配玩家点选或输入；未命中、或命中但 method 为 `planner_required`，才走 Planner。
- 改动：在 Planner 之前增加**高置信度**本地匹配（别名、关键词、候选集内相似度）。命中则走 L1；低置信度一律交给 Planner，**宁可多调一次也不误绑**。
- 验收：匹配器有黄金样本集；误绑率为 0 的样本约束；W0 先给出"Planner 占回合比例"基线。

**4b 减少 `planner_required`**
- 现状：`generationService.ts:389` 的提示词要求"无法本地闭合才用 `planner_required`"，决定权在模型。
- 改动：对**无骰动作**（`observe/talk/interact/move`），编译器在证据白名单唯一或为空时显式写固定策略；`skill_check` 保留模型给出的固定档位。**不对旧产物补默认值。**
- 验收：LLM 计划中 `planner_required` 比例有基线与上限；L1 与 L2 黄金套件（四档结果、关系/知识/物品/任务/局面、延迟后果）一致。

**4c Narrator 期限与降级（只做评审，不先实现）**
- 事实：Narrator 先于提交（`v2Turn.ts:600` 起），`narrator` 请求若已发送则受账本 unknown 规则约束；`docs/reviews/phase9-5` 明确警告"直接本地提交后再补叙事会改变恢复语义"。
- 因此本包先交付 `docs/reviews/convergence/W4C_NARRATION_DEGRADE_RFC.md`：恢复语义矩阵（崩溃于发送前/发送后/收到后/校验后）、降级触发条件、本地模板文本规范、迟到结果的处置、对 `recovery.ts` 与账本的影响。**经用户批准前不得改动提交顺序。**
- 可无风险先做：确认本地动作回合不再调用 Narrator；评估 SSE 流式预览（已有 `completionStream`、`sseFrameMonitor`）能否降低**感知**延迟，且校验失败时可撤回。

### W5 冷启动与会话生命周期（先测量，再动手）

**怀疑**（均为代码阅读推断，**未测量**）：
- H1：`AppSessionContext` 在退出 Bootstrap 屏之前串行等待 `loadApiProfile` 与完整的 `getDatabaseRuntime()`；后者构建约 25 个 store，并执行 `installBaselineSchema`、`probeFts5`、`recoverInterruptedAttempts`、`projectStyle.recoverAllInterruptedAnalyses`。
- H2：无 profile 时必须先过 `FirstRunScreen`。
- H3：向导每次改锚点重建 session 与 provider（见 W2）。

**改动（仅在 W0 数据证实后）**：把运行时拆成"首屏必需"（数据库、schema、必要 store）与"可延后"（风格分析恢复、FTS5 探测、构建恢复），延后部分在首屏可交互之后再跑。**不得**为提速跳过 `recoverInterruptedAttempts`，它保证重启后 unknown 请求不被自动重发。

**验收**：冷启动到首屏可交互的 p95 相对 W0 基线下降，目标值由 W0 数据设定，**本文不预设数字**。
**依赖**：W0。

### W6 免 API 的"序章"（需用户决策，见 §10 D1）

**背景**：当前无 profile 就进不了应用；阶段 2 的决策是"无隐式 demo campaign"。
**提案**：随包提供一个**原创**小型世界包，作为**显式、可选**的"序章/教学"入口（不是隐式回退）。它走 W3 本地基线 + L1 + 本地模板叙事，完全离线可玩，同时充当 TTFP、离线、确定性回归的金标准夹具。仓库声明不提交第三方小说全文，原创内容不冲突。
**若用户不同意**：则只在 `tests/fixtures` 内保留夹具，W6 作废，K7 改为"对已构建世界离线可玩"。

### W7 仓库与文档收束（让 agent 不被历史淹没）

**证据**：`docs/` 根目录有 39 个文档（多为各阶段计划与 agent 提示词），另有大量评审证据目录（仓库共 1227 个文件）；`progress.md` 约 33 KB；README 顶部同时写着 `V1.0.0` 与"构建标识 `versionName=0.9.1`、`versionCode=90100`"，并保留 2026-10-09 的"29 PASS / 2 FAIL / 9 NOT RUN"阶段句，而 `progress.md` 写的是 2026-10-16 的 9.5 PARTIAL。新 agent 很难判断唯一事实源。

**改动（不移动、不删除证据文件，避免破坏链接）**
1. 本文件登记为启动收束的唯一执行入口；README 顶部只留一句指向本文，并用 `npm run verify:version` 修正版本表述。
2. 新增 `docs/INDEX.md`：把现有文档标为"现行 / 历史 / 已被取代"。
3. `progress.md` 顶部新增"当前：启动收束"状态表，旧内容下沉。
4. 新证据只放 `docs/reviews/convergence/`，截图控量并附哈希。

**验收**：新 agent 只读 README → INDEX → 本文即可开工；`verify:version` 绿。

---

## 7. 顺序与里程碑

```
C0  W0 + W1                         （1 个 PR；数据与护栏先行）
C1  W2  ∥  W5 的测量部分             （W2 小而立竿见影）
C2  W3 提交1 → 提交2 → 提交3         （核心；提交1 必须零行为变化）
C3  W4a / W4b  +  W4c RFC            （W4c 经批准再实现）
C4  W5 改动（依数据）+ W6（依决策）+ W7
```

依赖：W1 依赖 W0 的普查；W3 提交 3 依赖提交 2；W4a/b 依赖 W3 提供的"全 L1 本地计划"作对照；W5 改动依赖 W0 数据；W6 依赖 D1 与 W3。

每个里程碑都应当**独立可发布**：C2 之后启动路径即已收束，其后各包是体验与质量的增量。

---

## 8. 红线与约束

1. **不放宽任何校验器与 L1 资格**；不对旧产物合成 `normal` 或 `[]` 使其"合格"。
2. **不改存档与数据库协议**（`shineword-save-10`、迁移 101+102）。如确需变更，先出 RFC，且只能是增量。
3. **不新造引擎或数据库表**。W3 复用 `campaign_setups`、`campaign_plan_jobs`、`campaign_plan_candidates`、`campaign_plan_revisions` 等既有结构。
4. **不改写已提交回合、骰点与历史存档**；不清理私有数据。
5. **真实模型调用必须有用户授权与明确的预算范围**，沿用阶段 9.5 的规则；本方案的自动化验收全部使用本地夹具与已有 mock/代理。
6. **证据诚实**：不把模拟器写成真机；不把构建成功当作 UI 可用；不用施工 agent 自评代替玩家试玩；缺证据就标 `NOT RUN` / `UNKNOWN`。
7. **仅在功能分支工作**，经 PR 交付；不直推 `main`，不 force push，未经授权不合并、不打 tag、不发 Release。
8. trace 与日志**不得**记录 API Key、小说正文、玩家输入原文。
9. 每次提交后跑 `npm run verify:core` 与 `npm run verify:version`；涉及移动端再跑 `npm run typecheck --prefix mobile`。

---

## 9. 验收矩阵

| 编号 | 内容 | 对应工作包 | 证据类别 | 状态 |
|---|---|---|---|---|
| C-01 | 普查测试：每个 `LlmRequestKind` 都有策略条目 | W0/W1 | 自动化测试 | NOT RUN |
| C-02 | `W0_BASELINE.md`：冷启动与开始故事分段耗时（注明模拟器/真机、APK 哈希）| W0 | 设备/模拟器 | NOT RUN |
| C-03 | 向导目标建议本地生成，≤100 ms，挂载阶段请求增量 0 | W2 | 自动化测试 + 模拟器 | NOT RUN |
| C-04 | "AI 换一批"才发 `opening_goal`，失败静默 | W2 | 自动化测试 | NOT RUN |
| C-05 | `compileAndValidateCandidate` 抽取后 LLM 路径回归全绿 | W3 提交1 | 自动化测试 | NOT RUN |
| C-06 | ≥3 个世界夹具的本地基线通过全部校验器 | W3 提交2 | 自动化测试 | NOT RUN |
| C-07 | 采用后所有可见 method 的 L1 就绪 | W3 | 自动化测试 | NOT RUN |
| C-08 | 点击到游玩页 p95 ≤3 s，LLM 请求 0 | W3 提交3 | 模拟器 + 账本差分 | NOT RUN |
| C-09 | 存档往返、分叉、导入导出、迁移不变 | W3 | 自动化测试 | NOT RUN |
| C-10 | 后台后继预备在本地基线上触发并可在稳定边界采用 | W3 | 自动化测试 | NOT RUN |
| C-11 | 自由输入本地匹配：黄金样本零误绑 | W4a | 自动化测试 | NOT RUN |
| C-12 | L1 与 L2 黄金套件结果一致 | W4b | 自动化测试 | NOT RUN |
| C-13 | `W4C_NARRATION_DEGRADE_RFC.md` 提交并获批 | W4c | 文档评审 | NOT RUN |
| C-14 | 冷启动 p95 相对基线下降（目标值由 W0 设定）| W5 | 模拟器/真机 | NOT RUN |
| C-15 | 离线 10 回合 | W6 或夹具 | 自动化测试 / 设备 | NOT RUN |
| C-16 | `docs/INDEX.md`、README、`progress.md` 对齐，`verify:version` 绿 | W7 | 自动化测试 | NOT RUN |
| C-17 | 真实模型验证：本地基线 + 后台增强的完整旅程 | 全部 | 真实模型 + 真实旅程 | **BLOCKED**：待用户授权预算 |
| C-18 | 外部试玩：开始故事的体感对比 | 全部 | 外部试玩 | **BLOCKED**：待用户安排 |

关闭条件：C-01–C-12、C-16 为 PASS 即可宣布"启动收束完成（工程）"；C-17、C-18 单独登记，不得由其他项代替。

---

## 10. 待用户决策项

| 编号 | 问题 | 建议 | 影响 |
|---|---|---|---|
| D1 | 是否允许随包提供**显式可选**的原创"序章"世界（W6），以及是否放宽"无 API 不进应用"？ | 允许序章；"放宽进入门槛"另议 | 决定 W6 是否实施、K7 的口径 |
| D2 | 是否接受"本地基线计划"作为"开始故事"的**默认路径**，LLM 主线降为后台增强/高级入口？ | 接受 | 决定 W3 提交 3 的默认行为；这是体验取舍：开局更快，但初始主线更模板化 |
| D3 | 高级向导是否保留"AI 定制主线（较慢）"？ | 保留 | 保留则 LLM 路径与提案卡继续维护 |
| D4 | Narrator 超时后的降级策略（W4c）：本地模板提交，还是继续等待？ | 先看 RFC | 触及恢复语义，需明确批准 |
| D5 | K1 的 3 s 目标是否可接受？ | 可接受 | 决定验收阈值 |
| D6 | 授权真实模型验证的预算范围与端点 | 另行提供 | 解锁 C-17 |

---

## 11. 施工 agent 工作规程

**开工前必读（按序）**：本文 → `progress.md` 顶部 → `docs/reviews/phase9-5/L1_EQUIVALENCE_ACCEPTANCE.md` → `docs/reviews/phase9-5/MODULE_OWNERSHIP.md` → `docs/VERSIONING.md` → 当前 `package.json` 脚本与 `.github/workflows`。读取并记录实际 HEAD。

**每个工作包**
1. 分支名：`codex/startup-convergence-<wp>`（如 `-w2`）。
2. 先写失败测试再改代码；W3 提交 1 必须先证明"重构前后行为一致"。
3. 小步提交，提交信息写明工作包编号。
4. 完成后在 `docs/reviews/convergence/` 写简报：改了什么、证据类别与状态标签、未验范围、下一步。**不复述过程。**
5. 发现本文与代码事实冲突：以代码为准，在简报中记录冲突，并回改本文。

**完成定义**：验收矩阵对应项为 PASS 且证据已登记；未验部分明确标 `NOT RUN` / `BLOCKED` / `UNKNOWN`。

---

## 附录 A：请求种类初始策略（W1 起点）

来源：`src/application/llm/types.ts` 的 `LlmRequestKind`（14 种）与各调用点。"待核实"项由 W0 确认后再定稿。

| 请求种类 | 调用点（示例） | 目标档位 | 可阻塞 UI | 本地回退 | 备注 |
|---|---|---|---|---|---|
| `planner` | `game/v2Turn.ts:455`、`campaign/session.ts:1818` | T-B | 是 | 本地匹配（W4a）后仍未命中才用 | 非 L1 回合 |
| `narrator` | `game/v2Turn.ts:640` | T-B | 是 | 本地模板（W4c 评审后） | 先于提交 |
| `campaign_plan` | `campaignPlan/generationService.ts:547` | **T-C** | **否** | 本地基线计划（W3） | 现状为阻塞 |
| `opening_goal` | `campaign/openingGoalSuggestions.ts` | **T-C** | **否** | `localOpeningGoals`（W2） | 现状为自动发 |
| `narrator_guidance` | `guidance/ancillary.ts:266` | T-C | 否 | 本地指引（已有） | 已是异步升级 |
| `world_extract` | `worldBuild/*`、`worldPackage/progressiveOpening.ts` | T-D | 有进度 | 现有恢复机制 | 开局抽取单请求 |
| `world_mapping` | `worldBuild/llmRequest.ts` | T-C | 否 | `startup_local` | 开局已本地 |
| `world_adjudication` | `worldBuild/*` | T-C | 否 | — | 待核实不在开局依赖链 |
| `registry` | `world/bookRegistry.ts:153`、`segmentBuild/openingSurvey.ts:81` | T-C | 否 | — | 待核实 `openingSurvey` 是否在开局前 |
| `timeline` | `world/timelinePass.ts:101` | T-C | 否 | 本地 resolver（已有，注释称"地板"） | |
| `memory_checkpoint` | `memory/*` | T-C | 否 | — | **待核实是否阻塞回合** |
| `memory_repair` | `memory/*` | T-C | 否 | — | **待核实** |
| `summarizer` | `memory/summarizer.ts:61` | T-C | 否 | — | **待核实** |
| `style_analyzer` | `writerStyle/sourceAnalyzer.ts:35` | T-C | 否 | 预设风格 | README 称低优先后台 |

## 附录 B：关键文件索引（`3fb323ba`）

| 主题 | 文件 |
|---|---|
| 向导与开始故事 | `mobile/src/ui/screens/OpeningScreen.tsx`（目标建议 L158–190；`create()` L339）、`mobile/src/campaignPlanning.ts` |
| 计划作业 | `src/application/campaignPlan/planningService.ts`、`candidateJob.ts`（编译闭包约 L218–309；落库 L396–405）、`generationService.ts`（请求 L547、提示词 L389）、`adoption.ts` |
| 本地编译 | `campaignPlan/localCompile.ts`、`campaignPlan/candidateModel.ts`（模型形状 L165 起）、`worldPackage/compileOpeningSituation.ts`、`compileOpeningActors.ts` |
| 校验器 | `src/domain/campaignPlan/{planValidation,causalityValidation,endingValidation}.ts` |
| 后继预备 | `campaignPlan/stagePreparation.ts`、`replanService.ts` |
| 回合 | `game/v2Turn.ts`、`game/localCompileReadiness.ts`、`game/v2Compile.ts`（`resolvePlayerMethodIndex` L170）、`campaign/session.ts`（L3043–3090） |
| 引导与叙事展示 | `guidance/ancillary.ts`、`campaign/storyEntry.ts` |
| 请求治理 | `llm/types.ts`、`llm/requestDeadline.ts`、`llm/requestDemands.ts`、`llm/requestLedger.ts` |
| 冷启动 | `mobile/App.tsx`、`mobile/src/ui/state/AppSessionContext.tsx`、`mobile/src/database.ts` |
| 现有基线与证据 | `progress.md`、`docs/reviews/phase9-5/**`、`docs/reviews/phase9-5/local-final-closeout-20261018/PERFORMANCE_AND_ACCESSIBILITY.md` |
