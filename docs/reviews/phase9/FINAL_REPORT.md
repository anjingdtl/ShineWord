# Phase 9 接手收尾复验报告

2026-10-08，Asia/Shanghai。final48预算恢复防重复通过1144项核心测试，Android保留正式审查决定并完成安装/冷启动复核；**第九阶段整体尚未验收通过**。A01–A40：29 PASS / 2 FAIL / 9 NOT RUN / 0 BLOCKED；旧局面已通过正式证据审查拒绝，完整旅程及质量/性能继续推进。

| final29已提交检查点 | 历史结果（最新见final33） |
|---|---|
| 接手及前次提交 | 接手HEAD 5a6e07712176fbba1b780bc21ead2d8cfa1aa1e4；final21批次已提交eb48daeb835b0a0939b9f41fe0526261bb24ba1a。按用户授权继续推进R28–R36并纳入本次本地提交，提交ID见Git历史；未推送或发布 |
| 生产源码SHA-256 | 53629ccff12efc738bf7e6f85c8f72bc0562241a19a3ba34aacfbd2837d9b254，identity scope v3，含生产移动/原生/构建输入及实际打包version.json；不是Git提交SHA |
| Debug APK | dist/apk/debug/ShineWord-V1.0.0-debug.apk，109462083 bytes，V1.0.0 / 1000000 |
| APK SHA-256 | 1b8eb52f182fe02bb6ec7fd2218cb9260b8984cc32410060041868e2109c801f，emulator-5556实际安装包hash一致 |
| 设备 | AVD ShineWord_P8_Reacceptance / emulator-5556 / API37；保留原数据库、分支与历史安装 |
| 完整核心 | verify:core 1042/1042，0失败0跳过，36.604s；.tmp/phase9/reaccept-core-final29.log |
| 移动/构建 | 移动typecheck通过，Debug APK构建35s；reaccept-mobile-final29.log / reaccept-apk-final29.log |
| 版本/diff | verify:version及git diff --check通过；reaccept-version-final29.log / reaccept-diff-final29.log |
| 持久共享预算 | 1161/1500，余339；从1055/1100继续计账，增额在续跑前公告；历史起始313含估计，不称全历史精确账 |

先核对M0–M9权威和模块交接，再修共用边界，完整过程见FLOW_REVIEW。既有R22–R27解决普通成功来源、冻结字段、未知传输、计数审计、主阶段指针及完整归档/可用行动生命周期；已在eb48dae归档。本批没有通过改设备SQLite、强制骰点、补写模型响应或修改已采用归档来制造通过。

本批修复与实际触发证据：

- R28/R29贯通作者准备条件、严格编译、引用范围、现态事实、资格与指引；普通完成供给考虑准备→履约及局面关闭边界，不能关闭后反复交谈凑关系或计数。生产Session回归包含三次分开的准备/履约/交付。
- R30/R35在新候选入口检查结局顺序：前序成功、后续未完成或没有失败不能自动剥夺后续必做目标的推进机会；实际损失、取消、合法替代、optional和retired保留。原final23早结局及final27合作工件离线被识别，原档不变。
- R31/R33使生成提示与解析共用准备字段/长度合同，误放AST明确要求完整包入requires.condition，越界tone精确反馈；一次修复、最多两物理请求，保留意图与原响应。
- R32统一规划、编译和资格中的已知人物模板/NPC别名与有向关系。实际材料允许的罗兰目标不再被另一个模块误拒，未知目标仍拒绝。
- R34将冻结旧局面承诺、计数和状态纳入普通完成必要门；已fulfilled可沿用，已知尚未满足且有本地producer不能只靠大成功兑现。生产重规划两请求修复后实际普通成功履约通过。
- R36使首次生成、冷启动与显式恢复共用PreparationView和持久任务分类。真实outcome_unknown恢复仍显示“云端结果未知”，说明可能已计费且恢复不重发，不再误显示校验失败。

这些门是必要结构校验和模块合同，不是完整条件求解或内容质量保证。新增25项核心回归；原final26构建并行时的短租约失败以及final29首轮新夹具重复candidate ID失败日志保留。前者单项与串行全量通过，后者只修夹具后全量1042通过，未删用例、放宽生产门禁或租约。

commit后真实复验的结果分别绑定各自源码/APK，详见REAL_JOURNEYS与CONTENT_QUALITY：final23救援4项可评估决定后错误早结局；final25调查5项后自然结束；final27调查7项后新候选末端节点缺少结局引用而invalid，合作11提交仅5项可评估进展（门槛后6次无新事实/机会的额外数字排除）。没有将自然结束后行动、管理、采用、轮询、重试或机械重复计入有效配额。

