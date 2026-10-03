# 第六阶段持续建设状态

- 工作仓库 `/workspace/ShineWord`，分支 `feat/phase6-progressive-build-and-writer-style`。基线 `51033973445825f01b730b7e62eec0a3352414e1` 已包含方案；基于最新 main，不回退、不 reset/clean/force push。
- 唯一集成负责人 M0 root。阶段提交：P6-0 `fdf4612`；P6-1 `a60093a`；P6-2 `6614585`；P6-3 `a71beb4`；P6-4 `16231fe`；P6-5 `f053c1b`。
- 当前阶段：P6-6 最终回归/版本/文档已完成，762/762核心、root/mobile typecheck、version/diff门禁通过；最终0.6.0 standalone Debug APK成功。API30最终install-r成功，60000/0.6.0确认；UI被system/SystemUI ANR阻挡，恢复尝试和未验记入DEVICE_RESULTS，继续PR/CI。
- M1～M9 已生产接线，复用既有事实库、stage coordinator、ledger、lease/host；合同、数据所有者、迁移和协议说明见 BASELINE_AND_CONTRACTS.md 与各阶段 REVIEW。
- 最新开局决议：冻结 opening-90s-3，一次精准抽取，小说输入≤模型上下文10%且≤6400码点，同时受总输入/输出/推理预算约束。真实证据本地编译基础行动规则，数值默认 rule_mapping；20事实/人物/地点/事件/行动/引用/冲突门禁不降低。旧冻结配置仍可恢复。
- P6-5 修复：兼容已发布事实只用于必要依赖闭包；变化映射不重投影历史lore；嵌套条目ID随不可变新版本正确重映射；已采用段的证据确认接入玩家知识；下一动作fenced本地commit载入NPC；有界原生hash批次和读缓存减少长篇导入bridge往返。
- 真实资源：仅用户提供小说与GLM测试凭据。新本地项目TTFP52.046秒，29事实/6事件/1成果，1次HTTP200，服务端缓存热，最终策略n=1不能宣称稳定90秒。第一后段74.368秒完成发布/采用；第二后段抽取完成，映射触及私有测试请求上限并保留unknown，禁止自动重发。更早修复样本两次真实回合成功。风格真实分析ready13.507秒；三模式本地快照通过。无人工评分/真机/同条件性能对照。
- Android：JDK17/SDK36/NDK27已配置，最终Debug构建通过，旧Debug安装通过；无KVM，API36软件启动失败，API30 TCG启动/首配/书库通过。长篇旧导入hash阶段缓慢，新增批hash需最终APK重测。模拟器已重启，userdata保留。私有真实世界归档已合法导出，用于本地UI流程验证，不代表端上真实模型链路。
- 凭据、小说、响应、SQLite、APK仅留私有scratch/dist，不入库。停止新增付费测试；unknown不自动重发。证据计数/时长仅收脱敏MEASUREMENTS.json。
- 剩余可执行：P6-6commit；push/PR main/实际CI失败修复；模拟器UI若恢复继续取证。真实设备/统计性能/人工质量与第二后段unknown仍为未验。
- 命令：npm run verify:core；npm run typecheck；npm run typecheck --prefix mobile；npm run verify:version；git diff --check；JAVA_HOME=/workspace/toolchains/jdk17 ANDROID_HOME=/workspace/toolchains/android-sdk GRADLE_USER_HOME=/workspace/toolchains/gradle npm run apk:debug --prefix mobile。
- 交付边界：仅PR，不合并main、不打tag、不发布Release。工程通过不等于内容/风格/设备/性能全验收通过，外部未验列出复测步骤。
