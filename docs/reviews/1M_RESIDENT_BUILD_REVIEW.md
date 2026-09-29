# 1M Resident Build 施工报告（P0–P5）

- 分支：`feature/1m-resident-build`（自 `main@7e34058` 起）
- 方案：`docs/Shine-TRPG_1M_RESIDENT_BUILD_PLAN.md`（2026-09-29 定稿）
- 施工日期：2026-09-29
- 状态：P0–P5 全部实现并回归通过；真实端点端到端验收未执行（见"未取证项"）

## 一、改动总览（按提交）

| 提交 | 阶段 | 内容 |
|---|---|---|
| `feat(worldBuild): drive extract packing by output budgets with reasoning reserves` | P0+P1 | ModelBudget v2（maxContentOutputTokens/reasoningReserveTokens/reasoningEffort/supportsPromptCache）；输出预算驱动打包（clamp(content×0.7/est, 4, 32)，maxGroupSegments 64→32）；OutputPerChunkCalibrator（3 单元后一次、每 10 组滑动校准）；解除 8k 硬钳；GLM 不可关思考档 ≥8k 头寸；provider 按 DeepSeek/GLM 方言透传 reasoning 参数（仅显式声明时）；followUpUserMessages（resident 三段消息）；probe v2（同长提示双发测 cached_tokens、输出上限探测、reasoning_tokens 检测） |
| `feat(worldBuild): add resident mode with concurrent workers and atomic claims` | P2 | mode 'resident'（全书 ≤85% 窗口且支持前缀缓存才驻留，否则事务性退化为 windowed 并在 run 记录原因码）；N worker 并发（默认 3，1–4，TPM×0.7 保守封顶、缓存流量全计入）；claimUnit 改原子条件 UPDATE（SqliteDatabase.execute 返回受影响行数，RN 适配器透出 rowsAffected）；reasoning_only 先升预留重试一次再拆分（梯子 2k/4k/8k/16k/32k）；拆分按在线校准估值定份数；usageJson 落 output/cached/reasoning tokens；onUnitDone 接通 |
| `feat(world): seed a whole-book entity registry before resident extraction` | P3 | Pass 0 bookRegistry：全书前缀一次请求（≤8k、high effort）产实体清单，本地白名单/去重后走既有 upsertEntity 落种子；rule_mapping job 检查点幂等；摘要（key:type，≤80 条）注入每个 resident 范围指令；失败降级为无注册表继续 |
| `feat(world): persist evidence-verified rule mappings through the production commit path` | P4 | applyExtraction 解析 ruleMappings：target 必须是已知实体、每条 evidenceQuotes 必须逐字命中本组已验证引文（组级引文随行，跨块证据成立）；失败记 rule_mapping issue，不阻塞 facts/events；commitChunkResult 同一事务内 INSERT..ON CONFLICT 落 world_rule_mappings，mappingId 稳定派生（map-world-target-kind-token）保证幂等；conflict 事实 factId 后缀唯一化（修复跨指纹重放 UNIQUE 冲突）；WorldMapper V2：resident 单批全量 facts（解除 800 截断）+ 全实体/事件视野 + ruleMappings 提案（cleanRuleMapping 同证据纪律），windowed 批量路径不变 |
| `feat(worldBuild): add timeline pass, 1M model presets and docs`（本提交） | P5 | Pass 3 timelinePass：全书事件清单一次请求排序/依赖（模型仅提议，未知依赖丢弃，本地 resolveEventProposals 兜底，timeline job 检查点）；mobile 预设 DeepSeek V4.1 Flash / GLM-5.3-Flash（1,048,576 窗口、16,384 内容输出、GLM low+2048 预留+TPM 3M）；设置 UI 预设选择；文档 |

## 二、关键决策记录

- **D-1 原子认领改为单条条件 UPDATE**：原 claimUnit 是"读-判-写"，并发 worker 有双认领竞态；且 SqliteTransaction 端口不支持 changes 计数。选择让 `execute` 返回受影响行数（向后兼容：既有调用全部忽略返回值），认领变成 `UPDATE ... WHERE status IN (...)`，claim>0 即胜出。测试适配器与 RN 适配器同步透出该计数。
- **D-2 并发安全边界**：多 worker 下不同 store 的事务必须共享同一 adapter（事务队列串行）；生产端 `mobile/src/database.ts` 本就单例共享，测试端 closeout-c2/c3 改为共享 adapter。
- **D-3 mapping 证据校验采用"组内已验证引文集合"**：RuleMappingProposal.evidenceRefs 是纯文本引文（无 span）。校验语义 = 每条引文必须逐字等于本组某条已通过 checkEvidence（或 extractor 逐字定位）的事实引文。这是 checkEvidence"逐字+码点区间"在映射侧的同级实现，未放宽任何东西：错引/编造引文/空证据/未知 target 全部拒绝，且拒绝只影响该条映射。
- **D-4 mapping 只随组内首块提交**：mappingId 幂等使多次提交不增行；只随 fallbackChunk 提交减少重复写。跨块证据通过 additionalVerifiedQuotes（组级引文集合）成立。
- **D-5 registry/timeline 失败均为非致命降级**：它们是增强通道；抽取与本地解析门（resolveEventProposals）始终兜底。
- **D-6 mapper V2 不带全书正文**：方案 Pass 2 的"全书视野"落在 facts/entities/events 全量（解除 800 截断）——mapper 的清洗链与发布门输入即 facts 体系；正文驻留属抽取/注册表通道。
- **D-7 时间线在 resolveEventProposals 之前执行**：模型提议先落 canon（依赖过滤规则与本地一致），本地 resolver 只处理剩余 proposed 行，语义为"地板"而非被替代。

