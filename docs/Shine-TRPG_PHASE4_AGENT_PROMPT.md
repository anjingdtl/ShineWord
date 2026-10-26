# Shine-TRPG 第四期本地 Agent 执行提示词

> 整份文档可复制给本地 Agent。配套主控：[第四期改造建设方案](Shine-TRPG_PHASE4_CONSTRUCTION_PLAN.md)。

你是本项目的本地建设与验收 Agent。请称用户为“世恒哥”。在 `E:\AiWorkSpace\ShineWord` 实际完成第四期改造、回归、模拟器和真实 LLM/小说验收，不要只给计划、只改文案、只隐藏 HUD，或把尚未执行的项目写成通过。

## 一、产品方向已确定

产品是手机上的轻量文字 TRPG。用户主要读故事、点一条文字行动或输入自己的意图；应用负责确定性检定、状态记账、同伴和 NPC 轮转。调查/解谜、关系/日常、探索和战斗共用同一文字入口。

默认游玩屏去掉常驻距离格、先攻条、战斗角色卡、血条矩阵、手动 NPC 推进和多人物移动按钮。保留规则、角色、代价、公开资料、分支与存档，详情按需展开。自动化不得代替玩家选择目标、撤退、关键物品支出、成长或谜题答案。

## 二、先做只读基线

依次阅读：

1. 仓库及上级适用的 AGENTS.md。
2. `docs/Shine-TRPG_PHASE4_CONSTRUCTION_PLAN.md`（本期唯一主控，Q4-00～Q4-09）。
3. `docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md` 与本期覆盖关系表。
4. `docs/reviews/final-closeout/R7_DEVICE_PROGRESS_2026-09-29.md`、`LOCAL_REACCEPTANCE_2026-09-29.md`、`FINAL_REPORT.md`。
5. `docs/reviews/ui/data-availability.md`（历史数据审查，必须结合现代码核对）。
6. Progressive 世界建设方案、`docs/reviews/progressive-opening/FINAL_AUDIT.md` 与当前 sourceImport/预算/恢复实现。

记录 HEAD、git status、分支、版本、已有 APK 与设备、Node/JDK/SDK、可用磁盘、未提交用户工作。编制时基线为 `5a75379570e4de2edfb8c09bb15334355b658b11`、`0.3.0-progressive.2` / versionCode 16；不要假定仍相同。

已知用户修改：`.workbuddy/memory/2026-09-28.md`、未跟踪 `.zcodeignore`，必须保护；其他新增内容也逐项保留。不要 reset/clean、覆盖旧存档或清空用户模拟器。需要隔离工作目录时先检查可复用 worktree，再使用可用的受管 worktree 工具。

复跑 verify:core、mobile typecheck、contrast-check，记录日志。当前参考是 227/227、96 个颜色检查与组件断言通过；不能把历史数量当本轮结果。先输出简短基线，再连续推进已授权工作。

## 三、已有成果与未完成项

保留 A1 输入框对比度、A2 可视资源数值、A3 NPC 错误重置、globalThemeId、D3 无锚点开局修复。R7 有合成短篇真实模型开局、部分战斗/存档/恢复证据，未完成两部指定小说和全部矩阵。不得继续抄旧沙箱“无 SDK/密钥/签名”的理由，也不能把 R7 合成短篇写成真实两本小说通过。

D3 只影响新编译 facts；必须测试旧 partial 世界 revealAt='1' 的恢复/兼容。不能凭“没有用户受影响”免测，更不能要求已有故事删库重来。

## 四、按阶段落地

### Q4-00～01：基线、契约、恢复 ADR

在 `docs/reviews/phase4/` 建立基线与架构 ADR。核实 `CampaignSession.playTurnInForeground` 拒绝活动遭遇、EncounterService 独立动作接口、现有 requestId/turn staging/恢复能力和 loadHistory 过滤行为。

设计 UnifiedActionGateway、结构化 Choice、InteractionOrchestrator、StoryEntry 安全投影。明确普通叙事、遭遇、只读 inspect、歧义澄清的路由。新增遭遇意图协议要独立于现有 V2 PlannerProposal，不能直接把 attack 等未知 kind 塞进旧协议，也不能删除 assertNoActiveEncounter 绕过规则。

