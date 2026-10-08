# Phase 9 验收矩阵 A01–A40

2026-10-07 final29收尾复验。整体尚未通过。PASS=对应合同有直接证据；FAIL=已有实际不符且未经完整复验转绿；NOT RUN=完整场景或必需证据未齐；BLOCKED=外部阻断。本轮无BLOCKED。不使用PART。

工程证据：tests/phase9-closeout.test.cjs、phase9-flow/turns/planning/replan/sqlite.test.cjs、phase6-mobile-runtime.test.cjs；日志 .tmp/phase9/reaccept-core-final29.log（1042/1042，0失败0跳过），新增preparation/actor-references/proposal-fields/inherited-completion/ending-order/preparation-restore生产回归。私有实际样本/身份见REAL_JOURNEYS。工程安全拒绝不等于内容质量通过。

| ID | 场景 | 状态 | 证据/缺口 |
|---|---|---|---|
| A01 | 同小说同起点不同意图 | PASS | 同一序7边陲镇世界，自动保护探视/调查矿区/合作救援目标与办法不同；质量另见A36 |
| A02 | 原著/原创及换起点 | NOT RUN | canon真实资格/未来技能拒绝本地通过，完整真实换起点未齐 |
| A03 | 部分ready与后段依赖 | NOT RUN | 全TXT生产导入，已采用原文进入重规划/源变化stale回归；真实按需后段建设到采用未齐 |
| A04 | 明确目标/探索待选 | PASS | 双goalMode与完整intent，开局/管理无叙事卡仍有当前办法 |
| A05 | 计划死亡尚未行动 | PASS | 未来计划不改生死/经历；已提交事实和原子归约是实际进度权威 |
| A06 | 救下原著将死角色 | NOT RUN | 终态保护工程通过；真实成功救援后持续存活未齐 |
| A07 | JSON截断/非法引用/修复 | PASS | 冻结约束、一次修复/两请求、原文恢复和坏形状拒绝；R28–R35贯通准备AST、人物别名、字段上限、跨阶段普通完成与结局顺序。真实失败原响应离线复现，生产两请求修复/ready及重入0HTTP通过；必要门不等于内容质量 |
| A08 | ready前强停/占位恢复 | PASS | 完整ready与损坏/占位拒绝工程通过，历史设备提案冷启动恢复采用。R36生产移动/SQLite覆盖unknown、invalid、ready恢复；final29同一真实未知任务冷/手动恢复保持分类、意图和一次规划请求，无规划重发；冷入口独立目标建议1请求另记 |
| A09 | 双击开始/事务中断 | PASS | setup/job fence、幂等采用、原子完整创建、候选主体hash门禁 |
| A10 | 两路线与后续回响 | NOT RUN | 机制权威差异工程通过；真实相同快照各10与后续机会未齐 |
| A11 | 点选/同义自由输入 | PASS | 同methodId/outcomeSetHash；可选技能字段不丢后果；设备真实绑定有效 |
| A12 | 模板外能力允许组合 | NOT RUN | 样本均已列办法/改写，不冒充新组合支持 |
| A13 | 非法ID/跨场景/过期 | PASS | offsite真实候选拒绝；伪造/过期选择及改意图工程拒绝 |
| A14 | 固定四档骰点 | PASS | 四档投骰前冻结同事务提交、原骰恢复、资源上下限与零余额回归 |
| A15 | 无风险/日常/连续失败 | FAIL | automatic与失败恢复工程通过；真实final18大成功门控停滞、final27合作旧承诺大成功专属导致门槛后重复，6次数字变化排除。R34必要门已捕获原档并经普通履约回归，仍未齐最终真实连续失败后的完整玩法复验 |
| A16 | changed/no_change | PASS | 无关动作不改进度；完成证据推进；更晚期限不覆盖先前完成理由 |
| A17 | 提前解决/绕过/奖励 | PASS | 早完成/跳过/终态保护与分叉奖励去重生产回归 |
| A18 | 偏离/暂停/换目标 | PASS | 生产pause/explore/resume与goal_changed回归；设备暂停/恢复入口实测 |
| A19 | 隔两决定后人情/承诺用途 | NOT RUN | 旧承诺真实兑现及本地延迟只触发一次通过；final20 v31、final27调查v12的新后果创建/触发同版本，不计隔两决定。旧final17仅1个诊断后果，两个实际持续后果及最终完整旅程仍未齐 |
| A20 | 重规划在途/事实变化 | PASS | 稳定边界双CAS、pending拒绝、源绑定同版本stale；真实有效采用已有 |
| A21 | 触发合并/后台竞争/失败 | PASS | durable单飞/租约fence/两HTTP共享；invalid不自动重发，显式新任务恢复 |
| A22 | 目标/顺序/规则/风格身份 | PASS | 完整意图/选项/材料/角色/规则冻结，live不替代旧池；ready主体hash |
| A23 | schema/校验工件/阶段恢复 | PASS | 不可变归档完整往返；原响应先落盘，成功阶段0HTTP恢复 |
| A24 | 损坏冻结 | PASS | 坏JSON/hash保留证据零HTTP；无live fallback；ready篡改拒绝 |
| A25 | 材料超窗/未知能力 | PASS | 预派发拒绝不裁意图；显式能力声明，设备未知能力失败已观察 |
| A26 | 单请求/任务/总预算全账 | NOT RUN | 新派发持久原子计数、任务2次已验；历史313含估计不能称全历史100% |
| A27 | reasoning-only/429/网络/未知 | PASS | 受控分类及有界修复回归；final28 high三意图真实300秒超时各1次后outcome_unknown，无自动重发。final29同一设备任务冷/手动恢复仍未知、规划次数不增；独立opening_goal按实际派发另计 |
| A28 | 检定/采用/提交/lease强停 | PASS | 原骰复用、同事务管理、outbox/fence回归及设备冷启动接线 |
| A29 | 响应未验证/修复未采用 | PASS | ready-write崩溃复用响应0HTTP；校验未完成不补造成功 |
| A30 | 删除/意图变化/源替换 | PASS | HTTP中取消/修改fence；旧worker不复活候选，绑定变化stale |
| A31 | 回退/双分支隔离 | PASS | 完整runtime/知识/后果/归档重绑回归；UI实际v12回退分支，主机相同基点 |
| A32 | 导出导入继续/坏引用旧版 | PASS | 生产重规划→save-10重复同库导入→继续；碰撞重绑、hash篡改和旧版拒绝 |
| A33 | 隐藏身份/别名/日志 | PASS | 公开投影/Narrator最小材料门；旧报告凭据元数据删除，不输出认证请求 |
| A34 | 阶段/自然结束UI一致 | PASS | final29在原camp-muxpraio-main v33实际复验主线已结束、完成阶段、最终叙事及campaign_ending，旧战役办法退出。snapshot/runtime/全部归档hash、fulfilled旧承诺与v37分叉不变；新增0决定/0HTTP，final29-ending-reacceptance.json。不证明安娜获救或A38完整旅程 |
| A35 | 前后台/键盘/小屏/主题/字体 | PASS | final14完整360/411dp×1.3/2字号、键盘/前后台、动态字号、草稿及四主题证据保留原身份；其它显示源码等价证明另存。R36涉及开局恢复显示，final29实际补验360/411dp fontScale2：完整未知提示可读、恢复/取消滚动可达，状态/意图不变。未声称重跑全部历史主题矩阵 |
| A36 | 三意图六维质量 | FAIL | CONTENT_QUALITY分开评价计划/旅程：final23救援早结局、final25调查短于配额、final27调查7项后invalid/合作重复及旧承诺门控，均至少一维低于3。final28 high三份未知结果没有可评分计划；必要门修复不自动提高历史评分，独立试玩未验 |
| A37 | 回合/规划调用耗时 | NOT RUN | 通常Planner+Narrator两次、无固定导演；匹配10基线+10新回合对照未齐 |
| A38 | 最终源码/APK/真实证据 | NOT RUN | final29 scope v3源码53629ccf…与实际安装APK1b8eb52f…一致，工程1042/1042；最终身份新增有效旅程配额0。旧final18 UI20+10声明已撤销，final23/25/27诊断不跨身份拼数；最终80及必需UI20+10仍未齐 |
| A39 | 同世界三战役隔离 | PASS | 同world独立campaign/branch/intent/content/事件；分叉与存档继续回归 |
| A40 | 100/300/1000本地累积 | PASS | 实际生产Session/SQLite全量回归，snapshot5128/5129/5133、runtime1414/1414/1415 bytes、结构1412恒定、jobs1；范围为已准备局面，不外推无限归档 |

