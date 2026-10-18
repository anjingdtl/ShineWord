# M0–M7 / G0–G5 / V95 / R0–R9 / A01–A40 验收矩阵

更新：2026-10-18（Asia/Shanghai）
当前结论：Runtime 收束工程针对性修复 PASS-ENGINEERING（仅限明列范围）；阶段 9.5 PARTIAL；阶段 9 历史遗留 PARTIAL。自动化、partial world ready 和 CI 都不等价于真实玩家验收。

状态词：PASS-ENGINEERING=当前源码确定性/集成合同通过；PASS-DEVICE=当前 APK/专用设备明确完成；PASS-REAL=真实模型及玩家旅程完成；PARTIAL=有受限证据且仍缺合同项；BLOCKED=资源/真人缺失；NOT RUN=未执行。


## M 节点

| 节点 | 状态 | 当前证据 / 缺口 |
|---|---|---|
| M0 | PASS-ENGINEERING | 现场 `git ls-remote` 确认实际 origin/main=87eef899281f267a17e02357cc643dd475cabd7c；隔离 worktree 施工，原 main / checkout / ignored 历史账本未改写。用户授权 GLM 不限额度；小说 world + branch ledger 实测并发峰值 2。 |
| M1 | PASS-DEVICE（限定范围） | API 37 专用 AVD 运行当前 APK，安装物与构建物 SHA-256 均为 3B3A8A33463F74A37617BBE5B47B000D80CC1BBE51972D00404D3E5A6BE03167。三局实际开局、action、roll、Narrator、commit 已运行；stage 5 content prep 仍未完成。 |
| M2 | PARTIAL | SAF 导入真实 GBK 小说；0–9,600 code-point partial package；真实 GLM opening_goal / campaign_plan。world package method entries=0；第三局 campaign artifact 实际提供 6 个 fixed-empty-evidence L1，另有 2 个 L2；全书未发送、非空 evidence L1 未验。 |
| M3 | PARTIAL / HUMAN-ACCEPTANCE-NOT-RUN | 三个 campaign 主线含 14 个 agent-driven QA action turns；另有一个隔离测试 branch 的 method-bound 行动，共 15 个。骰点、Narrator、原子提交与下一轮 L2 均有设备/DB 证据；stage 1–4 及 3 个延迟消费者通过。stage 5 内容 unresolved；无真人选择。 |
| M4 | PARTIAL / BLOCKED-ASSET | 小说 world 与对应 campaigns/branches 共 65 次物理请求：64 HTTP 200、1 旧配置 401、unknown=0、in-flight=0；mock 世界 429 与 network_unknown 保留未重派。live turn force-stop/outbox、合法 save-10 / Stage-1/8 缺失。 |
| M5 | PARTIAL | 长会话 PSS/RSS 与 GfxInfo、键盘、1.3 字号及终局页有限样本。TalkBack、其他 API/尺寸和匹配 L1/L2 10+10 未验。 |
| M6 | PASS-ENGINEERING / DEVICE-PASS-限定范围 | opening evidence recovery、Canon plan adoption、terminal action gate、effect-limit、long-plan consequence、stage completion 三类 repair guidance 共六项 RED→GREEN，独立提交；Core 1,354/1,354、mobile typecheck、version check、Debug APK 与安装复测通过。修复后的 stage-5 候选仍被 validator 拒绝。 |
| M7 | PR #15 / EXACT-HEAD CHECK | PR #15 开放未合并；只以最终 push 后 PR 当前 SHA 的 Core Verify 与 Android Verify 为准，旧 head 和 PR #14 checks 不代替本轮最终 SHA。 |


## R 节点

