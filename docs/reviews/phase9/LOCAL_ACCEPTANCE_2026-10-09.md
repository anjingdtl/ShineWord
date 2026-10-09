# Phase 9 本机代码 Review 与模拟器复验

本文件保留**初次验收、修复前**的结果。用户随后授权测试 + fix，R60–R64的当前修复、1179项核心与新真实方案质量失败见[本机修复检查点](LOCAL_FIX_2026-10-09.md)。不得把下文未修状态当成最新状态，也不得删除旧失败证据。

日期：2026-10-09（Asia/Shanghai）。接手 HEAD：`287f130`，分支 `main`。先阅读 IMPLEMENTATION_PROGRESS、施工方案、云端交接、矩阵、协议、流程、旅程及内容质量记录，再执行只读基线与隔离测试。

**结论：整体验收不通过。** 既有 1167 项工程回归通过，但独立审查确认 R60–R62 三项未修缺陷。A16、A27 从历史 PASS 转为本轮 FAIL；A15、A36 原 FAIL 保留。本轮汇总 **27 PASS / 4 FAIL / 9 NOT RUN**。其他 PASS 承接各自历史证据，不表示本机重跑了所有端上场景。

本次是验收，不修改生产业务逻辑。新增独立反例与报告，更新当前进度/矩阵；APK 构建生成了 `mobile/src/version.json` 的 buildTime。没有提交或推送，没有修改用户既有工作。

## 1. 三项可复现发现

### R62 [P1] 未知结果被拆批/重排路径自动再次发送

位置：`src/application/worldBuild/coordinator.ts:1824`，以及 `1272`、`1285–1351`。

真实 GLM、高档、同一本完整小说、正式流式导入和生产 segment 运行中，首个 `world_extract` 请求在 300 秒实际到期。SQL ledger 记录 `outcome_unknown / timeout_unknown`，无可信响应或 token usage。协调器却把这个错误归为 `network`，执行拆批及尾部重排；约 **23ms** 后，以新的 `…-r1b0001:all` logical request ID 自动发送第二次。

两条请求的 `source_ranges_json.ranges` 逐条相同，均覆盖同一开局范围 0–6400 码点；实际 wire 输出上限均 **22384**，思考档位均 high。旧 `…-g0001:all` 的未知状态仍保留，但新 ID 绕过了相同 logical request 的禁止重放门。第二次 71.909 秒得到 HTTP 200，并产生正式世界包；这不能使第一次未知变成已知失败，也不能把自动重复支付写成恢复合同通过。

这违反方案 §4、A27 的未知结果禁止自动重发约束。发现后已通过生产 `SqliteBuildRunStore.requestRunControl(..., 'pause')` 请求暂停，没有手动恢复未知请求。当前主机 run 已 completed，pause_requested=1，世界包=1；两份原账本保留。

修复方向：抽取错误分类使用与 ledger 一致的未知语义，首次 timeout/network unknown 即停在需审查状态；未知时不创建或派发替代 unit，不用换 ID、拆批或调整尾部绕过。已知 length、明确 HTTP 拒绝与预派发预算不足仍可分别走有界恢复。增加真实 SQLite/生产 provider 的反例：首次未知之后物理请求只有一次、原 unit/材料不变；明确截断仍允许合法拆批。

证据：`.tmp/phase9/local-20261009/real-world/http.jsonl`、`build-proof.json`、`response-2.txt`。第二次完整响应仅在忽略目录。原首次无完整响应，不能补造。

### R61 [P1] 后果中的 schedule_consequence 被静默丢弃

位置：`src/application/campaignPlan/settlement.ts:107` 至 `132`。

合法自动内容合同允许后果效果包含 `schedule_consequence`，本地编译器也返回 `compiled.scheduledConsequences`。但结算只消费 effects、transitions、knowledgeGrants、relationshipShifts，没有注册该字段。

经生产解析/编译、正式采用、CampaignSession、SQLite 提交的工程反例：`lin-favor` 已 triggered，`lin_called_in_favor` 已持久化，但它声明的 `lin-followup` 连 pending 记录都不存在，后续事件为 0。这是丢失玩法效果，不是等待触发条件的问题。不能用工程反例补真实旅程或 A19 的两次间隔配额。

