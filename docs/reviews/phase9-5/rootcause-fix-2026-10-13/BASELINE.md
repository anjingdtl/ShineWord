# Phase 9.5 根因修复复验基线

日期：2026-10-13（Asia/Shanghai）

## 源码、构建与设备

- 隔离工作树：`F:\sw95`
- 分支：`codex/phase9-5-final-pass-20261012`
- HEAD：`9416adfd07c901414618e0518b008de0060b9ec3`
- 最终生产源码身份（`tools/phase9-identity.cjs`）：`79c3bea6b13e06ee89530e806e42d245cccd87080004afb0f26c0addd249646e`
- Debug APK：`dist/apk/debug/ShineWord-V1.0.0-debug.apk`
- APK SHA-256：`51065228fa9fbc6c5421b288a396b5a7a6ca06414fb8f6332e6c9a977c5cf7cb`，110,058,579 字节。
- 包：`com.shineword.app`，版本 `1.0.0`，versionCode `1000000`。
- 最终设备安装：`emulator-5556`，AVD `ShineWord_P2_Clean`，Android 17 / API 37；设备 `base.apk` SHA 与 APK 相同。安装使用 `adb install -r`，没有清除应用数据。
- 工具链：Node `v24.14.1`、npm `11.14.1`、Temurin JDK `17.0.19`、Android SDK `C:\Users\Administrator\AppData\Local\Android\Sdk`。

最终构建前后的身份记录差异仅为 `mobile/src/version.json` 中自动更新的 `buildTime`。APK 字节 SHA 保持相同；代码只读取版本名和版本号。换行提示另记在 `git diff --check` 输出中，不作为玩法变化证据。

## 小说与导入材料

- 指定文件原始字节：7,178,905 字节，SHA-256 `7f45fe0b11ea30eca95f5a736232dd4c466a57c0f2cc9f67530e432015ecc6f4`。
- 严格 UTF-8 解码失败；GB18030 解码后可逐字节往返，GBK 解码也可逐字节往返。既有生产导入记录标为 `gbk`，未强制 UTF-8。
- 使用生产导入器的标题规则得到 1,503 个章节标题、`standard` 分段；生产数据库有 1,504 章（含开篇），范围从 code point 0 连续覆盖到 3,460,333，无间隙。
- 本轮复用同一 SHA 的既有正式导入世界；新建 QA 战役来自 save-10 正式导入，不重导全文、不向模型发送全文。公开材料不含小说正文、提示词或响应。

## Git 与保护边界

- 主工作树和隔离工作树起始 HEAD 均复核为 `9416adf`；本轮没有 commit、push、merge、发布或清理工作树。
- 旧 J1 `camp-mv3mw9hk-main` 仍为 v70，turn-0071 未重放。导入来源 `camp-mv5kpgrf-main` 的 v33 未修改；normal-preparation 回放从 v31 分叉。
- 最终安装前后，J1 与 v33 来源主分支的 branches、snapshots、turns、roll_records、branch_events 行数和行哈希完全一致。
- Android 数据库原始副本和层级 XML 只在被 `.gitignore` 忽略的 `test-logs/phase9-5-rootcause-fix-2026-10-13/private/`。

## 预算、未知请求与 CI

- 唯一作用域 `shineword-phase9-5-20261011`，硬上限 600；权威账本 510 spent / 510 completed / 0 ledger unknown or in-flight / 90 remaining。本轮真实 HTTP 派发为 0，账本起止均为 510。
- 应用数据库另有一个 J1 Narrator `outcome_unknown` attempt 未出现在 510 条 scoped audit 中。该记录未重发、未从冻结回合恢复；真实派发在对账完成前停止。
- 指定 GLM 配置读取到 endpoint `https://open.bigmodel.cn/api/coding/paas/v4`、model `glm-5.3-flash`、客户端 loopback `127.0.0.1:18591`。本轮没有启动代理或发送请求。
- GitHub Actions `Core Verify` 与 `Android Verify` 工作流存在；`gh run list` 对候选分支和 main 均返回 HTTP 401 `Bad credentials`，因此没有可核验的当前候选 CI 记录。

## 门禁结果

- `npm run verify:core`：exit 0，1305/1305。
- 指定七个 Phase 9/9.5 回归：exit 0，47/47。
- 根因反例：原始 RED 2 PASS / 4 FAIL；最终 6 PASS / 0 FAIL。
- `npm --prefix mobile run typecheck`、`npm run verify:version`、`npm run apk:debug`、`git diff --check`：均 exit 0。

总体验收仍未完全通过；分项状态见 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md)。
