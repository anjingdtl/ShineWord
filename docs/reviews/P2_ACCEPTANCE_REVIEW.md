# 二阶段独立验收：未通过最终验收

日期：2026-09-27。代码基线：`0abfe53`。本轮只新增验收报告和隔离复现脚本，没有修改产品代码或用户存档。

## 1. 结论与核查范围

当前交付可视为三宝书与卡片驱动战役的阶段性原型，不能视为 PHASE2_CONSTRUCTION_PLAN.md 二阶段全部完成。P2-3 存在未接入能力，P2-5、P2-6 明确未完成，且已实现路径中存在规则越权、回退污染与存档无法续玩的阻塞问题。

本轮实际执行：

- `npm run verify:core`：104/104 通过。
- `cd mobile; npm run typecheck`：通过。
- `node docs/reviews/P2_ACCEPTANCE_REPRO.cjs`：7 项验收期望失败，退出码 1；均使用现有自创夹具、内存 SQLite 与脚本化 Provider，无外部 API 请求。
- `adb devices -l`：无在线设备。本轮未重新构建/安装 APK、启动模拟器、读取用户 Key 或执行真实 LLM 验收。

旧 P2_REVIEW.md 的模拟器记录仅作为历史证据，不计为本轮实测。现有测试通过不能覆盖以下复现失败。

## 2. 已动态复现的阻塞问题

### A01 [P1] Planner 仍可直接注入数值效果，生命可超过角色上限

入口：`src/application/campaign/session.ts:263`、`src/application/game/llmTurn.ts`、`src/domain/turns/contracts.ts:78`、`src/domain/state/effects.ts`。

向正式 session.playTurn 的脚本化 Planner 返回 requiresRoll=false 和 restoreResource(hp,999)，未定义治疗能力或支付资源，正式链路成功提交，HP 从 10 变成 **1009**。这不是恶意代码执行，而是模型结构化输出即可触发的规则缺口。当前仍走 V1 效果合同，尚未落实 V2 提案由本地可信模板编译。

验收要求：模型不能直接决定伤害、治疗、行动资格和成本；公开动作绑定定义及参数，本地资格与效果编译器决定数值；所有治疗都受权威上限限制，自动行动也必须过资格门禁。

### A02 [P1] 训练绕过事务、时间与状态版本

入口：`src/application/campaign/session.ts:401`；UI `mobile/App.tsx:761` 将三个训练条件全部写死 true。

正常积累 10 点后调用训练：角色技能晋阶，但 stateVersion **10→10**，世界钟 **1200→1200**。代码依次更新 actor_skills 和 actor_cards，无统一动作事务、事件、快照或训练时间/资源消耗。写入中断可形成卡片与技能表不一致。

验收要求：训练作为引擎动作，读取实际导师/资料/环境和资源，原子提交技能、卡片、时间、消耗、事件及快照。不能信任 UI 传来的 true 作为世界条件。

### A03 [P1] 回退仍带入未来角色卡与队伍

入口：`src/application/campaign/session.ts:508`，尤其 526 行之后复制当前卡片与 party_members。

训练至 trained 后回退到 v1，actor_skills.rank 正确恢复为 novice，但 actor_cards.skills.stealth 仍为 trained。接着执行正式回合，实际骰子为 **3d8**，应为历史卡片的 3d6。复制还发生在 forkBranch 事务之后。

验收要求：卡片、能力、装备、队伍、认知、遭遇等所有权威状态按目标版本统一恢复，单事务完成；不得从源分支当前表补齐历史。完整快照不能只指 skills/relationships。

### A04 [P1] 同一里程碑可重复奖励

入口：`src/application/campaign/session.ts:445`。

使用相同 branch/actor/skill/encounterId 连续调用 grantMilestone，第一次 2 点，第二次 **4 点**。函数没有在重复奖励时停止加点，也没有将该操作接入完整回合事务和奖励台账。

验收要求：同一奖励事件最多提交一次；正常重放返回原结果，不二次加点。另需修正 playTurn 默认每回合一个 challengeId，使同一未改变的目标不能靠重复输入刷实践点；自动无风险行动不得奖励。

### A05 [P1] 存档导入缺少卡片和世界包锁，不能继续游戏

入口：`src/application/export/saveFile.ts:100`、`:323`。

真实 P2 战役导出后恢复为新 campaign/branch，恢复角色卡 **0 张**、packageRevision **0**。session.playTurn 立即失败：`Locked world package is missing: w-pkg r0`。因此“领域闭环已测试”不足以证明实际 P2 战役可续玩。

静态还发现：导出 rollJson 仅是 rolls_json 数组，恢复端却按带 diceCount/rolls 的完整对象读取；合同恢复为 `{}`，未完成动作无法按原合同恢复。世界包版本、角色卡、队伍、奖励台账及更多运行状态没有覆盖。

