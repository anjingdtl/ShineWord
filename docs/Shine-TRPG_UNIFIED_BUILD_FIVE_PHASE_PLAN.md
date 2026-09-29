# ShineWord 统一世界构建：五阶段建设方案

状态：待施工；本文是建设与验收合同，不是完成报告。日期：2026-09-29。

配套施工提示词：`Shine-TRPG_UNIFIED_BUILD_AGENT_PROMPT.md`。

## 1. 决策与本地基线

本地仓库：`F:\ClaudeWorkSpace\projects\ShineWord`，勘查 HEAD：`86d040d43bbb0f3fd505d45e742d54270e67b0e3`。参考仓库：`F:\ClaudeWorkSpace\projects\TAVO-MINI`，勘查 HEAD：`cf278b315eb54595f7118de912aff6b6739de3f9`。实施前重新记录 HEAD、分支、工作区差异；不能硬重置到本文 SHA。勘查时已有 `mobile/package-lock.json` 修改和 `.zcodeignore` 未跟踪文件，必须保留。

用户已确定：

1. 产品只有两个构建模式：**完整构建**、**循序构建**。
2. 完整构建覆盖全文后开局；循序构建依次覆盖前 30%、中间 30%、最后 40%，后两段由剧情需求触发。
3. 构建请求使用按模型预算合并章节的大批次，参考 TAVO-MINI；不再让约 1,200 字符的存储块决定请求粒度。
4. 后台构建必须具备 Android 前台服务、持久任务与恢复机制。
5. 两个模式必须产出同等要素、同等校验标准的三宝书；角色信息、角色技能及其故事信息库关联必须完整贯通。
6. DeepSeek、GLM 分别真实测试，不允许用其中一个的成功替代另一个，也不允许以 mock 代替真端点。

本文替代旧 `Shine-TRPG_1M_RESIDENT_BUILD_PLAN.md` 中“resident 为核心、16K 固定默认主导组大小、百万字必驻留”的建设方向，也替代旧渐进计划中“8K 开局资料 + 极小局部补书作为最终能力”的范围定义。旧文档保留历史；确定性规则、证据、不可变包、回合冻结、秘密过滤和存档兼容仍有效。旧施工提示词提到的 `Shine-TRPG_SKILL_GENRE_BINDING_AGENT_PROMPT.md` 在当前本地库不存在，不能把它当已完成依赖；角色/技能闭环直接纳入本方案 P2。

**范围澄清：**30/30/40 是原书阶段比例；30% 模型窗口是每个 LLM 分析批次的初始目标。两者独立。首段 30% 完整完成同一质量门后才发布新循序开局，不默默改成先读几千字开局。既有旧存档可以继续使用旧包，不强制重建。

## 2. 已核实的实现与差距

| 模块/路径 | 已有能力 | 本轮要处理的差距 |
|---|---|---|
| `src/application/worldBuild/groupPlanner.ts` | 输出预算组批、输出校准类 | 默认约 14 块/组、最多 32 块；需要章节/token 驱动组批与真实输出反馈 |
| `src/application/worldBuild/coordinator.ts` | worker、租约、resident、重试 | 百万字保守估算无法进入 85% 窗口；校准只影响拆分；注册表前尚未启动续租；并发上限不等于分钟限流 |
| `src/infra/sqlite/sqliteBuildRunStore.ts` | run/unit 持久化 | claim 条件含 running；仅靠单进程集合不足以证明多 runner 排他，需租约/fence/claim 联合核验 |
| `src/application/llm/{types,capabilities,openAICompatible}.ts` | 探测函数、方言与 usage | 探测未接移动端；预设直接声明缓存；所有 pass 与重试预算未统一 |
| `src/application/world/bookRegistry.ts` | 注册表与检查点 | 保存 key、复用读取 entityKey 不一致；模型指纹等缓存身份需完善 |
| `src/application/worldPackage/buildPackageFromCanon.ts` | facts→skills/templates/mappings→清洗发布 | resident Mapper 无 high 档及独立思维链预留；无界全 facts 单请求需重新预算；原著技能到角色仍需端到端验收 |
| `src/application/worldPackage/progressiveOpening.ts` | 8,000 码点 OpeningDossier、范围包 | 场景资料不是同质量阶段世界；不能继续作为新模式的降配生成器 |
| `src/application/progressiveBuild/progressiveBuildQueue.ts` | 前台优先、去重 | 内存任务/缓存，3×1,200 码点局部队列不能承担持久大段构建 |
| `src/application/worldPackage/{progressiveDelta,contentManifest,branchContentStore}.ts` | 增量包与冻结绑定 | 复用不可变机制，增加阶段构建完成与分支激活的分离 |
| `mobile/src/{sourceImport,buildRunner,buildServiceBridge}.ts` | UI/Headless 入口 | Headless 读取当前全局 profile，需改为 run 冻结配置；等待状态和原生停止信号需闭环 |
| `mobile/android/app/src/main/java/com/shineword/app/WorldBuildForegroundService.kt` | dataSync FGS、Headless、onTimeout stopSelf | 停服务不等于取消 JS/提交；恢复与真实进度需联测；Headless 配置 true 表示允许前台执行，不代表免 Doze |
| `src/domain/content/types.ts`、`campaign/createCampaign.ts`、`campaign/playProjection.ts` | 三书、模板、actor_skills、玩家投影 | 同一个角色技能要在事实、条目、模板、实例和 UI 之间可追踪 |

