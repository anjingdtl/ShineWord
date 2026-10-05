# Changelog

本项目的全部版本变更记录。版本规则见 [docs/VERSIONING.md](docs/VERSIONING.md)。

## [Unreleased]

## [0.8.1] - 2026-10-05

第八阶段（0.8.0）之后的加固与复验收尾：无新能力，仅身份/存档/规则/数据库基线的可靠性硬化与验收补齐（PATCH）。

### Hardened — 第八阶段重验收与引擎加固（2026-10-05）

- **跨端身份指纹**：请求预算/缓存身份指纹由 FNV-1a 32 位改为可移植 SHA-256（`src/domain/identity/sha256.ts`），Node 与 React Native 同源计算、消除 32 位碰撞；规则配置哈希同样跨端可复现（世界 ID 重绑定不变、参数变化即变）。
- **稳定存档门禁**：导出稳定存档前强制校验分支归属、无未完成冻结回合、无 `prepared`/`sent`/未批准的 `outcome_unknown` 物理请求、无 `running`/`outcome_unknown` 的记忆后处理；移除静默 try/catch 兜底，宁可诚实拒绝也不导出不稳定存档。导入时按 `storyMemoryChain` 校验记忆检查点与补丁链（证据版本、连续区间、指纹一致）。
- **世界规则配置硬化**：`runtimeRules` 统一预设工厂（fantasy/suspense/daily）接入全部生产链路；伪造配置哈希显式拒绝（`configuration_hash_mismatch`）、模块参数须为安全整数、`untrainedPolicy` 收敛为 `forbid`、约束条件引用类型化校验；能力表驱动的行动/效果门——禁用模块即拒绝对应行动、模型自造的效果与越界约束。
- **数据库基线**：迁移链合并为单一当前基线（version 100），新空库一次装全；旧库或不完整库显式拒绝且**绝不静默修复或替换**，同时容忍 Android 系统表 `android_metadata`；移动端新增“创建新的开发数据库”入口（改用新数据库文件，旧数据、API 配置与系统 Keychain 均保留）。
- **移动端记忆状态诚实呈现**：游戏信息面板新增故事记忆状态横幅（已覆盖 X/Y、正在整理、待整理、结果未知已停止自动重发且可能已计费），未知结果提供带计费告知的显式“恢复”入口。
- 核心回归 **916 项全绿**（新增 `tests/phase8-reacceptance.test.cjs`；`894 → 916`）；真实 GLM 三组合旅程复测（fantasy/suspense/daily 各 24 回合）恢复完成。

### Verified — 第八阶段收尾轮补齐 5 项 NOT RUN（2026-10-05 Round 2）

- **A05 对抗泄漏样本**：新增 `tests/phase8-closeout-round2.test.cjs`——权限投影拒绝 GM 秘密/隐藏别名/原著未来并剥离公开场景内嵌私有引用；生产 Planner/Narrator wire 与冻结玩家投影逐字段复核无泄漏。
- **A09 组合超窗**：Narrator + Prepared packet 超窗时可选载荷从同一冻结池裁撤、实际派发 wire 不超声明窗口；叠加 repair 仍不可行则 `final_wire_exceeded` 零发送。
- **A11 冻结后不漂移**：冻结后记忆/设置变化不改冻结根 hash，不同材料覆盖被拒、同材料幂等。
- **A30 确定性重放**：相同绑定/状态/行动/roll 的合同、Prepared 归约与事件流逐字节相同，结果仅提交一次。
- **A36 设备端故障后横幅**：emulator-5554（API 37）实机走查，游戏信息面板显示“1 项请求结果未知，已停止自动重发；可能已计费”横幅与计费告知的“恢复”入口；UI↔设备库对照。
- 核心回归 **922 项全绿**（`916 → 922`，新增 6）；验收矩阵 **PASS 36 / NOT RUN 0 / FAIL 0**（真机与 2 项产品决策项仍为开放项）。

### Fixed — 发版打包脚本健壮性（2026-10-05）

- `mobile/scripts/build-apk.js` 的 `runAndroidTool` 由“管道捕获子进程输出（`spawnSync(..., { encoding })`）”改为“临时文件描述符捕获”：部分加固的 Windows 主机拒绝带管道的子进程（`spawnSync ... EBUSY`），导致 Gradle 成功后脚本在 aapt 后置校验处 `exit 1`、APK 未落到 `dist/`。改用 fd 后 Debug/Release 打包在同机稳定通过；校验工具与判定标准不变（aapt 包名/版本、JS bundle 存在、apksigner 单签名者 + v2 + 期望证书指纹、zipalign 对齐）。

