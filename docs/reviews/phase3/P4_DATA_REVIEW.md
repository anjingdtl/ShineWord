# P4 数据层 Review（只读 Projection）

> 方案：`docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md` §13/§14/§16
> 依据文档：`docs/reviews/ui/data-availability.md`（P2 收尾核查）
> 分支：`feature/phase3-ui-gameplay`
> 本轮不运行测试 / typecheck / 构建；本文为**静态审查 + 设计决策**记录。

## 1. 决策落实（方案 §14）

| 决策 | 落实 |
|---|---|
| §14.1 NPC / 生物公开投影：选择 B | 新增专用只读查询 `getNpcPublicProjection(campaignId, branchId, actorId)`；**未修改** `getSummary()` 既有降级行为 |
| §14.2 Play UI 使用聚合只读 Projection | 新增 `getPlayUiProjection(campaignId, branchId)`，一次读取得到同一 `stateVersion` 的全部 UI 数据 |
| §14.3 名称解析 | Projection 内直接输出展示名（skill/ability/item/quest/entry 均由世界包条目解析），UI 不再显示 `skill-stealth` 这类内部 id；原始 id 仍保留在字段中供 Debug 详情 |
| §14.4 clockSeconds | `PlayUiProjection.clockSeconds` 为权威值（`state.clockSeconds ?? clockMinutes * 60`） |
| §14.5 快捷行动不是 Planner 建议 | 本阶段不新增任何 LLM 调用；快捷行动在 P4.4 由本地状态推导 |

## 2. 改动清单与边界证明

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/application/campaign/playProjection.ts` | **新增**（核心，纯函数） | 只读投影的构造与可见性策略；不 import 任何数据库/写入模块 |
| `mobile/src/playProjection.ts` | **新增**（桥接） | 只负责加载：`getSummary()` 一次 + 世界包条目 + `actor_cards` 原始卡 |
| `mobile/src/runtime.ts` | **追加导出** | 新增 `createReadOnlySession()`（内部即既有 `createSessionNoop()`）；未修改任何既有函数签名或行为 |
| `tests/phase3-play-projection.test.cjs` | **新增** | 覆盖方案 §16.3 五项要求 |

### 边界证明（方案 §2.1 例外条款）

- **不改变写路径**：`commitTurn`、`encounterFlow`、`createCampaign`、`rewind`、`saveFile`、`publish`、`trainSkill` 等一律未触碰；新增模块无 `INSERT/UPDATE/DELETE`。
- **不改变存档 schema**：无 migration、无新表、无新列。所有数据来自既有 `GameStateSnapshot`、`ActorCard`、`world_packages` 条目。
- **不改变既有 P2 行为**：`getSummary()`、`getWorldSetup()`、`getCampaignState()`、`listHistory()` 行为均未修改；`createReadOnlySession` 是新增导出。
- **有新增回归测试**：`tests/phase3-play-projection.test.cjs`（已编写，**本轮未运行**，待线下开发机执行 `npm run verify:core`）。

## 3. 可见性策略（冻结）

### 3.1 玩家 / 同伴（全量）

- 可见集合 = **当前 `state.party` 成员（含主角）**。
- `player` = `controller === 'player'` 的卡；`party` = 其余在册成员。
- **离队角色**：离队后 `state.party` 不再有该行 → 其资源、技能、物品全部不出现在投影中（测试用例覆盖）。
- 技能行来自 `state.skills`（含 `practicePoints`），阈值取规则域 `PRACTICE_THRESHOLDS[rank]`（master 为 `null`，表示已是终态）；骰面取 `SKILL_RANK_DIE[rank]`。
- 老快照没有 `skills` 表时回退到卡上的 `skills`（练习点记 0），不伪造进度。

### 3.2 NPC / 生物（公开投影）

| 类别 | 是否输出 |
|---|---|
| `name` / `kind` / `description` / `morale` / `retreatThreshold` | ✅ 输出（模板公开字段） |
| 已观察技能 | ✅ 仅当该技能在世界包中的条目 `visibility === 'public'` |
| 未观察技能数量 | ✅ 只输出**数量**，不输出 id（避免 id 名称本身泄露情报） |
| `conditions` / `lifeStatus` | ⚠️ 仅当角色**可观察**（处于活动遭遇，或与玩家同地点）时输出；否则为 `[]` / `null` |
| 与玩家的关系 | ✅ 输出（`stance` + `closeness`） |
| `attributes` / `abilities` / `preparedAbilities` / `resourceMax` / 原始技能表 / `templateId` / `entityId` | ⛔ **绝不输出**，并在 `unknownSections` 中标记为「未探明」 |
| 私密未来信息 / GM-only 世界条目 | ⛔ 不读取 |

实现细节：`getSummary()` 对非队友角色的降级卡会丢失 `templateId`/`description`/`combatBehavior`，因此桥接层从 `actor_cards` 读取**原始卡**（`SELECT card_json FROM actor_cards WHERE branch_id = ? AND actor_id = ?`），再由核心策略过滤；这条读路径不经过 `getSummary()`，因此 P2 的 `getSummary()` 行为完全不变。

## 4. 已知限制与后续

1. **已观察技能的口径**：采用方案 §14.1 的「模板 `visibility: public` 的 skills 子集」，而非「遭遇中被使用过的技能」；后者需要新的目击记录，属未来版本。
2. **同地点可见性**：`isActorObservable()` 把「与玩家同地点」视为可观察。若未来希望更严格（仅遭遇内），只需改这一个函数。
3. **NPC 原始卡**：当前从 `actor_cards` 直读。若该行不存在（例如事件结束、临时投影已删除），投影返回 `null`，UI 显示「未探明」而不是伪造数据。
4. **投影缓存**：P4 的 Controller 以 `stateVersion` 为缓存键；投影本身无缓存、无副作用。

## 5. 测试用例（已编写，未运行）

文件：`tests/phase3-play-projection.test.cjs`

| 用例 | 覆盖要求 |
|---|---|
| player and current party members project completely | 玩家全量 / 主队同伴全量 / 阈值与骰面 / 名称解析 |
| actors who left the party are not leaked | 离队角色不泄漏（技能、物品） |
| NPC public projection hides every GM-only field | GM-only 字段不泄漏（含 JSON 级检查） |
| unobserved NPCs expose no runtime state at all | 未观察角色不返回运行期状态 |

> 执行状态：**未运行**（本轮任务约束）。需在线下开发机执行 `npm run verify:core`，
> 其中包含 `build:core`（编译 `src/**` 到 `dist/`）与 `node --test tests/*.test.cjs`。