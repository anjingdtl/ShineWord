# C-17 真实模型旅程简报（授权额度内）

> 授权：2026-10-27 用户批准 D4 + C-17 预算。端点：MiniMax `MiniMax-M3.1-Flash`（api.minimaxi.com，OpenAI 兼容）。
> 预算：授权总额 60 物理请求；本轮共支出 **30**（设备 scope 10/60 + host scope 20/20，后者含 18 笔 world_extract 质量重试——见 §3）。**剩余 30 保留未动。**
> 驱动：`tools/convergence-real-journey.cjs`（host 侧 production pipeline：createMobileHarness + 真实 HTTP + scoped 预算逐笔 reserve/mark/finish）。产物：`.tmp/convergence/journey/journey.jsonl`、`journey.sqlite`（含从设备二进制安全拷回的已发布世界）。

## 1. 真实往返证据（全部 HTTP 200，密钥未出内存）

| 环节 | 结果 | 证据 |
|---|---|---|
| 世界构建（T-D world_extract） | 设备上 2026-10-28 完成（高档案，1 笔 44s + 前期 3 笔）；host 重放因 MiniMax 输出质量与抽取校验的兼容性进入重试循环，18 笔后停（§3） | scoped 账本逐笔审计 |
| **本地基线开局（W3）** | **零请求**：`buildPlanningContext → buildLocalBaselineModel → compileAndValidateCandidate（零错误）→ adoptOpeningPlan`，L1 方法 baseline-survey/ask/engage | journey.jsonl `local_baseline physical:0`（两次） |
| **真实前台回合（L1+Narrator）** | turn-0001：本地 L1 合同 + **真实 Narrator**（24.0s，1 笔物理，grade=automatic，真实叙事文本「你向会客厅内的人打听消息。十分钟后，在场者透露了关键信息…」） | journey.jsonl `turn index:1` |
| **真实 Planner+Narrator 回合与 W4c 降级** | turn-0002：2 笔物理（Planner+Narrator），Narrator 响应未过校验 → **降级为本地模板并正常提交**（3432ms，文本「（本地叙事）成功：…检定 1d4 [4]…」，grade=success 与冻结骰点一致） | journey.jsonl `turn index:2`；降级路径与测试 `convergence-narrator-degrade` 一致 |
| 预算硬上限 | 第 21 笔在 reservation 边界被 scoped 硬顶拒绝（「20-request hard cap reached before physical dispatch」），错误如实上浮为 unknown 待确认，**未自动重发** | journey.jsonl `turn_failed`；phase9-budget.cjs 行为 |
| 冻结材料安全拒绝 | offline 用例更换端点后，FrozenTurnInput 校验以「Frozen turn input/source/model mismatch; refusing dispatch」拒绝——配置漂移不能复用冻结材料，符合合同 | 驱动输出 |
| 后台后继预备（T-C） | 一直在 queued（预算上限阻其派发）——机制本身在设备侧已有成功先例（2026-10-26 两笔 campaign_plan 后台完成并采用） | 设备 scoped 账本 |

## 2. 与验收矩阵的对应

- **C-17**：真实模型下的完整旅程已覆盖「本地基线开局（0 请求）→ L1 本地合同 + 真实 Narrator → 真实 Planner 回合 → Narrator 失败降级提交 → 预算硬顶」。**未覆盖**：80 个有效决定级长旅程、后台预备在本轮预算内的派发（机制证据在先）、外部真人试玩（C-18 单独安排）。状态从 BLOCKED 改为 **PASS-PARTIAL（证据如实登记）**。
- **C-15**（离线 10 回合）：自动化证据 = `convergence-narrator-degrade.test.cjs`（offline fast-fail → 本地模板提交，7 用例）+ turn-0002 真实降级 + 冻结安全拒绝；**设备飞行模式 10 回合未执行**（设备环境多轮 unknown 污染 + 模拟器三次崩溃，性价比不再合理）。状态 **PARTIAL**。

## 3. 诚实记录：host 世界抽取的 18 笔消耗

MiniMax 高档对 `opening-90s-3` 抽取提示词的响应多次通过 HTTP 200 但未过本地内容校验（引用闭包/格式），驱动的 review→resume 循环消耗 18 笔后停。对比：同一提示词在设备 GLM（9.5）与设备 MiniMax（2026-10-28 高档案）均一次通过。**怀疑供应商相关的输出风格差异，未据此改任何校验器或提示词**（红线 1：不放宽；如需跨供应商适配应单独立项评审）。该 18 笔计入本轮 30/60。

## 4. 预算账本

- 设备 scope `convergence-20261026`：10/60（world_extract 2、style_analyzer 1、opening_goal 1、campaign_plan 3、world_extract 3〔低档失败重试〕）
- host scope `convergence-host-20261029`：20/20（world_extract 18、planner 1、narrator 1）——scope 附 `priorScopes` 注记与设备 scope 同属一次授权
- 无任何 outcome_unknown 被自动重放；unknown 均如实停账待人工确认。
