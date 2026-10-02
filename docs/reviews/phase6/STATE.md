# 第六阶段持续建设状态

- 分支：feat/phase6-progressive-build-and-writer-style。最新 origin/main 仍为方案提交 51033973445825f01b730b7e62eec0a3352414e1；保留基线，无 reset/clean/force push。
- 集成负责人：M0 root。阶段提交：P6-0 fdf4612；P6-1 a60093a；P6-2 6614585。
- 当前：P6-3 生产装配已落盘、集中 review/fix/验证；P6-4 兼容/故障修复已并行准备，尚未阶段 commit。
- 实现：M1/2 持久来源与中文索引；M3 bounded segments/合并/近期1～2 buffer；M4 精抽取/变化映射/检查点；M5 不可变成果/事务采用；M6 P0～P3/保留额度/统一账本；M7 Android现有runner/lease/host；M8 source/preset/custom/CAS编辑/本地编译/回合快照；M9 开局/项目风格/等待恢复/回合生产接线。
- 用户补充：以模型上下文10%为输入上限精准粗读小说前部的人物、地点、事件、时间线、人物关系；结果仅用于选段且逐条校验quote/hash/cp，不写事实，精抽取与20事实/可玩闭包门禁保留。缓存和故障表集中 migration30；普通回合使用既有 interaction journal 的 play_turn 类型，migration31 保留旧操作/步骤。
- 新审查修复：ledger sent原子持久；未知网络/超时禁止自动重发，明确未连接才可重试；数据库裸读写也串行于事务防止被别人rollback；M5事务内复核canon/review/fence；旧显式查书delta同事务重基artifact binding；所有本地提交防后台同版本采用丢失；普通Planner发送前interaction guard；存档v7/archivev4自包含成果/风格设置与快照且继续读旧格式。
- 已验：foundation76；controls20；lease heartbeat88；ledger等73；M5安全18；runtime/host/scheduler9；campaign/style新5+旧28；sourceImport/survey6。日志在 /workspace/scratch/phase6-*.log，最终须以最新全量结果为准。
- 环境：Node24.19/npm11.9，Temurin17，SDK36/NDK27，standalone Debug APK已成功构建。无KVM；API36软件boot失败；API30调整userdata2GB后 boot_completed=1、APK安装Success，App冷启动及UI仍在验证（系统UI ANR已单独记录，不当App性能）。
- 真实内容：用户授权私有小说约346万码点/1504章与GLM配置已使用。极短书头0fact；3200cp少事实；6400cp出现缺地点与错误所在地predicate冲突。新10%粗读/严格location值验证试验运行中，保留负例，不降低门禁。
- 私有数据只在 /workspace/scratch/phase6-private；密钥、小说全文、原始请求不得入仓。仅此任务新建AVD及工具目录可管理。
- 未完成：集中full core/mobile检查、阶段3/4commit；真实粗读开局/两次补建采用/风格/回合；最终版本、APK、UI验收证据、A01～A18矩阵、FINAL_REPORT、推送PR/CI。真机/人工标注/多题材没有资源，准确登记。
- 检查命令：npm run verify:core；npm run typecheck；npm run typecheck --prefix mobile；git diff --check；npm run verify:version；JAVA_HOME=/workspace/toolchains/jdk17 ANDROID_HOME=/workspace/toolchains/android-sdk GRADLE_USER_HOME=/workspace/toolchains/gradle npm run apk:debug --prefix mobile。
- 下一步：完成普通交互guard和新增NPC行动路径、survey生产回归；按测试修复→P6-3commit，再故障全量验证→P6-4commit；有界真实验收P6-5；版本/文档/APK/PR/CI P6-6。不得提前结束或合并main/tag/release。
