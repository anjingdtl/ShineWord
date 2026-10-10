# 阶段预生成修复闭环 — 2026-10-10

## 范围

本模块修复真实 Android 长程游玩中发现的后继阶段预生成失败，并从真实 UI 路径验证修复。它只代表阶段预生成模块闭环，不代表第九阶段整体验收完成。

基线源码 HEAD：`d424e4031b1bad24cb5285d1aaf75d885199c852`。

## 根因和改动

- 原 stage-6 单阶段候选只包含一个可玩场景，但仍被要求独立满足完整长战役的“至少两个可执行延迟后果”全局门槛，导致已通过整战役校验的冻结计划无法预生成后继内容。
- 阶段候选现在只投影冻结 successor 和它的可玩内容；继承已验证的结局、计划元数据及节点完成条件，过滤这次单阶段生成不能负责的新线索和长后果。全战役计划仍执行完整因果校验。
- 解析投影只用于本地编译，原始模型响应仍逐字保存；规划派发审计增加 campaign、branch、stateVersion 绑定。
- 新增回归覆盖缺失结局继承、非目标节点来源隔离、冻结完成条件保持、原始响应保真及阶段生成不新造长后果。

## 回归与 Android 实测

- 定向阶段预生成测试：**17/17 通过**。
- `npm run verify:core`：**1246/1246 通过**。
- `npm run typecheck --prefix mobile`、`npm run verify:version`、`git diff --check`：通过。
- `npm run apk:debug --prefix mobile`：成功。本地 APK 与设备实际安装 `base.apk` SHA-256 均为 `6F1B7E65F4862684F666B335011A244684C4C3392BAC8C5B6CE168D8219F2BB2`。
- `emulator-5554` 使用 `adb install -r` 覆盖安装；`firstInstallTime` 仍为 `2026-10-05 03:29:05`。未清理应用数据。安装后数据库 `integrity_check=ok`，campaign=5、branch=7、turn=119、snapshot=86。
- 旧 stage-6 预生成任务 `...05:03:03...` 保持 `invalid` 原证据，没有重放。通过主线 UI 新建并采用玩家请求规划，再自动运行 stage-6 预生成任务 `...05:17:57...`；两项均为确定结果。
- 新阶段候选 `stage=ready`、零校验错误、未使用修复请求；原始响应保存 10,189 字节。revision 7 中 stage-6 已绑定具体场景 `camp-sit-93dbb98fbfe30064`，含 3 个可执行办法；其 `committed_event: mine_restart_launched` 完成条件与冻结 revision 6 一致，沿用 2 个原结局。
- 共用模拟器派发账本为 **56/200**，未知请求 **0**。安装和操作记录位于 `.tmp/phase9/simulator-longrun-20261010/`，不含 API key 或小说正文。

## 未完成范围

真实战役现在仍停在 stage-5，stage-6 内容已预备但尚未由玩家触发；后续阶段游玩、质量与功能矩阵、性能采样及独立试玩仍须继续。当前操作代理不记作独立玩家。版本升级、发版、push 和关机均未执行。