汇总：PASS 29 / FAIL 2 / NOT RUN 9 / BLOCKED 0，合计40。A34在final29原档复验保持PASS；A15/A36保持FAIL、A19/A38保持NOT RUN。修复共用边界与必要作者门不能直接替代真实内容、配额、持续后果和性能验收。


## 2026-10-08 final33：长规划的传输、租约和物理预算

完整目标继续执行，阶段整体仍未通过；A01–A40维持29 PASS / 2 FAIL / 9 NOT RUN。新身份未完成J1/J2/J3各20及同基点双分支各10，没有把请求、管理、采用或旧身份诊断计入80；两项隔两次决定的持续后果、三计划及对应旅程六维全部≥3仍待实测。

生产scope v3源码1d0e6778c600e7c788c0d5fbcd4ba8c0cc09eb4c2a2e9b930a2fd7318c9ec3a7；Debug APK 3f51242ac7a6f89580d378c85b829444c2d74afe0d524773726d42cc7f1eb31b，109474379 bytes，V1.0.0 / 1000000，emulator-5556实际安装hash一致。完整核心1065/1065、0失败0跳过（reaccept-core-final33b.log，34.325s），移动typecheck、41s Debug构建、版本与diff通过。新增23项回归，所有前置RED日志保留。

A27/A28/A30补充R37–R40工程回归：长请求续租、取消/接管、流式断流未知、两请求全链路上限与原根恢复。A36/A38不因这些回归自动改善；final31三请求历史缺陷完整保留，不当作合格样本。

