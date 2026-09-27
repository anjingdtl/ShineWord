# Phase 2 建设评审报告（P2-0 ～ P2-4）

日期：2026-09-27
基线：`1364c40`（Alpha 收口后 main 头）
范围：`docs/PHASE2_CONSTRUCTION_PLAN.md` 中 P2-0 基线整改、P2-1 世界包与三宝书骨架、P2-2 建卡与真实战役、P2-3 规则闭环与原子结算、P2-4 小说自动三书，以及 Android 模拟器实测验收。

## 一、P2-0 一期阻塞缺陷修复（全部修复并有回归测试）

| 一期缺陷 | 修复方式 | 回归测试 |
|---|---|---|
| 历史回退错误复制当前技能与关系；复制发生在分支事务之后 | `GameStateSnapshot` 扩展为完整快照（skills/relationships 随每次提交盖入 snapshot）；`forkBranch` 从分叉点快照恢复全部权威投影，且与建分支同一事务；遗留快照（无技能史）拒绝历史 fork 而非伪造；奖励台账属于分支时间线，不随 fork 复制 | `phase2-p0.test.cjs`：快照完整性、历史 fork 恢复分叉点数值、遗留快照拒绝 |
| 分支变化直接修改共享 Canon（`markEventsPendingAfter` 全局 UPDATE） | 新增 `branch_canon_overrides` 分支覆盖层（迁移 005）；`markEventsPendingAfter(worldId, anchor, branchId)` 只写覆盖层；`listEvents(worldId, branchId?)` 按分支合成状态；`canon_events.status` 永不改写 | `world-build.test.cjs` 扩展：共享 canon 不变、第二分支不受污染；`phase2-p0.test.cjs` 双分支隔离 |
| 开局缺少严格时间、能力有效期过滤 | Canon 开局强制要求 `worldTimeOrder` 锚点；`canonFactsVisibleAt` 升级为 validFrom/validTo/revealAt 三重过滤；技能/属性映射的证据事实必须全部在锚点可见才生效（后期技能无法漏进早期开局）；建卡入口（`createCampaign`）接入 | `world-extraction.test.cjs` 扩展：无锚点拒绝、晚期证据不授予技能、过期/未揭露事实不可见 |
| 成长去重键 turnId、满阈值直接升级、里程碑授等级 | 去重键改为 `(branchId, encounterId, actorId, skillId, rewardKind)`，`reward_ledger` 硬约束（重复授予中止整个事务）；满阈值只进入「可训练」，晋阶必须显式训练动作并检查导师/资源/前置（`trainSkill` + `assertTrainingAllowed`）；里程碑改为 1～2 练习点（`applyMilestonePractice`），永不直接跳级 | `growth-combat.test.cjs` 重写、`phase2-campaign.test.cjs` 端到端训练流 |
| 成长/关系/结算非原子（post-commit 独立写） | `commitAtomic` 接受 `settlement` 计划：奖励台账、技能进度、关系、战利品在**与回合同一个 SQLite 事务**内生效；快照在结算后盖章，保证完整一致 | `phase2-p0.test.cjs`：结算+快照同事务、双奖拒绝且无部分提交 |
| 端上拒绝非 UTF-8、长文展开崩溃、每次构建新建 worldId | `mobile/src/textDecode.ts`：分块 UTF-8 解码（Hermes 安全）+ 生成式 GBK 解码表（23940 码，全表对照 Node ICU 0 误差，`scripts/genGbkTable.mjs`）；同源哈希世界自动续建（`findWorldBySourceHash`）；UTF-16 兜底 | 设备实测：GBK 小说《山雨欲来》完整构建成功（2 章/19 实体/16 事实） |
| 存档仅基础结构校验、sha256Hex 参数未用 | Save schema v2：manifest 带 `payloadSha256`（canonical JSON 摘要）；`validateSaveJson` 全量校验（字节长度用 UTF-8 字节、分支/版本一致、技能枚举、摘要匹配）；新增 `restoreSave`：依赖（world + source hash）校验、单事务恢复完整状态为**新** campaign/branch，绝不覆盖 | `phase2-p0.test.cjs`：导出→校验→恢复→干净状态继续；缺依赖/哈希不符显式拒绝 |

## 二、P2-1 / P2-2 世界包、三宝书与战役

