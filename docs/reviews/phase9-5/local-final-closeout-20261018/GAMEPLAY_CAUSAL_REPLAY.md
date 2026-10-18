# M3：Android Runtime 因果回放

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL / AGENT-DRIVEN-DEVICE-AND-REAL-MODEL。本文记录测试执行者在用户授权下按 QA 场景操作的真实 APK/GLM 过程；不是独立玩家记录，不计入 0/80 真人有效决定。

## 世界与开局

- 使用 SAF 导入的用户小说 CRLF 私有副本，world scope 0–9,600 code points，published partial package / ready。
- 模拟器 `emulator-5556` 安装的 Debug APK 与构建物 SHA-256 同为 `C5B27FAEAAF8B1DF60946A8B826952DC4C1EC77A3AB4EA3BC26072FDFA26AF10`；安装保留原应用数据库与 Keychain。
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

## 因果与恢复边界

- 两局 roll record、turn expected/committed stateVersion、ending ID 均来自 SQLite ledger；最终本机只读 snapshot `PRAGMA integrity_check=ok`。测试没有用重放修补或修改已提交 turn。
- 第一局话语行动令 testimony +10 并延续到后续状态，这是已证实的即时 effect。两局最终 `deferredConsequences=[]`，没有真实延迟触发→消费→后续消费者回路，R4/V95-07/A19 仍 PARTIAL。
- 第二局 terminal state 在异步重规划完成后落为 failed；其两次 manage-replan turn 仍按递增 stateVersion 保存，没覆盖 turn v3。UI 以 Runtime status 门控后续玩家行动。
- 第一次完成真实模型调用期间，测试执行者没有重复提交、确认 unknown 或制造并发请求。实时 request ledger peak concurrency 为 1。mock world 的 429/unknown 与本小说真实 GLM world 分开记录。

## 证据界限

- 本轮真实 Android/GLM 只验证这些局部流程。没有玩家对因果/剧情作判断，没有 L1 eligibility、外部试玩、全书构建、旧 save 导入、实时行动中断或 delayed consumer。
- 终局截图带模型生成文本，只保留在本机 `C:\Temp\shineword-phase95-local-final\after-plans.png`，不提交。数据库副本同样只留本机。
