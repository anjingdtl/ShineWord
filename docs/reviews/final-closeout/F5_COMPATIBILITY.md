# F5 — 兼容性与设备矩阵

**阶段：** F5（设备矩阵、升级兼容）
**分支：** `feature/final-acceptance-closeout`
**日期：** 2026-09-29（Asia/Shanghai）

## 0. 结论先行

| 验收项 | 本轮结论 |
|---|---|
| Android 最新测试设备（现有 API 37.1 AVD） | **BLOCKED（无设备）** |
| 最低版本 API 24 emulator | **NOT TESTED / 外部环境缺口（无系统镜像）** |
| Android 15 / 16 | **NOT TESTED（无对应设备）** |
| F5.1 升级兼容（`adb install -r` 不清数据） | **BLOCKED（无设备）** |
| 旧存档 / 世界包格式兼容 | **代码级 PASS**；设备 NOT TESTED |

## 1. 环境事实

- `adb` 与 `emulator` 二进制均不存在；`/dev/kvm` 不存在（[F0 §5](F0_BASELINE.md#5-设备与模型可用性)）。
- SDK 已装平台仅 `android-36`；**无任何 system-images** → 无法创建 API 24 或任何 API 级别的 AVD。
- 工程 `minSdkVersion = 24`、`targetSdkVersion = 36`、`compileSdkVersion = 36`。

因此：安装、冷启动、Profile、Library、Opening、Play、基础存档、前台服务/通知/Doze/锁屏恢复 —— 全部 **BLOCKED / NOT TESTED**。

## 2. API 24 —— 如实记为外部环境缺口

按 §三十要求：**如果当前 SDK 环境无法创建 API 24，如实记录为外部环境缺口，不要伪造通过。**

- 现状：无 API 24 系统镜像，无法启动 API 24 模拟器。
- 结论：**NOT TESTED（外部环境缺口）**。需外部补齐：`sdkmanager "system-images;android-24;google_apis;x86_64"` 及可运行模拟器宿主。

## 3. Android 15 / 16

- 无 Android 15/16 设备或镜像。
- 现状唯一可用设备基线（历史 G5，非本轮）为 API 37.1 AVD，**不得**用 API 37 冒充 Android 15/16 真机（§三十）。
- 结论：**NOT TESTED**。需外部补齐对应镜像/真机后验证前台服务、通知、后台、Doze、screen off/on。

## 4. F5.1 升级兼容（代码级）

- 旧格式兼容由核心回归覆盖：`.shineword-save.json`、`.shineword-world.zip` 的导出/导入与迁移（[progressive-opening.test.cjs](file:///workspace/tests/progressive-opening.test.cjs) 的 migration-14 用例、[closeout-c6.test.cjs](file:///workspace/tests/closeout-c6.test.cjs) 等）。
- 设备端 `adb install -r` 不清数据、旧 Library/World/Campaign/Profile/save/world package 可见并可用 —— **BLOCKED（无设备）**。
- 历史参考（非本轮）：v14→v15 模拟器原位升级后旧库记录仍可读（[G5](../progressive-opening/G5.md)）。

## 5. 关闭条件

- 可用 Android 宿主（含 `/dev/kvm` 或真机）与至少一个 AVD。
- `system-images;android-24;...`（最低版本）与 Android 15/16 镜像或真机。
- 具备后按 §三十～三十一执行，并记录安装/冷启动/升级命令与结果。

**禁止**：`pm clear` 用户已有 AVD、`-wipe-data` 清除已有测试设备。