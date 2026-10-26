# 启动收束检查点（Startup Convergence CHECKPOINT）

> 供换会话接手：每完成一个里程碑更新本文件。验收矩阵状态见各工作包简报与本文件汇总。

## 当前状态

- 里程碑进度：**C0 完成**（W0 + W1）｜C1 进行中（W2）
- 分支：`codex/startup-convergence-w0`（C0 三个提交：`82614b7` 埋点、`b93c883` 策略表、`5151c29` W0 基线文档）
- 基线 HEAD：`e7f5e9d`（main）。方案文档 `docs/Shine-TRPG_STARTUP_CONVERGENCE_PLAN.md` 目前为工作树未跟踪文件（规划 agent 所留，按交付规则暂不纳入提交；W7 文档收束时再定）。
- 门禁：C0 后 `verify:core` 1385/1385、`verify:version` OK、mobile typecheck OK；远端 CI 在 `e7f5e9d` 绿。

## 已完成工作包

| 工作包 | 状态 | 证据 |
|---|---|---|
| W0 基线仪器与普查 | PASS-ENGINEERING | `docs/reviews/convergence/W0_BASELINE.md`；冷启动 5 次采样（模拟器 ShineQA AVD，boot_end p95≈2.1s，db_runtime p95≈0.9s）；§2.2 第 1/3/4/5/7 项全部核实，第 2/6 项有数据或清单 |
| W1 策略表+守卫 | PASS-ENGINEERING | `src/application/llm/usagePolicy.ts` + `tests/llm-usage-census.test.cjs`（C-01 PASS） |

## 与方案的冲突（以代码为准，需回改方案）

1. `verify:core` 基线是 1377（W0 后 1385），不是文档里的 1334。
2. standalone debug 的 `__DEV__`=false：trace sink 无条件安装（字段白名单保证隐私），方案"开发构建输出"条款按此修正。
3. `summarizer` 与 `world_adjudication` 当前无生产调用点；`registry`/`timeline` 在 mobile 生产开局链上被跳过；memory 类为提交后后台。附录 A 对应行可在 W7 收敛时改"待核实"为"已核实"。

## 未完成项与阻塞

- C-17（真实模型旅程）、C-18（外部试玩）：BLOCKED（待用户预算授权/安排）。
- B 段 LLM 路径设备分段测量：NOT RUN（避免付费请求；本地路径完成后复测）。
- 首次运行（空库）冷启动采样：NOT RUN。

## 下一步

C1：W2（向导去 LLM 化：`localOpeningGoals` 纯函数、挂载/改锚点零请求、"AI 换一批"显式入口、`getWorldSetup` 改用 noop 会话）→ C2（W3 三个提交）。决策默认值沿用：D2 接受本地基线默认；D5 K1 p95≤3s；D1 不实施；D4 只写 RFC。
