# F0 — 最终收尾基线冻结

**阶段：** F0（重新冻结最终收尾基线）
**分支：** `feature/final-acceptance-closeout`
**日期：** 2026-09-29（Asia/Shanghai）

本文件只记录**本轮开工时的真实观测值**。任何数字如无对应命令输出，不写入本表。

## 1. 代码基线

| 项 | 值 |
|---|---|
| 远端仓库 | `https://github.com/anjingdtl/ShineWord` |
| 冻结 main HEAD | `6c1bc790f64f8e13e27340f768e0fad6fd923673` |
| 该 HEAD commit | `release(progressive): record v15 verification` |
| 施工分支 | `feature/final-acceptance-closeout`（自 main HEAD 创建） |
| 工作区 | 干净检出后开工；本分支承载本轮改动 |

开工时 `git fetch --all --prune` 已执行，`origin/main` 仍指向 `6c1bc79`，未前进。

## 2. 版本

| 项 | 值 | 来源 |
|---|---|---|
| `mobile/package.json` version | `0.3.0-progressive.1` | package.json |
| `applicationId` | `com.shineword.app` | `mobile/android/app/build.gradle` |
| `versionCode` | `15` | 同上 |
| `versionName` | `0.3.0-progressive.1` | 同上 |
| 用户可见品牌 | Shine-TRPG | — |

## 3. 工具链（沙箱实测）

| 项 | 实测值 | 备注 |
|---|---|---|
| Node | `v24.1.0` | `package.json` engines 要求 `>=24.3.0`，安装时出现 `EBADENGINE` 警告；核心回归仍全部通过 |
| npm | `11.4.2` | — |
| 默认 Java | `25.0.2`（mise `JAVA_HOME`） | **构建 APK 不可用**，见 §4 |
| Gradle | `9.3.1`（wrapper） | 与 CI 一致 |
| Android SDK | `/opt/android-sdk` | `ANDROID_HOME`/`ANDROID_SDK_ROOT` 环境变量为空，需显式注入 |
| SDK Platforms | `android-36` | — |
| Build-tools | `35.0.0`, `36.0.0` | — |
| NDK | `27.1.12297006` | — |
| 可用 JDK（mise） | `8`, `11.0.2`, `17.0.2`, `25.0.2` | APK 需 Java 17 |

### 4. Java 25 阻断与修复（本轮环境发现）

- 现象：以默认 `JAVA_HOME`（Java 25.0.2）运行 `./gradlew assembleDebug` 失败：
  `Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field 'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'`（Gradle 9.x 已移除该字段，Java 25 工具链解析路径触发）。
- 修复：显式使用 Java 17.0.2（`JAVA_HOME=~/.local/share/mise/installs/java/17.0.2`），与 CI `actions/setup-java@v4` 的 `temurin 17` 对齐。
- 结论：这是**环境**问题，非工程缺陷；CI 不受影响（CI 固定 Java 17）。

## 5. 设备与模型可用性

| 能力 | 实测 | 结论 |
|---|---|---|
| `adb` 二进制 | 不存在 | 无法连接/安装/驱动设备 |
| `emulator` 二进制 | 不存在 | 无法启动 AVD |
| `/dev/kvm` | 不存在 | 无硬件加速，无法运行模拟器 |
| 既有 AVD | 无 | 沙箱内无任何可用测试设备 |
| 配置的模型 Profile | 无 | 沙箱内无 API Key / 端点，无法调用真实模型 |

> **直接后果：** F1 设备截图、F1.3 键盘/SafeArea 实测、F1.4 长列表、F2 全设备旅程、F3 真实端点闭环、F4 十回合设备验收、F5 设备矩阵在本沙箱内**无法执行**，将如实标注 `NOT TESTED / BLOCKED`，不得伪造。可在无设备条件下完成的**代码级**验收（对比度、触控面、单元/集成回归、构建门禁、CI）照常执行并取证。

## 6. 本地工程门禁（开工基线，沙箱实测）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 依赖安装 | `npm install` | up to date, 0 vulnerabilities |
| 核心验证 | `npm run verify:core` | **PASS** — 224 passed / 0 failed（`node --test tests/*.test.cjs`） |
| 移动端类型检查 | `npm run typecheck --prefix mobile` | **PASS**（EXIT=0，无输出即无错误） |
| Debug APK | `bash mobile/android/gradlew -p mobile/android :app:assembleDebug` | 见 §7 |
| 空白差异检查 | `git diff --check` | PASS |

核心回归在**本轮代码改动之后**复跑（含新增 NPC 投影用例），结果见 [F6](../DEVELOPMENT_STATUS.md) 与 FINAL_REPORT。

## 7. Debug APK 构建

- 首次以 Java 25 失败（§4），切 Java 17 + `ANDROID_HOME=/opt/android-sdk` 后进入 native（CMake/NDK）编译。
- 构建结果、产物路径与体积记入 [F2_P3_P4_DEVICE_JOURNEY.md](F2_P3_P4_DEVICE_JOURNEY.md) 或 FINAL_REPORT；未成功前不在此处声明通过。

## 8. 远端 CI 基线（最新 main 运行）

| 工作流 | run id | HEAD | conclusion | URL |
|---|---|---|---|---|
| Core Verify | `36495035813` | `6c1bc79` | **success** | https://github.com/anjingdtl/ShineWord/actions/runs/36495035813 |
| Android Verify | `36495036387` | `6c1bc79` | **success** | https://github.com/anjingdtl/ShineWord/actions/runs/36495036387 |

（更早 `fe2ff3ab…` 的一次 Android Verify 为 `failure`，其后 `bb990af7…` / `6c1bc79…` 已恢复绿；历史失败不作为本轮基线。）

## 9. 冻结边界（本轮禁止触碰的稳定契约）

规则域写路径、骰点算法、成长阈值、ActionContract 权威语义、RollRecord 确定性、`applicationId`、`shineword.db`、存档 schema、`.shineword-save.json`、`.shineword-world.zip`、既有世界包内容 —— 全部保持只读。本轮任何改动都必须能回答「它关闭了哪个验收缺口」。