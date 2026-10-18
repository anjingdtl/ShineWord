# M2：真实小说导入与 GLM 开篇 / 游玩样本

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL。真实小说 partial world、已测通的 GLM 配置和当前 Android APK 均完成 agent-driven 游玩。第三局 campaign-scope 内容提供了显式固定难度、固定空 evidence policy 和规则绑定的 L1 方法，已真实提交 6 个 L1 与 2 个 L2 行动。World package 仍无 method entry，非空来源证据 L1、真人决策、独立试玩及 stage 5 可执行内容仍未通过。

## 材料与隔离

- 用户原始 TXT：7,178,905 bytes，SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`，本机检测 Windows-936/GBK。
- SAF 导入的私有副本仅追加 CRLF，7,178,907 bytes，SHA-256 `2D4AD3AAA7793C0BE690DE6E380DE88F1FAC7E78CD725C3D74E3F92B0BECBFD8`；原文件未修改。正文、提示词、原始响应和密钥未加入仓库。
- 设备解析 1,504 个章节、3,260 个 source chunks；本机标题计数 1,498，差异未归因。模型只收到 0–9,600 code points 的 partial scope，未构建/发送全书。
- 发布包汇总 49 explicit facts、3 inference facts、52 个有来源事实引用、8 skills、4 scenes、11 个角色模板。当前 world package 的 `package_entries.kind='method'` 数量仍为 0；第三局由 GLM 生成的 campaign-scope artifact 另含合法 L1 方法，均显式设置 fixed `difficultyPolicy`、`evidencePolicy: {kind: fixed, evidenceIds: []}` 和规则绑定。它证明了 campaign-scope L1 分流，不证明 package method 覆盖或非空来源 evidence L1。

## 真实 GLM 物理请求账本

用户在本轮明确授权本项目调用不限额度；实测调用串行，物理并发峰值为 1。当前小说副本对应世界 `world-src-2d4ad3aaa7793c0b-mvddhkeg`：

| Request kind | 成功次数 | 已知失败 | 成功 input / output / reasoning tokens | 成功耗时 ms（min / avg / max）|
|---|---:|---|---:|---:|
| world_extract | 3 | 0 | 10,855 / 7,750 / 34 | 25,937 / 34,231 / 40,951 |
| style_analyzer | 1 | 0 | 1,660 / 410 / 0 | 12,150 / 12,150 / 12,150 |
| opening_goal | 3 | 1 次旧配置 HTTP 401 | 563 / 104 / 0 | 3,904 / 4,761 / 6,109 |
| campaign_plan | 22 | 0 | 499,781 / 133,211 / 20,381 | 31,405 / 93,923 / 173,071 |
| planner | 8 | 0 | 27,522 / 1,828 / 175 | 5,188 / 8,946 / 20,651 |
| narrator | 14 | 0 | 42,913 / 6,809 / 236 | 6,941 / 11,139 / 16,771 |
| memory_checkpoint | 2 | 0 | 4,686 / 2,899 / 19 | 22,071 / 25,640 / 29,208 |

按真实小说 world 与其三个 campaign branch 的物理 attempt 去重统计，共 54 次请求：53 次 HTTP 200 成功、1 次更新前配置 HTTP 401；没有真实模型 `outcome_unknown` 或在途请求。配置已通过设备连接测试，旧 401 没有重派。GLM 账本区间的峰值并发为 2；长 campaign-plan 请求期间按账本等待，未手工重派。

成功调用合计 input `587,980`、output `153,011`、reasoning `20,845` tokens。App ledger 不记录实际人民币扣费，费用未知；不限额度授权不代表费用为零。独立 localhost mock world 的 429 / `outcome_unknown` 不计入以上统计。

## 独立本地故障注入世界

- 世界 `world-src-7f45fe0b11ea30ec-mvdbwylw` 绑定原始 TXT hash，是单独的 localhost/mock fixture 项目，不是上述 GLM campaign 世界。
- 账本保留一次合成 HTTP 429（`http_rate_limit`）和一次 `network_unknown/outcome_unknown`（无 HTTP/provider ID/usage）；两条都不确认、不清账、不重派。unknown 仍 `needs_review`，estimated usage 按 1 保留。
- 因故障注入世界与当前小说副本及其三个 campaign branches 分开计数，不把本地代理错误算成真实 GLM 失败。它不属于真实小说 ledger 的 53 次成功 / 1 次旧配置 401 统计。

## Android 上的实际 Runtime 行动（均为代理 QA，不是真人决定）

- 第一局：5 个行动级操作；Planner 5 / Narrator 5；行动/骰点和状态连续提交，测试中出现失败、成功、严重失败。`turn-0005` talk 成功使 testimony counter 从 0 增至 10，后续状态中仍为 10；`turn-0007` severe failure 后 Runtime 为 `failed`、ending ID `ending-case-lost`。行动与剧情均由测试执行者输入/选择。
- 第二局：在同一小说世界新建独立 branch；一次“观察周围环境” QA 行动触发真实 Planner 与 Narrator（本轮前累计 Planner/Narrator 各 6），骰点 `[1]` / d4 / difficulty 4 / margin -3，state version 2→3 原子提交。下一轮本地建议投影可见；后续计划请求完成后 Runtime 经 `manage-replan:4` 到 version 5 并以 `ending-failure` 结束。终局页禁用新行动。
- 第三局 `camp-mvdjtr22`：8 个 agent-driven action turns 中，turn-0002 和 turn-0012 真实走 L2（Planner + Narrator）；turn-0003、0006、0008、0009、0010、0011 真实走 campaign-scope L1（仅 Narrator，无 Planner）。turn-0011 以 `[4,5,6]` / 3d6 / difficulty 3 / margin +3 `full_success` 从 v10 原子提交到 v11；L1 与 L2 合计继续到 v12。stage 1–4 成功，三项 deferred consequence 已触发并消费；第四项 stage 5 后果仍 pending。
- 第三局 stage 5 的 v10、v11 新计划候选均被既有 validator 拒绝；当前 revision 4 只有 stage 4 campaign 内容，stage 5 `content_prep` 未解决。一个 agent-driven 自由输入 L2 行动仍在降级 UI 上成功提交 v11→v12，但没有 stage 5 方法或结局路线。
- 三局共 14 个 agent-driven action turns；这证明安装 APK 上的有限 L1/L2 服务路径、骰点/原子提交及三条延迟后果消费者，不证明用户认可剧情质量，也不计入阶段 9 的 80 个真人决定或 4 名独立试玩。

## 未通过/待验

1. L1：已在第三局 campaign-scope artifact 上执行 6 次；方法的 evidenceIds 均为空，world package 仍无 `method` entry，非空来源 evidence L1 与 package method 覆盖未验。
2. 延迟后果：`conseq-town-tension`、`conseq-barov-attention`、`con-tension-peaked` 已在 turn-0010/0011 的后续消费者中触发并消费；`con-barov-offer` 仍 pending。stage 5 方法内容和玩家对后果的后续回应尚缺。
3. 第三局 stage 5 仍有 `content_prep` unresolved：v10 候选缺普通成功完成路径，v11 两次 HTTP 200 后的候选因 success/full_success 效果数超过 8 被验证器拒绝。没有放宽验证器；这是模型候选内容阻滞，未确认为代码缺陷。
4. 真实玩家决定 0/80、独立试玩 0/4；第一、二局的 failure ending 不代表自然结局可玩性已验。
5. 实际费用、全书构建成本、章节计数差异、模型与独立玩家的剧情质量评估仍未知/未运行。原文与生成剧情截图只留在本机私有目录。