## [0.8.0] - 2026-10-05

第八阶段（Shine-TRPG P8）：通用规则核心 + 可组合机制模块 + 世界规则配置，回合上下文与长期记忆完整闭环。单一当前协议（开发期舍弃旧版兼容）。

- 协议基线（`shineword-core@0.3.0`、ActionContract 2.0 + RuleBinding、`turn-material-1`、`world-rule-config-1`、`mechanism-manifest-1`、save-9、story-memory 观察协议、迁移 33）：旧输入逐版本明确拒绝，无转换器、无双轨运行时。
- 类型化回合材料与判别式记忆资格：未知材料一律诊断、未来/异支/脏检查点拒绝、Pending Bridge 逐提交覆盖连续性；删除 `【标签】` 静默丢弃与 `clean+≤8` 旧门禁。
- 弹性预算收紧：删除 legacy 全量上下文回退；能力未知/mandatory 超窗/信封不可行/最终 wire 超限全部零发送；whole-item 跳过回收不饿死；记忆逐实体 compact 投影。
- 持久化冻结（frozen-turn-materials-1）：冻结根先于任何发送落库、规范化内容 SHA-256、损坏显式失败保留信封、恢复按 turnId 复用冻结材料。
- 唯一提交边界：叙述采纳与 `turn-postprocess-handoff-1` outbox 同事务，outbox 失败整笔回滚；分支串行协调器（租约+fencing token 条件写入）；本地 episodic 索引与 LLM 记忆维护解耦。
- 长期记忆观察协议：批次证据表、确定性 known-change 门（关键变化缺失不得 clean）、accepted-only 派生、实体时间从证据推导、CAS 原子批次应用、fork 仅重放 applied 补丁。
- 机制注册表与能力闭包：8 个首期模块、有界参数 schema、类型化约束目标（纯文本阻止拒绝发布）、不可执行 effect 发布期拒绝；新增可选 `pressure_track` 模块。
- save-9：唯一存档协议，携带 Story Memory 与覆盖区间，导入零 LLM；新空库基线安装，旧开发库检测后拒绝并提示开发重置（API 配置与安全密钥链不受影响）。
- 真实 GLM 三组合旅程（悬疑/奇幻/日常各 ≥22 提交、≥3 个有效记忆批次）与 100/300/1000 累积旅程验证。
- 205 轮设备长程实测（完整 TXT 导入 + 完整构建）修复：同源 TXT 再导入的诚实提示与项目归属（原先谎报新建项目）；后台协调器过期租约的 running handoff 可被安全重领（原先 worker 中断后记忆整理永久卡死）；UWP 外请求账本与 FK 完整性全程零违规。

## [0.7.0] - 2026-10-04

第七阶段（Shine-TRPG P7）：三宝书可玩局面、原著命运改写与回合结算后的路径引导。

- 新增 `situation` 内容类型（world-package-4）：局面定义、办法模板、条件白名单与受限结果，Mapper 协议 v2 提案 + 本地强校验；快速/渐进开局自带本地开局局面。
- 战役因果状态（SQLite 迁移 32：`branch_situations`/`branch_decision_guidance`）：局面状态机、承诺、参考事件抑制与因果进度；原著 canon 与分支事实分离，救下的人物不会被原著未来覆盖。
- Prepared 回合管线：骰点后一次性本地归约（含局面运行时），同一 Narrator 请求输出正文与路径；正文与引导独立校验降级，普通回合仍为 Planner+Narrator 两次业务调用。
- 决策点引导（turn-guidance-1）：安全局势包、本地资格候选（available/needs_preparation）、秘密过滤、附属引导请求 narrator_guidance（P1）。
- 移动端：引导路径卡（这次变化/眼下局势/下一步）、过期校验提交、需准备路径填入输入框、NPC 边界本地引导；候选数量政策收口核心投影。
- 存档协议 shineword-save-8：局面状态与决策点引导随完整快照往返；save-7 旧档照常导入。

## [0.6.0] - 2026-10-03

### Added — 渐进小段建设与独立叙述风格

