# 缺陷与反例登记

| ID | 状态 | 根因/反例 | 修复与回归 | 证据边界 |
|---|---|---|---|---|
| D01 | 修复；工程门禁待最终同 SHA 复验 | `getWorldSetup` 先筛可见角色事实，却返回全部角色实体行；重复事实与未合并实体会让角色候选重复。远端 main 上 `node --test tests/game-opening-chain.test.cjs` 可复现 9 pass / 1 fail（实际数组 2，预期 1）。 | R0 提交 `2bbf179…`：按可见、锚点前事实建立 source-backed signature，只在同名、证据重合且无别名冲突时折叠；稳定代表按 entity ID 排序。新增存储倒序稳定、同名异人、别名桥冲突、未来证据过滤回归。 | 原著人物正文未读取；本项使用合成 world fixture。R0 完整 Core 旧运行 1317/1317；最终同 SHA APK/CI 仍待完成。 |
| D04 | R1 修复；目标回归通过 | 规划完成条件的事件分支需要可证明来源：历史事件须在冻结 base version 前存在且 payload 过滤匹配；否则必须有当前普通成功 producer 或白名单引擎来源。先前 completion 检查未把分支历史传入完整候选 job，且仅按事件类型而非 payload 推断 producer。 | R1 提交 `40e85a2…`：candidate job 读取 branch 事件至 `baseStateVersion`，严格按 payload/type 匹配；记录事件 producer 按 `eventType+summary` 对照；保留已登记引擎事件白名单。完整 opening、replan、successor-preparation job 覆盖有来源、错 payload、冻结版本后事件、无来源、当前生产者、引擎来源；原始模型响应字节保持、无效修复一次后停止。 | 合成 provider + 临时 SQLite；未使用付费模型或修改历史存档。 |
| R01 | R1 修复；工程门禁通过 | `skill_check` action 缺稳定 skillId 可被 parser/compiler 保留为可发布候选；动作字段会混用显示别名或错误 action kind；itemId 列表已构建但未实际校验。 | 必需 skill/ability/destination 按 action kind 检查；拒绝不匹配字段；技能、能力、物品、场景引用必须精确匹配当前可见 ID；生成提示词说明 ID 合同并移除可误复制占位值。开局/replan/后继完整 job 均有回归。 | 中文地点 ID `青石巷` 正常通过完整开局 job；不可见、前缀别名、缺省/空/类型错误和 action-kind 不匹配保持拒绝。 |
| R4-AUDIT-01 | R4 修复；定向生产回归通过 | 审计器仅统计 `triggered`，但正式 Session 在同一个 SQLite 提交里完成 trigger→effect apply→`discharged`；最终快照只保存 `discharged`，因此旧审计漏计。旧审计也按事件类型去重、从缺失快照/事件推断状态，无法区分取消、应用与下游消费。 | R4 提交 `b51331a…`：按 `idempotencyKey` 取最新状态；分别输出 pending/triggered/discharged/cancelled、排程/触发/应用/取消事件、effect event 类型和未跟踪 consumer；缺快照、事件或身份变更返回 UNKNOWN。完整/增量间隔共用全历史决定候选。 | `node --test tests/phase9-journey-audit.test.cjs` 9/9；生产 Session→临时文件 SQLite；源 DB SHA-256 读前读后相同；审计不会将 discharged 宣称为消费闭环。 |
| D14 | R2 校正；工程回归通过 | `MECHANISM_MODULES.exploration_discovery.ownedFields` 标成不存在的 `discoveredEntryIds`；权威 `GameStateSnapshot` 使用 `discoveries`，且由 campaign settlement/session 多条既有路径维护。manifest 类型注释还暗示了并未实现的 writer 独占。 | R2 提交 `b871b88…` 将路径更正为 `discoveries`，注释声明它只是能力相关状态域元数据，不执行 writer 隔离。`ownedFields` 未进入配置 hash / rule binding 的输入；未修改协议版本、状态结构或 writer。 | `npm run build:core` 退出 0；P8-6 manifest 回归通过。定向 30/30（继承完成、后果生命周期、settlement、adoption、模块合同）+ closeout R2 4/4。 |

## 未结缺陷/风险

- 其余 R2/R3/R5/R6/R7/R8/R9 需继续逐项复核；不能由历史报告或 Core 总绿自动关闭。
- R3 私有账本对账、R5 设备交互、R7 真实模型/正式旅程、R8 外部试玩分别记录为依赖项；缺失时维持 BLOCKED / NOT VERIFIED。
