# M0–M7 / G0–G5 / V95 / R0–R9 / A01–A40 验收矩阵

更新：2026-10-18（Asia/Shanghai）
当前结论：Runtime 收束工程针对性修复 PASS-ENGINEERING（仅限明列范围）；阶段 9.5 PARTIAL；阶段 9 历史遗留 PARTIAL。自动化、partial world ready 和 CI 都不等价于真实玩家验收。

状态词：PASS-ENGINEERING=当前源码确定性/集成合同通过；PASS-DEVICE=当前 APK/专用设备明确完成；PASS-REAL=真实模型及玩家旅程完成；PARTIAL=有受限证据且仍缺合同项；BLOCKED=资源/真人缺失；NOT RUN=未执行。


## M 节点

| 节点 | 状态 | 当前证据 / 缺口 |
|---|---|---|
| M0 | PASS-ENGINEERING | 再次 fetch 后 origin/main=87eef899281f267a17e02357cc643dd475cabd7c；隔离 worktree 施工，原 main / checkout / ignored 历史账本未改写。用户授权 GLM 不限额度，实际并发峰值 1。 |
| M1 | PASS-DEVICE（限定范围） | API 37 专用 AVD 运行分支最新 APK；安装物与构建物 SHA-256 均为 C5B27FAEAAF8B1DF60946A8B826952DC4C1EC77A3AB4EA3BC26072FDFA26AF10。小说世界、开局、action、roll、Narrator、terminal UI 已运行。 |
| M2 | PARTIAL | SAF 导入真实 GBK 小说；0–9,600 code-point partial package；真实 GLM opening_goal、campaign_plan、Planner/Narrator 成功。method package entries=0，L1 无可测内容；全书未发送。 |
| M3 | PARTIAL / HUMAN-ACCEPTANCE-NOT-RUN | 两个 campaign branch、5+1 个执行者 QA action、骰点、Narrator、原子提交、后续 replan 与终局 UI 有设备/DB 证据；没有真人选择，delayed consumer 未通过。 |
| M4 | PARTIAL / BLOCKED-ASSET | 当前小说世界没有真实 GLM unknown；旧 401 保留。独立 mock 世界 429 与 network_unknown 保留未重派。live turn force-stop/outbox、合法 save-10 / Stage-1/8 缺失。 |
| M5 | PARTIAL | 长会话 PSS/RSS 与 GfxInfo、键盘、1.3 字号及终局页有限样本。TalkBack、其他 API/尺寸和匹配 L1/L2 10+10 未验。 |
| M6 | PASS-ENGINEERING / DEVICE-PASS-限定范围 | opening evidence recovery、Canon plan adoption、terminal action gate 的 RED→GREEN；Core 1,348/1,348、mobile typecheck、version check、Debug APK 与安装复测通过。 |
| M7 | PR #15 / EXACT-HEAD CHECK | PR #15 开放未合并；只以最终 push 后 PR 当前 SHA 的 Core Verify 与 Android Verify 为准，旧 head 和 PR #14 checks 不代替本轮最终 SHA。 |


## R 节点

| ID | 状态 | 当前依据 / 尚缺 |
|---|---|---|
| R0 | PASS-ENGINEERING | 当前 Core 1,348/1,348；Canon 去重、导入安全、adoption 与 terminal 修复合同全量通过。真人完整旅程仍缺。 |
| R1 | PASS-ENGINEERING / CONTENT-BLOCKED-L1 | exact method/readiness 与冻结合同通过；当前小说 package 无 method entry，未执行真实 L1。 |
| R2 | PARTIAL | settlement/reducer/replay 工程合同通过；真实行动 roll 与状态变化有提交记录，没有 delayed consumer。 |
| R3 | PARTIAL | novel ledger 与独立 mock ledger 已分开审计；mock unknown 保留，长期历史预算账本不改写、不借额。 |
| R4 | PARTIAL | talk success 令 testimony +10 并留存；最终两局无 deferred consequence，尚无延迟触发/消费/反馈链。 |
| R5 | PARTIAL | unknown park、原子提交/fence 工程覆盖；live turns 已 commit，但未做中断/outbox/旧 worker 故障注入。 |
| R6 | PARTIAL | package privacy/validation Core 通过；本轮真实行动未完成三意图私密投影审计。 |
| R7 | PARTIAL / HUMAN-ACCEPTANCE-NOT-RUN | novel world 29 次 GLM success、旧配置 401；Planner 6 / Narrator 6 成功，验证 L2。L1 因 method entry=0 未运行；真人决定 0。 |
| R8 | PARTIAL | 长会话性能样本已记录；无 matched L1/L2 10+10 或四名独立玩家。 |
| R9 | TRACKED ON PR #15 | 最终 SHA 的 Core Verify / Android Verify 见 [PR #15 checks](https://github.com/anjingdtl/ShineWord/pull/15/checks)；必须核当前 PR HEAD。 |


## G 门