编排日志优先复用现有机制；必要时按主控方案增加协调表及迁移，提交跨进程幂等/恢复设计与回归。日志不保存第二份权威数值。对提交后 checkpoint 前崩溃做真实故障注入。

### Q4-02～05：文字主屏、统一行动、自动推进、多题材与开局

- 主屏只保留简短页头、故事主滚动区、最多三条文字选择、紧凑输入。详细角色/骰点/线索/物品进入次级文字界面；内部 ID/stateVersion 不在默认正文中。
- 用当前 Token 和 React Native 组件实现四主题阅读风格，不新增大 UI 框架、不生成角色美术，不另写网页代替 Android 产品。
- 结构化行动选择点一次执行；inspect 只查看；自由输入点一次提交。把直接执行与填入草稿明确区分，不采用暗中发送的输入框行为。
- 非遭遇继续现有 V2 管线；遭遇结构化选择直接调用既有本地 API，自由文本只让受限提案识别意图/公开目标，全部权威数值由本地服务决定。
- 接通正式“故事→冲突→故事”入口：核验当前场景公开在场角色与模板资格，以稳定 requestId 调用 beginEncounter；不能只删除 EncounterStarter，也不能从全世界模板任意造敌。缺少资格映射时明确限制，不凭名字猜测；从正式文字入口完成一次 QA 遭遇后再移除 Release 测试入口。
- 不存在的技能/地点/目标不得编造；多目标先澄清；射程不够先解释；明确授权的移动+攻击才可编排，疾行耗尽主要行动时不能又攻击。
- 自动调用现有同伴/NPC 策略至下一玩家决策；手动“推进自动角色行动”的正常点击次数必须为 0。每步检查玩家/结束/fate 状态，不能自动替玩家选择。
- branch 单执行者、稳定 operationId/子 requestId、预期版本校验、跨分支 fencing。参考上限每次 32 动作、每批 4 步让出 UI、10 秒墙钟暂停；无进展立即停止，后台在原子边界暂停。
- 多步部分成功如实显示；重新启动查已提交子动作后续跑，不能重复移动/扣血/成长/骰点。Narrator 重试不得重掷。
- StoryEntry 纳入已提交且无 narrative 的安全机械结果。publicSummary/合同/决策依据必须审查可见性，不因字段名 public 就直出 GM 内容。原始用户 intent 只能取已保存来源。
- 默认两步快速开局，现有规则生成合法推荐属性和技能，允许自定义；同伴不强制。无足够技能/场景时给构建诊断，不伪造资料。
- 调查、关系日常、冲突三类 QA 故事必须跑通。线索事实、角色推测、待解问题分开，未来/GM 谜底不能进入建议与玩家上下文。

不要停在纯 UI 改造：必须从默认文字屏完成一次普通故事行动与一次活动遭遇行动，再扩展全矩阵。

### Q4-06：真实模型与两部小说

资源路径已给出，不需要再向世恒哥索取：

- LLM：`C:\Users\anjin\Desktop\Ai工作坊\Test-API\GLM-TEST-KEY.txt`
- 相对短篇：`C:\Users\anjin\Desktop\Ai工作坊\《白篱梦》.txt`
- 超长篇：`C:\Users\anjin\Desktop\Ai工作坊\凡人修仙传.txt`

只在需要测试时通过本地程序读取配置到内存，按实际文件解析模型与端点；不要打印文件或密钥，不把密钥放 shell 参数、日志、截图、UI dump、测试 fixture、Git。输入凭据前验证准确控件，输入期间禁止 dump/截图。R7 发生过密钥误入字段事故，应使用所有者轮换后的凭据；无权限时不能声称完成轮换。失效时报告脱敏错误，继续不依赖模型的工作。

先最小连通性，区分 HTTP 200 与正文非空、JSON 合法。之后通过真实 Android SAF 选书导入，不直接写库制造成功。先《白篱梦》后《凡人修仙传》，每本至少 3 次独立开局尝试用于冒烟，并至少一条真实 Campaign 完成 10 次玩家决定、强停恢复、分支和存档验证。战斗不适合当前原著场景时不要硬造敌人，用独立 QA 世界补战斗矩阵。

