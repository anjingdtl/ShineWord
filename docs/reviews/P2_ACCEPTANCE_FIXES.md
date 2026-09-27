# P2 验收缺陷关闭证据（A01～A07 + G01～G06）

日期：2026-09-27。基线：`0abfe53` 之上的修复序列（`41a50d3`、`10de4c2`、`ebe2e9f` 及后续）。
对照文档：`docs/reviews/P2_ACCEPTANCE_REVIEW.md`（独立验收未通过与 A/G 缺陷清单）、`docs/reviews/P2_ACCEPTANCE_REPRO.cjs`（用户复现脚本）。

回归基线：核心测试 123/123 通过（新增 `tests/phase2-acceptance.test.cjs` 19 项等价回归）；独立复现脚本 7/7 PASS（`acceptanceFailures: 0`）；mobile typecheck 通过。

## 一、A01～A07 动态缺陷（全部关闭）

| 编号 | 关闭方式 | 核心代码 | 正式回归 | 设备证据 |
|---|---|---|---|---|
| A01 规划器可注入数值 | V2 受限提案协议：规划器只输出动作形状（actionKind/skillId/target/证据），`validatePlannerProposal` 白名单键校验，携带 outcomes/effects/数值即拒绝；本地编译器 `v2Compile` 从可信定义与固定策略表编译合同（引擎 origin）；治疗类效果一律注入卡片上限 cap；畸形提案有一次带回错误的重修再失败 | `src/domain/turns/proposal.ts`、`src/application/game/v2Compile.ts`、`v2Turn.ts` | `phase2-acceptance.test.cjs` A01×3（提案携带 outcomes 拒绝、篡改响应 HP 不越 10、heal 99 封顶 10 且扣消耗） | 模拟器：turn-0001 提交（GLM-5.3-Flash 真实双请求，tokens 落库）；Node 真实 GLM 冒烟 3 提交/2 干净拒绝/0 失败、hp 不越上限 |
| A02 训练绕过事务 | `trainSkill` 移除 UI 布尔参数；引擎真实查询：体力（权威状态）、卡片段位、世界技能档位训练政策（非 ordinary 需同地点更高段位导师）；训练为引擎动作事务：240 分钟世界钟 + 2 体力消耗 + 技能行 + 卡片投影 + 快照同一 `commitAtomic` | `src/application/campaign/session.ts` trainSkill | A02 用例（v+1、钟 +240min、体力 -2、卡片同步、快照含训练后卡片）+ 体力不足真实拒绝 | 模拟器：训练按钮按技能触发，条件由引擎裁定 |
| A03 回退带入未来卡片 | 完整快照扩展 `cards`/`party`；每次提交与建卡盖章；`forkBranch` 在分支事务内从分叉点快照恢复卡片与队伍；`rewind` 不再复制源分支当前行；无卡片史的历史分叉拒绝而非伪造 | `src/domain/state/types.ts`、`sqliteTurnStore.persistState`、`branch/fork.ts` | A03 用例（回退后卡片 novice、骰 3d6、源分支保持 trained） | 模拟器：回退生成 `camp-mujyjrvx-b…@v3`，快照含当时敌对卡片与战斗时钟 |
| A04 里程碑重复奖励 | `grantMilestone` 走 `commitAtomic` + 台账 + awardedKeys 双闸；同 encounterId 重放返回 granted:0；自由探索挑战闭环（`challenge-…:closed` 键）：未达成的重试共用同一挑战 id（换措辞不可刷点），达成后开启下一挑战；自动行动零奖励 | `progression/growth.ts`（openChallengeId/closed）、`session.grantMilestone/buildTurnSettlement` | A04×3（幂等、失败重试 5 次仅 1 点、不同技能独立序列、自动行动 0 奖励） | 引擎长程含里程碑幂等断言（phase 5） |
| A05 存档缺卡片/包锁 | 存档 v3：manifest 携带 packageRevision/goal/anchor；payload 含卡片、队伍、完整合同（staged+committed）、完整骰记录、奖励台账、分支事件；`restoreSave` 单事务恢复全部并以 `getPublishedPackageRevision` 语义继续；v2 旧档显式拒绝并说明政策 | `application/export/saveFile.ts`（v3） | A05×3（往返续玩、已投骰未提交动作带原骰恢复且不重掷、legacy v2 拒绝） | 模拟器：导出 16KB JSON→设备导入为新战役 camp-mujzcbac（v4 精确恢复）→续玩 turn-0005→v6；导出文件在干净内存库恢复+续玩（`clean-restore-check.cjs` PASS） |
| A06 玩家视图泄漏 | `assembleBook` 增加 knowledge 透镜：gm 条目仅编辑模式；discoverable 条目需分支内真实发现记录；玩家视图默认空发现集 | `worldPackage/publish.ts` assembleBook | A06 用例（未发现隐藏/发现后可见/编辑模式全见） | 模拟器：三宝书页玩家视图过滤横幅 + 独立"切换编辑模式"按钮与剧透警告 |
| A07 不连通区域算远距离 | `distanceBetweenZones` BFS：同区 near、一连接 mid、两连接 far、更远/不连通 `out_of_range`；`compileAttack` 本地校验行动者参战资格、失能、行动额度、攻击技能白名单（模板 attacks ∪ usage='attack'）、射程覆盖；NPC 策略只从声明攻击技能选择、按射程过滤目标、撤退走真实场景出口 | `campaign/encounterFlow.ts` | A07×4（不连通 out_of_range、touch 不跨区、NPC 不把医术/潜行当武器、低士气走真实出口） | 模拟器：跨区 touch 攻击被拒→标准移动进入→攻击成功；canon 角色无攻击技能时干净报错并可跳过回合 |

