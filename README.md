# Shine-TRPG

面向 Android 的 AI 驱动互动小说 TRPG（**Alpha；二阶段仍在验收，第三期建设中**）。

用户导入小说 TXT 后，Shine-TRPG 将原著整理成带证据的世界资料；玩家可以扮演原著角色或原创角色，通过固定选项或自由行动推进自己的故事。LLM 负责主持与叙事，本地规则引擎负责资格、骰点、成长、状态与事务结算。

> 当前状态：一期 M0～M5 已完成；二阶段 P2-0～P2-6 尚未全部达到出口，不能视作 Beta 或完整交付。最新逐项状态、设备/模型证据和剩余条件见 [R6 验收报告](docs/reviews/P2_ACCEPTANCE_CLOSEOUT_R6.md)。仅支持 Android；LLM 由用户自行配置 OpenAI-compatible 端点。

## 核心特性

- **确定性骰点**：Shine-TRPG Ruleset V0.1——六属性、d4～d12 技能骰、1～4 颗骰取最高、四档结果等级。骰点由本地引擎用 Android SecureRandom 拒绝采样完成，先持久化 RollRecord 再调用叙事模型；Narrator 失败或重启后复用同一骰点，永不重掷。
- **TXT 原著导入**：编码探测（UTF-8/GBK）、标准分章、码点偏移体系。历史桌面 Node 基准不代表 Android 端性能；二阶段的真实模型召回、独立人工标注和端上大文件性能仍待验。LLM 只产出 verbatim 引文，本地解析偏移并检查证据位置。
- **LLM 权限边界**：Planner 只能提出行动合同（ActionContract JSON），本地校验器严格把关（禁止骰点/结果/数值等权威字段，畸形合同干净拒绝）；Narrator 不得更改冻结的结果等级。
- **战役引擎模块**：技能成长（5/10/20/40 练习点阈值）、叙事战斗（距离带/先攻/伤害）、关系与知识、记忆检索、分支回退及存档往返已有实现和核心回归；完整 Android 冒险、同伴生命周期与 Beta 验收仍有未结项。
- **本地优先**：游戏状态全部存于设备 SQLite（`shineword.db`）；分支持久隔离，导出存档按 SHA-256 引用世界资料。断网时确定性行动仍可结算，恢复后无缝衔接。

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

# 移动端
npm install --prefix mobile
npm run typecheck --prefix mobile

# Debug APK
npm run apk:debug --prefix mobile

# 签名 Release；使用本机配置的签名变量和 keystore，不把签名材料放进仓库
pwsh -File mobile/scripts/build-release-apk.ps1
```

APK 输出到 dist/apk/{debug|release}/，不入库。本地已构建并签名验证 p2.9；该包在 API 37.1 隔离模拟器上断网冷启动成功。此证据只覆盖 Release bundle 启动，未覆盖完整冒险或 API 24/真机矩阵。签名、哈希和源码对应信息见 R6 报告。

## 进度与评审

- 开发进度：[docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md)
- 第三期建设基线：[docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md](docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md)
- 二阶段建设基线：[docs/PHASE2_CONSTRUCTION_PLAN.md](docs/PHASE2_CONSTRUCTION_PLAN.md)
- 最新二阶段验收：[docs/reviews/P2_ACCEPTANCE_CLOSEOUT_R6.md](docs/reviews/P2_ACCEPTANCE_CLOSEOUT_R6.md)
- 一期建设基线：[docs/CONSTRUCTION_PLAN.md](docs/CONSTRUCTION_PLAN.md)
- 各阶段评审：[docs/reviews/](docs/reviews/)（M1～M5 与最终回归）

## 参考底座

参考 [tavo-mini / ShineWriter](https://github.com/anjingdtl/tavo-mini) 已验证的 React Native 技术线和部分模块设计。Shine-TRPG 使用独立应用、数据库、安全存储 namespace、存档格式与版本体系（`com.shineword.app`、`shineword.db`、`.shineword-*.json|zip` 等为兼容性内部标识，不随品牌更名变更）。

## 许可状态

仓库已公开，许可证仍待维护者正式确定。当前不提交第三方小说全文、规则书、私人存档、API Key、签名文件或构建产物。
