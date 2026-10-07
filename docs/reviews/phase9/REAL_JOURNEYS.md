# Phase 9 真实旅程复验

2026-10-07，真实GLM-5.3-Flash与生产CampaignSession/SQLite，Android同链。全本TXT正式渐进导入，hash见BASELINE；没有手填世界或战役内容。

共有世界world-src-7f45fe0b11ea30ec-muwccd51 r1，序7边陲镇，已验证安娜囚禁/处刑威胁与罗兰探视。NPC资格来自实际场景；只构建近期依赖，远期provisional不算已知。

旧 .tmp/phase9/phase9.sqlite “90决定”和 reaccept-same-world、reaccept-final-tree 样本是诊断：有结束后继续、失效方法、后果丢失与无关探索重复，不能计最低80。主机不能代替必需J1UI20/J4UI10。

| 样本 | 已观察结果 | 验收范围 |
|---|---|---|
| 设备J1 camp-muwx271t-main | 17提交跨多身份，v5首阶段完成，v12/v17采用，v19准备invalid；续跑与r6采用到v24 | 各修复接线诊断，尚非完整最终UI20；旧第三阶段因到期被误授成功，新UI提示待复核，不冒称成功救援 |
| 设备J4-B camp-muwx271t-bmuwyibwh | UI从v12回退建分支，保留 | 分叉入口；完整UI10未齐 |
| reaccept-sealed/J2 camp-j2-muwz0se8 | 9实际主线决定，r2/r3自动采用，第9次自然completed立即停 | 自然结束机制；低于J2要求20，不刷数；起始源码2d4fa112…受后续修复影响 |
| reaccept-sealed/J3 camp-j3-muwz22pd | 2次后零体力非法零消耗；原意图恢复第3次仅增1叙事；随后采用并再3决定，另一新任务缺后果定义invalid | 实际故障/恢复和采用；当前6提交，非完整20 |
| reaccept-sealed/J4A camp-muwx271t-sealed-j4a-v12 | 同只读v12生产分叉，2次后旧承诺引用拒绝；修复后新任务采用但无可执行主线停止 | 同基点成立；未齐各10与后续回响 |
| reaccept-flow-final/J3 | 从原J3诊断继续3次，累计9提交；新self配旧promise、缺resolved效果来源被离线复现 | 触发R10闭包修复；不与新战役合并为20 |
| reaccept-flow-final/J3-long camp-j3-muxhum6f | 新长篇3提交，首阶段成功自动修订；后续失败后primary=null漏排重规划而停止 | 触发R12本地触发修复；旧源码诊断 |
| reaccept-flow-final/J3-final camp-j3-muxiiccg | 新长篇3个有界提案任务后采用；8提交，首次failure后7次success；计数超过门槛，resolved仍仅full_success产生，连续5决定无阶段变化即停止 | 结构可达但必须等待更高检定结果，重复劳动与节奏不足；一个后果即时触发不满足两个持久后果；不刷数补20 |
| reaccept-flow-final/J3-replanned | 在J3-final的v8只读副本上，显式请求换思路；生成加一次修复共2HTTP，新增0决定 | 离线检查修复响应：completion仍要求self resolved，所有outcomes/consequences却均无resolved效果，正确invalid；原版本保留，不自动重放 |
| reaccept-flow-final/J2-final11 | 两个提案任务各2HTTP仍invalid；第三任务派发后发现生成示例eventType格式错误，停止驱动；新增0决定 | 共5次预留，4次已有响应、1次sent按未知留账不重放；触发R17提示/解析合同修复，不能算最终调查旅程 |
| reaccept-flow-final/J2-final12 camp-j2-muxl5l45 | 修正事件示例后152.684s/2HTTP生成ready；2次决定分别failure/severe_failure，局面到期；生成加修复的重规划仍缺resolved效果来源而invalid | 共8HTTP、新增2决定、无可执行主线停止；期限未误授奖。不能补generic探索凑20；之后仅字体原生/UI变化，预载核心身份保留 |
| 设备final14新J1准备 setup-world-src-7f45fe0b11ea30ec-muwccd51-muxlzs5h | 原创J1Final、序7、长篇、完整保护意图；推荐目标1HTTP，生成加修复2HTTP，0决定。关系奖励用fromActorId漏targetId导致TypeError及retryable_failed | 触发R19，响应离线复现、保留。final15重入另有opening_goal 1HTTP；恢复该规划仅解析原响应，按字段错误invalid，该任务仍2HTTP，未重发 |
| 设备final15新J1第二准备 setup-world-src-7f45fe0b11ea30ec-muwccd51-muxmcuzc | 修正奖励合同后生成加修复2HTTP，0决定；第三阶段completion引用新self中未创建的promise-roland-shelter | 正确invalid，无TypeError；保留该任务，不能采用。内容结构仍需通过门禁，不把拒绝算完整J1 |
| 设备final15新J1第三准备 setup-world-src-7f45fe0b11ea30ec-muwccd51-muxmhe15 | 生成加修复2HTTP，0决定，skill_rank.rank仍是数字1 | 正确invalid；触发R20补齐提示与修复反馈的合法等级清单，不把数字自动改成某一等级，不再使用这份旧提示派发 |
| 设备final16新J1第四准备 setup-world-src-7f45fe0b11ea30ec-muwccd51-muxmwu9x | 同序7、原创J1Final、长篇、完整保护意图；204.336s、生成加修复2HTTP得到ready，技能奖励rank=novice | 原响应保留；R21后final17原样重新解析、编译、校验通过，plan contentHash相同。final17冷启动提案恢复并实际采用；原campaign_plan仍2HTTP，重入另有opening_goal 1HTTP，分别记账 |
| 设备final17 J1 UI旅程 camp-muxn9k9t（final17身份980cb370） | 5提交后第6次提交遇"所选路径已不在当前可用办法中，请刷新后重新选择。"安全拒绝，驱动器把它当硬失败中止 | 后续同界面重选后同动作v7入账仅证明过期选择可恢复；原planner账本另有503失败且旧代理缺响应指标，上游结果无法仅由重选成功定谳，详见接手审计。跨身份不计最终UI20，保留为诊断 |
| 设备final18 J1 UI旅程 camp-muxpraio（final18身份c12623bd） | final18 APK（install -r保留数据）经正式开局入口新建：序7罗兰决定探视女巫、边陲镇、原创J1Final、长篇、推荐探视/查真相目标（未含明确救援承诺）（opening_goal 1HTTP，模型原文采用；ADBKeyBoard/Maestro中文输入在API37均不可用，见驱动记录）；生成1HTTP一次通过ready（无修复请求），采用后node-meet-anna直接active。23次已提交行动（final19审计：最后五次空效果重复不计，最多18次待评估，不满足20）：阶段轨迹meet-anna成功→roland-trust失败→mine-collapse失败→（自动重规划）second-chance失败→anna-bond成功→walls-and-gates成功→verdict-day开放；3个节点奖励入账，rev1→rev6共5轮重规划采用+1次invalid正确拒绝（零重发）；阶段失败→清primary→自动重规划→second-chance全程真实发生。**节奏停滞复现**：重规划生成的roland-trust阶段三个办法的employment_granted+resolved全部只在full_success档，success档仅推进未接入completion的计数，停滞守卫（5决定无进展）四次触发自停，靠重启续跑完成 | final18 UI20未完成；A36内容质量FAIL的诊断证据；本战役模型未生成持续后果（A19真实证据仍缺） |
| 设备final18 J4 UI旅程 camp-muxpraio-bmuxs9rng（同final18身份） | 经游戏菜单"回退到上一状态（v27）"UI分叉创建分支（父分支/历史隔离经DB验证：main 28回合、分支37=27继承+10新增）；**分支上10个新决定（v27→v37）** | final19审计：十次新增均为重复观察/询问，effects=[]、无新增发现或主线变化，不计有效UI10；同基点分叉入口成立 |

