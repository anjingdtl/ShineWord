# 预算、累计与性能

## 真实请求账本

| 项 | 开始 | 结束 |
|---|---:|---:|
| scoped cap | 600 | 600 |
| scoped spent | 510 | 510 |
| scoped completed | 510 | 510 |
| scoped unknown / in-flight | 0 / 0 | 0 / 0 |
| scoped remaining | 90 | 90 |
| 本轮真实 HTTP | 0 | 0 |

上述值来自唯一权威 `test-logs/phase9-5-longrun-2026-10-11/budget-manifest.json`。模型 profile 为 GLM-5.3-Flash。Android loopback 18591 没有监听，`adb reverse` 列表为空。

必须同时保留一个账本外风险：设备 SQLite 有冻结 J1 Narrator `outcome_unknown` attempt，未能关联 scoped dispatch audit。它未重发，未从旧 turn 恢复；因此即使账本显示剩余 90，本轮仍没有真实模型资格。应用 DB unknown 不能被伪并入或用编辑账本消除。

读取配置时出现一次本地工具输出的凭据泄露，值未写入报告/仓库且未用于 HTTP。应轮换该凭据，再提供新的安全配置路径；本报告不含 key。

## A40 独立确定性工程累积

独立 QA SQLite 数据库通过 `CampaignSession.playTurn` 和生产提交/快照路径运行；默认确定性测试 provider，没有物理网络调用。开局包含 1 条 fixture committed turn；下表的 `action turns` 才是本轮累积动作。

| 新提交动作 | committed turns 总数 | stateVersion | snapshots | 图节点状态数 | branch events | stub Planner/Narrator | HTTP | 累计时间 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 101 | 100 | 101 | 2 | 11 | 100 / 100 | 0 | 52.1 s |
| 300 | 301 | 300 | 301 | 2 | 11 | 300 / 300 | 0 | 87.3 s |
| 1000 | 1001 | 1000 | 1001 | 2 | 11 | 1000 / 1000 | 0 | 238.9 s |

这是工程增长/提交证据，不计玩家决定，不代表 Android、真实 provider、成本或真人体验。较早的两个试跑分别发现 checkpoint 把 fixture 开局计入动作数、L1 fixture 的可见 evidence/后续方法边界配置不合；两份部分 QA 库和日志保留，最终 A40 使用 fresh DB、L2 确定性 provider，三个检查点均完成。没有复用失败数据库冒充通过。

## 性能合同

没有本候选匹配 world/source/actor/state/model/reasoning/device 的 baseline10 与 final10；动作到规则结果、完整叙事、后继首次可用的 P50/P95 和改善率均未计算。2301 ms 仅是本次 API37 冷启动单次观察，不是稳定性能 P95。实际 token/费用 usage 不足，不报告成本推算。