修复方向：方法效果与后果效果共用同一注册入口；从实际 owner 工件验证模板，保留来源、幂等键、归属与触发预算。循环/重复/缺失引用明确处理，超过本次触发额度应保留 pending，不能提前标 triggered 或静默删除。

### R60 [P2] 奖励已兑现，但阶段和结局停留在奖励前事实

位置：`src/application/campaignPlan/settlement.ts:143` 至 `195`。

进度/后果求值在奖励之前完成；奖励兑现之后只有 `ending_only`，不再求值阶段。生产反例中 stage-1 已 succeeded，货箱线索已交给玩家且持久化；stage-2 的唯一 completion 正是该知识，但仍 available，战役仍 active，依赖 stage-2 的结局未成立。玩家需要额外行动才能使已满足的事实反映到进度。

修复方向：将新奖励及其权威事件纳入有界结算循环，重新求值阶段/后果并应用新增奖励，最终再选结局。保持单事务、奖励去重及节点/后果预算，避免通过额外玩家动作补齐同次提交本应完成的事实。

R60/R61 独立可复制命令：

```powershell
npm run build:core
node --test docs/reviews/phase9/LOCAL_REVIEW_REPRO_2026-10-09.cjs
```

当前结果 **0 PASS / 2 FAIL**；断言分别为 stage-2 实际 available、lin-followup 不存在。失败日志 `.tmp/phase9/local-20261009/review-red.log`。该文件独立于既有 tests 通配门禁，用于验收反例，不将预期失败伪装成通过。

## 2. 本轮实际执行的层次

| 层次 | 结果 | 范围和证据 |
|---|---|---|
| 核心完整回归 | PASS | 独立运行1167/1167，0失败/0跳过，56.562秒，`core-independent.log` |
| 首轮并行回归 | FAIL，保留 | 1166/1167，90ms租约心跳用例失败；同时执行构建。独立复跑通过，不能从这次对照证明唯一根因是资源争抢；`core.log` |
| 移动 typecheck / version | PASS | V1.0.0 / 1000000，build 0；按实际脚本执行 |
| Debug APK | PASS | BUILD SUCCESSFUL 2m50s，重新执行Hermes bundle；`apk.log` |
| 独立代码审查反例 | FAIL | R60/R61 0/2；R62真实请求、源码与SQL逐条核验 |
| 全小说生产导入和冷读 | PASS | 1504章节记录、3260块、106分片；4764条hash、全文、树hash及SQLite integrity通过；`source/source-evidence.json` |
| 主机真实GLM认证 | PASS | HTTP200、完整SSE终止、OK；high；1.050秒；`connection-proof.json` |
| 主机资料建设 | 已发布，恢复合同FAIL | 正式segment/M5链路产生世界包；首次未知后自动重排再发，不给未知恢复PASS |
| 模拟器安装 | PASS | 专用API35 x86_64 AVD，实际安装APK hash与本轮文件一致；`installed-proof.json` |
| 端上正式连接测试 | PASS | GLM-5.3-Flash、高档；UI连接成功2309ms，代理HTTP200；`connection-done.png`、`device-http.jsonl` |
| 端上完整小说导入 | PASS，仅导入 | 文件选择器正式入口；1504/3260，原文SHA与指定文件一致；`device-audit.json`、`import-progress.png` |
| 端上资料建设 | 未发布 | 唯一world_extract实际300秒到期后outcome_unknown；暂停已生效，package=0，不是ready或可开局 |
| 暂停、冷启动保留 | PASS，限该场景 | paused_user、原文与未知attempt逐值保留，0隐式新增HTTP；`device-before-cold.json`对照`device-audit.json` |
| 主题/大字体基础UI | 已执行，有限覆盖 | 四主题“我的”页实际切换截图；360dp、fontScale2书库可读，恢复原尺寸/密度/fontScale1。未重跑主线卡、提案/面板的全主题与411dp×1.3/2矩阵 |
| 崩溃 | 未观察到 | 本轮crash buffer为空，不外推所有设备/长期稳定性 |
| 三意图/80决定/主线UI | NOT RUN | 本轮0有效决定、无新合格campaign_plan；UI连接/导入/管理不计决定 |
| 两项持续后果/六维质量/10+10性能 | NOT RUN | 本轮不补历史缺口，不跨身份拼数；独立试玩仍未验 |

