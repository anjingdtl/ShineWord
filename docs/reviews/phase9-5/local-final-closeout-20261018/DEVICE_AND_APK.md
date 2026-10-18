# M1：Android 设备与 APK

日期：2026-10-18（Asia/Shanghai）
工作分支：`fix/phase95-local-final-closeout-20261018-short`
工作树：`F:\sw95local-20261018`

## 当前构建身份

- Debug APK：`F:\sw95local-20261018\dist\apk\debug\ShineWord-V1.0.0-debug.apk`
- 包名 `com.shineword.app`，versionName `1.0.0`，versionCode `1000000`，minSdk `24`，targetSdk `36`，x86_64。
- 最新 standalone Debug APK SHA-256：`C42A097F490595E3C46D1BC04CCB73E7BE0700F892170DFCD8CDA054EE755B44`。
- 模拟器 `/data/app/.../base.apk` 拉取后 SHA-256 完全相同。APK 内含 `assets/index.android.bundle`，可脱离 Metro 启动。使用 `adb install -r`，没有清除应用数据。

## 专用设备

- AVD `ShineWord_Phase95_LocalFinal_20261018`，设备 serial `emulator-5556`，API 37 / Android 17 / `sdk_gphone16k_x86_64` / 1080×2400 @420 dpi。
- 当前安装包通过 SAF 导入的真实 GBK 小说项目可见，partial world package `ready` 并能启动战役。
- 本机从合法历史 QA 日志只读恢复旧 save-10，并以原生 Library/Campaigns 导入 UI 恢复其确切 r1 世界包和 save。恢复后的独立 campaign `camp-mvdsy3v4` / branch `camp-mvdsy3v4-main` 保留六条历史 turns 与两条历史 roll；新增一条 agent-driven continuation 后为 v6、7 turns、3 rolls。冷启动后重开分支，`play-composer` 和 `play-submit` 均可见。归档及 save 的 SHA-256、世界/包身份、历史对照见 `evidence/save10-device-restore-sanitized.json`。
- 三个 campaign QA 主线及该 campaign 下额外的隔离测试分支由当前 APK 创建并写入本地 SQLite；真实 GLM 开局建议、campaign planning、L1/L2 Planner 分流、Narrator 和 turn commit 均有账本记录。
- 前两局的 Runtime `failed` 终局页仍保留 `SW95-M3-02` 设备 GREEN 证据：`guidance-submit-*` 与观察 action 数量为 0、composer disabled。第三局另在同一 AVD 推进到 branch state v12：campaign stage 5 内容预备失败并显示降级提示；hierarchy 有 3 个 enabled guidance 提交项与 enabled freeform composer，空输入时 submit disabled。turn-0012 的自由输入 L2 行动经 Planner/Narrator HTTP 200 并原子提交 v11→v12。
- 原第三局 main `camp-mvdjtr22-main` 保持 v12 / plan r4。通过应用创建的隔离 QA branch `camp-mvdjtr22-bmvdq6wys` 在新计划获准后经真实 UI 推进 stage 5；turn-0014 提交后 plan r7 被采用，branch stateVersion 15，stage 6 active，stage 7/8 planned。冷停并重开该 branch 后，play composer 与 campaign progress 卡可见。它证明工程/设备续玩，不构成人类选择。
- state v12 和中间 replan 的私有截图保留在本机隔离目录，未加入 Git。仓库仅保存不含剧情正文的脱敏摘要与 hash。

## 最新构建和安装复测

- `447bd67` 后通过 `npm run apk:debug` 构建 standalone Debug APK 并执行 `adb install -r`。本地 APK 与设备 `/data/app/.../base.apk` SHA-256 完全一致：`C42A097F490595E3C46D1BC04CCB73E7BE0700F892170DFCD8CDA054EE755B44`。安装保留原 package 数据，无 uninstall、clear data 或 AVD reset。
- 冷启动复测先移除 8081 reverse 并停止本次任务启动的 Metro 进程；应用直接进入书库，原小说与战役项目仍可见。清空 logcat 后再 force-stop/start，`MainActivity` 回到前台，crash buffer 无新应用异常。之前直接执行普通 `assembleDebug` 的开发包缺少内嵌 JS，确实显示 “Unable to load script”；改用项目的 standalone `npm run apk:debug` 后问题消失。这是构建模式选择问题，不登记为应用 Runtime 缺陷。
- 安装前后 AsyncStorage、WAL、SHM 对应文件 hash 相同；SQLite 行级只读比较发现只有配置更新引起的一个 `llm_resource_buckets` 记录变化，campaign branches 与 turn history 未在 APK 更新时改写。后续 QA 显式新建了测试 branches 和一个 action turn，这是预期测试写入。
- 主第三局 `camp-mvdjtr22-main` 仍在 v12/r4。stage-5 失败候选分支 `camp-mvdjtr22-bmvdofyhk`、method-bound action branch `camp-mvdjtr22-bmvdo8467` 和历史 rewind branch 均保留。后续 QA branch `camp-mvdjtr22-bmvdq6wys` 由 main v12 的受控回退建立，最终通过 stage-5 action 与 bounded replan 达到 v15/r7；stage 5 succeeded、stage 6 active、stage 7/8 planned。不存在对 main/history 的改写。
- 新分支与 turn 产生后，设备只读 SQLite 稳定快照 `PRAGMA integrity_check=ok`。在数据库 journal 活跃期间创建的一个临时副本 integrity check 失败，该副本已明确排除证据；等待 journal 清空后重新取稳态副本通过，不能将快照竞态误报为设备数据库损坏。

## UI 与数据保全

- 书库、小说世界项目页、角色/战役开局、行动提交、结果/掷骰和终局回归在当前 APK 上完成。
- Gboard 首次弹出系统手写教程；取消教程后通过键盘菜单显式启用屏幕键盘，随后输入可正常工作。这是模拟器键盘初始设置，不作为应用缺陷。
- APK 更新通过 `install -r` 保留 SQLite、小说源、GLM Keychain 配置及故障项目；没有卸载、清库或重建模拟器。
- 单独的 SQLite 快照在本机只读分析，`PRAGMA integrity_check=ok`；快照包含本地剧情与测试状态，不提交。
- AVD 保留原小说、三局主线、Save-10 恢复 campaign 和 QA 分支供查看。stage 5 只在隔离 QA branch 上通过，原 main v12/r4 的 stage 5 仍待补建。没有清除用户数据；原始 main 工作树和其他 AVD 未被启动、清除或改写。

## 工具链与边界

- Node.js `v24.14.1`、npm `11.14.1`、Temurin JDK `17.0.19.10`、Gradle wrapper `9.3.1`、ADB `37.0.0-14910828`。
- 长路径原 checkout 曾触发 Windows CMake path-length 问题；短路径隔离 worktree 构建成功，没有调整工程路径配置绕过它。
- 当前结果证明该 APK 构建、安装、启动和代理 QA 旅程；不能替代 TalkBack、多尺寸设备、真人决定或独立试玩。
