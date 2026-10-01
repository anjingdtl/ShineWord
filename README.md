# Shine-TRPG

[![Version](https://img.shields.io/badge/Version-V0.4.2-blue.svg)](CHANGELOG.md)
[![Author](https://img.shields.io/badge/作者-ShineHe-orange.svg)](docs/VERSIONING.md)

面向 Android 的轻量文字 TRPG：玩家读故事、点文字行动或输入自己的意图；本地规则确定检定与状态，模型负责受限提案和叙事。作者：**ShineHe**。

用户导入小说 TXT 后，Shine-TRPG 将原著整理成带证据的世界资料；玩家可以扮演原著角色或原创角色，通过简短文字选择或明确提交的自由行动推进故事。调查、关系日常、探索和冲突共用文字入口。LLM 只能在本地规则给定的边界内提出行动结构与叙事；本地引擎负责资格、骰点、成长、状态与事务结算。

> 当前版本：**V0.4.2** · versionCode 40200。本版本修复 Android 启动、模型设置、世界冲突审查、故事时间与阅读跟随、存档及强停恢复、返回页面累积问题。指定 GLM 与完整《白篱梦》已在本机模拟器完成 16 个真实回合，覆盖 Low / High / Max、存档、断网与强停恢复；588 项核心回归通过。范围和限制见 [Android 验收报告](docs/reviews/android-qa-20261001/TEST_RESULTS.md)，正式产物见 [V0.4.2 发版记录](docs/releases/V0.4.2.md)。仅支持 Android；LLM 由用户自行配置 OpenAI-compatible 端点。

DeepSeek V4.1 Flash 内置预设使用官方请求 ID `deepseek-flash`（上下文 1,048,576，最大输出 393,216；[官方模型列表](https://api-docs.deepseek.com/api/list-models/)）。设置页 Planner 预算预览复用真实 Request Budget Kernel，是未计入实际回合必需协议输入的估算。此轮 Hotfix 的自动化验收与限制见 [HOTFIX_FINAL.md](docs/reviews/reasoning-closeout/HOTFIX_FINAL.md)；DeepSeek 真实 API 未测试。

## 核心特性

- **确定性骰点**：Shine-TRPG Ruleset V0.1——六属性、d4～d12 技能骰、1～4 颗骰取最高、四档结果等级。骰点由本地引擎用 Android SecureRandom 拒绝采样完成，先持久化 RollRecord 再调用叙事模型；Narrator 失败或重启后复用同一骰点，永不重掷。
- **TXT 原著导入**：编码探测（UTF-8/GBK）、标准分章、码点偏移体系。LLM 只产出 verbatim 引文，本地解析偏移并检查证据位置；长篇压力实测 2469 章 / 760 万码点导入 1.5s（桌面 Node 基准）。
- **LLM 权限边界**：Planner 只能提出行动合同（ActionContract JSON），本地校验器严格把关（禁止骰点/结果/数值等权威字段，畸形合同干净拒绝）；Narrator 不得更改冻结的结果等级。
- **统一 LLM 基础设施**（V0.4.0–V0.4.1）：模型能力来源治理（不再伪造 128K）、Low/High/Max 推理策略与预算联动、Soft/Burst/Hard 弹性请求预算、六 Board 弹性回合上下文（Planner/Narrator 分离）、结构化 JSON 管线、物理请求账本（强杀后 outcome_unknown 防重复计费）、Story Memory V2 长期叙事记忆与完全本地 Episodic 召回。
- **战役引擎模块**：技能成长、冲突检定、关系与知识、记忆检索、分支回退及存档往返已有实现和核心回归；同伴/NPC 可依规则自动推进到玩家决策。玩家仍决定目标、撤退、关键物品支出、成长选择和谜题答案。
- **本地优先**：游戏状态全部存于设备 SQLite（`shineword.db`，schema 26）；分支持久隔离，导出存档按 SHA-256 引用世界资料。断网时本地确定性行动仍可结算；生成中断保留原行动与已完成检定，云端结果未知时由玩家确认重试。

## 版本管理

版本号、迭代规则与发版清单见 **[docs/VERSIONING.md](docs/VERSIONING.md)**：全仓库统一语义化版本 `MAJOR.MINOR.PATCH`，`versionCode = MAJOR×1,000,000 + MINOR×10,000 + PATCH×100 + BUILD`，`npm run verify:version` 强制六处一致（根/移动 package.json、lockfile、build.gradle、CHANGELOG、README）。完整变更记录见 **[CHANGELOG.md](CHANGELOG.md)**。构建标识：`versionName=0.4.2`，`versionCode=40200`。

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

- LLM 基础设施专项（V0.4.0）：[docs/reviews/llm-memory/FINAL_REPORT.md](docs/reviews/llm-memory/FINAL_REPORT.md)
- 完整版本变更：[CHANGELOG.md](CHANGELOG.md)
- 项目建设进度（PROGRESS）：[docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md)
- 第四期验收：[docs/reviews/phase4/Q4_FINAL_REPORT.md](docs/reviews/phase4/Q4_FINAL_REPORT.md)、[设备矩阵](docs/reviews/phase4/Q4_DEVICE_MATRIX.md)
- 最终收尾验收：[docs/reviews/final-closeout/FINAL_REPORT.md](docs/reviews/final-closeout/FINAL_REPORT.md)
- 各阶段评审：[docs/reviews/](docs/reviews/)（一期～四期与 llm-memory 专项）

## 参考底座

参考 [tavo-mini / ShineWriter](https://github.com/anjingdtl/tavo-mini) 已验证的 React Native 技术线、版本管理规范与部分模块设计。Shine-TRPG 使用独立应用、数据库、安全存储 namespace、存档格式与版本体系（`com.shineword.app`、`shineword.db`、`.shineword-*.json|zip` 等为兼容性内部标识，不随品牌更名变更）。

## 许可状态

仓库已公开，许可证仍待维护者正式确定。当前不提交第三方小说全文、规则书、私人存档、API Key、签名文件或构建产物。
