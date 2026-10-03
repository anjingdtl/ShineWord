# Android 实际设备验证与限制

记录2026-10-03。云主机2 vCPU配额、8GiB cgroup内存，无`/dev/kvm`；没有真机。实际安装JDK17/SDK36/NDK27/Gradle9.3.1、构建独立Debug APK并使用API30 TCG执行正常UI流程。最终生产源码head37149b45d948422ac99ce3e6c097f933fb929fb9已按用户明确授权推送main；实际main Core790/790及Android CI均success。

| 场景 | 实际结果 | 证据/限制 |
|---|---|---|
| 历史语义ID候选standalone Debug | exit0，V0.6.0/60000，minSdk24/compileSdk36，含index.android.bundle | phase6-final-semantic-apk.log，107008739 bytes，SHA256 64b766bb3c5b6cccaf2478f8b9eb462439c029e3287a1bdc5976535d9a5b2f75；3m10s为云构建耗时，非设备性能 |
| API36软件模拟器 | 约15分钟仍不稳定并退出 | 无KVM；不能算Android16验证 |
| API30 TCG fallback | 启动完成，最终重启267.388秒 | guest1536MiB/2cores/480×800，SwiftShader；软件性能不能类比真机 |
| 系统ANR与恢复 | 早期system/SystemUI/dialer ANR阻挡；停止构建负载、保留userdata、关闭系统ANR后实际恢复到书库 | 私有事件/树/截图保留；不是已取证的ShineWord应用异常，也不证明App全无问题。为重新构建曾暂停自己的QEMU，已恢复；该操作不算Android生命周期/性能验收 |
| 原授权长篇实际SAF导入（旧包） | 最终成功active：7,178,905 bytes、3,460,333规范化CP、1504章、3260chunks，encoding=gbk | early staging/99%快照是过程状态，现有final-native-before-keyboard-fix.sqlite完整性ok、active/章/chunk复核；全文件strict GBK解码成功、UTF-8 strict失败，原文档编码标注已纠正。旧导入未计完整wall-time，不能拿它证明新批hash提速 |
| 历史语义ID候选升级/冷启动 | install-r Success，60000/0.6.0，保留userdata；书库与1已创建campaign恢复 | phase6-final-semantic-install.log、semantic-final-library-projects.xml（先前逐事实审查/键盘版流程单列保留）；没有清数据/uninstall |
| 真实世界包SAF导入 | 正常导入后导航项目页，可游玩、2 artifacts、已学习sourceBaseline保留 | Linux真实GLM成果正常校验导出，620310-byte ZIP、SHA256 d7277618690247211a5aa43c38fa5352b697305eaadd80406381fe479ec73c12；final-world-ready/source-style树与私有DB。不是Android从TXT到模型构建的一条完整链 |
| 风格模式/编辑 | source→preset悬疑→source→custom正常保存；source回切读到已学习表达；最终custom tone=calm-direct保存并dirty清除 | 最初自定义字段因键盘焦点丢失未写入，不计编辑通过；修复后首次点击focused=true、完整输入框321–359在键盘上方，输入后值与focus都正确，最终save按钮disabled；final-keyboard-style-focused/typed、final-custom-committed |
| 键盘修复 | Android依靠既有adjustResize，WriterStyle/Opening/Profile仅iOS叠加padding；root/mobile/core/version/APK及两项实际CI通过 | 同时避免模型配置页首次失焦，端点完整输入/正常保存；不改Keychain或数据协议 |
| 本地开局 | 按实际公开锚点“罗兰决定去见女巫”、地点边陲镇、原创建卡QA，正常两步开局，进入Play | final-opening-confirm、final-native-play-ready；推荐属性/技能来自真实发布包，不是UI假数据 |
| 实际端上模型回合 | 连续两回合完成：原生Fetch→私有QA转发→用户GLM，上游四次HTTP200 | request1 1546in/96out/2.722s，request2 577in/272out/7.667s；request3 1965in/129out/3.506s，request4 1054in/285out/8.726s；final-native-turn-1-real与device-llm-results。先前QA转发器model大小写校验误拒绝403、未到GLM，修正仅测试端后原意图再试；不能把该拒绝当真实供应商故障 |
| 短休、分叉与SAF导出 | 短休推进30分钟；从v2创建fork，main保持v3；save7正常导出 | 68504 bytes，SHA acbe0a64844356d004fd45605eb7e9556fbd38c3e10ada3e60d7984b637024e2；state v3/clock40、4历史快照、3turns、自定义calm-direct与sourceBaseline及冻结风格存在；final-native-rest/rewind-complete/save-complete |
| 正常存档导入与冷停核对 | save7校验后新建独立campaign，冷停DB integrity=ok/FK=0；v3/clock40、两段历史正文与冻结风格完全一致 | final-native-save-focused-activate、final-native-save-cold.sqlite；最初键盘下移误选TXT导致invalid JSON，正确拒绝、未新建campaign；更正选择后成功，未降低校验 |
| UTF-8原生导入 | 正确TXT已active：234276 bytes、76178规范化CP、35章/74chunks，UTF-8 | raw SHA947164f49fe41d0149d27cf2d1c6fbac366431d721c7e40d3269346523a7c2f9；同授权小说80k rawCP转码。首次SAF误选own save7 JSON，不计小说验收；失败快照和0新增上游保留 |
| 原生批规划追加修复 | 旧APK正确TXT在切边后7/8失败，0上游；显式身份/分离异步修复后实际1unit/8ranges、连续0..6400CP，冷DB integrity ok；完整发布另列 | native-scoped-retest-cold.sqlite实际核对来源/章/chunk身份和准确hash；保留旧原生7/8失败及0上游，不用Node通过替代设备行为 |
| TXT类型负例 | 正常UI选自身save7 JSON，新APK明确拒绝并指向正确导入入口；0上游 | scoped-identity-file-guard-result；Source解析前拒绝，存档/世界包的独立读取入口未改变 |
| 原生精确unknown审批 | 正常UI取消后重开同一attempt，再明确确认；停止run全部字段保持不变，仅审批时间新增，0自动发送 | native-approved-replay-cold.sqlite与native-replay-ui-results；unknown/null用量保留。该unknown来自私有代理漏配环境proxy、direct ECONNREFUSED已复现；不是已取证的供应商计费失败。另点继续后QA6 HTTP200 |
| 首次原生抽取与质量阻断 | QA6真实HTTP200/39.881秒，28facts/24entities；一条身份引用不足阻断发布，0artifact | native-first-extraction-cold.sqlite integrity ok/FK0；5065in/2982out，reason13包含output，cached0。不能将抽取成功计作完整90秒开局 |
| 原生TXT缓存发布 | 正常审查后单独继续，1成果ready、45entries/117citations、coverage0..6400CP；0新增抽取/映射调用 | native-first-published-cold.sqlite integrity ok/FK0；27explicit+1speculation，原冲突/审计resolved，待核实事实未被成果引用；旧unknown/null用量与审批仍保留；独立style HTTP200/13.207s/2173tokens |
| 正式逐事实审查 | ee09安装后needs_review/canon_conflict；查看审查（1）→转为待核实资料→队列0，再单独继续 | canon-review-details/canon-review-resolved；原文9CP仅支持姓名，未据此确认完整现代背景；原事实/坐标与审计保留。已完成抽取复用，发布结果另列 |
| TXT后台抽取期间连续游玩与宿主退出恢复 | 新campaign两个真实回合均完成、v2，两个近期P2抽取均完成；后台成果仍因3条事实冲突待审查 | native-after-host-exit-cold.sqlite integrity ok/FK0、4成功Planner/Narrator、2completed interaction、0新unknown；长exec QEMU/forwarder退出原因未取证，OOM计数0，不归咎App。userdata保留重启成功，SystemUI ANR可正常关闭后书库恢复 |
| 开局目标治理新候选安装 | 新typed预算/推理/P1/账本/cache/取消接线；785/785与严格类型/version/diff及standalone Debug0；install-r Success | 107008727bytes，SHAdca2affe691424e622e6fd2f0ffdb92cda3470f0a183b940907d8101fc2284d6；真实旧QA8无账本负例保留，不能事后补造。Native建议账本复测继续 |

