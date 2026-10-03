# 第六阶段持续建设状态

- 仓库 `/workspace/ShineWord`，任务分支 `feat/phase6-progressive-build-and-writer-style`，main 基线含方案提交 `51033973445825f01b730b7e62eec0a3352414e1`。唯一集成负责人 root，M0～M9 已接入生产路径。
- 阶段提交：P6-0 `fdf4612`、P6-1 `a60093a`、P6-2 `6614585`、P6-3 `a71beb4`、P6-4 `16231fe`、P6-5 `f053c1b`、P6-6 `717fd68`；键盘修复 `fc6c475`；范围身份/准备恢复修复 `4cdaaceb87e79da07ebae4881a85c96ccd88596d`。没有 reset/clean/force push，没有合并/tag/Release。
- 当前阶段：P6-6 最终端上复测和交付记录。PR https://github.com/anjingdtl/ShineWord/pull/10 open/mergeable，最新代码已推送；实际 Core CI 37099516040 success（766/766、版本一致），Android CI 37099515993 success（移动类型检查与Debug构建）。旧 head 两项 CI 均通过。
- 最新本地门禁：verify:core 766/766、root/mobile typecheck、verify:version、diff check、standalone Debug 全部 exit0。最新 APK 106974099 bytes，SHA256 `2e8bd3a1a83a6a1a00b7e3c681a1031362c3f9218fd006aa6ff9ab1021607619`；已 install-r 保留数据。命令日志 phase6-scoped-final-*.log 在私有 scratch。
- 已完成真实资源：授权 GBK 长篇全量导入；Linux 新本地项目合格成果52.046秒（热缓存n=1），两个后段各发布/采用、3成果、复用53事实与抽取；独立风格分析。不能称稳定90秒或设备性能达标。
- 已完成 API30 正常 UI：全长GBK source active；真实世界包导入；三种风格/自定义编辑；本地开局；两连续真实GLM回合；短休、回退分叉、save7导出/正常导入、冷停 DB integrity/FK/正文与冻结风格完全一致；错误 JSON/ZIP 小说入口已拒绝。
- 已解除规划阻断、仍须完整链路：正确 UTF8 TXT source `src-947164f49fe41d01-murtgya9` 已 active（76178CP/35章/74chunks），旧 APK 切边批规划7/8门禁失败，0新增模型请求。新 APK 显式复制 SourceChunk 完整身份/分离异步，未放宽覆盖断言；Node/移动编译回归通过，原生新规划8/8已冷DB验证，完整发布/回合补建复测继续。失败诊断现在持久化且有显式准备重试，暂停/unknown/删除保护有事务故障测试。
- 外部未验：真机与Android15/16/API24、独立人工内容/风格标注、同质量统计性能对照。详见 ACCEPTANCE_MATRIX/DEVICE_RESULTS，不以工程通过关闭未验场景。

## 当前复测与下一步（持续更新）

1. 原生规划7/8已经解除：最新冷DB实际1 unit/8 ranges、连续0..6400CP，完整身份保留。私有转发第5attempt漏配代理直连被拒，账本network_unknown且零自动重发；前4为已知HTTP200。项目已正常停止、空闲App冷停，自有QEMU33397暂停仅为避免构建资源竞争。
2. 新M6 typed恢复/审批、M3/M7实际账本、M9正常逐attempt Alert及单独继续、M4映射关联、回合审批唯一所有者已实现。独立审查复现的旧协议恢复、租约CAS、done检查点覆盖三个缺口均修复。32定向与旧包/拆批37定向exit0、root/mobile类型/version/diff exit0；首轮779中拆批1失败已修复，最终779/779全量exit0（63.816秒）。APK审查补root共享引擎输入，最终standalone构建exit0、1m34s、实际重新bundle，107006711bytes/SHA9a1e20acb67b0bc6f39da8698ca6ffaf277a4d33ad2e818205b0c6ab16f881c5，正在保留数据install-r。
3. build environment必须使用GRADLE_USER_HOME=/workspace/toolchains/gradle、JAVA_HOME=/workspace/toolchains/jdk17、ANDROID_HOME=/workspace/toolchains/android-sdk；遗漏产生wrapper直连拒绝，不是代码构建失败。私有forwarder重启必须NODE_USE_ENV_PROXY=1 NODE_USE_SYSTEM_CA=1。
4. 新APK保留数据升级已Success。正常UI取消后重开同第5unknown，再明确确认；冷DB证明run所有字段完全不变，1attempt/unknown/null用量保留，only replay_approved_at新增，0自动发送。只在正常UI明确单独继续后允许新调用；保留5个计数、总上限16，后续unknown仍立即停车。不得离线改库审批/清库/重置未知。继续真实TXT发布、开局、至少两个后段/采用、连续游玩、暂停恢复、风格与save7。
5. 本次修复提交bb7065aac63bd04886eb3196e92c90de1f13f665已非force推送；实际Core CI37104816451（779/779）和Android CI37104816437均success，前head两项成功。完成可执行复测/修复后提交清晰追加commit、非force推送、核对最终head实际CI；文档/PR同步最新证据，停止私有forwarder并清理ADB reverse（无在途时）。

检查命令：npm run verify:core、npm run typecheck、npm run typecheck --prefix mobile、npm run verify:version、git diff --check、npm run apk:debug --prefix mobile。小说、凭据、未脱敏请求、DB、截图和APK不入仓库。已通过的检查只有新改动/失败才重跑。


最新Native复测（2026-10-03约07:25 UTC后）：第6QA attempt真实HTTP200、39.881秒、5065in/2982out/cached0；28facts/24entities、冷DBintegrity ok/FK0。首发布被1真实身份冲突阻断（未降低门禁）。实际ReviewDiagnostic保留，旧代码误package_finalize_failed无review入口；现SelectedCanon显式冲突IDs+既有canon_conflict审查、fenced/current-row审查事务已实现。M9先await resume控制后refresh恢复轮询，冷书库未完成查询显示读取状态。M6审批展示字段核对新负例。46定向exit0；严格type发现displayed可能undefined已显式guard修复，最终781全量session90886、mobile/version/diff session93932、新root输入完整standalone APK session9528在执行。现安装APK仍bb7065a/9a1e...，原生App已正常空闲force-stop，QEMU33397继续运行避免长暂停ANR，无在途模型，私有forwarder新session10133保留6计数（5已知HTTP200、旧第5unknown显式审批）。新APK完成后保留数据install-r，自动本地缓存finalize应出现canon_conflict/查看审查；正常UI逐事实将引用不足的现代身份转待核实，然后单独继续，27合格事实仍须20/人物/地点/事件/行动/引用闭包，不能离线修库/吞冲突。之后继续Native开局、两次后段/采用、连续游玩、暂停恢复与含段binding存档；文件picker用观测DPAD焦点，滚动受TCG影响尝试长手势/观测键盘焦点，不盲目点击。新增修复尚未commit，前headbb7065a实际Core779/Android均green，最终必须再提交/推送/检查新headCI。测试文档和PR仍须统一最终真实范围，不能宣称稳定90秒或整阶段全部验收。