本地 Android：RN 0.85.3；Gradle 声明 minSdk 24、compile/target 36。施工要验证依赖实际支持范围，不凭声明认定最低版本可运行。现有施工报告称核心 266 项通过，但本次方案编写没有重新运行，不能继承为新代码通过证据。

### TAVO-MINI 参考边界

- `src/services/continuation/canon/canonBudgetPolicy.ts`：正常正文目标 C×0.30，失败 C×0.20/C×0.12，输出按配置与 provider 能力适配。
- `adaptiveBatchPlanner.ts`：合并连续章节，只有超大章节才切；`canonSourceSlicePlanner.ts`：总预算、精确范围、未覆盖尾部。
- `canonAnalysisService.ts`：人物状态/世界剧情两路并行、失败补尾、持久工作项。
- `analysisScopePlanner.ts`：快速续写默认末尾 10 章，不能把该耗时当全书性能基准。
- 只借鉴架构与经过核实的逻辑，不复制原项目的 DB 身份、全局状态、隐私数据和整套业务。ShineWord 使用码点偏移；TAVO 部分证据使用 UTF-16，移植必须显式转换。

## 3. 统一目标架构

```text
TXT 本地流式导入 → 规范化源/章节/原文索引
                    ↓
              不可变 StagePlan（S1/S2/S3）
                    ↓
     持久任务队列 → 章节/token 组批 → 受控并行分项抽取
                    ↓
      引文与覆盖校验 → 实体归并 → 规则/技能映射 → 时间线
                    ↓
      统一三书编译/引用闭包/质量门 → 不可变阶段包
                    ↓
   故事信息库 GM 视图 → 分支安全边界激活 → 玩家可见投影
```

完整模式按同一个 StagePlan 执行全部范围，允许独立抽取并行，合并发布按依赖顺序进行；所有范围通过后开局。循序模式只先执行 S1，S2/S3 未触发不请求其正文。导入全文、本地建立章节/检索索引不等于把全文发给 LLM。

resident 仅为可选请求优化：范围装得下、能力与缓存证据成立时可用；失败可回到窗口批次。循序构建的 resident 前缀只能包含已授权阶段范围，禁止通过“优化”提前发送未触发的全文。

### 阶段边界与触发合同

- 使用规范化源码点 N 计算理想切点 0.30N、0.60N；按相邻章节末尾选择最近合法边界，平局选较早边界。保留实际比例、chapterId、码点范围、源哈希；覆盖无洞无重复。章节太少则合并空阶段，超大单章可按段落切；算法必须确定且有测试。
- S1=[0,b1)，S2=[b1,b2)，S3=[b2,N)。来源边界是叙事位置，不是游戏世界时间；倒叙、插叙不得用事件时间直接推算原文字节位置。
- 前台正常推进：已确认场景/事件的来源锚点进入当前阶段末 15% 范围时，可持久化下一阶段预构建意图。15% 是可配置初始值，不是事实常量；以 measured build time/需求等待校准。
- 当前行动所需实体/地点/事件依赖落在下一阶段时立即触发；无来源锚点时用已校验实体关联检索定位，不由模型自由输出“进度百分比”。
- 跨到 S3：依次补足 S2/S3 的依赖闭包，先保证当前所需资料的高优先级任务，但不能把尚未完整通过的整个阶段标成完成。
- 玩家长期停留时不按时间或回合数自动扫完全文；多个触发去重。构建与前台叙事共用端点限流池，前台请求优先。
- 阶段已构建不等于玩家已揭露：未来技能、人物秘密、死亡/阵营变化均按锚点与权限过滤。需求等待时显示“资料准备中”，不允许叙事幻造缺失规则。

