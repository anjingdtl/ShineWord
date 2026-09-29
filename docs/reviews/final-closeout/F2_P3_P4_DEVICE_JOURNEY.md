# F2 — 第三期 P3/P4 完整设备旅程

**阶段：** F2（P3/P4 用户旅程、Play 旅程、队伍/信息面板、Encounter、NPC 公开投影安全、Rewind/Save/Resume）
**分支：** `feature/final-acceptance-closeout`
**日期：** 2026-09-29（Asia/Shanghai）

## 0. 结论先行

| 验收项 | 本轮结论 |
|---|---|
| F2 完整第三期用户旅程（首启 → Profile → Library → WorldDetail → Opening → 原创角色 → 3 技能 → 2 同伴 → Directive → Campaign → Play） | **NOT TESTED（设备）** |
| F2.1 Play 旅程（自由/无骰/技能检定/成败/Narrator 恢复/短休/长休/训练/角色卡/Directive） | **NOT TESTED（设备）**；相关规则由核心回归覆盖 |
| F2.2 队伍与信息面板（Party/Quest/Inventory/Knowledge，资格来自 Session/Projection） | **代码级 PASS**；设备 NOT TESTED |
| F2.3 Encounter 完整旅程 | **NOT TESTED（设备）**；战斗规则由核心回归覆盖 |
| F2.4 NPC Public Projection 安全 | **单元 PASS（本轮加固）**；运行期 UI PASS 为**代码级**，设备 NOT TESTED |
| F2.5 Rewind / Save / Resume | **代码级 PASS**；设备 NOT TESTED |

> 本沙箱无 Android 设备（无 `adb` / `emulator` / `/dev/kvm`，见 [F0](F0_BASELINE.md#5-设备与模型可用性)）。凡必须运行 App 才能取证的项，一律标注 NOT TESTED，不以「代码看起来对」冒充设备通过。

## 1. 设备阻断说明

- 无 `adb` 二进制、无 `emulator` 二进制、无 `/dev/kvm` → 无法启动/连接任何 AVD。
- 因此：首次启动、SAF 文件选择、真实 Opening 4 步、创建角色/Campaign、Play 交互、Sheet Back、Rewind 菜单文案、存档导出/导入设备旅程、杀进程恢复 —— 全部 **NOT TESTED**。
- 禁止直接改 DB 冒充用户流程；本轮未做任何此类操作。

## 2. 代码级覆盖（可复现）

以下为**核心回归**实际断言（`npm test`，224 通过）。它们**不等于**设备验收，仅证明底层规则/投影/持久化语义正确。

### 2.1 F2.4 NPC Public Projection 安全（硬门禁）—— 单元 PASS

文件：[phase3-play-projection.test.cjs](file:///workspace/tests/phase3-play-projection.test.cjs)

- `NPC public projection hides every GM-only field`：断言投影对象**不含** `attributes` / `abilities` / `preparedAbilities` / `resourceMax` / `skills` / `templateId` / `entityId` 键；序列化文本不含隐藏技能 id 与模板 id。
- **本轮新增** `NPC public projection never surfaces GM-only world entries or future secrets`：构造含 `entityId` / `templateId` / gm-only prepared ability / gm-only quest entry / `future` lore entry 的原始卡与条目集，断言投影序列化文本**不含** `entity-steward`、`tpl-steward`、`ability-secret`、`袖里藏毒`、`查明失踪人口`、`沈府灭门真相`，且 `resourceMax` 不作为键出现。
- `unobserved NPCs expose no runtime state at all`：不可观测 NPC 的 `lifeStatus` 为 `null`、`visibleConditions` 为空、序列化不含 `critical`。
- **未探明占位**：`unknownSections` 恒含 `attributes` / `abilities` / `equipment`，隐藏技能计入 `unknownSkillCount`；UI 侧 [NpcCharacterSheet.tsx](file:///workspace/mobile/src/ui/features/play/character/NpcCharacterSheet.tsx) 用「未探明」行占位（`另有 N 项未探明`），未确认区域**不消失**。

> 单元 PASS + UI 代码级 PASS；**运行期「打开玩家 NPC Sheet 无泄漏」未在设备观测**，标注 NOT TESTED。

### 2.2 F2.2 信息面板资格来源（Session/Projection）—— 代码级 PASS

同文件 `player and current party members project completely` / `actors who left the party are not leaked`：确认投影只输出当前队伍成员、离队者技能与物品不泄漏、`knownVia` 来源字段随发现记录输出。该投影是 UI 的唯一数据来源，UI 不自造资格。

### 2.3 F2.3 Encounter / 成长 / 战斗规则 —— 核心回归覆盖

- [growth-combat.test.cjs](file:///workspace/tests/growth-combat.test.cjs)：练习点阈值、每遭遇每技能 1 点、距离带、冻结先攻、伤害下限 0、0 HP disabled。
- [m4-game.test.cjs](file:///workspace/tests/m4-game.test.cjs)：分支 fork/rewind、100 回合长程、重放不重掷。
- Encounter HUD 的 InitiativeStrip / ZoneTrack / CombatantCard / CombatActions 设备交互 **NOT TESTED**；本轮只在 F1.2 修正了 CombatantCard/ZoneTrack 的语义文字槽（对比度）。

### 2.4 F2.5 Rewind / Save / Resume —— 代码级 PASS

- [recovery.test.cjs](file:///workspace/tests/recovery.test.cjs) / [recovery-policy.test.cjs](file:///workspace/tests/recovery-policy.test.cjs)：Planner/Roll/Narrator 中断恢复，已持久化骰子不重掷。
- [closeout-c6.test.cjs](file:///workspace/tests/closeout-c6.test.cjs) 等：`.shineword-save.json` / `.shineword-world.zip` 导出/导入与旧格式兼容。
- 设备端「导出 → 新环境 import → state/party/skills/quest/knowledge/bindings 恢复」**NOT TESTED**。

## 3. F2.1 Play 旅程字段一致性

目标字段：`practicePoints` / `threshold` / `HP` / `stamina` / `conditions` / `lifeStatus` / `cooldown` / `inventory` / `relationships`，要求与权威 state 一致。

- **代码级**：[phase3-play-projection.test.cjs](file:///workspace/tests/phase3-play-projection.test.cjs) 断言这些字段直接来自 `GameStateSnapshot`，投影不改写权威值（如 `resources.hp=7`、`abilityCooldowns['ability-flurry']=9`）。
- **设备级**：NOT TESTED。

## 4. 为了关闭 F2 所需的条件

- 一台可用 Android 设备/AVD（API 37.1 现有基线，尽量补 API 24 与 Android 15/16），且允许安装 debug 或可 `run-as` 的包。
- 一台配置好的模型 Profile（用于 Play 旅程的 Planner/Narrator）。
- 具备后：按 §十三～十八顺序执行旅程并留设备截图（**仅合成 QA 世界**，禁止真实小说原文与截图入库）。

## 5. 汇总口径

- P3/P4 的**代码/规则/投影**语义：由核心回归（224 通过）证明正确。
- P3/P4 的**设备旅程与视觉**：本沙箱 **NOT TESTED**，不能据此把「第三期验收」改为通过（见 [FINAL_REPORT.md](FINAL_REPORT.md)）。