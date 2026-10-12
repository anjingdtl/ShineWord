# 真实请求预算与性能

## 单一物理请求账本

- Manifest：test-logs/phase9-5-longrun-2026-10-11/budget-manifest.json
- Scope：shineword-phase9-5-20261011；硬上限 600
- 最终已花费 510/600；剩余 90
- 510 completed；0 sent/in-flight；0 outcome_unknown
- 本轮新建作用域 0；重置或借用历史预算 0

| Request kind | 数量 |
|---|---:|
| world_extract | 2 |
| style_analyzer | 1 |
| opening_goal | 9 |
| campaign_plan | 132 |
| world_mapping | 1 |
| planner | 89 |
| narrator | 225 |
| memory_checkpoint | 40 |
| narrator_guidance | 9 |
| memory_repair | 2 |
| **总计** | **510** |

账本计物理请求，不是玩家回合或决策。清单没有足够的 token/货币成本字段，不报告精确费用或推测金额。密钥未进入报告。

## A40 本地累积性能

最终源码身份下的本地确定性 A40，1/1 通过：

| 决策数 | stateVersion | Snapshot 字节 | Runtime 字节 | 查询毫秒 | 累计耗时毫秒 | 本地 Mock 调用 |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 100 | 5,128 | 1,414 | 0.839 | 1,149.7 | 200 |
| 300 | 300 | 5,129 | 1,414 | 2.191 | 4,340.8 | 600 |
| 1,000 | 1,000 | 5,133 | 1,415 | 6.876 | 28,128.3 | 2,000 |

Mock 调用未访问真实模型，也未计入 510。该测试覆盖状态/运行时存储增长与查询，不覆盖 Android 磁盘恢复。

同一世界、来源、角色、状态、模型、推理设置与设备上的 baseline 10 + final 10 匹配样本未执行。不报告 P95、整体延迟改善比例或真实费用比较。A37 仍 NOT RUN。
