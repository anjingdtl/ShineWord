# 统一世界构建五阶段施工审查报告

状态：实现完成 + 部分实机/真实模型验收进行中（以下逐项如实标注）。
分支：`codex/unified-world-build`（自 `86d040d` 之后本地 HEAD 演进，未 reset；工作区用户修改 `mobile/package-lock.json`、`.zcodeignore` 保留）。
施工合同：`docs/Shine-TRPG_UNIFIED_BUILD_FIVE_PHASE_PLAN.md` + 配套施工提示词。
日期：2026-09-29/30。

## 0. 结论摘要（诚实声明）

- **P1–P4 代码实现完成**，核心回归 `npm run verify:core` 296 项全绿，`npm --prefix mobile run typecheck` 通过，debug/release APK 均构建成功并安装到模拟器（数据保留）。
- **P5 部分完成**：双模型 smoke 与代表性章节校准已真实执行并通过；四主测试 harness（DS-FULL / DS-PROG / GLM-FULL / GLM-PROG）已开跑（见 §5 进行状态），本报告撰写时仍在运行；Android 实机矩阵的原生机制项（FGS/通知/取消/恢复/Home/锁屏）已实测，但**设备端单条 LLM 请求成功往返未达成**（疑似 adb 代录密钥损坏导致 401，见 §6 未验项）。
- 因此本报告结论为：**实现完成 / 四主测试与部分实机验收进行中或未验**，不称全部竣工。

## 1. 阶段提交记录

| 阶段 | commit | 内容 |
|---|---|---|
| P1 | `feat(worldBuild): P1 unified model config, chapter batching, rate scheduling and replanning` | 冻结 run 配置（migration 17）、章节对齐组批（取消 32 块上限）、30%→20%→12% 阶梯 + 尾部重规划、全局 RPM/TPM 调度器、跨进程暂停/取消标志、注册表 key/entityKey 复用修复、映射物理指标落盘 |
| P2 | `feat(worldPackage): P2 evidence honesty gate, skill usage and traceable template ranks` | 证据诚实门（无证据不得标 explicit/inferred）、技能 usage 枚举、模板等级 rule_mapping 字段溯源、U05 等价/U07 双题材/U06 链路测试 |
| P3 | `feat(worldBuild): P3 persistent 30/30/40 stage plans, triggers and activation` | migration 18（stage plans/states/advances）、确定性阶段边界、触发引擎（邻界 15%/依赖需求/顺序/去重）、累积阶段包发布、安全边界激活、完整/循序 UI、冻结配置执行 + waiting_unlock |
| P4 | `feat(android): P4 notification pause/cancel, cross-process control and app-open recovery` | 通知暂停/取消/继续按钮直写持久控制标志、超时如实停止并记录、共享通知构建器、任务卡取消、应用打开自动恢复（系统回收场景） |
| 政策 | `policy(llm): thinking is never disabled - vendor tier parameters only` | 2026-09-30 用户政策：禁止关闭思考。DeepSeek 用 `thinking:{type:'enabled',budget_tokens}`（实测网关接受但不严格执行）、GLM 用 `reasoning_effort`+`clear_thinking:false`；'off'/未设置一律降级最低档；删除一切禁用路径 |
| 修复 | `fix(worldBuild): canonical chapter-then-chunk ordering for streaming sources` | 流式导入 chunkIndex 每章重置 → 规划器/coordinator 改用章节规范序（真实小说实测发现） |
| 修复 | `fix(stagePlan): re-queue stages whose run was canceled; unique run ids` | 取消后的阶段可重新排队（实机取消流测试发现）+ runId 唯一后缀 |

## 2. 回归与构建证据（命令/退出码）