- 单次精准抽取与本地证据规则编译的开局策略；保留人物、地点、事件、行动与引用闭包，不降低事实/冲突门禁。按依赖规划小段、合并多分支需求、有界近期缓冲及显式全书整理窗口。
- 原文来源身份/规范化 hash/源内码点合同，schema 29～31 的兼容迁移；持久中文索引、动态别名与玩家权限分离。兼容抽取与检查点复用，变化集映射只取必要的已认证旧证据。
- 不可变世界级成果与分支采用清单，stateVersion/manifest/interaction/fencing 事务门禁；已采用新段的知识确认、下一玩家动作 NPC 载入及存档往返。
- 同一请求队列、预算与物理账本的 P0～P3 优先级，交互并发/RPM/TPM 保留、429 Retry-After 与 outcome_unknown 防重发；沿用 Android 前台服务、通知、暂停、锁屏和单执行者租约。
- 跟随原著/预设/自定义项目风格，异步一次分析、用户覆盖与本地降档编译、每回合可恢复快照；项目/等待/回合/存档生产接线。

### Fixed

- 冻结普通回合期间采用内容的竞态、旧交互 journal 迁移恢复、删除后的迟到结果、切 API 的 frozen intent 指纹及回退后的过期需求。
- 原文地点的闭合字段适配、内嵌条目引用更名、已完成旧身份引用闭包、历史 lore 不必要的重映射，以及长篇导入 hash 阶段的原生往返开销与进度显示。

### Validation

- 最终可执行核心回归 762 项通过；根/移动类型、版本一致性、Debug APK 与实际 CI 记录见第六阶段 TEST_RESULTS。所有协议/故障测试保留严格门禁。
- 用户授权 GLM 与小说的一次新本地项目 TTFP 52.046 秒，29 facts / 6 events；服务端缓存热、n=1，不能称稳定 90 秒或真机性能。第一后段真实发布/采用成功，第二后段因自设请求上限未完成；两次真实回合、原著风格独立分析成功，人工内容/风格评分与真机性能未验。详细边界见 FINAL_REPORT。
- 升级版本至 **V0.6.0**（versionCode **60000**）。本次通过 PR 交付，不自动合并、打 tag 或发布 Release。

## [0.5.0] - 2026-10-02

### Added — 多部书籍导入、开局目标推荐与游玩引导

- **项目多部书籍导入（schema 28）**：超长篇可拆成多部 TXT 分次导入同一项目——项目页新增「追加下一部书籍」，追加部登记为 `world_sources` 第 N 部（旧库升级自动回填第一部），世界侧章节/块以 `s{N}-` 前缀镜像、章节序号全局连续，抽取任务（job/fact 幂等键、证据引用、包溯源）跨部永不撞 ID；追加部按整源单 run 构建并入同一世界 canon，下一版世界包自然包含两部的实体/事实/事件。第一部保持原 ID 零迁移，旧项目数据不动。已知第一版限制：游玩侧查书范围仍限于开局部所属源；同一份 TXT 不能同时挂在两个项目。
- **开局目标 AI 推荐**：开局确认页基于世界包（开局锚点时刻、地点、原著人物）异步生成 2 个具体目标 chip，点按即填入，自定义输入框保留为第三选项；新增 `opening_goal` 请求类型（含输出需求与推理预留档位）走统一治理管线。失败静默降级为无推荐，绝不阻塞开局。
- **游玩新手引导卡**：游玩页首屏一次性展示「怎么玩这一局」（行动 → 结算 → 掌控三步），点「开始游玩」关闭（设备级一次性标记），首回合提交后也不再显示。

### Fixed — 键盘遮挡输入区（Android 15+ 强制 edge-to-edge）

- Android 15+（targetSdk 35+）系统强制 edge-to-edge，实测新 API 已无视 `windowOptOutEdgeToEdgeEnforcement` 主题属性，`adjustResize` 从未生效——键盘弹起时游玩输入区、开局向导与 API 配置表单全部被遮挡。修复：游玩输入区（ActionComposer）按 `keyboardDidShow` 实测键盘高度抬升，开局向导与配置页滚动容器包 `KeyboardAvoidingView`；主题保留 opt-out（在支持它的 API 35/36 设备上仍恢复原生 resize）。

### Validation