final33正式Android救援任务job-setup-world-src-7f45fe0b11ea30ec-muwccd51-muyb1p8u在约523秒、返回前台时转为outcome_unknown（Network request failed）；此前后台约58秒，进程26168存活、崩溃缓冲无异常。代理上游随后在565.527秒收到HTTP200/5026703 bytes，晚于客户端失败，不能据此认定上游超时或固定原生读取时限；RN默认读取/调用时限为0。具体原生断连原因尚未证明，规划缺少Android执行生命周期保护，作为下一修复点。原意图、冻结high/stream/32768/物理额度2及1次账本保留，0候选/0决定，禁止未知重放。此前未知任务也未重发；独立opening_goal 1次单列，共享预算1168/1500，无重置/增额。证据final33-background-failure-proof.json、final33-background-events.log和final33-j1-after-background.json；当前代理18691、原库与AVD保留，尚未最终清理配置。

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

状态维持29 PASS / 2 FAIL / 9 NOT RUN，A15/A36仍FAIL，A19/A38仍NOT RUN。1097项核心通过和Android世界闭包修复不能替代80项同身份有效决定。R45工程范围覆盖线索分支隔离、真实获得、重规划与存档；真实三意图旅程及内容评分待验。

身份、回归、实际复现与运行中请求详情见 [FINAL_REPORT](FINAL_REPORT.md)。完整阶段仍未验收通过。

final37 真实规划终态补录：J2/J3自动候选ready并采用，分别8/3条合法战役线索；Android J1第二次38036仍length。全部至多两HTTP，预算1188/1500，原未知任务和设备已采用归档保持。0新玩家决定，内容质量与完整长旅程仍未通过。移动世界书及已知面板的线索回看缺口待下一批修复。终态、用量、后台清理和保护证据见 [FINAL_REPORT](FINAL_REPORT.md)。

