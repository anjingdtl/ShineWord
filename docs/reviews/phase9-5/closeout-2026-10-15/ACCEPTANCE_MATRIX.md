# 阶段 9.5 验收矩阵 — 2026-10-15

停止点阶段结论为 PARTIAL。最新 fork/APK 证据绑定 scope-v3 `productionSourcesHash` `5f17b1ceed260d740bb81ae70f17356f82c1638275d3be913af697afa45c81dc` 与 Debug APK SHA-256 `d2bd7882c1a851ac0aa702a01f641f8390c220eb12018e2b3b92be7a976041e8`。较早自然完成旅程绑定旧 identity `e9dd9a606248bdd4bf7ec6743b906c2d7dbdecead24a38657aec0c2c5fa5426f` / `cfe5080c0c5c9dafa3a74a4f29fa41e1cdea83416e2e45652d18cf974a76c783`，独立计证，不跨 identity 合并。当前哈希反映当时完整工作树，包含未纳入 closeout 提交的既有修改。

## 身份与预算

| 项 | 当前依据 |
|---|---|
| 仓库/分支/HEAD | E:\AiWorkSpace\ShineWord / main / build HEAD `5f04b8d94bc9d6dee7d9586d98735dc8bfe95226` |
| 工作树 | 保留 ZCode 已有修改和未跟踪资料；本次提交只纳入归属明确的修复与报告 |
| APK | 109,977,423 bytes；停止前设备 base.apk 与本地 Debug APK SHA-256 相同 |
| 设备 | emulator-5554，Android API 37，com.shineword.app 1.0.0 / versionCode 1000000；非真机 |
| 模型 | 用户授权配置的 MiniMax-M3.1-Flash-Preview；密钥内容未输出或归档 |
| 当前模型 scope | phase95-minimax-20261015，65/104 已计入，39 可用；物理账本 64 completed、1 outcome_unknown |
| app DB unknown | 旧 planner 1 条、本轮 world_mapping 1 条；本轮代理记 HTTP 200，但 app response 未持久化，状态仍 unknown |
| v18 计划请求 | #a1 app DB 明确 HTTP 429，但物理账本为 outcome_unknown；#a2 HTTP 200，但候选因 skillId 非稳定 ID 无效 |
| prompt 文件 | 用户给出的提示词.txt 路径在工作环境不存在；无法对附件原文逐条对照 |

## G0–G5

| 门禁 | 状态 | 证据和边界 |
|---|---|---|
| G0 身份、设备、预算 | PARTIAL | 最新 fork 的工作树/APK SHA 已绑定；MiniMax scope 65/104。v18 #a1 的 app/物理账本状态不一致，另有两条历史应用层 unknown。 |
| G1 安全 L1 竖切 | PARTIAL | 核心固定策略测试通过；当前旅程未统计合格 L1/Planner=0 分布。 |
| G2 投影与对抗可玩性 | PARTIAL | 较早 branch v10 有 4/4 有意义行动和 2 条延迟后果 discharged；最新 fork v18 有 12 提交、6 个候选有意义、6 个排除、0 条延迟后果。三路汇合及语义质量仍未验。 |
| G3 M3 局部生成 | N/A — NOT NEEDED | 当前 evidence 未证明既有供给持续无法给出有用后继；未启动 M3 实验。 |
| G4 Android 集成、质量与试玩 | PARTIAL | 较早 APK 有真实 UI adoption 和自然完成；最新 APK/fork 验证计划生成但 v18 被 schema 校验阻断。仅模拟器，完整 A15/A28/Stage-8、第二题材、性能和真人试用未完成。 |
| G5 配置和本地数据持久性 | PARTIAL | profile/书籍/战役在现有安装和重启后保留；未清数据重测 FirstRun 或重新注入密钥。 |

## V95-01 — V95-12

