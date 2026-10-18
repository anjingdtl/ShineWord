# M3：Android Runtime 因果回放

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL / AGENT-DRIVEN-DEVICE-AND-REAL-MODEL。本文记录测试执行者在用户授权下按 QA 场景操作的真实 APK/GLM 过程；不是独立玩家记录，不计入 0/80 真人有效决定。

## 世界与开局

- 使用 SAF 导入的用户小说 CRLF 私有副本，world scope 0–9,600 code points，published partial package / ready。
- 模拟器 `emulator-5556` 最新安装的 Debug APK 与构建物 SHA-256 同为 `C42A097F490595E3C46D1BC04CCB73E7BE0700F892170DFCD8CDA054EE755B44`；使用 `adb install -r` 保留原应用数据库与 Keychain。
- Canon 角色建议由 GLM campaign plan 生成并采用。由执行者选择程岩（罗兰）、序5锚点与开局目标；两局 branch 独立，世界相同。采取这些测试选择不等于真人已作选择。

## 第一局：5 个 action turns

| Turn | action / method id | 结果 | 骰点与版本 |
|---|---|---|---|
| `turn-0003` | observe / `method-observe-cell` | failure | `[3]`, d4, diff 4, margin -1；v2→3 |
| `turn-0004` | observe / `method-observe-cell` | failure | `[3]`, d4, diff 4, margin -1；v3→4 |
| `turn-0005` | talk / `method-talk-jailer` | success；testimony counter 0→10 | 无骰点记录；v4→5 |
| `turn-0006` | observe / `method-observe-cell` | failure | `[4]`, d4, diff 6, margin -2；v5→6 |
| `turn-0007` | skill_check / `method-pressure-barov` | severe_failure | `[1]`, d4, diff 6, margin -5；v6→7 |

五个 action turns 均提交成功；Planner/Narrator 成功调用按项目策略串行记录。Testimony 的即时状态效果后续保持 10。最后一轮使第一局 Runtime `failed`，ending ID `ending-case-lost`，ending event 绑定 `turn-0007`。此前可继续提交下一行动，因此该局覆盖了多个 round 的实际 UI/持久化循环；剧情选择均为执行者 QA 输入。

## 第二局：启动、单行动与重规划终结

- campaign `camp-mvdiaaip` 创建后 adoption turn committed；后续 plan jobs 逐条采用，scene actors 实例化。
- 执行者选择默认上下文行动 `观察周围环境` 一次。它触发真实 Planner（2,712 / 227 / 20 tokens）及 Narrator（1,788 / 462 / 72 tokens）。
- action method `m-open-inspection`、dice `[1]`、d4、difficulty 4、margin -3、`severe_failure`，turn committed 版本 v2→v3。
- action 后 UI 显示“目标受阻”状态和下一轮建议；自动 campaign plan replan 随后两次顺序提交（v3→4→5），Runtime 结束为 `failed`，ending ID `ending-failure`、at stateVersion 5。此局只有一个玩家模拟行动，没有继续模拟终局之后的行动。
- 当前终局页层级验证：`guidance-submit-*`=0、观察操作=0，composer disabled；终局行动阻断与权威 Runtime status 一致。

## 第三局：campaign-scope L1、L2 与延迟消费者

- Campaign `camp-mvdjtr22`，branch `camp-mvdjtr22-main`，使用同一已导入 partial world；数据库快照 integrity check 为 `ok`。下表只列行动与规则/账本指标，不复制小说或模型叙事。

| Turn | routing / method | 结果 | roll 与状态版本 |
|---|---|---|---|
| `turn-0002` | L2 / Planner 生成后绑定 `m-follow-and-observe` | failure | `[3]` / d4 / diff 4 / margin -1；v1→2 |
| `turn-0003` | L1 / `m-street-talk` | success | 无骰点；v2→3 |
| `turn-0006` | L1 / `m-barov-pass` | success | `[3,6,2]` / 3d6 / diff 4 / margin +2；v5→6 |
| `turn-0008` | L1 / `m-miner-testimony` | success | 无骰点；v7→8 |
| `turn-0009` | L1 / `m-inspect-collapse` | failure | `[3]` / d4 / diff 4 / margin -1；v8→9 |
| `turn-0010` | L1 / `m-enter-shaft` | success | `[4,3,6]` / 3d6 / diff 6 / margin 0；v9→10 |
| `turn-0011` | L1 / `m-earn-jailer-trust` | full_success | `[4,5,6]` / 3d6 / diff 3 / margin +3；v10→11 |
| `turn-0012` | L2 / freeform observe | success | 无骰点；v11→12 |

