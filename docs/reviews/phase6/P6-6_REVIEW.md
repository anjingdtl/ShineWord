# P6-6 回归、文档与交付审查

基于 P6-5 f053c1b，集成负责人检查生产调用、兼容协议、跨域所有权、阶段记录与真实证据。

- 全量回归未删测试、未改CI门禁避错、无 permanent-off 功能开关；新段默认生产入口，旧冻结任务恢复入口保留。最终核心 762/762、core/mobile 类型检查通过。
- 本轮新能力按 VERSIONING 升 MINOR，根/移动 package 和两个 lock、Android versionName/code、README/CHANGELOG 同步 0.6.0/60000；新增CI版本门禁。没有执行版本规范中的 main 合并/tag/Release步骤，用户只授权PR交付。
- 发现旧 ImportNovelCard 留有「前30%后开局」文案，改为实际证据门禁小段开局与后续全书窗口。该组件不改变执行协议，移动 typecheck 与最终重新 bundle 的 standalone Debug APK通过。
- 最新 main 再 fetch，仍是方案 5103397；ancestor通过。保留工作分支提交，不 reset/clean/force push。
- Android原生有界hash批次已进入实际APK；APK校验包名 com.shineword.app、60000/0.6.0、minSdk24、compileSdk36以及bundle，构建成功。模拟器升级/流程记录 DEVICE_RESULTS，不替代真机及Android15/16生命周期证据。
- 文档口径逐项检查：52.046秒为导入至已验证成果，排除人工开局表单；本地新项目/服务端热/n=1；最初第一后段采用成功、第二后段映射未完成；后续单attempt恢复完成见追加记录；风格人工评分、三题材召回、真机/统计性能均未完成。缺失项不从矩阵移除。
- 私有凭据精确匹配检查在候选跟踪文件中为0；全文、SQLite、响应、截图、APK仍在忽略/私有目录，PR只提交工程夹具与脱敏计数/时长。

阶段门禁与实际CI以 TEST_RESULTS、FINAL_REPORT最终记录为准。此阶段交付不等于A01～A18所有外部验收通过。

最后存档审查发现：项目切到preset/custom后导出，再导入空设备切回source时，分析profile未导出导致已学习表达丢失。M8保留闭合的sourceBaseline（styleId/profileVersion/semantic），随已有绑定hash归档；不导出未完成分析/付费账本、不伪造分析profile。旧绑定无该字段仍读取，已有source绑定可推导，UI从同一pinned baseline预览。增加跨模式/双跳/原著基线/用户覆盖/重hash越权负例测试，最终核心762/762；类型与APK重检。


设备继续恢复后的审查追加（2026-10-03）：

- 原授权TXT实际字节为GBK兼容，整个文件strict GBK解码成功、UTF-8 strict探测失败，Android manifest encoding也为gbk；纠正文档旧UTF-8标注，实际raw hash、规范化hash/坐标与模型测试数据不变。完整旧导入已active、1504章/3260chunks，早期staging快照保留为过程中状态。
- 第二补建曾由私有transport第六次计数在fetch前拒绝，核对源码/五次已知HTTP/唯一attempt后明确审批该attempt，保留unknown历史与审批时间。一次追加映射32.069秒完成、三个成果采用，53事实与三次抽取attempt不变，状态版本0不变。没有自动unknown重发或重复全书抽取。
- 实际编辑键盘弹出后，Android adjustResize已缩小窗口，而三屏KeyboardAvoidingView又应用padding，导致输入区裁剪和第一次焦点丢失，首次测试自定义字段未写入，不计编辑通过。WriterStyle/Opening/Profile改为仅iOS使用padding；Android复用既有adjustResize。该修复不改变Keychain或数据协议。root/mobile类型、version/diff、核心762/762及新standalone Debug构建已通过；最终设备编辑复测结果记于DEVICE_RESULTS。
- 717fd68代码提交的GitHub Core/Android CI已success；键盘修复后的最终head再次运行两项CI，精确记录见TEST_RESULTS。main仍5103397，原7阶段commit SHA通过Git数据库API完整保留，所有ref更新force=false、前后校验remote base，没有merge/tag/Release。

