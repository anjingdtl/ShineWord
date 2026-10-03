# P6-6 回归、文档与交付审查

基于 P6-5 f053c1b，集成负责人检查生产调用、兼容协议、跨域所有权、阶段记录与真实证据。

- 全量回归未删测试、未改CI门禁避错、无 permanent-off 功能开关；新段默认生产入口，旧冻结任务恢复入口保留。最终核心 762/762、core/mobile 类型检查通过。
- 本轮新能力按 VERSIONING 升 MINOR，根/移动 package 和两个 lock、Android versionName/code、README/CHANGELOG 同步 0.6.0/60000；新增CI版本门禁。没有执行版本规范中的 main 合并/tag/Release步骤，用户只授权PR交付。
- 发现旧 ImportNovelCard 留有「前30%后开局」文案，改为实际证据门禁小段开局与后续全书窗口。该组件不改变执行协议，移动 typecheck 与最终重新 bundle 的 standalone Debug APK通过。
- 最新 main 再 fetch，仍是方案 5103397；ancestor通过。保留工作分支提交，不 reset/clean/force push。
- Android原生有界hash批次已进入实际APK；APK校验包名 com.shineword.app、60000/0.6.0、minSdk24、compileSdk36以及bundle，构建成功。模拟器升级/流程记录 DEVICE_RESULTS，不替代真机及API15/16生命周期证据。
- 文档口径逐项检查：52.046秒为导入至已验证成果，排除人工开局表单；本地新项目/服务端热/n=1；第一后段采用成功、第二后段映射未完成；风格人工评分、三题材召回、真机/统计性能均未完成。缺失项不从矩阵移除。
- 私有凭据精确匹配检查在候选跟踪文件中为0；全文、SQLite、响应、截图、APK仍在忽略/私有目录，PR只提交工程夹具与脱敏计数/时长。

阶段门禁与实际CI以 TEST_RESULTS、FINAL_REPORT最终记录为准。此阶段交付不等于A01～A18所有外部验收通过。

最后存档审查发现：项目切到preset/custom后导出，再导入空设备切回source时，分析profile未导出导致已学习表达丢失。M8保留闭合的sourceBaseline（styleId/profileVersion/semantic），随已有绑定hash归档；不导出未完成分析/付费账本、不伪造分析profile。旧绑定无该字段仍读取，已有source绑定可推导，UI从同一pinned baseline预览。增加跨模式/双跳/原著基线/用户覆盖/重hash越权负例测试，最终核心762/762；类型与APK重检。


设备继续恢复后的审查追加（2026-10-03）：

- 原授权TXT实际字节为GBK兼容，整个文件strict GBK解码成功、UTF-8 strict探测失败，Android manifest encoding也为gbk；纠正文档旧UTF-8标注，实际raw hash、规范化hash/坐标与模型测试数据不变。完整旧导入已active、1504章/3260chunks，早期staging快照保留为过程中状态。
- 第二补建曾由私有transport第六次计数在fetch前拒绝，核对源码/五次已知HTTP/唯一attempt后明确审批该attempt，保留unknown历史与审批时间。一次追加映射32.069秒完成、三个成果采用，53事实与三次抽取attempt不变，状态版本0不变。没有自动unknown重发或重复全书抽取。
- 实际编辑键盘弹出后，Android adjustResize已缩小窗口，而三屏KeyboardAvoidingView又应用padding，导致输入区裁剪和第一次焦点丢失，首次测试自定义字段未写入，不计编辑通过。WriterStyle/Opening/Profile改为仅iOS使用padding；Android复用既有adjustResize。该修复不改变Keychain或数据协议。root/mobile类型、version/diff、核心762/762及新standalone Debug构建已通过；最终设备编辑复测结果记于DEVICE_RESULTS。
- 717fd68代码提交的GitHub Core/Android CI已success；键盘修复后的最终head再次运行两项CI，精确记录见TEST_RESULTS。main仍5103397，原7阶段commit SHA通过Git数据库API完整保留，所有ref更新force=false、前后校验remote base，没有merge/tag/Release。