- 新增 `tests/multi-part-import.test.cjs`（schema 28 回填、`s2-` 前缀与全局章节序号、双源构建幂等、同源重注册不重镜像）与 `tests/opening-goal-suggestions.test.cjs`（JSON 解析、数量截断、三类失败静默降级）。全量 620 项测试通过，根/移动 typecheck 通过。
- 真机链路验证（本机模拟器 + GLM-TEST `glm-5.3-flash` + 《放开那个女巫》前 80 章切成两部各 40 章）：第一部导入构建至可玩 → 项目页追加第二部（两部 run 独立完成，DB 验证 ordinal 1+2、`s2-ch-0001` 前缀、章节序号 41+ 连续、零重复 ID）→ 开局向导出现两条 AI 推荐目标（调查向/结盟向，正确引用锚点地点与原著人物）→ 游玩页引导卡显示并可关闭 → 键盘弹起后输入区位于键盘上方且输入可见（dumpsys 实证 IME 顶边 2223 vs 输入框底 2052）。
- 本次升级至 `0.5.0` / `versionCode=50000`。

## [0.4.5] - 2026-10-01

### Fixed — 账户限流 429 风暴治理与内容审查批次自愈

- **全局自适应限流调度**：`GlobalRateScheduler` 新增 429 自适应治理——连续限流时施加指数惩罚地板（15s→30s→60s…封顶 180s），同时把请求放行间距翻倍拉大（2s 起、封顶 30s），避免「退避结束多个 worker 同时冲出又集体 429」；任何成功响应重置连击并按 60% 逐步放宽间距。此前 429 只靠单元级线性 5~30s 退避，测试账户下表现为 18 连败、进度 0/N 卡死。
- **Retry-After 接线**：provider 解析响应头 `Retry-After`（秒数或 HTTP 日期）写入请求指标，`RateScheduledProvider` 检测到 429 指标时连同该提示喂给调度器——原 `noteRetryAfter` 为零调用死代码，现已全链路生效；非 429 失败不影响调度节奏。
- **限流单元指数退避**：构建单元对 `rate_limit` 分类的重试从线性 5~30s 改为 15s→30s→60s→120s→240s（封顶）加抖动，兄弟 worker 不再同拍重试；其余可重试分类保持原线性阶梯。
- **构建默认并发 3→2**：`DEFAULT_WORKER_CONCURRENCY`、runConfig 冻结默认与两个模型预设（DeepSeek/GLM）统一下调，降低受限账户的瞬时请求压力；调度器间距在压力下会进一步串行化。
- **游玩回合纳入统一调度**：游戏回合此前走裸 provider（与构建互不感知、撞限流直接失败）；现与后台构建共用 per-endpoint 全局调度器实例（`mobile/src/llmScheduler.ts` 注册表），构建学到的退避节奏对游玩生效，反之亦然。
- **内容审查 4xx 批次自愈拆分**：识别服务商内容安全拦截（HTTP 400/4xx + 中英文「敏感/不安全/content filter」文案）为独立 `content_filter` 分类：多章批次立即对半拆分重试（干净的部分照常完成，被拦的子批继续拆小），拆至单章仍被拦才转人工审查；不再把确定性拒绝当可重试错误无限重试，也不触发排队尾部缩批。此前表现为「继续构建」点一次重试一次、每次都 400、整个 run 反复挂起。
- **审查后恢复被替换残留阻塞**：canon_conflict 审查处理完毕后的恢复 SQL 把拆批/重排产生的 `canceled` 历史单元当「未完成」，run 永远无法从 `needs_review` 回到执行；现仅以非 `completed/canceled` 单元为未完成判据。

### Validation

- 新增 `tests/rate-limit-governance.test.cjs` 七用例：惩罚地板指数增长与封顶、Retry-After 提示优先、acquire 阻塞与间距放行、间距连击翻倍/成功衰减、scheduled provider 的 429 接线与成功通知、非 429 失败不干扰调度、`parseRetryAfterMs` 秒数/HTTP 日期/垃圾输入。
- `build-downsize-recovery.test.cjs` 新增内容审查拆批用例（对半拆分、父批取消、无尾部缩批、覆盖完整）；`build-stop-resume`/`resident-build-p2` 三处对 replan 时序敏感的 mock 补全 chunk 形状并改锚定最终单元总数。全量 614 项测试通过，根/移动 typecheck 通过。
- 真机链路验证（本机模拟器 + GLM-TEST `glm-5.3-flash` + 完整《放开那个女巫》1504 章 / 7.18MB）：S1 抽取 13/13 批完成（单批约 80K 输入 token、1~4.5 分钟），其中一批触发智谱内容审查 400，自动对半拆分后干净通过；15 条事实冲突走审查链路逐条裁定；世界包 r1 发布（765 实体/623 事实/181 事件/5 规则映射）。开局（原创角色 Roland·绝境山脉锚点）后连续推进 11 个回合全部提交、11 条叙事生成，全程 HTTP 429 计数为零；账本 39 次成功请求、19 次失败全部为修复前断网窗口与内容审查确定性拒绝，无浪费重试。
- 本次升级至 `0.4.5` / `versionCode=40500`。