设备基点 .tmp/phase9/reaccept-final-tree/stable-source-v12.sqlite；关系证明 reaccept-device/fork-branches.json。只读复制，不覆盖App数据库。

每段身份在本段identity.json或UI start行，最终安装在 reaccept-device/identity.json。当前生产源码7813f21fae13fb2a3538f9601d6d381f8049670bc5e274ca7bd168b50a041ceb、identity scope v3（加入实际打包的version.json；旧身份不改写），APK见FINAL_REPORT。J3-final启动身份是4123…，运行期间仅移动布局变动，主机预载核心未变；JSONL的live源码哈希不被冒充为预载执行身份。之后期限归约与奖励解析又修改核心，故这些真实区间均保留诊断，不能称最终同身份80。

真实故障修复：

- 可选技能元数据吞掉talk/observe绑定：按动作/目标匹配，设备关系/知识/阶段后果恢复。
- 当前已发布选择被相邻未采用原文阻塞：验证决定点/绑定/意图后消费已有闭包；伪造或过期不能绕过门禁。
- 自身node_succeeded无法推进：编译拒绝；无局面远期concrete改provisional。
- 重规划遗漏已采用条目：effective catalog与锚点过滤，绑定变化stale。
- 新方法无法兑现旧局面承诺：允许当前分支既有局面，仍拒未知/跨分支；生产采用→执行→兑现→完成回归。
- 零体力consumeResource(0)：剔除无操作并保持正数硬门；真实原回合复用成功Planner恢复。
- schedule引用未定义后果：两请求内invalid，不补造；补全生成合同consequences结构后继续真实核查。
- J3-long失败后漏重规划已修复：生产失败提交、无奖励、一个排队任务、随后本地休息0HTTP验证；真实完整连续失败仍待新旅程。
- 期限误授成功已修复编译与运行时：已有部分计数再到期也不能满足正向resolved完成条件，正常成功/独立counter路线和旧终态保留。未改写历史样本为成功救援。

