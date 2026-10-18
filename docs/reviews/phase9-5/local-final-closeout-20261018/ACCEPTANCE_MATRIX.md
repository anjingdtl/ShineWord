# M0–M7 / G0–G5 / V95 / R0–R9 / A01–A40 验收矩阵

更新：2026-10-18（Asia/Shanghai）
当前结论：Runtime 收束工程针对性修复 PASS-ENGINEERING（仅限明列范围）；阶段 9.5 PARTIAL；阶段 9 历史遗留 PARTIAL。自动化、partial world ready 和 CI 都不等价于真实玩家验收。

状态词：PASS-ENGINEERING=当前源码确定性/集成合同通过；PASS-DEVICE=当前 APK/专用设备明确完成；PASS-REAL=真实模型及玩家旅程完成；PARTIAL=有受限证据且仍缺合同项；BLOCKED=资源/真人缺失；NOT RUN=未执行。

## M 节点

| 节点 | 状态 | 当前证据 / 缺口 |
|---|---|---|
| M0 | PASS-ENGINEERING | 起始工作树已隔离，重新 fetch 后 origin/main 为 87eef899；原始 main 与既有 worktree 未改写。用户后续授权模型不限额度，并发仍为 1。 |
| M1 | PASS-DEVICE（限定范围） | 当前 M6 APK 成功构建/安装/冷启动，base.apk 与构建 APK SHA 一致；书库、项目页、开局身份页可达。完整战役动作未包含。 |
| M2 | PARTIAL | SAF 导入真实 GBK 小说、开篇两次 GLM extraction、partial world package published/ready；scope 0–9,600。更新配置后 opening_goal 200；L1 未确认，全书未构建。 |
| M3 | PARTIAL / BLOCKED-PLAYER | 开局页自动 goal suggestion 请求 HTTP 200；身份页停在真人填写姓名前；campaigns=0、turns=0、玩家行动/骰点/Narrator/commit=0。需真人决定。 |
| M4 | PARTIAL / BLOCKED-ASSET | localhost 429 与 unknown 现场保留，unknown 未重派；Core 相关恢复合同通过。没有 identity-bound save-10、Stage-1/8 或 live gameplay 中断矩阵。 |
| M5 | PARTIAL | 有限导入时长、LLM 耗时、内存、gfx、键盘和 1.3 字号记录；TalkBack、旋转、小屏全矩阵、匹配 10+10 未验。 |
| M6 | PASS-ENGINEERING / DEVICE-PARTIAL | Structured opening evidence RED→GREEN、Core 1,344/1,344、mobile typecheck、Debug APK 和安装回归通过；设备恢复了 cached finalization，但未观察到新的有界 extension 请求。 |
| M7 | PASS-ENGINEERING | PR #15 已开放，原最终代码 HEAD `f62ae30` 的 Core/Android checks 均通过；本次新增为验收证据文档与模拟器截图，当前 PR checks 以最新 HEAD 的 live 状态为准。 |

## R 节点

| ID | 状态 | 当前依据 / 尚缺 |
|---|---|---|
| R0 | PASS-ENGINEERING | 现行 Core 1,344/1,344；旧 canon 去重和导入安全合同仍在全量回归中。完整真实开局仍缺。 |
| R1 | PASS-ENGINEERING | 当前全量 Core 覆盖 exact method/readiness 与 frozen contract parity；本轮真实内容无可证明 L1 method。 |
| R2 | PASS-ENGINEERING | 当前全量 Core 覆盖 settlement/reducer/replay；没有真实行动后的下游消费。 |
| R3 | PARTIAL | 当前 DB 真实尝试与本地 mock ledger 已核对；旧 F:\\sw95 ignored long-run ledger 不被改写或借额度，历史全局账本仍不在本轮重放。 |
| R4 | PASS-ENGINEERING / real PARTIAL | 当前 Core 因果与延迟后果合同测试通过；无本轮真人三路汇合及下游消费者。 |
| R5 | PARTIAL | unknown park、原子提交、fence 等合同在现行 Core 通过；仅设备 build finalization 恢复，无真实 turn force-stop/outbox 旅程。 |
| R6 | PARTIAL | package validation 与隐私/权限合同在现行 Core 回归；未在本轮真实 turn 中验证三意图私密投影。 |
| R7 | PARTIAL / BLOCKED-REAL-ACTION | 4 次模型成功、1 次明确 401；没有真实 action turns、有效 L1 物理 Planner=0 配对或玩家决策。 |
| R8 | PARTIAL | 实测设备帧、内存、键盘和字号；无 10+10 matched L1/L2 与四名独立玩家。 |
| R9 | TRACKED ON PR #15 | 本轮最终分支 HEAD 的 Core Verify 和 Android Verify 链接在 [PR #15 checks](https://github.com/anjingdtl/ShineWord/pull/15/checks)；PR #14 的基线检查不代替。 |

