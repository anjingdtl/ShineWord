# ShineWord

面向 Android 的 AI 互动小说跑团应用（**Alpha**）。

用户导入小说 TXT 后，ShineWord 将原著整理成带证据的世界资料；玩家可以扮演原著角色或原创角色，通过固定选项或自由行动推进自己的故事。LLM 负责主持与叙事，本地规则引擎负责资格、骰点、成长、状态与事务结算。

> 当前状态：**Alpha（M0～M5 全部完成）**。仅支持 Android；LLM 由用户自行配置（任何 OpenAI-compatible 端点）。

## 核心特性

- **确定性骰点**：ShineWord Ruleset V0.1——六属性、d4～d12 技能骰、1～4 颗骰取最高、四档结果等级。骰点由本地引擎用 Android SecureRandom 拒绝采样完成，先持久化 RollRecord 再调用叙事模型；Narrator 失败或重启后复用同一骰点，永不重掷。
- **TXT 原著导入**：编码探测（UTF-8/GBK）、标准分章、码点偏移体系；100 万字 300 章实测导入 114ms。LLM 只产出 verbatim 引文，本地解析偏移并强制证据校验——事实的原文定位 100% 可追溯。
- **LLM 权限边界**：Planner 只能提出行动合同（ActionContract JSON），本地校验器严格把关（禁止骰点/结果/数值等权威字段，畸形合同干净拒绝）；Narrator 不得更改冻结的结果等级。
- **完整游戏系统**：技能成长（5/10/20/40 练习点阈值）、叙事战斗（距离带/先攻/伤害/结局枚举）、关系与知识、记忆检索（可见性→时间窗→状态有效性→分支→相关度的强制顺序）、分支 fork/rewind、`.shineword-save.json` 导出。
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
cd mobile && npm install
npx tsc -p tsconfig.json --noEmit

# APK（Gradle 9.3.1；wrapper 未入库时用本机 Gradle）
gradle -p mobile/android :app:assembleDebug
# Release 需本地 keystore + SHINEWORD_RELEASE_STORE_PASS / SHINEWORD_RELEASE_KEY_PASS
```

构建产物交付路径：`dist/apk/{debug|release}/ShineWord-V<ver>-{debug|release}.apk`（不入库）。

## 进度与评审

- 开发进度：[docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md)
- 建设基线：[docs/CONSTRUCTION_PLAN.md](docs/CONSTRUCTION_PLAN.md)
- 各阶段评审：[docs/reviews/](docs/reviews/)（M1～M5 与最终回归）

## 参考底座

参考 [tavo-mini / ShineWriter](https://github.com/anjingdtl/tavo-mini) 已验证的 React Native 技术线和部分模块设计。ShineWord 使用独立应用、数据库、安全存储 namespace、存档格式与版本体系。

## 许可状态

仓库已公开，许可证仍待维护者正式确定。当前不提交第三方小说全文、规则书、私人存档、API Key、签名文件或构建产物。
