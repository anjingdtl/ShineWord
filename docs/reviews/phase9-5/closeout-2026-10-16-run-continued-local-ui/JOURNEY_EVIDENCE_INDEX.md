# 旅程与证据索引

| 证据 ID | 身份/来源 | 本轮能证明的内容 | 不证明的内容 |
|---|---|---|---|
| E-BASE | BASELINE.md，fetch origin/main | 远端基线、隔离 worktree、工具链、资源存在性检查 | 当前 CI、设备旅程、旧私有账本 |
| E-R0 | 提交 2bbf179…，定向 13/13；基线 9/10 | D01 角色候选去重故障可复现并由最小修复覆盖 | 模型语义质量或完整开局 UI |
| E-R1 | 提交 40e85a2…，Core 1328/1328 时点证据 | 稳定引用、producer-backed 完成条件和修复合同 | 当前 APK 上的完整候选生成/采用旅程 |
| E-R2 | 提交 b871b88…，构建 core + 定向 34/34 | D14 manifest 状态字段元数据与真实 snapshot 字段对齐 | 真实玩家后果消费 |
| E-R3 | REQUEST_RECONCILIATION.md，定向 53/53 | 本地预算 authority、并发/fence、审批恢复与 unknown 合同 | 私有历史账本对账；本轮没有任何 paid request |
| E-R4 | 提交 b51331a… + 36fe25d…，审计测试 11/11 | 生产 Session 写入临时 SQLite 后，审计能记录最终 discharged 且不重复计数 | 下游消费链已完成或真实旅程通过 |
| E-R5 | ANDROID_EVIDENCE.md + R5_SYNTHETIC_UI.md + screenshots + local mock log | 当前Debug APK在隔离AVD完成合成skill-check、骰点、Narrator、commit、force-stop冷启动与同turn精确读回 | 真实provider、历史save-10/Stage-1/8、in-flight故障恢复、有效玩家决定或正式旅程配额 |
| E-R6 | PRIVACY_AND_SAVE.md，定向 58/58 | 本地合成存档、迁移、fork、拒绝条件和若干隐私约束 | 三意图端到端隐私或用户私有库兼容 |
| E-R8/A40 | PERFORMANCE.md + A40_LOCAL_PERFORMANCE.json | 本地确定性 100/300/1000 累积压力 | 真实玩家决定、真实模型性能或阶段9配额 |
| E-R8/UI | ANDROID_EVIDENCE.md + `R8-small-screen-turn-top.png` + `R8-talkback-focus-1.png` | 单一小屏视口结果可读、当前页面TalkBack焦点/语义冒烟 | 完整焦点顺序/播报、主题、API24、实体机或可访问性正式验收 |
| E-EXT | EXTERNAL_PLAYTEST.md | 清晰登记 0 名独立参与者和恢复条件 | 任一外部质量 PASS |

本轮当前身份下的完整真实玩法旅程为 0；有效玩家决定为 0。离线生产 Session 压力决定数另行保留，绝不并入旅程计数。真实模型派发和物理 HTTP 请求均为 0。


本轮R5 UI证据限于隔离合成fixture与本地loopback provider；11条请求已记录，真实provider物理请求0。
