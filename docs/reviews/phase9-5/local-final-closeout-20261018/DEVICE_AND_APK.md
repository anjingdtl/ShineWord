# M1：Android 设备与 APK

日期：2026-10-18（Asia/Shanghai）
工作分支：`fix/phase95-local-final-closeout-20261018-short`
工作树：`F:\sw95local-20261018`

## 当前构建身份

- Debug APK：`F:\sw95local-20261018\dist\apk\debug\ShineWord-V1.0.0-debug.apk`
- 包名 `com.shineword.app`，versionName `1.0.0`，versionCode `1000000`，minSdk `24`，targetSdk `36`，x86_64。
- 本地构建物 SHA-256：`C5B27FAEAAF8B1DF60946A8B826952DC4C1EC77A3AB4EA3BC26072FDFA26AF10`。
- 模拟器 `/data/app/.../base.apk` 拉取后 SHA-256 完全相同。使用 `adb install -r`，没有清除应用数据。

## 专用设备

- AVD `ShineWord_Phase95_LocalFinal_20261018`，设备 serial `emulator-5556`，API 37 / Android 17 / `sdk_gphone16k_x86_64` / 1080×2400 @420 dpi。
- 当前安装包通过 SAF 导入的真实 GBK 小说项目可见，partial world package `ready` 并能启动战役。
- 两个 campaign branch 均由当前安装 APK 创建并写入本地 SQLite；真实 GLM 开局建议、campaign planning、Planner 和 Narrator 有物理账本记录。
- 最后一局 Runtime `failed` 后，设备 UI 显示终局；hierarchy 中 `guidance-submit-*` 数量为 0、观察 action 数量为 0、composer disabled。它是 `SW95-M3-02` 安装后的设备 GREEN 证据。
- 最终带有生成剧情的截图仅保存在本机 `C:\Temp\shineword-phase95-local-final\after-plans.png`，SHA-256 `7E8DE69217CB96A843B3B6D5E69AFEAC3832DE4731201C1145DD2C28CC2A3F4D`，未加入 Git。仓库内的开局身份截图仅展示空姓名控件与默认身份，不含小说正文或模型剧情。

## UI 与数据保全

- 书库、小说世界项目页、角色/战役开局、行动提交、结果/掷骰和终局回归在当前 APK 上完成。
- Gboard 首次弹出系统手写教程；取消教程后通过键盘菜单显式启用屏幕键盘，随后输入可正常工作。这是模拟器键盘初始设置，不作为应用缺陷。
- APK 更新通过 `install -r` 保留 SQLite、小说源、GLM Keychain 配置及故障项目；没有卸载、清库或重建模拟器。
- 单独的 SQLite 快照在本机只读分析，`PRAGMA integrity_check=ok`；快照包含本地剧情与测试状态，不提交。
- AVD 当前停在终局页供查看。原始工作树和其他 AVD 未被启动、清除或改写。

## 工具链与边界

- Node.js `v24.14.1`、npm `11.14.1`、Temurin JDK `17.0.19.10`、Gradle wrapper `9.3.1`、ADB `37.0.0-14910828`。
- 长路径原 checkout 曾触发 Windows CMake path-length 问题；短路径隔离 worktree 构建成功，没有调整工程路径配置绕过它。
- 当前结果证明 APK 构建、安装、启动和代理 QA 旅程；不能替代 TalkBack、多尺寸设备、真人决定或独立试玩。
