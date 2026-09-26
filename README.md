# ShineWord

面向 Android 的 AI 互动小说跑团应用。

用户导入小说 TXT 后，ShineWord 将原著整理成带证据的世界资料；玩家可以扮演原著角色或原创角色，通过固定选项或自由行动推进自己的故事。LLM 负责主持与叙事，本地规则引擎负责资格、骰点、成长、状态与事务结算。

> 当前状态：**M0 / M1 开发中**。已经落地第一版确定性规则内核，尚未提供可运行 Android App 或 APK。

## 当前已实现

- ShineWord Ruleset V0.1：六属性、d4～d12 技能骰、1～4 颗骰取最高。
- 简单 3 / 一般 4 / 挑战 6 / 困难 8 / 极难 10 / 巅峰 12 难度。
- 精确成功率计算与四档结果等级。
- 行动资格预判：违反硬规则或缺少能力时不允许靠投骰“赌奇迹”。
- Action Contract v1 类型与 JSON Schema。
- Planner 不得写入随机值、骰池、最终结果等本地权威字段。
- Draft → Planned → AwaitRoll → Resolved → Narrated → Validated → Committed 回合状态机，以及 Repair / Paused 修复路径。
- 可注入随机源与 RollRecord 基础结构。
- 自动测试与 GitHub Actions 核心验证；CI 不上传 APK 或其他构建产物。

## 建设方案

完整基线见 [docs/CONSTRUCTION_PLAN.md](docs/CONSTRUCTION_PLAN.md)。

开发进度见 [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md)，底座审计见 [docs/M0_BASELINE_AUDIT.md](docs/M0_BASELINE_AUDIT.md)。

## 核心验证

```bash
npm install
npm run verify:core
```

目前领域层为纯 TypeScript，不依赖 React、网络或数据库。这样可以先验证规则、概率和状态机，再接入 Android UI、SQLite 与 LLM。

## 参考底座

参考 [tavo-mini / ShineWriter](https://github.com/anjingdtl/tavo-mini) 已验证的 React Native 技术线和部分模块设计。ShineWord 使用独立应用、数据库、安全存储 namespace、存档格式与版本体系。

## 许可状态

仓库已公开，许可证仍待维护者正式确定。当前不提交第三方小说全文、规则书、私人存档、API Key、签名文件或构建产物。
