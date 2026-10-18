# M1：Android 设备与 APK

日期：2026-10-18（Asia/Shanghai）
工作分支：`fix/phase95-local-final-closeout-20261018-short`
工作树：`F:\sw95local-20261018`

## 当前构建身份

- Debug APK：`F:\sw95local-20261018\dist\apk\debug\ShineWord-V1.0.0-debug.apk`
- 包名 `com.shineword.app`，versionName `1.0.0`，versionCode `1000000`，minSdk `24`，targetSdk `36`，x86_64。
- 最新本地构建物 SHA-256：`3B3A8A33463F74A37617BBE5B47B000D80CC1BBE51972D00404D3E5A6BE03167`。
- 模拟器 `/data/app/.../base.apk` 拉取后 SHA-256 完全相同。使用 `adb install -r`，没有清除应用数据。

## 专用设备

- AVD `ShineWord_Phase95_LocalFinal_20261018`，设备 serial `emulator-5556`，API 37 / Android 17 / `sdk_gphone16k_x86_64` / 1080×2400 @420 dpi。
- 当前安装包通过 SAF 导入的真实 GBK 小说项目可见，partial world package `ready` 并能启动战役。
- 三个 campaign QA 主线及该 campaign 下额外的隔离测试分支由当前 APK 创建并写入本地 SQLite；真实 GLM 开局建议、campaign planning、L1/L2 Planner 分流、Narrator 和 turn commit 均有账本记录。
- 前两局的 Runtime `failed` 终局页仍保留 `SW95-M3-02` 设备 GREEN 证据：`guidance-submit-*` 与观察 action 数量为 0、composer disabled。第三局另在同一 AVD 推进到 branch state v12：campaign stage 5 内容预备失败并显示降级提示；hierarchy 有 3 个 enabled guidance 提交项与 enabled freeform composer，空输入时 submit disabled。turn-0012 的自由输入 L2 行动经 Planner/Narrator HTTP 200 并原子提交 v11→v12。
- 第三局 state v12 的私有截图 SHA-256 `953FA7E8755212D12B8C3E26B7FD972C5BF1AA28525DEB8B18D1854FD496FC1F`，仅留在 `C:\Temp\shineword-phase95-local-final\after-stage5-fallback-l2.png`，未加入 Git。旧终局截图与开局身份截图也只保留在本地/原证据范围；仓库内身份页不含小说正文或模型剧情。

## 最新构建和安装复测

- `cbacbb0` 后重新构建 Debug APK 并执行 `adb install -r`。本地 APK 与设备 `/data/app/.../base.apk` SHA-256 完全一致：`3B3A8A33463F74A37617BBE5B47B000D80CC1BBE51972D00404D3E5A6BE03167`。安装保留原 package 数据，无 uninstall、clear data 或 AVD reset。
- 安装前后 AsyncStorage、WAL、SHM 对应文件 hash 相同；SQLite 行级只读比较发现只有配置更新引起的一个 `llm_resource_buckets` 记录变化，campaign branches 与 turn history 未在 APK 更新时改写。后续 QA 显式新建了测试 branches 和一个 action turn，这是预期测试写入。
- 主第三局 `camp-mvdjtr22-main` 仍在 v12。stage-5 新 repair job 的隔离 branch `camp-mvdjtr22-bmvdofyhk` 保持 v10，2/2 HTTP 200 后候选因 skill_check destinationId validator error 被拒，没有采用。另一个 method-bound 行动 branch `camp-mvdjtr22-bmvdo8467` 从 v9 提交至 v10；empty rewind branch `camp-mvdjtr22-bmvdo5ftn` 保留 v11，无行动与模型调用。所有 branches 均保留供复核，没有清理。
- 新分支与 turn 产生后，设备只读 SQLite 稳定快照 `PRAGMA integrity_check=ok`。在数据库 journal 活跃期间创建的一个临时副本 integrity check 失败，该副本已明确排除证据；等待 journal 清空后重新取稳态副本通过，不能将快照竞态误报为设备数据库损坏。

## UI 与数据保全

- 书库、小说世界项目页、角色/战役开局、行动提交、结果/掷骰和终局回归在当前 APK 上完成。
- Gboard 首次弹出系统手写教程；取消教程后通过键盘菜单显式启用屏幕键盘，随后输入可正常工作。这是模拟器键盘初始设置，不作为应用缺陷。
- APK 更新通过 `install -r` 保留 SQLite、小说源、GLM Keychain 配置及故障项目；没有卸载、清库或重建模拟器。
- 单独的 SQLite 快照在本机只读分析，`PRAGMA integrity_check=ok`；快照包含本地剧情与测试状态，不提交。
- AVD 保留原小说、三局主线和所有新增 QA 分支供查看；第三局主线 v12 的 stage 5 `content_prep` unresolved。没有清除用户数据。原始 main 工作树和其他 AVD 未被启动、清除或改写。

## 工具链与边界

- Node.js `v24.14.1`、npm `11.14.1`、Temurin JDK `17.0.19.10`、Gradle wrapper `9.3.1`、ADB `37.0.0-14910828`。
- 长路径原 checkout 曾触发 Windows CMake path-length 问题；短路径隔离 worktree 构建成功，没有调整工程路径配置绕过它。
- 当前结果证明该 APK 构建、安装、启动和代理 QA 旅程；不能替代 TalkBack、多尺寸设备、真人决定或独立试玩。