final28实际high配置的J1 Android与J2/J3生产主机各派发一次开局规划，均在300秒后outcome_unknown；没有修复、重发或玩家决定。结果说明该配置下本次规划未在时限内完成，不能推断内容改善、匹配性能差异或上游未计费。主机/设备输出设置、端点地址不同，历史low也不是10+10性能对照。

final29在原J1任务job-setup-world-src-7f45fe0b11ea30ec-muwccd51-muy7o2nc上保留数据安装，冷启动与显式恢复均保留原完整意图/任务，campaign_plan仍仅1次未知请求；手动恢复零重发。冷启动独立opening_goal有1次真实请求，单独计账，预算1160→1161，不能称整次冷启动零HTTP。360/411dp、fontScale2实际截图显示完整提示可读、恢复/取消可滚动触达；旧四主题/键盘矩阵保留final14身份，不改写历史截图。证据reaccept-device/final29-j1-cold-restore.json、final29-j1-explicit-restore.json、final29-recovery-display.json。

final29另在原camp-muxpraio-main v33（ending-pardon/改判之约）复验结束主线卡、完成阶段、最终叙事和campaign_ending事件，旧战役办法退出、世界探索保留。snapshot/runtime/全部归档hash、旧承诺和v37分叉均不变，新增0玩家决定/0HTTP。结局实际只取得代安娜发言资格，不宣称她已获救或改写原著死亡。证据final29-ending-reacceptance.json及同前缀三张结局截图；final20失败截图与final21证明仍留存。

final29实际新旅程有效决定配额为0；此前各段是诊断，不能拼成最终同身份80。100/300/1000生产Session/SQLite本地累积已通过：snapshot5128/5129/5133 bytes，runtime1414/1414/1415，结构1412恒定、jobs1；约0.912/2.395/5.871ms。LLM/RNG为确定性边界，范围是已准备局面，不外推无限重规划或真实模型性能。

仍需完成：最终同身份J1/J2/J3各20、J4-A/B各10有效决定，以及必需Android J1 UI20和J4 UI10；两个隔至少两次有意义决定仍影响人物/办法的持续后果；自动三意图计划及对应旅程六维全部≥3。原著角色换起点、后段按需补建、真实救援后持续存活、模板外能力组合、同设备/模型/范围10基线+10新回合耗时对照及独立试玩均未齐。A15/A36仍FAIL，A19/A38仍NOT RUN。

清理已经正式模型配置UI恢复真实GLM端点及原low强度；只读对比确认Keychain引用逐值保持不变，未重新输入密钥。核对PID19864、命令行及18691监听所有者后停止本轮QA代理。字体1.0、密度420、物理1080×2400、Gboard保留，配置保存后force-stop App；原模拟器/数据库/未知任务保留，没有卸载、清数据或覆盖设备SQLite。证据reaccept-device/final29-cleanup.json。


## 2026-10-08 final33：长规划的传输、租约和物理预算

生产scope v3源码1d0e6778c600e7c788c0d5fbcd4ba8c0cc09eb4c2a2e9b930a2fd7318c9ec3a7；Debug APK 3f51242ac7a6f89580d378c85b829444c2d74afe0d524773726d42cc7f1eb31b，109474379 bytes，V1.0.0 / 1000000，emulator-5556实际安装hash一致。完整核心1065/1065、0失败0跳过（reaccept-core-final33b.log，34.325s），移动typecheck、41s Debug构建、版本与diff通过。新增23项回归，所有前置RED日志保留。

R37：opening/replan共用candidateJob，以owner+fence CAS续租覆盖排队、请求及修复；取消/接管/续租失败后不发布，已收到业务原文仍可持久化。R38：共用provider按冻结kind/tier给high规划900秒、max1200秒等待上限（不是吞吐预测）；支持streaming的高强度规划接收SSE，完整结束标记与finish_reason齐备才返回业务正文，思考绝不回填正文，断流保持未知且不重发；流式能力纳入profile身份，旧buffered指纹兼容。R39：GLM预设声明流式支持，高级设置、预算预览和store共用显式能力上限；设备正式UI保存后仍为1M/32768，content16384、high、Keychain引用未变。R40：生成、调度和ledger共用最多2物理请求，单次dispatch的maxPhysicalRequests=1；仅已知reasoning_only允许一次内核1.5倍预留重规划，仍保留档位/材料/模型声明上限。思考恢复与结构修复共享额度，未知不重试；重启消费原冻结根和剩余额度，异常时physicalRequests按durable ledger实派次数报告。

final30诊断分别为J2 Node fetch约307.035秒断开、J3去除该隐藏响应头时限后约329.597秒上游socket hang up；各1次网络未知、0候选/0决定，不重放。运行时Node v24.14.1 / Undici7.24.4的默认headersTimeout=300000，QA换用单总时限原生HTTP，并真实转发SSE头/分块，测试覆盖迟到headers、未结束body、未知断连与预算拒绝。final31流式调查诊断三次HTTP200分别612.381/568.535/622.607秒，三次wire均24576；思考几乎耗尽输出，0业务候选，最终retryable_failed。旧调度层同预算重复3次的实际证据触发R40，不能把它称作有界候选修复，也不能称通过两请求合同；未改写其历史账本。该诊断在构建/后续修复前启动，执行身份仍绑定原文件，不升级为final33配额。

