# Checkpoint

更新时间：2026-10-19（Asia/Shanghai）

工作树：`F:\sw95local-20261018`

分支：`fix/phase95-local-final-closeout-20261018-short`

## 当前结论

- **阶段 9.5：自动化工程交付目标达成后总体仍标 PARTIAL。** 已在专用 API 37 AVD 上导入真实 GBK 小说、测通 GLM、运行当前 APK、恢复历史 save-10 并续玩；真实 UI stage-5 行动与 plan r7 adoption 在隔离 branch 推进到 stage 6。累计 17 个 action turns 全为 agent-driven QA。你已说明真人体验由你后续进行，不作为本轮自动化交付阻滞；报告仍明确记录尚无真人验收。非空 evidence L1、Stage-1/8 与故障注入缺项按证据缺口保留。额外宿主机模型 pilot 留有两条无法恢复 identity 的 transport unknown，未重派。
- **Runtime 工程收束：PASS-ENGINEERING（限已列修复）。** 九项确认代码缺陷各自有 RED → 最小修复 → GREEN。Core 当前 1,357/1,357，mobile typecheck、version check 通过；standalone APK 已装到两台现存 AVD，哈希一致，冷启动/书库/战役导航通过。
- **阶段 9 历史遗留：PARTIAL。** 真人有效决定 0/80、独立试玩 0/4；自然结局、Stage-1/8、TalkBack 与设备故障矩阵未完成。production synthetic fixture 的 live GLM matched 10+10 已完成，真实小说 package method 路径仍未覆盖。save-10 已恢复/续玩。真人游玩由世恒哥后续完成，不是自动化交付门。

## M0–M7

- **M0 — PASS-ENGINEERING。** 实际 `origin/main=87eef899281f267a17e02357cc643dd475cabd7c`；隔离工作树施工，原 checkout、其他 worktrees 与忽略的历史账本未清理或覆盖。PR #15 未合并。
- **M1 — PASS-DEVICE（限定范围）。** AVD `ShineWord_Phase95_LocalFinal_20261018` / `emulator-5556` / API 37 / Android 17 / 1080×2400 @420dpi。最新 standalone Debug APK build/install SHA-256 均为 `113B8EEB41EE167694C574F7B9506929352927F76697A83895059E1B6F7B979F`，内含 JS bundle；`adb install -r` 保留数据。主 AVD library cold-launch 5/5、M4 AVD campaign-list navigation 7/7。注册 AVD 从 10 台清理到 3 台，F 盘空间增加 45.53 GiB；详见 `AVD_CLEANUP_LOCAL.md`。
- **M2 — PARTIAL。** 小说原件 Windows-936/GBK，7,178,905 bytes；经 SAF 私有副本导入，设备解析 1,504 章 / 3,260 chunks。GLM 使用有界开篇；另以 9,601 code point 新样本独立完成 `world_extract` 与 style analyzer。world package 未含 method 条目；第三局有 6 次 fixed-empty-evidence campaign-scope L1；另以 synthetic production fixture + non-empty evidence 完成 live matched 10+10。不能以合成 fixture 代替原著 package method 路径；章节数差异未归因。
- **M3 — PARTIAL / USER-PLAY-DEFERRED。** 骰点、Narrator、状态原子提交、下一轮、3 个 deferred consumer 均有 Android/DB/物理请求证据；隔离 QA branch 的 stage-5 action 与 plan r7 adoption 推进至 stage 6。17 个 action turns 均由 QA 执行者驱动；真人体验由世恒哥后续完成。
- **M4 — PARTIAL / SAVE-10-DEVICE-PASS。** 历史 save-10 与精确依赖包通过 Android 原生导入、六条历史 turn/两条 roll 精确对照、冷启动和后续行动。持久小说/campaign ledger 有 77 条记录，独立开篇样本另有 2 条 GLM HTTP 200；合计 79 条已知记录（78 HTTP 200、1 次旧配置 HTTP 401）。设备账本中的 HTTP 429 与同逻辑 unknown 指向本地 `10.0.2.2:8765` mock，不是 GLM；该 unknown 保留未重派。另两次宿主机 Planner transport attempt 为无 HTTP status 的潜在 unknown，identity 未持久化，未重派。Stage-1/8、live force-stop/outbox/旧 worker 矩阵仍缺。
- **M5 — PARTIAL。** 长会话 PSS/RSS 与 GfxInfo、软键盘、1.3 字号、终局页、portrait/landscape、360×800dp 虚拟显示与暗色主题控件通过；synthetic production fixture 上 live GLM matched 10+10 通过。TalkBack spoken/focus、多窗口、API 24/真实小尺寸仍缺。
- **M6 — PASS-ENGINEERING / DEVICE-LIMITED。** 九项已确诊缺陷均 RED → GREEN，并各自保留修复提交；全量 Core 1,357/1,357、mobile typecheck、version check、standalone APK 构建、安装身份和 Maestro 冷启动/导航通过。M3-07 特定候选仍被 validator 正确拒绝；之后隔离 branch 的真实 UI stage-5 action/plan adoption 进入 stage 6。M3-06 特定错误未被新候选触发。
- **M7 — TRACKED ON PR #15.** PR 正文记录最新推送 HEAD 与该 HEAD 的 Core Verify / Android Verify 状态、run 链接；Checks 页为权威状态。旧 SHA 的成功记录不替代当前 head 检查，PR 保持开放且不自动合并。

## 最新 GLM 账本汇总

