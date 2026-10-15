# 阶段 9.5 / 阶段 9 验收矩阵

## 当前结论

- 阶段 9.5：PARTIAL，未关闭。工程修复和部分集成证据可交接，G0/G1/G2/G4/G5 等仍有必需项未完成。
- 阶段 9 遗留整体：PARTIAL，未关闭。当前真实完整旅程 0，有效玩家决定 0；不能用本地合成压力或工程测试替代 80 个决定及 UI 份额。
- 本轮物理模型请求：0；真实模型预算 scope、请求上限和费用边界均未提供。历史私有账本和 unknown 不可在当前环境核验，保持 NOT VERIFIED，未修改或重放。
- 本轮独立外部试玩：0 人。
- 状态含义：PASS-ENGINEERING / PASS-LOCAL 只表示明确列出的自动化合同，不表示端上、真实模型或阶段整体验收 PASS。

## R 节点

| 节点 | 状态 | 本轮证据 | 尚缺 |
|---|---|---|---|
| R0 | PASS-ENGINEERING | 2bbf179 D01 修复；基线复现 9/10、定向修复 13/13；最终 Core 1334/1334、版本门禁、Debug APK 和 head 620b268 的 Core/Android CI 均通过 | 完整真实开局 |
| R1 | PASS-ENGINEERING | 40e85a2 稳定引用、producer-backed 完成条件；修复和冻结历史合同回归 | 当前 APK 的完整生成/修复/采用旅程 |
| R2 | PASS-ENGINEERING | b871b88 修正 D14；生产 Session 生命周期和 settlement 定向测试 34/34 | 后果被实际下游消费的真实旅程 |
| R3 | PARTIAL | 预算 authority、审批、并发/fence、timeout/unknown 定向测试 53/53；历史账本隔离登记 | 私有账本/attempt 原始凭据和差异对账 |
| R4 | PASS-ENGINEERING | b51331a 首轮修复 + 36fe25d 复审补强；生产 Session → 临时 SQLite 审计定向 11/11；源库只读 hash 未改变 | 三路汇合和后果消费者因果链 |
| R5 | PARTIAL | 49/49 故障/恢复合同测试；APK 与新 AVD 安装 hash 一致；配置页、键盘、字体比例冒烟 | 选择→骰点→叙事→提交→进程恢复的当前 APK 路径 |
| R6 | PARTIAL | 存档、迁移、fork、SQLite 和隐私相关定向测试 58/58 | 三意图全层隐私、用户数据库只读复核、save10 续玩设备旅程 |
| R7 | BLOCKED / PARTIAL | 没有派发真实请求；本地确定性合同可继续 | 无本轮预算 scope/请求上限/费用边界；完整旅程 0；合格 L1、80 决定和自然结局未证 |
| R8 | PARTIAL | 本地确定性 A40 100/300/1000；字体比例和键盘冒烟 | 10+10 matched performance、完整可访问性、四名独立试玩者 |
| R9 | PASS-HANDOFF | Draft PR #13 open/draft；head 620b268 的 Core Verify run 131、Android Verify run 96 均通过；分支 tip 与远端一致 | 真实玩法验收仍由 R3/R5–R8 外部依赖阻塞；PR 未合并、未发布 |

## G 门

| ID | 本轮状态 | 依据/差距 |
|---|---|---|
| G0 | PARTIAL | 当前源码/APK/AVD 身份、本地请求计数及 PR CI 已核验；历史预算账本仍未核验。 |
| G1 | PARTIAL | R1/R2 工程合同和四档确定性测试通过；合格 L1 分布及真实 Planner 0 请求证据未形成。 |
| G2 | PARTIAL | 投影只读工程测试和 R4 审计通过；无三路汇合后的机制差异及两条下游消费链旅程。 |
| G3 | NOT NEEDED（本轮） | 本轮未启动 M3 或真实付费模型路径；这只说明本轮没有触发 M3 判定，不代表全局永远不需要 M3。 |
| G4 | PARTIAL | Android 只有空配置页冒烟；真实内容质量、旅程、性能和外部试玩未完成。 |
| G5 | PARTIAL | 新空 AVD 冷启动与 UI 首屏冒烟通过；没有旧数据迁移/正式故障恢复/设置保存后重启验证。 |

## V95

| ID | 状态 | 证据边界 |
|---|---|---|
| V95-01 | PASS-ENGINEERING | Runtime writer 与权威状态可追踪，Core 回归通过。 |
| V95-02 | PASS-ENGINEERING | 缺失 difficulty/evidence/权限要求保持安全拒绝；不以默认值补齐。 |
| V95-03 | PARTIAL | 物理 Planner 请求 0；没有本轮合格 L1 资格分布。 |
| V95-04 | PASS-DETERMINISTIC | 相同规则/合同/骰流四档结果由确定性测试覆盖。 |
| V95-05 | PARTIAL | 本地 timeout、unknown、审批恢复和并发合同测试；没有 Android 双击、杀进程和当前 APK 重放。 |
| V95-06 | PASS-ENGINEERING | 机会投影可重算、只读，不作为第二状态权威。 |
| V95-07 | PARTIAL | R4 能核对 discharge 且不重复计数；未证明下游消费或三路汇合。 |
| V95-08 | NOT RUN | 三意图真实材料至公开输出的完整隐私对照没有运行。 |
| V95-09 | PARTIAL | 稳定引用和供给合同测试通过；R69、Stage-1/8 当前身份端上恢复未验。 |
| V95-10 | PARTIAL | 自动化 save/fork/恢复测试和冷启动首屏冒烟；未完成 save10 续玩及新行动历史绑定端到端。 |
| V95-11 | NOT NEEDED（本轮） | M3 本轮未启动；不据此作全局架构结论。 |
| V95-12 | BLOCKED-EXTERNAL-HUMAN | 独立参与者 0/4。 |

