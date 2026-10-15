# Shine-TRPG 阶段 9.5 收口施工报告

运行目录：closeout-2026-10-15-run-1558utc-codex。工作跨越 Asia/Shanghai 2026-10-15 至 2026-10-16；证据身份、执行结果和续接信息以本目录文件为准。

## 结论

- 阶段 9.5：PARTIAL，未关闭。
- 阶段 9 遗留整体：PARTIAL，未关闭。
- 工程修复可交接：本地源码和自动化证据已整理；远端 push/PR/CI 状态以最终更新为准。
- 当前身份的完整真实旅程 0，有效玩家决定 0，物理模型请求 0，独立试玩参与者 0。
- 本地 A40 的 100/300/1000 是生产 Session 上的确定性合成压力回归，不是玩家决定、付费调用或正式旅程。
- 没有合并 main、发布 Release、修改用户现有 app 数据、读取授权小说正文或读取 GLM 密钥。

## 改动与根因

| 节点/提交 | 根因 | 处理 |
|---|---|---|
| R0 2bbf179 | 开局同名 canon 候选可因 actor template 再次实例化，导致角色列表重复；基线测试 9/10 可复现。 | 在候选上限前使用来源证据签名进行稳定去重，兼顾别名冲突和不同证据；补 4 项回归，定向 13/13。 |
| R1 40e85a2 | 稳定引用和阶段完成事件的生产者/冻结历史约束不足，可能接受没有本地生产者的自定义完成事件。 | 按行动类型验证稳定 ID 与可见引用；完成条件要求匹配冻结基线中的可靠事件或合法 producer；补充合同回归。 |
| R2 b871b88 | exploration_discovery manifest 把实际 snapshot 字段 discoveries 写成 discoveredEntryIds，且注释错误暗示其实施 writer 隔离。 | 对齐 metadata 字段并修正注释；增加 manifest 与 snapshot 字段回归。它是元数据一致性修复，不新增第二状态权威。 |
| R4 b51331a + 36fe25d | 旅程审计初版只计 triggered，但生产 Session 会在一个事务内完成触发、效果和 discharged；旧审计还按事件类型去重、从缺失证据推断状态。复审发现连续快照充分的 rest 被误标 UNKNOWN，同版本另一 turn 的事件也可能替当前 turn 背书。 | 按生命周期幂等键取最新状态，区分排程/触发/应用/取消/消费者；缺失或冲突证据标 UNKNOWN。修正 rest 快照和 recordEvent 载荷核对，并要求事件 turn_id 与被审计提交一致；定向 11/11。 |
| R3 | 没有取得私有历史账本/attempt 原始证据，无法有根据地调和预算差异。 | 未改账、未推测归并、未重派 unknown；记录本轮物理请求 0、恢复责任和只读核验条件。 |

人工复审检查了 R0、R1、R2 D14 和 R4 的生产差异及测试；R4 复审新增了 rest 快照状态、rest recordEvent 与 event-turn 绑定反例并完成修复。没有独立第三方代码审查。测试预期和业务校验未为追求全绿而放宽。

## 节点和验收

完整矩阵位于 ACCEPTANCE_MATRIX.md，需求和证据关系位于 REQUIREMENT_TRACE.md。工程闭环为 R0/R1/R2/R4；R3 部分完成；R5/R6/R8 有限证据；R7 被预算和真实旅程依赖阻塞；R9 推送、PR 与 CI 状态以本报告后续更新为准。

G/V95/A 项不因自动化或首屏冒烟整体 PASS。G0/G1/G2/G4/G5 均 PARTIAL；G3 仅在本轮为 NOT NEEDED。V95-12/A36 等待独立人员，真实模型与历史对账保持未验证。A40 本地确定性样本独立登记。

## 测试、APK 与设备

测试结果见 TEST_REPORT.md。最终 Core 回归 1334/1334；移动端 typecheck、版本检查、Debug APK 构建和 diff 检查通过。APK SHA-256 为 3d74e582f40a6203cb997e682e1d767eccdd9eaf70758b129c4e49c9c429095b，110156351 bytes；安装到隔离 API 37 AVD 后拉取的 base.apk hash 一致。源码身份见 EXECUTION_IDENTITY.json。

设备只完成空配置页、冷启动重试、输入焦点/键盘和 1.3 字体比例冒烟。没有配置 API、读取小说、提交模型请求、开始游戏或修改既有 AVD 数据。

## 预算、unknown 与素材

- 本轮 GLM 物理请求：0；budget scope、请求上限和费用边界未提供，因此没有真实付费派发。
- 历史私有账本、attempt 原始响应与 SQLite：NOT VERIFIED。旧报告中额度与 unknown 未继承；未清零、未改账、未借用额度、未重放。
- 本轮新建 unknown：0。
- 用户授权的配置/小说资源仅登记存在性和逻辑用途；没有读取密钥或小说正文，也未进入仓库。

## PR 与 CI

- 施工分支已推送并核对远端 ref：codex/phase95-closeout-short，head f52563b4f54fca3fef030a26fcb36af5dd9f5cfd。
- Draft PR #13：https://github.com/anjingdtl/ShineWord/pull/13；base main 599d038efa6a65d7107f276961bc7b66caab37f6；未合并、未发布。
- 该候选 SHA 的 Core Verify run 130（38769959336）PASS；Android Verify run 95（38769959429）PASS，包含 mobile typecheck 和 Debug APK build。
- 本报告提交为后续文档归档；生产源码摘要和 APK SHA 未改变。最终 branch tip 的检查需在文档提交推送后再次读取。

没有自动合并 main 或发布 Release。

## 交接

从 ACCEPTANCE_MATRIX.md 查看所有未关闭项；从 CHECKPOINT.md 继续。下一步先重查 origin/main 和认证，按授权推送施工分支并创建 PR，等待该提交 CI；之后的最小安全动作是取得独立预算授权/私有账本证据/试玩人员，再分别推进 R3、R5–R8。不得自动执行模型请求、重放 unknown 或改动用户历史数据。
