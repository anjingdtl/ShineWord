# Android 验收执行记录

测试日期：2026-10-01（Asia/Shanghai）。基线：`0adadcd`，V0.4.1。

| 模块 | 状态 | 结果与证据 |
| --- | --- | --- |
| M0 | 通过（已修复） | 577/577 核心回归，移动类型与版本门禁通过；独立 debug APK 安装、冷启动与重启通过，v2 签名有效 |
| M1 | 待执行 | |
| M2 | 待执行 | |
| M3 | 待执行 | |
| M4 | 待执行 | |
| M5 | 待执行 | |
| M6 | 待执行 | |

完整范围与通过条件见 [TEST_PLAN.md](TEST_PLAN.md)。

## M0 构建与启动

- 设备：`emulator-5556`，ShineWord_P2_Clean 临时只读实例，Android 17 / API 37.1，x86_64，1080×2400 / 420dpi。
- 原 debug APK（91.76 MiB）安装后显示 `Unable to load script`。原因：debug 被列为 `debuggableVariants`，Gradle 跳过 JS bundle，无法脱离 Metro 启动。
- 修复：`apk:debug` 指定 `shinewordStandaloneDebug=true`，嵌入 Hermes bundle 并关闭该构建的 Metro 支持；普通 `run-android` 保留开发服务器流程。打包脚本新增 bundle 存在性检查。
- 修复后 APK：`dist/apk/debug/ShineWord-V0.4.1-debug.apk`，97.54 MiB，包名 `com.shineword.app`，versionCode 40100，一名签署者，v2 验签通过。
- 未启动 Metro、无 adb reverse；冷启动实际进入首次模型配置页，再次强停启动也成功。首次 Activity 启动耗时 1,983ms（不等同于全部 JS UI 首帧耗时）。截图：[M0_FIRST_RUN.png](M0_FIRST_RUN.png)。
- 构建环境阻滞：JDK 在默认 Windows 短路径 TEMP 中创建 Unix-domain socket 时失败；指定本次进程 `jdk.net.unixdomain.tmpdir=C:\Temp\shineword-qa` 后 Selector 探针与 Gradle 均成功，操作见构建文档。
- 原始证据：本地目录中的 `build-debug.log`、`build-debug-fixed.log`、`m0-baseline-block.xml`、`m0-cold-restart.xml`。