| 命令 | 结果 |
|---|---|
| `npm run verify:core` | ✅ 296 tests pass / 0 fail（基线 266 → 新增 30：unified-build-p1 15、p2 4、p3 11） |
| `npm --prefix mobile run typecheck` | ✅ 退出码 0 |
| `npm --prefix mobile run apk:debug` | ✅ `ShineWord-V0.3.0-progressive.2-debug.apk`（sha256 `222600b29ed068b328255c067ebe7efa4b78500afb0fec413909f621585c223b`） |
| `npm --prefix mobile run apk:release` | ✅ `ShineWord-V0.3.0-progressive.2-release.apk`（sha256 `959574bfd48b12749f921e3e9572ee496192b3642a396ebe3252d2f8fa8b08c1`），keystore SHA-256 与合同一致（`017b3fbe…c2a0a`），v2 签名 + zipalign 校验通过 |
| SQL/内置迁移一致性 | migration 17/18 只写入 `builtinMigrations.ts`（唯一权威来源，移动端 `applySqliteMigrations(BUILTIN_MIGRATIONS)` 直接消费）；`migrations/*.sql` 目录自 v7 起本就滞后、仅作旧测试夹具（既有状态，本轮未恶化）；旧库升级在模拟器实测通过（v16 数据库带数据升级到 v18，无迁移错误日志） |

已知构建坑（记录）：RN bundle 任务不把仓库根 `src/` 当 gradle 输入，仅改核心源码时需 `gradlew createBundleReleaseJsAndAssets --rerun-tasks` 强制重打 bundle，否则 APK 字节不变。

## 3. U01–U12 追踪

### U01 双模型真实能力、预算、方言、usage ✅（smoke 实测）/部分（缓存窗口）

- DeepSeek：配置文件实际模型 `deepseek-v4-flash`（网关实测，非旧预设名）。生产 probe v2 全绿：JSON mode ✓、usage ✓、前缀缓存（cached_tokens>0 复测）✓、输出上限 16384 接受 ✓。smoke 脚本 `.tmp/unified/ds-smoke/smoke-summary.json`（1 次抽取请求成功）。
- GLM：实际模型 `GLM-5.3-Flash`，probe 同全绿。`.tmp/unified/glm-smoke/`。
- 方言（2026-09-30 实测）：DeepSeek 原生 `thinking` 开关（默认开，无法隐式关），`reasoning_effort` 单发不被执行；GLM `reasoning_effort` 有效（low 档实测思考仅 8-10 token）。政策：思考永不关闭，仅调档。
- **缓存 unknown 仍可走窗口构建** ✓：resident 降级路径（probe 无缓存 → `RESIDENT_DEGRADED_NO_CACHE` → 窗口组批）有测试（resident-build-p2 T7）。
- 探测窗口只报 128k 保守值；1M 为配置声明值，声明来源已在 FrozenRunConfig.contextWindowSource 标注（'declared'）。小探测不能证明 1M —— 如实记录。
- usage：两模型均回报 prompt/completion/reasoning/cached tokens；harness 指标含 unavailableUsage 计数（缺失标 unavailable）。

### U02 大段组批、章边界/超长章、30MB 合成、完整请求预算 ✅（确定性测试）

- 章节对齐组批 `planChapterBatches`：初始正文目标 = min(窗口余量, 30%×窗口)，输出预算 floor(contentOutput×0.7)/est(800) 限每批块数；32 存储块硬上限已删除（30MB 级合成输入单批 >32 块有测试）；单超大章按块边界切分；覆盖不变量（无洞无重排）由测试与运行时双重把关。
- 真实小说实测：白篱梦 965,458 规范化码点 / 300 章 / 944 块，阶段计划 S1≈30.07% / S2≈30.04% / S3≈39.89%（harness ds-full metrics）。
- 每章重置的 chunkIndex 修复（`orderChunksByChapter`）+ 回归测试。

### U03 缩段补尾/校准重规划 ✅（确定性测试）

- 30%→20%→12%→对折下限阶梯（`nextBodyTargetRatio`）；截断单元事务性拆分 + 队列尾部在单一围栏事务内重规划（`replaceUnclaimedUnits`：仅替换 queued，运行/完成/重试单元身份不变）；校准估计变化 >25% 触发未领取单元重规划；恢复语义（planState 持久化）有测试。