| 项 | 状态 | 当前证据和缺口 |
|---|---|---|
| V95-01 单一生产状态权威 | PASS（代码/测试） | CampaignSession/settlement 写入路径；verify:core 1322/1322。 |
| V95-02 缺绑定安全分流 | PASS（代码/测试） | 固定难度与证据策略的确定性回归通过。 |
| V95-03 合格 L1 Planner=0 | PARTIAL | 确定性覆盖通过；真实行动的 L1 资格分布未统计。 |
| V95-04 四档等价 | PASS（确定性） | 四档规则/编译测试通过；不代表真实随机骰子旅程 parity。 |
| V95-05 重入/竞争/崩溃/unknown | PARTIAL | 进程退出后的映射重入 UI 显示待审核，app DB 保留 outcome_unknown，未自动重放。另有 v18 #a1 app 记录 HTTP 429、物理账本记 outcome_unknown 的差异；竞争矩阵未做。 |
| V95-06 投影只读可重算 | PASS（代码/测试） | 核心投影与数据库读取回归通过；无第二 authority。 |
| V95-07 汇合与延迟后果消费 | PARTIAL | 较早 branch v10 的审计识别 2 条满足延迟门槛且 discharged 的后果；最新 fork v18 为 0 条。三路汇合和完整内容因果复核仍未做。 |
| V95-08 三意图 canon/隐私隔离 | NOT RUN | 未完成三种意图 prompt/context 对照和未来/私有信息审核。 |
| V95-09 供给恢复与 R69 | PARTIAL | 两条不可执行映射提案通过 UI 拒绝且源事实保留；较早 branch manifest v4 已采用 R69 artifact。最新 fork v18 后继计划 invalid；Stage-1 软锁真实存档及全路径复核未完成。 |
| V95-10 save-10/冷启动/新行动/绑定隔离 | PARTIAL | 数据保留、AVD/进程重入和当前新行动已验证；没有 save-10 导入导出与跨 identity 绑定完整测试。 |
| V95-11 M3 条件评估 | N/A — NOT NEEDED | 没有启动 M3 的证据条件。 |
| V95-12 独立真人四问/六维评分 | BLOCKED-EXTERNAL-HUMAN | 尚需 4 名未参与施工的独立试玩者。 |

V95 计数：4 PASS / 5 PARTIAL / 1 NOT RUN / 1 N/A / 1 BLOCKED-EXTERNAL-HUMAN。

## A01–A40 当前身份摘要

