# 需求追踪

完整 G、V95、A01–A40 状态表见本轮 ACCEPTANCE_MATRIX.md。不变更阶段9合同口径，不把本地合成回合计入正式有效决定。

| 方案节点 | 主要要求 | 本轮状态与证据 |
|---|---|---|
| R0 | 重现角色候选重复并最小修复 | PASS-ENGINEERING；当前 node --test tests/game-opening-chain.test.cjs 为13/13，旧反例9/10和修复提交见历史执行报告。 |
| R1 | 稳定引用、候选修复、producer-backed完成条件 | PASS-ENGINEERING；见既有完整 Core 与合同用例。 |
| R2 | 可执行路线、有限收益、后果生命周期 | PASS-ENGINEERING；D14 metadata一致性与Session生命周期合同已记录。 |
| R3 | 预算 authority、差异、unknown 与恢复 | PARTIAL；本地53/53；本轮真实预算scope为空，历史物理账本/unknown仍未核。 |
| R4 | 有效决定与旅程审计 | PASS-ENGINEERING；生产Session→临时SQLite审计11/11；没有正式玩家决定样本。 |
| R5 | Android供给状态、精确回放与故障恢复 | PARTIAL；新增合成APK UI检定、骰点/故事提交、进程冷启动与精确读回；精确历史存档、真实provider及故障中断路径未验。 |
| R6 | 三意图隐私、存档和兼容 | PARTIAL；58/58本地合同；新增长期隔离的合成save/world依赖拒绝及导入旅程；无save-10、全意图隐私和私有DB只读检查。 |
| R7 | 真实玩法、L1与因果闭环 | BLOCKED / PARTIAL；无新真实调用、真实完整旅程、L1资格统计、80个决定或因果消费者链证明。 |
| R8 | 性能、可访问性、外部试玩 | PARTIAL；A40本地100/300/1000保留；无配对性能、完整可访问性或4名独立试玩者。 |
| R9 | 最终回归、关闭和交接 | PARTIAL-HANDOFF；当前分支/PR/CI与接续证据需在最终提交后复核；不合并、不发Release。 |

推断状态和失败尝试按实际证据分类；HTTP 200、分支版本递增、合成旅程、A40样本均不能替代真实模型、80个有效玩家决定或阶段关闭。
