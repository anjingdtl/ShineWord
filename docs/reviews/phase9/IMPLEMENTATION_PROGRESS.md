# Phase 9 收尾建设与复验进度

更新2026-10-08：云端已接手交接提交 `46628ba`，完成 R54–R56 请求/人物共用边界修复；最终核心 **1159/1159**、移动类型与版本检查通过。请求批次提交 `967e101`，人物批次见其后 Git 历史；本批未推送/发布。整体验收仍 **29 PASS / 2 FAIL / 9 NOT RUN**，新增真实决定0、预算1210/1500。当前身份、失败复现、构建和外部依赖见[云端续作报告](CLOUD_REVIEW_2026-10-08.md)。下列早期数字及各轮记录保留其历史身份。

| 包 | 状态 | 收尾结果 |
|---|---|---|
| P9-0 | 报告/治理已纠正 | 撤销旧完成结论，四态矩阵、共享预算与源码身份 |
| P9-1 | 已修复并回归 | 严格条件/引用/效果，自依赖完成拒绝，真实近期覆盖，四档资源上限与耗尽零操作剔除 |
| P9-2 | 已修复并回归 | 管理修改和快照同事务，不可变归档，技能/关系/奖励投影，存档碰撞重绑 |
| P9-3 | 已修复并回归 | 完整冻结池、原始响应先落盘、ready完整性、取消fence、两次物理共享额度；真实语义仍可能invalid |
| P9-4 | 已修复并回归 | 稳定方法绑定，可选技能元数据不吞后果，当前已发布选择不被推测相邻原文建设阻塞 |
| P9-5 | 已修复并回归 | 自动有界恢复、稳定边界CAS、旧终态保留、有效原文材料、旧局面承诺；真实采用已有 |
| P9-6 | 实现修复，完整验收未完成 | 冷启动提案恢复、主线指引优先、独立当前决定点、后台采用后刷新、滚动展开面板 |
| P9-7 | 未通过 | 真实决策矩阵、两个持续后果、六维质量和匹配性能基线仍未满足合同 |

当前核心全量1017/1017，0失败0跳过（final21）；历史final17为1004/1004，包含生产Session的100/300/1000本地累积；16项flow集成及全部核心覆盖；移动类型检查与debug APK构建通过，当前日志为 .tmp/phase9/reaccept-core-final21.log、reaccept-mobile-final21.log、reaccept-apk-final21.log。R19–R21涉及核心解析、校验与生成/修复提示，重新完整运行门禁并构建对应APK；移动/原生显示源码逐文件与final14相同，显示证据身份保留。此前构建并行时短租约测试超时，独立完整回归通过；没有删测试或放宽断言。

修复要点：

1. 管理行与快照在同一事务归档。采用同时检查在途回合、意图、分支/计划版本及原文绑定，事务内重复CAS。
2. 损坏或旧冻结零HTTP，不能读取live重构。原始响应在解析前持久化，ready验证完整主体及哈希；成功阶段恢复不重发。
3. 无局面的未来节点为provisional，自身成功不能成为自己的完成条件。不同方法需真实机制差异，不由编译器发明路线或结局。
4. 方法按实际actionKind/目标匹配，可选技能字段不改变合法动作的后果；四档投骰前冻结。惩罚耗尽当前资源，治疗遵守卡上限，零余额无操作剔除而严格正数门保留。
5. 指引从当前决定点推导，主线办法在候选上限内可达；开局、管理、冷启动和新采用后不依赖旧叙事卡。
6. 重规划读取分支已采用原文，并按锚点过滤；相同版本下材料绑定变化也stale。新方法可兑现分支拥有的旧局面承诺，未知/跨分支引用拒绝。
7. Android异步完成刷新只在实际卸载/分支变化时取消，普通rerender不再吞掉采用后的UI更新。
8. 按FLOW_REVIEW先梳理十模块交接，再统一修复业务事件当回合求值、休息/训练/里程碑/招募/战斗漏主线结算、整卡覆盖奖励与社交增量重复；16项跨模块生产集成通过。
9. 承诺以局面+承诺ID闭包，当前局面的完成必须有本地效果来源；不把旧承诺配给新self。首局面不能绑定已定局/退休节点；已有原局面承诺仍可兑现。
10. 主线卡、开局提案、规划状态及项目建设提示显式使用主题onRaised颜色，修复三个深色主题默认黑字；四主题/字体/小屏以最终设备证据为准。
11. 主节点失败后清空primary的同次提交仍排一个重规划任务，写公开失败反馈，休息不重复发送。定时局面完成要求独立成功证据，实际到期不能供给正向resolved证据，即使此前已有部分成功也不误授奖。
12. ScreenShell与独立PlayPanel分别处理页面/弹层键盘，导航预留安全区；大字体/矮窗口快捷行动跟正文滚动，保留阅读空间。打开/关闭主线面板清除原输入焦点，关闭目标草稿清除草稿与键盘。独立Modal补齐上下安全边距，保证键盘打开后关闭按钮仍可点击；QA检查面板与IME确实消失。详见FLOW_REVIEW R12–R16与最终设备证据。
13. 生成提示的后果示例原先使用带连字符的eventType，与严格解析器的snake_case合同冲突。修正示例及事件名说明，新增实际提示示例进入生产解析器的回归；保留非法事件名拒绝。真实候选缺少完成条件的效果来源仍按合同拒绝，不能用修正示例的成功冒充完整旅程通过。详见R17。
14. 前台字号变化需先完成原生root测量，再刷新DeviceInfo并重建字体显示子树，避免Fabric文字缓存导致第一次放大裁字。仅重建子树、仅请求根布局的失败证据保留。final14三次1.3→2→1.3→2实际截图可读，正文视口426/412/426px，路由与v24保持一致；目标草稿/个人页路由、360/411dp×1.3/2四组布局、四主题主线/面板实际复测通过。详见R18及final17显示源码等价证据。
15. 实际新J1响应暴露奖励子项未经解析校验，缺targetId引发TypeError而误标可重试。已补严格奖励解析、集合null/缺失ID拒绝和运行时scope类型保护；提示明确关系奖励targetId与效果fromActorId的区别。55项解析/规划/跨模块回归通过，包含两响应后invalid、完整响应留存、重入0HTTP；后续全量与APK证据见最终记录。详见R19。

