# Checkpoint

更新时间：2026-10-19（Asia/Shanghai）

工作树：`F:\sw95local-20261018`

分支：`codex/phase95-automated-matrix-20261019`

## 当前结论

- **阶段 9.5：自动化工程交付目标达成后总体仍标 PARTIAL。** 已在专用 API 37 AVD 上导入真实 GBK 小说、测通 GLM、恢复 save-10 并续玩，stage-5 推进至 stage 6；stage-8 sibling branches 真实验证终局取消与成功后果消费/知识写入。累计 19 个 action turns 全为 agent-driven QA。世恒哥明确真人体验由其自行完成，不是本轮自动化交付阻滞。非空 evidence L1、历史 Stage-1/8 与部分设备故障注入证据仍缺；两条宿主机模型 pilot transport unknown 保留且未重派。
- **Runtime 工程收束：PASS-ENGINEERING（限已列修复）。** 已登记代码缺陷各自有 RED → 最小修复 → GREEN；最新 `npm run verify:core` 1,361/1,361，mobile typecheck、version check 通过。现有 M4 AVD 上另完成两次 mock 驱动 synthetic UI action 与 delayed consequence 消费；它不关闭设备故障注入矩阵。
- **阶段 9 历史遗留：PARTIAL。** 真人有效决定 0/80、独立试玩 0/4；自然结局、Stage-1/8、TalkBack 与设备故障矩阵未完成。production synthetic fixture 的 live GLM matched 10+10 已完成，真实小说 package method 路径仍未覆盖。save-10 已恢复/续玩。真人游玩由世恒哥后续完成，不是自动化交付门。

## M0–M7

- **M0 — PASS-ENGINEERING。** 最近实际 `origin/main=55ceb085a5b3638840ea6bbff160f259e6abbb65`（PR #15 合并后）；隔离工作树施工，原 checkout、其他 worktrees 与忽略的历史账本未清理或覆盖。当前后续 PR #16 尚待推送本轮提交并核验 exact-head CI。
- **M1 — PASS-DEVICE（限定旅程；最新包限 install/process smoke）。** 既有 API 37 主 AVD 上安装 hash `F1D3817...` 已完成 save-10 与 stage-8 回归。Canon clue 修复 APK hash `0ACA6E449598342A409F05790F84C1BF7DF6C1C821A0439F49FDEA943B8D896F` 已在现存 M4 AVD `emulator-5560` `adb install -r`，数据保留、MainActivity resumed、进程存在、AndroidRuntime errors=0；该轮 Maestro 无结果、UI assertion NOT RUN。之前书库冷启动 5/5、战役列表导航 7/7 属于先前 APK。注册 AVD 从 10 台清理到 3 台，F 盘空间增加 45.53 GiB；详见 `AVD_CLEANUP_LOCAL.md`。
- **M2 — PARTIAL。** 小说原件 Windows-936/GBK，设备解析 1,504 章 / 3,260 chunks。最新独立真实 GLM scope 用 9,601 code points 串行完成 timeline/extract/mapping（3 次 HTTP 200，无 429/unknown），但因 1 blocking + 3 major 内容审查项未发布 package。新修复以 synthetic SQLite package RED→GREEN 验证场景同源 Lore clue 编译，尚无新 real package 证明非空 evidence L1；旧 world package method 数仍 0。另有 6 次 fixed-empty-evidence campaign-scope L1 和 synthetic non-empty-evidence matched 10+10；不替代真实 package 路径。
- **M3 — PARTIAL / USER-PLAY-DEFERRED。** 19 个 agent-driven action turns 均不算玩家决定。stage-5 QA branch 的 consequence trigger/discharge 与下一轮 frozen context 已有证据，但下一轮 Narrator status 未对账；stage-8 sibling branch 取消/成功消费与知识写入有 Android 证据。世恒哥后续自行真人体验。
- **M4 — PARTIAL / SAVE-10-DEVICE-PASS / M4-SYNTHETIC-UI-PASS。** 历史 save-10 与精确依赖包通过 Android 原生导入、六条历史 turn/两条 roll 精确对照、冷启动和后续行动。本轮 M4 AVD 另以 local mock 完成开局规划、两次行动、一次骰点、Narrator、原子提交与 delayed consequence trigger/discharge；branch v1→v3、SQLite integrity=`ok`、outbox pending=0。小说/campaign ledger 当前 79 条记录（78 HTTP 200、1 次旧配置 HTTP 401），独立开篇样本另有 2 条 HTTP 200；matched live synthetic 30 条及其他独立 scope 另计。设备账本中的 HTTP 429 与同逻辑 unknown 指向本地 `10.0.2.2:8765` mock，不是 GLM；该 unknown 保留未重派。另两次宿主机 Planner transport attempt 为无 HTTP status 的潜在 unknown，identity 未持久化，未重派。Stage-1/8、Narrator/outbox/旧 worker 设备注入矩阵仍缺。
- **M5 — PARTIAL。** 长会话 PSS/RSS 与 GfxInfo、软键盘、1.3 字号、终局页、portrait/landscape、360×800dp 虚拟显示与暗色主题控件通过；synthetic production fixture 上 live GLM matched 10+10 通过。TalkBack spoken/focus、多窗口、API 24/真实小尺寸仍缺。
- **M6 — PASS-ENGINEERING / DEVICE-LIMITED。** 最新 `npm run verify:core` 1,361/1,361、mobile typecheck、version check 通过。新增 mock scope 回归仅改测试 helper；生产 APK 未变。M4 UI evidence 是 synthetic/local mock，不声称 GLM 或真人验收。
- **M7 — PENDING EXACT-HEAD CI ON PR #16.** 本地新增提交推送后，需按 PR #16 当前 head 核验 Core Verify 与 Android Verify；旧 SHA 的 success 不替代最终 head 检查。PR #15 已合并入当前 main。

