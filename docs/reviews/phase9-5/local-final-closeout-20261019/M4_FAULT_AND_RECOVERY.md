# M4 Narrator / outbox / pending-turn 故障回归

日期：2026-10-19（Asia/Shanghai）

## 范围与环境

- 设备：现有 `ShineWord_M4FaultQA_20261018`，`emulator-5560`，API 37 / Android 17，1080×2400 @420 dpi。没有创建 AVD。
- 初始被测源码：`9030c2674eea12bc3882ebe8c1cc155342e722c0`。错误提示修复分别在提交 `99b1d89`、`477bebf`；最终 APK SHA-256：`EFA99A71AF8FF21509C9B7701214D9BA45D3A64342922B320E06CDE390CE9223`。设备安装物 `base.apk` 哈希一致，`adb install -r` 保留应用数据库。
- 所有故障请求均发往 M4 本机 mock（Android endpoint `10.0.2.2:18591`）。没有调用 GLM 或外部模型。mock 只记录请求种类、分支、状态版本、HTTP 状态和 attempt 编号；不保存请求体或 Authorization。
- 在一条新导入的合成世界分支 `camp-mvef22x8-main` 上验证。此前另一个合成分支中的 Narrator 在途强停样本保留为 `outcome_unknown`，未重派、未清除、未改写。

## Narrator 在途强停

- 起始分支版本 v3，先收到一条 Planner HTTP 200，再使 Narrator 保持 pending。
- 强停应用并冷启动后，服务端仍只有这一条 Narrator 记录，并收到一次客户端断开；没有自动重派。
- 分支仍为 v3；旧已提交合同、骰点和叙事指纹不变；SQLite `integrity_check=ok`。该行动没有产生新骰点，因此不计骰点恢复覆盖。
- 结果：**单次设备恢复样本通过**；该原分支继续保留 unknown 结果，不用于后续试验。

## Outbox 原子提交注入与修复

对新合成分支在 SQLite 中暂时安装 `BEFORE INSERT` outbox abort trigger。每次先完成 Planner、Narrator 和检定，再让提交事务在 outbox 写入处回滚；删除 trigger 后从界面“继续未完成的回合”恢复同一候选。

| 注入点 | 故障时版本 | 故障后持久状态 | 移除 trigger 后的恢复 |
|---|---:|---|---|
| 第一次 | v1 | 分支仍 v1；turn-0002 为未提交状态；Candidate Narrator 与 1 条骰点已保存；outbox 仍 1 条；界面显示 `[object Object]` | 修复版恢复到 v2；Planner/Narrator 请求数没有增加；outbox 增至 2 |
| 第二次 | v2 | 分支仍 v2；turn-0003 Candidate 与第 2 条骰点已保存；outbox 仍 2 条；第一次修复显示了原生 SQLite 细节 | 最终安全提示版本恢复到 v3；无额外 Planner/Narrator；outbox 增至 3 |
| 第三次 | v3 | 分支仍 v3；turn-0004 Candidate 与第 3 条骰点已保存；outbox 仍 3 条；显示“操作未能完成，请检查当前回合状态后重试” | v4 恢复完成；无额外 Planner/Narrator；outbox 增至 4 |

每次失败快照 `PRAGMA integrity_check=ok`。每次状态版本均未前进、outbox 数量未增加；未提交回合的合同哈希与骰点记录被保留。最终恢复后 turn-0002/0003/0004 均各提交一次，3 条骰点均保留，`p95_abort_outbox_insert` trigger 数量为 0。

跨第三次失败与最终恢复，既有已提交材料的对照指纹一致：

- 已提交行动合同：`6f0b6e428d47d0cbfdcef645db19c7d0f6d2c1515c1c84c56bf3856fe3d2d55c`
- turn-0002/0003 骰点：`d0ef802a4fd18c5440d042ebd7d958c358b81ec5384859acfefd95943c90ae3c`
- turn-0002/0003 叙事状态：`2d63c00249f913e27e29adb7ab3079c9662c939e31fedf56d2989d1882ca7756`

最终 M4 数据库：2,273,280 bytes，SHA-256 `3732E1B135806FBC93EC9B2B58AB00121D4F3DD012383688733122B3CE7155BE`；`integrity_check=ok`、无 trigger、分支 v4、3 个行动回合已提交、3 条骰点、4 条 outbox。恢复后界面已回到下一步行动状态，无 pending banner 或 error banner。

## 模型请求与 UI 证据

- mock 总计 8 次 HTTP 200：2 次 campaign_plan；Planner 和 Narrator 分别对 v1、v2、v3 各 1 次。所有 attemptNo 为 1；恢复过程没有新增 Planner/Narrator 请求。
- 最终修复 APK 的 M4 UI 注入复测断言通过：有“操作未完成”提示和 pending-turn 恢复选项；有安全中文 fallback；没有 `[object Object]`，没有 SQLite 错误细节；Android fatal crash 数为 0。
- Maestro `play-recover-turn` flow 在三个 trigger 移除后的恢复点均退出码 0。临时故障注入、ADB hierarchy 和原始数据库副本保留在本机 `C:\Temp`，不纳入 Git；提交的本报告只含脱敏计数、状态和哈希指纹。

## 修复与验证

- 缺陷根因：行动提交 catch 对非 `Error` 的 native SQLite 对象调用 `String(error)`，把对象标签直接展示到玩家错误横幅。
- 修复：新增 `src/application/errorMessage.ts`，保留普通字符串和 `Error.message`，对非 `Error` native 对象显示明确中文恢复提示；行动提交 catch 使用该函数。回归用例见 `tests/play-error-message.test.cjs`。
- RED：M4 第一次 trigger 注入 UI 显示 `[object Object]`；原生错误泄露用例也在第二次故障样本上失败。
- GREEN：新增格式化用例 2/2；最终 UI 故障注入断言 1/1；`npm run verify:core` 1,364/1,364；`npm --prefix mobile run typecheck`、`npm run verify:version`、standalone `npm run apk:debug` 均通过。
- 代码提交：`99b1d89 fix(play): format structured turn errors`、`477bebf fix(play): hide native database error details`。

本结果证明这些合成恢复与故障路径在 M4 上可自动复现；不替代真实小说上的玩家决策或外部试玩。
