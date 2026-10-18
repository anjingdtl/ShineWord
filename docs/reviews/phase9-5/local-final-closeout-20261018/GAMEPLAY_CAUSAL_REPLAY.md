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

L1 turns 的 `ruleBinding` 存在、evidence policy 显式 fixed `[]`，没有 Planner request；turn-0002 与 turn-0012 均有真实 Planner 和 Narrator HTTP 200。点时快照 novel-world ledger 聚合为 Planner 8 / Narrator 14，其中第三局分别 2 / 8；最新 ledger roll-up 已增加后续 QA jobs / action，现为 Planner 8 / Narrator 15。所有 QA action 均为 agent-driven，不算真人决定。中间 `manage-replan` system turns 不计入 8 个第三局 player-like actions。

turn-0010 将 stage 3 推至 succeeded，消费 `conseq-town-tension`；turn-0011 将 stage 4 推至 succeeded，消费 `conseq-barov-attention` 和 `con-tension-peaked`。三个消费者分别在后续状态产生了 `town_tension_escalated`、`barov_offer_made`、`tension_peaked` 效果。第四项 `con-barov-offer` 仍 pending。

stage 5 仍有 `content_prep` unresolved。早期 v10 replan 候选因缺少可达的 ordinary-success completion effect 被拒，对该 validator 错误缺少定向 repair guidance 的代码缺陷已由 `SW95-M3-03` 以 RED→GREEN 修复。修复后新 v10 job 两个物理 attempt 均 HTTP 200，但候选因 `firstSituation.methods[1].firstStep.destinationId` 对 `skill_check` 无效而被拒；未采用、branch 未前进。早期 v11 replan 的两次物理 attempt均 HTTP 200，但候选因 full_success/success effects 超出既有上限被拒；这一类错误缺少限额内保留 completion 的 repair guidance 已由 `SW95-M3-04` 加 RED→GREEN 修复，早期 job 没有被重派。revision 4 只包含 stage 4 campaign situation。stage 5 没有已采用的方法内容；降级自由输入 L2 仍提交成功 v11→v12，但未验证 stage 5 任务完成或第四项后果。

## 因果与恢复边界

- 两局 roll record、turn expected/committed stateVersion、ending ID 均来自 SQLite ledger；最终本机只读 snapshot `PRAGMA integrity_check=ok`。测试没有用重放修补或修改已提交 turn。
- 第一局话语行动令 testimony +10 并延续到后续状态，这是已证实的即时 effect。第三局另外验证三项 deferred consequence 的真实 trigger→discharge→consumer effect；第四项仍 pending，且 stage 5 玩家后续回应未验，R4/V95-07/A19 仍 PARTIAL。
- 第二局 terminal state 在异步重规划完成后落为 failed；其两次 manage-replan turn 仍按递增 stateVersion 保存，没覆盖 turn v3。UI 以 Runtime status 门控后续玩家行动。
- 本小说 world 与三个 branch 的真实账本无 unknown 或在途请求，观测 peak concurrency 为 2。出现一次 campaign_plan interval 与 Planner/Narrator interval 的重叠；之后的长请求均等待完成，没有手工重派。mock world 的 429/unknown 与本小说真实 GLM world 分开记录。

## 证据界限

- 本轮真实 Android/GLM 仅验证这些局部流程。没有玩家对因果/剧情作判断；L1 使用空 evidence，不覆盖非空来源证据；外部试玩、全书构建、旧 save 导入、实时行动中断与 stage 5 route 未完成。
- 终局截图带模型生成文本，只保留在本机 `C:\Temp\shineword-phase95-local-final\after-plans.png`，不提交。数据库副本同样只留本机。

## 本轮后续 QA 增量

- 修复 `SW95-M3-03` 后，在 fresh stage-only v10 branch `camp-mvdjtr22-bmvdofyhk` 运行新 job `replan:camp-mvdjtr22-bmvdofyhk:v10:2026-10-18T10:24:17.433Z:4d0f2b492d38`。触发原因为 `stage_content_prepared_ahead` 与 `stage_content_target:stage-5`，请求预算 2；两个顺序 `campaign_plan` attempt 均 HTTP 200。终态为 invalid，错误为 `firstSituation.methods[1].firstStep.destinationId: not valid for skill_check.`；无 unknown/in-flight、无 plan adoption，branch 仍 v10、plan revision 4。
- 在隔离 branch `camp-mvdjtr22-bmvdo8467` 从 v9 提交新 `turn-0010` 到 v10，method-bound skill check 结果为 failure；Narrator HTTP 200、Planner=0。它是 agent-driven QA，不计真人决定。
- APK 更新之后创建的空 rewind branch `camp-mvdjtr22-bmvdo5ftn` 保留为 v11，无新 action 和模型 request。主第三局 `camp-mvdjtr22-main` 仍 v12，历史 turn / roll 未改写。隔离 branch `camp-mvdjtr22-bmvdq6wys` 从 main v12 回退创建为 v11，随后两个 replan logical job 各用 2/2 HTTP 200；没有采用候选，branch stateVersion 仍为 11 / revision 4。
- novel-world + campaigns/mapped branches 的最新物理 ledger 是 69 requests / 68 HTTP 200 / 1 旧配置 401 / 0 unknown / 0 active；campaign_plan 共 36 次。输入、输出、推理 token 分别 949,571 / 225,651 / 34,277。与本文上方早期 snapshot 不同，最终统计见 `REAL_NOVEL_AND_LLM.md`。
