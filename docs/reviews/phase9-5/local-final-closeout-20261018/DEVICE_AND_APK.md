# M1：Android 设备与 APK

日期：2026-10-18（Asia/Shanghai）
工作分支：`fix/phase95-local-final-closeout-20261018-short`
M0 基线提交：`c821f65906f0d2445bbfcb7a588ec88ea5495d66`

## 构建与工具链

- Node.js `v24.14.1`、npm `11.14.1`、Temurin JDK `17.0.19.10`、Gradle `9.3.1`、ADB `37.0.0-14910828`、Maestro `2.8.0`。
- 根目录 `npm ci --ignore-scripts --no-audit --no-fund` 成功。
- `npm run verify:core` 成功：1,342 项通过，0 失败，0 跳过；`npm run verify:version` 成功。
- `npm --prefix mobile ci --no-audit --no-fund` 与 `npm --prefix mobile run typecheck` 成功。
- 在短路径 checkout `F:\sw95local-20261018` 执行 `npm --prefix mobile run apk:debug` 成功（约 2 分 13 秒）。构建生成的 `mobile/src/version.json` 时间戳改动已在本工作树恢复，未提交构建副产物。

## APK 身份

- APK：`F:\sw95local-20261018\dist\apk\debug\ShineWord-V1.0.0-debug.apk`
- SHA-256：`BFDC5A5AE51B3C882C5FC304B2EFDFEBD179CEFE90918AE67FEB6478E0E5822D`
- 包名：`com.shineword.app`；versionName `1.0.0`；versionCode `1000000`；minSdk `24`；targetSdk `36`。
- 已安装 APK 的设备端 SHA-256 与构建产物一致（`bfdc5a5a…e0e5822d`）。
- 独立 debug APK 内含 JS bundle，不依赖 Metro；首次启动进入 ShineWord 书库页，未观察到 fatal exception。

## 专用设备

- AVD：`ShineWord_Phase95_LocalFinal_20261018`，`emulator-5554`，API 37 / Android 17，`sdk_gphone16k_x86_64`，1080×2400 @ 420 dpi。
- 仅新建并使用这台专用 AVD；既有模拟器未清除、未改写。应用数据库、小说导入和 Keychain 数据都保留在该测试 AVD；旧本地 429 项目保留作隔离故障现场。
- 安装、启动和书库/战役/我的页面导航已在设备上验证。环境变量输入烟测只向搜索框输入无敏感标记并成功清除。
- 本机 UI 截图位于 `F:\avd` 私有证据目录；没有把含小说正文或模型响应的截图加入 Git。

## 环境备注

- 长路径 checkout 的一次 Android CMake 构建受到 Windows 路径长度限制；改在 `F:\sw95local-20261018` 短路径 checkout 后，独立 APK 构建及安装均成功。未通过修改工程路径配置绕过限制。
- 本节点证明 APK 可构建、安装、冷启动和基本导航；小说/真实模型、可玩战役、性能与独立玩家验收分别记录在后续节点，不由本节点替代。

## M6 修复后的 APK 与模拟器复测

- 当前修复分支再次执行 `npm run apk:debug` 成功，Gradle assembleDebug 成功（33 秒）；APK 为 `F:\sw95local-20261018\dist\apk\debug\ShineWord-V1.0.0-debug.apk`，SHA-256 `B42AAE7C176D80A49B9C7605375F6B93332FB53405F522291798290B1F1F5843`。
- 使用 `adb install -r` 安装到原专用 AVD，保留 SQLite、小说源与已有 Keychain 数据。从设备 pm path 拉取已安装 base.apk，SHA-256 与构建 APK 完全一致。包名 `com.shineword.app`，versionName `1.0.0`，versionCode `1000000`，minSdk 24，targetSdk 36，ABI x86_64。
- 复测书库、项目页和开局身份页。真实测试项目显示 1,504 章、world ready、published partial package；构建任务为 4/4。向导能加载且姓名为空时“下一步”禁用。没有创建角色、campaign 或玩家行动。
- 键盘焦点冒烟通过，未输入数据；系统字号临时放大到 1.3 后恢复 1.0，布局中的核心输入和按钮仍可见，长标题使用省略号截断。TalkBack 未启用，故读屏验收 NOT RUN。
- 本轮截图保存在本地临时证据目录 `C:\Temp\shineword-phase95-local-final`，只用于本机复核，未提交图片、SQLite 快照、源文、请求日志或模型响应。当前设备 crash buffer 检查未发现 FATAL EXCEPTION / AndroidRuntime 错误。