## G 门

| ID | 状态 | 当前依据 / 缺口 |
|---|---|---|
| G0 | PARTIAL | 源码、APK、AVD 和本轮 ledger 已绑定；个人/历史请求预算账本未核验，模型 CNY 费用未知。 |
| G1 | PARTIAL | 共享 L1/L2 authority 与确定性合同在 Core 通过；本小说没有通过资格审查的真实 L1。 |
| G2 | PARTIAL | 只读 projection 与一致状态工程回归通过；没有真实 promise→trigger→consumer 因果链。 |
| G3 | PARTIAL | 配置更新后的自动 goal request 已 HTTP 200；未完成 M3 游戏回合、下一轮机会或真人决定。 |
| G4 | PARTIAL | 当前 APK/字体/键盘/项目页通过有限检查；真实性能、完整 Narrator 与外部试玩未完成。 |
| G5 | PARTIAL | mock 429/unknown 现场与应用数据库保留；旧 save、live turn crash、导入/迁移和配置重启矩阵未完成。 |

## V95

| ID | 状态 | 当前依据 / 缺口 |
|---|---|---|
| V95-01 | PASS-ENGINEERING | 唯一 GameStateSnapshot 与现有 commit pipeline 的工程合同在 Core 回归。 |
| V95-02 | PASS-ENGINEERING | 缺 difficulty/evidence/权限仍拒绝；当前内容没有因此补默认值。 |
| V95-03 | PARTIAL | 合格 L1 distribution 未建立；本轮没有真实 Planner action dispatch。 |
| V95-04 | PASS-ENGINEERING | 四档规则和冻结合同确定性回归通过；没有真人 roll。 |
| V95-05 | PARTIAL | 当前 mock unknown 保持 needs_review，未知请求未重派；live turn/outbox crash 未执行。 |
| V95-06 | PASS-ENGINEERING | Graph 仍为只读衍生 projection，Core 回归通过。 |
| V95-07 | PARTIAL | 延迟结果 reducer 工程通过；无三路合流及两个真实后续消费者。 |
| V95-08 | NOT RUN | 真实三意图到公开输出的全层隐私对照未运行。 |
| V95-09 | PARTIAL | 稳定引用/供给合同通过；无真人开局与真实行动供给审计。 |
| V95-10 | PARTIAL / BLOCKED-ASSET | 合成自动化回归在现行 Core；真实旧存档 save-10、Stage-1/8 不存在于隔离 AVD。 |
| V95-11 | PARTIAL | 开局屏已真实加载但没有真实玩家选择、角色或 campaign。 |
| V95-12 | BLOCKED-EXTERNAL-HUMAN | 独立试玩人数 0/4。 |

## A01–A40（阶段 9 遗留）

