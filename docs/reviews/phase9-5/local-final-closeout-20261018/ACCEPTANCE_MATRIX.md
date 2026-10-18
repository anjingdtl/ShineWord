# M0–M7 / G0–G5 / V95 / R0–R9 / A01–A40 验收矩阵

更新：2026-10-18（Asia/Shanghai）
当前结论：Runtime 收束工程针对性修复 PASS-ENGINEERING（仅限明列范围）；阶段 9.5 PARTIAL；阶段 9 历史遗留 PARTIAL。自动化、partial world ready 和 CI 都不等价于真实玩家验收。

状态词：PASS-ENGINEERING=当前源码确定性/集成合同通过；PASS-DEVICE=当前 APK/专用设备明确完成；PASS-REAL=真实模型及玩家旅程完成；PARTIAL=有受限证据且仍缺合同项；BLOCKED=资源/真人缺失；NOT RUN=未执行。


## M 节点

| 节点 | 状态 | 当前证据 / 缺口 |
|---|---|---|
| M0 | PASS-ENGINEERING | 现场 `git ls-remote` 确认实际 origin/main=87eef899281f267a17e02357cc643dd475cabd7c；隔离 worktree 施工，原 main / checkout / ignored 历史账本未改写。用户授权 GLM 不限额度；小说 world + branch ledger 实测并发峰值 2。 |
| M1 | PASS-DEVICE（限定范围） | API 37 专用 AVD 运行 standalone Debug APK，安装物与构建物 SHA-256 均为 C42A097F490595E3C46D1BC04CCB73E7BE0700F892170DFCD8CDA054EE755B44。真实小说开局、action、roll、Narrator、commit 及历史 save-10 原生恢复后继续运行通过。stage 5 在隔离 QA branch 完成并进入 stage 6；原 main 仍 v12/r4。 |
| M2 | PARTIAL | SAF 导入真实 GBK 小说；0–9,600 code-point partial package；真实 GLM opening_goal / campaign_plan。world package method entries=0；第三局 campaign artifact 实际提供 6 个 fixed-empty-evidence L1，另有 2 个 L2；全书未发送、非空 evidence L1 未验。 |
| M3 | PARTIAL / USER-PLAY-DEFERRED | 累计 17 个 agent-driven QA action turns，含真实骰点、Narrator、原子提交、下一轮与 stage-5 branch 实际推进到 stage 6。真实 L1/L2 分流、三个已审计的延迟消费者通过；第 4 条后果链没有独立下游消费对照。main branch 仍 v12/r4；真人体验由用户后续完成，不是自动化交付阻滞。 |
| M4 | PARTIAL / SAVE-10-DEVICE-PASS | 合法历史 save-10 与精确依赖世界包通过 Android 原生导入、历史 turn/roll hash 对照、冷启动和续玩；合成 API 37 AVD 上另完成 Planner 在途 force-stop、冷启动后归为 unknown 且未重派（stateVersion 0，SQLite integrity ok）。小说范围 77 次真实 attempt 为 76 HTTP 200、1 旧配置 401；mock/合成 unknown 均保留。Narrator 前后中断、outbox/响应写盘故障、旧 worker 设备竞态与 Stage-1/8 资产仍未完成。 |
| M5 | PARTIAL | 长会话 PSS/RSS/GfxInfo、键盘、1.3 字号、终局页、portrait/landscape 以及 360×800dp 虚拟显示均有有限证据；暗色模式控件断言通过。TalkBack 语音/焦点、多窗口、API 24/真实小屏和匹配 L1/L2 10+10 未验。 |
| M6 | PASS-ENGINEERING / DEVICE-PASS-限定范围 | 八项修复均先 RED→最小修复→GREEN，独立提交；Core 1,356/1,356、mobile typecheck、version check、standalone APK 构建与无 Metro 安装冷启动通过。M3-07 提示的目标修复在真实候选中验证；虽该候选未采用，后续 stage-5 action 与 plan r7 已在隔离设备 branch 运行通过。 |
| M7 | TRACKED ON PR #15 | 每次 push 后只认 PR 当前 head 的 Core Verify / Android Verify exact-head 结果；[PR #15 checks](https://github.com/anjingdtl/ShineWord/pull/15/checks) 为权威状态页，PR 正文记录最后核验的 SHA 与 run。PR 保持开放且不自动合并。 |


## R 节点