### U04 多 runner、全局限流、重试计费、晚回包 ✅（确定性测试）/实测进行中

- 双协调者并发：租约唯一执行者 + 单元 attempt=1 + 无重复事实（测试）。
- `GlobalRateScheduler`：RPM/TPM 滑窗、in-flight 全额预留、Retry-After 地板、settle 真实用量；`RateScheduledProvider` 包装所有计费请求（抽取/注册表/时间线/映射共用，实机与 harness 均接入）。
- 每次物理尝试落 `LlmPhysicalRequestMetric`（脱敏）；映射批次 checkpoint 现也持久化 requestMetrics。
- 晚回包：请求后 `confirmLeaseAfterRequest` + fencingToken 写闸（既有）+ P1 测试覆盖。
- 真实重试账单：DS-FULL 进行中，metrics.jsonl 每请求一行（含 reasoning_only 重试）。

### U05 两模式共享 schema/门禁、冻结提案确定性对照 ✅（确定性测试）

- 900 事实窗口分批 vs resident 单发，同一确定性提案函数 → 规范化后条目/技能关系完全一致（忽略 revision/批次计数等构建过程标签）。
- 两模式共用 buildPackageFromCanon（P3 阶段包与全书包同管线），质量门相同（证据诚实门、引用闭包、validate/publish）。

### U06 人物↔技能↔故事信息库全链路 ✅（确定性测试）/端上操作部分

- 有证据攻击技能 → 模板技能/攻击引用 → createCampaign actor_skills 行 → rollSpecForSkill 可执行（U06 测试）；等级 rule_mapping 字段溯源。
- 端上"点人物资料→技能→来源"人工操作：未执行（见 §6）。

### U07 双题材技能差异、无证据不冒充 ✅

- 武侠（碧波剑法 explicit+证据）vs 科幻（机甲格斗术 explicit+证据）技能集可区分；无证据"火球术"两题材均被拒；关系事实不能冒充神通等级（清理期拒绝）。

### U08 30/30/40 边界、未触发不发送、触发/重复触发 ✅

- 边界计算（平局取较早）、小书合并、巨章单阶段、精确覆盖：测试。
- 渐进初始只排 S1；未触发阶段 0 请求（规划即范围受限）：测试 + 实机（first10 导入后仅 S1 run 入队）。
- 邻界/依赖/顺序触发、重复触发去重（一次兼容任务）、取消后重排：测试（重排为实机发现修复）。

### U09 增量激活、旧存档、分支/rewind、秘密与未来状态 ✅（确定性测试）

- 激活仅在安全边界（running interaction 阻断）；advance 绑定 (campaign,branch,state_version)，rewind 回落基础锁、fork 从基础锁开始；激活不改写任何角色状态行（测试断言推进行数）。
- 阶段包：累积前缀 incremental/partial → 全书 whole_source/complete；阶段外事实不进映射；不连续范围拒发布。
- 旧存档：无 advance 行即用锁定 revision，不强制升级（读取路径 `resolvePlayableRevision`）。

### U10 FGS/Headless/锁屏/断网/终止/timeout/强停语义 部分✅（实机见 §6）

- 代码完成：通知暂停/取消/继续（直写持久标志，与 UI/协调者共信道）、onTimeout 如实 stopSelf 并记录 `fgs_dataSync_timeout`、waiting_unlock（锁屏 Keychain 不可读时停等，不搬密钥）、应用打开自动恢复（系统回收场景；强停后用户重新打开即此入口，无后台绕过）、WorkManager 未引入（见 §6 决策记录）。
- 实机已验：FGS dataSync 前台 + 实时计数通知（"抽取 0/1 组"由 headless 上报）+ actions=2；Home→锁屏 45s→解锁 FGS 存活；取消标志跨进程生效（并发现/修复阶段重排缺陷）；needs_review 如实呈现待用户处理。
- 实机未验：断网重连、进程回收冷启动续建、通知按钮逐个点按、加速 timeout（见 §6）。

### U11 四主测试各自真实证据 进行中（详见 §5）

