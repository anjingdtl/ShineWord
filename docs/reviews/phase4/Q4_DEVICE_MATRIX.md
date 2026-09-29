# Q4-07 / Q4-08 Android 设备矩阵

日期：2026-09-29（Asia/Shanghai）
源码：`5a75379570e4de2edfb8c09bb15334355b658b11` 基线加本期提交内容；具体交付见 Git 历史
主设备：已有隔离 AVD `ShineQA`，所有 adb 命令显式使用 `-s emulator-5554`。

## 设备与候选包

| 项目 | 结果 |
|---|---|
| 设备 | Android 17 / API 37，x86_64，1080×2400，420 dpi；实际应用窗口、系统状态栏与导航栏均在屏幕树中。 |
| Release 候选 | `dist/apk/release/ShineWord-V0.3.0-progressive.2-release.apk`；SHA-256 `E8450CB37FB8EC556CD1B087A567BB3C60497995A6578613EE92233C8989FAF1`；47,059,294 B。 |
| Bundle / ABI | ZIP 中存在 `assets/index.android.bundle`；本机代码包含 `arm64-v8a` 与 `x86_64` 两个 ABI。不得称为 arm64 单 ABI 包。 |
| 包元数据 | `com.shineword.app`，versionCode 16，versionName `0.3.0-progressive.2`，minSdk 24，targetSdk 36。 |
| 签名 | `apksigner verify --verbose --print-certs`：单 signer，v2 验证通过；证书 SHA-256 `017b3fbed4001083f2f70a0c51e8e463322df66b095e1c3a476fdd0d86dc2a0a`。`zipalign -c 4` exit 0。 |
| 安装 | 在已有同版本安装上执行 `adb -s emulator-5554 install -r <APK>` 得到 `Success`。`firstInstallTime` 保持 `2026-09-29 02:27:49`；更新后书库仍有两个合成 QA 世界，继续入口仍可打开。 |
| 冷启动 | Release 内嵌 bundle；Android airplane-mode 生效且 `dumpsys connectivity` 无 CONNECTED 网络后，强停并冷启动应用，书库成功显示。截图 `%TEMP%\shineword-phase4-offline-coldstart.png`。此项只证明离线启动，不证明离线叙事模型可用。 |
| Debug | `npm --prefix mobile run apk:debug` exit 0，产物 96,218,119 B（见 `%TEMP%\shineword-phase4-debug-final.log`）。Debug 仍是开发构建；本轮离线启动证据来自 Release。 |

## 阅读布局与主题

故事滚动区占比用 UIAutomator 根窗口与主故事 ScrollView 的 bounds 计算：`(scrollBottom - scrollTop) / rootHeight`。物理截图尺寸按 420 dpi 换算为 dp，系统状态栏与导航栏包含在根窗口总高度中。

| 尺寸 | 覆盖方式 / bounds | 正文滚动区 | 门槛 | 结果 |
|---|---|---:|---:|---|
| 412×915 dp | 1080×2400 px；`[0,244][1080,1842]` | 66.6% | ≥60% | PASS |
| 360×800 dp | 945×2100 px；`[0,244][945,1542]` | 61.8% | ≥60% | PASS |
| 320×640 dp | 840×1680 px；`[0,244][840,1122]` | 52.3% | ≥45% | PASS |

本轮安装候选包后的截图：`%TEMP%\shineword-phase4-current-412x915.png`、`current-360x800.png`、`current-320x640.png`。三个尺寸完成后执行 `wm size reset`，模拟器恢复物理 1080×2400。

| 行为 | 结果 | 外部证据 |
|---|---|---|
| 四种主题的书库、人物资料、故事页 | PASS（界面/阅读样式冒烟；不代表各题材真实小说闭环） | `%TEMP%\shineword-phase4-theme-ink-restored.png`、`theme-fantasy-play.png`、`theme-manga-play.png`、`theme-scifi-play.png`、`theme-fantasy-library.png`、`theme-fantasy-profile.png` |
| 系统字体 1.3× / 2× | PASS（布局截图检查） | `%TEMP%\shineword-phase4-font-1_3-play.png`、`font-2_0-play.png` |
| 键盘显示与收起 | PASS（屏幕截图与按钮仍可见） | `%TEMP%\shineword-phase4-play-keyboard.png`、`ime-keyboard.png`、`keyboard-dismissed.png` |
| 默认主屏 | PASS：故事区、至多三项文字行动、自由输入；没有常驻距离格、先攻条、战斗卡、血条矩阵、手动 NPC 推进或多人物移动控件 | `%TEMP%\shineword-phase4-play-empty.png`、当前尺寸三张截图 |
| 详情面板 / Back | PASS：打开「游戏信息」后按 Android Back，返回默认故事页；当前 UI 只在次级面板显示分支/版本信息 | `%TEMP%\shineword-phase4-game-info.png` 及本轮 UIAutomator 文本输出 |
| 边缘点击 / 可访问名称 | PASS（单个头部按钮样本）：在「打开游戏信息」可点击 bounds 左上边界内约 1 dp 点击，菜单打开；UI 树暴露可读按钮名称 | UIAutomator bounds `[892,95][1038,210]`、content-desc `打开游戏信息`；操作结果为 `EDGE_TAP_OPENED_MENU=True` |
| TalkBack / 完整读屏顺序 | NOT TESTED | 本轮未启用 TalkBack；无真实读屏用户验收 |

## 行为验收边界

| 项目 | 状态 | 说明 |
|---|---|---|
| 文字普通行动从默认页提交并 commit | NOT TESTED | 当前按钮选择会直接提交。为避免使用尚未确认轮换的凭据，本轮没有触发 Planner/Narrator 网络请求。 |
| 活动遭遇行动 / NPC 自动轮转的真实 UI 流程 | BLOCKED（当前 QA 包无合格入口） | 当前场景显示空的合格冲突选项；正式入口不允许凭名字或全世界模板造敌。规则与资格在 Node SQLite 测试中覆盖，设备端未触发。 |
| 双击/陈旧选项、部分完成、切分支晚回包 | 代码回归 PASS；设备 NOT TESTED | 不以源码正则替代；本轮设备未模拟并发网络请求。 |
| commit 与 checkpoint 之间强停 | 自动化注入 PASS；Android 强停 NOT TESTED | Node SQLite 回归在实际 commit 后调用 failpoint 抛错并恢复相同 requestId；本轮没有对 Android 进程做精确时点终止。 |
| 后台/锁屏恢复、失能救援/撤退、自动行动上限 | 代码回归 PASS；设备 NOT TESTED | 当前安装 QA 世界没有可触发的正式遭遇路线。 |
| API 24、Android 15/16 真机 | NOT TESTED | 只运行现有 API 37 AVD；没有将 SDK 支线扩展为新镜像或新设备。真实设备 `Medium_Phone` 未操作。 |
| Android 本地裁定 / 页面交互 P95 | NOT TESTED | 本轮没有性能采样或 Perfetto/Simpleperf 记录。 |

## 操作与证据保护

- 仅在 `ShineQA` 上安装 Release；没有 `pm clear`、uninstall、wipe-data 或清除用户存档。
- `Medium_Phone` 保留原状。
- PNG/XML、Gradle 日志保存在 Windows `%TEMP%`，不会进入仓库。截图只含两个合成 QA 世界，不含私人小说或密钥。
- 网络断开测试完成后已关闭 airplane mode，并恢复 Wi-Fi 与 mobile data 为测试前启用状态。
