# Phase 9 收尾复验基线

复验日期：2026-10-07，Asia/Shanghai。合同为 docs/Shine-TRPG_PHASE9_CONSTRUCTION_PLAN.md。本轮从已提交 Phase 9 实现检查，不能把历史施工起点当成本轮基线。

| 项目 | 事实 |
|---|---|
| 前轮开始 HEAD | fab6f171fba075c69fbe0bb1ecec4058fd9e0cae，彼时工作树干净 |
| 本次接手 HEAD | 5a6e07712176fbba1b780bc21ead2d8cfa1aa1e4，接手时干净；前轮修复已提交4fb5519、报告已提交5a6e077 |
| 历史施工 HEAD | 5f49a7d653bdc98a910d7b0c0b33ec3ac483b1e0；922项为当时历史数 |
| 版本 | V1.0.0 / versionCode 1000000；final21已提交eb48dae，R28–R36纳入本次本地提交，未推送或发布 |
| 环境 | Windows / PowerShell，Node v24.14.1，JDK17.0.19，Android API37 |
| 设备 | emulator-5556，AVD ShineWord_P8_Reacceptance |
| 小说 | C:/Users/Administrator/Desktop/AIstudio/放开那个女巫.txt，7,178,905 bytes |
| 小说 SHA-256 | 7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4 |
| 模型 | GLM-5.3-Flash，https://open.bigmodel.cn/api/coding/paas/v4 |
| 凭据 | 从指定本机文件读取，仅在内存/系统安全存储使用；不记录内容、长度或片段 |
| 显式测试能力 | contextWindow1048576、maxOutputTokens32768；主机contentMaxOutputTokens16384，设备内容输出取profile默认；历史low、final28实际high分别记录，不从型号推测 |

报告审计发现：使用合同不允许的PART；自然结局后继续刷数；设备在途动作算决定；六维未全部达到3却称通过；千回合未运行。旧“90有效决定、技术验收完成”撤销。

保留旧开发库、分支、冻结材料与私有日志；未卸载、清数据或覆盖设备数据库。通过正式入口建立的专用库为 shineword-baseline-1791270204765.db。主机诊断库与只读设备快照放 .tmp/phase9/，不反向写回设备。

共享物理计数重启不清零。历史起始313包含估计，不能称全历史HTTP精确对账。本轮新请求传输前原子预留，生成加修复另共享每任务两次上限。总额调整400→600→650→750→950→1100，均在派发前说明并记录manifest。最终消耗见FINAL_REPORT。

最新代码/APK身份记录 .tmp/phase9/reaccept-identity-final29.json；以下final21显示等价与旧哈希是历史检查点；每段旅程有独立identity。此次修改原生manifest后，identity scope升为v2：包含src、mobile/src、原生Android文件/资源及显式构建输入，排除生成bundle、SDK/签名本机配置与凭据。旧v1哈希只覆盖TS/JS和APK脚本，旧样本身份保留，不改写或包装为最终通过样本。final15/16/17只修改核心解析/校验/提示，移动与原生文件逐一与final14相同，完整显示测试保留final14身份。

final21历史identity scope v3增加实际打包的mobile/src/version.json，生产源码7813f21fae13fb2a3538f9601d6d381f8049670bc5e274ca7bd168b50a041ceb，APK42bbcd35cc600c9d42a127fd9552fcc13605b80e58ff81acf2ec77bcc8d66eb8，109439951 bytes。旧scope v1/v2身份不改写。final21全部移动/原生显示和共用构建输入与final14逐文件一致，版本元数据单列，证据final21-display-source-equivalence.json。该final21检查点的R22–R27及测试、QA工具、验收记录当时未提交，现已归档eb48dae；旧轮状态不作为最新工作树状态。
## commit后续验收基线（final25）

final21批次已提交eb48daeb835b0a0939b9f41fe0526261bb24ba1a（fix(phase9): unify campaign lifecycle and harden acceptance boundaries），未推送。后续R28–R31工作树基于此提交，旧身份与样本保持历史归属。

final25 identity scope v3源码SHA-256：9b78c6b03b5de63e22139faf103c9866113cad75573d241fb8c626e345f15a7e。APK6344ae4888105e6ad4596efd6fff7a145c7edfd6b2b562cea7bf611c9a1c821e，109457415 bytes，emulator-5556安装包hash一致。完整核心1030/1030、移动类型、38s debug构建、版本与diff通过。凭据、完整小说及原始响应仍仅在本机安全存储/已忽略QA目录。

