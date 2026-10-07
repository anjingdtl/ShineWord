# Phase 9 接手收尾复验报告

2026-10-08，Asia/Shanghai。final33工程门禁通过，正式救援高强度规划在前后台验收中断连，**第九阶段整体尚未验收通过**。A01–A40：29 PASS / 2 FAIL / 9 NOT RUN / 0 BLOCKED；完整长旅程、持续后果和三意图质量继续验收。

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
