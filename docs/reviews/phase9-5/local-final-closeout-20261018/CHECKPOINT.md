# Checkpoint

更新时间：2026-10-18（Asia/Shanghai）

工作树：`F:\sw95local-20261018`

分支：`fix/phase95-local-final-closeout-20261018-short`

## 当前结论

- **阶段 9.5：PARTIAL。** 已在专用 API 37 AVD 上使用 SAF 导入真实 GBK 小说、实测 GLM、运行当前 Debug APK；三个 campaign QA 主线含 14 个行动级提交，另有 1 个隔离分支 method-bound 行动，共 15 个 agent-driven action turns。没有任何一项计作真人决定。stage 5 候选仍不能通过既有 validator，非空 evidence L1 和玩家验收未完成。M3-07 入口修复已由新 GLM candidate 实际体现，但未形成可采用阶段内容。
- **Runtime 工程收束：PASS-ENGINEERING（限已列修复）。** 八项确认代码缺陷各自有 RED → 最小修复 → GREEN。Core 当前 1,356/1,356，mobile typecheck、version check 通过；standalone APK 已安装，build/install SHA 完全一致，并在无 Metro 时冷启动回到书库。
- **阶段 9 历史遗留：PARTIAL。** 真人有效决定 0/80、独立试玩 0/4；自然结局、合法 save-10 / Stage-1/8、TalkBack、匹配 L1/L2 10+10 和 live crash/outbox 矩阵未完成。

## M0–M7

- **M0 — PASS-ENGINEERING。** 实际 `origin/main=87eef899281f267a17e02357cc643dd475cabd7c`；隔离工作树施工，原 checkout、其他 worktrees 与忽略的历史账本未清理或覆盖。PR #15 未合并。
- **M1 — PASS-DEVICE（限定范围）。** AVD `ShineWord_Phase95_LocalFinal_20261018` / `emulator-5556` / API 37 / Android 17 / 1080×2400 @420dpi。M3-07 修复后 standalone Debug APK build/install SHA-256 均为 `C42A097F490595E3C46D1BC04CCB73E7BE0700F892170DFCD8CDA054EE755B44`，内含 JS bundle；`adb install -r` 保留数据。SQLite 稳定只读副本 integrity check 为 `ok`。
- **M2 — PARTIAL。** 小说原件 Windows-936/GBK，7,178,905 bytes；经 SAF 私有副本导入，设备解析 1,504 章 / 3,260 chunks。GLM 只使用 0–9,600 code points 部分范围；world package 未含 method 条目，campaign L1 全部 fixed empty evidence，章节数差异未归因。
- **M3 — PARTIAL / HUMAN-ACCEPTANCE-NOT-RUN。** 骰点、Narrator、状态原子提交、下一轮、3 个 deferred consumer 均有 Android/DB/物理请求证据。15 个 action turns 均由 QA 执行者驱动；最新 GLM replan candidate 修正了缺失入口，但其后果触发与消费者约束未闭合，stage 5 仍没有采用候选。
- **M4 — PARTIAL / BLOCKED-ASSET。** 小说 world 及其 campaigns/branches 合计 69 次真实物理请求：68 次 HTTP 200、1 次旧配置 HTTP 401；`outcome_unknown=0`、在途=0，观测峰值并发=2。mock world 的 429 与 `outcome_unknown` 保留且未重派。live turn force-stop/outbox 与合法历史存档矩阵未运行。
- **M5 — PARTIAL。** 长会话 PSS/RSS 与 GfxInfo、软键盘、1.3 字号及终局页有限检查通过；TalkBack、多尺寸设备与匹配 10+10 未运行。
- **M6 — PASS-ENGINEERING / DEVICE-LIMITED。** 八项已确诊缺陷均 RED → GREEN，并各自保留独立修复提交；全量 Core 1,356/1,356、mobile typecheck、version check、standalone APK 构建、安装身份和脱离 Metro 冷启动通过。M3-07 入口指导经新 GLM job 验证到候选结构；M3-06 的 action-reference mismatch 没有在新候选中出现，故其 live repair path 未触发。stage 5 仍未修好。
- **M7 — exact-head check follows documentation push.** PR #15 Checks 页面只以最终当前 head 的 Core Verify 与 Android Verify 为准；旧 SHA 的成功记录不替代本次 head 检查。最终状态须在推送后复核并记录于 PR 正文，PR 不自动合并。