用户明确授权本项目测试不限额度，调用遵守并发限制。原小说 world、对应三个 campaigns 和 mapped branches 的持久应用账本有 77 次记录：76 次 HTTP 200、1 次旧配置 HTTP 401。另有独立 9,601 code point 开篇样本 2 次 HTTP 200；合计 79 次已知记录（78 次 HTTP 200、1 次 HTTP 401）。另有两个宿主机 transport attempt 的 dispatch outcome unknown、无 HTTP status，identity 未持久化，不计入 79 条；未重派。真实 GLM 429=0。成功 token totals：input / output / reasoning `1,124,366 / 262,607 / 40,920`；实扣人民币金额无法从应用账本确认。设备账本里唯一 429 与同逻辑 unknown 指向 local `10.0.2.2:8765` fixture，并保留未重派。细项见 `evidence/glm-429-attribution-and-retest-sanitized.json` 与 `evidence/host-glm-pilot-transport-unknown-sanitized.json`。

## 新增运行时 QA 分支

- 主第三局 `camp-mvdjtr22-main` 保持 v12 / plan revision 4；stage-5 QA 修复路径未写入 main。
- 修复指导后的 stage-5 job `replan:camp-mvdjtr22-bmvdofyhk:v10:2026-10-18T10:24:17.433Z:4d0f2b492d38` 使用 2/2 顺序 HTTP 200；候选因 `firstSituation.methods[1].firstStep.destinationId: not valid for skill_check` 被拒，未采用。没有重派该 job。
- 隔离 branch `camp-mvdjtr22-bmvdo8467` 的 `turn-0010` 从 v9 原子提交到 v10，method-bound skill check 结果 failure；Narrator HTTP 200、Planner=0。另有 `camp-mvdjtr22-bmvdo5ftn` 是从 main v12 回退形成的空 v11 branch，没有玩家行动或模型请求。
- 此隔离 branch `camp-mvdjtr22-bmvdq6wys` 最终在 v15 / plan revision 7：agent-driven stage-5 `turn-0014` 于 v13→v14 成功提交（无骰点、Narrator HTTP 200）；随后 2/2 顺序 plan attempts 采用 r7，stage 6 active、stage 7/8 planned。branch 有 16 turns、5 rolls、16 snapshots，冷重开后 composer/progress card 可见。M3-07 前一个 invalid candidate 本身没有采用。脱敏详情见 `evidence/stage5-live-adoption-and-replay-sanitized.json`。
- 合法 Save-10 在独立 campaign `camp-mvdsy3v4` / branch `camp-mvdsy3v4-main` 原生恢复；6 条历史 turn 和 2 条历史 roll 精确匹配。新增 `turn-0006` v5→v6 成功提交后 cold relaunch 通过。详情见 `evidence/save10-device-restore-sanitized.json`。
- 原有终局分支 `camp-mvdjtr22-bmvdn9sgt` v11 和 stage-5 早期失败分支 `camp-mvdjtr22-bmvdnlm88` v10 均保留。新分支/行动是预期 QA 写入；没有清理模拟器数据，main 历史状态未变。

## 当前仍需外部/历史材料的验收

1. 真人完成 80 个有效剧情决定；独立试玩 4 人与反馈。
2. 非空来源证据 L1、package-level method 供给、main branch 内容补建、第四项 deferred consequence 的独立下游读回及剧情反馈。
3. Stage-1/8 历史资产；force-stop、Narrator 中断、outbox 故障与旧 worker fencing 的设备注入矩阵。
4. TalkBack 焦点/播报、多窗口、API/真实屏幕尺寸矩阵和 matched 10+10 L1/L2 数据。宿主机 pilot 的两次潜在 unknown identity 未持久化、未重派；恢复 matched benchmark 前须采用可持久账本与合格 L1 fixture。虚拟 360×800dp 冒烟已通过，不替代真实小尺寸设备。
5. 小说标题计数差异、全书构建预算与实际 CNY 账单金额仍未知。
6. M3-07 start-node repair guidance 已在候选结构中实际生效；M3-06 action-reference mismatch guidance 尚未被 live candidate 触发。后续 stage-5 UI action/plan adoption 已在 QA branch 验证。
7. 真人 80 决定及独立 4 人试玩由世恒哥后续体验；明确不计作 agent 自动化交付门，也不宣称已验收。
8. PR #15 的最终提交 SHA 和 exact-head CI 以最终 push 后 GitHub 实际结果为准；不自动合并。

## 2026-10-19 最新状态

- 当前代码提交：`d8d9c3e`，新增 `SW95-M6-02` 发布诊断卡片修复。验证：定向 RED→GREEN、Core 1,357/1,357、mobile typecheck、version check、standalone APK build/install identity、两台既有 API-37 AVD Maestro cold-launch/navigation PASS。
- 最新 APK SHA-256：`113B8EEB41EE167694C574F7B9506929352927F76697A83895059E1B6F7B979F`；书库 flow 5/5，战役列表 flow 7/7。没有新建 AVD 或提交行动/模型请求。
- Live GLM matched 10+10 在 synthetic production fixture 上完成，30 HTTP 200、最大并发 1；现有 localhost/mock 429 与真实 endpoint 明确分开。累计 111 known / 110 HTTP200 / 1 old 401，另有 2 host transport unknown 未重派。
- 真人决定/独立试玩由用户后续完成，不列为 agent 阻滞。其余自动化待项见 `FINAL_REPORT.md`：真实小说 package method/non-empty-evidence L1、设备 Narrator/outbox/worker 故障矩阵、Stage-1/8 与旧 schema/fork-rewind 资产、TalkBack/multiwindow/API24/真实小屏、第四后果链下游核验。
- M7：PR #15 保持开放且未合并；最新 head、Core/Android exact-head SHA、run 与结论维护在 PR 正文并以 Checks 页面为准。