final33正式Android救援任务job-setup-world-src-7f45fe0b11ea30ec-muwccd51-muyb1p8u在约523秒、返回前台时转为outcome_unknown（Network request failed）；此前后台约58秒，进程26168存活、崩溃缓冲无异常。代理上游随后在565.527秒收到HTTP200/5026703 bytes，晚于客户端失败，不能据此认定上游超时或固定原生读取时限；RN默认读取/调用时限为0。具体原生断连原因尚未证明，规划缺少Android执行生命周期保护，作为下一修复点。原意图、冻结high/stream/32768/物理额度2及1次账本保留，0候选/0决定，禁止未知重放。此前未知任务也未重发；独立opening_goal 1次单列，共享预算1168/1500，无重置/增额。证据final33-background-failure-proof.json、final33-background-events.log和final33-j1-after-background.json；当前代理18691、原库与AVD保留，尚未最终清理配置。

完整目标继续执行，阶段整体仍未通过；A01–A40维持29 PASS / 2 FAIL / 9 NOT RUN。新身份未完成J1/J2/J3各20及同基点双分支各10，没有把请求、管理、采用或旧身份诊断计入80；两项隔两次决定的持续后果、三计划及对应旅程六维全部≥3仍待实测。

流式协议与GLM能力依据[官方SSE文档](https://docs.z.ai/guides/capabilities/streaming)和[GLM模型文档](https://docs.z.ai/guides/vlm/glm-5.3-flash)。流式有助于避免长时间无响应数据，是本次传输修复的设计推断；实际证据仅证明长响应能完整到达，未证明内容达标。32K模型声明继续冻结，不因文档最大能力自动增加。

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

R44：增量局面的依赖检验与最终发布共用合并目录，保留旧技能/物品/知识门；地点名称解析为实际场景 entryId，行动对象也进入依赖闭包。未知引用保持拒绝。在完整包校验及 fence 检查通过后，仅自动解决已经证明闭合的 situation-dangling 对应条目，不批量豁免其它审查。

R45：补齐方案 §7 的战役线索作者通道。可选 clues 只含最多8份受限资料正文、诚实出处与已有目录依赖；本地按 plan/revision/alias 生成独立 camp-clue ID。四档效果、条件、知识门和奖励共用严格别名解析；未定义引用仍拒绝。定义进入不可变战役归档，不授予角色知识。Session、重规划、投影和存档使用共同的快照绑定归档读取器，验证所有者、单档和组合 hash 及分支依赖；真正成功提交后才能获得并公开线索。旧缺省字段、冻结根和已采用归档不回写。真实 Android 生成、获得及后续消费仍待本轮旅程验证。

R46：final36 同路径复现发现，JS 打开 shineword-baseline-1791270204765.db，原生控制却固定写 shineword.db，UPDATE 影响0行仍回报成功。原生持久绑定经过路径校验的已打开数据库名，服务、通知、超时和 headless payload 携带该身份；控制以实际影响1行回报。JS 始终完成选定运行库的幂等控制写入，错误数据库的重投任务在查表或派发前停止。配置绑定失败仍有正式 SQL/前台执行回退。

final36 源码 c5937c94c52d30e99aeecd59e5ee92b68ca14d9f1a6e23b26c72999125a091f8，APK 60b343d245dd72cd44e4d8cda851dae0b25973012066b621d6b2eb75cd1a8842；1094/1094 核心通过，但 Android 继续构建未执行，不能将它记为 R44 端上通过。

final37 scope v3 生产源码 b808b6a10e21a456c7832b8cb33b83ba73b5c616aa7876ae61c9dc07d3fdcfc3；APK 111f2185c6c424379bd920c2ac568ebc4f66cc29dc058e20f3c98dcea469ab02，V1.0.0/1000000，emulator-5556 实际安装 hash 一致。完整核心1097/1097、0失败0跳过、32.954秒；移动 typecheck、36秒 Debug 构建、版本和 diff 通过。新增19项生产模块回归（增量7、线索9、数据库控制3）。控制目标首轮仅1项夹具误要求已消费的暂停标志保持1，改为检验 paused_user 状态后50/50通过；前置失败日志保留。

同一 Android 路径“进入项目→继续构建”已重放：原 run 的 cancel_requested 从1清为0，updated_at 推进至00:43:01.864 UTC，真实执行校验，安娜局面悬空引用自动 resolved，待审查由2项减为1项；无新HTTP，服务自动退出，crash buffer为空。世界整体发布仍 failed_retryable/package_finalize_failed，神罚之锁的无类型 block_effect 审查仍 open，不能称全部世界构建通过。该提案依据器物构造及关押事实推断压制效果，缺少已验证的可执行条件及生产者，尚未豁免或补造规则。

安装前后只读对照：原2个 outcome_unknown 任务、冻结根、attempt逐值一致，全部已采用计划/工件/快照hash一致，预算仍1181/1500，无隐式派发。final35 已知失败规划通过正式“取消这次规划”退出后，原意图、角色及锚点用于新的 final37 任务；旧未知任务不重放。

新测试配置经正式模型UI保存：glm-5.3-flash/high/stream、1M上下文、65536声明输出上限、content16384，原 Keychain 引用保留。旧冻结任务仍使用原32768，不追改。官方模型资料声明128K最大输出，但兼容端点实际支持以本轮HTTP为准，不能仅凭文档判定。

截至00:53:25 UTC，Android J1 救援、主机 J2 调查/J3 合作均 running；J2/J3 第一轮均已知 reasoning_only/HTTP200，第二轮分别实际 wire38025/38003，任务仍最多两次请求。Android自00:49:54 UTC观察到HOME，正在后台执行，尚未观察到终态。预算1181→1187/1500（独立opening_goal 1次、三规划当前5次）；这只是运行中检查点，0新玩家决定，无内容评分或完整旅程结论。主机与Android端点/配置引用不同，不作为匹配性能比较。

工程通过不替代内容与旅程验收；A01–A40仍29 PASS/2 FAIL/9 NOT RUN。J1/J2/J3各20、J4同基点双线各10、Android必需30决定、两项隔至少两决定的持续后果、三计划及对应旅程六维≥3、A02/A03/A06/A12与10+10匹配性能仍未齐。独立试玩未验。

证据：.tmp/phase9/reaccept-identity-final36/37.json、final36-core-with-clues-b.log、final37-core.log、final37-control-target-a/b.log、final37-mobile-b.log、reaccept-apk-final37.log、reaccept-device/final37-install-preservation.json、final36/final37-world-audit.json、final36-world-continue-still-stopped.png、final37-world-closure.png、final37-profile-saved.json、final37-j1-start.json、final37-begin-background.json、final37-mid-background.json、final37-status.jsonl、final37-host-J2/J3。原文/数据库/模型响应均在忽略目录；QA代理与当前配置保留用于继续验收。未推送或发布。


final37 真实规划终态补录（04:53:58 UTC读取账本；模型响应实际于01:03–01:08 UTC结束）：

| 样本 | 两次请求实际wire、思考及耗时 | 终态 |
|---|---|---|
| Android J1 救援 | 24576：思考24521、465.514秒；38036：思考32422、681.915秒 | retryable_failed，正文length，0候选/0决定 |
| 主机 J2 调查 | 24576：思考24511、506.479秒；38025：思考25632/输出33907、631.101秒 | ready并正式adopted，8条合法战役线索，0决定 |
| 主机 J3 合作 | 24576：思考24490、524.816秒；38003：思考29793/输出37471、685.172秒 | ready并正式adopted，3条合法战役线索，0决定 |

三任务全部最多两HTTP，没有第三次或未知重放。65536是声明上限，救援第二次实际wire仍只有38036：上一轮思考用量是截尾下界，仍低估下一轮实际思考开销；该任务原失败保留，不把它记为通过。J2/J3的严格新线索作者/编译/采用通道实际通过，正文未进入角色知识；计划六维和对应旅程仍待评审，不能以ready替代A36。

Android自00:49:54 UTC观察到HOME，01:08:13.691 UTC第二次响应结束，期间没有QA前台操作。04:54:52 UTC仍HOME、PID31004存活、两服务均退出、唤醒锁为空、crash buffer为空；返回前台显示真实截断失败。服务释放的准确时刻未采样，不将后读证据当作即时测量。预算最终1188/1500，余312：三规划6次加独立opening_goal1次；安装/缓存世界重校验零HTTP。原2个未知任务及冻结/attempt逐值保持，设备全部已采用计划/工件/快照hash一致；host新采用与设备历史分开对账。

整体状态仍未通过，0新有效玩家决定。通览还发现移动世界书投影未合成战役目录、已知面板只有标题；属于后续共用内容读取和回看缺口，尚未修复或作端上通过声明。下一批在新身份修复该边界和长规划预算，再验真实消费与长旅程。

新增证据：reaccept-device/final37-completed-in-background.json、final37-planning-failed-after-home.png、final37-preservation-proof.json，final37-status.jsonl与final37-host-J2/J3/proposal.json及http.jsonl。原失败、自动模型内容和冻结配置不修改。R44–R46本地提交ID见Git历史，未推送/发布。

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