设备UI通过真实uiautomator树选取坐标；不存在的目标不按截图猜坐标。API37专用AVD初始启动未得到可用设备，最终成功测试使用API35及直接持久shell会话，不能宣称API37端上通过。

本轮使用的生产来源：`createPhase6MobileHarness` 只替换文件读取/原生hash/安全存储/HTTP边界，实际接通 sourceCatalog、持久sourceIndex、segmentPlans/configs/artifacts、正式SegmentPublicationService及SegmentBuildService。没有使用旧公共GLM驱动的low/32K、旧阶段路径或一键审查豁免。所有新开局资料按明确high/1M/65536声明；世界抽取实际协议非流式，连接SSE与规划流式不可混同。

## 3. 身份、请求和保护范围

| 项目 | 本轮记录 |
|---|---|
| HEAD | `287f13043627ea01d912568521561c5617efaed3`；生产提交未增加 |
| production scope v3 | `12aabca5f2fecffdad458da577adbac7e91948a5ef5b4f197e1aaea0eb85cf5c` |
| APK / 实际安装 | `a0ccf751519295d2046cbe272cd5fe1805ffa9ff8fb569b7f6e8ef27414953f6`，103672829 bytes |
| 原小说SHA-256 | `7f45fe0b11ea30eca95f5a736232dd4c466a57c0f2cc9f67530e432015ecc6f4` |
| 模型 | 指定文件解析的 `GLM-5.3-Flash`，coding端点；设备预设模型名为小写同名 |
| 共享预算 | 1210→**1215/1500**，余285；没有增额/重置 |
| 新物理请求 | 5：主机认证1，主机抽取2，端上连接1，端上抽取1；3次完整HTTP200，2次未知 |
| 新最终旅程 | J1/J2/J3各0/20，J4-A/B各0/10；Android UI有效决定0 |

原final48数据库、历史响应/manifest、私有驱动及专用AVD在此主机未找到。1210是交接承接值，不能称全历史已重新对账。新请求均派发前持久扣额，主机抽取2条和Android抽取1条可从生产SQL账本核对；独立连接测试2次从传输/代理证据核对。旧J1/J2/J3未知任务仅有交接身份，未恢复、未重发。

真实密钥只读取到主机内存。设备profile和Keychain仅存 `qa-memory-token` 占位值，本机代理在内存中替换Authorization；不向设备复制真实密钥、不写命令参数/SQLite/截图。设备代理profile与主机直连profile不用于匹配性能比较。

本轮私有资产在 `.tmp/phase9/local-20261009/`，共享carry-forward manifest在 `.tmp/phase9/test-manifest.json`；已核对Git忽略。旧用户修改 `.workbuddy/memory/2026-09-28.md`、`.zcodeignore` 及所有既有未跟踪资料保持。没有卸载/清数据/替换设备数据库，没有改骰点或注入候选。

结束时已核对设备前台构建服务为空、代理无在途连接，再停止本轮专用模拟器和内存代理。隔离AVD、App数据和所有证据文件保留，未知请求未重放；下次复验需先启动隔离设备/代理并审计原账本，不能直接重新运行新建数据库驱动。

## 4. 可复制修复接续

先读本报告、IMPLEMENTATION_PROGRESS、施工方案和完整FLOW_REVIEW。保留本轮与全部历史未知账本，禁止恢复或重放R62首条及Android超时请求。优先修R62共用未知分类，再修R61后果注册、R60奖励后的有界求值；不要只在QA驱动/提示/UI绕过。独立反例应从2 FAIL变为2 PASS，增加未知抽取单次物理请求及已知截断合法拆批对照，完整核心/移动类型/版本门禁通过后重新构建和记录源码/APK身份。

然后用同最终身份从正式自动三意图入口完成10决定冒烟，再补J1/J2/J3各20、同快照J4-A/B各10及Android20+10。保留自然早结局，不能刷数；补两项隔至少两次有效决定的持续后果、三计划和对应旅程六维每维≥3、A02/A03/A06/A12、10+10匹配性能及独立试玩。现有27PASS/4FAIL/9NOT RUN不能靠本地工程门禁或审查队列清空全部转绿。