## 2026-10-08 final38：共用思考用量反馈（R48）

R48 接入按配置/档位/任务分类的真实账本反馈；完整响应与截断下界分别处理，在新战役、实际回合和记忆材料根冻结，恢复不读新历史。1108/1108核心、移动类型检查与Debug构建通过，Android同意图首次派发60921=48633+12288；候选仍在等待，不能记为旅程或阶段通过。旧归档及2个未知结果任务精确保留；预算1190/1500未重置。作用域、能力边界和证据详见[最新复验报告](FINAL_REPORT.md)。

final38 真实终态补录：2026-10-08 06:50:15 UTC只读复验，J1已 candidate_ready，仅1次 succeeded。实际 wire60921、思考34973、总输出43763（正文8790）、输入8661，可信原始用量，账本耗时777.290秒；无恢复请求。成功账本 http_status 仍为null，上游200另由代理日志确认。两项后台服务均已退出、crash buffer为空，准确释放时刻未采样。全部采用计划/归档/快照及2个旧未知任务、冻结根、attempt保持一致，预算1190/1500。仍未采用该候选、0新玩家决定；这一结果仅确认预算修复与完整候选通过，不能代替内容评分、长旅程或阶段验收。证据：.tmp/phase9/final38-status.jsonl、reaccept-device/final38-status.sqlite、final38-ready-job.json、proxy-final34.log。

## 2026-10-08 final39–final40：共用目录与线索正文回看（R47）

R47统一快照绑定的基础包/世界增量/段工件/战役归档目录与玩家权限。新增6项回归，完整1114/1114通过；final39真实UI失败后继续、获得证词并显示正文，final40保留安装后修复书籍滚动并精确重读同一正文。旧归档及2未知任务保持；跨身份诊断不拼入最终80，完整旅程/质量/审查仍待验收，预算1200/1500。范围、身份、前置失败和原始证据见[最新复验报告](FINAL_REPORT.md)。

## 2026-10-08 R49：映射拒绝与发布事实审查交接（final41/42）

R49将未能执行的映射限制改为完整提案/证据绑定的正式拒绝，并将M5来源范围内事实冲突交接给逐条审查。核心1120/1120与移动构建通过；Android原缓存拒绝0新请求，3条互补事实真实UI审计后新映射1次成功，预算1201/1500。两个新限制也逐条拒绝，旧档案/原文保留；地点实体ID与场景地点名交接仍阻滞新段发布。final40 J2/J3未知结局保留且不重发，完整80/质量/性能仍未通过。详情见[最新复验报告](FINAL_REPORT.md)。

## 2026-10-08 R50：地点实体、场景与运行坐标交接（final43）

R50统一地点实体/scene/实际坐标与嵌套条件、移动目的地，保留未知地点拒绝。核心1128/1128、移动类型与APK通过；final43端上新局面正确解析“城堡”并正式发布，3段就绪，预算1202/1500。原文、旧包/segment/战役档案和未知请求保留。final42旧段仍缺局面且major审查开放，正式补充发布及GM备注质量仍待收尾；不能据新段通过声明同案补回或整体可玩验收通过。详情见[最新复验报告](FINAL_REPORT.md)。

## 2026-10-08 R51：真实到期、提前断连与响应完整性（final44–46）

R51区分真实deadline与提前abort，200空白/未闭合JSON和缺终止SSE保持network_unknown，不抢救正文/usage、不自动重发。核心1135/1135、移动类型/APK通过；final46同案受控端上明确网络失败，旧数据/未知请求保留、0上游模型发送；另1次正常真实连接测试成功。预算1206/1500，未重置/提高。故障回归不计玩家决定；旧资料审查、最终80与质量/性能仍未验收通过。详情见[最新复验报告](FINAL_REPORT.md)。

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
