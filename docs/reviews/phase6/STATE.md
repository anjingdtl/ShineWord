# 第六阶段持续建设状态

更新时间：2026-10-03。唯一集成负责人 root；M0～M9 已接入生产路径，P6-0～P6-6 均有实现、审查、修复、验证和独立提交。

- 仓库 `/workspace/ShineWord`；分支 `feat/phase6-progressive-build-and-writer-style`。最新 main 仍为方案提交 `51033973445825f01b730b7e62eec0a3352414e1`，没有回退 main、reset/clean/force push、合并/tag/Release。
- PR：https://github.com/anjingdtl/ShineWord/pull/10，open。最新生产代码提交 `ee09cb4e014850ccec2ac9d4164275c111feac2c` 已推送；实际 Core CI [37108580877](https://github.com/anjingdtl/ShineWord/actions/runs/37108580877) success，781/781、32.231秒；Android CI [37108580871](https://github.com/anjingdtl/ShineWord/actions/runs/37108580871) success，Gradle5m2s。最终证据提交后仍须核对最终 head 两项 CI。
- 阶段提交：P6-0 `fdf4612`、P6-1 `a60093a`、P6-2 `6614585`、P6-3 `a71beb4`、P6-4 `16231fe`、P6-5 `f053c1b`、P6-6 `717fd68`。后续修复：键盘 `fc6c475`、SourceChunk身份/准备恢复 `4cdaace`、精确账本恢复/租约CAS/映射检查点/root bundle输入 `bb7065a`、逐事实冲突审查/审批展示校验/轮询与书库加载 `ee09cb4`。
- 最新本地门禁：verify:core 781/781 exit0（包含root严格typecheck）；mobile typecheck/version/diff exit0；standalone Debug exit0，2m19s。APK107004131bytes、SHA256 `5b67a1bc31fab1a9475bf0fb4f52eca97518cddc4d055faa6f8a6a9f6bb9ab08`，install-r Success，保留全部数据。
- 版本 V0.6.0/60000，schema31、save7。无第二事实库、账本或租约；恢复与审查追加使用既有表/所有者/端口，旧数据协议兼容见 COMPATIBILITY.md。
- 真实host结果：授权GBK长篇全量导入；新本地项目合格成果52.046秒（provider热缓存n=1）；两个后段各发布/采用，3成果、53事实/抽取复用；独立风格ready。不能称稳定90秒、AndroidTTFP或同质量统计提速。
- 已完成API30正常UI：GBK长篇active，UTF8同书前部样本active；真实世界包导入；三风格/自定义编辑；本地开局；两真实模型回合；短休、回退分叉、save7正常导出/导入、冷DB integrity/FK/正文和冻结风格完全一致。JSON/ZIP小说入口负例拒绝。
- 原生SourceChunk切边7/8已修复并冷DB验证1unit/8ranges、0..6400CP。私有代理遗漏产生的单unknown保留；正式UI取消后重开/精确审批/单独继续已实测，审批不改变停止run或null用量、不自动发送。

## 当前阶段与剩余工作

P6-6：继续实际TXT构建完整旅程和最终交付记录。