## 三、测试证据（可复现）

命令与结果（分支 `feature/1m-resident-build` HEAD）：

```
$ npm run verify:core
ℹ tests 266
ℹ pass 266
ℹ fail 0

$ npm --prefix mobile run typecheck
（无输出，退出码 0）
```

新增回归文件与验收映射：

| 文件 | 覆盖 |
|---|---|
| `tests/resident-build-p0.test.cjs` | T1 打包器（944×1200cp+1M 预算 → 68 组、每组 ≤14、≤32 上限、估算输出 ≤0.7×预算）；校准器节奏与滑窗；splitPartCount；profile 预算（GLM 18,432=16k+2k、距 131,072 ≥8k；小上限+不可关思考拒绝） |
| `tests/resident-build-p1.test.cjs` | T3 方言透传（DeepSeek thinking:disabled / GLM reasoning_effort+clear_thinking:false + max_tokens=18,432）；无声明不发参数（2026-09-27 政策不破）；resident 三段消息前缀字节稳定（provider 层）；probe v2 缓存双发/上限探测 |
| `tests/resident-build-p2.test.cjs` | T2（messages[0]/[1] 跨单元字节一致，仅 scope 不同）；T4（2 worker 每单元恰一次、每块 attempts=1、factId 无重复、unitsDone=unitsTotal）；T6（reasoning_only → 恰一次 12096=8000+4096 升档重试、无拆分）；T7（cached_tokens=0 → plan-group-1 + resident_degraded_no_prompt_cache 记录）；viability 85% 窗口；TPM 封顶 |
| `tests/resident-build-p3.test.cjs` | Pass 0 注册表（≤8k、high、实体种子、同 hash 免重付）；摘要限界；scope 注入；失败降级 |
| `tests/resident-build-p4.test.cjs` | T5（生产通路：恰 1 条证据完备映射落库，编造引文/未知 target/空证据 3 条全拒，facts 不受阻塞）；T4 重放（跨指纹全量重跑 world_rule_mappings 行数不增）；T8（checkEvidence 篡改 span 仍丢弃；映射无真证据不落库）；Mapper V2（801 facts 单请求、ruleMappings 证据纪律、cleanSkill/validate 不变）；windowed 仍分批；timeline（排序采纳、未知依赖丢弃、本地地板、幂等） |

既有语义保持：`tests/phase2-acceptance.test.cjs:397`（saveRuleMapping 直写开局映射）未改动且通过；全部 38 个既有测试文件通过。

## 四、验收对照（提示词第 1/2 条）

1. `npm run verify:core` 266/266 全绿；`npm --prefix mobile run typecheck` 通过；`tests/migrations.test.cjs` 通过（本次零 schema 变更，迁移双写未触碰——world_rule_mappings 表与两个 DDL 均已存在且一致）。
2. T1–T8 全部落地（见上表）；测试语料均为仓内 fixture（novel-small/medium ≤50KB）与合成数据，无第三方小说全文。

## 五、未取证项（如实声明）

- **端到端真实端点验收（提示词第 3 条）未执行**：无 DeepSeek V4.1 Flash / GLM-5.3-Flash 的可用端点与密钥。因此以下指标未测：百万字级语料请求数、截断拆分次数（目标 ≤2）、prime 后 cached_tokens 命中率（目标 >80%）、GLM reasoning_tokens 均值（目标 ≤1.5×预留）、端到端耗时（目标 ≤20 分钟@并发3）、费用对账。**以上以单元/集成测试（mock provider）验证了行为正确性，不能也不冒充端到端验收。**
- 模型规格（两家 1M/131,072 等）取自方案文档检索值，施工未复核官方文档（方案已声明施工前需复核）。
- probe v2 的输出上限探测在真实网关上的错误形态（如网关改写 max_tokens 而非 4xx）未实测。
- 缓存 TTL 续建"重付一次 prime"（D3 决策）只有代码路径，无真实 TTL 实测。
- 沙箱在施工中被平台重置一次；P0–P2 首轮实现丢失后按同设计重建，两轮均通过全部测试。远端 `trae/agent-58KSzL` 分支为外部占位（单文件 stub），与本施工无关、未被使用。

## 六、硬约束核对

- 确定性路径（骰点/RollRecord/叙事顺序）零触碰。
- cleanSkill 枚举闸门、cleanProvenance 过滤、checkEvidence 逐字比对、validate 发布门全部未放宽；新增映射路径沿用同级证据纪律（T8 钉住）。
- 无证据条目不得冒充 explicit；design_fill 语义未变（既有 phase2-package-build 测试继续通过）。
- canon_events 不被分支改写；本次仅在完成态新增 canon 写入（timeline/resolver 同规则）。
- 存档兼容路径未触碰；禁入键扫描未触碰。
- 迁移幂等双写未触碰（无 schema 变更；claimUnit/计数改动均在应用层与既有表内）。
- 密钥仅存 Keychain；本报告与日志不含端点密钥、小说正文或原始模型响应。
