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


## 2026-10-08 final33：长规划的传输、租约和物理预算

R37：opening/replan共用candidateJob，以owner+fence CAS续租覆盖排队、请求及修复；取消/接管/续租失败后不发布，已收到业务原文仍可持久化。R38：共用provider按冻结kind/tier给high规划900秒、max1200秒等待上限（不是吞吐预测）；支持streaming的高强度规划接收SSE，完整结束标记与finish_reason齐备才返回业务正文，思考绝不回填正文，断流保持未知且不重发；流式能力纳入profile身份，旧buffered指纹兼容。R39：GLM预设声明流式支持，高级设置、预算预览和store共用显式能力上限；设备正式UI保存后仍为1M/32768，content16384、high、Keychain引用未变。R40：生成、调度和ledger共用最多2物理请求，单次dispatch的maxPhysicalRequests=1；仅已知reasoning_only允许一次内核1.5倍预留重规划，仍保留档位/材料/模型声明上限。思考恢复与结构修复共享额度，未知不重试；重启消费原冻结根和剩余额度，异常时physicalRequests按durable ledger实派次数报告。

流式协议与GLM能力依据[官方SSE文档](https://docs.z.ai/guides/capabilities/streaming)和[GLM模型文档](https://docs.z.ai/guides/vlm/glm-5.3-flash)。流式有助于避免长时间无响应数据，是本次传输修复的设计推断；实际证据仅证明长响应能完整到达，未证明内容达标。32K模型声明继续冻结，不因文档最大能力自动增加。

生产scope v3源码1d0e6778c600e7c788c0d5fbcd4ba8c0cc09eb4c2a2e9b930a2fd7318c9ec3a7；Debug APK 3f51242ac7a6f89580d378c85b829444c2d74afe0d524773726d42cc7f1eb31b，109474379 bytes，V1.0.0 / 1000000，emulator-5556实际安装hash一致。完整核心1065/1065、0失败0跳过（reaccept-core-final33b.log，34.325s），移动typecheck、41s Debug构建、版本与diff通过。新增23项回归，所有前置RED日志保留。

完整目标继续执行，阶段整体仍未通过；A01–A40维持29 PASS / 2 FAIL / 9 NOT RUN。新身份未完成J1/J2/J3各20及同基点双分支各10，没有把请求、管理、采用或旧身份诊断计入80；两项隔两次决定的持续后果、三计划及对应旅程六维全部≥3仍待实测。

## 2026-10-08 final34–final35：整个规划任务的生命周期与已知截断恢复

final34 是诊断身份：源码 c5ef62dd88afa74082a41b9c1be26459462386ca0cccd4465bf3d437a3826b2d，APK a8ff88de83c6754091b4f5194fd0508cc127d9480474fd696a2c72a674b96c84。1071/1071 核心、移动类型及构建通过。Android J1 两次 HTTP（369.968/187.095 秒）得到 ready 提案，前后台传输成功，但结束后服务/唤醒锁未释放；没有采用或玩家决定。主机 J2 两次后 reasoning_only→length，J3 一次 length，均无候选。J1 初稿还引用了未定义的知识 ID，结构修复后才 ready。原记录不追溯改为最终通过。

R41：开局与重规划共用 acquireExecution 端口，Android 使用不包含 job/文本/密钥的 opaque token；一个有界生命周期覆盖排队、全部两次请求、校验及最终事务。单 HTTP 保护仍覆盖完整 body，不能在修复间隙失去保护。SQL lease/fence 和 ledger 是唯一执行权威；原生服务与 headless task 不执行、不恢复、不重发业务任务。iOS/主机保持既有执行路径。

R42：补齐当前 RN TurboModule 桥中的 HeadlessJsTaskSupport 完成契约。JS Promise 结束后，框架完成相应任务；规划服务只清理自己的 task IDs 和独立唤醒锁，不释放世界构建的共享锁。0 HTTP 的不存在 runId 复现中，原先滞留的 WorldBuild 服务现在自动退出，ACQ/REL 间约 33ms，候选/采用/账本及预算不变。真实长规划也已自动释放。

R43：finish_reason=length 的非空正文明确记录 invalid_response/length，而非 http_client；部分 JSON 不成为候选。已知 reasoning_only 或 length 最多使用剩余的一次请求，依据持久 reasoning usage 下界与原策略重新经过预算内核和调度预留，恢复目标使用允许的业务输出余量；不称单条观测为 p95。模型声明上限、完整意图和冻结根不变，未知不重发，结构修复共享两 HTTP 上限。没有第三次请求。

final35 生产 scope v3 源码 aa1093a26d32b654d52aa64c483721c18d4a6d11dccb1208bcba9c1069ef138f；Debug APK 6c73d2d3cee1f1100cce281446a19406280bbd85c938f085700600d1c15e398f，109480639 bytes，V1.0.0/1000000，emulator-5556 实际安装 hash 一致。完整核心 1078/1078、0失败0跳过（32.687 秒），移动 typecheck、43秒构建、版本检查及 diff 通过。首轮全量仅两项移动夹具缺少新端口 mock，修夹具后全量通过；RED/首轮失败日志保留。新增 13 项核心回归。

同一 final35 身份的 high/stream 三意图真实诊断均完成，每个至多两 HTTP：

| 样本 | 实际 wire/用量和耗时 | 最终状态 |
|---|---|---|
| Android J1 救援 | 24576：思考24536，481.428秒；32768：思考29814，601.332秒 | retryable_failed，第二次正文 length，无候选 |
| 主机 J2 调查 | 24576：思考24523，493.369秒；32768：思考18628/输出24993，447.024秒 | invalid，完整正文引用未定义线索，安全 rejected |
| 主机 J3 合作 | 24576：思考24503，482.739秒；32768：思考25784，555.514秒 | retryable_failed，第二次正文 length，无候选 |

Android 自23:59:03 UTC观察到 HOME，至00:16:35 UTC代理收完第二次 body，连续后台至少17分32秒，跨两次请求/恢复/校验；lease持续续租，fence仍1。00:17:47 UTC进程29718仍存活，两服务均退出、唤醒锁为空、crash buffer无异常；返回前台保留真实失败。上游均HTTP200，不将200等同候选成功。主机配置端点/Keychain引用与Android不同，不作为匹配性能比较。success账本http_status仍null，200以代理/主机HTTP日志确认，这项元数据缺口保留。

共享预算1174→1181/1500，余319；三规划共6次，独立opening_goal 1次另记，无重置/增额。旧2个未知job、冻结根、attempt逐值不变；全部已采用plan/artifact/snapshot的hash未变。final34未采用ready提案通过正式“重新生成”失效（setup/job cancelled），保留候选原文；没有修改已采用归档。final35新增0玩家决定，不能把诊断凑入最终80。

尚未完成：32K声明下两项真实高强度正文仍截断；方案§7允许设计战役线索，但当前 artifact/resolver 只提供局面，未知知识ID被拒后没有合法的战役线索作者通道，需补齐独立命名空间、不可变定义、分支合成及获得/知识投影。另发现世界增量闭包遗漏已有条目、地点名称误当entryId、旧知识门被删除；隔离副本27项模块回归通过，生产尚未应用。神罚之石的无类型 block_effect 仍需合法机制定义，不能自动豁免审查。完整长旅程、两项隔至少两次决定的后果、三意图六维≥3、A02/A03/A06/A12及匹配性能仍未齐，独立试玩未验。A01–A40维持29 PASS/2 FAIL/9 NOT RUN；第九阶段整体未通过。

证据：.tmp/phase9/reaccept-identity-final34/35.json、reaccept-core-final34b/final35b.log、final35-budget-red/green-b.log、reaccept-device/final34-native-closeout-defect.json、final35-native-closeout-proof.json、final35-completed-in-background.json、final35-preservation-proof.json、final35-planning-failed-after-home.png，final35-host-J2/J3、final35-status.jsonl；原文/数据库均在忽略目录。当前 high 配置与QA代理18691保留供后续验收，尚未最终清理。已按用户授权本地提交R37–R40（a7d263b）；本批R41–R43提交ID见Git历史，未推送/发布。

## 2026-10-08 final36–final37：依赖闭包、战役线索与数据库绑定

R45 是 campaign-content-1 与冻结上下文的可选扩展：clues/campaignEntryIds 缺省不写入，旧序列化/hash保持。线索定义不是知识；ID按计划修订生成且严格绑定本分支不可变归档。R46 只持久化数据库身份，不存密钥或内容；SQLite任务行及fence仍是执行权威。

身份、回归、实际复现与运行中请求详情见 [FINAL_REPORT](FINAL_REPORT.md)。完整阶段仍未验收通过。

final37 真实规划终态补录：J2/J3自动候选ready并采用，分别8/3条合法战役线索；Android J1第二次38036仍length。全部至多两HTTP，预算1188/1500，原未知任务和设备已采用归档保持。0新玩家决定，内容质量与完整长旅程仍未通过。移动世界书及已知面板的线索回看缺口待下一批修复。终态、用量、后台清理和保护证据见 [FINAL_REPORT](FINAL_REPORT.md)。