1. Native第6QA attempt HTTP200，39.881秒、5065in/2982out、cached0，28facts/24entities；初次发布被一条身份引用不足的真实冲突阻断。ee09升级后正确needs_review/canon_conflict，并通过正常“查看审查（1）→转为待核实资料”处理，保留原事实与证据；UI显示审查已保存且队列为空。单独继续已完成缓存发布：1ready artifact、45entries/117citations、27explicit+1speculation；冷DB integrity ok/FK0，speculation未引用，0新增抽取/映射；仅独立风格分析QA7 HTTP200；未离线改库/清冲突/降20事实门禁。
2. Native新项目开局和两个连续真实回合已完成，v2、4个Planner/Narrator成功；两个P2范围6400..9600/9600..12800均已抽取，三条identity/role冲突待正常逐事实审查，然后映射/发布/采用、暂停恢复与含实际segment binding存档闭环；任何新工程问题审查→修复→回归→commit。只在请求已知结束且任务空闲时冷停取证，不把active DB复制的瞬态错误当真实损坏。
3. 私有QA转发总计14attempt（13已知HTTP200+1已审查仍unknown），为后段及新增请求治理复测上限20，保留全部计数；NODE_USE_ENV_PROXY=1/NODE_USE_SYSTEM_CA=1，新的unknown仍立即关闭。凭据不在设备/仓库。旧长exec QEMU/forwarder退出后保留userdata重启，自有API30 QEMU43309/forwarder43382运行，无KVM，长手势1800ms可正常滚动；软件初始化慢不算真机性能。
4. 完成后统一DEVICE_RESULTS、MEASUREMENTS、ACCEPTANCE_MATRIX、FINAL_REPORT、TEST_RESULTS、PR正文；扫描秘密/原文；最终证据commit、非force推送、核对最终head实际两项CI；无在途时停止QA转发并清理ADB reverse。

外部未验：真机及Android15/16/API24，独立人工内容/风格标注，固定质量/设备/缓存的统计性能对照。已有工程通过不能代替完整A01～A18验收。

检查命令：npm run verify:core、npm run typecheck、npm run typecheck --prefix mobile、npm run verify:version、git diff --check、npm run apk:debug --prefix mobile。构建使用JAVA_HOME=/workspace/toolchains/jdk17、ANDROID_HOME=/workspace/toolchains/android-sdk、GRADLE_USER_HOME=/workspace/toolchains/gradle。已有检查仅在新改动/失败/未解决疑点时重跑。

小说、凭据、原始请求/响应、SQLite、截图、APK只留私有scratch，不入仓库。

最新追加审查：实际QA8 opening_goal旧入口只有P1 scheduler、没有账本/预算。已实现typed OpeningGoalGovernance（精确world/package hash/revision/anchor/profile/plan logicalID），统一budget/reasoning、max1物理请求、同32项有界内存缓存/并发共享、项目过期与队列取消；buildProvider从同一既有M6withLedger装配，CampaignSession不会双层包裹。新增4个有意义测试，旧建议和M6定向34/34 exit0；初轮移动type提示同步或异步hash接口不匹配，改用同M0 Sha256语义union；最终785/785全量、mobile/version/diff、完整root输入standalone APK均exit0；APK107008727bytes、SHAdca2affe691424e622e6fd2f0ffdb92cda3470f0a183b940907d8101fc2284d6，保留数据install-r Success，未提交新代码需独立review/commit/CI。此真实旧QA8未事后伪造账本，历史成本如实单列。独立只读审查继续，构建期间不再改源。

独立审查发现并复现：opening_goal将profile/plan纳入logicalID，切API会绕过旧unknown并再次发送。已将logicalID固定于world/package revision/hash/anchor/实际提示词语义，配置指纹只用于已知结果缓存及账本/队列metadata；新增同SQLite账本跨端点/模型/推理档位回归，5/5 exit0、物理调用保持1、unknown/null usage/未审批原样保留。正在运行新版本全量验证与APK，不沿用修复前785结果作为最终证据。

最终语义ID修复后本地verify:core exit0，786/786（119273.318ms），root严格type已包含；mobile typecheck/version/diff exit0。完整Debug尚在构建，工程提交后实际CI继续核对。

稳定语义ID候选完整standalone Debug exit0，3m10s；107008739 bytes，SHA256 64b766bb3c5b6cccaf2478f8b9eb462439c029e3287a1bdc5976535d9a5b2f75。root源码bundle实际重建，不使用旧APK。

新增工程修复已commit/push：98fe88282a9434510e6b61a5a94fbfe5114c996d（稳定语义开局建议、统一kernel/ledger/cache/cancel）；实际Core CI37123405204 success，786/786、20553.359ms；Android CI37123405202 in_progress。最终64b766候选保留数据install-r Success，正常Library已恢复；Native后三事实审查继续。