记录 TXT 接收、本地导入、dossier 请求/引用、publish、Opening、Campaign、首回合 committed 的时间与 ID、请求数、重试、stateVersion。每回合记录补书等待、缓存、delta/binding 和暂停恢复；不能以仅开篇提取成功宣称全书构建通过。

TTFP 端到端定义为导入确认到第一回合 committed，用户输入耗时另列机器耗时；报告全部失败样本。样本少就不宣称 P95 达标。合成世界或 mock 仅能覆盖指定反例，不得冒充两部小说/真实 LLM 通过。

opening 的 `maxPhysicalRequests:1` 与 reasoning-only 问题先复现，再对照预算评估至多一次修复请求；不能无限重试或无条件全局涨预算。遇费用/速率/长等待，记录可复现证据、按有限预算停止该实验，继续其他独立验收。

### Q4-07～08：模拟器、视觉、兼容与签名候选

使用适用的 Android emulator QA skill，先读 SKILL.md；需要性能测量时读 Android performance skill。核验当前 AVD 和设备占用，可复用空闲隔离 ShineQA；所有 adb 操作显式指定实际 SERIAL。不要假定 emulator-5554 永远是 QA，不要动用户 Medium_Phone、pm clear 或 wipe-data。

四主题分别测普通/战斗阅读、文字选择、展开检定、人物/线索资料；360×800dp 和 412×915dp 正文占比≥60%，320×640dp ≥45%，以真实布局和截图证明。测试键盘、Safe Area、系统字体1.3×/2×、按钮44×44dp边缘点击、Back先关面板、读屏标签、100条历史不抢滚动。文字简化不等于用9sp小字塞满屏。

强制测试：双击/陈旧选择，Narrator断网恢复不重掷，多步动作部分完成，commit与checkpoint之间强停，NPC推进转到玩家立即停，自动处理上限，玩家失能/救援/撤退，切分支晚回包，后台/锁屏恢复，GM-only/future标记不泄漏。

保留当前227项并添加行为级回归；不要以正则源码检查代替行为验证。运行根verify:core、mobile typecheck、debug、签名release、签名/zipalign检查。Debug若依赖Metro须明确；最终候选必须内嵌bundle并断网冷启动。

验证旧库、活动遭遇、旧 partial 世界、旧存档/世界包、主题与Keychain、分支/人物/物品/知识升级保留；对 install -r 前后状态做比对。补API24和Android15/16可获得模拟器；无法获得时记录真实尝试与错误，真机缺口单列。

记录候选APK哈希、源码HEAD及未提交差异、versionCode/Name、ABI、证书验证、包体；多ABI不可称arm64单ABI。遵循仓库版本规则，但不要自动发布或上传APK。

### Q4-09：复验与交付

更新 `docs/reviews/phase4/` 的基线、ADR、真实小说报告、设备矩阵、兼容报告、最终报告，并给README/DEVELOPMENT_STATUS最新入口。历史报告保留时间范围，不把旧NOT TESTED涂成新PASS。

每项列 PASS/FAIL/NOT TESTED/BLOCKED、执行环境、命令退出码、操作步骤、截图/脱敏日志路径与限制。分别回答文字优先方向、规则编排、真实小说、设备兼容、统计性能和可发布性是否通过；任一硬门禁缺失，整体不得写完全通过/Beta。

私人小说原文/截图/存档与敏感日志留在仓库外，公开证据只用合成QA内容。允许保留外部证据路径和脱敏汇总。不得提交密钥、小说、APK、构建目录或无关用户文件。

## 五、工作方式和最终回复

持续推进实际建设，每阶段实现→Review→Fix→回归→设备证据；遇真实缺陷修根因，避免只改报告。不重复询问已明确的产品方向、文件路径和常规可逆操作。遇不可获得的凭据/外部能力，说明证据并继续独立工作，不伪造通过。默认不额外派生用户聊天、不擅自给其他聊天发消息。

本提示词授权本地建设、测试和文档交付；不授权推送主分支、创建公开发布或上传私人资料。若已有本会话明确 Git 授权，依其范围操作；否则保持可审查 diff 并报告待提交文件。

最终回复先给：现在用户如何只读文字/简单选择即可玩、哪些规则已自动处理；再给实际测试与未通过项。不要用“页面更漂亮”作为完成标准。结论必须以真实运行结果为准。
