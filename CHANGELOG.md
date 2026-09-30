# Changelog

本项目的全部版本变更记录。版本规则见 [docs/VERSIONING.md](docs/VERSIONING.md)。

## [Unreleased]

### Fixed — 真机 P0 稳定性修复（fix/mobile-runtime-stability）

- **导入进度闭环（99% 卡死）**：流式 TXT 导入在 `activateSource` 之后新增显式的「原文解析完成：N 章 · M 块」事件，unified/full 两条路径在创建构建任务后发出「已创建 N 个构建组，等待模型处理」（phase 进入 extracting）。UI 不再停留在最后一次 reading 的「解析中 99%」；复用已导入源（同哈希重复导入）同样完整收尾。
- **后台 Runner 异常不再静默**：Headless `WorldBuildRunner` 外层 catch 改为分类持久化（`runner_execution_failed` / `keychain_unavailable` / `provider_config_error` / `network_error`，消息经 `sk-`/`Bearer` 脱敏）；仅当 run 仍假装 queued/running 时写入 `failed_retryable`，coordinator 已分类的状态（paused_user/needs_review/waiting_* 等）不被覆盖。旧版 run 无冻结配置且无可用凭据时落 `waiting_unlock(keychain_unavailable)`，可见、可恢复。
- **前台服务启动看门狗（execution-start confirmation）**：`startBuildWithWatchdog` 在 `startForegroundService` 成功后轮询本地 SQLite 执行证据（run 进入 running / 活跃 lease / heartbeat / unit running / attempt>0），窗口内无证据则前台 inline fallback；lease + fencing token 保证后台与 inline 恰好一个执行者（慢启动的后台执行者在窗口内出现则不重复执行）。
- **0/N 阶段可观察性**：任务卡派生计数实时来自 `world_build_units` 行状态——「抽取事实 2/69 组 · 正在处理 3 · 排队 61 · 待重试 3」，running 时显示「正在等待模型响应（第 N 次尝试）」与最近活动时钟；不虚构 ETA。
- **可恢复停止（stopped_user）**：用户可见「取消」重定义为「停止构建」——停止后续 claim、保留已完成组、保留待重试组、保留 run 与 SQLite 数据，可随时「继续构建」。迁移 24 表重建 `world_build_runs` 的 status CHECK（FK 安全的双表重建过程），同步 `BuildRunStatus` / store / `listResumableRuns` / `RUN_STATUS_LABEL` / coordinator / UI / 通知按钮（「取消」→「停止」）。
- **暂停状态机**：`pause_requested` / `cancel_requested` 进入任务卡视图，「暂停请求中 / 停止请求中」立即可见且可撤销；`requestRunControl('resume')` 现在同时清除 pause 与 cancel 标志（修复旧实现 resume 不清 cancel 导致恢复即被再次停止的缺陷）；coordinator 在所有 worker 退出后统一再清一次控制标志（并发 worker 的竞态残留）；`acquireLease` 将任意非终态 run 置回 `running`（修复 paused_user/failed_retryable 恢复执行时 UI 仍显示旧状态的僵尸执行者问题）。
- **待重试计数口径**：`units_failed` 保持为累计失败尝试次数（现暴露为 `failureAttempts`），UI 不再把它当作待重试组数；当前待重试改为对 unit 行的实时 COUNT（failed_retryable + waiting_network），恒满足 retryable ≤ total。69 组 / 176 次历史失败不再显示「176 待重试」，累计次数移入展开明细。
- **任务列表自动刷新**：存在动态任务（running/控制请求中/等待/可重试）时书库每 ~1.5s 轻量刷新任务视图（仅本地 SQLite，无任何 provider 请求），失焦或全部静态即停止。
- **模型配置「测试连接」**：Profile 表单新增按钮，用生产 OpenAI 兼容管线（同一 provider、同一 reasoning 档位与方言参数塑形、`/chat/completions`）发送极小完成请求；表单中未保存的 API Key 仅存内存，Key 为空时回落 Keychain；结果区分 成功/401/403/404/400（含 reasoning 参数不兼容）/429/5xx/超时/网络/非 JSON 响应/仅思考无正文，密钥绝不进入结果、存储或日志。
- **失败明细改进**：展开明细包含 runId、状态、完成/总组数、处理中/待重试/排队、累计失败尝试、最近错误码与消息、最近活动时间、最近 3 个失败 unit（unitId/attempt/errorCode）。
- 新增回归测试 37 项（import 进度闭环 / 连接探测分类与密钥不泄漏 / runner 失败持久化 / watchdog 决策 / pause-resume-stop 全链路含已完成 unit 不重做与 lease 防双执行 / 计数语义 / 轮询决策），全量 506 项通过。

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
