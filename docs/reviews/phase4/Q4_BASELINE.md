# Q4-00 第四期施工基线

日期：2026-09-29（Asia/Shanghai）
仓库：E:\AiWorkSpace\ShineWord
主控：docs/Shine-TRPG_PHASE4_CONSTRUCTION_PLAN.md

## 仓库与用户工作

| 项目 | 本轮实测 |
|---|---|
| HEAD | 5a75379570e4de2edfb8c09bb15334355b658b11 |
| 分支 | main，状态显示与 origin/main 对齐 |
| 最近提交 | 2026-09-29；docs(closeout): publish r7 device progress, reacceptance basis and screens |
| 适用 AGENTS.md | 仓库、父目录及仓库递归检查均未发现；遵循用户本轮提供的指令 |
| 工作区差异 | 修改 .workbuddy/memory/2026-09-28.md（用户已有修改）；未跟踪 .zcodeignore、docs/Shine-TRPG_PHASE4_AGENT_PROMPT.md、docs/Shine-TRPG_PHASE4_CONSTRUCTION_PLAN.md |
| 保护边界 | 不覆盖、删除、重置或暂存上述项目；后续新增内容只写本期授权范围 |

## 当前版本与 APK

| 项目 | 值 |
|---|---|
| mobile package 版本 | 0.3.0-progressive.2 |
| Android applicationId | com.shineword.app |
| versionCode / versionName | 16 / 0.3.0-progressive.2（Gradle 与现有 release APK 核验一致） |
| minSdk / targetSdk | 24 / 36 |
| 现有第四期前 release | dist/apk/release/ShineWord-V0.3.0-progressive.2-release.apk；47,013,950 B；SHA-256 B7D48B97782F6B1ECBCD99954AFEC69600957A5DAF866AFABDA2C81F75A6D69B |
| 现有 debug | dist/apk/debug/ShineWord-V0.3.0-progressive.2-debug.apk；96,218,119 B；SHA-256 64648ACB95C3A96E2CA7A91C06C4FA22D52DEB06E51199B4F7F5F3B28C49601C |
| 历史 APK | 仓库另有 0.2.0-p2.8 / p2.9 debug、release 文件；均不是第四期候选 |
| ABI / 内嵌 JS | 旧 release 为 arm64-v8a + x86_64，多 ABI；本轮尚未验证新版 bundle 或离线启动 |

## 本地执行环境

| 项目 | 本轮实测 |
|---|---|
| Node / npm | v24.18.0 / 11.16.0 |
| Java | Temurin OpenJDK 17.0.19 |
| Android SDK | C:\Users\anjin\AppData\Local\Android\Sdk；adb 37.0.0；platforms android-36、android-36.1；build-tools 35.0.0、36.0.0 |
| 系统镜像 | 仅发现 android-37.1 Google Play 16K x86_64；当前没有已连接设备 |
| AVD | ShineQA、Medium_Phone 均为 1080×2400、420 dpi、x86_64、8G 数据分区；ShineQA 是隔离设备，可复用；Medium_Phone 为用户设备，禁止清除或重置 |
| 磁盘 | C: 93.2 GiB 可用；E: 765.2 GiB 可用 |
| 签名配置 | 进程内可见四个 SHINE_WRITER_RELEASE_* 变量名；未读取或记录变量值 |
| 真实资源 | GLM 配置、白篱梦 TXT、凡人修仙传 TXT 路径均存在；仅检查元数据，未读取配置内容或小说正文。配置文件最后修改时间早于 R7 报告的密钥泄漏事件，轮换状态尚无证据 |

## 回归基线（本轮重新执行）

| 命令 | 结果 | 日志 |
|---|---|---|
| npm run verify:core | PASS，227/227，0 failed、0 skipped，exit 0 | %TEMP%\shineword-phase4-baseline-verify-core.log |
| npm run typecheck --prefix mobile | PASS，exit 0 | %TEMP%\shineword-phase4-baseline-mobile-typecheck.log |
| node docs/reviews/final-closeout/contrast-check.cjs | PASS，96 个 text/large 检查、0 低于门槛，组件配对断言全过，exit 0 | %TEMP%\shineword-phase4-baseline-contrast-check.log |

## 历史事实的本轮复核边界

- R7 已有的合成短篇真实 LLM 开局、遭遇、存档、恢复证据属于旧版本和旧执行轮次；不算两部指定小说或本期产品路径通过。
- 旧 data-availability.md 所述投影缺口不是当前全貌：现在有 src/application/campaign/playProjection.ts 的聚合投影和 GM 字段剥离行为测试，mobile/src/playProjection.ts 已接入它们。本轮仍需验证端上投影和安全。
- mobile/src/runtime.ts 的 loadHistory 仍排除 narrativeText 为空的 committed turns，且当前没有统一 StoryEntry 行动来源，Q4 要修复并行为回归。
- 新开局 facts 已用 revealAt=null，但旧 partial 世界的 revealAt='1' 无锚点读取尚未通过兼容实测。
- 当前测试配置文件的轮换时间无法证明晚于 R7 泄漏；真实请求需在确认所有者已轮换后再执行。模型试验之外的工作照常继续。