验收要求：完整保存依赖锁、角色与运行状态、合同和骰子记录；一致读导出；干净数据库导入所需世界包后，可以继续普通行动、恢复已投骰未提交行动并正确回退。

### A06 [P1] 玩家三宝书视图泄漏未发现条目

入口：`src/application/worldPackage/publish.ts::assembleBook`；`mobile/App.tsx:391`。

将 discoverable 条目传入 includeGm=false 的玩家视图，条目仍直接返回，函数没有角色知识与发现状态参数。App 实际阅读入口还固定 includeGm=true；没有独立明确的编辑模式与玩家知识视图。

验收要求：默认玩家视图按角色、分支、锚点及字段级认知过滤；完整编辑视图单独进入。不能只隐藏 visibility=gm 后宣称秘密隔离成立。

### A07 [P1] 不连通区域被视为远距离可达

入口：`src/application/campaign/encounterFlow.ts::distanceBetweenZones`。

区域 a 只连 b，另有完全孤立区域 isolated，查询 a→isolated 返回 **far**。实现最后只要起点有出口就返回 far。

验收要求：图可达性、两步以上 out_of_range、门/视线阻挡均显式校验。compileAttack 必须校验行动者、行动额度、攻击技能/能力、目标距离和资格。NPC 策略当前仅按最高熟练技能挑攻击，需禁止医术/潜行自动变为攻击技能，并尊重实际射程与撤退出口。

## 3. 方案范围与静态集成缺口

| 编号 | 缺口及依据 | 收尾要求 |
|---|---|---|
| G01 | encounterFlow 的 freezeInitiative/compileAttack/decideNpcAction/buildEncounterRewards 搜索仅见定义，没有生产调用；App 无同伴选择，开局固定 original、worldTimeOrder=1、opening-anchor（App.tsx:542） | 不能将战斗称为仅缺实测；补运行调度、真实场景、原著建卡/时间地点选择、同伴加入及行动、失能/援救/撤退/结束闭环 |
| G02 | session 上下文仅静态公开 lore/constraint、首个演员位置、队伍与目标；未接历史/摘要/知识检索，Narrator 请求也没有完整公开故事上下文 | 接入受权限约束的世界与分支检索、历史摘要、相关角色状态；测试长程事件记忆与未知秘密隔离 |
| G03 | mobile/worldImport.ts 在 buildWorldFromTxt 后无 failedChunks 发布门禁；Mapper 单次截取前 800 条 facts，丢弃 validFrom/validTo/revealAt；映射失败可自动发布通用默认包 | 部分构建只能预览；建立增量覆盖与映射任务、时间/证据传播、关键冲突审核入口；不得将通用守卫+技能包当小说完整三书 |
| G04 | mobile/worldImport.ts:16 将原字节转字符，再由 Kotlin sha256Hex 按 UTF-8 重编码计算，非原文件字节 SHA-256 | 原生字节哈希；中英文/GBK 文件与外部标准 SHA-256 对照；制定旧哈希兼容与迁移，不静默覆盖 |
| G05 | domain/rules/ruleset.ts 仍为 0.1.0，新行为复用旧版本，没有独立 V0.2/旧规则分派；完整快照仅增加 skills/relationships | 明确规则与存储版本、旧档策略；补齐所有权威状态快照与事件，不伪造旧历史 |
| G06 | P2-5 草稿编辑、审核解决、世界包导入导出、存档 UI 尚未形成；P2-6 长程/设备/多模型也未完成 | 按原方案补齐，不能将剩余阶段默认排除在本轮任务之外 |

这些静态发现与动态失败分开记录；尚未逐项设备复现。全量安全、性能与原著语义质量审计也未完成。

## 4. 收尾顺序与复验门槛

1. A01/A02/A03/A04/A05：规则权威、统一事务、完整恢复先修，保留复现并转为正式回归测试。
2. A06/A07 及 G01/G02：知识视图、场景距离、NPC/队伍/战斗主链与长程上下文。
3. G03/G04/G05/G06：覆盖门禁、哈希与兼容、世界编辑/审核、包及存档往返、P2-5/P2-6。
4. 正式模拟器复验必须使用对应构建，覆盖“导入→三书→两类建卡→同伴→探索/社交→战斗→休整/训练→杀进程→回退→导出→干净库导入→继续游戏”。
5. 100 个已提交动作包含不同模式、至少一次训练、分叉、战斗与恢复；模型失败/拒绝/重试单列。以 DB 断言/状态 hash 及 UI 证据共同判断。

命令：先 `npm run verify:core`，再 `node docs/reviews/P2_ACCEPTANCE_REPRO.cjs`。脚本复用测试文件的夹具函数并禁止原测试注册，属于本次审查工具；若重构夹具，需保留等价用例，不能删除或弱化预期来变绿。修复后的正式回归应进一步覆盖故障注入与公共 UI 路径。

现有 104 项测试绿、本复现脚本绿、P2-0～P2-6 出口实际满足且限制如实记录，才能重新申请最终验收。