## A01–A40（阶段 9 遗留）

| ID | 状态 | 本轮依据或缺口 |
|---|---|---|
| A01 | NOT RUN | 未完成同小说三种意图旅程。 |
| A02 | PARTIAL | R0 canon 候选去重工程修复；未完成原著/原创角色配对及更换起点旅程。 |
| A03 | NOT RUN | 晚到来源、按需补建、正式采用后可玩未运行。 |
| A04 | NOT RUN | 未完成明确目标与开放探索对照。 |
| A05 | PARTIAL | 冻结历史和完成条件有工程合同覆盖；没有真实未来计划旅程复核。 |
| A06 | NOT RUN | 救援/存活后规划未运行。 |
| A07 | PASS-ENGINEERING | 无效/截断/删字段式候选不能绕过生产校验；R1 合同回归。 |
| A08 | NOT RUN | ready 前强停和占位恢复未在当前 APK 验证。 |
| A09 | PARTIAL | 一次性/事务恢复有自动化覆盖；当前 UI 双启动和采用中断未验证。 |
| A10 | NOT RUN | 两条路径汇合后的状态/机会差异未完成。 |
| A11 | PASS-ENGINEERING | 生产 Session 测试验证点击方法与同义自由文本绑定相同冻结方法；设备 UI 路径未验证。 |
| A12 | NOT RUN | 模板外但既有能力允许的组合行动未取样。 |
| A13 | PASS-ENGINEERING | 稳定引用、异地/过期引用及资格合同由 R1/定向 Core 测试覆盖。 |
| A14 | PASS-DETERMINISTIC | 四档冻结与 Runtime 结算由确定性测试覆盖；无叙事代替效果。 |
| A15 | PARTIAL | 四档/恢复合同测试通过；无连续失败后自然恢复及普通成功完整玩法样本。 |
| A16 | PASS-ENGINEERING | settlement 与 audit 合同区分 changed/no_change，且不凭叙事制造状态变化。 |
| A17 | PARTIAL | 一次性奖励/有限供给工程测试；未完成提前解决和绕过的真实旅程。 |
| A18 | NOT RUN | 偏离、暂停、改目标与恢复 UI 矩阵未运行。 |
| A19 | PARTIAL | 审计能区分 triggered/discharged/cancelled；未跟踪两条后果的下游消费者。 |
| A20 | PASS-ENGINEERING | replan、冻结输入和 fencing 回归覆盖；无当前 APK 在途竞态旅程。 |
| A21 | PARTIAL | 预算并发 reservation/fence 测试通过；未做设备触发合并及完整后台竞争矩阵。 |
| A22 | PARTIAL | 部分稳定 ID/来源合同通过；目标、顺序、规则、风格全身份配对未运行。 |
| A23 | PARTIAL | save/fork/recovery 合成回归通过；当前身份设备上未续行动并证明模型步骤复用。 |
| A24 | PASS-ENGINEERING | 冻结 JSON/hash/依赖损坏和导入拒绝有自动化覆盖；HTTP 0 仅限测试 fake。 |
| A25 | PARTIAL | 本地请求窗口和资格合同有测试；未逐项证明所有材料超窗/能力未知场景。 |
| A26 | PARTIAL | 本地预算/attempt 合同 53/53；私有历史账本未取得，无全局对账。 |
| A27 | PARTIAL | timeout/429/unknown 分类合同有覆盖；本轮没有真实物理响应，不能证明真实账一致。 |
| A28 | PARTIAL | 固定骰流、采用、提交和 outbox 故障路径有定向覆盖；当前设备真实随机样本未运行。 |
| A29 | PARTIAL | 响应校验/修复后采用合同回归；无当前 APK 完整恢复旅程。 |
| A30 | PASS-ENGINEERING | 编辑/取消和旧 worker fence 拒绝由本地确定性合同测试覆盖。 |
| A31 | PARTIAL | fork/save 历史测试通过；rewind 后知识、后果、计划隔离全链未验。 |
| A32 | PASS-ENGINEERING | save/fork/迁移、坏引用和不支持输入合同由本地测试覆盖；设备续玩未验。 |
| A33 | PARTIAL | 合成秘密/禁止字段拒绝部分覆盖；三意图全部层级和日志仍未审。 |
| A34 | NOT RUN | 当前 APK 没有完成 Stage/结局 UI 与状态/事件一致性旅程。 |
| A35 | PARTIAL | API 37 空配置页键盘/字体比例冒烟；TalkBack、小屏、主题、真机未验。 |
| A36 | BLOCKED-EXTERNAL-HUMAN | 独立试玩和六维评分 0/4。 |
| A37 | BLOCKED-REAL-PERFORMANCE | 未有真实预算或匹配基线/最终模型样本；A40 本地合成结果不能替代。 |
| A38 | PARTIAL | 源码、APK 和空 AVD 安装 SHA 已绑定；完整旅程/真实模型证据为 0。 |
| A39 | NOT RUN | 同世界三个 campaign 的隔离旅程未运行。 |
| A40 | PASS-LOCAL | 生产 Session 确定性 100/300/1000 累积结果已保存；不计为玩家决定。 |