## [0.4.4] - 2026-10-01

### Fixed — 世界映射自动恢复、审查策略与真实构建进度

- 世界映射遇到 JSON 截断、仅思考无正文时，后台自动提高正文与同档思考预算，再拆小超限批次；持续故障按持久化退避策略续试，保留已完成成果。技术故障不进入人工内容审查，旧 `mapping_failed` 审查项自动退役。
- 映射检查点保存完整提案与实际输入哈希；续建会恢复并合并已完成提案，事实内容变化后不会复用旧结果。
- 构建卡统计“抽取批次 + 映射 + 审查校验 + 发布”，发布成功才到 100%；展示后台映射与恢复活动，保留最近完成的任务。存在内容审查项时可从构建卡直接进入审查页。
- 内容审查默认记住本世界中相同内容与严重度的处理策略；内容变化时重新审查，可关闭策略记忆。新增兼容迁移 schema 27。
- 保存多条具名 API 配置，切换时复用各自的模型、参数与 Keychain 密钥；旧单配置自动迁移。失败/暂停任务可明确选择“用当前 API 继续”，正在运行的配置保持冻结。
- 升级版本至 **V0.4.4**（versionCode **40400**）。

## [0.4.3] - 2026-10-01

### Fixed — 构建阶段 0/N 永不推进（超时/4xx 原样重试死循环）

- **超时即降规模**：300 秒级模型请求超时不再按原批次大小无限重试——多块批次立即事务性对半拆分，并把仍未领取的排队批次按比例阶梯降档（12%→6%→…），直到收敛到服务商能在传输上限内答完的规模；此前只要某批稳定超过 300 秒，就会 0/N 原地打转（用户实测《放开那个女巫》0/9 批卡死即此根因）。
- **上下文超限 4xx 同样拆分**：HTTP 400/413 携带「上下文/输入超长」语义（中英文错误文案识别）时走同一条拆分-降档路径，不再把确定性失败当可重试错误。
- **持续 4xx 转入审查**：同一单元连续三次遭 4xx 拒绝（非鉴权/限流）时转入 `needs_review` 停止烧钱，等待人工处理，而不是无限退避重试。
- **服务商错误原文可见**：HTTP 错误响应体中的错误文本经脱敏（密钥/Bearer/sk- 前缀）与 300 字截断后随请求指标持久化，失败明细从「HTTP 400，unknown」升级为带服务商真实原因的说明。
- **审查后恢复通道补全**：点「继续构建」时，因 network/unknown/input_too_large/config 停入 `needs_review` 的单元重新入队执行（`outcome_unknown` 仍由请求账本门控，canon_conflict 仍走审查门）。
- **修复渐进构建触发器从未接线**：游玩回合间的阶段触发此前只传 `worldId`（无锚点、无依赖），S2/S3 在正式游玩中永远不会入队。现在从「开局锁定事件的来源章节 ∪ 玩家当前场景地点的证据跨度」推导叙事锚点（furthest-wins，`deriveNarrativeAnchorCp`）：后期开局或深入后段地理会按设计触发下一阶段预构建，停留在书首不会误扫全书；长期停留仍不自动推进（时间/回合数不是触发器）。

### Validation