16. 技能等级只接受规则定义中的字符串untrained/novice/trained/expert/master，提示与解析错误共用SKILL_RANKS；数字1和字符串数组不能被强转为合法等级。新增实际生成/修复材料回归：数字响应→一次修复novice→ready，共2请求。详见R20。
17. 方法前置条件数组技能ID的编译TypeError已离线复现并修复；枚举与引用字段集中校验，合法条件完整保留，可选null仍表示无目标/门槛。错误响应最多一次修复后invalid，原响应留存，恢复零HTTP。final16真实ready原文在final17重新解析、编译及校验通过，计划hash一致。详见R21。

真实零体力故障原回合已复用Planner恢复成功，新增1次Narrator。自动计划后果定义缺失仍按两次请求invalid；完整内容门另验。管理、轮询、未提交重试、无关重复和结束后动作不计最低80。

## 历史交接续跑轮（final18；下述完成计数与故障定谳已被接手审计纠正）

接手现场：final17门禁后codex又修改candidateModel/generationService（R21严格引用类型门+回归，测试1004→1005），重跑final18全门禁（core 1005/1005、mobile typecheck、APK构建均0，日志reaccept-*-final18.log、身份reaccept-core-identity-final18.json，源码哈希c12623bd95252b9f…）后额度耗尽。设备J1 UI旅程（camp-muxn9k9t，final17身份）停在5/20。

本轮处理：

1. **旅程停止原因定谳（产品无缺陷）**：round2日志+现场复现证明，决定5在v6触发cons-guard-grudge后果后指引异步刷新，驱动器9秒后按旧方法卡提交，被过期选择门（session.ts"所选路径已不在当前可用办法中，请刷新后重新选择。"）安全拒绝并显示"操作未完成"；同界面重新点选同动作即提交成功（v7入账）。这是可恢复的竞态拒绝，非产品缺陷；device-journey.cjs已把该横幅改为有界重试（2次，记录横幅原文），保留真失败即停的安全语义。
2. **环境恢复**：emulator-5556（ShineWord_P8_Reacceptance）重启；codex的QA代理进程（18691端口）存活复用；final18 APK重建（gradle输入校验复用13:20产物，APK SHA 7b7ebd34…）install -r保留数据；reaccept-device/identity.json更新为final18。
3. **final18同身份新J1**：经正式开局入口新建camp-muxpraio（序7罗兰决定探视女巫、边陲镇、原创J1Final、长篇、推荐探视/查真相目标（未含明确救援承诺）——模型opening_goal原文，因ADBKeyBoard与Maestro中文输入在API37均不可用而采用推荐芯片原文，未手写裁剪意图）；生成1HTTP一次通过ready（无修复请求），采用后首局面直接active（R04修复生效）。
4. J1 UI 20旅程（PHASE9_UI_JOURNEY=j1-final18）进行中；J4分支UI10待J1完成后同身份执行。预算manifest记账：959（接手时）+复现回合2+opening_goal 1+生成1（+后续每决定约2与阶段重规划）。

**历史结果声明（有效决定数及无缺陷结论已撤销，原日志保留）**：J1 UI旅程完成——camp-muxpraio-main共23个已提交玩家决定（≥20），阶段轨迹meet-anna成功→roland-trust失败→mine-collapse失败→自动重规划second-chance失败→anna-bond成功→walls-and-gates成功→verdict-day开放；3节点奖励入账；rev1→rev6共5轮重规划采用、1次invalid正确拒绝零重发；UI分叉camp-muxpraio-bmuxs9rng（v27基点）后完成J4 UI 10决定（v37），分支隔离经DB验证。旅程中无产品缺陷：4次停滞守卫自停均为重规划内容full_success门控（success档只推未接入completion的计数），属A36内容质量缺陷，按J3-final先例不新增硬门禁、如实记录；1次"No meaningful UI route"为重规划候选candidate_ready待稳定边界采用（回前台触发采用成功）。最终预算1045/1100（余55）。QA驱动器最终形态：过期提交有界重试(2次)+方法推导空缺时按可见按钮兜底+停滞守卫保持不变。清理：ADBKeyBoard卸载、IME恢复Gboard；QA代理进程与设备LLM配置保持原状待整体收尾决定。

## final19模拟器接手复核（2026-10-07）

此前交接轮的“23提交≥20、分支10完成UI10”声明撤销：J1 v24–28与J4新增v28–37均为空效果机械重复，不能计合同有效决定。启动原AVD并保留SQLite，安装最终APK前后版本/分支核对；旧代理已停止，改用不会伪造503的有界预算代理。旧503账本记录与后来的过期指引拒绝分别留存，通用错误不再自动重复提交。

新增R22普通成功效果来源门、R23前置字段合同与具体修复反馈、R24代理未知结果分类、R25验收计数与身份范围纠正，详见FLOW_REVIEW。完整1012/1012、移动typecheck、APK构建、版本与diff检查通过。此轮修改未提交或推送；接手前HEAD已有4fb5519/5a6e077两次提交，记录不再称整个既有收尾未提交。P9-7总体仍未通过。

## final21架构边界收尾

R26在共用CampaignProgressReducer修正primary选择：具体近期内容可接替保留的粗节点方向，但不抢占活动具体阶段、不绕依赖、不恢复暂停状态。R27明确两种读职责：完整不可变内容供权威结算、冻结恢复、历史/承诺/延迟后果引用；当前行动内容由同一projectPlayableSituations按runtime投影，供编译、Planner、准备态Narrator、立即保存与冷启动指引。没有额外写回局面状态，也没有UI独有屏蔽规则。四项生命周期回归包含原active局面的旧承诺跨阶段兑现、普通事件完成但局面仍active、自然结束、同版本旧缓存、旧选项0HTTP和归档字节不变；全部门禁1017/1017与最终APK通过。

真实UI恢复新主线办法→旧承诺兑现→新候选自动采用→普通成功自然结局已跑通；最终APK在原v33验证结束指引，历史/分叉均保持原样。整体P9-7仍未通过，A01–A40为29PASS/2FAIL/9NOT RUN。预算1055/1100，清理恢复直连端点并停止本轮代理。此轮新增修改尚未提交或推送。

## final23继续收尾（2026-10-07）

上述final21修复已提交eb48daeb835b0a0939b9f41fe0526261bb24ba1a，未推送。用户要求commit后继续推进缺口；共享请求上限在下一次发出前公告1100→1500，保留已用1055及历次记录，不随主机/设备或重启重置。