- 内容模型 `src/domain/content/types.ts`：11 类条目（skill/ability/item/condition/actor_template/origin/path/scene/quest/lore/constraint），条目级 + 字段级 provenance（explicit/inferred/rule_mapping/design_fill/user_override），visibility 三级。
- 发布验证器 `worldPackage/validate.ts`：逐 kind 结构校验、悬空依赖/环图拒绝、战斗数值完整性门槛、三书引用一致性；`publishWorldPackage` 发布不可变 revision，**blocking 冲突未决禁止发布**。
- 角色卡 `domain/characters/card.ts`：统一 ActorCard（玩家/同伴/NPC/生物），原创卡预算硬约束（4 自由点、单项上限 3、3 初始技能、4 准备槽）；`rollSpecForSkill` 卡片驱动骰子规格——**固定 demo 值（属性 2/trained）全部移除**；技能名三形态解析（`stealth`/`skill-stealth`）。
- `createCampaign` 单事务写入：依赖锁（package_revision + anchor_json）、队伍、角色卡、初始资源、主目标、首分支、完整快照；包未发布/缺失显式失败，**绝不静默回退演示世界**。
- `CampaignSession`：所有调用显式传 campaignId/branchId；`mobile/src/runtime.ts` 与 `database.ts` 中 demo-main 自动创建逻辑删除（旧 demo 数据仅保留可读）。
- 移动端页面重构（`mobile/App.tsx`）：世界书架 → 三宝书阅读（三书同源、来源标签）→ 开局向导（属性/技能/目标 → 锁定版本确认）→ 剧情页（检定/骰点/休整/训练/回退）。

## 三、P2-3 规则闭环

- 世界钟升级为 `clockSeconds`（旧 clockMinutes 兼容读取），休整/行动不再双计。
- V0.2 效果白名单扩展：`restoreResource`（引擎注入 cap，休整不越上限）、引擎专用 `removeCondition`/`grantItem`（LLM 合同内出现即拒绝）。
- 合同来源区分（planner/engine）：模型输出永不携带 `cap` 等引擎字段。
- 遭遇流程 `campaign/encounterFlow.ts`：敏捷→洞察→稳定 ID 冻结先攻、区域关系距离带、NPC 确定性策略（合法动作内选择，不逐 NPC 调 LLM）、遭遇结束一次性战利品（台账防重）。
- 战斗的设备端完整触发（守卫敌对进入遭遇）未在本轮实测；先攻/距离/伤害/NPC 策略由单元测试覆盖（`growth-combat.test.cjs`、`phase2-campaign.test.cjs`），如实标注为「模块级验证」。

## 四、P2-4 小说自动三书

- `worldPackage/buildPackageFromCanon.ts`：单次 WorldMapper LLM 调用（严格 JSON、枚举白名单、数值字段强制 rule_mapping 标注）→ 本地清洗（未知字段丢弃、非法枚举拒绝入包）→ design_fill 兜底（8 个基础技能 + 守卫模板，明确标注设计补全）→ 冲突检测（status=conflict 生成 blocking issue 阻止发布）→ 三书组装 → 发布。
- 管线降级保证：LLM 畸形输出时自动降级为纯本地包并记录 `mapping_failed`（major），管线总能产出可发布结果（除非 blocking 冲突）。
- 已接入端上构建流程（抽取完成 → 映射 → 发布 → 书架可阅三书/可开局）。

## 五、模拟器实测验收（Medium_Phone / API 37.1 / emulator-5554）

