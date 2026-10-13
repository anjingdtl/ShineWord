# 因果分支与重规划复验

## 分支

- 来源：`camp-mv5kpgrf-main` v33。该状态 `plan_ready=20` 含 turn-0033 修复前重复领奖，未作为正常准备玩法通过证据。
- 正式 UI 回退先建 `camp-mv5kpgrf-bmv657z83` v32，再建 `camp-mv5kpgrf-bmv65sk2n` v31。没有重写来源 turn 或从未提交回合恢复。
- 最终 save-10 导入副本 `camp-mv66t99t-main` 保持 stateVersion 31，只有一条分支；来源与导入快照的延迟 consequence 数据一致。

## 悬空触发器

v31 来源及导入分支都保留 6 条 pending consequences。以下两条仍依赖终态为 `superseded` 的节点：

| consequence | 当前条件 | 当前节点状态 |
|---|---|---|
| `consequence-roland-tacit` | stage-3 `succeeded` | stage-3 `superseded` |
| `consequence-route-verified` | stage-4 `succeeded` | stage-4 `superseded` |

它们在旧快照中已经悬空。本轮没有伪造 `succeeded`、改 trigger、发奖励或取消义务。新 replan adoption 会拒绝本次才引入的“原先可达 → 采用后不可达”pending trigger；对旧状态不追写管理事件。若要加入取消/解除生命周期，必须先定义新协议的事件、幂等、分支隔离和兼容方案；本轮没有引入该协议。

## 因果链验收

`newlyOrphanedPendingConsequences` 回归覆盖 `all/any/not`、终态和旧悬空条件；避免 `any` 的单个失败叶子误杀另一条仍可达路径。当前分支只有一个 active node、stage-3/4/5 已 superseded。真实三路汇合、两条后果间隔至少两个有效决定并被下游实际消费均未发生。

根因已被阻止在新采用边界，旧快照仍悬空且没有消费证据。因此 V95-07 与 A19 本轮 FAIL，不能把“取消”算作触发与消费。