L1 turns 的 `ruleBinding` 存在、evidence policy 显式 fixed `[]`，没有 Planner request；turn-0002 与 turn-0012 均有真实 Planner 和 Narrator HTTP 200。novel-world 最终 ledger 为 Planner 8 / Narrator 17，其中第三局 main 分别 2 / 8，另有 stage-5 QA branch 和 save-10 continuation 各一次 Narrator。所有 QA action 均为 agent-driven，不算真人决定。中间 `manage-replan` system turns 不计入第三局 main 的 8 个 player-like actions。

turn-0010 将 stage 3 推至 succeeded，消费 `conseq-town-tension`；turn-0011 将 stage 4 推至 succeeded，消费 `conseq-barov-attention` 和 `con-tension-peaked`。三个消费者分别在后续状态产生了 `town_tension_escalated`、`barov_offer_made`、`tension_peaked` 效果。在 main 的 v12 snapshot 中，第四项 `con-barov-offer` 尚未消费；后续隔离 QA branch 完成 stage 5 后，未独立审计这项 consequence 的下游状态。

stage 5 仍有 `content_prep` unresolved。早期 v10 replan 候选因缺少可达的 ordinary-success completion effect 被拒，对该 validator 错误缺少定向 repair guidance 的代码缺陷已由 `SW95-M3-03` 以 RED→GREEN 修复。修复后新 v10 job 两个物理 attempt 均 HTTP 200，但候选因 `firstSituation.methods[1].firstStep.destinationId` 对 `skill_check` 无效而被拒；未采用、branch 未前进。早期 v11 replan 的两次物理 attempt均 HTTP 200，但候选因 full_success/success effects 超出既有上限被拒；这一类错误缺少限额内保留 completion 的 repair guidance 已由 `SW95-M3-04` 加 RED→GREEN 修复，早期 job 没有被重派。revision 4 只包含 stage 4 campaign situation。stage 5 没有已采用的方法内容；降级自由输入 L2 仍提交成功 v11→v12，但未验证 stage 5 任务完成或第四项后果。

## 因果与恢复边界

- 两局 roll record、turn expected/committed stateVersion、ending ID 均来自 SQLite ledger；最终本机只读 snapshot `PRAGMA integrity_check=ok`。测试没有用重放修补或修改已提交 turn。
- 第一局话语行动令 testimony +10 并延续到后续状态，这是已证实的即时 effect。第三局 stage-4 三项 deferred consequence 与后续 stage-8 success branch 的另一项 consequence 均有真实 trigger→discharge→consumer effect；early-exit branch 还验证终局 cancellation。此前报告的 stage-5 `con-barov-offer` 与其玩家回应仍未验，R4/V95-07/A19 保持 PARTIAL。
- 第二局 terminal state 在异步重规划完成后落为 failed；其两次 manage-replan turn 仍按递增 stateVersion 保存，没覆盖 turn v3。UI 以 Runtime status 门控后续玩家行动。
- 本小说 world 与三个 branch 的持久应用账本无 unknown 或在途请求，观测 peak concurrency 为 2。此结论只覆盖该账本；之后宿主机配对 pilot 的两条 transport unknown 单独记录于 `REAL_NOVEL_AND_LLM.md`，未重派。既有请求中出现一次 campaign_plan interval 与 Planner/Narrator interval 的重叠；其余长请求等待完成，没有手工重派。mock world 的 429/unknown 与小说账本分开记录。

## 证据界限

- 本轮真实 Android/GLM 验证的是限定局部流程。没有玩家对因果/剧情作判断；L1 使用空 evidence，不覆盖非空来源证据；外部试玩、全书构建和实时行动中断未完成。历史 save-10 已原生导入并续玩，stage 5 已在隔离 QA branch 完成，不将这些 agent actions 算作玩家接受。
- 终局截图带模型生成文本，只保留在本机 `C:\Temp\shineword-phase95-local-final\after-plans.png`，不提交。数据库副本同样只留本机。

## 本轮后续 QA 增量

