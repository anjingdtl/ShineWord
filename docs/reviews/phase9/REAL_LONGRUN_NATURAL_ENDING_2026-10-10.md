# 第九阶段真实长程旅程与自然结局 — 2026-10-10

## 验收范围

在 `emulator-5554` 上恢复现有 `com.shineword.app` 用户数据，从已采用的 campaign plan 继续通过正式 Android UI 游玩，覆盖真实计划生成、阶段预生成与采用、多个普通成功回合、一次失败后的继续推进、延迟后果实际消费、自然结局和存档导出。此报告只关闭本条旅程，不把它扩展成完整第九阶段全功能验收，也不把 UI 自动化称为独立真人试玩。

原设备数据库在安装前保留；未清除应用数据。Debug APK 使用 `adb install -r` 安装，`firstInstallTime` 保持 `2026-10-05 03:29:05`。

## 实际旅程

- 同一战役分支 `camp-mv1s7cga-main` 最终达到 stateVersion 16、plan revision 8。stage-1 至 stage-7 全部为 `succeeded`，战役状态为 `completed`。
- 本分支共记录 9 个玩家行动决定：8 次成功、turn-0015 一次明确失败。管理规划不计作玩家决定。失败回合保留在历史中、无游戏副作用；turn-0016 后续行动成功结算自然成功结局“边陲镇的新柱石”。
- stage-5 盟约成功后自动准备并采用 stage-6；stage-6 的冻结完成条件是 `committed_event: mine_restart_launched`。玩家先加固坑道（turn-0012），再招募矿工（turn-0013），最后取得重建令（turn-0014），才完成 stage-6 并激活 stage-7。
- stage-7 自动预生成并采用后提供现场调查、呈报线索、呈交善后方案与直接陈情等不同路径。现场调查的失败没有阻断战役；后续直陈请求结算出 `campaign_direction_chosen` 并完成自然结局。

## 延迟后果消费

turn-0010 排程了 `con-church-watch` 与 `con-trust-deepens`。之后 turn-0012、turn-0013、turn-0014 三个有效玩家决定分别完成工程、招募与重建令；turn-0016 完成最终方向决定时两项后果才触发。

- `con-church-watch` 在 campaign ending 之前实际发放知识 `camp-clue-cab2524f3e2944cd77edab72`，满足 success ending 的 `knowledge_known` 条件。
- `con-trust-deepens` 实际把罗兰对玩家的关系提升 3，结算后的 closeness 为 12，满足 success ending 的关系门槛。
- 事件序列先记录两项 consequence trigger、知识发现与关系变化，再记录 success ending 和 `campaign_status_changed`。存档状态为 `ending-alliance-solid / success`。

## 回归、预算与导出

- 阶段预生成定向回归：17/17 通过；完整核心门禁：1246/1246 通过；mobile typecheck、version check、Debug APK 构建、diff check 均通过。模块代码及上一阶段安装证据见 `STAGE_PREPARATION_CLOSEOUT_2026-10-10.md`，修复 commit 为 `0036625`。
- SQLite `integrity_check=ok`；数据库中 campaign=5、branch=7，目标分支 17 个已提交状态变更记录。没有替换数据库。
- 共用 Android/主机派发账本为 **70/200**，reserved=0、outcome_unknown=0。
- 从游戏菜单用“导出存档”写入 Android `Download`。文件为 `shine-trpg-camp-mv1s7cga-camp-mv1s7cga-main.shineword-save.json`，1,609,767 bytes，SHA-256 `D9B7354357D203F1D519CF6C2FC1178EC2D29A82C4656D55106875E693561344`。production `validateSaveJson` 校验返回 `ok=true`、errors=[]；manifest 为 `shineword-save-10`、stateVersion 16，且含同一分支与成功结局。

脱敏快照、UI 与导出证据保存在 `.tmp/phase9/simulator-longrun-20261010/`；不包含 API key 或小说正文。本旅程关闭后仍需继续其他第九阶段改造方向的 Android 功能与工程验收，故本记录不表示整阶段已完成或具备发版条件。