构建：Gradle 9.3.1 `:app:assembleDebug` BUILD SUCCESSFUL；debug APK（Metro 服务当前源码）安装于 emulator-5554。验收记录（截图在 `.tmp/screen-*.png`，数据库快照 `.tmp/qa-*.db`，均为本地不提交物）：

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 真实 GLM 导入《雨夜书阁》自创小说全流程 | ✅ 3 章/25 实体/25 事实/包 r1 published/26 条目/三书 section 齐全 | DB 快照 qa-baili 前版本 |
| 2 | 三宝书阅读：原文/规则映射/设计补全来源标签、GM 内容玩家视图过滤 | ✅ 截图 screen-17 | UI dump |
| 3 | 开局向导：属性分配上限、3 技能预算、锁定包 r1 | ✅ 卡片 skill-stealth·novice / HP10 / 体力10 | screen-18、DB actor_cards |
| 4 | 回合：卡片驱动骰点（敏捷 3 → **3d6**，novice → d6） | ✅ turn-0001 3d6:[6,1,4]，叙事贴合原著事实 | DB turns/llm_requests（Planner 722in/609out、Narrator 241in/152out，estimated=0） |
| 5 | 原子结算：练习点与台账同事务、快照含技能 | ✅ ledger 1 行、snapshot.skills 完整、clockSeconds 生效 | DB |
| 6 | 重复提交恢复：同 turnId 重放不双奖 | ✅ resumed=true、ledger 数不变 | DB 前后对比 |
| 7 | 休整：短休 +30 分钟、体力 +2 封顶；训练：2/10 点拒绝 | ✅ v3/80 分；阈值文案如实 | screen 系列、DB |
| 8 | 回退：从 v3 fork 到 v2，练习点/世界钟恢复历史值，原分支不动 | ✅ fork stateVersion=2、stealth 分支独立成长 | DB branches/actor_skills |
| 9 | 杀进程（AwaitRoll 态 force-stop）重启恢复 | ✅ staged 合同保留；GLM 非法提案（perception 不存在）被拒后**干净放弃**（未投骰不重掷、无卡死、中文原因提示），换描述后重试成功 v3 | DB、screen-35 |
| 10 | 双游戏隔离：同世界第二战役（不同技能卡） | ✅ 各自 ledger/skill 行互不污染；1d6（社交属性 1）证明卡片差异驱动 | DB qa-final |
| 11 | 《白篱梦》前 10 章真实构建 | ✅ 26 块全 extracted、158 实体/211 事实、包 r1 published、4 个 major 审核项如实拦截非法提案 | DB qa-baili |
| 12 | 《白篱梦》中断续建 | ✅ 第一次映射失败 → 重新导入同文件自动续建，26 块全部复用不重跑 | DB world_jobs |
| 13 | 《白篱梦》全书 100 万字（299 章/944 块）推进 + 中断 + 续建 | ✅ 导入解析成功；5 分钟推进 19 块 → force-stop → 进度保留（20 块）→ 续建 7 分钟 45 块（前 20 块复用） | DB qa-full1/2/3 |
| 14 | GBK 编码端上解码 | ✅ GBK 小说完整构建（2 章/19 实体/16 事实），一期"仅支持 UTF-8"限制解除 | screen + DB |

长程与预算说明：本轮真实 GLM 用量约 30 次请求（含 2 次完整回合链、10 章+GBK 两次世界构建、全书 45 块抽取）；100 回合长程测试属 P2-6 Beta 范围，未在本轮重复。

## 六、过程缺陷与修复（全部带回归或设备复验）

1. **迁移执行器按分号切句**：005 注释含分号导致 SQL 断裂——注释重写。
2. **懒加载分组在设备网络失败**（"Could not load bundle"）：runtime/worldImport/session 全部动态 import 改静态。
3. **GLM 技能名与包条目 ID 不一致**（`stealth` vs `skill-stealth`）：catalog 双键注册 + `resolveSkillKey` 三形态解析 + 结算键规范化（练习点落在卡片同一行）。
4. **续建完成显示"实体 0"**：buildWorldFromTxt 返回值改为从 store 读累计总量。
5. **休整时间双计**（timeCost + advanceClock）：restOutcome 移除重复时钟 effect。
6. **恢复上限缺失**：restoreResource 带引擎注入 cap。
7. **书架只列 main 分支**：改为逐分支列出（回退分支可继续游玩）。
8. **非法 Planner 提案卡死回合**：SkillNotDefined/NotTrained 专用错误 + `discardUnrolledTurn`（仅未投骰可弃）+ 中文可读拒绝提示。

## 七、已知限制与未验收项（不冒称通过）

1. **Release 签名 APK 未重建**：`SHINEWORD_RELEASE_STORE_PASS`/`KEY_PASS` 口令未存在于本机环境（仅维护者掌握）。本轮交付 debug APK（全部验收基于它）；维护者注入口令后按 M5 流程执行 `:app:assembleRelease` 即可产出签名包。打包链路（含 JS bundle）已由 assembleRelease 编译验证。
2. **叙事战斗未在设备端完整触发**：遭遇进入、先攻、距离、伤害、NPC 策略由单元测试覆盖；设备端敌对遭遇剧本留待 Beta 长程测试。
3. **《白篱梦》全书抽取未跑完**：944 块约需 4 小时真实模型时间；本轮验证了推进/中断/续建机制（45 块完成），续建入口已验证可随时继续。
4. **真机 / minSdk 24 低版本环境**：无真机，未验收（延续 Alpha 已知问题）。
5. **战斗中导出/导入存档**（restoreSave 已有单测）设备端 UI 入口未接（存档导出/导入按钮未加入新 UI）；领域闭环已测试，UI 接入列入 P2-5。
6. **600 秒 UI 冒烟超时类一次性失败**（首次白篱梦映射请求）已由续建机制覆盖，未复现。
7. **Escape/失能/援救/参战者中途加入**等遭遇细节未实测。

