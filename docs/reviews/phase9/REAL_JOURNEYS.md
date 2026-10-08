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

每段身份在本段identity.json或UI start行，最终安装在 reaccept-device/identity.json。最新生产源码53629ccff12efc738bf7e6f85c8f72bc0562241a19a3ba34aacfbd2837d9b254、identity scope v3（加入实际打包的version.json；旧身份不改写），APK见FINAL_REPORT。J3-final启动身份是4123…，运行期间仅移动布局变动，主机预载核心未变；JSONL的live源码哈希不被冒充为预载执行身份。之后期限归约与奖励解析又修改核心，故这些真实区间均保留诊断，不能称最终同身份80。

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

## eb48dae提交后的自动内容与模拟器复验

仍使用同一真实小说正式导入世界r1、序7边陲镇与现有安娜/罗兰资料；部分ready仅有1段，后段按需补建、原著将死角色成功救援持续存活未齐。未自动解决两个世界审查问题以冒充全世界通过。实际资格与上下文来自生产stores，不手填世界、提案或结局。

| 样本 | 真实结果 | 有效决定/验收范围 |
|---|---|---|
| final22 Android J1 camp-muxy5yns | 明确保护/救援/阻止处决/持续安全目标，普通success关系0→1却关闭局面、completion要求15，自动r2采用 | 1项诊断，触发R29，未完成20 |
| final23 Android J1 camp-muxyznzn | 2请求ready；递帖、发现广场事实、创建兑现承诺、阻止处决四项持久变化，n3成功/NOT镇民支持触发“代价惨重的生机”，v6停止；安娜active，n4安全available/n5支持planned | 4项诊断，过早结局FAIL，触发R30，不继续刷数或称长期保护完成 |
| final24 主机J2 | 生成加修复2请求，requires根上误放计数AST而invalid | 0决定；原响应保留，触发R31精确反馈 |
| final25 Android J1 | 合法开局、完整明确目标；2请求后材料已允许的npc罗兰目标被compile误拒 | 0决定；触发R32共用人物身份边界，原文离线编译通过、0HTTP |
| final25 主机J2 camp-final25-j2-muy0c693 | 初始2请求ready，5项推进后v8自然“称台倾向真相”，必做节点均成功、额外aftermath-watch为optional，立即停止 | 5项诊断，未齐20；一次证词+10的单位/节奏仍不足 |
| final26 主机J3 | 2请求后tone实际43字超40，旧笼统required错误无助修复 | 0决定；触发R33共享长度合同，原字段/响应保留 |
| final27 Android J1 | 2请求后期限可能被当作成功而invalid；原文还含前序成功/NOT死亡跳过后续main的出口 | 0决定；期限硬门有效，R35补齐裸前序出口检查 |
| final27 主机J2 camp-final27-j2-muy6ovj2 | 初始1请求ready；官方记录、安娜证词、矿区物证、呈递被拒、再次论证等7项；v10兑现旧交证承诺、v12新后果即时触发；后续末端node_8缺终局引用，2请求后invalid，main node5仍available | 7项人工可评估诊断，未齐20；同v12触发不计隔两决定后果 |
| final27 主机J3 camp-final27-j3-muy6xiai | 初始2请求ready；11次提交/11状态差异候选，work在v5达到20，但旧mine-aid-promise仅full_success兑现；同方法3次后停止。n4成功能跳过仍main的n5 | 仅v1/v2/v4/v5/v12共5项可评估；v6–11六次多余计数不兑现承诺/打开机会，排除。v6“救出矿工”文字未写独立事实；v12新伤势是持久损失，非延迟证明。触发R34/R35 |
| final28 high Android J1 | 正式入口保存完整中文救援目标、合法属性/技能、序7/长篇；job-setup-world-src-7f45fe0b11ea30ec-muwccd51-muy7o2nc，一次campaign_plan在300秒超时后outcome_unknown | 0决定，无重发；独立opening_goal一次成功另记。原恢复0HTTP却显示failed，触发R36 |
| final28 high 主机J2/J3 | job-setup-final28-j2-muy7pbx0 / job-setup-final28-j3-muy7pjqb，各一次规划后300秒超时、outcome_unknown | 各0决定；均无修复、采用或重放，不推断内容评分 |
| final29 同一Android未知job | 保留数据安装后冷/手动恢复均明确未知，原意图逐字段不变、campaign_plan仍1次；360/411dp fontScale2提示/控件实际可读可达 | 0决定/0规划重发；冷入口独立opening_goal 1次，预算1160→1161，单列 |
| final29 既有camp-muxpraio-main结局显示 | 原v33改判之约，主线/完成阶段/最终叙事/事件一致；snapshot/runtime/归档hash、旧承诺与v37分叉不变 | 新增0决定/0HTTP；仅显示回归，不计最终旅程或成功救援 |