| ID | 状态 | 当前依据 / 尚缺 |
|---|---|---|
| R0 | PASS-ENGINEERING | 当前 Core 1,356/1,356；Canon 去重、导入安全、adoption、terminal 与 bounded stage-plan repair guidance 合同全量通过。真人完整旅程仍缺。 |
| R1 | PARTIAL / DEVICE-AGENT-L1-PATH | exact method/readiness 与冻结合同通过；第三局实际 6 个 campaign-scope fixed-empty-evidence L1 无 Planner；world package 仍无 method entry，非空 evidence L1 未验。 |
| R2 | PARTIAL | settlement/reducer/replay 工程合同通过；真实行动 roll、状态变化与 3 个 delayed consumer effect 有提交记录；无真人复核。 |
| R3 | PARTIAL | novel ledger 与独立 mock ledger 已分开审计；mock unknown 保留，长期历史预算账本不改写、不借额。 |
| R4 | PARTIAL / AGENT-DRIVEN-CHAIN | 3 项 deferred consequence 已逐项核实触发、消费与下游效果；stage-5 action 和 stage-6 adoption 已通过隔离 branch，第四条 consequence 尚缺独立的触发/消费/下游读回及真人反馈。 |
| R5 | PARTIAL | unknown park、原子提交/fence 工程覆盖；合成 Planner 在途强停后冷启动归为 unknown 且没有重派。已提交 live turn 的 Narrator/outbox 故障、响应写盘失败及旧 worker 设备竞态仍未做。 |
| R6 | PARTIAL | package privacy/validation Core 通过；本轮真实行动未完成三意图私密投影审计。 |
| R7 | PARTIAL / USER-PLAY-DEFERRED | novel world + campaigns/mapped branches 持久 ledger 有 77 次物理请求：76 HTTP 200、1 次旧配置 401、该 scope 内 unknown=0；另有 2 条身份未保存的 host transport unknown，未重派。campaign_plan 42 / Planner 8 / Narrator 17。17 个 action turns 均 agent-driven；L1 6 次、主 QA L2 8 次，L1 仅 fixed empty evidence；真人决定 0，留由用户后续体验。 |
| R8 | PARTIAL | 长会话性能样本已记录；未完成 matched L1/L2 10+10。配对 pilot 两条路都落入 Planner，transport outcome unknown，identity 未持久化，未重派。独立玩家仍为 0/4。 |
| R9 | TRACKED ON PR #15 | 最终 SHA 的 Core Verify / Android Verify 见 [PR #15 checks](https://github.com/anjingdtl/ShineWord/pull/15/checks)；必须核当前 PR HEAD。 |


## G 门

| ID | 状态 | 当前依据 / 缺口 |
|---|---|---|
| G0 | PARTIAL | 用户授权本轮 GLM 不限额度；持久小说 world + campaigns/branches 有 76 success / 1 旧 401，mock 429/unknown 分离；另有 2 条 host transport unknown，dispatch 与 provider receipt 未确认。持久 ledger 当前无在途，观测最大并发=2。input/output/reasoning tokens 为 1,117,695 / 258,924 / 40,902。CNY 费用未知，历史 510/600 ignored ledger 未改动。 |
| G1 | PARTIAL | shared L1/L2 authority 与 strict candidate contracts 在 Core 通过；campaign-scope 有 6 个真实 L1，但 evidenceIds 均为空，package method entry=0。 |
| G2 | PARTIAL | Runtime status、即时 counter、3 个 delayed consumer effects 与结束 UI 可对账；隔离 branch 完成 stage 5 并进入 stage 6；第 4 条后果消费和真人反馈未验。 |
| G3 | PARTIAL | 更新配置后的 opening_goal HTTP 200；后续真实 campaign plan、Planner/Narrator、stage-5 action 和 plan-r7 adoption 均有账本证据。真人选择及玩家反馈没有。 |
| G4 | PARTIAL | 当前 APK 完成有限代理 QA 和终局门控；字号、键盘样本通过。TalkBack 与独立试玩未完成。 |
| G5 | PARTIAL | mock 429/unknown 与应用数据保留；API 37 合成 AVD 另验证 Planner 在途强停后 unknown 保留且冷启动不重派；三局 rolls/turns 可读。live turn/outbox crash、历史迁移矩阵仍缺。 |


## V95

