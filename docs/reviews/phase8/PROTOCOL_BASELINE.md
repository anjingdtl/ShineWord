# Phase 8 协议基线（P8-0 冻结）

| 项目 | 内容 |
|---|---|
| 文档性质 | P8-0 冻结登记；后续施工以本表为准，改动需在 IMPLEMENTATION_PROGRESS.md 记录原因 |
| 冻结日期 | 2026-10-04 |
| 施工基线 | `main@58a9825`（方案提交 commit；P7 收尾 852 项测试全绿） |
| 方案依据 | `docs/Shine-TRPG_PHASE8_CONSTRUCTION_PLAN.md` v1.0 |
| 单协议政策 | 开发期舍弃旧用户项目兼容；运行时只注册本表"当前值"一列，旧输入明确拒绝 |

## 1. 协议登记表（一次登记，施工者不得各自猜号）

| 协议 | 旧值（仅用于拒绝识别） | 当前值（冻结） | 说明 |
|---|---|---|---|
| 规则核心 | `shineword-core@0.2.0` | **`shineword-core@0.3.0`** | 六属性、技能骰、四档结果算法不变；分派/合同/状态/存档只保留新版本 |
| 世界包 | schema 2 / 3 / 4 | **`shineword-world-package-5`** | 新 schema：包内容 + 世界规则配置 + 执行能力闭包；不递归引用旧包 |
| 规则配置 | （无） | **`world-rule-config-1`** | 方案 §7.1 合同；configHash 锁定；发布后不可变 |
| 机制清单 | 固定 ruleset 分派 | **`mechanism-manifest-1`** | §6.2 manifest 合同；首期 8 个模块见 §3 |
| ActionContract | `protocolVersion: '1.0'` | **`protocolVersion: '2.0'`** | 增加 RuleBinding、模块贡献、成本单位、证据身份；删除旧解析器 |
| Planner Proposal | `'2.0'` | **保持 `'2.0'`** | 受限字段集已足够；不升级 |
| 存档 | `shineword-save-8`（导入还收 3–8） | **`shineword-save-9`** | 只接受 save-9；携带 Story Memory V3 与覆盖区间；旧存档明确拒绝 |
| 故事记忆 | V2（schemaVersion 2） | **`story-memory-v3`（schemaVersion 3）** | 观察/补丁/检查点一组合同；证据锚点、生命周期、CAS；V2 表不再写入 |
| 后处理 handoff | （无） | **`turn-postprocess-handoff-1`** | 唯一键 = 已提交回合 + 采用修订 |
| 回合材料 | `【标签】` 字符串 | **`turn-material-1`** | 有判别字段的联合类型；未知 kind 报诊断 |
| SQLite | migrations 1..32 | **`shineword-db-baseline-1`** | 新空库一次建全目标结构；旧开发库检测后拒绝并提示开发重置 |
| 应用版本 | V0.7.0 / 70000 | **P8-10 实际验收后登记**（预计 0.8.0 / 80000） | 不在设计阶段冒充已升级 |

## 2. 所有权登记（一个数据域一个写入者）

| 数据域 | 所有者 | 其他模块权限 |
|---|---|---|
| 世界原文 / canon | 既有 Source / World 构建发布层 | 只读有界查询 |
| 世界规则定义与组合 | `worldRuleConfiguration` + 发布层 | 不可变读取（configHash） |
| 游戏状态 / 奖励 / 模块状态 | `commitTurn` 共用 Reducer → `SqliteTurnStore.commitAtomic` | 模块只产出合法计划 |
| 冻结材料与请求投影 | `frozenTurnMaterials`（SQLite 持久化，替换 `lastTurnContexts` 权威作用） | 读 / 验证 / 派生视图 |
| LLM 物理请求 | 既有 `RateScheduledProvider` + `LedgeredProvider` + `SqliteLlmLedgerStore` | 关联逻辑任务，不另算成功次数 |
| 后处理任务 | `TurnPostProcessingCoordinator`（新建，分支串行 worker） | claim / lease / fencing / 完成 |
| 长期故事记忆 | Story Memory V3 CAS 仓库（唯一 writer） | 提交观察；权限化读取 |
| Episodic 索引 | 本地派生索引层 | 从已提交证据重建 |

提交边界唯一：状态、事件、奖励去重、正文采用、回合完成标记与 outbox handoff 在同一 `commitAtomic` 事务。纯本地行动（休息、训练、里程碑、遭遇内部行动、队伍/人物载入、局面结算）走同一边界，不额外调用 Planner/Narrator。

## 3. 首期机制清单与参数边界

| moduleId | 版本 | 职责 | 首期范围 |
|---|---|---|---|
| `skill_actions` | 1.0.0 | 技能资格、默认检定、行动编译 | 提炼既有算法 |
| `resources_conditions` | 1.0.0 | 资源上限、消耗恢复、条件、冷却 | 统一单位与支持效果 |
| `exploration_discovery` | 1.0.0 | 移动、调查、线索、知识 | 复用现有投影与发现事件 |
| `social_relationships` | 1.0.0 | 交谈、关系、招募 | 本地门槛；文字不反写数值 |
| `combat_zones` | 1.0.0 | 战区、轮次、先攻、救援、撤退 | 可在新配置中关闭 |
| `growth_rest` | 1.0.0 | 训练、休息、奖励、防刷 | 关闭战斗不强迫按击杀成长 |
| `situations_causality` | 1.0.0 | P7 局面、压力、条件事件、命运分歧 | 复用条件 AST 与 Prepared |
| `pressure_track` | 1.0.0 | 新增可选紧张/警戒/负担轨道 | 有界本地数值；证明可插拔 |

