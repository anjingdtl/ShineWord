# 本地开发机 Agent 交接提示词

以下内容可直接作为本地 agent 的任务指令：

```text
继续接手 https://github.com/anjingdtl/ShineWord 的第六阶段建设与剩余验收。项目位置 F:\ClaudeWorkSpace\projects\ShineWord；测试LLM配置在 C:\Users\Administrator\Desktop\AIstudio\Test-key\GLM-TEST.txt；唯一已授权小说在 C:\Users\Administrator\Desktop\AIstudio\放开那个女巫.txt。只在本地读取凭据，不打印/提交密钥、小说全文、未脱敏请求或SQLite，不把本机路径硬编码到Android产品代码。

先检查git状态/AGENTS.md/远端main，保留本地修改，安全同步最新main并建接续分支。完整范围依据 docs/Shine-TRPG_PHASE6_CONSTRUCTION_PLAN.md。先全文读取根目录progress.md、docs/reviews/phase6/STATE.md、COMPATIBILITY.md、TEST_RESULTS.md、FINAL_REPORT.md、DEVICE_RESULTS.md、MEASUREMENTS.json、ACCEPTANCE_MATRIX.md及各阶段REVIEW，随后核验README、版本规范、CI和相关真实源码。不要从历史5103397回退或重复已经完成的M0～M9。

云端最终生产源码37149b45d948422ac99ce3e6c097f933fb929fb9已按用户授权安全快进main，PR10自动merged/closed；进度文档在其后另提交。schema31/save7、版本0.6.0/60000不变。本地790/790与root/mobile严格TS/version/diff/standalone Debug通过；该源码main实际Core790/790和Android CI均success。最终证据仅改文档，Android路径过滤不触发。云端私有DB、APK、截图和请求记录不在仓库，不假设本地拥有同一云端任务/存档；先建立本地可复现证据。

已完成流式来源与持久中文索引、依赖驱动小段/缓冲、抽取复用/变化映射、不可变发布/安全采用、P0～P3统一预算队列账本、Android前台服务/租约恢复、独立三模式风格/冻结快照及生产UI。后续修复已处理范围身份、键盘、精确unknown审批、租约CAS、done缓存、开局建议统一治理且切API不绕过unknown、新草稿权威provenance、canceled拆批父审计行和规范化定义比较。不得另建事实库/请求账本/租约、绕行模型管线或放宽验证门禁。

真实host样本导入至合格成果52.046秒，但provider热缓存n=1，不是稳定90秒或真机TTFP。opening-90s-3以模型上下文10%为上限，并受6400码点/总预算约束；保留20事实、有效人物/地点/事件/行动依赖/引用闭包和冲突门禁。原生API30新TXT已完成两个真实回合、两个后段各自发布/采用、暂停冷恢复、0重复付费mapping缓存修复、binding1→2→3及v4三成果save7正常导出/导入冷DB一致性。两个更远P2候选12800..16000/16000..19200CP虽抽取成功，但新canon冲突被严格阻断，已正常停止；不能计作发布通过，也不能直接改库清冲突。按当地原文和正式逐事实审查处理真正待审项，并明确继续。

现在继续剩余可执行验收与发现问题后的实现修复：核验本地Node/JDK/SDK/SQLite/adb和设备，合理配置缺项；仅用上述授权资源，设清晰请求/Token上限并记录所有失败/缓存，禁止反复全书构建。先做本地TXT导入→合格开局→连续游玩→主线/停留/支线→至少两次后续补建/采用→暂停/冷恢复→风格切换→存档/分叉恢复完整UI旅程，覆盖同书分段追加或已有授权多部夹具。再验证并发1/2/4及低RPM/TPM、429/Retry-After/断网/截断/思考不足、sent强杀/unknown、锁屏/通知/系统暂停/双runner、索引覆盖损坏/别名、构建中删除与切API、旧schema/旧run/旧包存档。sent之后不能假设远端可撤回计费；任何新unknown禁止自动重发，仅逐attempt确认证据并按明确授权处理。

测量固定小说hash/起点/模型/推理/设备/配额/覆盖质量，分别记录导入、Build/UserTTFP、补建等待、P0排队、请求/Token和风格开销，标记冷/热及provider缓存、样本量和真实/估算。合成故障只证明对应协议，模拟器不代表真机性能；稳定90秒、API24/Android15/16、真机后台/资源、三题材人工内容/风格评分和统计新旧对照仍未完整验收，缺真实资源时准确保留未验项，不伪造通过。

不要只输出分析、计划、骨架或下一轮提示词。自主继续，每阶段实现→review→fix→验证→commit，维护progress.md、STATE.md、TEST_RESULTS.md、FINAL_REPORT.md和A01～A18矩阵。源码变化时执行npm run verify:core、npm run typecheck、npm run typecheck --prefix mobile、git diff --check、Android Debug构建；版本变化运行npm run verify:version。修复本次失败，不删测试/弱化门禁/绕过CI，推送接续分支并交付可审查PR，核对实际CI。此次main授权用于已完成云端交付，不默认授权后续本地代码合并；没有额外授权不合并main、打tag或发Release。只有真实权限或不可安全继续的阻断才停止，其余自主完成并准确记录复测步骤。
```