| ID | 状态 | 当前依据 / 缺口 |
|---|---|---|
| V95-01 | PASS-ENGINEERING / DEVICE-LIMITED | 唯一 GameStateSnapshot 与现有 commit pipeline 合同通过；三局 roll / turn version 可核对。 |
| V95-02 | PASS-ENGINEERING | 缺 difficulty/evidence/权限仍拒绝；小说内容未补默认值。 |
| V95-03 | PARTIAL | 6 个 campaign-scope L1 已派发并提交；fixed empty evidence，未覆盖非空来源证据、不同证据资格或匹配性能分布。 |
| V95-04 | PARTIAL | 真实设备骰点与四档结果记录在代理 QA turns；没有真人 roll。 |
| V95-05 | PARTIAL | 旧 mock unknown 保持 needs_review；合成 AVD 的 in-flight Planner 强停后 cold-start 转为 outcome_unknown 且无重派。已提交 live turn/outbox crash 仍未执行。 |
| V95-06 | PASS-ENGINEERING | Graph 仍是只读衍生 projection，Core 回归通过。 |
| V95-07 | PARTIAL / AGENT-DRIVEN-CHAIN | 3 个 delayed consequences 已触发、消费并产生下游事件；stage-5 action 已推动 QA branch 至 stage 6，但第 4 条 consequence 的下游效果对照和玩家回应未验。 |
| V95-08 | NOT RUN | 真实三意图到公开输出的全层隐私对照未运行。 |
| V95-09 | PARTIAL | action/method refs 与 turn commit 有样本；没有真人开局与完整行动供给审计。 |
| V95-10 | PARTIAL / SAVE-10-RESTORE-PASS | 合法历史 save-10 与匹配世界依赖已在 Android 原生导入，六条历史 turn 与两条历史 roll 的 hash/数值匹配；恢复后续行动及冷启动继续通过。Stage-1/8 仍缺。 |
| V95-11 | PARTIAL / AGENT-DRIVEN | 三局开局、角色、campaign、17 个 agent-driven action turns 与终局/后续运行在设备完成；stage 5 仅在隔离 QA branch 通过，全部选择由 QA 执行者作出。 |
| V95-12 | PARTIAL / USER-PLAY-DEFERRED | 独立试玩仍为 0/4；本轮不把独立试玩当作自动化工程交付门。 |

## A01–A40（阶段 9 遗留）