### 同等质量的准确含义

同范围、同锚点、同规则版本使用同一抽取 schema、映射器、校验门和角色配置通路。循序模式可以缺少未构建范围，但已发布范围不能缺少完整模式要求的要素。将来揭示的事实不要求提前知道；暂不可确定的字段标 unknown/pending，不能用 design_fill 冒充原著事实。不同 LLM 的措辞和条目数量无需逐字相同，但必需事实、机械语义与引用闭包必须达到同一验收门。

## 4. 五阶段施工

每阶段执行：实现 → 有针对性的测试 → 自审 → 修复 → 回归 → 阶段报告。依赖顺序 P1→P2→P3→P4→P5；P1 的实体/范围接口为后续基础。不得到 P5 才发现两种模式走不同生成链。

### P1：统一模型能力、章节组批与可恢复调度基础

**目标：**大批阅读与请求预算真实生效，双模型配置独立、任务身份稳定。

实施：

1. 新建共享的 scoped build request/StagePlan 模型，至少携带 sourceHash、范围、模型配置指纹、prompt/schema/ruleset/mapper 版本、分项路线和内容可见锚点。冻结 run 使用的 endpoint/model/非密钥参数及独立 keyRef，不冻结密钥明文。配置切换不得改变进行中 run；更换端点/模型需显式新 run 或受审计迁移。
2. 打包器以 C×0.30 为初始正文目标，上限受实际完整请求（提示词、元数据、注册表、来源正文、输出/思维链、安全余量）限制。取消默认 32 存储块对 LLM 批次的硬限制；存储块只负责 I/O/定位。真正需要细分的只有超预算单章和失败任务。
3. 输出上限按实际端点配置与协议适配，内容/思维链分开计划并记录，不把总上限当内容额度；不强制将所有模型压到 16K，也不盲目要求最大输出。先用代表性章节试采样，再按实测密度限制批次；输出大不代表必定更快。
4. 相同正文可分“人物/关系/状态/技能线索”和“世界规则/事件/时间线”两路任务；规则映射使用证据产机械定义。全局 HTTP 并发初始 2、可配置 1–4，分项并行也计入同一额度，禁止 batch×route×worker 隐式乘倍。
5. 建立按供应商口径的 RPM/TPM 滑动窗口或令牌桶；计入 in-flight 预留、重试、probe、映射和前台游戏请求，usage 后结算，遵守 Retry-After/429；缓存未证实折扣时按全输入计入。
6. 接入 probe、配置校验及结果持久化；缓存 unknown/unsupported 不阻止窗口构建。能力探测小请求不能证明 1M 容量，需要声明来源与逐级边界验证。真实模型 ID/方言以配置文件、官方说明和请求结果为准，不照搬旧预设名称。
7. 对 length/reasoning_only/JSON 截断缩小当前输入（30%→20%→12% 后继续按明确下限拆分）；补齐尾部覆盖，避免只保留缩小后的前半段。provider 与 coordinator 共享物理重试总预算，每次计费请求都落指标，禁止两层无界重试。
8. 在线校准影响后续未 claim 单元的重规划，原单元事务性 supersede，并保持覆盖与幂等；不得重排已完成/正在执行的任务。校准记录可恢复，包含内容密度及思维链统计。
9. 修复注册表 key/entityKey、所有 pass 的预算/思考参数、无界 Mapper、租约从最早长耗时操作前续期、claim 排他/fencing 与旧失败指标覆盖问题。暂停/取消/超时后的晚回包不得发布。

主要文件：现有 `worldBuild/*`、`llm/*`、`world/{bookRegistry,llmGroupExtractor,timelinePass}.ts`、`sqliteBuildRunStore.ts`、`mobile/src/profileStore.ts`、profile UI。新模块名由实现确定，不复制第二套 coordinator。