R28贯通候选准备条件、原白名单AST编译、引用校验、现态事实、行动资格和公开指引；R29将局面关闭后无法重复的行动供给纳入新提案普通成功必要门禁。详见FLOW_REVIEW。七项新回归与完整核心1024/1024通过；不是完整旅程或内容质量证明。另增test-only Android Unicode输入辅助工具，在正式输入控件通过Accessibility ACTION_SET_TEXT精确写入和清空中文，不写设备数据库、不包含于生产APK。

真实final22 UI已经用明确“保护并救援被囚禁的安娜、阻止处决、持续安全”的目标生成并采用，普通success发现首阶段关闭前关系供给不足，保留诊断并用于R29回归。不能把开局目标建议、轮询、过期指引拒绝或自动采用计为玩家决定；完整最终旅程继续验收中，整体P9-7结论保持未通过。
## final25继续验收检查点

final23明确救援J1完成四个有效玩家决定，在v6自然停下：实际execution_prevented事件记录处决令作废，安娜仍active；持续安全n4尚available、镇民协助n5尚planned。错误早结局源于“n3成功且后续支持事件不存在”，不能计20或长期保护完成。R30在新候选生成入口拒绝这类条件，保留原档及结束状态作为故障证据。R31对真实J2误放条件给出完整包装修复反馈。五项结局门回归加一项前置反馈回归，完整核心1030/1030、移动类型、APK、版本及diff检查通过。

final24 J2生成及修复共2HTTP后invalid，0玩家决定；final25重新从生产入口准备自动内容，J2共2HTTP后ready并正式采用。未人工补齐模型内容或状态。final25救援UI明确目标、合法属性/技能及长篇偏好已逐字段核对。最终旅程数量、后果持续和三意图质量尚需实际完成与评分，不将检查点改为P9-7完成。
## final27继续验收检查点

R32统一已公开在场NPC别名在编译、条件引用、结算及关系准备门中的身份；R33统一proposal长度提示/严格校验与具体修复错误。详见FLOW_REVIEW。新增五项回归，核心1035/1035，移动类型、APK、版本和diff通过。实际保存的NPC目标失败和43字tone失败均离线复现；没有人工改写原模型响应或旧档。

final25调查经5个可评估决定在v8自然结束、所有必做主节点完成；额外available节点为optional，不能因长篇配额继续刷动作。final25救援共2响应invalid，根因是规划材料允许的人物别名被编译误拒；final26合作共2响应invalid，根因是长度反馈不具体。均保留独立身份和失败证据。final27三意图正在从自动入口复验，不能拼旧轮次数满足最终80。

## final28检查点

final27实际J2在7个候选有效决定后因新末端节点缺少终局引用安全invalid。J3达到work门槛后仍等待大成功兑现旧承诺，11次提交只形成5项可评估进展，其余6次额外计数不兑现承诺、不打开新机会，排除配额。R34让普通成功作者门消费冻结的跨阶段承诺/计数/状态；R35把裸前序成功提前结束纳入同一终局顺序门，真实损失和optional后日谈保留。原真实工件0HTTP离线被识别，旧归档hash不变。

完整核心1040/1040、移动类型、Debug APK、版本及diff通过；新增五项回归含生产SQLite重规划2请求精准修复后实际普通成功履约。新APK已在emulator-5556保留数据安装并核对hash。完整真实旅程、持续后果及六维质量仍独立验收，不能把安全invalid或必要结构门当作P9-7完成。

## final29工程收尾提交检查点

final28实际high的三意图开局规划各1请求后300秒超时，全部outcome_unknown；零自动修复/重发、零玩家决定，不能推断质量改善。设备原任务手动恢复虽然零HTTP，显示却被降为校验失败，触发R36。现在移动桥接与OpeningScreen共用持久任务分类；两项SQLite/移动回归及实际同一job冷/手动恢复通过。冷入口另有opening_goal 1请求单列，规划仍1次，最终共享预算1161/1500。

核心1042/1042、移动类型、35s Debug APK、版本及diff通过。fontScale2的360/411dp受影响显示和原v33结局均实际补验；后者0决定/0HTTP、全部归档与旧承诺/分叉不变。已恢复正式直连端点/low及Gboard/字号/密度、确认Keychain引用不变并停止本轮代理，原库和未知任务保留。R28–R36与测试/工具/报告纳入本次本地提交，未推送或发布；A01–A40仍29PASS/2FAIL/9NOT RUN，P9-7整体未通过。


## 2026-10-08 final33：长规划的传输、租约和物理预算

R37：opening/replan共用candidateJob，以owner+fence CAS续租覆盖排队、请求及修复；取消/接管/续租失败后不发布，已收到业务原文仍可持久化。R38：共用provider按冻结kind/tier给high规划900秒、max1200秒等待上限（不是吞吐预测）；支持streaming的高强度规划接收SSE，完整结束标记与finish_reason齐备才返回业务正文，思考绝不回填正文，断流保持未知且不重发；流式能力纳入profile身份，旧buffered指纹兼容。R39：GLM预设声明流式支持，高级设置、预算预览和store共用显式能力上限；设备正式UI保存后仍为1M/32768，content16384、high、Keychain引用未变。R40：生成、调度和ledger共用最多2物理请求，单次dispatch的maxPhysicalRequests=1；仅已知reasoning_only允许一次内核1.5倍预留重规划，仍保留档位/材料/模型声明上限。思考恢复与结构修复共享额度，未知不重试；重启消费原冻结根和剩余额度，异常时physicalRequests按durable ledger实派次数报告。

final30诊断分别为J2 Node fetch约307.035秒断开、J3去除该隐藏响应头时限后约329.597秒上游socket hang up；各1次网络未知、0候选/0决定，不重放。运行时Node v24.14.1 / Undici7.24.4的默认headersTimeout=300000，QA换用单总时限原生HTTP，并真实转发SSE头/分块，测试覆盖迟到headers、未结束body、未知断连与预算拒绝。final31流式调查诊断三次HTTP200分别612.381/568.535/622.607秒，三次wire均24576；思考几乎耗尽输出，0业务候选，最终retryable_failed。旧调度层同预算重复3次的实际证据触发R40，不能把它称作有界候选修复，也不能称通过两请求合同；未改写其历史账本。该诊断在构建/后续修复前启动，执行身份仍绑定原文件，不升级为final33配额。