## 二、G01～G06 范围缺口（本轮落地与状态）

| 编号 | 落地内容 | 状态 |
|---|---|---|
| G01 同伴/NPC/遭遇/战斗 | `encounterService`：begin（模板实例化敌对者、冻结先攻、区域信封持久化）/playerAttack/npcTurn（确定性策略）/playerMove（相邻区）/rescueAlly（同区援救恢复 1hp+移除失能）/passTurn（戒备让位）/retreat/结束判定+临时敌对投影清理+战斗轮 6 秒时钟；App 遭遇面板（行动者/区域/HP/攻击/移动/推进/援救/跳过/撤退）；杀进程后活跃遭遇面板自动恢复 | ✅ 模块+App+模拟器 |
| G02 开局原著/原创/时间地点/同伴 | 向导：真实原著事件锚点（按 worldTimeOrder）、地点（场景条目∪原著 location 实体）、原著/原创切换（原著含实体选择）、同伴多选≤2、锁定包版本+规则 0.2.0 展示；`opening-anchor` 占位与固定 worldTimeOrder=1 全部移除；canon 无位置事实时保守回退到玩家所选地点 | ✅ 模块+App+模拟器 |
| G03 权限过滤上下文 | `buildWorldContext`：公开 lore/约束 + 全队当前状态（资源/上限/状态/位置）+ 最近 6 条已提交公开叙事；秘密不进入玩家上下文 | ✅ 模块（长程含断言）；深检索（memory 排序融合）列为后续增强 |
| G04 构建发布门禁 | 分批映射覆盖全部事实（800/批，`factsOfferedToMapper` 记录进校验报告）；映射失败→blocking 审核项+不产出任何包；零可映射事实（且无冲突）→拒绝发布；失败块>0→设备端跳过映射并提示续建（needsRetry）；校验失败不再以纯 design_fill 包重试发布 | ✅ 模块+App+模拟器（早期 TypeError 路径即门禁生效）+ Node 真实抽取续建（3 块复用+1 块重试成功） |
| G05 事实时间与审核入口 | 映射载荷携带 validFrom/validTo/revealAt；审核队列 UI（列出 blocking/major/minor + 按事实解决/豁免并允许发布）；冲突 blocking 依旧阻止发布 | ✅ 模块+App+模拟器（2 个 invalid_proposal 入队，1 个已解决） |
| G06 原文件字节 SHA-256 | Kotlin `sha256BytesHex(base64)` 直接哈希原始字节；导入走 base64 通道不再字符串往返；`legacy_source_sha256`（迁移 006）保存旧重编码摘要仅供续建匹配，旧行永不改写；设备实测新导入世界 SHA=f9330ea0e0（真字节哈希） | ✅ 模块+App+模拟器 |
| 规则分派/存档升级政策 | `SHINEWORD_RULESET_VERSION=0.2.0`；无包锁的旧 V0.1 战役可读但拒绝用 V0.2 前进（明确中文提示重开）；存档 v2 老档拒绝导入并说明不伪造历史 | ✅ 模块（含回归） |

## 三、推理模型政策（维护者指令 2026-09-27）

不允许关闭推理模型的推理。Provider 参照 tavo-mini 方案改造：
- `message.reasoning_content` 严格与业务正文分离，绝不回落为叙事/合同文本；
- content 数组（typed parts）归并；
- 空补全分类（content_filter / length / reasoning_only / no_choices / empty，含 finish_reason）；
- reasoning-only 自动重试 2 次（预算 ×1.5 封顶于能力上限）后以"模型只输出了思维链"明确失败；
- usage 记录 reasoning_tokens；
- 移除一切自动 `thinkingDisabled`（profileStore 的 GLM 正则、抽取器 vendorOptions）；该字段仅剩显式人工退出；
- 物理请求超时 300s（移动端两处 Provider 构造点）。
验证：真实 GLM-5.3-Flash 推理开启下 V2 冒烟 3 提交/2 干净拒绝/0 失败；小说抽取 4 块 0 失败（一次 300s 内超时块经续建重试成功）。

