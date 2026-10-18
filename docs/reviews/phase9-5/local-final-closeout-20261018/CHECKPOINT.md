# Checkpoint

更新时间：2026-10-18（Asia/Shanghai）

工作树：`F:\sw95local-20261018`

分支：`fix/phase95-local-final-closeout-20261018-short`

## 当前结论

- **阶段 9.5：PARTIAL。** 已在专用 API 37 AVD 上使用 SAF 导入真实 GBK 小说、实测 GLM、运行当前 Debug APK；三个 campaign QA 主线含 14 个行动级提交，另有 1 个隔离分支 method-bound 行动，共 15 个 agent-driven action turns。没有任何一项计作真人决定。stage 5 候选仍不能通过既有 validator，非空 evidence L1 和玩家验收未完成。
- **Runtime 工程收束：PASS-ENGINEERING（限已列修复）。** 四项确认代码缺陷各自有 RED → 最小修复 → GREEN：开局证据补建、Canon 开局计划采用、Runtime 终态行动门控、campaign stage 本地 completion producer 的修复指导。Core 当前 1,354/1,354，mobile typecheck、version check 通过；当前 APK 已安装，build/install SHA 完全一致。
- **阶段 9 历史遗留：PARTIAL。** 真人有效决定 0/80、独立试玩 0/4；自然结局、合法 save-10 / Stage-1/8、TalkBack、匹配 L1/L2 10+10 和 live crash/outbox 矩阵未完成。

## M0–M7

- **M0 — PASS-ENGINEERING。** 实际 `origin/main=87eef899281f267a17e02357cc643dd475cabd7c`；隔离工作树施工，原 checkout、其他 worktrees 与忽略的历史账本未清理或覆盖。PR #15 未合并。
- **M1 — PASS-DEVICE（限定范围）。** AVD `ShineWord_Phase95_LocalFinal_20261018` / `emulator-5556` / API 37 / Android 17 / 1080×2400 @420dpi。Debug APK build/install SHA-256 均为 `3B3A8A33463F74A37617BBE5B47B000D80CC1BBE51972D00404D3E5A6BE03167`，`adb install -r` 保留数据。SQLite 稳定只读副本 integrity check 为 `ok`。
- **M2 — PARTIAL。** 小说原件 Windows-936/GBK，7,178,905 bytes；经 SAF 私有副本导入，设备解析 1,504 章 / 3,260 chunks。GLM 只使用 0–9,600 code points 部分范围；world package 未含 method 条目，campaign L1 全部 fixed empty evidence，章节数差异未归因。
- **M3 — PARTIAL / HUMAN-ACCEPTANCE-NOT-RUN。** 骰点、Narrator、状态原子提交、下一轮、3 个 deferred consumer 均有 Android/DB/物理请求证据。15 个 action turns 均由 QA 执行者驱动；第三局 stage 5 内容候选仍被拒绝，没有把内容验证降级。
- **M4 — PARTIAL / BLOCKED-ASSET。** 小说 world 及其 campaigns/branches 合计 65 次真实物理请求：64 成功 HTTP 200、1 次旧配置 HTTP 401；`outcome_unknown=0`、在途=0，观测峰值并发=2。mock world 的 429 与 `outcome_unknown` 保留且未重派。live turn force-stop/outbox 与合法历史存档矩阵未运行。
- **M5 — PARTIAL。** 长会话 PSS/RSS 与 GfxInfo、软键盘、1.3 字号及终局页有限检查通过；TalkBack、多尺寸设备与匹配 10+10 未运行。
- **M6 — PASS-ENGINEERING / DEVICE-LIMITED。** 四项已确诊缺陷均 RED → GREEN；全量 Core、mobile typecheck、version check、APK 构建和安装身份复核通过。stage 5 修复后候选仍被另一条既有 validator 规则拒绝，不代表 stage 5 已修复。
- **M7 — IN PROGRESS。** 报告和代码已在 PR #15 分支。待提交报告、push，然后核对 PR 当前精确 HEAD 的 Core Verify 和 Android Verify；旧 SHA checks 不作为最终证据，不自动合并。

## 最新 GLM 账本汇总

用户明确授权本项目测试不限额度，调用遵守并发限制。范围限定真实小说 world、对应三个 campaigns 和 mapped branches：65 次物理请求、64 次 HTTP 200、1 次旧配置 HTTP 401、0 次 unknown、0 次在途。token totals：input / output / reasoning `846,768 / 204,224 / 30,202`；实扣人民币金额无法从应用账本确认。后续新增请求逐条等待完成。独立 mock world 的 HTTP 429 和 `outcome_unknown` 没有计入。

## 新增运行时 QA 分支

- 主第三局 `camp-mvdjtr22-main` 仍为 v12，plan revision 4；stage 1–4 已完成，stage 5 `content_prep` unresolved。
- 修复指导后的 stage-5 job `replan:camp-mvdjtr22-bmvdofyhk:v10:2026-10-18T10:24:17.433Z:4d0f2b492d38` 使用 2/2 顺序 HTTP 200；候选因 `firstSituation.methods[1].firstStep.destinationId: not valid for skill_check` 被拒，未采用。没有重派该 job。
- 隔离 branch `camp-mvdjtr22-bmvdo8467` 的 `turn-0010` 从 v9 原子提交到 v10，method-bound skill check 结果 failure；Narrator HTTP 200、Planner=0。另有 `camp-mvdjtr22-bmvdo5ftn` 是从 main v12 回退形成的空 v11 branch，没有玩家行动或模型请求。
- 原有终局分支 `camp-mvdjtr22-bmvdn9sgt` v11 和 stage-5 早期失败分支 `camp-mvdjtr22-bmvdnlm88` v10 均保留。新分支/行动是预期 QA 写入；没有清理模拟器数据，main 历史状态未变。

## 当前仍需外部/历史材料的验收

1. 真人完成 80 个有效剧情决定；独立试玩 4 人与反馈。
2. 非空来源证据 L1、package-level method 供给、stage 5 可采用内容、第四项 deferred consequence 消费及玩家回应。
3. 合法 save-10 / Stage-1/8；force-stop、Narrator 中断、outbox 故障与旧 worker fencing 的设备注入矩阵。
4. TalkBack、API/屏幕尺寸矩阵和 matched 10+10 L1/L2 数据。
5. 小说标题计数差异、全书构建预算与实际 CNY 账单金额仍未知。
6. PR #15 的最终提交 SHA 和 exact-head CI 以 push 后 GitHub 实际结果为准；不自动合并。
