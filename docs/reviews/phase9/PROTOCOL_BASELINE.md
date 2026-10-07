# Phase 9 协议基线（P9-0 冻结）

| 项目 | 内容 |
|---|---|
| 冻结日期 | 历史施工2026-10-06；2026-10-07收尾复验 |
| 施工基线 | 历史 `main@5f49a7d`（922项）；本轮 `fab6f171fba075c69fbe0bb1ecec4058fd9e0cae` |
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
- 真实测试总预算初始400、最后1100；每次扩额在新派发前说明并写manifest；所有新驱动传输前持久原子扣额，冷启动不清零。历史起始313含估计，不能声称历史全部精确对账。

### 收尾恢复合同

当前完整freeze-2信封包含原始意图/约束、模型能力/keyRef、世界和实际角色资格、规则、分支已采用原文及计划身份。旧或损坏信封零HTTP，不读live替代。原始响应在解析前持久化；任务两次物理额度跨恢复有效；ready验证计划、工件和候选全量主体hash。

稳定边界检查stateVersion/basePlan/intent/内容绑定以及在途回合、交互和未知请求；事务内重复CAS并归档。管理修改、奖励/技能/关系、内容绑定与快照同一次提交。新方法可兑现当前分支旧局面承诺，未知后果和跨分支引用仍拒绝。资源耗尽时剔除零消耗操作，引擎amount>0硬门保留。

全流程复核：普通合同recordEvent按业务事件名在当次和历史求值；本地休息/训练/里程碑/生命周期与战斗复用同提交战役权威。训练先投影，SQL整卡与技能/上限奖励合并，关系保存最终值避免重复。关系沿用既有0..100，不另设-5..5。承诺资格是situationId+promiseId，须已有提交或显式创建；当前新局面完成条件须有局面/计数/承诺效果来源，组合保留合法替代路线。

期限与成功：定时局面到期会resolved，但pressure_deadline_passed不能作为主线completion的正向resolved证据。编译期要求独立成功证据；归约期再区分到期原因，覆盖已获得部分计数再到期的情形。独立counter-only成功路径、真实否定条件与已有终态保留；失败后primary清空仍本地排队，不因此固定增加每回合规划调用。

奖励边界：模型奖励子项必须在解析时验证kind、targetId、可选toActorId/rank/delta；关系奖励的targetId为起点人物，toActorId为终点人物，不能把relationship_shift效果的fromActorId当成缺失targetId的替代默认值。null集合项、非字符串/缺失必需ID安全拒绝；方法前置条件校验ID、等级、关系标度与成对字段，可选null保留无门槛语义；不得因TypeError误归类为可重试传输失败。skill_rank.rank仅接受SKILL_RANKS中的字符串untrained/novice/trained/expert/master，提示与修复反馈共用该白名单；数字及数组不强转。原响应仍先持久化，生成加修复最多两物理请求，重入解析不重发成功响应。

## 6. P9-0 最小回归（RED 起点）

`tests/phase9-baseline.test.cjs`（开工先行，随各包转绿）：

2026-10-07准备条件补全：campaign-plan-model-1可选requires.condition复用既有有界ConditionTemplateNode；编译后仍为既有MethodRequirements.condition，不改变归档、行动合同、快照或save版本。仅允许现态可读叶子，不接受committed_event作为方法前提。范围校验与UNKNOWN语义保持硬门禁；普通成功来源检查进一步尊重resolved/suppressed停止提供办法的生命周期，冻结当前有向关系/已知知识作为基线。新作者校验不会重解释已采用或已ready归档。

| 编号 | 缺口 | 证据目标 |
|---|---|---|
| P9G1 | 无战役意图/计划/运行时类型与校验 | 非法计划（断环、引用缺失、单路线）被拒 |
| P9G2 | 方法绑定依赖文本匹配，无稳定 ID 提交路径 | candidateRef/methodId 绑定生效 |
| P9G3 | 方法只有 onSuccess/onFailure，无四档结果模板 | 四档 outcomeTemplates 编译进合同 |
| P9G4 | 无 CampaignProgressReducer；进度无法从事件求值 | changed/no_change/提前完成确定性判定 |
| P9G5 | 无 campaign_plan requestKind；无规划任务恢复 | 任务状态机+恢复点测试 |
| P9G6 | 存档/DB 无战役字段 | save-10 往返含 runtime/plan/content |
### 新候选结局顺序门（final25）

新计划作者校验区分后续主目标未完成与已经失败：若结局用前阶段成功及后续成功事件/节点的否定自动结束，而没有实际失败/取消/损失门，会进入原有一次修复；仍错误则invalid。该必要门只位于candidateJob，不用于已采用归档或ready恢复，不增加AST模板、不改UNKNOWN/NOT和运行时进度求值。错误报告要求保留实际意图和失败路线，不能由编译器补造结局。
### 身份与proposal作者字段（final27）

计划的演员引用与办法目标共用actorReferenceInScope，只允许已有开局角色/模板及由已知模板生成的npc身份。关系门槛消费实际快照的有向角色身份；未知和歧义不会由名称猜测为合法角色。PROPOSAL_TEXT_LIMITS共供提示和解析，longTermGoal 4..120、publicPitch 10..400、gmPremise 4..400、tone 2..40；越界明确报告对应字段，不裁剪完整玩家意图、原响应或其它必需字段。既有已采用归档的协议和hash不变。

### 冻结现态的跨阶段证据（final28）

新候选普通成功必要门读取原任务冻结的situations：已经兑现的旧承诺/达到的计数/已定局状态可作基线；明确尚未满足且有本地producer的旧标记不能仅依赖大成功。未知基线不被改成否定事实，承诺身份始终为situationId+promiseId。当前关闭办法不能反复执行补足旧计数。终局顺序门同样检查裸前序成功触发和“没有失败”条件，保留实际损失、取消、可选后日谈及退休节点。两项均仅用于新作者验证，不更改运行时求值、已采用档、ready恢复、save版本或冻结四档合同。

### 开局持久分类的统一投影（final29）

首次准备、冷启动和显式恢复按同一持久job状态投影PreparationView：完整proposal为ready，outcome_unknown保留未知与可能计费说明，queued/running为preparing，invalid等错误仍failed并保留诊断。未ready不等于校验失败。桥接/UI返回形状变化不改变数据库状态机、冻结意图、归档、save版本或未知请求禁止重放合同。实际同一未知job冷/手动恢复没有重发规划；冷入口的独立目标建议按自己的逻辑请求计账，不混为恢复成本。