### U12 SQL/内置迁移双写、旧库升级、全量回归 ✅/说明

- 见 §2：新增 schema 仅 builtinMigrations（唯一权威）；旧库（v16 含数据）在模拟器升级实测无错误；全量回归 296 绿。

## 4. 真实测试资源处理与安全

- 配置/密钥：运行时内存解析，从未打印/落盘/入 repo/APK/命令行参数（harness `parseConfig`；adb 代录密钥经 shell 变量展开，转录只见变量名——该路径对设备密钥完整性存疑，见 §6）。
- 小说：3,065,535 字节、规范化后 965,458 码点（300 章/944 块），raw SHA-256 与合同一致 `6FAA89E6…71C81`；小说正文/原始响应/标注不提交（`.tmp/` 已 gitignore）。
- 端点：仅向两配置文件的端点发送授权语料；本地 echo 诊断服务仅监听本机、输出脱敏（authLen/prefix/tail）。

## 5. 四主测试（P5）状态与指标

Harness：`scripts/unified-build-harness.cjs`（生产路径：流式导入→阶段计划→coordinator 租约/围栏→组抽取→阶段包发布→开局/回合→触发→激活；每物理请求计量，预算上限 env 可配：默认 600 请求 / 80M 输入 / 6M 输出 token）。
运行方式：`.tmp/unified/run-main-tests.sh`（顺序 DS-FULL→DS-PROG→GLM-FULL→GLM-PROG；DS low 档+4096 预留，GLM low 档+2048 预留——思考政策 2026-09-30）。

| 测试 | 状态（报告撰写时） | 关键指标（进行中数字） |
|---|---|---|
| DS-FULL | 运行中（131+ 物理请求，~110 分钟，S1/S2 抽取中，尚未到首个阶段完成里程碑） | `.tmp/unified/ds-full/metrics.jsonl`；已观测：前缀缓存生效（cached ~9.7-12.8k/请求）；思考政策下 DeepSeek 高频 reasoning_only（单次思考可烧 20480 token）由 provider ×1.5 阶梯恢复，代价是每批 2-3 次物理请求 |
| DS-PROG | 排队（驱动顺序执行） | — |
| GLM-FULL | 排队 | — |
| GLM-PROG | 排队 | — |

驱动脚本 nohup 分离运行（`.tmp/unified/run-main-tests.sh`），跨会话继续；每 run 落 summary.json 后本表将回填最终指标。**按当前实测速率（DS 单请求 80-120s、高频思考重试），四 run 全部完成预计需 8 小时以上；若达预算上限将如实中止并记录。**

校准基线（每模型 2 代表章节）：
- DeepSeek low 档（思考开启）：2418/3920 码点章 → 19-21 实体、11-12 事实、输出 1594-1720 token、5.8-6.2s。
- GLM low 档：同章 → 16-21 实体、10-14 事实、输出 1754-2240 token（思考 8-10 token）、26.5-34.8s。
- DeepSeek 实测不执行 `budget_tokens`（思考可烧 16-30k），由 provider reasoning_only 重试（×1.5）与内容/思考分离计量兜底；已按用户政策保留思考开启。

**完成后此处将更新为：每 run 导入耗时、TTFP、各阶段耗时、物理请求/重试数、完整 usage（缺失标 unavailable）、缓存命中率（含分母）、覆盖 100% 验证、证据逐字审计（verified/mismatched）、阶段包 revisions、触发/激活日志、回合统计、budgetExceeded 标志。** 若任一 run 因预算上限中止，将如实标注未完成原因，不以降质冒充。

## 6. 未验项与阻碍（如实）