| ID | 状态 | 当前依据或缺口 |
|---|---|---|
| A01 | NOT RUN | 未完成同小说三种意图的完整旅程。 |
| A02 | PARTIAL | 原创身份默认视图已在设备加载；未完成原著/原创身份真人选择与更换锚点。 |
| A03 | NOT RUN | 未验证晚到来源、按需补建及正式采用后可玩。 |
| A04 | NOT RUN | 未完成明确目标和开放探索对照。 |
| A05 | PARTIAL | 冻结历史合同在 Core；没有真实未来计划旅程。 |
| A06 | NOT RUN | 未测救援/存活后规划。 |
| A07 | PASS-ENGINEERING | 当前 Core 覆盖无效/截断候选不能绕过生产校验。 |
| A08 | NOT RUN | 未在当前 APK 运行 ready 前强停/占位恢复。 |
| A09 | PARTIAL | 一次性与事务恢复由 Core 覆盖；设备上未做双启动/采用中断。 |
| A10 | NOT RUN | 无两条真实路径汇合后的状态/机会差异。 |
| A11 | PASS-ENGINEERING | 当前 Core 的点击与 exact text routing parity 回归；设备无玩家行动。 |
| A12 | NOT RUN | 未取样模板外但能力允许的组合行动。 |
| A13 | PASS-ENGINEERING | 稳定引用、过期/异地引用合同在当前 Core 回归。 |
| A14 | PASS-ENGINEERING | 四档合同与骰点确定性测试通过；无真实骰点。 |
| A15 | PARTIAL | 四档与恢复合同通过；无连续失败、普通成功完整真人样本。 |
| A16 | PASS-ENGINEERING | changed/no_change 与状态/叙事区分由 settlement 合同覆盖。 |
| A17 | PARTIAL | 一次性奖励、有限供给工程回归通过；无真实提前解决/绕过旅程。 |
| A18 | NOT RUN | 偏离、暂停、改目标与恢复 UI 矩阵未运行。 |
| A19 | PARTIAL | triggered/discharged 可被工程 audit 区分；没有后续消费者实游跟踪。 |
| A20 | PARTIAL | replan/frozen input/fencing 当前 Core 回归；无设备竞态。 |
| A21 | PARTIAL | budget reservation/fence 的 Core 回归通过；无设备后台竞争矩阵。 |
| A22 | PARTIAL | 本轮没有目标、顺序、规则、风格全身份配对。 |
| A23 | PARTIAL | 当前设备没有 campaign/save；fork/rewind/知识隔离为未验。 |
| A24 | PASS-ENGINEERING | 冻结 JSON/hash/缺依赖拒绝由当前 Core 覆盖。 |
| A25 | PARTIAL | 请求窗/能力资格合同通过；未覆盖本轮所有材料超窗情形。 |
| A26 | PARTIAL | 本轮物理 attempt 可审计；历史私有账本没有取得/对账。 |
| A27 | PARTIAL | local 429 和 401 已分类；无有效模型 timeout/真实未知计费对账。 |
| A28 | PARTIAL | 当前全量 Core 覆盖冻结 roll/幂等；设备没有 turn 与 cold-start roll replay。 |
| A29 | PARTIAL | 响应校验/修复/采用合同在 Core；没有 live recovery journey。 |
| A30 | PASS-ENGINEERING | 编辑/取消与旧 worker fence 拒绝在当前 Core 回归。 |
| A31 | PARTIAL | fork/rewind 工程合同在当前 Core；完整知识/后果/计划分支隔离未在设备验收。 |
| A32 | PARTIAL / BLOCKED-ASSET | 当前 Core 存档格式/迁移测试通过；设备缺少合法 save-10 与 Stage-1/8 历史资产。 |
| A33 | PARTIAL | 合成秘密拒绝有工程合同；真实三意图及日志输出全层隐私对照未运行。 |
| A34 | NOT RUN | 当前 APK 无结局/阶段 UI 状态一致性旅程。 |
| A35 | PARTIAL | API 37、软键盘、1.3 字号冒烟通过；TalkBack 未启用，旋转/API 24/小屏未验。 |
| A36 | BLOCKED-EXTERNAL-HUMAN | 独立试玩与六维评分为 0/4。 |
| A37 | BLOCKED-REAL-PERFORMANCE | 没有匹配 10+10 的真实 L1/L2 数据。 |
| A38 | PARTIAL | 当前 APK 与 installed base hash 完全匹配；真实完整旅程为 0。 |
| A39 | NOT RUN | 未运行同世界三个 campaign 的隔离旅程。 |
| A40 | PASS-ENGINEERING | 当前全量 Core 的长期记忆/retrieval 确定性覆盖通过；不计玩家决定。 |

## 总体历史验收

- 本轮真实完整剧情决定：0；阶段 9 要求的 80 个有效决定尚未开始。
- 独立外部试玩：0/4；自然结局：NOT RUN；真实匹配性能 10+10：NOT RUN。
- 旧历史资产 save-10 / Stage-1/8：BLOCKED-ASSET。真实玩家续接前，保留当前模拟器开局空白页，不自动制造身份/角色/行动。