验收：合成 1M/30MB 输入按预算大批组装且覆盖 100%；正常与超长章节、双路线、重试尾部、重规划、多 runner 同时 claim、缓存关闭都覆盖。真实两端点分别通过连通性/JSON/usage/预算/方言小样，输出独立脱敏结果。不能只断言 mock 接收了参数。

### P2：统一三宝书与角色—技能—故事信息库完整通路

**目标：**范围大小只影响覆盖，不能导致循环模式降质。

两个模式统一调用：抽取事实→证据校验→实体注册/归并→规则/技能映射→角色模板→三书编译→validate/publish。OpeningDossier 可用作开局场景选择辅助，不能代替上述过程；旧 8K/3.6K 队列不得截短阶段输入。

| 要素 | 权威记录/产物 | 必需关联和检查 |
|---|---|---|
| 人物身份、别名、阵营、关系、状态与经历 | entity/fact + actor_template/lore + 时间/可见性 | 稳定实体 ID；字段 provenance；不把未来状态覆盖开局状态 |
| 技能与能力 | skill/ability、world_rule_mappings | 证据 sourceFactIds；六属性、powerTier、usage、条件/消耗合法；名称来自事实，禁止题材词典硬编码 |
| 角色拥有的技能 | 模板技能/能力引用→ActorCard→actor_skills | 指向已发布定义；等级按证据或明确 rule_mapping；角色不能自动拥有世界所有技能 |
| 世界与剧情 | constraint/lore/scene/quest + 事件依赖 | 来源范围、顺序、秘密、冲突记录；未知依赖不默默变成已知 |
| 物品、资源与对手 | item/actor_template 等 | 引用闭包、合法规则操作、角色装备/资源关联；无证据可明确不适用 |
| 三书展示与游玩 | player_handbook/gm_guide/monster_manual + playProjection | 同一 entryId 视图，GM/玩家权限一致；人物技能在书中、角色卡和可执行动作之间贯通 |

故事信息库是现有 canon、世界包条目、角色模板和版本化投影的统一权威视图，不新建一套与三书脱节的“角色描述文本”。如确需新增关系表或字段，给迁移、回填和旧包兼容路径。

无原文数值时可用本地规则映射，但字段必须标 rule_mapping/design_fill，不能标 explicit。缺关键角色技能引用时阻止该可玩范围发布；不把所有 unknown 一律判失败，也不为满足字段数捏造超自然技能。用户自创角色与原著角色的配置路径分别测试。

统一质量门：

- 引用定位成功率 100%、已发布必需引用悬空数 0、非法机械枚举 0、秘密泄露 0。
- 当前可玩范围内必需人物均有可解析模板与合法技能关联；人工证据集明确存在的技能不能被默认八技能替代。
- 对标注的必需事实召回率 ≥90%；同模型同范围两模式召回差不超过 5 个百分点且各自达标，关键开局依赖不得缺失。
- 实体别名误合并/重复、默认补全占比与冲突数均报告，不只比较条目数量。
- 两种不同题材小样，各至少有一条有原文证据的题材技能，技能集合可区分；没有魔法证据的题材不得强造魔法。

验收：冻结同一批模型提案分别通过两个模式，规范化后权威条目/技能关系一致（忽略 runId/时间/阶段标签）；真实模型另做语义质量比较。端上点击人物资料→技能→来源、角色创建/加入场景→角色卡→合法技能行动，确认不是仅 DB 有一行。

### P3：完整/循序两模式与 30/30/40 持久阶段推进

**目标：**一个构建内核、两种调度政策，剧情触发后自动续建且不会偷偷全书扫描。

实施：