## 最新 GLM 账本汇总

用户明确授权本项目测试不限额度，调用遵守并发限制。范围限定真实小说 world、对应三个 campaigns 和 mapped branches：69 次物理请求、68 次 HTTP 200、1 次旧配置 HTTP 401、0 次 unknown、0 次在途。token totals：input / output / reasoning `949,571 / 225,651 / 34,277`；实扣人民币金额无法从应用账本确认。新增的 4 个请求分属两个独立 2-attempt job，串行完成。独立 mock world 的 HTTP 429 和 `outcome_unknown` 没有计入。

## 新增运行时 QA 分支

- 主第三局 `camp-mvdjtr22-main` 仍为 v12，plan revision 4；stage 1–4 已完成，stage 5 `content_prep` unresolved。
- 修复指导后的 stage-5 job `replan:camp-mvdjtr22-bmvdofyhk:v10:2026-10-18T10:24:17.433Z:4d0f2b492d38` 使用 2/2 顺序 HTTP 200；候选因 `firstSituation.methods[1].firstStep.destinationId: not valid for skill_check` 被拒，未采用。没有重派该 job。
- 隔离 branch `camp-mvdjtr22-bmvdo8467` 的 `turn-0010` 从 v9 原子提交到 v10，method-bound skill check 结果 failure；Narrator HTTP 200、Planner=0。另有 `camp-mvdjtr22-bmvdo5ftn` 是从 main v12 回退形成的空 v11 branch，没有玩家行动或模型请求。
- 本轮使用应用回退功能新增 `camp-mvdjtr22-bmvdq6wys`，由 main v12 创建到 v11，parent 保留为 main；创建操作本身无模型请求。随后按序创建两个新 replan job：`6bcf6ccbf908`（2/2 HTTP 200）与 `5e606cda282e`（M3-07 修复后 2/2 HTTP 200）。后一个 candidate 将 stage-5 concrete main 的 activation 设为 null，但因两项后果的延迟/不同 trigger/后续消费者约束 invalid；没有 adoption，分支仍 v11、plan revision 4。旧 `camp-mvdjtr22-bmvdo5ftn` 及其他分支继续保留。
- 原有终局分支 `camp-mvdjtr22-bmvdn9sgt` v11 和 stage-5 早期失败分支 `camp-mvdjtr22-bmvdnlm88` v10 均保留。新分支/行动是预期 QA 写入；没有清理模拟器数据，main 历史状态未变。

## 当前仍需外部/历史材料的验收

1. 真人完成 80 个有效剧情决定；独立试玩 4 人与反馈。
2. 非空来源证据 L1、package-level method 供给、stage 5 可采用内容、第四项 deferred consequence 消费及玩家回应。
3. 合法 save-10 / Stage-1/8；force-stop、Narrator 中断、outbox 故障与旧 worker fencing 的设备注入矩阵。
4. TalkBack、API/屏幕尺寸矩阵和 matched 10+10 L1/L2 数据。
5. 小说标题计数差异、全书构建预算与实际 CNY 账单金额仍未知。
6. M3-07 start-node repair guidance 已在新 GLM job 的候选结构中实际生效；M3-06 action-reference mismatch guidance 尚未被 live candidate 触发。stage 5 未采用计划，未继续自动生成新 job。
7. PR #15 的最终提交 SHA 和 exact-head CI 以 push 后 GitHub 实际结果为准；不自动合并。
