# Shine-TRPG

[![Version](https://img.shields.io/badge/Version-V0.8.1-blue.svg)](CHANGELOG.md)
[![Author](https://img.shields.io/badge/作者-ShineHe-orange.svg)](docs/VERSIONING.md)

面向 Android 的轻量文字 TRPG：玩家读故事、点文字行动或输入自己的意图；本地规则确定检定与状态，模型负责受限提案和叙事。作者：**ShineHe**。

用户导入小说 TXT 后，Shine-TRPG 将原著整理成带证据的世界资料；玩家可以扮演原著角色或原创角色，通过简短文字选择或明确提交的自由行动推进故事。调查、关系日常、探索和冲突共用文字入口。LLM 只能在本地规则给定的边界内提出行动结构与叙事；本地引擎负责资格、骰点、成长、状态与事务结算。

> 当前版本：**V0.8.1** · versionCode 80100。V0.8.1 为 0.8.0 之后的加固与复验收尾（无新能力）：可移植 SHA-256 请求/缓存身份、稳定存档门禁（拒绝未完成冻结回合与在途/未批准未知请求）、世界规则配置硬化（伪造哈希/非安全整数/未类型化约束拒绝）、数据库单基线 version 100（旧/不完整库显式拒绝且不静默修复）、移动端记忆状态诚实呈现（结果未知横幅 + 计费告知的恢复入口）。验收矩阵 A01–A36 全部闭合（**PASS 36 / NOT RUN 0 / FAIL 0**，真机与 2 项产品决策项为开放项），核心回归 922 项全绿；证据见 [收尾轮报告](docs/reviews/phase8/CLOSEOUT_ROUND2_2026-10-05.md)。
>
> V0.8.0 第八阶段完成通用规则核心 + 可组合机制模块 + 世界规则配置：单一当前协议（core 0.3.0、ActionContract 2.0、save-9、迁移 33，旧输入逐版本明确拒绝）、类型化回合材料与判别式记忆资格、零发送预算门（能力未知/超窗不发 HTTP）、持久化冻结与恢复、提交+outbox 唯一原子边界、证据化长期记忆（known-change 门、CAS 合并）、8 个可信机制模块与可选 pressure_track。205 轮设备长程实测（完整小说导入 + 完整构建 + 真实 GLM 回合）与 100/300/1000 累积旅程通过；证据与未验范围见 [第八阶段报告](docs/reviews/phase8/FINAL_REPORT.md) 与 [长程实测报告](docs/reviews/phase8/LONGRUN_REPORT.md)。仅支持 Android；LLM 由用户配置 OpenAI-compatible 端点。

内置预设 DeepSeek V4.1 Flash 与 GLM-5.3-Flash 均按官方模型列表登记真实能力（DeepSeek 请求 ID `deepseek-flash`，上下文 1,048,576，最大输出 393,216；[官方模型列表](https://api-docs.deepseek.com/api/list-models/)）。设置页预算预览复用真实 Request Budget Kernel，是未计入实际回合必需协议输入的估算。V0.4.4 世界构建恢复的自动化验收与限制见 [RESULTS.md](docs/reviews/world-build-recovery/RESULTS.md)：映射恢复以本地合成端点与生产 HTTP 传输验证，未调用付费模型，不能据此保证任何真实供应商故障都能恢复；V0.4.5 限流治理另以真实 GLM-TEST 端点全链路实测（构建发布 + 11 回合游玩、零 429）。

## 核心特性

- **依赖驱动的小段建设（V0.6.0 起，V0.8.0 保留）**：新项目精准读取前部，小说输入上限为模型上下文 10% 且受 6400 码点和总预算约束；真实事实在本地编译规则，20 事实、人物/地点/事件/行动/引用闭包与冲突门禁全部保留。后段按当前域和行动依赖补建，近期缓冲最多两段；兼容抽取复用，映射只取变化及必要依赖。世界 ready 与各分支 adopted 分离，冻结回合和人物历史不被后台改写。
- **持久检索与项目风格**：稳定原文索引独立于别名及玩家权限，覆盖不足与损坏明确返回诊断。项目风格支持跟随原著、预设、自定义；分析为低优先后台工作，用户覆盖优先，每回合本地编译并冻结可恢复快照，禁止风格修改事实、裁定、权限和硬预算。

- **确定性骰点**：Shine-TRPG Ruleset V0.1——六属性、d4～d12 技能骰、1～4 颗骰取最高、四档结果等级。骰点由本地引擎用 Android SecureRandom 拒绝采样完成，先持久化 RollRecord 再调用叙事模型；Narrator 失败或重启后复用同一骰点，永不重掷。
- **TXT 原著导入**：编码探测（UTF-8/GBK）、标准分章、码点偏移体系；**多部导入（V0.5.0）**——超长篇可拆成多部 TXT 分次导入同一项目，第 N 部的世界侧章节/块带 `s{N}-` 前缀镜像、章节序号全局连续，跨部 ID 永不冲突，各部独立构建并入同一世界 canon。LLM 只产出 verbatim 引文，本地解析偏移并检查证据位置；长篇压力实测 2469 章 / 760 万码点导入 1.5s（桌面 Node 基准）。
- **LLM 权限边界**：Planner 只能提出行动合同（ActionContract JSON），本地校验器严格把关（禁止骰点/结果/数值等权威字段，畸形合同干净拒绝）；Narrator 不得更改冻结的结果等级。
- **统一 LLM 基础设施**（V0.4.0–V0.4.1）：模型能力来源治理（不再伪造 128K）、Low/High/Max 推理策略与预算联动、Soft/Burst/Hard 弹性请求预算、六 Board 弹性回合上下文（Planner/Narrator 分离）、结构化 JSON 管线、物理请求账本（强杀后 outcome_unknown 防重复计费）、Story Memory V2 长期叙事记忆与完全本地 Episodic 召回。
- **世界构建管线与自动恢复**（V0.4.3–V0.4.5）：TXT 导入后「抽取 → 映射 → 内容审查 → 发布」后台全链路执行。请求超时、上下文超限自动拆小批次并降档排队规模；映射 JSON 截断或仅返回思考内容时，后台自动提高正文与同档思考预算、拆小超限批次并按持久化退避续试，已完成抽取与映射成果保留，检查点按实际输入哈希重放合并；技术故障不进入人工内容审查。限流治理（V0.4.5）：所有物理请求（构建/映射/游玩回合）经 per-endpoint 全局调度器，429 触发指数惩罚地板与自适应请求间距并接线服务商 Retry-After，限流单元指数退避、默认并发下调为 2；服务商内容安全 4xx 批次自动对半拆分重试，干净部分照常完成。构建卡按「抽取批次 + 映射 + 审查校验 + 发布」计真实进度，发布成功才到 100%，存在待审项时可直达审查页；相同内容与严重度的豁免策略默认在本世界内记忆复用，内容变化重新审查。
- **多 API 配置**（V0.4.4）：保存多条具名 API 配置，各持独立端点/模型/推理档位/并发与 Keychain keyRef，冷启动保留、点击即切换；正在运行的任务冻结配置，暂停或失败的任务可明确选择「用当前 API 继续」。旧单配置自动迁移。
- **战役引擎模块**：技能成长、冲突检定、关系与知识、记忆检索、分支回退及存档往返已有实现和核心回归；同伴/NPC 可依规则自动推进到玩家决策。玩家仍决定目标、撤退、关键物品支出、成长选择和谜题答案。
- **本地优先**：游戏状态全部存于设备 SQLite（`shineword.db`，schema 31）；分支持久隔离，导出存档按 SHA-256 引用世界资料。断网时本地确定性行动仍可结算；生成中断保留原行动与已完成检定，云端结果未知时由玩家确认重试。

## 版本管理

版本号、迭代规则与发版清单见 **[docs/VERSIONING.md](docs/VERSIONING.md)**：全仓库统一语义化版本 `MAJOR.MINOR.PATCH`，`versionCode = MAJOR×1,000,000 + MINOR×10,000 + PATCH×100 + BUILD`，`npm run verify:version` 强制六处一致（根/移动 package.json、lockfile、build.gradle、CHANGELOG、README）。完整变更记录见 **[CHANGELOG.md](CHANGELOG.md)**。构建标识：`versionName=0.8.1`，`versionCode=80100`。

## 安全与隐私

- **API Key 只存系统 Keychain**（`WHEN_UNLOCKED_THIS_DEVICE_ONLY`），SQLite/AsyncStorage 只存 keyRef。
- **API Key 结构性不可能进入备份**：导出时递归扫描禁入键（apikey/api_key/key/secret/token/authorization），命中即抛错。
- 无遥测、无云端依赖；唯一网络请求是用户配置的 LLM 端点。

## 构建与测试

环境要求：Node ≥ 24.3、JDK 17、Android SDK（compileSdk 36 / minSdk 24）。

```bash
# 核心验证（纯 TS 规则域 + Node 原生 SQLite 事务/恢复语义）
npm install
npm run verify:core

# 版本一致性门禁（升版本/发版前必跑）
npm run verify:version

# 移动端
npm install --prefix mobile
npm run typecheck --prefix mobile

# Debug APK（构建前自动生成 mobile/src/version.json）
npm run apk:debug --prefix mobile

# 签名 Release；使用本机配置的签名变量和 keystore，不把签名材料放进仓库
pwsh -File mobile/scripts/build-release-apk.ps1
```

APK 输出到 dist/apk/{debug|release}/，不入库。发版流程（签名校验、安装冒烟、tag 与 GitHub Release）按 [docs/VERSIONING.md](docs/VERSIONING.md) 第 4 节清单执行。

## 进度与评审

- 第六阶段：[FINAL_REPORT.md](docs/reviews/phase6/FINAL_REPORT.md)、[TEST_RESULTS.md](docs/reviews/phase6/TEST_RESULTS.md)、[验收矩阵](docs/reviews/phase6/ACCEPTANCE_MATRIX.md)

- LLM 基础设施专项（V0.4.0）：[docs/reviews/llm-memory/FINAL_REPORT.md](docs/reviews/llm-memory/FINAL_REPORT.md)
- 完整版本变更：[CHANGELOG.md](CHANGELOG.md)
- 项目建设进度（PROGRESS）：[docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md)
- 第四期验收：[docs/reviews/phase4/Q4_FINAL_REPORT.md](docs/reviews/phase4/Q4_FINAL_REPORT.md)、[设备矩阵](docs/reviews/phase4/Q4_DEVICE_MATRIX.md)
- 最终收尾验收：[docs/reviews/final-closeout/FINAL_REPORT.md](docs/reviews/final-closeout/FINAL_REPORT.md)
- 各阶段评审：[docs/reviews/](docs/reviews/)（一期～四期、llm-memory、世界构建恢复等专项）

## 参考底座

参考 [tavo-mini / ShineWriter](https://github.com/anjingdtl/tavo-mini) 已验证的 React Native 技术线、版本管理规范与部分模块设计。Shine-TRPG 使用独立应用、数据库、安全存储 namespace、存档格式与版本体系（`com.shineword.app`、`shineword.db`、`.shineword-*.json|zip` 等为兼容性内部标识，不随品牌更名变更）。

## 许可状态

仓库已公开，许可证仍待维护者正式确定。当前不提交第三方小说全文、规则书、私人存档、API Key、签名文件或构建产物。