生产scope v3源码1d0e6778c600e7c788c0d5fbcd4ba8c0cc09eb4c2a2e9b930a2fd7318c9ec3a7；Debug APK 3f51242ac7a6f89580d378c85b829444c2d74afe0d524773726d42cc7f1eb31b，109474379 bytes，V1.0.0 / 1000000，emulator-5556实际安装hash一致。完整核心1065/1065、0失败0跳过（reaccept-core-final33b.log，34.325s），移动typecheck、41s Debug构建、版本与diff通过。新增23项回归，所有前置RED日志保留。

final33正式Android救援任务job-setup-world-src-7f45fe0b11ea30ec-muwccd51-muyb1p8u在约523秒、返回前台时转为outcome_unknown（Network request failed）；此前后台约58秒，进程26168存活、崩溃缓冲无异常。代理上游随后在565.527秒收到HTTP200/5026703 bytes，晚于客户端失败，不能据此认定上游超时或固定原生读取时限；RN默认读取/调用时限为0。具体原生断连原因尚未证明，规划缺少Android执行生命周期保护，作为下一修复点。原意图、冻结high/stream/32768/物理额度2及1次账本保留，0候选/0决定，禁止未知重放。此前未知任务也未重发；独立opening_goal 1次单列，共享预算1168/1500，无重置/增额。证据final33-background-failure-proof.json、final33-background-events.log和final33-j1-after-background.json；当前代理18691、原库与AVD保留，尚未最终清理配置。

完整目标继续执行，阶段整体仍未通过；A01–A40维持29 PASS / 2 FAIL / 9 NOT RUN。新身份未完成J1/J2/J3各20及同基点双分支各10，没有把请求、管理、采用或旧身份诊断计入80；两项隔两次决定的持续后果、三计划及对应旅程六维全部≥3仍待实测。

证据：.tmp/phase9/reaccept-identity-final33.json、reaccept-device/identity.json、final30-host-J2/J3、final31-high-diagnostic-proof.json、final33-targeted.log、final33-budget-expanded.log、reaccept-core-final33b.log、reaccept-device/final32-profile-proof.json及final32-preset-explicit-ceiling.png、final33-j1-goal.json/.png、final33-j1-status.json。

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

R44 已落生产，增量合并目录闭包及Android旧问题自恢复复现通过；R45 线索作者、采用、规则、重规划和存档贯通，9项核心回归通过，真实端上消费待验；R46 修正原生/JS数据库分歧，实际继续构建清除旧取消标志并运行。三意图真实规划仍运行，P9-7未完成。

身份、回归、实际复现与运行中请求详情见 [FINAL_REPORT](FINAL_REPORT.md)。完整阶段仍未验收通过。

final37 真实规划终态补录：J2/J3自动候选ready并采用，分别8/3条合法战役线索；Android J1第二次38036仍length。全部至多两HTTP，预算1188/1500，原未知任务和设备已采用归档保持。0新玩家决定，内容质量与完整长旅程仍未通过。移动世界书及已知面板的线索回看缺口待下一批修复。终态、用量、后台清理和保护证据见 [FINAL_REPORT](FINAL_REPORT.md)。

## 2026-10-08 final38：共用思考用量反馈（R48）

原弹性输入分配与 wire 上限扩容已经参与生产请求，但历史用量统计没有接入材料冻结。final37 的 J1 第一次 wire=24576、思考24521，恢复只给观测下界5%余量，第二次 wire=38036、思考32422，完整正文再次截断。65536 是配置允许上限，并不等于每次实际请求额度；本地思考预留也不等于服务端对思考的独立硬上限。

R48 在共用账本端口增加受信终态观测读取，按原 modelProfileFingerprint、档位和 requestKind 精确匹配。unknown、未完成、估算、非法用量、外来配置/角色及其它失败类型在窗口选择之前排除。完整响应用于最多32个样本的统计，满8个才做 P95×1.25 校准；不足8个的真实完整用量仍形成额外保守预留。length/reasoning_only 是下界，单独使用×1.5余量，不冒充完整 P95。

LedgeredProvider 与 RateScheduledProvider 共用本地反馈读取，读取本身不派发 HTTP。战役候选、实际游玩的 Planner/Narrator、记忆 checkpoint/repair 在新材料根冻结时选定各自反馈；恢复使用已有根，不查询新历史、不回写旧根。记忆冻结只在原根缺失时执行准备回调。战役与记忆恢复共用观测下界扩容计算，原两次战役物理请求总额及 outcome_unknown 禁止重发仍生效；战役恢复若不能增加 wire，则停止无效重试。已证明的思考下界连最小正文都无法容纳时在 HTTP 前明确拒绝。策略版本为 reasoning-policy-2。其它已有冻结构建配置保留原协议；世界构建等未接入新反馈的调用者不宣称已经完成同等历史校准。

新增11项有意义回归：窗口/作用域/可信用量过滤、下界不污染 P95、小样本反馈、低能力请求派发前拒绝、恢复余量、记忆冻结恢复不读历史、实际玩家回合分别冻结 Planner/Narrator、战役新任务历史接入、65536能力下扩大恢复、恢复不追随后来历史，以及不可行历史0 HTTP。完整核心1108/1108、0失败0跳过，32.115秒；移动typecheck、verify:version和diff检查通过。首次完整回归1106/1107仅失败于 progressive-opening 的策略版本旧断言，更新为新版本后完整重跑通过，保留原日志。

final38 identity scope v3 源码 dd3af146d49f6f687d2318c66c8a9768b2e25278cbabd4913796c3fbaeaae4d7；APK 325170fbca969a2741c372bd8a802520f50e7205aed89addb82329acb49fb591，V1.0.0/1000000，构建55秒，emulator-5556实际安装hash一致。保留数据库安装前后，全部采用规划、战役归档、快照和两个旧 outcome_unknown 任务/冻结根/账本内容精确相同，0隐式HTTP。随后通过正式界面取消已耗尽两次预算的 final37 已知失败任务，旧冻结根和两条尝试精确保留，没有重发旧请求。

Android 使用相同完整救援意图、序7/边陲镇、原创体魄3/交涉3、运动/交涉/坚韧、无同伴、long、glm-5.3-flash/high/65536，新建任务 job-setup-world-src-7f45fe0b11ea30ec-muwccd51-muz39git。新冻结反馈 exhausted=[32422,24521]；首次实际派发账本 wire=60921、reserve=48633，完整正文预留12288，原请求总额2保持。预算1188→1190（独立 opening_goal 1次＋新 J1 1次），未重置/增额。此处只确认历史反馈与实际派发预算生效；模型响应及候选质量尚在等待，0决定，不能将其写为三意图/长旅程或阶段整体验收通过。

