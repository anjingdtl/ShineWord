# 第六阶段测试结果

| 阶段 | 命令/场景 | 退出码/结果 | 证据与边界 |
|---|---|---|---|
| P6-0 | git merge-base --is-ancestor 5103397 origin/main | 0 | 基线 HEAD 与方案提交相同 |
| P6-0 | npm ci / npm ci --prefix mobile | 0 | Node 24.19.0，成功安装 |
| P6-0 | npm run verify:core（未修改基线） | 0；620/620 | /workspace/scratch/phase6-baseline-core.log；纯工程，不是真实 API 验收 |
| P6-0 | npm run build:core + node --test tests/phase6-contracts.test.cjs | 0；3/3 | legacy range / source membership / frozen intent 合同 |
| P6-0 | npm run typecheck --prefix mobile | 0 | /workspace/scratch/phase6-baseline-mobile.log |
| P6-3 | npm run verify:core | 0；741/741 | phase6-core.log，含完整旧回归、新协议/事务/故障；没有跳过/删除/降低断言 |
| P6-3 | npm run typecheck --prefix mobile / git diff --check | 0 / 0 | production UI、host、session、存档接线 |
| P6-3 | ledger/provider/Android DB定向 | 0；73/73 | phase6-ledger-races.log，含双host、sent原子、未知结局、真正连接失败、429、删除queued、冷cache事务 |
| P6-3 | M5定向隔离编译 | 0；19/19 | phase6-publication-final.log，fence/source/canon/review后写、通用actor负例、旧delta事务重基 |
| P6-3 | sourceImport + 10%粗读协议 | 0；6/6 | phase6-survey.log；码点含emoji、缓存、错误引用、删除、所在地值；合成不证明真实内容 |
| P6-3 | 原生standalone Debug / API30安装 | 0 / Success | phase6-apk.log；boot_completed=1，首配屏截图在私有scratch；最终改动需重建 |
| P6-4 | 首轮 npm run verify:core | 1；748/751 | 3 个 runtime 夹具缺新增端口，修复后不跳过断言 |
| P6-4 | npm run verify:core（修复后） | 0；752/752 | phase6-p4-final-core.log；迁移、恢复、旧回归、新开局合同 |
| P6-4 | build:core + segments/runtime/incremental/campaign/migrations | 0；39/39 | phase6-p4-retest.log；API更换新冻结intent/unknown阻断/旧操作FK |
| P6-4 | NPC物品与发现投影修复后的 campaign/segments/runtime | 0；23/23 | phase6-p4-final-targets.log；本地commit，不在后台写人物 |
| P6-4 | npm run typecheck --prefix mobile / git diff --check | 0 / 0 | phase6-p4-mobile.log |
| P6-5 | npm run verify:core（最终内容接线后） | 0；761/761 | phase6-p5-complete-core.log；包括证据确认→段知识→下一动作NPC载入、旧全量回归，无 skipped/todo |
| P6-5 | npm run typecheck --prefix mobile / git diff --check | 0 / 0 | phase6-p5-complete-mobile.log；定向 knowledge 集成 9/9 |
| P6-5 | 真实第一后段补建与采用 | 完成，74.368 秒 | MEASUREMENTS.json；抽取1次+映射2次；第二次仅抽取，映射请求上限阻断，未算通过 |
| P6-5 | 真实风格独立分析 | ready，13.507 秒 | 之前 prohibitions 字符串失败保留；仅提示词闭合说明修复，解析门禁不变 |
| P6-6 | npm run verify:core | 0；761/761 | phase6-final-core.log；0 failed/skipped/todo，版本0.6.0下全量 |
| P6-6 | npm run typecheck | 0 | phase6-final-typecheck.log |
| P6-6 | npm run typecheck --prefix mobile | 0 | phase6-final-mobile.log；UI文案最后修复后再检见phase6-final-mobile-after-copy.log |
| P6-6 | npm run verify:version / git diff --check | 0 / 0 | 0.6.0 / versionCode60000，全部元数据同步 |
| P6-6 | npm run apk:debug --prefix mobile | 0；BUILD SUCCESSFUL | phase6-final-apk-after-copy.log，最后native/JS包2m8s；JDK17/SDK36/NDK27/Gradle9.3.1；102.01MiB，独立bundle，非真机性能数据 |
| P6-6 | learned-source基线修复后的style/campaign/save定向 | 0；28/28 | phase6-final-style-archive.log；两次归档、source→custom→preset→source、零新分析请求、重hash越权拒绝 |
| P6-6 | npm run verify:core（最终基线修复后） | 0；762/762 | phase6-final-762-core.log，0 failed/skipped/todo |
| P6-6 | 最终 npm run apk:debug --prefix mobile | 0；BUILD SUCCESSFUL | phase6-final-style-apk.log；3m19s（含软件模拟器资源竞争）；102.02MiB，独立bundle；不能当设备性能 |
| P6-6 | npm run typecheck / npm run typecheck --prefix mobile（最后编辑后） | 0 / 0 | phase6-final-last-typecheck.log / phase6-final-last-mobile.log |
| P6-6 | API30最终APK install-r / dumpsys | 0，Success，60000/0.6.0 | final-style-install.log；系统服务启动初期首次失败不隐藏，重试通过 |
| P6-6 | API30 UI早期尝试 | 当时系统ANR阻断，后续已恢复 | 保留system/SystemUI/dialer历史事件；最终实际流程见DEVICE_RESULTS，不再以已恢复的系统对话框宣称永久阻断 |
| P6-6 | 第二后段单attempt显式恢复、真实映射与采用 | 0，32.069秒，1次HTTP200 | second-followup-recovery-results：29739 input / 2595 output（reasoning47包含在output），3成果采用，stateVersion 0→0；53事实与3次抽取attempt均未增加；原unknown和审批时间保留 |
| P6-6 | PR #10实际Core CI，代码head717fd68 | success；762/762 | [37083488005](https://github.com/anjingdtl/ShineWord/actions/runs/37083488005)，deterministic-core 51秒，0 fail/skipped/todo |
| P6-6 | PR #10实际Android CI，代码head717fd68 | success；BUILD SUCCESSFUL | [37083487998](https://github.com/anjingdtl/ShineWord/actions/runs/37083487998)，android-debug job 5m28s，Gradle 4m32s；无编译失败 |
| P6-6 | Android重复键盘避让修复后的全量/类型/版本/diff | 0；762/762，0 skipped/todo；类型/版本/差异0 | phase6-final-keyboard-core.log、root-typecheck/mobile/version；设备首次tone点击focused=true，输入calm-direct后仍focused=true，完整字段位于keyboard上方 |
| P6-6 | 键盘修复最终standalone Debug构建/升级 | 0；BUILD SUCCESSFUL / install-r Success | phase6-final-keyboard-apk.log（2m56s），final-keyboard-install.log；106974675 bytes，SHA256 4a6a88cea82daf0d2d1adc914cb987049ddaada4b7667f2f9710829b4a5a4693；保留userdata |
| P6-6 | 键盘修复head fc6c475实际Core CI | success；762/762，48秒 | [37086252161](https://github.com/anjingdtl/ShineWord/actions/runs/37086252161)，version60000/0.6.0门禁通过 |
| P6-6 | 键盘修复head fc6c475实际Android CI | success；6m5s，Gradle5m14s | [37086252100](https://github.com/anjingdtl/ShineWord/actions/runs/37086252100)，移动typecheck及Debug构建通过；本地另验证standalone bundle |
| P6-6 | API30真实连续回合/短休/分支/SAF导出 | 两模型回合、短休+30分钟、独立fork及save7导出成功 | 4次实际GLM HTTP200：2.722/7.667/3.506/8.726秒；导出68504 bytes，stateVersion3/clock40、4历史快照、3turns、自定义calm-direct/learnedSourceBaseline与冻结风格保留；不是设备90秒统计结论 |
| P6-6 | API30正常save7导入/冷停一致性 | 0；integrity ok/FK0，v3/clock40 | 两段历史正文与冻结styleSnapshot和导出值完全一致；原main v3/fork v2保留；误选TXT已知JSON失败保留，正确选取后正常校验导入新campaign |
| P6-6 | 原生范围/准备恢复追加修复：build:core + opening-policy/segments | 0；20/20 | phase6-scoped-identity-tests.log；两端裁剪/跨章/异步精确hash与身份、冷投影、暂停、unknown不审批、删除迟到失败 |
| P6-6 | 追加修复全量verify:core/root typecheck/mobile typecheck/version/diff | 0；766/766，无skip/todo；其余0 | phase6-scoped-final-core/typecheck/mobile/version.log，全量97.452秒（与APK并行，非运行性能） |
| P6-6 | 追加修复standalone Debug | 0，BUILD SUCCESSFUL，2m50秒 | phase6-scoped-final-apk.log；106974099bytes，SHA256 2e8bd3a1a83a6a1a00b7e3c681a1031362c3f9218fd006aa6ff9ab1021607619；正确TXT旧包原生7/8失覆盖负例保留，端上复测另列 |
| P6-6 | 范围/准备恢复head 4cdaace实际Core CI | success；766/766，44秒 | [37099516040](https://github.com/anjingdtl/ShineWord/actions/runs/37099516040)，版本一致门禁通过 |
| P6-6 | 范围/准备恢复head 4cdaace实际Android CI | success；5m28s | [37099515993](https://github.com/anjingdtl/ShineWord/actions/runs/37099515993)，移动类型检查及Debug构建通过 |
| P6-6 | 精确构建恢复/实际账本投影定向 | 0；32/32 | phase6-recovery-race-tests.log，跨域/foreign IDs、CAS takeover、旧registry/timeline/world shared协议、共享done缓存与API切换阻断 |
| P6-6 | 请求恢复修复首轮全量 | 1；778/779 | phase6-recovery-final-core.log，旧pending split恢复1失败，保留原断言并修复prepare事务缓存保留 |
| P6-6 | 拆批兼容修复定向 | 0；37/37 | phase6-recovery-split-tests.log，5.949秒，旧包构建/精确恢复/增量映射 |
| P6-6 | 修复后最终 npm run verify:core | 0；779/779，无skip/todo | phase6-recovery-fixed-core.log，63.816秒；不以工程时长冒充设备性能 |
| P6-6 | 恢复修复 root typecheck / mobile typecheck | 0 / 0 | phase6-recovery-race-typecheck/mobile.log；最后UI措辞mobile复查另列 |
| P6-6 | 最初追加APK遗漏Gradle环境 | 1，wrapper direct网络拒绝 | phase6-build-replay-final-apk.log，恢复已配置代理/cache/JDK/SDK；不是业务编译错误 |
| P6-6 | 请求恢复standalone构建（后续Root修复前） | 0，BUILD SUCCESSFUL，2m23s | phase6-recovery-final-apk.log，之后发现Gradle仅跟踪mobile源码，增加root引擎bundle输入并重建，不能当最终APK |
| P6-6 | 最终core输入完整standalone Debug构建 | 0，BUILD SUCCESSFUL，1m34s | phase6-final-core-inputs-apk.log，createBundleDebugJsAndAssets实际执行；107006711bytes，SHA256 9a1e20acb67b0bc6f39da8698ca6ffaf277a4d33ad2e818205b0c6ab16f881c5，bundle5406816bytes；非设备性能 |
| P6-6 | 最后UI措辞mobile typecheck / version / diff | 0 / 0 / 0 | phase6-recovery-final-mobile/version.log，60000/0.6.0 |
| P6-6 | 请求恢复head bb7065a实际Core CI | success；779/779，30.368秒测试 | [37104816451](https://github.com/anjingdtl/ShineWord/actions/runs/37104816451)，0fail/skipped/todo、version60000/0.6.0；精确head bb7065aac63bd04886eb3196e92c90de1f13f665 |
| P6-6 | 新APK原生保留数据升级 | 0，Success，60000/0.6.0 | recovery-final-install.log与package.txt，lastUpdateTime2026-10-03 07:00:38；升级中UI首次50秒超时保留，不能计新版UI通过 |
| P6-6 | 请求恢复head bb7065a实际Android CI | success；6m5s，Gradle5m13s | [37104816437](https://github.com/anjingdtl/ShineWord/actions/runs/37104816437)，移动类型检查及Debug构建通过 |
| P6-6 | Native逐attempt审批与冷停恢复 | 通过；integrity ok，0自动发送，停止run全部字段不变 | native-approved-replay-cold.sqlite及native-replay-ui-results；取消后重开同1attempt，ordinary resume/API入口隐藏，正常Alert审批后unknown/null用量保留，replay_approved_at写入，attempt数1、QA计数5不增；模型构建须另点继续 |
| P6-6 | Scoped canon冲突/展示审批/旧包/投影定向 | 0；46/46 | phase6-final-canon-review-tests.log，7.894秒；canonical冲突阻断+审查+零mapper+unverified排除、review事务fence回滚 |
| P6-6 | 追加严格类型首次 | 2，TS18048 | phase6-final-native-review-core.log；snapshot显示项可能undefined，修复为显式runtime guard，未用断言/关闭严格检查 |
| P6-6 | 最新 npm run verify:core | 0；781/781，无skip/todo | phase6-final-native-review-fixed-core.log，93.198秒；与APK/软件VM并行，非设备性能 |
| P6-6 | 最新mobile typecheck / version / diff | 0 / 0 / 0 | phase6-final-native-review-fixed-mobile/version.log，60000/0.6.0，root严格typecheck由verify:core实际执行通过 |
| P6-6 | 最新Standalone Debug APK | 0，BUILD SUCCESSFUL，2m19s | phase6-final-native-review-fixed-apk.log；107004131bytes，SHA256 5b67a1bc31fab1a9475bf0fb4f52eca97518cddc4d055faa6f8a6a9f6bb9ab08；真实bundle重建，尚须设备复测 |
| P6-6 | 第一Native真实抽取/质量门禁 | 抽取完成，冲突阻断，0artifact | QA6 HTTP200/39.881秒/5065in/2982out/cached0，28facts/24entities；冷DB integrity ok/FK0；不能将抽取成功等同开局发布，也不能称设备90秒达标 |
| P6-6 | 冲突审查head ee09cb4实际Core CI | success；781/781，32.231秒 | [37108580877](https://github.com/anjingdtl/ShineWord/actions/runs/37108580877)，0fail/skipped/todo，版本一致 |
| P6-6 | 冲突审查head ee09cb4实际Android CI | success；Gradle5m2s | [37108580871](https://github.com/anjingdtl/ShineWord/actions/runs/37108580871)，移动类型检查及Debug构建通过 |
| P6-6 | 最新APK保留数据安装/正常逐事实审查 | install-r Success；审查队列1→0 | canon-review-final-install.log、canon-review-details/canon-review-resolved；引用不足身份正常转为待核实资料，未降低门禁，模型attempt仍6；后续发布结果单列 |
| P6-6 | Native TXT缓存发布/冷停验证 | ready；completed；integrity ok/FK0 | native-first-published-cold.sqlite：45entries/117citations、0..6400CP；27explicit+1speculation、审查/审计resolved、speculation未引用；0重复抽取/映射，旧unknown/null用量保留。独立style QA7 HTTP200/13.207秒/1713in460out |
| P6-6 | 开局目标请求治理/未知/删除/预算/缓存定向 | 0；34/34 | phase6-opening-goal-governance-tests.log；含4新用例、旧建议与M6故障，既有SQLite账本/Android串行adapter |
| P6-6 | 新治理首轮mobile typecheck | 2，TS2322 | phase6-opening-goal-mobile.log；共享hash端口允许sync或async，按M0已有语义修复签名，不用类型断言 |
| P6-6 | 新治理最终verify:core（含root typecheck） | 0；785/785，120.047秒 | phase6-final-opening-governance-core.log，0fail/skipped/todo；与TCG及APK争用，不是设备性能 |
| P6-6 | 新治理mobile typecheck/version/diff | 0 / 0 / 0 | phase6-final-opening-governance-mobile/version.log，V0.6.0/60000 |
| P6-6 | 新治理standalone Debug | 0，BUILD SUCCESSFUL，3m7s | phase6-final-opening-governance-apk.log，实际root bundle；107008727bytes，SHAdca2affe691424e622e6fd2f0ffdb92cda3470f0a183b940907d8101fc2284d6 |
| P6-6 | Native后台两个抽取期间连续两回合/宿主退出冷恢复 | 通过已取证范围；v2、4模型请求成功、integrity ok/FK0 | native-after-host-exit-cold.sqlite；两个P2 6400..9600/9600..12800抽取完成但3事实冲突阻断，两次interaction completed，无新unknown；不能计两个后段采用通过 |

后续按实际命令、退出码、场景和未验范围追加。小说全文、凭据、未脱敏请求和构建产物不入库。


P6-1/P6-2 基础定向验证（2026-10-02）：`npm run build:core` 退出 0；`node --test tests/phase6-*.test.cjs` 退出 0，76/76 通过。覆盖真实流式 UTF-8/GBK 夹具、持久索引/别名/权限/损坏、并发与持久资源队列、段计划/需求去重、映射范围/fencing、成果 hash/事务采用、风格三模式/用户覆盖/重试。均为可执行协议/故障测试，非真实模型内容或设备性能结论。移动端 `npm run typecheck --prefix mobile` 退出 0。



P6-5 探索中的真实样本（非性能完整验收）：用户授权小说原始字节为GBK（native GB18030解码），7,178,905 字节，3,460,333 规范化码点、1504 章；GLM-5.3-Flash、low、同一 Linux 主机。全新本地项目一次定向抽取，导入 9.142 秒、抽取及发布 42.859 秒、TTFP 52.046 秒，29 facts / 6 events / 1 artifact；1 次真实 HTTP200，provider usage 5064 input / 2995 output / 8059 total，cached input 5056。服务端缓存为热，不能称全冷样本或真机数据。负例以及已有响应本地修复后的成功分别记录，不能合并为稳定成功率。



恢复前历史模型付费口径：私有验收数据库账本25条succeeded / 1条outcome_unknown，input120012 / output48257 / reasoning1406（reasoning包含在output内，不再相加）。初始直接连接探测不在这些数据库内，不能把这个总计当服务商账单总额。第二后段unknown为sent后私有transport请求上限在fetch前抛错，按生产保护保守保留，未自动重发。

最终真实测量元数据见 MEASUREMENTS.json，逐项验收见 ACCEPTANCE_MATRIX.md。BuildTTFP从source-active至已验证成果：42.859秒；9.142秒导入单列；52.046秒从harness导入开始至成果，**不是Android UserTTFP或稳定90秒保证**。没有同质量旧/新对照、P50/P95样本集或独立人工标注，不宣称相对提速30%/等待降低50%等指标已经达标。





追加真实调用后，8个私有验收库逐库汇总为26 succeeded / 1 outcome_unknown，149751 input / 50852 output / 1453 reasoning（包含于output）。原未知记录不是删除或改判成功：私有脚本第六次请求在fetch前被上限拒绝，核对源码、5条HTTP结果和唯一目标attempt后，仅登记该attempt显式replay审批，追加映射1次通过。此恢复不放开任何新的未知结局，未再抽取，未重复全书构建。早期连接探测仍排除于账本总计。



编码复核纠正：授权小说完整字节strict GBK解码成功，UTF-8 strict失败；Android imported_sources.encoding=gbk/status=active，byte_length=7178905/code_point_count=3460333。原文档UTF-8标注错误已纠正，不改变此前真实API的hash/坐标/Token/耗时证据。


| 阶段/场景 | 命令/退出码 | 结果/场景 | 证据与边界 |
|---|---|---|---|
| 2026-10-03：跨API未知结果审查修复 | build:core + node --test tests/phase6-opening-goal-governance.test.cjs | 0，5/5，302.103ms | 相同语义先unknown，再换端点/模型/推理预算，真实SQLite仅1物理调用和1logicalID，unknown/null usage/未审批保留；不借成功缓存掩盖未知 |
| 2026-10-03：稳定语义ID最终全量 | npm run verify:core | 0，786/786、119273.318ms，0fail/skip/todo | phase6-final-semantic-core.log；root严格typecheck包含，未删除/绕过测试 |
| 2026-10-03：稳定语义ID移动与版本 | npm run typecheck --prefix mobile；npm run verify:version；git diff --check | 各0 | phase6-final-semantic-mobile.log、phase6-final-semantic-version.log |
| 2026-10-03：稳定语义ID独立Debug | JAVA_HOME=JDK17 ANDROID_HOME=SDK36 GRADLE_USER_HOME=toolchains/gradle npm run apk:debug --prefix mobile | 0，BUILD SUCCESSFUL 3m10s | phase6-final-semantic-apk.log；107008739bytes，SHA256 64b766bb3c5b6cccaf2478f8b9eb462439c029e3287a1bdc5976535d9a5b2f75，root源码bundle已重建 |
| P6-6 | 开局建议治理head98fe882实际Core CI | success，786/786，20.553秒 | [37123405204](https://github.com/anjingdtl/ShineWord/actions/runs/37123405204)，0fail/skip/todo，版本一致 |
| P6-6 | 语义ID候选安装与冷启动 | install-r Success，正常Library恢复 | phase6-final-semantic-install.log、semantic-final-library-projects；保留userdata，无应用JS/Java新异常日志证据 |
| P6-6 | 开局建议治理head98fe882实际Android CI | success，BUILD SUCCESSFUL 3m43s | [37123405202](https://github.com/anjingdtl/ShineWord/actions/runs/37123405202)，移动类型及完整Debug通过 |
| P6-6 | Native映射后正常暂停与空闲冷停 | paused_user/validating；integrity ok/FK0 | native-user-paused-cold.sqlite；known mapping QA15 HTTP200/25.915s/23665in2130out，租约清空；三互补冲突resolved审计+初始speculation审计共4，0conflict，不强杀在途请求 |
| P6-6 | Native第一后段冷重启/显式继续/缓存发布 | 2ready，后段4/4 completed，0新模型调用 | native-paused-cold-hub + native-first-followup-ready-check；暂停未自动撤销，done映射检查点复用，QA计数仍15；分支采用继续单独验证 |
| P6-6 | Native第一次后续采用/短休 | v2 binding1→2，正常短休30min到v3，0上游 | native-first-adopt-later-active/rest-active诊断：2turn、2interaction、2actor、2正文、2风格整行不变；v0/v1历史snapshot不变，live v2只更新segmentContentBinding。首次要求live snapshot全部字节不变的过宽断言失败，核对后改正范围，最终cold复核另列 |
| P6-6 | 第二Native后段真实映射 | HTTP200/63.233s、32257in/5307out/cached0 | QA16，reason15包含output，finish stop；正在本地验证/发布，HTTP成功不等于成果已ready |
| P6-6 | Native连续两回合与后台时间线复核 | 两操作completed，217928ms/66995ms | 第一操作08:35:36开始，与P2请求9/10重叠；P0请求11/12在两P2 HTTP响应之后发送。无KVM本地准备/持久化耗时大，不能宣称P0实际HTTP与P2并发、P95≤2秒或真机体验 |
| 2026-10-03 新草稿来源投影：build:core + incremental/artifacts/publication-safety | 0 | 33/33，实时与done缓存一致、raw/cache/事实不变、跨批推断、异定义审查、已恢复失败历史计数、M5严格伪装/缺失/冲突负例 | phase6-provenance-build.log / phase6-provenance-targeted.log |
| 新草稿来源投影：npm run verify:core | 0 | 789/789，130811.769ms；包含root严格typecheck | phase6-provenance-full.log |
| 新草稿来源投影：npm run typecheck --prefix mobile | 0 | mobile严格TS | phase6-provenance-mobile-type.log |
| 新草稿来源投影：npm run verify:version / git diff --check | 0 / 0 | V0.6.0/60000/schema31/save7不变；仅buildTime随APK变化 | 2026-10-03实际执行 |

新草稿来源投影standalone Debug exit0，Gradle3m31s；APK 107011275 bytes，SHA256 5890c8160c4a837d889634e9e9c06f360a6ee3f56fb8a7c89c1a5cd2508ec641；包含本次root源码真实bundle。



| 阶段/场景 | 命令/退出码 | 结果/场景 | 证据与边界 |
|---|---|---|---|
| c867284实际Core CI37126959080 | 0/success | 789/789、29590.983ms | phase6-ci-provenance-core.log |
| c867284实际Android CI37126959212 | 0/success | mobile严格类型及Gradle4m26s | phase6-ci-provenance-android.log |
| effective-units首次扩展全量回归 | 1 | 790总/788过/2失败：新增测试子输入hash复制父值触发唯一约束（fixture已修正）；既有120ms G0心跳计时在构建/TCG竞争下失效，保留日志，最终需复测 | phase6-effective-units-full.log |
| effective-units中间APK构建 | 1（主动停止） | 独立复审发现对象键序误冲突，停止中间构建并使用canonicalStringify后重新完整bundle；不把中间包计最终候选 | phase6-effective-units-apk.log |
| 最终复审修复：npm run verify:core | 0 | 790/790、146327.166ms；G0原90ms TTL测试未改且通过，split/replan及canonical键序全部通过 | phase6-final-review-core.log |
| 最终复审修复：npm run typecheck / npm run typecheck --prefix mobile | 0 / 0 | 两严格TS实际各执行，未跳过门禁 | phase6-final-review-root-type.log / phase6-final-review-mobile-type.log |
| 最终复审修复：npm run verify:version / git diff --check | 0 / 0 | V0.6.0/60000、schema31/save7不变 | 实际执行 |
| 最终复审修复：standalone Debug | 0 | Gradle3m51s，root源码完整bundle重建；107011415bytes，SHA256 15469a83d8e210b4333cbf9abf0fd9e92306f76903d0a8daf0762b82ae5cd272 | phase6-final-review-apk.log |


| 场景 | 命令/退出码 | 实际结果 | 证据与边界 |
|---|---|---|---|
| 最终源码37149b4 PR实际CI | Core/Android success | Core790/790、24319.737ms；Android移动严格类型0/Gradle4m57s | [37127895769](https://github.com/anjingdtl/ShineWord/actions/runs/37127895769)、[37127895770](https://github.com/anjingdtl/ShineWord/actions/runs/37127895770) |
| 用户授权安全快进main | ancestry/ref/checks核对，force:false，成功 | main5103397→37149b4；完整提交历史保留，PR10自动merged；无tag/Release | authorized-main-published.json私有审计；GitHub实际main ref/PR核对 |
| 最终生产源码main Core CI | success/0 | 790/790、30663.543ms，0fail/skipped/todo | [37129047811](https://github.com/anjingdtl/ShineWord/actions/runs/37129047811)，phase6-ci-main-core.log |
| 最终生产源码main Android CI | success/0 | mobile严格typecheck0；Debug BUILD SUCCESSFUL 5m20s | [37129047814](https://github.com/anjingdtl/ShineWord/actions/runs/37129047814)，phase6-ci-main-android.log |
| 最终APK原生缓存恢复/两次采用 | 正常UI和空闲cold SQLite核验0 | 第三artifact ready、binding1→2→3；M7已完成mapping0重复付费，历史冻结整行保持 | native-second-recovery/adoption结果与native-three-artifact-final-cold.sqlite；QA18/19后续维护是独立新抽取，不伪称整个Play路径0HTTP |
| 实际opening_goal治理 | 正常UI+冷DB核对0 | QA17 HTTP200/2.792s，唯一M6账本；返回再重开0HTTP，历史QA8不补造 | native-governed-goals-results.json；235in41out，low/1024reserve/2224wire |
| 未来两段真实冲突/正常停止 | 正常UI/最终cold核对0 | 两抽取HTTP200但canon冲突阻断；stopped_user/lease null，保留diagnostic和done，未发布 | native-buffer-stop-results.json；对应内容审查仍未验，不能把HTTP200算成果通过 |
| 正常三成果save7导出/导入 | SAF UI成功；verify-three-save.py exit0 | 新独立campaign v4/clock70、3artifact/5history/4turns、2正文/2行动冻结风格精确保留；branch身份合法重绑定；旧两个mapping整行不变 | native-three-artifact-save-results.json/cold.sqlite；349607bytes/SHA db2b8b7a2ebaaea05b5233631dbbb2c54afdb0d3384894a76a0ed721ab07aee5，integrity ok/FK0，0新模型请求 |
| 最终证据文档版本/格式检查 | npm run verify:version；git diff --check，各0 | V0.6.0/60000，JSON元数据可解析；源码无新增改动 | 仅文档不重复APK/模型构建；最终main Core push另实际核对，Android路径过滤不触发 |

最终测试记录保留全部失败、缓存和恢复步骤。云私有执行证据不可假定存在本地开发机；本地agent应按progress.md及交接提示重新记录当地环境与可执行结果。最终文档提交的Core CI结论在推送后检查并随交付提供；源码相同的Android CI使用上述main源码run，不能伪造文档head的运行。

私有QA收尾：19次计数不变，确认0在途后停止唯一临时转发并移除ADB reverse18765；保留userdata及全部私有证据，qa-cleanup-results.json。