- 新增 `tests/build-downsize-recovery.test.cjs`：超时拆分、超限 400 拆分、providerErrorText 脱敏截断三用例；适配 `closeout-c3` G0 指标存活用例至新拆分语义；新增叙事锚点推导用例（开局章节+当前地点、furthest-wins、降级路径）。全量 592 项测试通过，typecheck 通过。
- 真机链路验证（本机模拟器 + GLM-5.3-Flash 真实端点 + 完整《白篱梦》300 章/1.07M 字）：S1 抽取 3/3 批完成（单批约 91 秒，33.6k 输入/5.0k 输出 token）、映射 3/3、审查 6 条证据冲突逐条裁定后「继续构建」成功发布，项目达到「可游玩」，开局流程引用真实原著正典（序1·蒋后被杀 / 定安伯府）并创建战役。
- 真实游玩续测（同一环境，7 个已提交回合）：中文建议 chip 与自由文本行动均走通「意图 → 本地 3d6 检定（难度 4，掷骰卡片可见）→ GLM 叙事」闭环，世界时间由子时五刻推进至丑时一刻（含短休 +30 分钟）；叙事连续引用已发现线索（碎玉佩/三日之约）并随行动推进剧情；短休、SAF 导出存档（文件落 Downloads）、游戏信息面板与角色卡（气血/体力/防御/状态）均验证可用；全过程中无 JS 异常，阶段触发接线按新锚点逻辑运行且书首开局正确地不预构建 S2。战斗遭遇路径因当前开局锚点场景无驻场演员而未覆盖（内容属性，非缺陷）。
- 本次升级至 `0.4.3` / `versionCode=40300`。

## [0.4.2] - 2026-10-01

### Fixed — Android 真实游玩与恢复

- 独立 Debug APK 内置 JavaScript，安装后可在没有 Metro 的环境冷启动。
- 配置保存先确认系统 Keychain 密钥，再发布普通配置；缺少密钥或安全存储失败不会留下假成功配置。
- 世界构建冲突按原著证据展示并裁定，保留审查记录；冲突全部处理后可继续发布已完成阶段，阶段完成提示不再表示整本精编完成。
- 当前世界时间进入必需上下文与叙事约束，修正中国时辰刻数；新故事跟随阅读末尾，读旧故事时保持位置。
- 强停后恢复原始行动、冻结合同和既有骰点；云端结果未知时提供明确说明与当前回合的确认重试入口，不自动重发、不重掷。
- 存档导入保留战役名称，旧存档可从世界名与人物卡恢复名称；导出及分支回执移到菜单可见处。
- 返回战役、退出游戏菜单及开局补齐资料返回书库时退回已有页面，避免导航栈重复保留旧游玩页。

### Validation

- 指定 GLM 与完整《白篱梦》在本机模拟器完成 16 个真实回合、2 次休息，覆盖原著/原创开局、三档推理、存档与世界包往返、断网、后台、两处强停恢复和重复点击；588 项核心回归通过。细节和范围见 [Android 验收报告](docs/reviews/android-qa-20261001/TEST_RESULTS.md)。
- 本次升级至 `0.4.2` / `versionCode=40200`；签名、安装与发版产物记录见 [V0.4.2 发版记录](docs/releases/V0.4.2.md)。
- 精编仅验第一阶段；实际战斗、招募、训练、真机性能及其他 Android 版本仍未覆盖，不把本次主路径验收扩大为全功能稳定保证。

### Fixed — 真机 P0 稳定性修复（fix/mobile-runtime-stability）