证据：.tmp/phase9/r48-target.log、r48-core.log、r48-core-b.log、r48-mobile.log、final38-apk.log、reaccept-identity-final38.json、reaccept-device/final38-install-preservation.json、final38-old-known-preserved.json、final38-j1-start.json、final38-first-dispatch.json、final38-before-plan.png、final38-planning.png。私有原文/数据库/模型内容保持在忽略目录。R47线索正文重读、神罚之锁审查、完整长旅程、延迟后果和三意图质量等仍待验收。

final38 真实终态补录：2026-10-08 06:50:15 UTC只读复验，J1已 candidate_ready，仅1次 succeeded。实际 wire60921、思考34973、总输出43763（正文8790）、输入8661，可信原始用量，账本耗时777.290秒；无恢复请求。成功账本 http_status 仍为null，上游200另由代理日志确认。两项后台服务均已退出、crash buffer为空，准确释放时刻未采样。全部采用计划/归档/快照及2个旧未知任务、冻结根、attempt保持一致，预算1190/1500。仍未采用该候选、0新玩家决定；这一结果仅确认预算修复与完整候选通过，不能代替内容评分、长旅程或阶段验收。证据：.tmp/phase9/final38-status.jsonl、reaccept-device/final38-status.sqlite、final38-ready-job.json、proxy-final34.log。

## 2026-10-08 final39–final40：共用目录与线索正文回看（R47）

规则、回合引导、场景冲突选项、移动知识/NPC与世界书现在共用 loadCampaignContentCatalog：锁定基础包→当前快照的世界增量/段工件→经过所有者、正文hash、组合hash和依赖闭包验证的战役归档。可选旧世界manifest缺省时仍合成已采用的战役内容；绑定段工件却缺少owner时明确拒绝。共用层只读目录，世界构建审查可继续读取它原有的包；发布资格及玩家可见性保留在相应入口。不会授予知识、覆盖世界包、改变已采用归档或取最新战役版本。

玩家知识页只向当前玩家已经发现的public/discoverable lore提供可选正文，保留来源及获得版本；GM正文、非lore文本与其它角色发现记录不公开。已知战役线索获得独立玩家手册分节，未知线索和无关联战役的库视图保持隐藏，编辑模式仍只编辑世界资料。端上进一步发现完整规则说明在滚动区外把正文挤出屏幕：说明、提示、书籍选择与正文现处同一滚动区，模式切换保留在固定区域；不用设备高度常数裁剪文字。

新增6项回归覆盖真实采用/提交后两种移动读取、未发现兄弟分支和世界库隔离、旧manifest缺省、归档破坏时拒绝而非回退、GM/非lore/角色归属，以及实际段owner与战役归档共同合成。原三项RED-C明确复现正文/目录缺失；目标29/29通过，完整核心1114/1114、0失败0跳过、38.783秒。首轮全量1107/1111的4项失败来自读取层提前访问只读夹具未提供的hashProvider，以及段目录夹具缺sections；hash操作保持按需调用、夹具补齐正式目录协议后完整重跑。目标B的正文权限用例另纠正夹具玩家ID后通过，原日志保留。移动类型、Debug构建、verify:version与diff通过。

final39生产源码 56a096036113c958db4815d2226cac8c3baeff5fbc016956cc8beebea2de109c，APK 2c62f3e40f1cbd5c33297397e3fb8b29dd577cf8849033314dac165621d59a5b，构建41秒，实际保留安装hash一致。正式UI采纳final38完整救援候选（5阶段/5线索）：第1决定自然掷出3、2、1，保留大失败、关系损失与250分钟时间推进；第2决定接触安娜成功，v2真实获得证词。知识页从v0空白到v2显示精确归档正文、他人告知和获得版本。两回合Planner/Narrator均可信succeeded，共4物理请求；账本模型耗时分别32.564+56.613秒、34.622+67.130秒。初次路径在异步建议更新后提示重选，未提交或重复计费。该计划生成于final38，两个决定执行于final39，作为边界诊断，不拼入final40整套80决定。

final40生产源码 5975f3a300edb32166c18e03482d29c8aaf56b36d5099dfa832c119c7183ac01，APK 4f20ff8c8bf6bc8675fa531543aca4e122fc1241e3f99b88586b34149adee3bb，构建35秒，实际安装hash一致；对照final39只有WorldBooksPanel滚动布局和生成版本元数据改变，核心源文件hash逐项相同，1114项核心证据沿用，移动类型检查再次通过。同库同战役v2正式“书库→进入项目→三宝书”重放：存在可滚动区域，玩家手册“战役线索”仅1项，已获得正文与归档逐字相同且整段位于可见滚动边界内。07:14:54 UTC只读复验，全部原已采用规划/归档/快照及2个旧未知任务/冻结/attempt逐值保持，crash buffer为空；新追加记录单独登记。两次安装均0隐式HTTP，没有清库或重放未知。

final39隔离主机新规划也确认预算历史反馈：J2首次wire49055=reserve36767+12288、完整响应思考27000/总输出33943，合同修复第二次同wire、思考10289/总输出17565，最终正式采用；J3首次wire49530=37242+12288、思考25383/总输出33413，一次正式采用。它们分别2/1次HTTP，无预算截断或第三次请求，0玩家决定；J2第二次是本地合同错误反馈修复，不能称作同预算无效重试。主机端点/引用不同，不用于Android匹配性能对照。

截至07:14:54 UTC预算1200/1500，未重置/增额；final40同完整目标的J2/J3新规划已在隔离副本启动、尚未终态，没有覆盖final39历史。后续同身份长旅程、两项隔至少两次决定的持续后果、三计划/对应旅程六维质量、A02/A03/A06/A12、10+10性能及神罚之锁审查仍未闭合，独立试玩未验。A01–A40维持29 PASS/2 FAIL/9 NOT RUN/0 BLOCKED，第九阶段整体尚未验收通过。