共享物理请求上限在首次续跑派发前明确公告从1100增至1500，已用数1055及历史记录保留；主机/Android均由phase9-budget.cjs原子预留，不重置。最终消耗以本地manifest的budget.spent为准。
## final27最终源码复验身份

生产源码SHA-256 aca9a26bba4303cdd5686df6523e4af3122f5c0d9fccf0e561bf09a88735ea81（scope v3）。APK22fda466b027fb5d389bc635758dd9dbf36a9b2b5be549f92e2ce2534a0cdfc8，109452999 bytes；emulator-5556实际安装hash一致。完整核心1035/1035，0失败0跳过，35.190s；移动类型及34s Debug构建通过。最终代码复验不借用final23/25真实旅程配额。

## final28最新复验身份

R34/R35后生产源码SHA-256 d531af0a507e4d161706f7a2c7d1cd9a760153594ac2271db276014502419e87（scope v3）。APKc30576350b823eed3b5df3b3d82b1668a75fef57be834dc78b0c6af00d571f4c，109461403 bytes；emulator-5556保留数据安装，实际安装hash一致。完整核心1040/1040，0失败0跳过，33.094s；移动类型及33s Debug构建、版本与diff通过。身份文件reaccept-identity-final28.json。旧样本各自保留原身份，未合并为最终80。

final28新增高思考强度对照，Android经正式模型配置UI保存，Keychain引用保留；主机使用一致的实际high配置创建provider及冻结fingerprint，未以profile标记替代实际请求配置。其余历史low样本保留原参数，不能当作匹配性能对照；设备代理地址与主机实际端点也分别记录。最终清理及预算以FINAL_REPORT为准。

## final29最新提交与复验身份

R36后生产源码SHA-256 53629ccff12efc738bf7e6f85c8f72bc0562241a19a3ba34aacfbd2837d9b254（scope v3）。APK1b8eb52f182fe02bb6ec7fd2218cb9260b8984cc32410060041868e2109c801f，109462083 bytes；emulator-5556实际安装hash一致。核心1042/1042，0失败0跳过，36.604s；移动类型、35s Debug构建、版本与diff通过。身份文件reaccept-identity-final29.json；源码指纹在本地提交后保持相同，不与Git HEAD SHA混淆。

共享预算1161/1500（余339）；final28高强度三意图各一次规划后未知，无重发。final29冷入口独立目标建议1次，规划恢复0次。已恢复真实端点/low、逐值核对Keychain引用不变，停止验证过的本轮代理，fontScale1.0/密度420/Gboard与原数据库保留，App已force-stop。历史样本均保持各自身份，不计最终80。


## 2026-10-08 final33：长规划的传输、租约和物理预算

生产scope v3源码1d0e6778c600e7c788c0d5fbcd4ba8c0cc09eb4c2a2e9b930a2fd7318c9ec3a7；Debug APK 3f51242ac7a6f89580d378c85b829444c2d74afe0d524773726d42cc7f1eb31b，109474379 bytes，V1.0.0 / 1000000，emulator-5556实际安装hash一致。完整核心1065/1065、0失败0跳过（reaccept-core-final33b.log，34.325s），移动typecheck、41s Debug构建、版本与diff通过。新增23项回归，所有前置RED日志保留。

接续本地提交d94d548a13c89f2381759d5c8ac503c424817974；历史来源、旧身份、未知请求和共享预算不重置。本批R37–R40将纳入本地提交，未推送/发布。

final33正式Android救援任务job-setup-world-src-7f45fe0b11ea30ec-muwccd51-muyb1p8u在约523秒、返回前台时转为outcome_unknown（Network request failed）；此前后台约58秒，进程26168存活、崩溃缓冲无异常。代理上游随后在565.527秒收到HTTP200/5026703 bytes，晚于客户端失败，不能据此认定上游超时或固定原生读取时限；RN默认读取/调用时限为0。具体原生断连原因尚未证明，规划缺少Android执行生命周期保护，作为下一修复点。原意图、冻结high/stream/32768/物理额度2及1次账本保留，0候选/0决定，禁止未知重放。此前未知任务也未重发；独立opening_goal 1次单列，共享预算1168/1500，无重置/增额。证据final33-background-failure-proof.json、final33-background-events.log和final33-j1-after-background.json；当前代理18691、原库与AVD保留，尚未最终清理配置。

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