| ID | 状态 | 当前依据或缺口 |
|---|---|---|
| A01 | NOT RUN | 未完成同小说三种意图的完整旅程。 |
| A02 | PARTIAL | 执行者在代理 QA 中选 Canon Roland 与开局锚点；没有真人选择、原创身份对照或锚点替换。 |
| A03 | NOT RUN | 未验证晚到来源、按需补建及正式采用后可玩。 |
| A04 | NOT RUN | 未完成明确目标和开放探索对照。 |
| A05 | PARTIAL | 第三局代理行动推进 stage 1–4；隔离 QA branch 的真实 UI 行动完成 stage 5 并采用 plan r7，stage 6 active。原 main v12/r4 未同步，且没有玩家沿完整计划行动。 |
| A06 | NOT RUN | 未测救援/存活后规划。 |
| A07 | PASS-ENGINEERING | 当前 Core 覆盖无效/截断候选不能绕过生产校验。 |
| A08 | NOT RUN | 未在当前 APK 运行 ready 前强停/占位恢复。 |
| A09 | PARTIAL | 一次性与事务恢复由 Core 覆盖；设备上未做双启动/采用中断。 |
| A10 | NOT RUN | 无两条真实路径汇合后的状态/机会差异。 |
| A11 | PARTIAL / DEVICE-QA | Core routing parity 回归通过；设备上一次 contextual action 真实派发并提交，但不是玩家决定。 |
| A12 | NOT RUN | 未取样模板外但能力允许的组合行动。 |
| A13 | PASS-ENGINEERING | 稳定引用、过期/异地引用合同在当前 Core 回归。 |
| A14 | PARTIAL | 四档合同与确定性测试通过；代理 QA 设备局有真实骰点记录，未有真人 roll。 |
| A15 | PARTIAL | 设备代理局包含 failure、success、severe_failure；没有真人完整样本或独立玩家复核。 |
| A16 | PARTIAL | settlement 合同通过；设备验证 testimony +10 immediate state change 与 failed ending，没有 delayed/no_change 人类对照。 |
| A17 | PARTIAL | 一次性奖励、有限供给工程回归通过；无真实提前解决/绕过旅程。 |
| A18 | NOT RUN | 偏离、暂停、改目标与恢复 UI 矩阵未运行。 |
| A19 | PARTIAL / AGENT-DRIVEN-CHAIN | 三项延迟后果在真实设备回合中触发、消费并产生下游事件；stage-5 action 后的第 4 条后果尚未完成独立下游读回，真人响应未验。 |
| A20 | PARTIAL | replan/frozen input/fencing 当前 Core 回归；无设备竞态。 |
| A21 | PARTIAL | budget reservation/fence 的 Core 回归通过；无设备后台竞争矩阵。 |
| A22 | PARTIAL | 本轮没有目标、顺序、规则、风格全身份配对。 |
| A23 | PARTIAL | 当前设备有三个同世界独立 campaign branch；本轮从 main v12 通过应用 rollback 功能新建 v11 branch 并保留父链。完整 fork/rewind/知识与后果隔离审计仍未验。 |
| A24 | PASS-ENGINEERING | 冻结 JSON/hash/缺依赖拒绝由当前 Core 覆盖。 |
| A25 | PARTIAL | 请求窗/能力资格合同通过；未覆盖本轮所有材料超窗情形。 |
| A26 | PARTIAL | 本轮物理 attempt 可审计；历史私有账本没有取得/对账。 |
| A27 | PARTIAL | novel GLM 旧 401、独立 mock 429 与 network_unknown 已分开分类；无真实 provider timeout 或实际费用对账。 |
| A28 | PARTIAL | Core 覆盖冻结 roll/幂等；设备实际记录骰点与 turn commit，但没有 force-stop / cold-start roll replay。 |
| A29 | PARTIAL | 响应校验/修复/采用合同在 Core；没有 live recovery journey。 |
| A30 | PASS-ENGINEERING | 编辑/取消与旧 worker fence 拒绝在当前 Core 回归。 |
| A31 | PARTIAL | fork/rewind 工程合同在当前 Core；完整知识/后果/计划分支隔离未在设备验收。 |
| A32 | PARTIAL | 合法 save-10 导入、依赖包绑定和历史 hash 精确读回在设备通过；Stage-1/8 历史资产与旧 schema migration 矩阵仍缺。 |
| A33 | PARTIAL | 合成秘密拒绝有工程合同；真实三意图及日志输出全层隐私对照未运行。 |
| A34 | PASS-DEVICE（限定范围） | failed Runtime 终局页已复测：变更行动隐藏、composer disabled，与 Runtime ending 投影一致；自然结局质量未验。 |
| A35 | PARTIAL | API 37、软键盘、1.3 字号、旋转往返、360×800dp 虚拟显示与暗色模式核心控件通过；TalkBack spoken/focus、API 24、真实小屏与完整大字页面未验。 |
| A36 | PARTIAL / USER-PLAY-DEFERRED | 独立试玩与六维评分为 0/4；用户会自行体验，独立四人评审仍未完成。 |
| A37 | BLOCKED-REAL-PERFORMANCE | 没有匹配 10+10 的真实 L1/L2 数据。 |
| A38 | PARTIAL | standalone 当前 APK 与 installed base hash 匹配并在无 Metro 冷启动；真实小说与 save-10 branch 共完成 17 个 agent-driven action turns，真人完整旅程未跑。 |
| A39 | PARTIAL | 同一世界运行三个 campaign QA 主线，并保留多个隔离 branches；未完成三局身份/状态/知识隔离审计。 |
| A40 | PASS-ENGINEERING | 当前全量 Core 的长期记忆/retrieval 确定性覆盖通过；不计玩家决定。 |

## 总体历史验收

- 本轮真人完整剧情决定：0；阶段 9 要求的 80 个真人有效决定尚未开始。17 个 agent-driven player-like actions 不计入 80；用户已说明真人体验由其后续完成，不作为本轮自动化交付门。
- 独立外部试玩：0/4；自然结局：NOT RUN；真实匹配性能 10+10：NOT RUN；stage-5 用户路径与后果反馈未完成。上述状态仍不构成“真人验收已通过”。
- 合法 save-10 已恢复并成功续玩；Stage-1/8 仍缺。模拟器保留三局 QA、恢复 campaign 和隔离 stage-5 运行数据；不将 agent-driven 角色或行动计作玩家决定。