- **导入进度闭环（99% 卡死）**：流式 TXT 导入在 `activateSource` 之后新增显式的「原文解析完成：N 章 · M 块」事件，unified/full 两条路径在创建构建任务后发出「已创建 N 个构建组，等待模型处理」（phase 进入 extracting）。UI 不再停留在最后一次 reading 的「解析中 99%」；复用已导入源（同哈希重复导入）同样完整收尾。
- **后台 Runner 异常不再静默**：Headless `WorldBuildRunner` 外层 catch 改为分类持久化（`runner_execution_failed` / `keychain_unavailable` / `provider_config_error` / `network_error`，消息经 `sk-`/`Bearer` 脱敏）；仅当 run 仍假装 queued/running 时写入 `failed_retryable`，coordinator 已分类的状态（paused_user/needs_review/waiting_* 等）不被覆盖。旧版 run 无冻结配置且无可用凭据时落 `waiting_unlock(keychain_unavailable)`，可见、可恢复。
- **前台服务启动看门狗（execution-start confirmation）**：`startBuildWithWatchdog` 在 `startForegroundService` 成功后轮询本地 SQLite 执行证据（run 进入 running / 活跃 lease / heartbeat / unit running / attempt>0），窗口内无证据则前台 inline fallback；lease + fencing token 保证后台与 inline 恰好一个执行者（慢启动的后台执行者在窗口内出现则不重复执行）。
- **0/N 阶段可观察性**：任务卡派生计数实时来自 `world_build_units` 行状态——「抽取事实 2/69 组 · 正在处理 3 · 排队 61 · 待重试 3」，running 时显示「正在等待模型响应（第 N 次尝试）」与最近活动时钟；不虚构 ETA。
- **可恢复停止（stopped_user）**：用户可见「取消」重定义为「停止构建」——停止后续 claim、保留已完成组、保留待重试组、保留 run 与 SQLite 数据，可随时「继续构建」。迁移 24 表重建 `world_build_runs` 的 status CHECK（FK 安全的双表重建过程），同步 `BuildRunStatus` / store / `listResumableRuns` / `RUN_STATUS_LABEL` / coordinator / UI / 通知按钮（「取消」→「停止」）。
- **暂停状态机**：`pause_requested` / `cancel_requested` 进入任务卡视图，「暂停请求中 / 停止请求中」立即可见且可撤销；`requestRunControl('resume')` 现在同时清除 pause 与 cancel 标志（修复旧实现 resume 不清 cancel 导致恢复即被再次停止的缺陷）；coordinator 在所有 worker 退出后统一再清一次控制标志（并发 worker 的竞态残留）；`acquireLease` 将任意非终态 run 置回 `running`（修复 paused_user/failed_retryable 恢复执行时 UI 仍显示旧状态的僵尸执行者问题）。
- **待重试计数口径**：`units_failed` 保持为累计失败尝试次数（现暴露为 `failureAttempts`），UI 不再把它当作待重试组数；当前待重试改为对 unit 行的实时 COUNT（failed_retryable + waiting_network），恒满足 retryable ≤ total。69 组 / 176 次历史失败不再显示「176 待重试」，累计次数移入展开明细。
- **任务列表自动刷新**：存在动态任务（running/控制请求中/等待/可重试）时书库每 ~1.5s 轻量刷新任务视图（仅本地 SQLite，无任何 provider 请求），失焦或全部静态即停止。
- **模型配置「测试连接」**：Profile 表单新增按钮，用生产 OpenAI 兼容管线（同一 provider、同一 reasoning 档位与方言参数塑形、`/chat/completions`）发送极小完成请求；表单中未保存的 API Key 仅存内存，Key 为空时回落 Keychain；结果区分 成功/401/403/404/400（含 reasoning 参数不兼容）/429/5xx/超时/网络/非 JSON 响应/仅思考无正文，密钥绝不进入结果、存储或日志。
- **失败明细改进**：展开明细包含 runId、状态、完成/总组数、处理中/待重试/排队、累计失败尝试、最近错误码与消息、最近活动时间、最近 3 个失败 unit（unitId/attempt/errorCode）。
- 新增回归测试 37 项（import 进度闭环 / 连接探测分类与密钥不泄漏 / runner 失败持久化 / watchdog 决策 / pause-resume-stop 全链路含已完成 unit 不重做与 lease 防双执行 / 计数语义 / 轮询决策），全量 506 项通过。

## [0.4.1] - 2026-09-30

### Added — Reasoning & LLM Governance Closeout

- 设置页支持 Low / High / Max 三档思考强度，并显示 Planner 预算预览；自定义模型上下文窗口与最大输出能力可保持 Unknown 或由用户填写。
- 统一 Reasoning Policy 将冻结档位同时映射到 Provider 参数、Reasoning Reserve 与 wire 输出预算；Planner、Narrator、Story Memory、Summarizer、World Build 及渐进式开篇请求均复用预算与账本治理。
- Legacy `off` 在 Profile / Frozen Run 兼容边界迁移为 Low；新 Profile 和新 Run 只保存 Low / High / Max。Reasoning-only 有界恢复保持用户所选档位，不关闭 Thinking。
- World Extract 与 Group Extract 复用结构化输出管线，继续执行本地证据引文校验；渐进式开篇按 Max 预留收缩来源上下文，保留首幕证据范围并将请求写入 Ledger。
- 新增 reasoning usage 按 profile、档位、请求种类的可校准统计基础；usage 未知保持 Unknown，不按 0 处理。

- 升级版本至 `0.4.1` / `versionCode=40100`。

