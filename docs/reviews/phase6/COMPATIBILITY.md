# 合同、模块所有权与兼容说明

## 最终装配

共享合同 `phase6-contracts-1` 由 M0 集成（`src/domain/build/phase6.ts`、`src/domain/style/types.ts`、`src/application/ports/phase6/index.ts`），运行时范围、hash、成员、intent、artifact、style 与存档验证拒绝任意 JSON/未知版本。项目沿用 worldId。所有实际生产服务装配在 `mobile/src/database.ts`、`runtime.ts`、`sourceImport.ts`、`segmentRuntime.ts` 与 `CampaignSession`，新项目默认使用小段；旧任务按冻结协议恢复。

| 模块 | 写入所有者及实现 | 跨域协作 |
|---|---|---|
| M0 | builtinMigrations、database/runtime、协议/归档集成 | ports，统一迁移与事务 |
| M1 | SqliteSourceStore、SqliteWorldStore 的既有来源/成员/镜像接口 | SourceCatalogAdapter 输出 sourceId/源 hash/源内码点半开区间 |
| M2 | SqliteSourceIndexStore / PersistentSourceSearchService | 只写派生 postings/覆盖，动态别名与权限快照独立 |
| M3 | SqliteSegmentPlanStore / SegmentBuildService | executor、catalog、publication 端口；不写 canon/ledger/lease |
| M4 | 既有 SqliteWorldStore / SqliteBuildRunStore、coordinator / checkpoints | scoped canon selection 与变化映射，不建第二事实库 |
| M5 | SqliteSegmentArtifactStore / SegmentPublicationService | 只读 canon/source，事务写不可变成果和分支 binding |
| M6 | 既有 SqliteLlmLedgerStore / GlobalRateScheduler | 持久额度桶为账本配套，无第二请求账本，所有物理调用统一 admission |
| M7 | 既有 Android build host / foreground service | 使用 M4 原 lease/fence，运行条件与恢复投影，不建第二租约 |
| M8 | SqliteWriterStyleStore / ProjectStyleService | P3 governed analyzer、独立语义与用户覆盖、冻结本地编译快照 |
| M9 | 项目/风格/等待 UI、CampaignSession 的既有提交器 | UI 不直接写以上域；背景采用不改角色/骰点/历史 |

`SourceChunk` 是存储块；`AnalysisBatch` 是受预算限制的请求单元；`Segment` 是逻辑范围与需求集合；`PublishArtifact` 是验证后不可变成果。执行适配允许逻辑段拆成多个旧 run/batch，数据身份和请求幂等键不能混用。M4 增量映射只处理新范围与已认证旧依赖闭包，历史 lore 的未变 fact 不重新映射。

## schema 28 → 31

- 29：新增索引页/覆盖、段计划/需求/配置、不可变成果/分支绑定、额度保留、风格/profile/snapshot 表。只增表/列，使用既有项目、分支、来源主键与删除约束。
- 30：有界开局 survey 检查点，仅用于冻结旧策略恢复；新 `opening-90s-3` 不先付费 survey 再付费抽取。
- 31：扩展 interaction journal 的 `play_turn` 类型，迁移复制旧操作，保留 operation steps/FK 和一分支一 running 约束。迁移器在事务内控制 FK，迁移失败回滚，不丢旧运行。
- 索引是派生缓存，冷启动/迁移不全书重建；缺覆盖与损坏明确为 partial。旧来源 ID 保持不变，第二/三部保留 `sN-` 镜像与源内坐标。

schema 28 来源 `UNIQUE(source_id)` 不改为跨世界共享。追加只对新增成员建立范围，旧 hash 未变的成果、索引与抽取继续兼容。删除经 owner/fence 清理，迟到响应不能创建 world 行。

## 协议适配与恢复

旧 `stage-plan-1`、runConfig 指纹、账本和 lease 保留；新 `segment-plan-1` 经 existing executor 进入同一 coordinator。切 API 明确创建新冻结配置及 intent/run，保留旧配置；在途及 unknown 先拒绝替换。`outcome_unknown` 不自动重发，审批精确到未知 attempt，不能审批一个后永久允许重发。