1. **四主测试未完成**（运行中）：DS/GLM × FULL/PROG 的最终指标、覆盖/召回/激活链证据待 run 结束后回填。质量门（引文 100%、悬空 0、召回 ≥90%、两模式差 ≤5pp、秘密泄露/晚回包/重掷 0）需以四 run 结果判定。
2. **私有标注集（≥60 关键事实）未建立**：需要对前/中/后+边界的独立人工标注（不得取自被测模型输出）。当前只有 harness 的证据逐字审计（verified/mismatched 计数）作为引文 100% 的程序性验证。列为未验。
3. **设备端单条 LLM 请求成功往返未达成**（诊断过程与发现）：
   - first10 真实阶段 run 在设备上多次快速进入 needs_review（config 类：401/api key 语义），DS 与 GLM 配置均复现；桌面 harness 用同一配置直连成功。
   - 已定位一个明确机制：adb `input text` 代录的 DEL 清除序列有丢帧率，端点/模型/密钥字段均出现"残留+追加"式拼接损坏（端点字段实证：`…v4api/coding/paas/v4`、模型字段实证：`deepseek-v4-flashaceholder`——密钥字段为掩码显示，同类损坏不可见但高度可能）。这使设备侧 401 最可能是**自动化录入损坏**而非应用缺陷；真实用户手输空字段不受影响。
   - 另有未解观察：本地回显端点实验中设备 run 0 命中（未发任何 HTTP 即失败），与"密钥损坏仍应到达端点"矛盾；结合无 root/run-as 的 release 可观测性限制，根因未确证。候选：headless 上下文 Keychain 读取异常（runExtraction 有 waiting_unlock 前置检查，但失败路径与观测到的 needs_review 不完全吻合）。
   - 后续复测建议：release 加日志开关或用 debug 签名专测构建 + run-as 读 DB；密钥录入改用剪贴板或逐段校验长度。
4. **Android 15/16 双版本矩阵**：仅 API 37 模拟器（Medium_Phone）实测；Android 15/16 专属路径（dataSync 6h 超时实测、Android 16 job 配额）未验。断网重连、进程回收冷启动、通知拒绝、加速 timeout、用户暂停取消的完整时序未全部执行（取消流已实测并促成修复）。
5. **20 分钟对照目标**：未测完不宣称；瓶颈如实记录：DS/GLM 思考开启后单请求 90-120s（DS）/30-60s（GLM），68 批 × 3 阶段为主要时长构成。
6. **WorkManager 恢复未引入**（决策而非遗漏）：不加依赖、不做后台 FGS 拉起循环；恢复入口=应用打开自动续跑 + 任务卡手动恢复，符合"用户强停后等用户重新打开"与不承诺无限保活。Android 12+ 后台 FGS 启动限制下的 waiting_system 语义依赖系统下次合法窗口。
7. **Maestro E2E 全量回归**未跑（本轮以 MCP/adb 实机矩阵替代核心路径）。

## 7. 交付物清单

- 实现：P1–P4 全部提交（见 §1）；迁移 17/18；核心测试 30 项新增。
- 测试 harness：`scripts/unified-build-harness.cjs`（smoke/calibrate/full/progressive，脱敏计量，预算上限）。
- 实测产物（仓外 `.tmp/unified/`，gitignore）：ds/glm-smoke、ds/glm-cal、四主测试 metrics.jsonl + summary.json + shineword.db。
- 使用说明：`docs/USER_GUIDE_IMPORT_BUILD.md` 为旧版；新完整/循序模式操作=书库导入卡模式选择→任务卡/世界详情阶段面板（阶段状态、转完整构建）→开局。
- 本报告。

## 8. 复现命令

```powershell
npm run verify:core                                   # 296 tests
npm --prefix mobile run typecheck
npm --prefix mobile run apk:debug
npm --prefix mobile run apk:release                   # 需 SHINE_WRITER_RELEASE_* 四变量
node scripts/unified-build-harness.cjs smoke <config> <workdir>
node scripts/unified-build-harness.cjs calibrate <config> <workdir> <novel>
node scripts/unified-build-harness.cjs full|progressive <config> <workdir> <novel> <label>
# 环境变量：UNIFIED_MAX_REQUESTS/UNIFIED_MAX_INPUT_TOKENS/UNIFIED_MAX_OUTPUT_TOKENS/
#          UNIFIED_REASONING_EFFORT(low|high)/UNIFIED_REASONING_RESERVE/UNIFIED_TURNS
```