设备网络为单次QA localhost端点与adb reverse，私有host进程仅把原生模型请求转到用户配置的实际GLM端点并注入授权Key，最多20个QAattempt（含1个仍保留unknown的代理失败，已完成两回合4次HTTP200计数保留）。它不入仓库、不部署、不作为产品服务器；模型内容来自真实API，设备本地SQLite/规则/风格/回合均走生产路径。分别记录QAattempt与已知上游HTTP请求；模型大小写误拒绝发生在QA guard，0实际调用，保留失败与恢复证据。不会用设备软件模拟耗时替代90秒统计指标。凭据、小说、原始请求/响应、DB、截图、APK不入库。

未验：API24与Android15/16、中档真机资源/耗电/后台限制、真机锁屏Keychain/dataSync超时、真实sent强杀计费结局，以及完整主线/停留/支线、设备多部追加等尚未执行场景。Android TXT→模型构建→两个后段采用已执行，见下表；进一步未来缓冲冲突不计通过。正常世界包导入和端上回合不能替代端上构建验收；Linux两次后段发布/采用另见TEST_RESULTS。按ACCEPTANCE_MATRIX复测，保留所有失败、缓存、模型/推理/小说hash及设备/配额口径。

| 场景 | 实际结果 | 证据/限制 |
|---|---|---|
| 正式后三事实审查 | 三条互补描述逐条保留，审查队列1→0，0新增上游 | native-anna/roland-complementary、native-barov-review、native-three-conflict-resolved；保留原事实/证据和canon_resolution审计，初始1speculation不改 |
| 稳定审查页面内存快照 | 实际meminfo：PSS170134KB/RSS287360KB，Java23120KB/native42324KB，299views/1activity、swap0 | semantic-review-meminfo.txt，API30 TCG/debug/n1；不是导入峰值、泄漏结论或真机比较 |
| 最终源码37149b4 standalone Debug/升级 | build0，3m51s；install-r Success保留userdata | phase6-final-review-apk.log/install.log；107011415bytes，SHA15469a83d8e210b4333cbf9abf0fd9e92306f76903d0a8daf0762b82ae5cd272，真实root bundle；主分支Core790/790与Android CI均success |
| 第一原生后段暂停/冷恢复 | QA15映射25.915s完成后正常paused_user，租约清空；冷重启保持暂停，明确继续0重复请求发布 | native-user-paused-cold.sqlite integrity ok/FK0；done缓存原样保留；随后binding1→2与短休到v3 |
| 第二原生后段provenance失败/缓存修复 | QA16映射63.233s先被M5严格阻断；新草稿来源投影修复升级后M7正常冷启动缓存发布，3ready，0新增抽取/映射 | native-three-artifact-final-cold.sqlite最终integrity ok/FK0；两个raw mapping和旧两artifact整行不变；不改prompt/hash/version或历史provenance |
| 两次真实分支采用 | binding1→2→3，各自安全边界采用；已冻结历史、正文/风格/操作保持 | 第一次v2后短休v3，第二次v3后短休v4；live仅内容binding改变；最终cold历史v0/v1/v2/v3确认；此旅程roll_records=0，不冒称真实骰点已覆盖 |
| 实际开局建议唯一治理 | QA17 HTTP200/2.792s，235in/41out；唯一M6 opening_goal success，P1/low/1024reserve/2224wire；返回再重开0新HTTP | native-governed-goals-results.json与冷DB；旧QA8未治理调用没有补造账本 |
| 两个后续未来缓冲 | QA18/19抽取29.918/33.575s均HTTP200；新canon冲突严格阻断，正常停止stopped_user，诊断/缓存/租约状态保留 | native-buffer-stop-results.json和最终coldDB；已有3成果仍可本地短休/存档；未来两段不计发布通过，需要正式逐事实审查 |
| 三成果save7正常SAF导出 | 349607bytes，v4/clock70、3artifacts、5历史快照、4turns | SHA256 db2b8b7a2ebaaea05b5233631dbbb2c54afdb0d3384894a76a0ed721ab07aee5；native-three-artifact-exported.xml明确导出成功 |
| 三成果save7正常导入/最终空闲冷核验 | 独立camp-musi82oj；integrity ok/FK0；v4/3artifacts/5history/4turns、2正文/2行动冻结风格完全一致；原branch历史和两mapping整行保持，0新请求 | native-three-save-import-result.xml；native-three-artifact-final-cold.sqlite与native-three-artifact-save-results.json；所有历史snapshot只重绑定branch身份，manifest/artifact hash保持。并非新设备缺依赖归档流程，也不是独立真机冷启动性能 |

最终设备QA计数19（18已知HTTP200/1已审查unknown），上限20；unknown/null usage/精确审批保留，最终0queued/sent。QA19为2955input/2628output/5583total，reason9包含于output，cached0。正常存档未增加调用。额外未来两段内容审查与完整主线/停留/支线仍未完成，不关闭对应验收项。

收尾清理：最终空闲冷核验后，私有QA转发已停止，ADB reverse18765已移除；19次计数与unknown证据、模拟器userdata保留，0在途请求。没有删除项目或清空用户数据。