上述主机均为生产CampaignSession/SQLite与实际GLM provider、非强制骰点；Android通过正式开局/行动UI。plan采用/管理/短休/轮询/错误重试不计玩家配额。计数差异工具输出仍要求语义人工复核；final27-manual-review.json排除门槛后六项，未用工具自动PASS。

| 身份（scope v3） | 生产源码SHA-256 | Debug APK SHA-256 | bytes |
|---|---|---|---|
| final22 | 943143f45e972843ee801160c11c04fdaaee981f052ee3fd7c49fbc5b67f8bf2 | 4621d914f02f34c4f3761fdbae85c9de36d3ad033adcb1d3e2ddb8f11b5e2248 | 109442367 |
| final23 | 58e8ee75c3bb7c741a814758169b1b5aefda40213989cb266018931efc3a3bf1 | bd465dde6261ba21c7304fe89d1bd4e5b6973eaf47e4730d9723b47d832a0c6a | 109450407 |
| final24 | 5877b28db5eeba8d3ae9d35ed8e5eddfdd8cd4e398563137d2dea9320c5cfaaf | 6f58ac7f7b796af2b5beb52c95799581d1c4733e769df88b0e17e28499bb051b | 109457011 |
| final25 | 9b78c6b03b5de63e22139faf103c9866113cad75573d241fb8c626e345f15a7e | 6344ae4888105e6ad4596efd6fff7a145c7edfd6b2b562cea7bf611c9a1c821e | 109457415 |
| final26 | a437fb1881932566e188bde092629fabacb2b67ff229b9b74c3a0d87f2b8cb37 | 1fb2f01c27ef4769c2b0f3e3346aa10db2d543ddd8a11a09b98cf774bd28b063 | 109457779 |
| final27 | aca9a26bba4303cdd5686df6523e4af3122f5c0d9fccf0e561bf09a88735ea81 | 22fda466b027fb5d389bc635758dd9dbf36a9b2b5be549f92e2ce2534a0cdfc8 | 109452999 |
| final28 | d531af0a507e4d161706f7a2c7d1cd9a760153594ac2271db276014502419e87 | c30576350b823eed3b5df3b3d82b1668a75fef57be834dc78b0c6af00d571f4c | 109461403 |
| final29 | 53629ccff12efc738bf7e6f85c8f72bc0562241a19a3ba34aacfbd2837d9b254 | 1b8eb52f182fe02bb6ec7fd2218cb9260b8984cc32410060041868e2109c801f | 109462083 |

各身份文件reaccept-identity-final22…final29.json；历史执行身份不改写为最终。final29没有新完整自动旅程，不能与旧诊断拼80。A15/A36仍FAIL，A19/A38仍NOT RUN；各自动计划/旅程六维分别见CONTENT_QUALITY，未达全部≥3。