证据：.tmp/phase9/r47-red-c.log、r47-target-b/c.log、r47-core-a/b.log、r47-mobile-b/c.log、final39/final40-apk.log、reaccept-identity-final39/final40.json、reaccept-device/final39/final40-install-preservation.json、final39-knowledge-before/known.png、final39-book-scroll-blocked.png、final40-book-known.png/xml/proof.json、final39/final40-device-audit.jsonl、final39-host-J2/J3/status.jsonl与proposal.json，final40-host-J2/J3。私有原文/数据库/模型内容仅在忽略目录。只做本地提交，未推送/发布。

## 2026-10-08 R49：映射拒绝与发布事实审查交接（final41/42）

世界映射过去把 block_action/block_effect 提案降成 audit，但审查只能关闭提示，不能排除提案，且记忆策略仅绑定诊断字符串。现在未能执行的限制不进入编译目录；正式“拒绝这条规则”决定绑定世界、来源hash、完整原提案与引用事实/原文快照，复用现有处理策略表，不增加/重置数据库。普通解决/豁免不能代替拒绝；提交时校验界面所见完整内容及当前证据，过期/跨世界/改变正文或事实状态均重新审查。相同提案续建只复用付费checkpoint；原提案、原文、旧发布版本及战役归档不被改写。Mapper原提示/付费缓存身份保持兼容。

真实端上另发现M5来源范围包含M4选取之外的冲突：发布器只抛 canon_conflict_in_scope，界面却没有冲突卡片。M5现通过同一事实审查owner保存实际阻滞的factIds，检查当前冲突状态和执行fence；最终发布事务中新出现的冲突也同样送审。协调器据明确Canon blocking conflict进入needs_review，而不是空队列的package_finalize_failed。旧来源/正文与冲突记录保留，审查仍逐条查看证据；没有增加自动豁免。

新增4项映射拒绝回归及2项M5事实审查回归，并扩展发布事务竞态用例。映射RED为0/4；M5目标RED为7/10，三处缺失审查/错误状态得到复现。目标19/19及发布18/18通过。完整第一段1118/1118；追加M5后首次1119/1120，唯一失败是旧纯模拟worldStore未实现新增saveReviewIssue合同，补齐且断言被送审事实后完整1120/1120、0失败0跳过、32.850秒。移动类型检查、Debug构建、版本一致性和diff均通过。

final41正式UI重编译原缓存并拒绝“神罚之锁的压制”，请求账本保持237条、预算1200/1500，事实/原文/旧包/战役档案与快照逐值一致；发布仍被独立事实范围冲突阻止，保留该失败。final42生产源码 8c8a77962ee1451c600b9f9017460f5c541df9eaa37e89d0321038fd0f8190cc，APK d12414460a3658e50b3922b1ed21de820ed2951be2522588b86f7b6d184b214f，构建41秒，同一emulator-5556保留安装hash一致；2个旧未知任务/冻结/attempt、全部旧采用档案及快照一致、安装0隐式请求。

final42复验中M5正式产生审查入口。通过真实UI与引用原文逐条确认罗兰“四王子”身份称谓、巴罗夫任职经历补充、罗兰工坊计划与其它计划可同时成立；三条状态由conflict改为explicit并分别产生complementary审计。事实其它字段、原文引文及既有explicit行完整保留，不是整体豁免。变化后的选取输入正确发起一次新的world_mapping，可信succeeded：wire10096、推理28、总输出8057、输入27772，107.242秒，0截断。既有冻结构建配置仍是low/直连端点；该新增attempt单独以持久幂等登记纳入共享QA预算，1201/1500，未改档或提高预算上限。

新完整映射产生两个新的未能执行限制（首席骑士护主、神罚之锁），它们没有借用旧诊断/旧拒绝决定，均经新卡片逐条拒绝。旧付费结果、原文、已发布基础r1、战役归档/快照保持；三条事实状态变更由独立审计解释。尚有situation-sit-witch-verdict地点依赖：模型引用规范地点实体ID，场景定义使用地点名，当前编译器未把两种规范标识连到同一已证明场景，局面未进入新段工件。新段仍未发布；下一步修复地点交接后重编译，不能以队列清空或规则拒绝宣称出版成功。

final40隔离主机J2/J3均终止为outcome_unknown，各1次请求，reasoning/output均缺少可信用量，不属于已证明的预算耗尽。账本耗时分别731.609/92.693秒，而错误显示900秒，连接/超时分类待定位；旧请求及冻结材料保留，未重发。它们没有候选或玩家决定，不能代替final39已采用规划或计入最终80决定。A01–A40仍29 PASS/2 FAIL/9 NOT RUN/0 BLOCKED；同最终身份旅程、持续后果、三意图质量、A02/A03/A06/A12、10+10性能及独立试玩尚未闭合，第九阶段整体未验收通过。

证据：.tmp/phase9/r49-red-a.log、r49-target-a/b/c.log、r49-publication-red.log、r49-publication-target-b.log、r49-core-a/b/c.log、r49-mobile-a/b/c.log、final41/final42-apk.log、reaccept-identity-final41/final42.json、reaccept-device/final41/final42-install-preservation.json、final41-constraint-review/rejected.png、final42-canon-review/resolved.png、final41/final42-world-proof.jsonl、final40-host-J2/J3/status.jsonl；原文/数据库/模型原响应仍仅在忽略目录。本地提交，未推送或发布。

## 2026-10-08 R50：地点实体、场景与运行坐标交接（final43）

原映射局面可能使用规范地点实体ID，而已证明场景和角色快照使用中文地点名；依赖检查只认地点名，因此拒绝合法局面。actor_at条件还要求地点满足英文ID格式，与实际运行坐标冲突。新增共享地点解析：以实际目录中的scene为唯一证明，将地点实体ID、场景条目ID和运行地点名归到同一坐标及真实scene依赖；并遍历激活/知识/可见条件的all/any/not、actorAt要求、移动目的地和参考事件条件。未知实体、非scene条目、无实际场景支持和同名异坐标均保持拒绝；同坐标多个场景版本保留完整依赖集合。只处理类型化地点字段，不替换人物ID或叙述、不修改原提案/旧档案。actor_at接受实际非空中文坐标，仍校验人物稳定ID和条件AST。