追加原生预检审查（2026-10-03）：

- SAF自动化最初误把自身save7 JSON作为小说选取；哈希acbe.../68504bytes证明它不是授权UTF8样本，不计小说导入通过且0新增上游。修复TXT-only pickTextRef入口，存档/世界包仍走原pickNovelFile，不改旧任务/旧存档读取。实际UTF8样本947164.../234276bytes/76178CP/35章/74chunks已active。
- 旧APK正确TXT仍在范围裁剪后出现analysis plan7/8门禁失败；未发送模型、未降低覆盖/质量断言。Node TS与移动Babel/terser完整规划可行，不能把具体Hermes根因当作已证实。coordinator三处范围路径分离读取/哈希并显式保留chunkId/chapterId/chunkIndex；批规划失败增加有限missing-ID元数据诊断。
- 准备失败发生在run创建前，之前仅UI错误而段仍planned。M3现在持久化execution_prepare_failed/failed_retryable，冷投影保留；显式本地retryPreparation遵守暂停/来源/删除/unknown约束。SourceImport重导入、ProjectHub真实重试入口只启动目标段，复用原M4 run幂等与lease，未建立第二执行账本。
- 新增异步边缘/跨章/typed accessor记录的身份和精确hash回归，以及准备冷恢复、暂停/unknown、删除迟到错误负例；定向20/20与全量766/766退出0，无skip/todo。根/移动类型、版本/diff、standalone APK通过（2m50s，SHA2e8bd3a1a83a6a1a00b7e3c681a1031362c3f9218fd006aa6ff9ab1021607619，106974099bytes），install-r后的原生复测仍在进行，不提前宣称端上修复已通过。


追加请求恢复与并发审查（2026-10-03）：

- 正常原生重导入证实新规划为1 unit/8 ranges、连续0..6400CP，数据库integrity ok，原7/8阻断解除。第一次调用因私有QA转发器漏配云代理直连拒绝而产生network_unknown；未知账本保守保留，未自动重发，不称供应商故障或模型内容通过。
- 发现构建任务仅按错误码投影未知结局，网络错误会显示可继续。新增M6强类型只读恢复/逐attempt审批端口；M3、M7、项目投影及切API/继续控制均读取实际既有账本。M9展示准确请求时间/种类/输出预算，确认只写replay_approved_at，不清unknown/用量或用户暂停，另一次明确继续才允许发送。回合审批也集中到同一M6所有者。
- 共享映射以冻结租约/fence登记RunPlanState.mappingRequestIds，规划更新保留该集合；完成开局不因别段unknown锁定。兼容旧run范围映射、严格run/world/hash的registry/timeline；未登记关联的旧world-shared job-map hash仅在未完成旧最终化任务保守恢复，不猜坐标或创建账本身份。
- 独立只读审查合成复现三个真实缺口：旧协议unknown未关联、renew/release读写间隙清除接管者租约、stale pending覆盖done映射。逐一修复并增加故障/竞态测试。租约获取事务返回实际token，续租/释放及heartbeat使用原子条件；已过期所有权不续租。既有M4检查点原子prepareMappingJob返回并保留兼容完成提案，stale pending不能清除成果/用量，无第二缓存、事实库或租约。
- 32项定向协议/事务/故障测试exit0，包含跨run/world/kind、精确审批/后续未知、无请求发送、用户控制保留、切API、删除、共享缓存并发与旧协议恢复；root/mobile类型exit0。775全量为竞态修复前通过记录，修复后的779全量及新APK正在重检，最终结果由TEST_RESULTS记录。
- 首次追加APK执行遗漏私有GRADLE_USER_HOME，wrapper direct网络拒绝exit1，未改业务源码或降低门禁。已恢复已配置Gradle代理/cache与JDK17/SDK环境重跑。

- 最终全量首次779中778通过、旧拆批恢复1失败：原子prepare覆盖pending split检查点，造成父批重复请求。修复为同一事务保留兼容done以及有结果的pending检查点；原断言不改，旧包/增量/恢复37项定向exit0（5.949秒），779全量和包含该修复的APK再次重跑。

