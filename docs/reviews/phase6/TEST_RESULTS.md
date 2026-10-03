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

后续按实际命令、退出码、场景和未验范围追加。小说全文、凭据、未脱敏请求和构建产物不入库。


P6-1/P6-2 基础定向验证（2026-10-02）：`npm run build:core` 退出 0；`node --test tests/phase6-*.test.cjs` 退出 0，76/76 通过。覆盖真实流式 UTF-8/GBK 夹具、持久索引/别名/权限/损坏、并发与持久资源队列、段计划/需求去重、映射范围/fencing、成果 hash/事务采用、风格三模式/用户覆盖/重试。均为可执行协议/故障测试，非真实模型内容或设备性能结论。移动端 `npm run typecheck --prefix mobile` 退出 0。



P6-5 探索中的真实样本（非性能完整验收）：用户授权小说原始字节为GBK（native GB18030解码），7,178,905 字节，3,460,333 规范化码点、1504 章；GLM-5.3-Flash、low、同一 Linux 主机。全新本地项目一次定向抽取，导入 9.142 秒、抽取及发布 42.859 秒、TTFP 52.046 秒，29 facts / 6 events / 1 artifact；1 次真实 HTTP200，provider usage 5064 input / 2995 output / 8059 total，cached input 5056。服务端缓存为热，不能称全冷样本或真机数据。负例以及已有响应本地修复后的成功分别记录，不能合并为稳定成功率。



真实模型付费口径：私有验收数据库账本25条succeeded / 1条outcome_unknown，input120012 / output48257 / reasoning1406（reasoning包含在output内，不再相加）。初始直接连接探测不在这些数据库内，不能把这个总计当服务商账单总额。第二后段unknown为sent后私有transport请求上限在fetch前抛错，按生产保护保守保留，未自动重发。

最终真实测量元数据见 MEASUREMENTS.json，逐项验收见 ACCEPTANCE_MATRIX.md。BuildTTFP从source-active至已验证成果：42.859秒；9.142秒导入单列；52.046秒从harness导入开始至成果，**不是Android UserTTFP或稳定90秒保证**。没有同质量旧/新对照、P50/P95样本集或独立人工标注，不宣称相对提速30%/等待降低50%等指标已经达标。





追加真实调用后，8个私有验收库逐库汇总为26 succeeded / 1 outcome_unknown，149751 input / 50852 output / 1453 reasoning（包含于output）。原未知记录不是删除或改判成功：私有脚本第六次请求在fetch前被上限拒绝，核对源码、5条HTTP结果和唯一目标attempt后，仅登记该attempt显式replay审批，追加映射1次通过。此恢复不放开任何新的未知结局，未再抽取，未重复全书构建。早期连接探测仍排除于账本总计。



编码复核纠正：授权小说完整字节strict GBK解码成功，UTF-8 strict失败；Android imported_sources.encoding=gbk/status=active，byte_length=7178905/code_point_count=3460333。原文档UTF-8标注错误已纠正，不改变此前真实API的hash/坐标/Token/耗时证据。