新增8项回归，首次4项目标RED为0/4；统一运行坐标合同后44/44通过，核心1128/1128、0失败0跳过、39.232秒。移动类型检查、Debug构建44秒、版本一致性和diff检查通过。final43生产源码905a2d844363746350474bddd8dbb10cb133dd5adc1834dcd6065ef30c76773f，APK afd3108e02f00c6530b203acbb7dbdf277b5cd3ed1430bae5e502fa810cc955e，保留安装与实际APK hash相符；原文、canon事实/事件/实体、旧世界包、旧segment工件、已采用计划/战役工件/快照和旧付费映射均逐值保留。2个旧未知任务及其冻结材料/attempt未被重发。

端上“继续构建”生成第三个资料段：实际局面situation-sit-witch-trial从规范城堡实体ID解析到“城堡”，绑定真实scene依赖并经M5正式发布。真实world_mapping仅1次、可信succeeded，wire10096、推理56、总输出5656、输入40725、73.540秒，没有预算截断。既有冻结配置仍low/直连，新增attempt以持久幂等登记计入共享预算1202/1500，上限未变化。项目显示已就绪3段、正在准备0段。

补充上一轮时点：6400–9600段在final42最后取证之后已完成发布，但因当时地点编译缺陷未包含situation-sit-witch-verdict；其major审查仍开放。该工件属于final42，不能算作final43同案修复。final43的新局面证明正确编译/发布链路，不能证明已发布旧缺项被补回。已发布工件不可改写，原paid proposal保留；下一步需正式补充发布/重编译入口及内容质量复核。旧局面GM备注还引用被拒绝规则，不能仅消除地点告警便断言内容质量合格。

整体验收仍29 PASS/2 FAIL/9 NOT RUN/0 BLOCKED；最终同身份80个有意义决定、持续后果、三意图质量、A02/A03/A06/A12、10+10性能及独立试玩继续推进。final40 J2/J3未知结局保留，连接提前中断误报900秒超时正在修复，不能归类为已证明预算耗尽。

证据：.tmp/phase9/r50-location-red.log、r50-location-target-a/b.log、r50-core-a.log、r50-mobile-a.log、final43-apk.log、reaccept-identity-final43.json、reaccept-device/final43-install-preservation.json、final43-world-proof.jsonl、final43-location-publication-proof.json。原文、数据库、响应与密钥只保留在忽略目录；本地提交，不推送或发布。

## 2026-10-08 R51：真实到期、提前断连与响应完整性（final44–46）

final40 J2/J3在731.609/92.693秒断连却显示900秒；根因是provider把AbortError/aborted一概解释为整个配置时限已到，并错误提示增加模型思考时间。引入传输层实际定时器到期标记HttpRequestTimeoutError，移动fetch和QA完整请求传输共用该合同。只有实际到期才显示对应时限；提前响应abort/reset为network_unknown，普通ETIMEDOUT仍识别为超时但不虚构配置秒数。移动定时器覆盖完整body，逾时后迟到的响应不升级为可信完成，finally释放原生执行保护。QA传输到期先保存明确标记，再销毁连接，避免后续aborted抢先改变原因；完成或失败均清理定时器。

模拟器受控断连又暴露外层完整性缺口：final44/45会把不完整响应送到“非JSON”解析失败路径。provider现在将200空白/未闭合JSON外层以及缺终止帧SSE统一标记结果未知；不抢救嵌套正文/usage，不将其学习为reasoning-only/length，不自动重发。完整但非法JSON与正常业务length仍保持原有独立分类和可信usage。新增7项回归，覆盖真实deadline/提前abort、早断后的账本禁止重发、原生保护释放、迟到body、QA头部后deadline和早断、空/未闭合外层、完整非法外层。目标50/50；最终核心1135/1135、0失败0跳过、37.297秒。中间完整1134/1135唯一失败是既有SSE用例断言旧英文提示；更新为新中文提示并加断言network_unknown/无可信output后再次完整通过。移动类型、Debug APK、版本和diff检查通过。

final46源码fa8deb4310641c2badce24bb20322a5dbb433aeb828c33f2a4cab81916df3315，APK 632dcf303c9d0f93fbe5206e48d112e0d9f78455d89df6864d8d322437b8de80，构建38秒。保留安装与实际APK hash相符，2个旧结果未知任务及其冻结/attempt、原文/canon、旧包与segment、旧采用计划/战役工件/快照均保留，安装0隐式请求。真实端上使用正式设置页的未保存表单端点做同一受控部分响应断连：final46明确显示“网络连接失败”，一次接收、0上游模型发送、没有自动再发；崩溃缓存为空。故障服务器已停止，表单恢复正常端点，已保存profile/高档/65536上限/Keychain keyRef未修改。此项是受控故障回归，不能计作真实自动规划、玩家决定或完整旅程。

本轮严格共享预算1202→1206/1500：3次受控故障HTTP也保守预留，0付费上游；另有1次实际模型连接测试成功（端上约4.039秒，上游代理3.074秒）。这次真实测试来自第一次输入尚未聚焦时未及时停止后续操作，原样记录，不冒充受控故障；输入工具现要求正确字段focus、instrumentation textMatches和fresh UI精确文本全部通过后才允许测试。无预算上限提高、重置或历史unknown重发，旧final40错误记录保留且不改写。

项目弹性预算与连接失败分开：R48的可信同档历史与censored下界仍供新冻结任务使用，旧冻结不改档；R51防止把无完整结果的网络失败误当成预算耗尽或记为可自动重试的普通失败。整体验收仍29 PASS/2 FAIL/9 NOT RUN/0 BLOCKED。旧已发布段缺项/GM备注审查、最终同身份80决定、持续后果、三意图质量、A02/A03/A06/A12、10+10性能和独立试玩继续收尾。

证据：.tmp/phase9/r51-deadline-red.log、r51-envelope-red.log、r51-target-a/b/c.log、r51-core-a/b/c/d.log、r51-mobile-a/b/c.log、final44/45/46-apk.log、reaccept-identity-final46.json、reaccept-device/final46-install-preservation.json、final46-device-audit.jsonl、final46-world-proof.jsonl、final44/45/46-disconnect-server.jsonl、final46-disconnect-ui-proof.json、final44-controlled-disconnect.png、final46-real-connection.png、final46-controlled-disconnect.png。受控服务器不保存headers/请求正文/凭据。真实原文/数据库/响应保持在忽略目录；仅本地提交。

## 2026-10-08 R52：缺失局面的正式审查、补充发布与拒绝（final47）