1. 导入选择“完整构建/循序构建”；显示全书规模、各阶段实际章节范围、预估批数和未知成本，禁止预估冒充已完成。新循序模式 S1 全部通过 P2 质量门后开局。
2. 持久 StagePlan、阶段依赖、触发原因、sourceRanges、输入/配置指纹、预算、claim/fence、checkpoint、发布包/hash。状态至少区分未触发、排队、构建、验证、已构建、待激活、已激活、等待网络/解锁/系统机会、暂停、失败。可复用已有表；新增 schema 必须 SQL/内置迁移双写一致。
3. 将第 3 节触发规则接入回合准备与来源检索。多回合重复触发只产生一个兼容阶段任务；正文覆盖与证据召回是不同指标，分别记录。
4. 构建产物是世界级不可变包；激活是分支/锚点级操作。前台在回合合同冻结之后完成的新包，只能在下一安全边界接纳。切战役/分支/rewind 后旧激活意图失效，已验证源构建结果可在兼容身份下复用。
5. 增量完成不能改变已经生效的骰点、技能等级、生命资源、玩家关系或战役历史。需补充已有角色资料时使用显式 reconciliation，按来源时间和玩家状态归属处理，机械冲突进入审查，不静默覆盖。
6. 随时从循序切到完整只入队未覆盖范围；已完成兼容范围不重付。模型/规则版本变化不得跨指纹假复用。旧存档固定原 manifest，可继续运行，升级不重写旧包。
7. 三书与 UI 区分“该范围未构建”“已构建但未发现”“原文无此信息”“构建失败”，不以空数组统一替代。S3 完成且覆盖闭包完整后才能标全书完成。

主要文件：`mobile/src/sourceImport.ts`、Library/WorldDetail UI、`progressiveBuild/*`、`worldPackage/{progressiveOpening,progressiveDelta,contentManifest,branchContentStore}.ts`、campaign session/playProjection、存档和相关 ports/SQLite。

验收：S1 发布后无 S2/S3 正文请求；边界/远距离依赖触发、重复触发、未锚定事件、章节很少、巨大单章、倒叙均有用例。前 10 个实际游戏回合记录等待与补建；模拟推进至 S2/S3，验证人物/技能/规则增量真的可用。切完整、暂停恢复、分支/回退、保存导入和晚回包不破坏冻结合同。

### P4：Android 后台运行、系统限制与冷恢复

**目标：**两种模式全部阶段共用原生持久执行入口；Home/锁屏可持续工作，系统终止后可恢复，绝不承诺永久不死。

实施：

1. 复用 `WorldBuildForegroundService` + `WorldBuildRunner` + 数据库 coordinator。用户在前台启动构建或剧情触发时，于合法窗口及时启动 dataSync FGS；不能解析几分钟后再启动。后台启动被拒时持久 waiting_system，等待合法机会，不循环强拉。
2. 阶段之间无需等待剧情时正常停止服务；不靠空通知长期占用。用户触发后只运行已排队范围，未触发 S2/S3 不保活空跑。
3. 仅传 runId/taskId，冷启动从 DB 找冻结配置和 keyRef。Keychain 不可访问必须 waiting_unlock/config，不得把密钥搬进 AsyncStorage、日志或任务参数。锁屏是否可读按设备实测；如选择调整安全存储策略必须单独记录理由与验证，不默认降低保护。
4. 通知展示当前阶段、真实任务/覆盖进度、等待/失败；实现暂停/继续/取消入口。stopService、通知取消、系统 timeout、JS AbortSignal、fence 失效、租约释放必须贯通，晚回包不得激活内容。
5. 原生 onTimeout 及时结束前台服务，业务 checkpoint 平时逐单元持久化，不能指望超时回调再等长 JS 操作。进程崩溃、任务划除、系统回收与用户强停分别对待；用户 force-stop 后不自动绕过，用户再次打开才能恢复。
6. 按需引入 WorkManager 做唯一恢复任务/联网约束/退避；每次执行短恢复片，调用同一 coordinator，不创建第二套网络循环。不把小时级流程塞入无限 long-running Worker，也不依赖 JS timer 保活。
7. 核实 Headless 生命周期与 RN 原生唤醒锁所有权；只有必要时申请有超时的 PARTIAL_WAKE_LOCK，并覆盖所有释放路径，不重复持有、不申请无限锁、不默认要求电池白名单。
8. Android 13+ 通知权限拒绝需真实解释与兼容；Android 12+ 后台 FGS 启动限制、Android 15 dataSync 超时、Android 16 job 配额各有故障路径。全局构建并发在多个 world/run 与前后台之间共享。

官方依据（2026-09-29 查阅）：

