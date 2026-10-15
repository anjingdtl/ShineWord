# 需求追踪

详细逐项状态见 ACCEPTANCE_MATRIX.md；测试、设备和资源细节由本目录中对应证据文件支撑。

| 节点 | 本轮结论 | 证据 | 未关闭的主要门 |
|---|---|---|---|
| R0 | PASS（工程） | E-BASE、E-R0、TEST_REPORT、EXECUTION_IDENTITY | PR/CI 尚待远端认证路径；独立验收 |
| R1 | PASS（工程） | E-R1、最终 Core 回归、定向引用/完成条件测试 | 当前 APK 的生成-校验-修复-采用 UI 全链 |
| R2 | PASS（工程） | E-R2、生产 Session 生命周期/settlement 测试 | 真实后果被下游消费的旅程 |
| R3 | PARTIAL | E-R3 | 私有账本、attempt 原始证据和历史差异不可用 |
| R4 | PASS（审计工具） | E-R4 | 三路汇合及两条下游消费链未证 |
| R5 | PARTIAL | E-R5、回放/恢复定向测试 | 真实行动、骰点、Narrator、commit/outbox 和恢复 |
| R6 | PARTIAL | E-R6 | 三意图隐私、真实 save10 续玩、私有库复验 |
| R7 | BLOCKED / PARTIAL | E-R3、E-R5、E-EXT | 无本轮预算 scope/请求上限/费用边界；完整旅程 0；合格 L1、80 决定和自然结局未证 |
| R8 | PARTIAL | E-R8/A40、E-EXT | matched real performance、完整可访问性、4 名独立试玩 |
| R9 | PASS-HANDOFF | 本报告、Draft PR #13、run 130/95 CI | 外部验收项仍 PARTIAL/BLOCKED；未合并、未发布 |

历史说明：原始私有 budget ledger 与 attempt 响应未在本机合法可核验位置发现。旧报告中的余额和 unknown 未继承或重写。当前 run 没有新 unknown，也没有物理请求。