最低矩阵未达成；仅计有合理玩法目的的已提交玩家决定，管理/轮询/重试/空动作/结束后动作不计。持续后果需隔两决定影响人物或办法，pending队列本身不够。

调用与耗时见manifest、llm_request_attempts、各段JSONL和FINAL_REPORT。历史313为估计；开局73.975s/1请求、131.971s/2请求，以及J3-final第三提案111.194s/2请求已观察；该段8决定约11–20s，通常Planner+Narrator两物理请求。没有匹配性能基线，不称速度改善或稳定P95。误启动父目录导入产生2个sent未知请求已停止，单列、不自动重放、不计旅程。

## final19接手核验

实际安装APK哈希912616136a023d5fbe6984eea570092ec2ff6ed55d126a7a17e715bc8408848b；保留原SQLite、两条分支、旧规划与请求原文。只读设备快照quick_check=ok，见reaccept-device/handoff-readonly.sqlite及reaccept-handoff-audit-final19.json。J1 v24–28与J4 v28–37的effects均为空，后者十次中包括两次severe_failure，但没有新增知识或后续机会，同样不能算有效决定；重启驱动器不能重置停滞并凑数。J1至少排除五次，余18也仅为可评估上限，不宣称全部合格。

离线用新门复核final18原始归档：r2的罗兰差事与r5矿区调查确实没有普通success完成效果来源，均被识别；其它四份归档没有此特定缺陷。原计划没有修改或重新归档，检查结果不改变旧旅程。实际六维质量仍FAIL。

final17故障记录须分别保留：final17-j1-after5.sqlite有planner:camp-muxn9k9t-main:turn-0007的http_server/503失败，代理没有对应已收到响应的指标；随后过期指引拒绝与重新点选成功是另一段诊断，不能用后者证明前者上游结果已知。旧代理会在网络断开时合成503，新代理已纠正并以本地真实断网和生产账本验证未知结果不自动重发。驱动器仅对明确的过期指引重新读取资格，通用“操作未完成”不再自动重复提交，无主线方法时也不再兜底刷generic按钮。

## final19–final21真实收尾与架构交接

final19在同一主分支v28通过UI准备后续主线，生成加一次修复2HTTP，r7 hash 42b6b300f3f09caec7edbef3f7ad8e9ba152752bb8a25d87d0faeced4ca6ddf0，采用到v29。保留粗节点node-verdict-day仍占primary，新concrete node-report-prepare仅available，UI没有新办法；触发R26。准备后续主线是管理操作，不计玩家决定。

final20（源码54c5b85a12d95c76cfd4db04cf5154fed6364ae40f1d2f43a96d76f11851ac7d、APK3d9931b0797c1e7260ef3954b49f6792a893fc7796e19aea0069ab24030bcae2）：本地短休v30通过统一进度归约激活node-report-prepare，同一r7归档和binding不变；UI出现当面回报供述/摸清裁决日的安排/养伤备战。界面另有1次narrator_guidance刷新，不能称整条UI链零HTTP。最初私有驱动器错误断言零HTTP，已按持久账本纠正，没有重放短休。

随后UI当面回报供述v31普通success：旧局面中v23创建的promise-report-anna在同事务兑现，node-report-prepare成功；conseq-carter-wary同v31调度并触发，不能计隔两决定的持续后果。自动后续生成加修复2HTTP，r8采用到v32（hash b4ee1b7bc835a71522bf14a80c346b8d7da4a9d2eac58d389a75d4661b7b2494），node-final-plea正确active。

UI当面向罗兰进言v33普通success，自然completed/ending-pardon/改判之约，立即停止玩家决定。实际叙事为罗兰允许玩家在裁决日代安娜发言，仅取得发言资格；原始目标是“潜入城堡探视被囚禁的女巫，查明她被囚禁的真相”，不是显式成功救援合同，不宣称安娜已释放或改写确定死亡。结束后仍显示旧首阶段夜攀城墙，触发R27。

final21（源码7813f21fae13fb2a3538f9601d6d381f8049670bc5e274ca7bd168b50a041ceb、APK42bbcd35cc600c9d42a127fd9552fcc13605b80e58ff81acf2ec77bcc8d66eb8）保留数据安装，实际安装hash核对一致；在原v33冷启动复验已结束主线卡、阶段列表、最终叙事和campaign_ending事件，旧战役办法退出，世界普通探索仍可用。runtime/全部工件hash逐项保持原样，旧承诺保持fulfilled，原分叉仍v37。复验新增0玩家决定、0HTTP，预算1055/1100。证据reaccept-device/final21-ending-reacceptance.json及natural-ending/ending-review/ending-narrative截图；final20失败截图保留。以上三个新增决定跨身份诊断，不能补成最终同身份J1 UI20。

清理经正式模型配置UI恢复真实GLM端点，Keychain引用保留；核对后停止本轮PID/命令行/监听端口均匹配的QA代理。字体1.0、1080×2400、Gboard，原模拟器/数据库保留，App在配置保存后force-stop。证据final21-cleanup.json。
