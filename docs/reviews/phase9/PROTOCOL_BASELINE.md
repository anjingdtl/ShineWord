# Phase 9 协议基线（P9-0 冻结）

| 项目 | 内容 |
|---|---|
| 冻结日期 | 2026-10-06（Asia/Shanghai） |
| 施工基线 | `main@5f49a7d`（P8 收尾 922 测试全绿） |
| 方案依据 | `docs/Shine-TRPG_PHASE9_CONSTRUCTION_PLAN.md` §12.4 |
| 单协议政策 | 沿用第八阶段：运行时只注册本表"目标值"一列；旧输入明确拒绝；不维护双执行链 |

## 1. 协议登记表

| 协议 | 当前值（P8） | 本期冻结目标 | 实施位置 |
|---|---|---|---|
| Campaign Intent | （无） | **`campaign-intent-1`** | `src/domain/campaignPlan/types.ts` |
| Campaign Plan | （无） | **`campaign-plan-1`** | 同上 |
| Campaign Runtime | （无） | **`campaign-runtime-1`** | 同上 |
| Campaign Content Artifact | （无） | **`campaign-content-1`** | 同上 |
| Campaign Plan Job | （无） | **`campaign-plan-job-1`** | `src/application/campaignPlan/` |
| 规则核心 | `shineword-core@0.3.0` | **`shineword-core@0.4.0`** | `src/domain/rules/ruleset.ts:20`（新增阶段/后果规则语义） |
| ActionContract | `'2.0'` | **`'3.0'`** | `src/domain/turns/contracts.ts` + `v2Compile.ts`（稳定方法绑定 candidateRef 与结果模板身份 outcomeSetHash） |
| Planner Proposal | `'2.0'` | **保持 `'2.0'`** | 受限字段集已足够 |
| World package | `shineword-world-package-5` | **保持 `5`** | 见 ADR-1 |
| Turn material | `turn-material-1` | **`turn-material-2`** | 新 kind：`campaign_direction`/`campaign_progress`/`campaign_opportunities`；新 authorityDomain `campaign_plan` |
| 存档 | `shineword-save-9` | **`shineword-save-10`** | `src/application/export/saveFile.ts`（携带 intent/plan/runtime/content/consequences；save-9 拒绝清单登记） |
| SQLite 开发基线 | `100`（phase8_current_baseline） | **`101`（phase9_campaign_baseline）** | `src/infra/sqlite/builtinMigrations.ts`；旧 100 库明确拒绝 |
| Story Memory | schema 3 | **保持 3** | 字段语义不变；增加消费边界（runtime 为进度唯一权威） |
| requestKind | 13 种 | **新增 `campaign_plan`**（14 种） | types.ts / requestDemands.ts / reasoningPolicy.ts / scheduledProvider.ts 四处注册 + 恢复白名单 |
| 产品版本 | V0.9.1 | **候选 V1.0.0 / 1000000**（验收后登记） | 按 VERSIONING.md：存档+DB+合同主版本破坏性变更 → MAJOR |

## 2. ADR

### ADR-1 世界包 schema 保持 `shineword-world-package-5`

方案 §12.4 建议 `shineword-world-package-6`（共享局面 schema 更新）。核实结论：四档结果模板 `outcomeTemplates` 只属于**战役内容工件**（`campaign-content-1`），由战役内容编译器校验与消费；世界包条目的 situation 方法继续使用 P7 的 `onSuccess/onFailure` 两档（探索/参考局面），域类型上新增的 `outcomeTemplates` 为可选字段、世界包发布器从不写入。旧包无需重发布、不产生 schema 拒绝面。若后续世界层也要四档方法，再升 6。证据：`src/domain/situations/types.ts:55-75`（方法合同）、`src/domain/content/types.ts:54`（包 schema 常量）、P8 全部 922 测试在字段可选化后不动。

### ADR-2 ActionContract 升 3.0 的增量面

`protocolVersion` 常量与两处字面量集中修改；新增可选字段：

- `candidateRef?: string` — 玩家点选/自由输入映射到的稳定候选引用（`method:{situationId}:{methodId}` 或 `action:{actionId}`），随合同冻结进 hash。
- `methodRef.outcomeSetHash?: string` — 绑定方法的结果模板集合 hash（投骰前冻结，四档结果身份）。

不合法引用/过期候选在编译期拒绝（A13）。旧 2.0 合同只存在于 save-9 与 baseline-100 库，两者已整体拒绝，无混读路径。