final47生产源码SHA-256：70a29a63e4c17c1320f2bb8c759aa6b19c0278bafc754643ca5825cad11fbfdd；Debug APK SHA-256：7466b354b91ce4acfb3338a1f352bf1bc49daf56c37f8f8168e8b1ea4ea5333b，V1.0.0 / 1000000，emulator-5556安装包hash一致。核心1142/1142、0失败0跳过（32.549s），移动类型检查、36s Debug构建通过。

架构收尾：初次映射与缓存局面恢复共用resolveSituationReferences，使用实际已发布场景、人物及内容目录验证依赖；SituationReviewService只读取done映射检查点，不请求模型。正式补充发布复用M5 SegmentPublicationService的来源引用、canon、不可变内容和事务门禁，在同一事务内生成新档案、关闭对应问题并保存审查决定。拒绝决定绑定完整原始提案、递归事实引用、原文证据及世界来源身份；M4重编译仅排除完全相同的已拒绝提案。证据或内容变化重新审查，重复/过期操作失败关闭；普通关闭或豁免不能代替局面决定。旧世界包、已采用战役和历史快照不重写。

7项新增SQLite/生产服务回归：正式M5补充发布及安全边界采用、实际场景依赖闭合、已显示证据/提案/来源/目录变更、写入审查决定失败后的整笔回滚、最终事务的并发证据/检查点变更、拒绝内容精确绑定、已付费检查点重编译零新增模型请求。复用既有publication fixture；模拟模型/RNG夹具不计真实旅程配额。

Android实案：审查页实际展示“推迟的绞刑裁决”的GM说明、3个方法及8条引用证据，可滚动触达补充发布/拒绝/刷新。当前依赖及结构发布验证已通过，但原提案整体标注explicit，GM说明和方法取舍仍包含“神罚之锁压制能力”的约束推断，8条引用均没有支持该压制主张。因此通过正式UI拒绝整份提案，保存完整证据绑定决定；没有盲目恢复或只豁免提示。原situation_dangling_reference已resolved，审计decision明确为rejected；没有新增/恢复该局面档案。冷启动再次进入审查为0项。

只读前后核对：全部canon事实/来源/实体/事件、paid world_jobs、3份原segment artifacts、world packages、已采用campaign plans/artifacts、所有历史snapshots、冻结根及239条请求账本逐项保持原样。新增模型请求0，共享预算仍1206/1500；没有重置、增额或重发旧outcome_unknown。正式干净局面的补充发布及采用已由SQLite生产服务验证，Android本轮实案只验证拒绝，不能称Android已完成旧局面恢复。

证据：.tmp/phase9/r52-core.log、r52-apk47.log、reaccept-identity-final47.json；reaccept-device/final47-install-preservation.json、final47-situation-preflight.json、final47-situation-proof.jsonl、final47-situation-proposal.png、final47-situation-evidence.png、final47-situation-rejected.png、final47-situation-cold-review.png；final47-device-audit.jsonl、final47-world-proof.jsonl。小说正文、数据库与原始模型结果仅保留在忽略目录，不提交。

整体验收仍未通过，A01–A40维持29 PASS / 2 FAIL / 9 NOT RUN / 0 BLOCKED。本轮新增有效玩家决定0；同最终身份完整旅程、持续后果、三计划及对应旅程质量评分、真实救援、模板外组合、按需补建、同设备10+10性能对照和独立试玩继续推进。审查队列清空不等于可玩性已完整验收。

## 2026-10-08 R53：冻结上限下的跨恢复预算防重复（final48）

final48生产源码SHA-256：2ebb79fa93b21f6d07edc1d9993dbdd1043881dc60d1846e37095b3b31a0f8d7；APK SHA-256：848e56de98c2010ed0cf3b1367f98cee374e97e67b6209987023410c66d02715，V1.0.0 / 1000000，emulator-5556实际安装hash一致。核心1144/1144、0失败0跳过（32.307s），移动类型检查、35s Debug构建、版本检查通过。

预算架构复核发现：同一次生成已拒绝不增大的截断重试，但手动/冷启动恢复没有比较上一条durable ledger的实际wire_output_tokens，可能在原冻结材料和模型上限内再发完全相同的预算。RED SQLite实案复现：首条length在32768上限终止，恢复又付费发送32768并得到模拟candidate_ready；该候选不是真实验收内容。修复将上一条已知length/reasoning_only的wire预算传入opening/replan共用generationService，在调度/派发前统一检查恢复预算必须严格增加。不能增加时返回typed BudgetInfeasibleError及明确中文原因；缺少可信旧wire记录也零派发，不猜测旧上限。原冻结材料、思考档位、能力声明及已付费记录不改写；已经完整收到正文的结构修复保留同预算权限，未知结果仍禁止重放。

2项新增回归验证32768→32768恢复零新增HTTP/账本、连续恢复仍零请求、缺失wire记录失败关闭；既有24576→32768、24576→49152恢复、完整正文的同预算修复、未知不重发及两次总额度回归仍通过。此比较针对原材料不变的战役规划/重规划，不能外推到允许缩小可选上下文的所有业务。

Android final48安装与冷启动后，R52证据绑定拒绝仍保持、审查0项，3份资料、canon、全部原付费检查点、已采用战役/历史快照及2个旧outcome_unknown原样保留；新增模型请求0，预算仍1206/1500。原生数据库没有可用的retryable_failed上限截断任务，因此本轮没有Android同案的32768截断恢复实测；该修复的零派发结论来自生产SQLite服务回归，不用模拟器冷启动冒充同案通过。接续真实新任务将绑定final48，旧身份有效决定不拼接。

在核对原代理PID21380、命令行及18691无活跃连接后，停止空闲旧进程，使用最新phase9-http重启同端口QA代理；没有中断或重发请求，设备保存的high/1M/65536/streaming配置和Keychain引用保留。证据：.tmp/phase9/r53-red.log、r53-core.log、r53-apk48.log、reaccept-identity-final48.json；reaccept-device/final48-install-preservation.json、final48-profile-proof.json、final48-review-still-resolved.png、proxy-final48.log；final48-device-audit.jsonl、final48-world-proof.jsonl。

阶段整体仍未验收通过，A01–A40仍29 PASS / 2 FAIL / 9 NOT RUN / 0 BLOCKED；本轮新增有效玩家决定0。弹性分配与可信使用反馈在模型声明上限以内生效，不能绕过硬上限；无增益恢复不再反复耗费请求。完整旅程、持久后果、质量评分及性能对照继续推进。