| 项 | 合同 | 当前状态 | 证据边界 |
|---|---|---|---|
| A01 | 同小说、不同目标旅程 | NOT RUN | 未对照两条完整目标旅程。 |
| A02 | 原创/规范角色与替代开局 | PARTIAL | canon 角色候选在当前 APK 真实采用；未做配对原创和替代开局。 |
| A03 | 后续来源依赖 | NOT RUN | 未完成晚到来源构建、采用和游玩闭环。 |
| A04 | 明确目标与开放探索 | PARTIAL | 明确目标候选采用并有自然完成；没有完整开放探索对照。 |
| A05 | 未来计划不改历史 | NOT RUN | 未做完整历史隔离审计。 |
| A06 | 规范角色存活证明 | NOT RUN | 未执行救援/存活旅程。 |
| A07 | 无效或截断候选修复 | NOT RUN | 未在当前身份复现无效候选修复。 |
| A08 | 未 ready 停止和恢复占位 | NOT RUN | 未做对应端上恢复场景。 |
| A09 | 双启动与事务中断 | PARTIAL | 一次真实 UI adoption 成功；没有并发启动/事务中断注入。 |
| A10 | 双路径和下游后果 | NOT RUN | 没有双路径持久汇合证明。 |
| A11 | 点击方法/自由文本等价 | NOT RUN | 未做配对行动。 |
| A12 | 合理的模板外组合 | NOT RUN | 未取得合格样本。 |
| A13 | 无效、异地和过期引用 | NOT RUN | 未跑端上边界矩阵。 |
| A14 | 四档骰点 | PARTIAL | 最新 fork 的提交审计包含 failure、severe_failure、success 等结果；四档覆盖与概率/结果等价未验证。 |
| A15 | 普通成功、连续失败与恢复 | PARTIAL | 最新 fork 有失败回合和部分状态变化，但连续失败后的恢复、普通成功闭环与因果审查不完整。 |
| A16 | changed/no_change settlement 闭环 | NOT RUN | 未完成端到端 settlement 审核。 |
| A17 | 提前解决、绕过与奖励 | NOT RUN | 未跑端到端奖励审计。 |
| A18 | 偏离、暂停、改目标与恢复 | NOT RUN | 未跑完整控制流矩阵。 |
| A19 | 两条延迟后果下游使用 | PARTIAL | 当前审计有 2 条延迟后果 discharged；未独立核实其后续用途影响角色、方法或代价。 |
| A20 | in-flight replan 与事实变化 | NOT RUN | 未做竞态注入。 |
| A21 | 触发合并、后台竞争与失败 | NOT RUN | 未跑生命周期竞争矩阵。 |
| A22 | 目标/顺序/规则/风格身份 | NOT RUN | 未做完整身份矩阵。 |
| A23 | 存档与阶段恢复 | PARTIAL | 当前数据重入后 4 个玩家行动和自然完成可读；没有 save-10 往返及恢复后续行动覆盖。 |
| A24 | 冻结数据损坏边界 | NOT RUN | 未构造损坏存档。 |
| A25 | 超窗口材料和未知能力 | NOT RUN | 未做能力边界矩阵。 |
| A26 | Phase 9 预算合同 | PARTIAL | 当前 MiniMax scoped ledger 65/104；v18 #a1 的账本与 app HTTP 429 记录冲突，全局 manifest/历史 scope 仍未完成对账。 |
| A27 | reasoning-only、429、网络和 unknown | PARTIAL | 当前证据包含 HTTP 429、HTTP 200 invalid candidate、物理账本 outcome_unknown 及两条历史 app unknown；完整故障矩阵未做。 |
| A28 | 掷骰、采用、提交与租约中断 | PARTIAL | 最新 fork 有骰点/提交数据及后续计划采用，但租约中断与完整恢复场景没有闭环。 |
| A29 | 未验证响应与未采用修复 | NOT RUN | 未做完整恢复边界旅程。 |
| A30 | 活跃期间修改目标/来源 | NOT RUN | 未跑取消和 fencing 矩阵。 |
| A31 | rewind/fork 隔离 | NOT RUN | 未做 rewind/fork 回放。 |
| A32 | save/export/import/坏存档 | NOT RUN | 未完成本轮存档往返。 |
| A33 | 隐藏身份、别名和日志泄漏 | NOT RUN | 未做完整披露审核；凭据未进入报告。 |
| A34 | 结局 UI 与状态一致 | PARTIAL | 较早 branch v10 数据库显示自然完成于“边陲立足”；最新 branch v18 仍 active，结局 UI 复核未完成。 |
| A35 | 生命周期/键盘/小屏/主题/字体 | PARTIAL | API 37 模拟器冷启动及项目 UI 有证据；真机及全套 UI 矩阵未跑。 |
| A36 | 三意图六维质量 | NOT RUN | 没有独立玩家评分。 |
| A37 | 延迟对比 | NOT RUN | 没有 matched baseline/final 样本。 |
| A38 | 最终源码/APK/真实证据 | PARTIAL | 最新停止点源码/APK/设备 SHA 与 v18 audit 已绑定；早期自然完成证据单独绑定旧 identity；Stage-8/A15/A28 等未闭环。 |
| A39 | 同世界三个隔离 campaign | PARTIAL | 同一世界能看到当前和历史 campaign；无第三 campaign 和完整隔离审计。 |
| A40 | 100/300/1000 累积检查点 | NOT RUN | 当前旅程 4 个玩家决定，不满足窗口。 |

A01–A40 计数：0 PASS / 0 FAIL / 14 PARTIAL / 26 NOT RUN。两个旅程 identity 分别记证；不把跨 identity 结果或 Stage-8 离线回放计入 PASS。

## Stage-8 单独评估

| 项 | 状态 | 结果 |
|---|---|---|
| v33 真实快照的生产规则层评估 | PARTIAL（离线） | plan_ready=20；seal-escape-plan requires 满足；生产 condition evaluator value=true/unknown=false；promise/event guard=null；内存应用普通成功效果后生产 progress reducer 将 stage-8 置 succeeded。 |
| 当前 APK 端上正式回放 | NOT RUN | 没有在当前 APK 完成选择、掷骰、Narrator、提交和持久状态验证。 |

另见 docs/reviews/phase9-5/ROOT_CAUSE_AUDIT_2026-10-13.md。离线规则路径不是 Android 旅程 PASS。

## 当前主要未完成项

- 保留历史 world_mapping outcome_unknown，避免重复计费。当前唯一 UI 恢复路线是显式允许重试；v18 #a1 的物理账本差异另行核对，不改账。
- Stage-8 当前身份精确回放、A15/A28 当前身份骰子/失败恢复。
- Stage-1 软锁真实存档、完整隐私三意图、较长真实决定窗口及更多反例。
- 4 名外部独立试玩者的 V95-12/A36。