实际请求预算最终1161/1500；high只作未完成的规划对照，主机content输出16384/设备默认和代理端点分别记录，不冒充匹配10+10性能。所有未知任务与原响应保留、不自动重放。恢复/大字号证据final29-j1-cold-restore.json、final29-j1-explicit-restore.json、final29-recovery-display.json；原档结局证据final29-ending-reacceptance.json。清理正式UI恢复直连GLM/low、Keychain引用逐值不变，停止PID/命令行/端口验证过的本轮代理，font1/密度420/Gboard/原库/AVD保留，App已force-stop，见final29-cleanup.json。


## 2026-10-08 final33：长规划的传输、租约和物理预算

final30诊断分别为J2 Node fetch约307.035秒断开、J3去除该隐藏响应头时限后约329.597秒上游socket hang up；各1次网络未知、0候选/0决定，不重放。运行时Node v24.14.1 / Undici7.24.4的默认headersTimeout=300000，QA换用单总时限原生HTTP，并真实转发SSE头/分块，测试覆盖迟到headers、未结束body、未知断连与预算拒绝。final31流式调查诊断三次HTTP200分别612.381/568.535/622.607秒，三次wire均24576；思考几乎耗尽输出，0业务候选，最终retryable_failed。旧调度层同预算重复3次的实际证据触发R40，不能把它称作有界候选修复，也不能称通过两请求合同；未改写其历史账本。该诊断在构建/后续修复前启动，执行身份仍绑定原文件，不升级为final33配额。

final33正式Android救援任务job-setup-world-src-7f45fe0b11ea30ec-muwccd51-muyb1p8u在约523秒、返回前台时转为outcome_unknown（Network request failed）；此前后台约58秒，进程26168存活、崩溃缓冲无异常。代理上游随后在565.527秒收到HTTP200/5026703 bytes，晚于客户端失败，不能据此认定上游超时或固定原生读取时限；RN默认读取/调用时限为0。具体原生断连原因尚未证明，规划缺少Android执行生命周期保护，作为下一修复点。原意图、冻结high/stream/32768/物理额度2及1次账本保留，0候选/0决定，禁止未知重放。此前未知任务也未重发；独立opening_goal 1次单列，共享预算1168/1500，无重置/增额。证据final33-background-failure-proof.json、final33-background-events.log和final33-j1-after-background.json；当前代理18691、原库与AVD保留，尚未最终清理配置。

生产scope v3源码1d0e6778c600e7c788c0d5fbcd4ba8c0cc09eb4c2a2e9b930a2fd7318c9ec3a7；Debug APK 3f51242ac7a6f89580d378c85b829444c2d74afe0d524773726d42cc7f1eb31b，109474379 bytes，V1.0.0 / 1000000，emulator-5556实际安装hash一致。完整核心1065/1065、0失败0跳过（reaccept-core-final33b.log，34.325s），移动typecheck、41s Debug构建、版本与diff通过。新增23项回归，所有前置RED日志保留。

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

新 final37 J1 为Android原救援意图/序7/边陲镇/long；J2调查塌方与安娜被捕关联；J3边陲镇修缮互助与长期合作。均为自动生产开局。截至00:53:25 UTC均running，J2/J3第一轮reasoning_only后使用同任务剩余请求，Android持续HOME。0新玩家决定，不能汇入80；新65536配置不修改旧冻结任务。

身份、回归、实际复现与运行中请求详情见 [FINAL_REPORT](FINAL_REPORT.md)。完整阶段仍未验收通过。


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

R48 接入按配置/档位/任务分类的真实账本反馈；完整响应与截断下界分别处理，在新战役、实际回合和记忆材料根冻结，恢复不读新历史。1108/1108核心、移动类型检查与Debug构建通过，Android同意图首次派发60921=48633+12288；候选仍在等待，不能记为旅程或阶段通过。旧归档及2个未知结果任务精确保留；预算1190/1500未重置。作用域、能力边界和证据详见[最新复验报告](FINAL_REPORT.md)。

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