- 拆批兼容修复后779/779全量exit0，无skip/todo，63.816秒。Android构建审查发现插件默认仅扫描mobile root，核心修复可能错误UP-TO-DATE复用bundle；app/build.gradle显式加入仓库src为bundle task输入，普通dev-server路径不变，最终APK重新打包。

- 原生逐attempt确认实际通过：取消后仍显示同1请求，审批前普通resume/API入口隐藏；正常Alert确认后冷DB run全字段完全一致、unknown/null用量保留，新增审批时间且attempt仍1、QA计数仍5。单独继续后实际GLM HTTP200 39.881秒、5065in/2982out，无缓存输入；本地发布仍继续验证。原生观察又发现resume触发refresh早于控制写入，stopped快照关闭轮询；M9改为先await既有resumeRun再启动/refresh，冷书库加载前显示真实读取状态。移动类型exit0，待空闲时重建/端上复测。诊断性运行中裸DB复制出现索引页不一致，不计数据库损坏结论，最终必须冷停完整性核对。

- 实际Native第一抽取结束：28canon facts/24entities、冷DBintegrity ok/FK0；闭包涉及1身份conflict，质量门禁拒绝发布，0mapper/0artifact。错误曾误为package_finalize_failed/failed_retryable且review列表为空，自动恢复仅重跑本地finalization，未再次请求模型。新增SelectedCanon.blockingConflictFactIds，闭包冲突走既有canon_conflict阻断/逐事实审查协议；不降低20事实或来源闭包门禁。审查写入在既有WorldStore事务中校验fence与当前conflict IDs，迟到已解决事实不能重开阻断。
- 既有ReviewPanel的unverified决定保留事实/原文/审计，但不用于映射。当前真实模型冲突值把公开王子身份与现代经历混在同一单值谓词，而现代经历引用只提供姓名片段；准备在正常界面转待核实，不能离线改库或批量waive。工程测试验证review阻断、零付费调用、unverified不出现在发布条目和事务回滚。
- 追加核对审批快照的展示kind/time/wire budget与账本逐项一致，伪造展示信息不审批。46项定向通过；全量严格类型首次因noUncheckedIndexedAccess指出snapshot显示项可能undefined，改为显式runtime guard后重跑全部门禁，未用类型断言绕过。

## 真实请求对账追加审查：开局目标建议

实际QA8目标建议HTTP200，却没有对应账本；旧OpeningScreen只调用scheduled provider，未传ledger metadata，也未冻结预算/推理计划。保留这一旧真实负例（233in/29out/1.970秒），不事后伪造历史attempt。

OpeningGoalGovernance补齐world/不可变包hash+revision/anchor/profile/plan identity；统一kernel分配内容/思考预算、P1、单物理请求和M6账本；M0 runtime.buildProvider在同一scheduler内部withLedger装配，CampaignSession识别既有包裹避免双重登记。既有失败退回手写目标，不阻塞开局；unknown保留且同逻辑ID重开不发。32项有界goal-only内存缓存共享在途请求/已知建议，错误与空结果不缓存；队列取消和项目存在检查阻止过期UI结果，已发送不假定撤销计费。

4新协议/事务测试验证跨provider并发共享、成功缓存防外部修改、真实SQLite unknown/null用量、低预算/未知能力/错误hash/删除/取消、不同包/锚点隔离。定向34/34、全量785/785、mobile/version/diff、standalone APK均exit0。第一次strict mobile hash接口sync/async不匹配已按共享Sha256语义修复。独立只读最终审查与原生修复版复测继续；构建期间不再改源。

原生第二旅程：TXT成果创建新campaign，两个连续真实回合成功，两个近期P2抽取也已完成。宿主长exec退出后保留userdata重启，冷DB integrity ok/FK0、两interaction completed/v2/4成功attempt，0新unknown；未能证明宿主退出原因，也不归咎App。两个后段被3真实事实冲突阻断，保留审查门禁并逐条核对后再继续。

## 跨API未知结果复发审查

