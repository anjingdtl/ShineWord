# M2：真实小说导入与 GLM 开篇 / 游玩样本

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL。真实小说 partial world、实际 GLM 和 Android Runtime 均跑通；样本没有 L1 合格方法，实际玩家决定/延迟后果验收仍缺。

## 材料与隔离

- 用户原始 TXT：7,178,905 bytes，SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`，本机检测 Windows-936/GBK。
- SAF 导入的私有副本仅追加 CRLF，7,178,907 bytes，SHA-256 `2D4AD3AAA7793C0BE690DE6E380DE88F1FAC7E78CD725C3D74E3F92B0BECBFD8`；原文件未修改。正文、提示词、原始响应和密钥未加入仓库。
- 设备解析 1,504 个章节、3,260 个 source chunks；本机标题计数 1,498，差异未归因。模型只收到 0–9,600 code points 的 partial scope，未构建/发送全书。
- 发布包汇总 49 explicit facts、3 inference facts、52 个有来源事实引用、8 skills、4 scenes、11 个角色模板。当前 package 中 `kind='method'` 数量为 0，因此不能通过现有世界内容执行具备固定难度与 evidence binding 的 L1。

## 真实 GLM 物理请求账本

用户在本轮明确授权本项目调用不限额度；实测调用串行，物理并发峰值为 1。当前小说副本对应世界 `world-src-2d4ad3aaa7793c0b-mvddhkeg`：

| Request kind | 成功次数 | 已知失败 | 成功 input / output / reasoning tokens | 成功耗时 ms（min / avg / max）|
|---|---:|---|---:|---:|
| world_extract | 3 | 0 | 10,855 / 7,750 / 34 | 25,937 / 34,231 / 40,951 |
| style_analyzer | 1 | 0 | 1,660 / 410 / 0 | 12,150 / 12,150 / 12,150 |
| opening_goal | 3 | 1 次旧配置 HTTP 401 | 563 / 104 / 0 | 3,904 / 4,761 / 6,109 |
| campaign_plan | 10 | 0 | 212,745 / 57,119 / 7,447 | 31,405 / 82,688 / 121,932 |
| planner | 6 | 0 | 19,781 / 1,416 / 128 | 5,188 / 9,150 / 20,651 |
| narrator | 6 | 0 | 15,719 / 2,812 / 120 | 8,138 / 9,560 / 11,779 |

这 30 条真实世界记录中 29 次成功、1 次明确 401 失败（更新前配置；无 usage / provider request ID），没有真实模型 `outcome_unknown`。用户更新配置并通过模拟器连接测试后，新的 opening_goal 为 HTTP 200；旧 401 没有重派。

成功调用合计 input `261,323`、output `69,611`、reasoning `7,729` tokens。App ledger 不记录实际人民币扣费，费用未知；调用额度授权不代表费用为零。Campaign-plan 请求因大 prompt 偶尔运行约 2 分钟；请求串行，等待期间未重派。

## 独立本地故障注入世界

- 世界 `world-src-7f45fe0b11ea30ec-mvdbwylw` 绑定原始 TXT hash，是单独的 localhost/mock fixture 项目，不是上述 GLM campaign 世界。
- 账本保留一次合成 HTTP 429（`http_rate_limit`）和一次 `network_unknown/outcome_unknown`（无 HTTP/provider ID/usage）；两条都不确认、不清账、不重派。unknown 仍 `needs_review`，estimated usage 按 1 保留。
- 因故障注入世界与当前小说副本世界分开计数，不把本地代理错误算成真实 GLM 失败。它不属于实际 GLM 29 次成功/401 的统计。

## Android 上的实际 Runtime 行动（均为代理 QA，不是真人决定）

- 第一局：5 个行动级操作；Planner 5 / Narrator 5；行动/骰点和状态连续提交，测试中出现失败、成功、严重失败。`turn-0005` talk 成功使 testimony counter 从 0 增至 10，后续状态中仍为 10；`turn-0007` severe failure 后 Runtime 为 `failed`、ending ID `ending-case-lost`。行动与剧情均由测试执行者输入/选择。
- 第二局：在同一小说世界新建独立 branch；一次“观察周围环境” QA 行动触发真实 Planner 与 Narrator（累计 Planner/Narrator 各 6），骰点 `[1]` / d4 / difficulty 4 / margin -3，state version 2→3 原子提交。下一轮本地建议投影可见；后续计划请求完成后 Runtime 经 `manage-replan:4` 到 version 5 并以 `ending-failure` 结束。终局页禁用新行动。
- 这证明安装 APK 上的真实 L2 服务路径与有限因果/结局投影。它不证明用户认可剧情质量，也不算阶段 9 的 80 个真人决定或独立试玩。

## 未通过/待验

1. L1：没有具备 `difficultyPolicy`, `evidencePolicy`、稳定来源与规则绑定的合法方法条目；未发 L1 Planner request（符合 L1 应免 Planner 的边界）。
2. 延迟后果：testimony 即时 counter 变更已持久化，但最终 Runtime deferred consequence 列表为空，没有完成触发→到期→消费→后续消费者链。
3. 两个代理 QA campaign 都走到模型/规则选定的 failure ending；不能据此断言这是实际玩家可接受的自然结局。第二局终局后没有再提交行动。
4. 实际费用、全书构建成本、章节计数差异、模型与独立玩家的剧情质量评估均未知/未运行。
5. 原始 novel 内容与生成剧情截图保存在本机私有临时目录，不纳入仓库；仓库内开局 screenshot 仅展示身份控件。