| ID | 状态 | 当前依据 / 缺口 |
|---|---|---|
| G0 | PARTIAL | 用户授权本轮 GLM 不限额度；novel world 29 success / 旧 401，mock 429/unknown 分离；observed concurrency=1。CNY 费用未知，历史 510/600 ignored ledger 未改动。 |
| G1 | PARTIAL / CONTENT-BLOCKED-L1 | shared L1/L2 authority 与 strict candidate contracts 在 Core 通过；当前 package method entry=0。 |
| G2 | PARTIAL | Runtime status、testimony 即时 counter 和结束 UI 可对账；无 delayed consumer 链。 |
| G3 | PARTIAL | 更新配置后的 opening_goal HTTP 200；之后完成真实 campaign plan、Planner/Narrator 与行动提交。真人选择及玩家反馈没有。 |
| G4 | PARTIAL | 当前 APK 完成有限代理 QA 和终局门控；字号、键盘样本通过。TalkBack 与独立试玩未完成。 |
| G5 | PARTIAL | mock 429/unknown 与应用数据保留；两局 rolls/turns 可读；没有 live crash、历史迁移矩阵。 |


## V95

| ID | 状态 | 当前依据 / 缺口 |
|---|---|---|
| V95-01 | PASS-ENGINEERING / DEVICE-LIMITED | 唯一 GameStateSnapshot 与现有 commit pipeline 合同通过；两局 roll / turn version 可核对。 |
| V95-02 | PASS-ENGINEERING | 缺 difficulty/evidence/权限仍拒绝；小说内容未补默认值。 |
| V95-03 | PARTIAL / CONTENT-BLOCKED-L1 | 合格 L1 distribution 未建立；本轮没有 L1 method dispatch。 |
| V95-04 | PARTIAL | 真实设备骰点与四档结果记录在代理 QA turns；没有真人 roll。 |
| V95-05 | PARTIAL | 旧 mock unknown 保持 needs_review；无重派。live turn/outbox crash 未执行。 |
| V95-06 | PASS-ENGINEERING | Graph 仍是只读衍生 projection，Core 回归通过。 |
| V95-07 | PARTIAL | immediate counter change 与 campaign ending 有实测；最终 deferred consequence 列表为空，无后续消费者。 |
| V95-08 | NOT RUN | 真实三意图到公开输出的全层隐私对照未运行。 |
| V95-09 | PARTIAL | action/method refs 与 turn commit 有样本；没有真人开局与完整行动供给审计。 |
| V95-10 | PARTIAL / BLOCKED-ASSET | 合成自动化回归通过；真实 save-10、Stage-1/8 不存在于隔离 AVD。 |
| V95-11 | PARTIAL / AGENT-DRIVEN | 开局、角色、campaign、真实行动与结局在设备运行；选择由 QA 执行者作出，非玩家验收。 |
| V95-12 | BLOCKED-EXTERNAL-HUMAN | 独立试玩人数 0/4。 |

## A01–A40（阶段 9 遗留）

| ID | 状态 | 当前依据或缺口 |
|---|---|---|
| A01 | NOT RUN | 未完成同小说三种意图的完整旅程。 |
| A02 | PARTIAL | 执行者在代理 QA 中选 Canon Roland 与开局锚点；没有真人选择、原创身份对照或锚点替换。 |
| A03 | NOT RUN | 未验证晚到来源、按需补建及正式采用后可玩。 |
| A04 | NOT RUN | 未完成明确目标和开放探索对照。 |
| A05 | PARTIAL | 实际 campaign_plan/replan 有提交记录；没有玩家沿后续阶段行动并验证计划因果。 |
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
| A19 | PARTIAL | triggered/discharged 工程 audit 可区分；本轮最终 deferred list 为空，无 delayed consumer 实游跟踪。 |
| A20 | PARTIAL | replan/frozen input/fencing 当前 Core 回归；无设备竞态。 |
| A21 | PARTIAL | budget reservation/fence 的 Core 回归通过；无设备后台竞争矩阵。 |
| A22 | PARTIAL | 本轮没有目标、顺序、规则、风格全身份配对。 |
| A23 | PARTIAL | 当前设备有两个同世界独立 campaign branch；fork/rewind/知识隔离未验。 |
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
| A38 | PARTIAL | 当前 APK 与 installed base hash 匹配；真实小说 GLM 代理 QA 完成 6 个 action 操作，真人完整旅程未跑。 |
| A39 | PARTIAL | 同一世界创建两个独立 campaign branch 并分别提交；未完成三个 campaign 的身份/状态/知识隔离审计。 |
| A40 | PASS-ENGINEERING | 当前全量 Core 的长期记忆/retrieval 确定性覆盖通过；不计玩家决定。 |

## 总体历史验收

- 本轮真人完整剧情决定：0；阶段 9 要求的 80 个真人有效决定尚未开始。代理 QA 中两个 campaign、6 个 player-like actions 不计入 80。
- 独立外部试玩：0/4；自然结局：NOT RUN；真实匹配性能 10+10：NOT RUN；延迟后果消费未通过。
- 旧历史资产 save-10 / Stage-1/8：BLOCKED-ASSET。模拟器保留两局 QA 数据并停在终局页；不将 agent-driven 角色或行动计作玩家决定。