| ID | 状态 | 当前依据 / 尚缺 |
|---|---|---|
| R0 | PASS-ENGINEERING | 当前 Core 1,354/1,354；Canon 去重、导入安全、adoption、terminal 与 bounded stage-plan repair guidance 合同全量通过。真人完整旅程仍缺。 |
| R1 | PARTIAL / DEVICE-AGENT-L1-PATH | exact method/readiness 与冻结合同通过；第三局实际 6 个 campaign-scope fixed-empty-evidence L1 无 Planner；world package 仍无 method entry，非空 evidence L1 未验。 |
| R2 | PARTIAL | settlement/reducer/replay 工程合同通过；真实行动 roll、状态变化与 3 个 delayed consumer effect 有提交记录；无真人复核。 |
| R3 | PARTIAL | novel ledger 与独立 mock ledger 已分开审计；mock unknown 保留，长期历史预算账本不改写、不借额。 |
| R4 | PARTIAL / AGENT-DRIVEN-CHAIN | 第三局 3 项 deferred consequence 已触发并消费，第四项 stage-5 consequence pending；真人后续反馈未验。 |
| R5 | PARTIAL | unknown park、原子提交/fence 工程覆盖；live turns 已 commit，但未做中断/outbox/旧 worker 故障注入。 |
| R6 | PARTIAL | package privacy/validation Core 通过；本轮真实行动未完成三意图私密投影审计。 |
| R7 | PARTIAL / HUMAN-ACCEPTANCE-NOT-RUN | novel world + campaigns/mapped branches 65 次物理请求：64 HTTP 200、1 次旧配置 401、unknown=0；campaign_plan 32 / Planner 8 / Narrator 15。15 个 action turns 均 agent-driven；L1 6 次、主 QA L2 8 次，L1 仅 fixed empty evidence；真人决定 0。 |
| R8 | PARTIAL | 长会话性能样本已记录；无 matched L1/L2 10+10 或四名独立玩家。 |
| R9 | TRACKED ON PR #15 | 最终 SHA 的 Core Verify / Android Verify 见 [PR #15 checks](https://github.com/anjingdtl/ShineWord/pull/15/checks)；必须核当前 PR HEAD。 |


## G 门

| ID | 状态 | 当前依据 / 缺口 |
|---|---|---|
| G0 | PARTIAL | 用户授权本轮 GLM 不限额度；小说 world + campaigns/branches 64 success / 1 旧 401，mock 429/unknown 分离；attempt ledger observed concurrency=2、无 in-flight。input/output/reasoning tokens 为 846,768 / 204,224 / 30,202。CNY 费用未知，历史 510/600 ignored ledger 未改动。 |
| G1 | PARTIAL | shared L1/L2 authority 与 strict candidate contracts 在 Core 通过；campaign-scope 有 6 个真实 L1，但 evidenceIds 均为空，package method entry=0。 |
| G2 | PARTIAL | Runtime status、即时 counter、3 个 delayed consumer effects 与结束 UI 可对账；stage-5 consumer pending，真人反馈未验。 |
| G3 | PARTIAL | 更新配置后的 opening_goal HTTP 200；之后完成真实 campaign plan、Planner/Narrator 与行动提交。真人选择及玩家反馈没有。 |
| G4 | PARTIAL | 当前 APK 完成有限代理 QA 和终局门控；字号、键盘样本通过。TalkBack 与独立试玩未完成。 |
| G5 | PARTIAL | mock 429/unknown 与应用数据保留；三局 rolls/turns 可读；没有 live crash、历史迁移矩阵。 |


## V95

| ID | 状态 | 当前依据 / 缺口 |
|---|---|---|
| V95-01 | PASS-ENGINEERING / DEVICE-LIMITED | 唯一 GameStateSnapshot 与现有 commit pipeline 合同通过；三局 roll / turn version 可核对。 |
| V95-02 | PASS-ENGINEERING | 缺 difficulty/evidence/权限仍拒绝；小说内容未补默认值。 |
| V95-03 | PARTIAL | 6 个 campaign-scope L1 已派发并提交；fixed empty evidence，未覆盖非空来源证据、不同证据资格或匹配性能分布。 |
| V95-04 | PARTIAL | 真实设备骰点与四档结果记录在代理 QA turns；没有真人 roll。 |
| V95-05 | PARTIAL | 旧 mock unknown 保持 needs_review；无重派。live turn/outbox crash 未执行。 |
| V95-06 | PASS-ENGINEERING | Graph 仍是只读衍生 projection，Core 回归通过。 |
| V95-07 | PARTIAL / AGENT-DRIVEN-CHAIN | 3 个 delayed consequences 已触发、消费并产生下游事件；stage-5 consequence pending，玩家后续回应未验。 |
| V95-08 | NOT RUN | 真实三意图到公开输出的全层隐私对照未运行。 |
| V95-09 | PARTIAL | action/method refs 与 turn commit 有样本；没有真人开局与完整行动供给审计。 |
| V95-10 | PARTIAL / BLOCKED-ASSET | 合成自动化回归通过；真实 save-10、Stage-1/8 不存在于隔离 AVD。 |
| V95-11 | PARTIAL / AGENT-DRIVEN | 三局开局、角色、campaign、15 个真实 action turns 与终局/后续运行在设备完成；全部选择由 QA 执行者作出，非玩家验收。 |
| V95-12 | BLOCKED-EXTERNAL-HUMAN | 独立试玩人数 0/4。 |

## A01–A40（阶段 9 遗留）