## 八、结论

P2-0 ～ P2-4 出口条件中，除上节标注项外全部达成：一期五个阻塞缺陷修复且每项有复现级回归测试；世界包/三宝书/角色卡/战役会话形成手机端真实闭环；真实 GLM 下从 TXT 到三宝书到可玩战役的端上链路完整走通；成长/回退/隔离/恢复的正确性以数据库状态而非界面提示为准。104/104 核心测试通过，core + mobile typecheck 通过。

## 附录 A：独立验收整改轮（2026-09-27 深夜）

对照 `docs/reviews/P2_ACCEPTANCE_REVIEW.md` 的 7 项动态缺陷与 6 项范围缺口，本轮全部关闭；逐项证据与命令见 `docs/reviews/P2_ACCEPTANCE_FIXES.md`。要点补充：

### 回归

- 核心测试 **123/123**（新增 `tests/phase2-acceptance.test.cjs`：A01~A07 等价回归 16 项 + G01 遭遇调度 2 项 + G04 分批覆盖 1 项）。
- `node docs/reviews/P2_ACCEPTANCE_REPRO.cjs` → **acceptanceFailures: 0**（7/7 PASS，原样保留未修改断言）。
- mobile typecheck PASS；`:app:assembleDebug`（Gradle 9.3.1）BUILD SUCCESSFUL。

### 真实模型（GLM-5.3-Flash，推理保持开启——维护者指令，Provider 参照 tavo-mini 处理 reasoning_content）

- V2 冒烟：3 提交 / 2 干净拒绝（编造技能「sword-strike」「jianfa」、未知地点）/ 0 失败；hp 不越上限。
- 《白篱梦》小样（12KB）：pass1 4 块中 1 块 300s 超时 → G04 门禁拒绝发布 → 续建 3 块复用 + 1 块重试成功 → 包 r1 published；证据引用 100% 可解析。
- **100+ 动作跨模式长程 PASS**：committed=100、cleanRefused=21、providerFailed=0、hp=10、台账 14 行无重复、rolls=26、世界钟 2680 分钟；阶段间不变量断言（HP 封顶/台账去重/版本不超前）全过；含里程碑幂等、回退分叉隔离、存档导出→干净库恢复→续玩。

### 模拟器（Medium_Phone / emulator-5554 / V0.2.0-p2.2 debug，升级安装保留旧数据，升级前 DB 备份）

导入真实原文（G06 真字节哈希 f9330ea0e0）→ 三宝书玩家视图/编辑模式 → 开局向导（真实锚点事件、京城、原著角色定安伯三女、同伴守卫、锁定 r1·规则 0.2.0）→ stealth 提案干净拒绝 → turn-0001 提交（双请求 tokens 落库）→ 遭遇完整闭环（跨区 touch 拒绝→移动→攻击 1d8 full_success→无攻击技能干净报错→跳过戒备→NPC 1d8→撤退、敌对投影清理）→ 长休 → 杀进程遭遇面板恢复 → 回退分叉（快照含战斗时钟与当时敌对者）→ 导出 16,123B v3 存档 → 干净内存库恢复续玩 + 设备导入为新战役续玩至 v6 → 断网干净失败（0 残留）→ 复网重试成功 → 审核队列解决 1 项。

### 过程缺陷（本轮发现并修复，均有复测）

1. SAF 选择器缺 application/json → 存档不可选（补 MIME 并重装复测通过）。
2. 无攻击技能角色战斗卡轮 → 新增 passTurn（戒备）动作。
3. 杀进程后活跃遭遇不回显 → PlayScreen 恢复活跃遭遇。
4. 快照式模拟器崩溃回滚用户数据/安装 → 之后以 -no-snapshot 重启规避（用户旧数据最终确认完好）。
5. 开局向导缺场景条目时地点为空 → 从原著 location 实体派生。
6. canon 角色无位置事实 → 回退玩家所选开局地点（证据优先原则不变）。

### 仍未验收（如实）

真机 / minSdk 24 低版本；Release 签名 APK（口令仅维护者）；第二种已配置模型服务（多模型矩阵）；G03 深层 memory 相关度融合；映射条目产出量调优（推理开启后单批 novel 条目偏少，覆盖计数如实入校验报告）。