## 实现后复验快照（2026-09-29）

下列信息是本期施工后复验，不覆盖上面的初始基线快照。

| 项目 | 复验结果 |
|---|---|
| 源码 HEAD / 分支 | HEAD 仍为 `5a75379570e4de2edfb8c09bb15334355b658b11`；`main...origin/main`，本轮没有提交或推送。构造改动和此前用户工作均保留在工作区。 |
| 用户工作保护 | 保留修改中的 `.workbuddy/memory/2026-09-28.md`、未跟踪 `.zcodeignore`、用户提供的 Phase 4 方案/提示和 `.workbuddy/memory/2026-09-29.md`。 |
| 回归 | `npm run verify:core`：237/237，exit 0；`npm --prefix mobile run typecheck`：exit 0；`node docs/reviews/final-closeout/contrast-check.cjs`：96 项、0 项低于门槛、组件断言全过、exit 0。日志均在 `%TEMP%\shineword-phase4-*-final.log`。 |
| 现有模拟器 | 使用已有隔离 AVD `ShineQA`，显式 serial `emulator-5554`；Android 17 / API 37 / x86_64，1080×2400、420 dpi。`Medium_Phone` 未触碰。 |
| Release 候选 | `dist/apk/release/ShineWord-V0.3.0-progressive.2-release.apk`，47,059,294 B，SHA-256 `E8450CB37FB8EC556CD1B087A567BB3C60497995A6578613EE92233C8989FAF1`；versionCode 16 / versionName `0.3.0-progressive.2`；含 `assets/index.android.bundle`；ABI `arm64-v8a` + `x86_64`。 |
| 签名 / 对齐 | `apksigner verify --verbose --print-certs`：单 signer、v2 PASS；证书 SHA-256 `017b3fbed4001083f2f70a0c51e8e463322df66b095e1c3a476fdd0d86dc2a0a`。`zipalign -c 4` PASS。 |
| 安装保留 | 在已有安装上 `adb -s emulator-5554 install -r <候选 APK>` 返回 `Success`；更新前后 `firstInstallTime=2026-09-29 02:27:49`，启动后仍可见两个合成 QA 世界。没有清库、卸载或 wipe。截图：`%TEMP%\shineword-phase4-preinstall.png`、`postinstall.png`。 |
| 断网冷启动 | `cmd connectivity airplane-mode enable` 后 `dumpsys connectivity` 无 CONNECTED 网络；强停并重新启动 Release 后到达书库，两个 QA 世界仍显示。随后恢复 airplane mode、Wi-Fi 和 mobile data 原状态。截图：`%TEMP%\shineword-phase4-offline-coldstart.png`。 |
| 正文视口 | 在本次安装的 Release 上读取 UIAutomator bounds：412×915 dp 对应 66.6%，360×800 dp 对应 61.8%，320×640 dp 对应 52.3%（均为故事滚动区高度 / 全屏截图高度）。均达到本方案门槛。截图：`%TEMP%\shineword-phase4-current-412x915.png`、`current-360x800.png`、`current-320x640.png`。 |
| 默认文字入口 | 默认主屏显示故事、一个文字行动选择和自由输入；不显示常驻距离格、先攻条、战斗卡/血条矩阵或状态版本。打开信息面板后系统 Back 返回故事；游戏信息按钮的右上边缘点击仍能打开菜单。截图：`%TEMP%\shineword-phase4-game-info.png`。 |
| 设备其余矩阵 | 四主题及 1.3× / 2×字体、键盘开合截图证据位于 `%TEMP%\shineword-phase4-theme-*`、`font-*`、`keyboard-*`。TalkBack 读屏与真实设备未测；自动化不能据截图代替这些验收。 |
| SDK 支线 | 应世恒哥要求停止下载组件和创建 AVD；本期后续只用已有 `ShineQA`。D 盘原包未修改。此前复制到 C 盘 SDK 的候选 API 35 镜像目录仍未被 Studio 认作已安装系统镜像；没有用它运行测试。 |
| 限制 | 两部指定小说及真实 LLM 尚未测试；尚未从设备正式文字入口提交一次叙事行动或合格场景遭遇。API 24、Android 15/16 真机、端上 P95、完整十次玩家决定/强停恢复均未测。整体不可称 Beta 或完全通过。 |