- 修复 `SW95-M3-03` 后，在 fresh stage-only v10 branch `camp-mvdjtr22-bmvdofyhk` 运行新 job `replan:camp-mvdjtr22-bmvdofyhk:v10:2026-10-18T10:24:17.433Z:4d0f2b492d38`。触发原因为 `stage_content_prepared_ahead` 与 `stage_content_target:stage-5`，请求预算 2；两个顺序 `campaign_plan` attempt 均 HTTP 200。终态为 invalid，错误为 `firstSituation.methods[1].firstStep.destinationId: not valid for skill_check.`；无 unknown/in-flight、无 plan adoption，branch 仍 v10、plan revision 4。
- 在隔离 branch `camp-mvdjtr22-bmvdo8467` 从 v9 提交新 `turn-0010` 到 v10，method-bound skill check 结果为 failure；Narrator HTTP 200、Planner=0。它是 agent-driven QA，不计真人决定。
- APK 更新之后创建的空 rewind branch `camp-mvdjtr22-bmvdo5ftn` 保留为 v11，无新 action 和模型 request。主第三局 `camp-mvdjtr22-main` 仍 v12，历史 turn / roll 未改写。隔离 branch `camp-mvdjtr22-bmvdq6wys` 从 main v12 回退创建为 v11，随后两个 replan logical job 各用 2/2 HTTP 200；没有采用候选，branch stateVersion 仍为 11 / revision 4。
- 在上述 replan 候选被正确拒绝后，真实 UI action `turn-0014` 在隔离 branch `camp-mvdjtr22-bmvdq6wys` 将 stage 5 从 active 成功提交（v13→v14）；无骰点、无 Planner request，Narrator 为 HTTP 200。随后 `stage_content_prepared_ahead + stage_content_target:stage-7` 触发 bounded plan job；2 个串行 `campaign_plan` attempts 均 HTTP 200，plan revision 7 被采用。分支到 v15、stage 6 active、stage 7/8 planned。主 branch `camp-mvdjtr22-main` 保持 v12/r4。
- 该 stage-5 QA branch 当时有 16 turns、5 roll records、16 snapshots；屏幕冷重开后 play composer 和 progress card 可见。此为 agent-driven UI 工程验证，不是真人选择，也没有据此宣称 stage-5 `con-barov-offer` 已完成消费。
- stage-8 修复回归前，novel-world ledger 快照为 77 requests / 76 HTTP 200 / 1 旧配置 401 / 0 unknown / 0 active；campaign_plan 42、Planner 8、Narrator 17。对应 token 为 input/output/reasoning `1,117,695 / 258,924 / 40,902`。其后新增两个 stage-8 Narrator HTTP 200，novel-world/campaign scope 现有 79 次已知记录 / 78 HTTP 200 / 1 旧配置 401；全局总量与 token 边界见 `REAL_NOVEL_AND_LLM.md`。

## 2026-10-19：终局清理与延迟后果消费对照

- 原 stage-8 来源 branch `camp-mvdjtr22-bmvdq6wys` 在 v20 已 completed，但 `consequence-barov-network` 仍 pending；其 trigger 要求 stage 8 succeeded。该冻结 branch 保持只读，未在原历史上补偿或改写。
- 通过 Android 应用的“回退到上一状态（v19）”创建新 QA branch `camp-mvdjtr22-bmve4dw7q`。选择 `method-walk-away` 后 v20 campaign completed、stage 8 active；修复后 pending consequence 以 `campaign_ended` 取消，事件 `campaign_consequence_cancelled` 落库，原 trigger 仍保留。
- 再从 v19 创建独立 branch `camp-mvdjtr22-bmve4gsqe`，选择 `method-hold-the-line`。真实骰点/结算与 Narrator 后 turn-0020 v19→v20 成功，stage 8 succeeded；`consequence-barov-network` 完成 trigger→discharge，并产生 `barov_network_opened`、`knowledge_discovered`。权威知识行是 actor `actor-player` / entry `camp-clue-85fd11ae76f638529f5773d4` / `told` / source `turn-0020` / stateVersion 20。
- 两条新行动各有一个串行 Narrator attempt，均 HTTP 200；没有 Planner attempt、429、unknown 或重派。两次选择来自 QA 执行者，不记为真人决定。
- 修复证据和 APK 指纹见 `evidence/android-terminal-consequence-cleanup-20261019.json`。这条 stage-8 对照不修改或替代 main v12/r4，也不宣称玩家已对后果作出反馈。
