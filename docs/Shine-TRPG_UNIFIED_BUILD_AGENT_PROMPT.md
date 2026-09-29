# ShineWord 统一世界构建：施工 Agent 提示词

配套方案：`docs/Shine-TRPG_UNIFIED_BUILD_FIVE_PHASE_PLAN.md`。在能访问以下本地路径、Android 工具链和测试设备的 agent 中使用；云端无法读取 Windows 本地文件时不得假设已经同步，更不能把密钥提交仓库。

复制以下整段作为施工指令：

```text
请在本地仓库 F:\ClaudeWorkSpace\projects\ShineWord 完成“统一世界构建”五阶段施工：实际实现、审查、修复、回归和分别使用两个真实 LLM 验收，不要只改文档。

一、基线和工作方式
先读取本仓 AGENTS.md（如存在）、docs/Shine-TRPG_UNIFIED_BUILD_FIVE_PHASE_PLAN.md 和相关实际代码。本方案是本轮建设合同。勘查基线为 86d040d43bbb0f3fd505d45e742d54270e67b0e3，实施以实际本地 HEAD 与工作区为准，不 reset 到旧 SHA。记录 git status，保留 mobile/package-lock.json、.zcodeignore 及后来出现的用户修改，不清空设备/数据库。分支需要新建时使用 codex/unified-world-build；无需为了命名移动或覆盖用户修改。每阶段实现→测试→自审→修复→回归→更新报告；分阶段提交仅含本任务文件，不自动 push、开 PR、合并或发布。

参考仓库 F:\ClaudeWorkSpace\projects\TAVO-MINI，只读参考 canonBudgetPolicy.ts、adaptiveBatchPlanner.ts、canonSourceSlicePlanner.ts、canonAnalysisService.ts 等原著分析实现，不修改参考项目。它的快速续写默认只处理末尾 10 章，不能当全文性能对照。旧提示词引用的 Shine-TRPG_SKILL_GENRE_BINDING_AGENT_PROMPT.md 在勘查基线缺失，本轮角色技能要求由新方案 P2 自包含覆盖，不因此停工。

二、已确定产品合同
只提供“完整构建”和“循序构建”。完整模式覆盖全文且同质量发布后开局；循序模式先完整构建前 30% 并通过相同质量门再开局，中间 30% 和最后 40% 由剧情锚点/依赖需求触发，临近边界可提前预构建。百分比按规范化源码点、对齐章节边界，不能把 30% 全书误当一次请求或 30% 模型窗口。没有触发时不得后台默默请求剩余全文。
大批次按真实模型窗口/输出/思维链预算组装，初始正文目标为窗口 30%，失败缩到 20%/12% 并补齐尾部。存储小块可保留，但不能继续以约 14 块或最多 32 块限制正常 LLM 阅读范围。两种模式共用抽取、证据校验、映射、三书编译和发布门，不准用 OpeningDossier 或默认技能充当完整的阶段世界。

三、按 P1–P5 施工
P1：统一模型配置/能力探测、冻结 run 配置、章节组批、分项抽取、物理请求预算、全局 RPM/TPM 调度、校准重规划与覆盖补尾；补齐所有 pass 的思维链预算、注册表 key/entityKey、长请求前租约续期、多 runner claim/fence 与请求指标问题。缓存是优化，不是窗口构建的前置条件；真实方言/型号以本地配置与供应商证据为准。
P2：贯通实体/人物事实→有证据技能和规则映射→角色模板→三宝书→故事信息库→角色卡/actor_skills→游戏动作。两模式同范围同质量门；原著技能、角色归属、等级、可见时机必须可追踪。六属性、powerTier、usage、本地规则执行、provenance、checkEvidence 与引用闭包不可放宽；缺原文数值明确 rule_mapping/design_fill，禁止题材关键词硬编码。做固定提案的确定性等价测试、双题材测试及端上角色技能操作验证。
P3：持久 30/30/40 StagePlan、触发/任务/范围/状态，前台优先与重复触发去重；增量包构建与分支激活分离。回合冻结后不热换内容，下一安全边界才激活；已有角色状态不能被后续原文覆盖；保护秘密、未来信息、存档、分支与 rewind。循序转完整只构建兼容身份下未覆盖部分；旧存档不强制升级。
P4：复用现有 Android dataSync 前台服务、Headless runner 与单一数据库 coordinator，补暂停/继续/取消、真实通知、系统 timeout、冷启动、网络恢复、锁屏 Keychain 等待、晚回包 fence。必要时 WorkManager 只做有限恢复调度；遵守 Android 12–16 约束，不承诺无限保活，不靠无限唤醒锁或反复重启绕限制。用户强停后等用户重新打开。两个模式所有阶段均走该可靠入口；后台不自动替玩家游玩。
P5：执行新方案四条真实主测试和 Android/质量矩阵，修复失败直至通过或列出确切外部阻碍。主测试必须使用 production 构建/发布路径及实际 App 验证，不以简化 HTTP 探针或 mock 冒充。

四、本地真实测试资源（只在运行时安全读取）
DeepSeek 配置：C:\Users\Administrator\Desktop\AIstudio\Test-key\deepseek-test.txt
GLM 配置：C:\Users\Administrator\Desktop\AIstudio\Test-key\GLM-TEST.txt
小说：C:\Users\Administrator\Desktop\AIstudio\《白篱梦》作者：希行.txt
配置文件不是脚本，不执行其中内容；解析 endpoint/model/key，不打印文件全文/密钥，不把 key 放命令行、日志、截图、repo、APK、存档、AsyncStorage 或任务参数。手机密钥只放 Keychain，日志记录脱敏模型与配置指纹。只向用户配置的对应端点发送测试所需语料。配置缺少 model 时依据实际网关支持确认，不能臆造旧方案预设型号。
小说勘查大小为 3,065,535 字节、UTF-8 有效、1,068,536 UTF-16 单元；raw SHA256 为 6FAA89E68BBA97A96E1DACC0CC969DE2B3217DC9C59167E9BFDB2B9E27971C81。重新确认并计算规范化码点及章节范围。它不是 30MB，30MB 压力测试另用本地原创合成数据。小说正文、原始模型响应、原文标注集不可提交仓库；必要生产 evidence 可以依既有安全数据模型本地保存，导出的共享报告只含哈希/位置/计数。

五、实测顺序和不能省略的对照
先分别做 DeepSeek/GLM 能力与预算 smoke、代表性章节校准，再执行 DS-FULL、DS-PROG、GLM-FULL、GLM-PROG。两种循序测试都必须经历 S1 开局、真实剧情触发/可追踪测试动作触发 S2/S3、最终全书完成；测试注入与真人操作分别标记。每 run 冻结配置、私有预算 manifest、独立应用缓存/数据库身份，不让另一模式或另一模型的完成结果污染冷测；供应商缓存情况如实记录。
本提示词授权完成这些必要真实请求与隔离设备测试；先配置有界总 token/费用/物理请求/重试上限，遇错误不反复整本重跑，不无限重试。一个模型失败不允许改用另一个后冒充通过。缺端点/设备时继续所有不依赖它的实现与测试，最终标明对应矩阵未验。
记录 TTFP、各阶段活动耗时与人为等待、前十回合资料等待、请求/重试/补尾数、完整 usage（缺失标 unavailable）、缓存分母、实际价目费用、覆盖、事实召回、技能/模板完整度、冲突、后台恢复和重复写入。按方案建立前/中/后及边界私有原文标注，至少 60 条关键事实，各阶段≥20；不能拿被测模型自己的输出当金标准。引文100%、必需引用悬空0、关键事实召回≥90%、同模型同范围两模式差≤5个百分点、秘密泄露/晚回包污染/重掷0。旧20分钟目标只以实测判断，未达要报告，不降质凑数。
每模型做 App Home/锁屏/恢复真实实验；再做断网、进程回收、通知拒绝、timeout、用户暂停取消、强停重新打开。覆盖 Android 15/16，最低支持版本按依赖核实；不清空用户数据。恢复实验的系统设置改动结束后复原。

六、回归与交付
运行 npm run verify:core、npm --prefix mobile run typecheck、npm --prefix mobile run apk:debug 及相关原生测试；有签名条件时构建/安装本次 release 验证，记录 APK hash。无 release 条件不妨碍 debug 继续，但 release 记未验。SQL migrations 与 builtinMigrations 必须一致，旧库升级/旧存档读取必须通过。
交付实现、迁移、测试、双模型可复现实测 harness、使用说明，并编写 docs/reviews/UNIFIED_BUILD_FIVE_PHASE_REVIEW.md：逐项映射 U01–U12，记录阶段提交、命令/退出码、四主测试指标、Android 证据、质量对照与全部未验项。不得把新方案五阶段完成写成仅文件存在或 mock 通过；任何主验收缺失，都只能称“实现完成/部分验收”，不能称全部竣工。
持续完成已授权施工，不逐步重复询问常规实现和测试许可；涉及确实缺失的必要配置、不可逆用户数据变更或范围外操作时才说明原因并请求输入。
```
