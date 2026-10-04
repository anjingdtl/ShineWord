# Phase 8 验收矩阵（A01–A36）

状态值：`PASS` / `FAIL` / `NOT RUN`。NOT RUN 不计入通过。每项须给出证据位置；最终状态见本文档末尾的结论表，历史快照不覆盖。

| 编号 | 场景 | 状态 | 证据 | 备注 |
|---|---|---|---|---|
| A01 | `【当前局面】` 对应资料进入生产回合 | NOT RUN | — | |
| A02 | 未知 kind / renderer 或缺依赖 | NOT RUN | — | |
| A03 | 记忆 ahead、dirty、错误 branch / hash | NOT RUN | — | |
| A04 | 超过近期窗口且有未兑现承诺 | NOT RUN | — | |
| A05 | GM 秘密、隐藏别名、原著未来 | NOT RUN | — | |
| A06 | whole-item 第一项太大，后项小 | NOT RUN | — | |
| A07 | 低需求板块与高需求板块 | NOT RUN | — | |
| A08 | mandatory 超窗、模型能力未知 | NOT RUN | — | |
| A09 | Narrator 加 Prepared / repair 后超窗 | NOT RUN | — | |
| A10 | Preview、真实 Send 和恢复一致性 | NOT RUN | — | |
| A11 | 已冻结后记忆更新或设置变化 | NOT RUN | — | |
| A12 | 冻结 JSON 损坏 / hash 不符 | NOT RUN | — | |
| A13 | 骰点 / Prepared / 正文后强停复用 | NOT RUN | — | |
| A14 | outbox 写失败与事务中断 | NOT RUN | — | |
| A15 | 普通、休息、训练、NPC、队伍、局面全覆盖 | NOT RUN | — | |
| A16 | 同一 handoff 重复消费 / 两 worker | NOT RUN | — | |
| A17 | 请求 sent 后强停，lease 过期 | NOT RUN | — | |
| A18 | repair + reasoning + fallback ≤3 HTTP | NOT RUN | — | |
| A19 | 两个基线不同的记忆合并 | NOT RUN | — | |
| A20 | rejected evidence / ref / N-key | NOT RUN | — | |
| A21 | 跨回合 anchor、未来 key / 证据 | NOT RUN | — | |
| A22 | 多回合 first / last / resolve 时间 | NOT RUN | — | |
| A23 | 确定性变化却返回空 observation | NOT RUN | — | |
| A24 | 合法 no_change 与字段清空 | NOT RUN | — | |
| A25 | 100 / 300 / 1000 累积经历 | NOT RUN | — | |
| A26 | 模块缺失、循环、冲突、参数越界 | NOT RUN | — | |
| A27 | 三种世界组合和关闭战斗 | NOT RUN | — | |
| A28 | 新 pressure_track 机制 | NOT RUN | — | |
| A29 | schema 能表达但执行不支持 | NOT RUN | — | |
| A30 | 相同绑定、状态、行动、roll 确定性 | NOT RUN | — | |
| A31 | 分叉点前后 / 跨点记忆批次 | NOT RUN | — | |
| A32 | 当前稳定头 save → import 往返 | NOT RUN | — | |
| A33 | 旧协议、缺模块、损坏 hash 导入 | NOT RUN | — | |
| A34 | 新空库 / 旧开发库 | NOT RUN | — | |
| A35 | 核心夹具与移动端依赖装配 | NOT RUN | — | |
| A36 | 故障后的 UI 与报告诚实性 | NOT RUN | — | |

## 门禁对照

| 硬门禁 | 来源 | 状态 |
|---|---|---|
| mandatory / 最终 wire 不超声明窗口；未知能力零发送 | A08/A09 | NOT RUN |
| 冻结损坏零调用 | A12 | NOT RUN |
| 每逻辑记忆批次 ≤3 HTTP | A18 | NOT RUN |
| 权威提交 handoff 覆盖率 100% | A15 | NOT RUN |
| 接受观察证据可定位率 100% | A20/A21 | NOT RUN |
| 未来 / 非公开资料泄漏为 0 | A05/A21/A31 | NOT RUN |
| CAS 失败无覆盖副作用 | A19 | NOT RUN |
