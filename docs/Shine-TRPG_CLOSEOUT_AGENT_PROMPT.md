# Shine-TRPG 本地 Agent 收尾建设提示词

将下面整段交给在本机仓库工作的 Agent：

```text
请在 F:\ClaudeWorkSpace\projects\ShineWord 实际执行收尾建设，直到完成可验证的工程交付；不要只输出计划。

先阅读仓库适用的 AGENTS.md，以及：
1. docs/Shine-TRPG_PHASE2_CLOSEOUT_CONSTRUCTION_PLAN.md（本次施工总控，C0–C7）
2. docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md（P3/P4 原始出口）
3. docs/PHASE2_CONSTRUCTION_PLAN.md
4. docs/reviews/P2_ACCEPTANCE_CLOSEOUT_R6.md
5. docs/reviews/phase3/PHASE3_FINAL_REGRESSION.md
6. docs/reviews/ui/data-availability.md

本次目标：关闭二期业务遗留与第三期运行门禁，并解决真机大型TXT构建过慢、缺少真实动态进度、切后台构建失败三个问题。审查基线 fe2ff3abaf001fd76071fe2d7b507a533da4dd4f；开始时检查当前HEAD和工作区，保留已有修改，若代码已变化重新核实，不覆盖用户工作。

按C0→C7推进，每阶段实现→Review→Fix→回归→证据→阶段提交。不要把UI源码存在、桌面测试、旧APK或合成Extractor结果当成当前真机/真实模型验收。

优先顺序：
① 修mobile依赖与真实相对导入路径错误，先恢复typecheck和APK门禁；本次审查核心156/156通过，mobile typecheck失败。
② 立即修mobile/src/worldImport.ts的makeBytesSha：fileBase64非空时错误忽略bytes，导致不同章节/块都使用整文件hash，反复散列整本且可能错误跳过后续抽取。增加覆盖实际mobile适配器的回归，并处理旧错误hash、INSERT OR IGNORE残留与污染缓存，不能只改一行后继续信任旧done。保护已发布世界包、战役和旧存档。
③ 实现私有源持久化、流式解码/规范化、Unicode码点索引、自动分章、按范围读取；消除重复解析、逐块全文索引和整本base64。物理存储块与LLM分组解耦。
④ 建设持久化run/unit、DB租约与fencing、原子结果提交、事件提案checkpoint、幂等恢复；按模型上下文与输出/推理预算自动分组，超长章可切片，限流/断网可恢复；映射也按token限额分批并持久化，禁止只读前几章或以摘要冒充全量覆盖。
⑤ 真实阶段进度从DB贯通Library、任务卡与通知；给暂停/继续/失败重试入口，重进页面和进程重启后可恢复；不使用假百分比。
⑥ 实现Android前台服务+通知+独立可恢复runner，验证RN0.85.3前后台和冷启动入口；按官方Android12–16限制处理启动、权限、dataSync超时和WorkManager配额。切Home正常继续；系统回收/强停/锁屏受限时保存并恢复，不承诺永不被杀。Service存在不等于JS任务能恢复。
⑦ 补原二期disabled fate合同驱动状态机与1玩家+2同伴完整探索→社交→战斗→休整→成功训练旅程，以及知识/任务/三书/rewind/存档/迁移；完成P3/P4四主题、键盘、安全区、NPC秘密隔离、最终APK验收。

参考本地 F:\ClaudeWorkSpace\projects\TAVO-MINI 的续写模块，具体入口见总控方案第5节。只读借鉴流式导入、SourceReader、自适应分组、进度与前台服务；不得修改该参考项目。其UTF-16偏移不能直接替代Shine-TRPG的Unicode码点证据。

可用测试资源：
- LLM配置：C:\Users\Administrator\Desktop\AIstudio\Test-key\GLM-TEST.txt
- 小说：C:\Users\Administrator\Desktop\AIstudio\《白篱梦》作者：希行.txt
已授权用于本项目构建验收。配置只在进程内安全读取并使用现有Keychain，不打印原文件、key或Authorization，不写git、DB任务、AsyncStorage、命令行、截图或日志。先最小能力探针，再小样和全文；保持推理开启，记录请求/重试/token预算。不要在没有第二模型实际配置的情况下声称双模型通过。

该小说实际3,065,535 bytes，当前解析965,458码点、300章、944块；约3.07MB，不是30MB。另生成精确30MB的非私人合成压力样本。真实小说质量、端上预处理性能、合成执行器压力与全量真实模型构建分别记录，不能互相替代。质量按原二期三题材、独立≥200事实、召回≥90%、explicit引文定位100%与人工语义支持率要求验收。

必须保护：com.shineword.app、shineword.db、Keychain、已有世界包不可变版本和战役引用、.shineword-*旧导入、确定性骰点、冻结合同、RollRecord、成长与分支隔离。新增写路径/迁移独立审查，不重写稳定规则，不用any/禁用strict/删除测试让门禁变绿。

完成适当核心/mobile/native/故障注入与端上验证；性能和后台实验使用隔离数据，不能清空用户真机或既有模拟器私人数据。普通构建/修复/测试可继续推进，无需每一步重复询问。遇缺设备、第二模型或独立标注时继续完成不依赖它们的工作，并在最终矩阵明确具体未通过项，不捏造证据、不只因外部条件缺失停下所有实现。

交付：相关源码与迁移、针对性测试、docs/reviews/closeout分阶段与最终报告、与当前源码对应的签名Release APK（版本Code递增、记录hash/签名/bundle/安装证据）、更新README与DEVELOPMENT_STATUS、用户操作说明。APK/密钥/小说/私人存档与原始日志不入git。未要求推送或发布，不自动推送远端或公开发布。

最终明确三种结论：工程修复是否完成、第三期验收是否通过、二期Beta是否通过；每项给证据和剩余条件。未通过不能写“全部建设完成”。
```