## 最新 GLM 账本汇总

用户明确授权本项目测试不限额度，调用遵守并发限制。stage-8 QA 后，原小说 world/campaign/mapped branches 的持久应用账本有 79 次记录（78 次 HTTP 200、1 次旧配置 401）；独立 9,601 code point opening sample 另有 2 次 HTTP 200。Synthetic matched run 和其他独立 scope 也计入全局已知 113 次（112 次 HTTP 200、1 次旧配置 401）。另有两个宿主机 transport attempt 的 dispatch outcome unknown、无 HTTP status，identity 未持久化；保留且未重派。真实 GLM 429=0。已汇总 token totals `1,152,193 / 265,801 / 41,097` 不含最近两个 Narrator attempt；全量 token 数和实扣人民币金额无法从现有脱敏账本确认。设备账本里唯一 429 与同逻辑 unknown 指向 local `10.0.2.2:8765` fixture，并保留未重派。细项见 `evidence/glm-429-attribution-and-retest-sanitized.json`、`evidence/matched-live-l1-l2-synthetic-20261019.json` 与 `evidence/host-glm-pilot-transport-unknown-sanitized.json`。

## 新增运行时 QA 分支

- 主第三局 `camp-mvdjtr22-main` 保持 v12 / plan revision 4；stage-5 QA 修复路径未写入 main。
- 修复指导后的 stage-5 job `replan:camp-mvdjtr22-bmvdofyhk:v10:2026-10-18T10:24:17.433Z:4d0f2b492d38` 使用 2/2 顺序 HTTP 200；候选因 `firstSituation.methods[1].firstStep.destinationId: not valid for skill_check` 被拒，未采用。没有重派该 job。
- 隔离 branch `camp-mvdjtr22-bmvdo8467` 的 `turn-0010` 从 v9 原子提交到 v10，method-bound skill check 结果 failure；Narrator HTTP 200、Planner=0。另有 `camp-mvdjtr22-bmvdo5ftn` 是从 main v12 回退形成的空 v11 branch，没有玩家行动或模型请求。
- 此隔离 branch `camp-mvdjtr22-bmvdq6wys` 最终在 v15 / plan revision 7：agent-driven stage-5 `turn-0014` 于 v13→v14 成功提交（无骰点、Narrator HTTP 200）；随后 2/2 顺序 plan attempts 采用 r7，stage 6 active、stage 7/8 planned。branch 有 16 turns、5 rolls、16 snapshots，冷重开后 composer/progress card 可见。M3-07 前一个 invalid candidate 本身没有采用。脱敏详情见 `evidence/stage5-live-adoption-and-replay-sanitized.json`。
- 合法 Save-10 在独立 campaign `camp-mvdsy3v4` / branch `camp-mvdsy3v4-main` 原生恢复；6 条历史 turn 和 2 条历史 roll 精确匹配。新增 `turn-0006` v5→v6 成功提交后 cold relaunch 通过。详情见 `evidence/save10-device-restore-sanitized.json`。
- 原有终局分支 `camp-mvdjtr22-bmvdn9sgt` v11 和 stage-5 早期失败分支 `camp-mvdjtr22-bmvdnlm88` v10 均保留。新分支/行动是预期 QA 写入；没有清理模拟器数据，main 历史状态未变。