### ADR-3 `campaign_plan` 请求治理参数

- 输出需求（requestDemands）：min 2048 / target 6144 / max 12288 tokens（计划+首阶段局面一体产出）。
- 推理预留（reasoningPolicy）：与 `world_mapping` 同档（规划型任务）。
- 调度角色：`P2`（后台构建类，不抢占 P0 交互）。
- 物理上限：首次 + 一次修复 = 默认 2 次 HTTP（方案 §6.2），计入任务级账本；结果未知沿用显式重试入口。
- 恢复白名单：`campaign_plan` 不进入 play 恢复（playRecovery）与记忆恢复；使用 job 自身的恢复点（§4）。

### ADR-4 SQLite 基线 101

`BUILTIN_MIGRATIONS` 由 version 100 改为 version 101（单条基线 DDL 政策不变）：100 的全部 DDL + 新表 `campaign_setups`、`campaign_plan_jobs`、`campaign_plan_candidates`、`campaign_plan_revisions`、`campaign_content_artifacts`。旧 100 开发库保持既有拒绝语义（`schema_migrations` 最大版本 < 101 即提示开发重置）；不迁移旧计划数据（不存在）。

## 3. 状态机（冻结）

- **主线节点**：`planned → available → active → succeeded | failed | superseded | cancelled`；`active ↔ suspended`。无关节点不因主线变动自动失败。终局路径可达性在计划校验期判定（结构与内容闭包，不承诺骰点）。
- **战役**：`preparing → active`；`active → paused | completed | failed | ended`。结局来自条件成立或用户明确结束。
- **规划任务**：`queued → running → candidate_ready → adopted`；异常路径 `retryable_failed | outcome_unknown | invalid | stale | cancelled`。每次迁移持久化；恢复点覆盖冻结未发送/已发送未知/响应未验证/验证未 ready/ready 未采用/采用前后/outbox 未处理。

## 4. 所有权登记（P8 表追加）

| 数据域 | 唯一写入者 | 其他模块权限 |
|---|---|---|
| 战役意图与偏好 | `campaign_setups`（setup 持有，intentRevision 单调） | 只读；用户操作可改 |
| 未来计划定义 | `campaign_plan_revisions`（不可变，planId+revision） | 只读 |
| 规划任务/候选 | `campaign_plan_jobs` / `campaign_plan_candidates`（job 协调器） | 后台只写候选；采用走 CAS |
| 战役内容工件 | `campaign_content_artifacts`（内容编译器） | 统一解析器只读合成 |
| 主线实际进度 | `CampaignRuntimeV1`（随 GameStateSnapshot 由 commit 事务唯一写入，CampaignProgressReducer 求值） | Story Memory/UI 只读派生 |
| 延迟后果 | runtime.deferredConsequences（同上） | 规发即产生事件，一次性 |

## 5. 预算与请求政策（本期）

- 规划一次生成 + 最多一次结构修复 = 共享 2 次物理 HTTP 上限（含 fallback/formatter/reasoning recovery，派发前统一扣额）。
- 普通回合**不**新增 campaign_plan 请求（A37）；主线推进由本地 CampaignProgressReducer 求值。
- 原文依赖建设走既有 segmentBuild 任务预算与账本，独立归属。
- 真实测试总预算：400 次物理请求（`.tmp/phase9/test-manifest.json`），所有驱动共用，冷启动不清零。

## 6. P9-0 最小回归（RED 起点）

`tests/phase9-baseline.test.cjs`（开工先行，随各包转绿）：

| 编号 | 缺口 | 证据目标 |
|---|---|---|
| P9G1 | 无战役意图/计划/运行时类型与校验 | 非法计划（断环、引用缺失、单路线）被拒 |
| P9G2 | 方法绑定依赖文本匹配，无稳定 ID 提交路径 | candidateRef/methodId 绑定生效 |
| P9G3 | 方法只有 onSuccess/onFailure，无四档结果模板 | 四档 outcomeTemplates 编译进合同 |
| P9G4 | 无 CampaignProgressReducer；进度无法从事件求值 | changed/no_change/提前完成确定性判定 |
| P9G5 | 无 campaign_plan requestKind；无规划任务恢复 | 任务状态机+恢复点测试 |
| P9G6 | 存档/DB 无战役字段 | save-10 往返含 runtime/plan/content |
