# ShineWord (Shine-TRPG) 工作区须知

面向 Android 的确定性互动小说 TRPG：本地规则引擎负责资格/骰点/成长/状态/事务结算，LLM（Planner/Narrator）只能在本地边界内提出 ActionContract 与叙事。本文件只记录仓库里不易一眼看出的约束；细节以 `README.md`、`docs/VERSIONING.md`、`progress.md` 为准。

## 结构与边界

- `src/` — 纯 TypeScript 确定性核心（CommonJS，strict，编译到 `dist/`）。分层：
  - `src/domain/` — 纯规则，**禁止任何 I/O**；
  - `src/application/` — 用例与服务（worldBuild、turns、campaign、llm、memory 等）；
  - `src/infra/` — memory / sqlite 适配器；
  - `src/platform/` — 随机数抽象（设备端用 SecureRandom 拒绝采样）。
- `mobile/` — React Native 0.85 Android 应用（`com.shineword.app`，minSdk 24 / compileSdk 36）。**直接以源码方式消费 `../src`**（metro `watchFolders` + tsconfig include），不走 npm 包也不走 `dist/`——改核心代码会立即影响 mobile typecheck。
- `tests/` — `.test.cjs`（`node:test` + 内置 `node:sqlite`），**import 的是编译产物 `../dist/`**，跑测试前必须先 build（`npm test` 已内置 build:core）。
- `migrations/`（SQL 文件）之外，生产基线在 `src/infra/sqlite/builtinMigrations.ts`，单基线 version 101（`phase9_campaign_baseline`）；旧库/不完整库显式拒绝，**禁止静默修复**。
- `docs/` — 各阶段施工方案（`Shine-TRPG_PHASE*_PLAN.md`）与 agent prompt；`docs/reviews/`（含各 phase 的 HANDOFF_*.md 交接文档）是阶段验收状态的唯一事实来源。`progress.md`（根目录）跟踪当前轮次 R0→R9 状态。**README 里的版本能力说明 ≠ 整阶段验收通过**。
- `tools/`、`scripts/` — phase9/9.5 离线 harness 与真实 GLM 长程脚本（`real-glm-*.cjs`、`phase9-*.cjs`）。

## 常用命令（门禁）

```bash
npm run verify:core      # typecheck + build + 全量测试（核心主门禁，~1334 项）
npm run verify:version   # 版本一致性门禁（六处必须一致）
npm run typecheck --prefix mobile   # mobile 类型检查（需先 npm install --prefix mobile）
npm run apk:debug        # Debug APK → dist/apk/debug/（构建前自动生成 mobile/src/version.json）
pwsh -File mobile/scripts/build-release-apk.ps1   # 签名 Release，需本机 SHINE_WRITER_RELEASE_* 变量与 keystore
```

环境：Node ≥ 24.3（测试依赖内置 node:sqlite）、JDK 17、Android SDK。CI（`.github/workflows/`）：core-verify 跑 `verify:core`+`verify:version`；android-verify 跑 mobile typecheck + `:app:assembleDebug`。

## 版本规则（改版本必读 docs/VERSIONING.md）

- 全仓库单一 semver，六处一致：根/mobile `package.json`、mobile lockfile、`build.gradle`、`CHANGELOG.md`、`README.md`。
- `versionCode = MAJOR×1,000,000 + MINOR×10,000 + PATCH×100 + BUILD`，严格单调递增。
- 存档/DB 不兼容、ActionContract 协议主版本 → 升 MAJOR；新能力 → MINOR；修复打磨 → PATCH。升版本必须同步 CHANGELOG + README 并跑 `verify:version`。

## 硬性约束（安全与产品规则）

- **API Key 只存系统 Keychain**（WHEN_UNLOCKED_THIS_DEVICE_ONLY）；SQLite/AsyncStorage 只存 keyRef；导出/日志/备份递归扫描禁入键，命中即抛错。任何地方不得打印、提交、外发 Key。
- **物理请求账本**：强杀后 `outcome_unknown` 的请求**禁止自动重放**（防重复计费），必须由玩家/用户显式确认。
- **骰点先持久化 RollRecord 再调叙事模型**；Narrator 失败或重启复用同一骰点，永不重掷。LLM 合同禁止携带骰点/结果/数值等权威字段，畸形合同干净拒绝。
- 不提交：第三方小说全文、规则书、私人存档、API Key、签名材料、APK/构建产物、`test-logs/`。`.gitignore` 已挡 `*.txt`（`tests/fixtures/**/*.txt` 除外）；测试用小说（常为 GB18030 编码）与真实测试密钥由用户提供本地路径，**绝不入库**。
- 真机/模拟器 QA：ShineQA AVD（`emulator-5554`）；用 `adb install -r` 同签名升级，**不卸载、不清数据**。

## 惯例与坑

- 真实模型长程测试走 `tools/` 下 harness；GLM 端点非流式请求约 300s 会被网关杀掉，**长请求必须走流式**。
- 真实 GLM/外部验证脚本产物写到 `test-logs/` 等临时目录，不污染根目录。
- commit 用 conventional commits 带阶段 scope（如 `feat(phase9.5): …`、`chore(mobile): …`）；直接提交到 main 前确认与 progress.md/交接文档描述一致。
- `dist/` 是编译产物（不入库）；根 `dist/apk/` 放 APK 产物，同样不入库。
- 改动敏感区域（存档协议 save-10、DB 基线 101、请求预算/账本、canon 采用）前，先读对应阶段的 HANDOFF 文档与施工方案；phase9/9.5 验收遗留分箱见 `progress.md` 与 `docs/reviews/phase9-5/`。
