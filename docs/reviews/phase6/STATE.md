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