## 四、模拟器验收记录（Medium_Phone / emulator-5554 / APK V0.2.0-p2.2）

升级安装（保留旧数据：4 本既有小说与既有战役完好；升级前 DB 已备份 `.tmp/qa/pre-upgrade-shineword.db`）。

| # | 步骤 | 结果 | 证据 |
|---|---|---|---|
| 1 | 导入《白篱梦》前 6 章（49.7KB 真实原文，真字节哈希） | ✅ 7 章/13 实体/8 事实/包 r1 published/2 审核项 | screen-08~；DB |
| 2 | 三宝书玩家视图（知识过滤横幅）↔ 编辑模式切换（剧透警告） | ✅ | screen-05/06 系列 |
| 3 | 开局向导：真实锚点（序1 定安伯请帝做媒定亲）+地点京城+原著角色（定安伯三女）+同伴（普通人守卫）+锁定 r1/规则 0.2.0 | ✅ 战役 camp-mujyjrvx 创建，v0·京城 | screen-09/10 |
| 4 | 探索/社交（真实 GLM）：stealth 提案被干净拒绝（canon 角色未掌握）；改观察/交谈类提交 turn-0001 success | ✅ 双请求 tokens 落库，快照含 cards/party，钟 300s | screen-12、DB |
| 5 | 战斗：进入遭遇（先攻/区域/HP）→跨区 touch 攻击被拒→移动 z-b→同伴攻击 1d8:[8] full_success（敌 6→3）→玩家无攻击技能干净报错→跳过（戒备）→NPC 回合（敌攻 1d8:[5]，我方 6→4，第 2 轮）→撤退 | ✅ 遭遇 escaped，敌对临时卡片清理 0 残留 | DB qa-enc |
| 6 | 长休 | ✅ v4，世界钟 485 分，HP 恢复 | UI |
| 7 | 杀进程恢复（遭遇中） | ✅ 重启后战斗面板自动恢复（第 1 轮行动者/区域/HP 保持） | UI 序列 |
| 8 | 回退分叉 | ✅ v4→fork@v3（快照含当时敌对卡片与 306s 战斗钟） | DB qa-rewind |
| 9 | 导出存档（SAF） | ✅ 16,123B v3 JSON（cards2/party2/turns4/ledger1/events6/rolls2） | Downloads 文件 |
| 10 | 干净库导入（设备导出文件→全新内存库） | ✅ 校验+摘要通过，恢复 v4，续玩 turn-0005→v5 | clean-restore-check.cjs PASS |
| 11 | 设备导入为新战役并续玩 | ✅ camp-mujzcbac v4 精确恢复→turn-0005/0006 提交至 v6 | UI+DB |
| 12 | 断网故障：关 WiFi 提交 | ✅ "Network request failed" 干净失败、0 staged/0 roll 残留、输入回填 | DB qa-offline |
| 13 | 恢复网络重试 | ✅ turn-0006 success（v6） | UI |
| 14 | 审核队列 | ✅ 2 项 invalid_proposal 列出；"按事实解决"生效并提示重发布 | UI |

已知过程问题（均已修复或有记录）：模拟器快照回滚吞掉一次测试导入与 APK 安装（改用 -no-snapshot 重装后复测）；SAF 选择器缺 application/json MIME 导致存档不可选（已修）；战斗中无攻击技能角色会卡轮（新增 passTurn）；LogBox 遮挡底部按钮（关闭后正常）。

## 五、未验收与如实限制

1. **100+ 动作长程**：已完成（真实 GLM-5.3-Flash，推理开启，引擎级与 App 共用同一 CampaignSession 栈）：**committed=100 / cleanRefused=21 / providerFailed=0**，休整 8、遭遇动作 9、里程碑 1（幂等断言过）、回退分叉 1、导出→干净库恢复→续玩 1；终态 hp=10（从未越上限）、台账 14 行无重复、投骰 26 次、世界钟 2680 分钟；每阶段后运行不变量断言（HP 封顶、台账去重、版本不超前）全部通过（详见 P2_REVIEW 附录 A）。UI 逐屏 100 步未执行（同栈理由）。
2. **真机 / minSdk 24 低版本设备**：无真机，未验收（延续既有限制）。
3. **Release 签名 APK**：`SHINEWORD_RELEASE_*` 口令仅维护者掌握；debug APK（V0.2.0-p2.2，含全部本轮验收）已交付 `dist/apk/debug/`。
4. **G03 深层记忆检索**：已接入最近叙事+队伍状态；memoryStore 相关度排序融合列入后续增强。
5. **多模型矩阵**：仅 GLM-5.3-Flash 一种已配置服务完成真实测试；DeepSeek/MiniMax 等第二种服务未配置，未验收。
6. 映射质量：推理开启后单批映射 novel 条目偏少（reasoning 消耗输出预算）；覆盖计数如实入校验报告，后续可调映射提示词/预算。