## [0.4.0] - 2026-09-30

### Added — LLM 上下文与长期记忆基础设施（M0–M6）与版本管理规范

- **统一请求预算内核**（M1）：模型能力来源五级治理（user_declared > provider_documented > provider_probe > derived > unknown），探测不再伪造 128K 上下文窗口；请求包络 `Hard = C − O − R − S`、Soft 80% / Burst 95%，推理预留按 Provider 方言（inside_completion / separate）只扣减一次；四阶段确定性弹性分配器（mandatory 保护、目标填充、burst 借用、mandatory 补齐），`planLlmRequest()` 统一冻结输出预算与分配轨迹；B01–B12 与 32K/64K/128K/200K/1M 五窗口测试矩阵全绿。
- **JSON 韧性层**（M2）：字符串/转义感知的平衡 JSON 提取、Markdown 围栏剥离、字符串外尾逗号修复、≤2 层双重编码解包、白名单字段/枚举别名（canonical 永不被覆盖）、截断与缺失分类（json_truncated / no_json_found）；权威校验器（assertValidActionContract 等）位置与强度不变，内部持久化 JSON 仍走严格解析。
- **物理请求账本**（M2）：迁移 19 `llm_request_attempts`，六态生命周期（prepared→sent→succeeded/failed/outcome_unknown/cancelled），App 强杀后冷启动自动标记 outcome_unknown 并**禁止自动重发**（防重复计费）；Planner / Narrator / Summarizer / Memory 全部入账，input/output/reasoning/cached 四列用量落库。
- **Story Memory V2**（M3，双轨）：人物叙事状态、关系、冲突、线索、伏笔、节拍；LLM 只产出 Patch（稳定 ID 与指纹链本地生成），确定性合并器 + 证据回指（每项必引本批 turnId）；Smart Cadence 触发（间隔 ≥8 或关系/任务/队伍/高重要信号），后台 return-first 维护**永不阻塞游玩**；历史缺版本时 fail-closed。迁移 20。
- **Episodic Recall V2**（M4）：完全本地召回（零 Embedding API、零每回合 LLM）——CJK 一/二/三元组 + 英文词元 + IDF 加权 + 实体加权（歧义别名不 boost 任何人）、混合 Top-K（60% 相关 / 20% 人物史 / 20% 近期）、whole-item 预算打包、按时间线渲染；30/100/300/1000 回合长程召回全过（1000 回合 4.7ms）。迁移 21。
- **弹性回合上下文**（M5）：六大 Board（authority/currentState/worldKnowledge/storyMemory/recentHistory/sourceEvidence）候选 → 内核预算 → 冻结 → 分节渲染；**Narrator 独立上下文与预算**（永不见三宝书/证据/行动协议）；Story Memory V2 读门（clean 且覆盖足够才替代旧摘要）；能力未知时显式 legacy 回退，坏配置不破玩。
- **真实 GLM 验证**（M6，GLM-5.3-Flash）：五门全过（Planner / Narrator / Memory Patch / JSON 围栏变体 / 账本用量），reasoning 与前缀缓存实测观察；《白篱梦》真实 10 回合闭环通过（开局 dossier 单请求零修复；v0-8 记忆检查点 clean；第 2 回合的玉簪之约在第 9 回合被正确召回）；《凡人修仙传》2469 章 1.5s 导入、54K-token 真实请求 3.8s、重复前缀 99.8% 缓存命中；Android（ShineQA AVD）安装/冷启/迁移 1–21/force-stop 恢复通过。详见 [docs/reviews/llm-memory/FINAL_REPORT.md](docs/reviews/llm-memory/FINAL_REPORT.md)。
- **版本管理规范**：参考 tavo-mini 建立[统一版本号与迭代规则](docs/VERSIONING.md)（语义化 + versionCode 编码公式 + 六处一致性 `npm run verify:version` 门禁）；构建前自动生成 `mobile/src/version.json`；App 内「关于」与书库/模型页展示**作者 ShineHe** 与当前版本。
- 顺带修复四个存量缺陷：fork 不复制回合历史行、开局 8K 上限与思维预留冲突、Memory Patch 协议「省略节」与验证器矛盾、Planner 上下文缺合法技能 ID 列表。
- 升级版本至 `0.4.0` / `versionCode=40000`（首个执行统一版本号规则与正式签名发版的版本）。