- [FGS 超时](https://developer.android.com/develop/background-work/services/fgs/timeout)：Android 15 对适用 dataSync 后台运行有 24 小时内累计 6 小时限制，需处理 onTimeout，不能靠重启规避。
- [Long-running workers](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running)：Android 16 长运行 worker 可耗尽 job 配额，不能将 WorkManager 当无限保活。
- [FGS 版本行为变化](https://developer.android.com/develop/background-work/services/fgs/changes)：施工按 target/device 实际版本复核启动与恢复限制。

验收矩阵：每个模型至少一条真实阶段任务完成前台→Home→锁屏→回前台，并验证 DB 单元继续推进或准确记录等待解锁；再完成可控断网重连、进程回收、冷启动、通知拒绝、暂停/取消/晚回包、加速 timeout。至少覆盖 Android 15/16；最低支持版本依据实际依赖验证。正常后台连续观察至少 15 分钟或阶段完成（取先发生者）；若任务太短，延时/故障注入验证长生命周期并标明注入。禁止清空用户私人数据，隔离测试设备/数据集；不可用设备记未验，不伪造通过。

### P5：双 LLM × 双模式实测、质量对照与交付

**目标：**用本地指定资源验证 P1–P4 的真实 App 链路，给可复现证据。

本地私有输入：

| 用途 | 路径 |
|---|---|
| DeepSeek 配置 | `C:\Users\Administrator\Desktop\AIstudio\Test-key\deepseek-test.txt` |
| GLM 配置 | `C:\Users\Administrator\Desktop\AIstudio\Test-key\GLM-TEST.txt` |
| 真实语料 | `C:\Users\Administrator\Desktop\AIstudio\《白篱梦》作者：希行.txt` |

2026-09-29 已检查三文件存在；未输出/复制密钥，未发真实模型请求。小说原文件 3,065,535 字节，严格 UTF-8 解码通过，解码后 1,068,536 UTF-16 单元（不是归一化码点数）；SHA-256：`6FAA89E68BBA97A96E1DACC0CC969DE2B3217DC9C59167E9BFDB2B9E27971C81`。施工重新测量编码、归一化码点/章节及 hash，以 App 导入结果确定实际阶段边界。本文件不是 30MB；30MB 容量用本地可生成合成语料另测，不能混写为本小说结果。

配置文件读取要求：运行时在内存解析 endpoint/model/key；不执行文件中的脚本，不整文件打印，不将 key 放命令行参数。若仅给了 key/endpoint，先按实际网关文档确定 model，不能凭文件名臆造型号。共享报告只保存脱敏端点标识、模型 ID、能力来源、参数、keyRef 和指纹；移除 URL 凭据/query 中的秘密。手机通过已有安全入口写入 Keychain。真实请求只向该文件配置的授权端点发送测试所需语料。

必须分别完成四条冷启动测试（应用抽取缓存与 DB 隔离；供应商自动缓存不能保证冷，单独记录）：

| 测试 ID | 模型 | 模式 | 必须结束于 |
|---|---|---|---|
| DS-FULL | DeepSeek 文件实际模型 | 完整 | 全书覆盖、三书通过、开局可操作 |
| DS-PROG | 同一 DeepSeek 配置 | 循序 | S1 开局→剧情触发 S2→剧情触发 S3→最终全书完成 |
| GLM-FULL | GLM 文件实际模型 | 完整 | 全书覆盖、三书通过、开局可操作 |
| GLM-PROG | 同一 GLM 配置 | 循序 | S1 开局→剧情触发 S2→剧情触发 S3→最终全书完成 |

测试顺序：读取配置并核实能力→小样 smoke→代表性章节/路线校准→本小说四条主测试→每模型恢复/后台实验→质量对照。先做小样防止配置错误导致整本重复计费；每 run 有总物理请求/重试/费用或 token 预算，具体额度在实测前写入本地 manifest。额度不足诚实暂停，不无界重跑；不将可用额度改成质量降级理由。混用模型仅可作为额外实验，不计四条必过结果。

每条主测试记录：

- git SHA/工作区补丁身份、APK SHA、设备/API/target、源 hash、配置指纹、阶段实际边界、批次输入/输出预算、并发与限流设置。
- 导入耗时、TTFP（选定模式确认导入开始→首个可操作回合）、S1/S2/S3 构建耗时、全量构建活动耗时、剧情等待/人为停顿单独列出；前十回合资料等待累计值。
- 每路线初始/重试/补尾/探测/映射物理请求数；实际 prompt/completion/reasoning/cached tokens；未返回字段标 unavailable，不能当 0。
- 缓存命中 token 比率给明确分母；计费按实际网关价格与日期核对，无法获得则只报 token，不编费用。
- 截断、JSON 失败、引用拒绝、实体冲突、规则冲突、覆盖缺口、未解释的空结果；修复前后对照，不能靠删除失败记录美化。
- 已发布事实/技能/模板数量与字段完整度；角色→技能→证据→动作链检查；前后台 checkpoint/fence、重复提交数、恢复重复请求数。

质量取证：在本小说前/中/后及两个阶段边界建立私有标注集，至少 60 条关键事实（各阶段≥20），覆盖人物/关系/技能/规则/事件。关键开局角色逐个核查，有证据技能全部纳入；未知字段不强造答案。标注不得只从被测模型结果反向生成；基于原文人工或可复核独立标注。仓库报告仅存聚合指标、哈希、位置/ID，正文和私有标注留仓外。公开自动化测试使用原创小样，不提交小说。

通过门：P2 质量门全部通过；四主测试逐项达标；阶段覆盖 100%、同指纹幂等重复落库 0、秘密泄露/晚回包污染/重掷 0；核心与 mobile/native 回归通过；后台异常能恢复或明确等待。性能必须与相同设备/配置/语料基线比较，不能只引用 TAVO 快速续写或旧 mock 毫秒结果。旧“百万字≤20分钟”保留为对照目标，未达必须说明瓶颈，不能宣称该目标已达；新分项质量要求不能为赶时限删掉。改善百分比报告实测值，不预先编造。

必要命令（实施阶段执行，非本文已执行）：

```powershell
npm run verify:core
npm --prefix mobile run typecheck
npm --prefix mobile run apk:debug
# 原生测试按新增模块运行项目 Gradle wrapper；存在 Release 签名条件时：
npm --prefix mobile run apk:release
```

Release 不可用时 debug 验证仍继续，但不能以 debug 结果宣称正式包通过。APK 安装保留原数据，测试使用独立世界/战役；服务超时缩短、网络设置等实验结束恢复现场。

## 5. 测试与需求追踪

| 编号 | 测试要求 | 阶段 |
|---|---|---|
| U01 | 双模型真实能力、预算、方言、usage；未知缓存走窗口 | P1/P5 |
| U02 | 大段组批、章边界/超长章、30MB 合成、完整请求预算 | P1 |
| U03 | 缩段补尾/校准重规划的覆盖与持久恢复 | P1 |
| U04 | 多 runner claim、全局限流、所有重试计费、晚回包 | P1/P4 |
| U05 | 两模式共享三书 schema/门禁，冻结提案确定性对照 | P2 |
| U06 | 原著人物与技能、故事信息库→卡片→动作全链路 | P2/P5 |
| U07 | 双题材技能差异、无证据不冒充 explicit | P2 |
| U08 | 30/30/40 边界、未触发不发送、剧情/跨段/重复触发 | P3 |
| U09 | 增量激活、旧存档、分支/rewind、秘密和未来状态 | P3 |
| U10 | FGS/Headless/锁屏/断网/终止/timeout/强停恢复语义 | P4 |
| U11 | DS-FULL/DS-PROG/GLM-FULL/GLM-PROG 各自真实证据 | P5 |
| U12 | SQL 与 builtin migrations 双写、旧库升级、全量回归 | 各阶段/P5 |

测试命名可使用 `tests/unified-build-*.test.cjs`；真实端点 harness 必须调用 production planner/provider/coordinator/编译与发布路径，不能另写一个简化探针冒充 App 流程。桌面端测构建逻辑，Android 端测原生保活和实际游玩，两者分别列证据。

## 6. 交付与完成定义

交付代码、迁移、测试、可运行的脱敏双模型测试 harness、操作指南、`docs/reviews/UNIFIED_BUILD_FIVE_PHASE_REVIEW.md`、四主测试结果与 Android 证据清单。报告逐条映射 U01–U12，列实际命令/退出码/版本/指标，以及失败和未验原因。只提供截图或只列测试名称不算取证。

总完成需要 P1–P5 全部通过。可以标“代码完成、某端点/设备未验”，但不能写“全部验收完成”。不修改确定性骰点与本地规则权威、不泄露密钥/小说、不清理用户数据、不覆盖工作区、不自动 push/发布/合并。文档任务本身不授权现在开始实现或发起整本计费测试；将配套提示词交给施工 agent 后，再按该提示词执行完整施工范围。
