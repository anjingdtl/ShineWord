# Changelog

本项目的全部版本变更记录。版本规则见 [docs/VERSIONING.md](docs/VERSIONING.md)。

## [Unreleased]

## [0.4.1] - 2026-09-30

### Added — Reasoning & LLM Governance Closeout

- 设置页支持 Low / High / Max 三档思考强度，并显示 Planner 预算预览；自定义模型上下文窗口与最大输出能力可保持 Unknown 或由用户填写。
- 统一 Reasoning Policy 将冻结档位同时映射到 Provider 参数、Reasoning Reserve 与 wire 输出预算；Planner、Narrator、Story Memory、Summarizer、World Build 及渐进式开篇请求均复用预算与账本治理。
- Legacy `off` 在 Profile / Frozen Run 兼容边界迁移为 Low；新 Profile 和新 Run 只保存 Low / High / Max。Reasoning-only 有界恢复保持用户所选档位，不关闭 Thinking。
- World Extract 与 Group Extract 复用结构化输出管线，继续执行本地证据引文校验；渐进式开篇按 Max 预留收缩来源上下文，保留首幕证据范围并将请求写入 Ledger。
- 新增 reasoning usage 按 profile、档位、请求种类的可校准统计基础；usage 未知保持 Unknown，不按 0 处理。

- 升级版本至 `0.4.1` / `versionCode=40100`。

## [0.4.0] - 2026-09-30

### Added — LLM 上下文与长期记忆基础设施（M0–M6）与版本管理规范

- **统一请求预算内核**（M1）：模型能力来源五级治理（user_declared > provider_documented > provider_probe > derived > unknown），探测不再伪造 128K 上下文窗口；请求包络 `Hard = C − O − R − S`、Soft 80% / Burst 95%，推理预留按 Provider 方言（inside_completion / separate）只扣减一次；四阶段确定性弹性分配器（mandatory 保护、目标填充、burst 借用、mandatory 补齐），`planLlmRequest()` 统一冻结输出预算与分配轨迹；B01–B12 与 32K/64K/128K/200K/1M 五窗口测试矩阵全绿。
- **JSON 韧性层**（M2）：字符串/转义感知的平衡 JSON 提取、Markdown 围栏剥离、字符串外尾逗号修复、≤2 层双重编码解包、白名单字段/枚举别名（canonical 永不被覆盖）、截断与缺失分类（json_truncated / no_json_found）；权威校验器（assertValidActionContract 等）位置与强度不变，内部持久化 JSON 仍走严格解析。
- **物理请求账本**（M2）：迁移 19 `llm_request_attempts`，六态生命周期（prepared→sent→succeeded/failed/outcome_unknown/cancelled），App 强杀后冷启动自动标记 outcome_unknown 并**禁止自动重发**（防重复计费）；Planner / Narrator / Summarizer / Memory 全部入账，input/output/reasoning/cached 四列用量落库。
- **Story Memory V2**（M3，双轨）：人物叙事状态、关系、冲突、线索、伏笔、节拍；LLM 只产出 Patch（稳定 ID 与指纹链本地生成），确定性合并器 + 证据回指（每项必引本批 turnId）；Smart Cadence 触发（间隔 ≥8 或关系/任务/队伍/高重要信号），后台 return-first 维护**永不阻塞游玩**；历史缺版本时 fail-closed。迁移 20。
- **Episodic Recall V2**（M4）：完全本地召回（零 Embedding API、零每回合 LLM）——CJK 一/二/三元组 + 英文词元 + IDF 加权 + 实体加权（歧义别名不 boost 任何人）、混合 Top-K（60% 相关 / 20% 人物史 / 20% 近期）、whole-item 预算打包、按时间线渲染；30/100/300/1000 回合长程召回全过（1000 回合 4.7ms）。迁移 21。
- **弹性回合上下文**（M5）：六大 Board（authority/currentState/worldKnowledge/storyMemory/recentHistory/sourceEvidence）候选 → 内核预算 → 冻结 → 分节渲染；**Narrator 独立上下文与预算**（永不见三宝书/证据/行动协议）；Story Memory V2 读门（clean 且覆盖足够才替代旧摘要）；能力未知时显式 legacy 回退，坏配置不破玩。
- **真实 GLM 验证**（M6，GLM-5.3-Flash）：五门全过（Planner / Narrator / Memory Patch / JSON 围栏变体 / 账本用量），reasoning 与前缀缓存实测观察；《白篱梦》真实 10 回合闭环通过（开局 dossier 单请求零修复；v0-8 记忆检查点 clean；第 2 回合的玉簪之约在第 9 回合被正确召回）；《凡人修仙传》2469 章 1.5s 导入、54K-token 真实请求 3.8s、重复前缀 99.8% 缓存命中；Android（ShineQA AVD）安装/冷启/迁移 1–21/force-stop 恢复通过。详见 [docs/reviews/llm-memory/FINAL_REPORT.md](docs/reviews/llm-memory/FINAL_REPORT.md)。
- **版本管理规范**：参考 tavo-mini 建立[统一版本号与迭代规则](docs/VERSIONING.md)（语义化 + versionCode 编码公式 + 六处一致性 `npm run verify:version` 门禁）；构建前自动生成 `mobile/src/version.json`；App 内「关于」与书库/模型页展示**作者 ShineHe** 与当前版本。
- 顺带修复四个存量缺陷：fork 不复制回合历史行、开局 8K 上限与思维预留冲突、Memory Patch 协议「省略节」与验证器矛盾、Planner 上下文缺合法技能 ID 列表。
- 升级版本至 `0.4.0` / `versionCode=40000`（首个执行统一版本号规则与正式签名发版的版本）。