## 当前仍需外部/历史材料的验收

1. 真人完成 80 个有效剧情决定；独立试玩 4 人与反馈。
2. 非空来源证据 L1 与 package-level method 供给；stage-5 `con-barov-offer` 在原著 main v12/r4 的独立下游读回及剧情反馈。
3. Stage-1/8 历史资产；force-stop、Narrator 中断、outbox 故障与旧 worker fencing 的设备注入矩阵。
4. TalkBack 焦点/播报、多窗口、API/真实屏幕尺寸矩阵；synthetic production fixture 的 matched 10+10 已完成，真实小说 package method 与非空来源 evidence L1 样本仍缺。宿主机 pilot 的两次潜在 unknown identity 未持久化、未重派，未重用其 logical request。虚拟 360×800dp 冒烟已通过，不替代真实小尺寸设备。
5. 小说标题计数差异、全书构建预算与实际 CNY 账单金额仍未知。
6. M3-07 start-node repair guidance 已在候选结构中实际生效；M3-06 action-reference mismatch guidance 尚未被 live candidate 触发。后续 stage-5 UI action/plan adoption 已在 QA branch 验证。
7. 真人 80 决定及独立 4 人试玩由世恒哥后续体验；明确不计作 agent 自动化交付门，也不宣称已验收。
8. PR #16 的最终提交 SHA 和 exact-head CI 以最后一次 push 后 GitHub 实际结果为准；PR #15 已并入 main。

## 2026-10-19 最新状态

- 最新代码修复提交：`f93742f`（Canon scene Lore link RED）与 `2e1a9c8`（minimal fix）。定向 1/1、`npm run verify:core` 1,359/1,359、mobile typecheck、version check 均通过；APK install/process smoke 通过，但 Maestro 与 ADB accessibility hierarchy 均无结果，屏幕断言 NOT RUN。
- 最新 APK SHA-256：`F1D3817DFC3F3972FEBF2C415CE19ABFB3867DE66DD983252AF7860BF8054F88`。终局取消 branch 与 success/discharge/knowledge branch 均通过 Android UI + GLM；各一个 Narrator HTTP 200，无 unknown。
- Live GLM matched 10+10 在 synthetic production fixture 上完成，30 HTTP 200、最大并发 1；其后 stage-8 QA 新增两个串行 Narrator HTTP 200。累计至少 113 个已知物理请求（112 HTTP 200、1 旧配置 401），另有 2 host transport unknown 保留未重派。旧 mock 429 与真实 endpoint 明确分开。
- 真人决定/独立试玩由用户后续完成，不列为 agent 阻滞。自动化待项见 `FINAL_REPORT.md`：真实小说 package method/non-empty-evidence L1（当前 package 无 method entry）、Narrator/outbox/worker 的设备中断注入、Stage-1/8 原始资产和旧 schema、TalkBack/multiwindow/API24/真实小屏，以及 stage-5 `con-barov-offer` 的完整独立消费链。
- M7：当前后续 PR 为 #16；本轮新增提交尚未 push。推送后以 PR #16 当前 head 的 Checks 为准，不使用旧 SHA 的检查结果。