旧 `shineword-progressive-delta-1` 的单来源、64 ranges / 12000 码点 / 500 entries 门禁保持原值。无来源身份的旧范围须唯一解析，不猜部数。新多来源 `shineword-segment-artifact-1` 显式含 source binding/hash/码点/引用；同样受范围与条目上限。旧主动查书 delta 在同一事务重基分支 overlay，不撤销已经采用的成果。

世界 ready 不意味着任何分支已知。采用核对 stateVersion、manifest、fence、staged turn/running interaction；回退/分叉加载历史 snapshot 原 binding。原著新内容 discoverable；玩家确认精确证据后仅开放时间有效、全证据/依赖已知的内容，下一前台玩家动作本地提交载入 NPC。后台永不修改已冻结行动、骰点、人物状态或历史正文。

存档新版本 7 保存当前/历史完整 style snapshot 与内容 binding，读取 clean 6/5/4/3；世界归档版本 4 保存 canon/成果/来源映射和项目风格，旧版继续验证。双跳往返与失败原子回滚有数据库测试。无原文的导入归档仍可读取已导出内容，继续原文构建明确要求对应 TXT。索引、低优先未完成需求和调度缓存不冒充已导出原文；凭据递归禁键保持。

原著表达基线随项目style绑定新增可选闭合sourceBaseline（styleId/profileVersion/semantic），归档hash覆盖它；旧style-1绑定无此字段仍可读取。保留最近选定的原著基线使preset/custom往返及归档后回到source不重新付费、不覆盖用户字段，不移植或伪造source analysis任务。view.sourceSemantic只是本地表达预览，不持久化为事实或新增知识。


追加恢复合同使用既有schema31：RunPlanState新增可选且运行时校验的mappingRequestIds，旧plan缺字段仍读取；M4在活租约/fence内写入，replan合并保留。M6是build/play精确审批的唯一写入所有者；快照核对run/world/fence/来源/模型/控制及无在途请求，保留未知状态和费用诊断，审批不会恢复用户停止。旧registry/timeline按准确run/world及64位内容hash识别；旧world-shared映射按已知job-map hash协议仅适配未完成旧最终化任务，已完成开局与新登记run仍严格隔离。租约CAS与映射原子prepare使用原表/端口，无schema或存档版本变化。

Scoped canon冲突复用既有canon_conflict审查类型：M4从同一可用范围返回blockingConflictFactIds，M4所有者在活fence内核对当前conflict行并事务保存review。已解决的旧ID不能重新打开阻断；普通批量豁免不能清除canon冲突。逐事实unverified保留原文/审计并转speculation，映射排除它，20事实与引用闭包门禁不变。M9只调用端口，不直接改事实。

开局目标建议经runtime现有RateScheduledProvider.withLedger复用唯一M6账本，并通过现有预算内核/推理策略/P1队列。生产逻辑ID按已发布世界/锚点/输入语义稳定，不因切API、模型或预算绕过outcome_unknown；配置指纹保留在metadata和有界成功缓存中。旧可选建议调用API继续兼容；没有迁移、新账本或存档字段。历史QA8旧未治理调用如实记录，不补造历史账本。


原生映射来源标记修复：只校正本次新草稿的 provenance，不改已发布不可变条目或原fact status。所有raw done checkpoint、hash、模型配置、usage和请求账本保持原样；不改变mapper系统提示或版本，兼容结果可以通过新cleaning在本地重投影。unitsFailed仍为历史次数，当前抽取完成以完整unit集合及各自completed状态证明。schema31/save7和API契约版本不变。


最终原生save7兼容实测：同一已验证世界依赖存在时，3artifact/v4/5历史snapshot/4turns经正常SAF导出/导入创建独立campaign；全部snapshot仅重绑定branch身份，manifest/artifact hash、2正文/2冻结行动风格保持。原branch、历史、两raw mapping及旧artifact整行未改，冷DB integrity ok/FK0，0新请求。此证据不代替新设备缺依赖归档或旧真实用户库迁移验收。新完成判定过滤已取消审计父行并保留历史失败次数，无schema/save版本变化。
