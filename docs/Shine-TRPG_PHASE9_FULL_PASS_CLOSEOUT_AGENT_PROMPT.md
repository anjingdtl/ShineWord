# 第九阶段全通收尾执行提示词

使用本提示词接续2026-10-09 `a82a0ea`之后的第九阶段测试与修复。当前方案编写轮没有执行产品测试或付费请求，历史工程门禁不得冒称本轮结果。

```text
你接手ShineWord第九阶段全通收尾。先确认实际仓库根，不沿用其他主机的E盘、用户名或固定serial。目标是第九阶段完整验收通过，不能以工程全绿或诚实交接代替完成。

本地执行资源（用户本轮明确提供）：
- 项目：F:\ClaudeWorkSpace\projects\ShineWord。
- 测试LLM配置：C:\Users\Administrator\Desktop\AIstudio\Test-key\GLM-TEST.txt。
- 测试小说：C:\Users\Administrator\Desktop\AIstudio\放开那个女巫.txt。
- 已授权按方案完成本地代码建设、必要回归、Debug构建、保留数据安装、Android QA及共享预算内的真实LLM测试，直接执行，不只输出分析/待办或反复询问已授权操作。
- 从配置文件读取实际端点、模型与推理/流式能力，不臆测、不静默换模型/降档；密钥仅在内存或既有安全存储使用，不输出正文、认证头或写入Git。资源路径只用于测试适配器，不硬编码进产品。
- 小说走正式TXT导入、编码探测与来源hash验证，不截取片段冒充完整导入；按依赖构建必要资料，不重复重建已成功内容。原始字节hash与历史资产不匹配时保留两者并报告，不能混用继承证据。
- 用户提供测试资源不等于允许重置1500预算、自动重放旧unknown、修改旧冻结策略或清空App数据；对应请求仍走方案的账本/确认边界。

先读：
1. docs/Shine-TRPG_PHASE9_FULL_PASS_CLOSEOUT_PLAN.md（当前执行方案，按Q0–Q6退出条件执行）。
2. docs/Shine-TRPG_PHASE9_CONSTRUCTION_PLAN.md §6、§15–§18（产品/验收合同）。
3. docs/Shine-TRPG_PHASE9_OPTIMIZATION_PLAN.md（A1、C-2已批准，承接，不重复询问）。
4. docs/reviews/phase9/HANDOFF_R69_CLOUD_2026-10-09.md及CLOUD_REVIEW_R69_2026-10-09.md。
5. ACCEPTANCE_MATRIX、REAL_JOURNEYS、CONTENT_QUALITY、ROOT_CAUSE_REPORT、CURRENT_IDENTITY。

基线：
- 代码a82a0ea含R69 P9-O1。报告核心1207/1207；整体验收29 PASS/2 FAIL/9 NOT RUN。
- FAIL：A15/A36；NOT RUN：A02/A03/A06/A10/A12/A19/A26/A37/A38。
- J1批准继承5，turn-0002排除，从原camp-j1r66-mv0ixuuq-main v28续15。
- J2/J3各0/20；同原v26的J4A/B各0/10；两后果完整链0/2。
- C-2：J1新15中UI≥10，J4一路UI10；UI是80的子集，不能跑完主机后再重复补UI。
- 合同预算1291/1500，余209，1450强制检查点。剩余75决定通常至少150请求，173仅修正旧估算；基线、补建、记忆、修复等须另核算。
- 方案编写时本机原local-20261009与cloud-r69目录缺失，遗留manifest不可派发；emulator-5554 offline。现在重新核实，不能照抄云端“设备0”或把历史缺失当作当前结论。

先完成：
1. Q0追回原库/1291 manifest/逐文件binding/原驱动/冻结与attempt；只读对账，核实v28/v26。缺失就明确列出，独立开展离线修复；不伪造继承资产。
2. F0驱动、identity、预算接线和dry-run；tools/phase9-budget.cjs只有导出API，没有reserve CLI。每物理派发前调用reservePhysicalRequest，不能双扣或漏扣。
3. 正式resumePostProcessing清扫旧卡及存档门，未知记忆先审查。禁止手改lease/outbox，禁止替换设备库。
4. R69供给链离线复核，修真实内容因果问题；当前通用开局零效果不能靠新增无意义counter补配额。
5. 落地P9-O2流式活动时限。旧冻结run不改；新任务使用新配置。无帧阈值要验证，不能把估计说成P95。
6. 补F4正式campaign_plan未知恢复服务。现有acknowledgePlayReplay仅覆盖planner/narrator，不能直接审批规划unknown。精确绑定job/freeze/attempt/config/state fence，确认前零派发、双击幂等；不改原unknown结果/响应/usage，只正式追加审批与新任务关联审计，复验采用/导出不被未审批旧attempt继续阻门。
7. 原库/工具/生产因果/门禁具备后，Q3做可计入最终配额的三意图可行性检查，并完成一条同有效身份的10个确认决定冒烟区间，优先J1新UI决定。先候选独立六维审查，再采用；J2/J3任一新样本仍到硬上限unknown就条件启动P9-O3，不能第三次相同单发。
8. Q4把80决定、UI、两后果、自然结局和A02/A03/A06/A10/A12/A15整合到同批旅程；Q5匹配10+10、全账和独立试玩；Q6封板。

纪律：
- 只有合同/事件/权威变化及语义审查确认的决定计数；版本、管理、轮询、重复counter、零效果fallback、重试同一回合不计。
- 当前无战役办法立即停止付费动作；非失败档连续2次无持久变化、连续3次failure/severe_failure即停并诊断，已形成的有效变化保留，不能刷数。
- 两后果必须排程→至少2有效决定→触发→下游实际消费。旧record_event链先查消费者，无消费者保留诊断，通过正式新修订生成新可消费链，不改已采用工件。
- outcome_unknown不自动重发；R62首抽取与端上旧抽取未知不在规划恢复范围；不使用allowOutcomeUnknownReplay测试逃生开关代替正式确认。
- 不改原响应、骰点、已采用档案或历史；不删失败；不新增固定阶段回合配额硬门，不强行回轨。
- 生产变化按A1记录diff/受影响边界，继承5不归零，也不自动全继承；每批独立identity，保留原binding。
- 门禁：npm run verify:core；npm run typecheck --prefix mobile；npm run verify:version；npm run apk:debug --prefix mobile；git diff --check。构建后重取identity并核实实际APK及安装hash。
- 源码定向修复测试必要并发/恢复/安全边界；纯文档变化不重复产品长测。
- 原文、响应、库、密钥、APK及私有日志不提交。主工作树不checkout/switch/stash/reset --hard/clean -fd，不混入他人修改。
- 不重置/静默增额；预计余额不足就保存检查点与剩余矩阵。每3–5个有效决定更新计数、后果、预算。独立试玩提前安排。
- 原资产缺失、预算未对账或设备暂不可用时继续不依赖它们的离线修复与回归；只列确实需要用户提供/裁决的最小阻断项。独立试玩不能由agent扮演玩家伪造反馈。

完成：
A01–A40=40 PASS，80决定和批准UI口径达标，三计划/三旅程六维≥3无否决，两后果四段链，自然结局、10+10全账、实装身份、受影响复验和独立试玩齐全。未齐只能报告准确检查点，不能宣布完整完成。报告和证据按新方案§9交付；push/发版另按实际授权。
```
