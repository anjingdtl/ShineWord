# Android 验收执行记录

测试日期：2026-10-01（Asia/Shanghai）。基线：`0adadcd`，V0.4.1。

| 模块 | 状态 | 结果与证据 |
| --- | --- | --- |
| M0 | 通过（已修复） | 577/577 核心回归，移动类型与版本门禁通过；独立 debug APK 安装、冷启动与重启通过，v2 签名有效 |
| M1 | 通过（已修复） | 设备 GLM 低/高/最高三档真实连接成功；配置、Keychain 密钥重启复用成功；修复无密钥保存失败却发布配置 |
| M2 | 执行中 | 完整小说已传入模拟器，SHA-256 与用户文件一致，开始系统选择器导入 |
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

## M1 模型设置与凭据

- 使用用户文件指定端点，选择内置 `glm-5.3-flash` 预设。设备真实连接探针：Low 5,340ms，High 1,599ms，Max 3,026ms，均返回成功；这证明请求参数被端点接受，不推断模型内部推理深度。
- 缺陷复现：首次只填端点与模型、不填 Key，点保存提示失败；强停重启却进入书库。原因是普通配置在 Keychain 检查前已经持久化。
- 修复：配置验证后先确认/写入 Keychain，成功后才发布普通配置。新增 3 项回归，验证缺少密钥、Keychain 失败、无效配置不会发布新配置或更换密钥，并验证已保存密钥可复用、普通存储只包含 keyRef。
- 设备复测：缺少 Key 保存失败后重启仍显示首次配置；填真实 Key 完成保存后重启进入书库；「我的」Key 输入保持空白，从 Keychain 复用进行连接测试成功（2,148ms）。截图：[M1_CONNECTION.png](M1_CONNECTION.png)。
- `profile-store` 11/11 通过，移动端类型检查与独立 debug 重新构建通过。
- 原始证据：`m1-missing-key-restart.xml`、`m1-missing-key-fixed-restart.xml`、`m1-probe-{low,high,max}-result.xml`、`m1-keychain-reuse.xml`。