独立只读审查合成复现，同一opening_goal未知后更换API导致2次物理调用、2条logicalID。修复将请求语义与profile/plan分离：logicalID使用world、已发布revision/hash、anchor和提示词；配置仅参与成功缓存key及既有M6 metadata。新增真实SQLite适配器测试跨endpoint/model/reasoning budget，物理调用1、唯一semantic logicalID、unknown和null用量保留，不自动批准重放。5/5定向通过；独立审查其余非probe生产调用未发现新预算/账本遗漏。无新表、无双层账本、无协议降级。

稳定语义ID候选完整standalone Debug exit0，3m10s；107008739 bytes，SHA256 64b766bb3c5b6cccaf2478f8b9eb462439c029e3287a1bdc5976535d9a5b2f75。root源码bundle实际重建，不使用旧APK。

原生后三事实逐条核对完成：安娜的女巫身份、罗兰的四王子身份、巴罗夫的助理职务，与已有较完整描述可并存，短引文确实支持待确认描述。使用正式逐事实“按补充事实保留”，不是批量豁免/离线改库；保留原范围/引用和canon_resolution审计。初始身份引用不足依然为speculation，不改原决定。后续缓存映射/发布/采用继续取证。

分支采用核对中首次断言“全部snapshot字节不变”失败；逐字段核查仅当前live v2的segmentContentBinding由1→2成果，符合已冻结M0安全边界合同。v0/v1历史snapshot逐字节不变；v2其余游戏字段、2正文/2冻结风格/2turn/2interaction/2actor整行不变。改正证据口径并按旧状态与live投影分别断言，不将合法采用报告为历史正文改写，也不隐藏初轮过宽断言失败；最终cold仍需复核。


原生第二后段 QA16 的映射 HTTP200（63.233s，32257in/5307out，思考15已含在out）后，M5 正确保存四条 inference_disguised_as_explicit 诊断并阻断。独立只读审查复现：18个新条目中四个root引用 inference 事实却标 explicit；数值字段 rule_mapping 正确，两缓存无未知事实、越界或cleaner拒绝。M4在跨批合并之后、与旧已发布条目合并之前，按权威事实状态将新草稿 explicit 降为 inferred；所有证据必须仍是已选有效事实。保留用户/原事实、raw proposal、hash、usage、mappingVersion、MAPPER_SYSTEM 和不可变旧条目；M5严格负例不变。这使兼容done缓存能零付费映射恢复，而不通过改提示词失效整个缓存。

审查同时修复两个潜在问题：草稿revision恒0导致异定义被错误合并，现对skill/constraint/lore、actor和item分别核对定义，冲突进入审查；相同定义才合并证据且保持已有inferred。地点编译保留inference类型。bootstrap来源合并改为核对当前全部unit completed、数量与unitsDone/Total一致，历史unitsFailed保持为真实失败尝试计数，不再误排除已恢复成果。定向33/33 exit0，包含实时/缓存结果一致、原raw缓存整行不变、混合和跨批推断、相同revision异定义、已恢复历史失败和fencing负例；原M5伪装明示、缺失/冲突引用和作用域负例继续拒绝。全量和APK正在验证，原生缓存恢复尚待新APK正常UI复测。

新草稿来源投影standalone Debug exit0，Gradle3m31s；APK 107011275 bytes，SHA256 5890c8160c4a837d889634e9e9c06f360a6ee3f56fb8a7c89c1a5cd2508ec641；包含本次root源码真实bundle。


独立复审c867284发现新恢复判定回归：自适应拆批/重规划保留canceled父行，但这些行已从unitsTotal移除。全量行数判断会把已完成的有效子单元误判未完成。修复为过滤canceled审计行再比较有效数量与各单元completed，同时仍要求unitsDone=unitsTotal>0。新增真实SqliteBuildRunStore两种replace事务测试，验证父行保留、半完成拒绝、全部子完成通过、计数不符拒绝；重跑全量和真实root bundle APK，不沿用789旧结果作为最终门禁。


复审还发现JSON.stringify对仅键顺序不同的嵌套actor attributes误报冲突；三处定义比较统一采用既有canonicalStringify，并加入同定义不同键序跨批缓存回放测试。独立只读复审最终确认：新provenance位于旧不可变内容合并之前、raw/checkpoint身份保持、M5事务内事实/审查二次核验不变，未发现剩余阻断问题。