| ID | 状态 | 当前依据或缺口 |
|---|---|---|
| A01 | NOT RUN | 未完成同小说三种意图的完整旅程。 |
| A02 | PARTIAL | 执行者在代理 QA 中选 Canon Roland 与开局锚点；没有真人选择、原创身份对照或锚点替换。 |
| A03 | NOT RUN | 未验证晚到来源、按需补建及正式采用后可玩。 |
| A04 | NOT RUN | 未完成明确目标和开放探索对照。 |
| A05 | PARTIAL | 第三局 7 个代理行动推进 stage 1–4；第 8 个自由输入 L2 行动在 stage 5 降级路径提交。stage-5 repair guidance 已有 RED→GREEN，但最新候选仍因 skill_check destinationId 无效被 validator 拒绝；没有玩家沿完整计划行动。 |
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
| A19 | PARTIAL / AGENT-DRIVEN-CHAIN | 第三局三项延迟后果在真实设备回合中触发、消费并产生具体下游事件；第四项 pending，真人响应未验。 |
| A20 | PARTIAL | replan/frozen input/fencing 当前 Core 回归；无设备竞态。 |
| A21 | PARTIAL | budget reservation/fence 的 Core 回归通过；无设备后台竞争矩阵。 |
| A22 | PARTIAL | 本轮没有目标、顺序、规则、风格全身份配对。 |
| A23 | PARTIAL | 当前设备有三个同世界独立 campaign branch；fork/rewind/完整知识隔离审计未验。 |
| A24 | PASS-ENGINEERING | 冻结 JSON/hash/缺依赖拒绝由当前 Core 覆盖。 |
| A25 | PARTIAL | 请求窗/能力资格合同通过；未覆盖本轮所有材料超窗情形。 |
| A26 | PARTIAL | 本轮物理 attempt 可审计；历史私有账本没有取得/对账。 |
| A27 | PARTIAL | novel GLM 旧 401、独立 mock 429 与 network_unknown 已分开分类；无真实 provider timeout 或实际费用对账。 |
| A28 | PARTIAL | Core 覆盖冻结 roll/幂等；设备实际记录骰点与 turn commit，但没有 force-stop / cold-start roll replay。 |
| A29 | PARTIAL | 响应校验/修复/采用合同在 Core；没有 live recovery journey。 |
| A30 | PASS-ENGINEERING | 编辑/取消与旧 worker fence 拒绝在当前 Core 回归。 |
| A31 | PARTIAL | fork/rewind 工程合同在当前 Core；完整知识/后果/计划分支隔离未在设备验收。 |
| A32 | PARTIAL / BLOCKED-ASSET | 当前 Core 存档格式/迁移测试通过；设备缺少合法 save-10 与 Stage-1/8 历史资产。 |
| A33 | PARTIAL | 合成秘密拒绝有工程合同；真实三意图及日志输出全层隐私对照未运行。 |
| A34 | PASS-DEVICE（限定范围） | failed Runtime 终局页已复测：变更行动隐藏、composer disabled，与 Runtime ending 投影一致；自然结局质量未验。 |
| A35 | PARTIAL | API 37、软键盘、1.3 字号冒烟通过；TalkBack 未启用，旋转/API 24/小屏未验。 |
| A36 | BLOCKED-EXTERNAL-HUMAN | 独立试玩与六维评分为 0/4。 |
| A37 | BLOCKED-REAL-PERFORMANCE | 没有匹配 10+10 的真实 L1/L2 数据。 |
| A38 | PARTIAL | 当前 APK 与 installed base hash 匹配；真实小说 GLM 代理 QA 完成 15 个 action turns，真人完整旅程未跑。 |
| A39 | PARTIAL | 同一世界运行三个 campaign QA 主线，并保留多个隔离 branches；未完成三局身份/状态/知识隔离审计。 |
| A40 | PASS-ENGINEERING | 当前全量 Core 的长期记忆/retrieval 确定性覆盖通过；不计玩家决定。 |

## 总体历史验收

- 本轮真人完整剧情决定：0；阶段 9 要求的 80 个真人有效决定尚未开始。15 个 agent-driven player-like actions 不计入 80。
- 独立外部试玩：0/4；自然结局：NOT RUN；真实匹配性能 10+10：NOT RUN；stage 5 内容路线与玩家后续反馈未完成。
- 旧历史资产 save-10 / Stage-1/8：BLOCKED-ASSET。模拟器保留三局 QA 数据并停在第三局 stage 5 content-prep fallback；不将 agent-driven 角色或行动计作玩家决定。