98fe882的Android实际CI37123405202 success，Gradle3m43s；两项CI均已成功。原生三条互补事实审查完成第一条，另外两条继续正常UI处理。

Native三互补事实审查已完成、队列0；第一后段QA15真实映射成功25.915s，正常暂停稳定paused_user/validating。冷停 integrity ok/FK0，映射success/token已入唯一账本，4canon_resolution审计，租约清空。重启后验证暂停保持及缓存恢复，再继续第二后段；私有总15QAattempt，0新unknown。

冷启动后的正常Hub明确仍“已暂停/整理已暂停”，QA15计数不增；已单独正常继续第一后段，验证done检查点零重复映射。第二段仍待显式继续，两个ready后采用/存档闭环继续。

Native第一后段已在cold restart后的显式继续完成不可变发布，Hub2ready/4-of-4 completed，QA仍15，映射检查点复用未重发。现在先正常进入已有camp-mus4u8cl完成第一次采用/本地短休快照，再第二后段继续构建与独立第二次采用。

Native首次后续采用v2：binding1→2，v0/v1历史snapshot、2正文/2风格/2turn/2interaction/2actor整行不变，当前live v2只改segmentContentBinding（符合安全边界合同）；首次误将live也视为全部不可改snapshot的诊断断言失败，已核查修正。正常短休30min到v3，QA15不增；第二段显式继续与独立采用/完整save7继续。

第二后段QA16真实映射63.233s成功，但四个root推断标为explicit被M5正确阻断。独立审查后实现新草稿权威provenance投影（不改原facts/raw done/cache hash/prompt/version/旧发布），并修复相同revision异定义吞并和已恢复历史失败影响bootstrap范围合并。定向33/33通过；verify:core/mobile type/Debug正在运行。下一步：正常UI新APK继续第二后段，复用done缓存零付费映射，第二次采用、真实3binding存档、goals唯一账本和最终报告/CI。QA目前16 attempts，没有新增unknown。

来源投影修复全量verify:core已exit0：789/789、130811.769ms；mobile严格TS/version/diff均0。Debug正在真实root bundle构建；最新main再次核对仍5103397。

新草稿来源投影standalone Debug exit0，Gradle3m31s；APK 107011275 bytes，SHA256 5890c8160c4a837d889634e9e9c06f360a6ee3f56fb8a7c89c1a5cd2508ec641；包含本次root源码真实bundle。

已commit/push c8672841b7bb0240985cf9b2fc0d6d71ce43c0e2；实际Core CI37126959080 success，789/789、29590.983ms；Android CI37126959212仍运行。实际正常WorldDetail创建战役触发QA17目标建议HTTP200/2.792s/235in41out；唯一opening_goal ledger1成功，low/1024 reasoning reserve/2224 wire真实metadata；返回再重开正常缓存0新增HTTP，旧QA8没有补造账本。

独立复审发现isRunExtractionComplete需排除拆批/重规划保留的canceled父审计行，已修复并补真实store两路径恢复测试；全量/Debug重跑。c867284 APK已preserve-data升级，Native第二段可继续进行；最终APK将包含有效单元修复并再次install-r冷恢复验证。

独立复审已确认无剩余阻断。额外JSON对象键序误冲突已改规范化比较，新split/replan fixture的子输入hash改为各自唯一（先前触发真实DB约束，未削弱约束）；首次790扩展全量另有既有120ms心跳时间测试在TCG/构建竞争下失败，日志保留，最终全量重跑中。中间APK主动停止，最终完整bundle重建中；c867284实际两项CI均success，但这不替代新增恢复修复的最终head验证。

最终复审修复所有本地门禁exit0：790/790，146327.166ms；独立root/mobile严格TS、version/diff0；完整Debug3m51s、107011415bytes、SHA256 15469a83d8e210b4333cbf9abf0fd9e92306f76903d0a8daf0762b82ae5cd272。将按c867284为非force基线提交/推送恢复审查修复，并安装该最终包继续原生闭环。
