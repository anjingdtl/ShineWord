# ShineWord 文档索引

> 目的：让新接手的 agent 只读 README → 本索引 → 对应方案/报告即可开工，不被 39 个阶段文档淹没。
> 维护规则：新工作只新增"现行"条目并把被取代的旧条目改为"历史"；证据类文档只放 `docs/reviews/<effort>/`。分级：**现行**（对当前代码有约束力）、**历史**（过程记录，结论已被后续取代或吸收）、**参考**（长期有效的操作说明）。

## 现行（当前施工与长期约束）

| 文档 | 作用 |
|---|---|
| [Shine-TRPG_STARTUP_CONVERGENCE_PLAN.md](Shine-TRPG_STARTUP_CONVERGENCE_PLAN.md) | 启动流程收束的执行入口（W0–W7、验收矩阵 C-01~C-18、决策项 D1–D6） |
| [reviews/convergence/CHECKPOINT.md](reviews/convergence/CHECKPOINT.md) | 收束轮检查点（HEAD/已完成/阻塞/下一步），换会话先读 |
| [reviews/convergence/](reviews/convergence/) | 收束轮全部简报与 RFC（W0 基线、W2/W3/W5 简报、W4C RFC） |
| [VERSIONING.md](VERSIONING.md) | 版本六处一致与 versionCode 公式（长期约束） |
| [../progress.md](../progress.md) | 轮次状态表（顶部为当前施工） |
| [ANDROID_APK_BUILD.md](ANDROID_APK_BUILD.md)、[USER_GUIDE_IMPORT_BUILD.md](USER_GUIDE_IMPORT_BUILD.md) | 构建/导入操作参考 |
| [reviews/phase9-5/](reviews/phase9-5/) | 阶段 9/9.5 的权威验收证据目录（含各 HANDOFF、L1 等价门、模块所有权）；其 PARTIAL 结论仍有效，未闭合项见各报告 |

## 历史（各阶段施工方案与 agent 提示词——结论已被吸收或取代）

`CONSTRUCTION_PLAN.md`、`M0_BASELINE_AUDIT.md`、`M0_FUNCTION_AUDIT.md`、`PHASE2_*`、`Shine-TRPG_PHASE2..9_*`（构造/收口/优化/续接各类）、`Shine-TRPG_PROGRESSIVE_*`、`Shine-TRPG_UNIFIED_BUILD_*`、`Shine-TRPG_1M_RESIDENT_BUILD_*`、`Shine-TRPG_CLOSEOUT_AGENT_PROMPT.md`、`UI_REDESIGN_PLAN.md`、`UI_HANDOFF_PROMPT.md`、`AVATAR_SYSTEM_*`、`DEVELOPMENT_STATUS.md`、`PROGRESSIVE_OPENING_OPERATIONS.md`、`Shine-TRPG_SKILL_GENRE_BINDING_AGENT_PROMPT.md`、`Shine-TRPG_LLM_CONTEXT_MEMORY_INFRASTRUCTURE_PLAN.md`（其治理规则已实现进代码与 AGENTS.md）。

> 判定依据：这些文档描述的是"当时的计划与提示词"；实现与验收以 `docs/reviews/` 对应目录为准。阅读历史文档时以代码与验收报告为准。

## reviews 目录速查

| 目录 | 内容 |
|---|---|
| `reviews/convergence/` | 启动收束（当前轮） |
| `reviews/phase9-5/` | 阶段 9.5 收口（权威，PARTIAL） |
| `reviews/phase8/`、`reviews/phase7/` 等 | 更早阶段验收证据 |
| `reviews/AVATAR_SYSTEM_BUILD_REVIEW.md` 等 | 单项系统验收 |
