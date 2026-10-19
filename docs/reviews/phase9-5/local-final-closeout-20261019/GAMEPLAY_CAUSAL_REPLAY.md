# 游戏因果链与玩家验收边界

日期：2026-10-19。详细分支、状态差异和哈希见 [既有因果回放报告](../local-final-closeout-20261018/GAMEPLAY_CAUSAL_REPLAY.md)。

- 真实小说衍生的 QA campaign 有 19 个 agent-driven action turns；这些行动不计作用户玩家决定。L1 campaign-scope 路径显式固定空 evidence，不能代替小说包中的非空来源 evidence L1。
- stage-4 的三项 delayed consequences 与 stage-8 成功支线的一项 consequence 均有设备 trigger/consumer 记录。stage-8 early-exit sibling 对照验证终局会取消已不可达的 pending consequence；成功 sibling 正常 discharge 并写入 knowledge/event。
- stage-5 的 con-barov-offer 在隔离 QA branch 被触发、消费，并进入下一回合冻结上下文；下一回合 Narrator HTTP status 尚未对账。不能宣称主线或玩家反馈已经证明该内容质量。
- 合成 M4 QA AVD 上另有两次本地 mock 行动、骰点、Narrator、原子提交和 delayed consequence 消费；属于工程证据。
- 本任务不计任何 action 为真实玩家决定。真人连续游玩、长期反馈、独立试玩和自然终局仍由用户和独立玩家完成。