冲突预登记：`combat_zones` 与关闭战斗的世界配置互斥关闭（配置级不启用，非模块互斥）；`growth_rest` 在无 `combat_zones` 时不得启用击杀奖励来源。依赖：`situations_causality` 依赖 `resources_conditions`；`pressure_track` 依赖 `resources_conditions`；其余无依赖。组合顺序固定：`resources_conditions → skill_actions → exploration_discovery → social_relationships → combat_zones → growth_rest → situations_causality → pressure_track`。

内部属性 ID、rank、RollGrade 保持稳定：`full_success | success | failure | severe_failure`。世界可设显示名称与技能映射；任意维度与新骰制延后。

## 4. 证据、时间与身份语义

| 语义 | 冻结定义 |
|---|---|
| 回合身份 | `turnId`（既有格式不变）；取消的未提交回合不进入记忆，后续新行动用新 turnId |
| 事件锚点 | `branch_events.event_seq`（分支内单调）+ eventType；观察 evidence 必须引用真实存在且同批次范围内的事件 |
| 正文锚点 | 采用正文 revision hash + UTF-16 code unit offset + 长度；锚点由本地生成/验证 |
| 世界时间 | `clockSeconds`（世界时钟秒）；战斗轮次、行动次数、提交版本独立计数；任何持续量带单位与触发点；禁止把 `stateVersion` 当时间 |
| 状态版本 | 分支内单调；覆盖枚举从分支 seed/origin 的真实提交列表出发，不假设从 0 连续 |
| 批次时间 | 每个实体时间从所属证据推导（first/last/resolve 各自的证据版本）；禁止统一填批次终点 |
| 请求身份 | `campaignId + branchId + turnId + logicalRequestId + physicalAttemptId + role + stage + attempt + rootSnapshotId + requestSnapshotHash + contractHash + preparedHash + bodyRevisionHash` 一份关联结构 |
| 内容哈希 | 覆盖规范化实际内容、来源 revision、规则配置与执行能力、branch/baseVersion、知识、记忆指纹、模型能力、策略、指令版本；`stableFingerprint` 升级为 SHA-256 截断（保持现有调用兼容） |
| 检查点指纹 | 由真实 memory body 与有效 applied 链生成（延续 V2 链式指纹），不拼接批次 ID 冒充 |

## 5. 物理请求与预算政策（沿用并收紧）

- 逻辑记忆批次首期最多 **3 次实际 HTTP**（首次 + 修复 + 推理恢复 + 备用路径共同计数）；持久化计数，重启不重置。
- 冻结损坏 / hash 不符 / 规则不一致：显式失败，保留原信封，零 LLM 调用。
- `outcome_unknown`：不自动重发；沿用 `LedgeredProvider` + `recoverInterruptedAttempts` 政策。
- mandatory 超窗 / 能力未知：零发送。删除 `renderLegacy` 全量回退（P8-2）。
- 现有 `TurnRequestBudget(4)`（每回合 Planner+Narrator 物理上限）保留，作为前台回合物理预算，与记忆批次预算分开命名统计。

## 6. 数据库与开发数据政策

1. `shineword-db-baseline-1`：以现有 builtinMigrations 的最终结构为源，生成单次基线 DDL；新空库一个事务建全。
2. 检测到旧开发 schema（`schema_migrations` 存在且最大版本 < 100，或无 baseline 标记）：启动时明确报"开发数据不适用当前协议，请执行开发重置/新建项目"，不做静默转换。
3. 开发重置作用域：删除世界/战役数据；**不触碰** API 配置与 secure keychain（`SqliteLlmProfileStore` 数据独立保存）。
4. 本政策为施工约定；具体切换操作在 P8-8 落地并在 IMPLEMENTATION_PROGRESS.md 记录。

## 7. P8-0 六类最小回归（tests/phase8-gaps.test.cjs，开工时 RED）

| 编号 | 缺口 | 基线证据（RED） | 修复包 |
|---|---|---|---|
| G1 当前局面漏装 | `candidatesFromParts` 静默丢弃未知标签；`【当前局面】`（session.ts:2150）不入候选 | 候选缺失且无诊断 | P8-1 |
| G2 未来记忆 | 读入门禁只查 `clean && through >= current-8`；未来检查点（through > current）被当作可用 | 未来记忆 body 进入上下文 | P8-1 |
| G3 冻结损坏 | 无持久化冻结；内存快照损坏即丢失，恢复读 live DB | 损坏信封无显式失败路径 | P8-3 |
| G4 outbox 回滚 | commit 与 markNarrativeCommitted 分离；无 outbox；提交后处理无 durable 边界 | outbox 表不存在 / 非同事务 | P8-4 |
| G5 CAS 覆盖 | `saveState` 为裸 UPSERT 无指纹 CAS；旧 worker 可覆盖新检查点 | 并发覆盖成功 | P8-4/P8-5 |
| G6 空观察 | 无观察协议；关键变化缺失可标 clean；accepted-only 摘要不存在 | 空观察推进覆盖 | P8-5 |

RED 状态即 P8-0 门禁证据（"当前缺口可复现"）；随各包修复逐项转绿，最终报告必须全绿。
