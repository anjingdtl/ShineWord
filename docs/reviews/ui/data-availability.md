# 角色卡数据可达性核查（P4 开工依据）

> 阶段：P2 收尾 · 2026-09-28 · 分支 `feature/ui-revamp`
> 目的：把「角色卡三投影」所需字段逐项对照**当前** session 层与 mobile 桥接层的暴露情况，标出缺口与最小只读扩展方案。
> 约束：本轮只记录，不改任何代码；缺口扩展只允许在桥接层**新增只读查询函数**，不动任何写路径。

## 0. 结论速览

| 判定 | 数量 | 说明 |
|---|---|---|
| ✅ 已可直接取到 | 20 项 | 玩家/同伴卡的全部静态字段 + 装备 + 资源上限 |
| ⚠️ 半暴露（仅玩家或仅主队） | 5 项 | 资源当前值、状态、濒危态、时钟精度、队伍可见性 |
| ❌ 当前取不到（需只读扩展） | 5 项 | 练习点、能力冷却、关系、知识来源、任务进度 |
| ⛔ 结构性缺口（需要新查询，不是加字段） | 1 类 | NPC/生物的「公开投影」（已观察技能、士气、撤退阈值、已知印象） |

**一句话**：玩家卡与同伴卡在 P4 可以立刻全量渲染；**NPC/生物公开投影是唯一的硬缺口**——`getSummary()` 会把非队友角色降级成一张空壳卡，士气/撤退阈值/描述/已观察技能全部被抹掉。

## 1. 数据链路（现状）

```
SQLite
  └── GameStateSnapshot            src/domain/state/types.ts
        actors / itemOwners / skills / relationships / discoveries /
        questProgress / cards / party / encounters / clockSeconds
  └── ActorCard                    src/domain/characters/card.ts
  └── CampaignSession.getSummary() src/application/campaign/session.ts:151  → CampaignSummary
        { campaignId, branchId, title, worldId, packageRevision, rulesetVersion,
          anchorWorldTimeOrder, goal, state: GameStateSnapshot, cards: ActorCard[] }
  └── getCampaignState()           mobile/src/runtime.ts:106  → CampaignPlayState（UI 唯一入口）
```

`CampaignSummary.state` **已经是完整的 `GameStateSnapshot`**——也就是说 `skills`（含 practicePoints）、`relationships`、`discoveries`（含 knownVia）、`questProgress`、`itemSources` 都随 summary 一起来到 mobile 侧，**只是 `getCampaignState()` 没有把它们投影进 `CampaignPlayState`**。

这决定了缺口性质：绝大多数缺口是**桥接层投影不足**，而不是底层数据缺失。补充方式就是新增只读的投影函数，零风险、零写路径改动。

## 2. 逐字段核查表

图例：✅ 已暴露 · ⚠️ 半暴露 · ❌ 未暴露 · ⛔ 结构性缺口

| # | 角色卡区块 | 所需字段 | 域层来源 | 现状 | 获取方式 |
|---|---|---|---|---|---|
| 1 | 头部徽记 | `kind`（canon/original/companion/npc/creature） | `ActorCard.kind` | ✅ | `playerCard.kind` / `cards[].kind` |
| 2 | 头部徽记 | `powerTier`（ordinary/enhanced/supernatural） | `ActorCard.powerTier` | ✅ | 同上 |
| 3 | 姓名徽标 | `name` | `ActorCard.name` | ✅ | 同上 |
| 4 | 姓名徽标 | `originId` / `pathId`（出身·道途） | `ActorCard` | ✅ | 同上（可空） |
| 5 | 姓名徽标 | `defense` | `ActorCard.defense` | ✅ | 同上 |
| 6 | 属性 | `attributes` 六维 1–3 | `ActorCard.attributes` | ✅ | 直接用；pip 轨 `total=3` |
| 7 | 技能 | `skills: Record<skillId, SkillRank>` | `ActorCard.skills` | ✅ | 骰面由 `SKILL_RANK_DIE` 映射（d4/d6/d8/d10/d12） |
| 8 | 技能 | 技能名（skillId → 中文名） | `worldStore` 世界包条目 | ⚠️ | 需 `getWorldSetup().skills`（已存在，含 `name`）；注意 key 前缀差异，用 `resolveSkillKey()` |
| 9 | 技能 | **`practicePoints`** | `GameStateSnapshot.skills[]` | ❌ | 只读扩展：见 §3.1 |
| 10 | 技能 | 阈值 5/10/20/40 | `PRACTICE_THRESHOLDS` | ✅ | 纯常量，直接 import |
| 11 | 资源 | 当前值 `resources` | `ActorState.resources` | ⚠️ 仅玩家 | `playerResources` 已有；其他角色见 §3.2 |
| 12 | 资源 | 上限 `resourceMax` | `ActorCard.resourceMax` | ✅ | 直接用 |
| 13 | 资源 | `conditions[]` | `ActorState.conditions` | ⚠️ 仅玩家 + 主队 | `playerConditions` / `partyStatuses[].conditions`；他人见 §3.2 |
| 14 | 资源 | `lifeStatus`（含 critical） | `ActorState.lifeStatus` | ⚠️ 同上 | `playerLifeStatus` / `partyStatuses[].lifeStatus` |
| 15 | 资源 | `abilityCooldowns` | `ActorState.abilityCooldowns` | ❌ | 只读扩展：见 §3.2 |
| 16 | 能力 | `preparedAbilities` 四槽 | `ActorCard.preparedAbilities` | ✅ | 直接用；槽数常量 `PREPARED_ABILITY_SLOTS = 4` |
| 17 | 能力 | 能力名（abilityId → 定义） | 世界包条目 | ⚠️ | 需按 `entryId` 查世界包（`getWorldSetup()` 不含 abilities 定义） |
| 18 | 装备 | `itemOwners` + `ItemSourceSnapshotEntry` | `GameStateSnapshot.itemOwners/itemSources` | ✅ | `items[]`（itemId / ownerActorId / source.kind / source.sourceId） |
| 19 | 装备 | 物品名与定义 | 世界包 `item` 条目 | ⚠️ | 需按 `itemId` 查世界包条目 |
| 20 | 关系 | `relationships[]`（stance + closeness） | `GameStateSnapshot.relationships` | ❌ | 只读扩展：见 §3.3 |
| 21 | 同伴指令 | `companionDirective`（五态） | `ActorCard.companionDirective` | ✅ | 同伴卡直接带 |
| 22 | NPC 公开投影 | `description`（已知印象） | `ActorCard.description` | ⛔ | 见 §3.4 |
| 23 | NPC 公开投影 | `combatBehavior.morale` / `retreatThreshold` | `ActorCard.combatBehavior` | ⛔ | 见 §3.4 |
| 24 | NPC 公开投影 | 已观察技能 | 世界包 `actor_template` + 遭遇目击 | ⛔ | 见 §3.4 |
| 25 | 知识图鉴 | `discoveries[].knownVia`（witnessed/told/inferred） | `GameStateSnapshot.discoveries` | ❌ | `discoveredEntryIds` 只有 entryId；来源见 §3.5 |
| 26 | 任务日志 | `questProgress[]`（status + counters） | `GameStateSnapshot.questProgress` | ❌ | 只读扩展：见 §3.5 |
| 27 | 世界时钟 | 精确 `clockSeconds` | `GameStateSnapshot.clockSeconds` | ⚠️ | 目前只投影了 `clockMinutes`（取整） |
| 28 | 队伍 | `party[]`（groupId / role） | `GameStateSnapshot.party` | ✅ | `party[]` 已暴露（含 `groupId`） |

## 3. 缺口的只读扩展方案

> 全部为**新增只读函数**，签名落在 `mobile/src/runtime.ts`（桥接层）或 `src/application/campaign/session.ts` 的读方法上，**不改任何写路径、不改 schema**。

### 3.1 技能练习点（#9）

`CampaignSummary.state.skills` 已是 `SkillSnapshotEntry[]`，缺的只是投影。

```ts
// mobile/src/runtime.ts（新增）
export interface ActorSkillProgressView {
  actorId: string;
  skillId: string;
  rank: SkillRank;          // 骰面由 SKILL_RANK_DIE[rank] 得到
  practicePoints: number;   // pip 进度 = progress / PRACTICE_THRESHOLDS[rank]
  threshold: number;        // 5 / 10 / 20 / 40 / Infinity(master)
}
export async function getActorSkillProgress(
  campaignId: string, branchId: string, actorId: string,
): Promise<ActorSkillProgressView[]>;
```

实现：`createSessionNoop()` → `getSummary()` → `summary.state.skills?.filter(s => s.actorId === actorId)`，阈值取 `PRACTICE_THRESHOLDS[rank]`。**零新增查询**。

### 3.2 全角色资源 / 状态 / 冷却（#11 #13 #14 #15）

当前只投影了玩家与主队同伴；NPC 与遭遇参与者的即时状态取不到。

```ts
export interface ActorRuntimeView {
  actorId: string;
  locationId: string;
  zoneId?: string;
  resources: Record<string, number>;
  conditions: string[];
  lifeStatus: 'active' | 'incapacitated' | 'critical' | 'dead';
  abilityCooldowns?: Record<string, number>;
}
export async function getActorRuntimeStates(
  campaignId: string, branchId: string,
): Promise<Record<string, ActorRuntimeView>>;
```

实现：`summary.state.actors` 整体映射。注意**可见性策略**：`getCampaignState()` 现在用 `visiblePartyIds`（主队）过滤 `itemOwners`，扩展时应对「战斗参与者」与「同地点 NPC」放行、其余仍过滤，避免把 GM-only 数据推给 UI。具体放行规则需在 P4 开工前确认（见 §4 待决）。

### 3.3 关系（#20）

```ts
export interface RelationshipView {
  fromActorId: string; toActorId: string;
  stance: string; closeness: number;   // −100..100 语义由规则层定义
  updatedTurnId: string | null;
}
export async function getBranchRelationships(
  campaignId: string, branchId: string, actorId?: string,
): Promise<RelationshipView[]>;
```

实现：`summary.state.relationships`，可按 `fromActorId === actorId` 过滤成「某角色的关系网」，或不过滤用于「队伍关系网图」（plan §5.6）。

### 3.4 ⛔ NPC/生物公开投影（#22 #23 #24）—— 唯一的硬缺口

**现状问题（读 `session.ts:168-186`）**：`getSummary()` 对「不在主队、也不在活动遭遇中」的角色直接不返回卡；对「在活动遭遇中」的角色返回一张**降级合成卡**：

```ts
{ kind: 'creature', controller: 'gm', attributes: { 全 1 }, skills: {}, abilities: [],
  preparedAbilities: [], resourceMax: {}, defense: 1, powerTier: 'ordinary', cardRevision: 0 }
```

即 `description`、`combatBehavior.morale`、`combatBehavior.retreatThreshold`、真实属性/技能、`templateId` **全部丢失**（`templateId` 丢失影响最大——它是回到世界包取公开条目的唯一钥匙）。

三条可行路线（P4 开工前必须选一条）：

| 路线 | 做法 | 代价 | 风险 |
|---|---|---|---|
| A · 保留 `templateId` + `description`/`combatBehavior` | 改 `getSummary()` 的降级投影：只抹去数值（attributes/skills/preparedAbilities），保留身份与公开行为字段 | 改的是既有读方法，需回归 P2 验收用例 | 低（仍是只读投影，无写路径） |
| B · 新增专用只读查询 | `getNpcPublicProjection(campaignId, branchId, actorId)`：从 `actor_cards` 直接读原始卡，再按 `visibility` 过滤世界包条目决定能露什么 | 新函数，完全不动 `getSummary()` | 最低（推荐） |
| C · 接受降级 | NPC 卡只显示关系 + 遭遇面板里的血量，不做「未探明」占位 | 0 | 放弃 plan §5.5 的「侦察即玩法」设计 |

**推荐 B**：`getNpcPublicProjection()` 在桥接层新增，内部复用 `worldStore.getWorldPackage()` 的条目 `visibility === 'public'` 判定 + `ActorCard.description` / `combatBehavior`，把「已观察技能」定义为「该模板 `visibility: public` 的 skills 子集」。这样 `getSummary()` 的行为完全不变，P2 验收用例不受影响。

### 3.5 知识来源与任务进度（#25 #26）

```ts
export interface DiscoveryView {
  entryId: string; knownVia: 'witnessed' | 'told' | 'inferred';
  knownAtStateVersion: number; sourceTurnId: string;
}
export interface QuestProgressView {
  questId: string; status: 'available'|'active'|'succeeded'|'failed'|'abandoned';
  counters: Record<string, number>; completedStateVersion: number | null;
}
// 两者都可直接从 summary.state.discoveries / questProgress 投影，新增两个只读函数即可
```

## 4. 待决问题（P4 开工前需确认）

1. **NPC 可见性放行规则**：§3.4 选 A/B/C 哪条？若选 B，「已观察技能」的判定是「模板 public 技能」还是「遭遇中被使用过的技能」？
2. **`getCampaignState()` 是否允许变宽**：把 `actorRuntime`、`relationships` 等并进现有返回对象（调用点少、改动小），还是全部新增独立只读函数（更保守，但 P4 需要多取一次）？当前倾向后者。
3. **技能名映射**：卡片里是 `skill-stealth` 这类 key，世界包条目是 `skill-stealth`，规划器说 `stealth`——UI 展示需统一走 `resolveSkillKey()`；是否需要在桥接层提供一个「skillId → 展示名」的解析函数？
4. **`clockSeconds` 精度**：古典主题要显示「戌时三刻」式文案，需要 `clockSeconds` 而非取整的分钟；是否顺手在 `CampaignPlayState` 补 `clockSeconds`（纯字段补充，无逻辑）？

## 5. 明确不改的部分

- `src/domain/**`、`src/application/**` 的**写路径**：`commitTurn`、`encounterFlow`、`createCampaign`、`rewind`、`saveFile` 等一律不动。
- `migrations/**`：不新增表、不改 schema —— 本核查确认**所有缺口数据都已存在**于 `GameStateSnapshot` / `actor_cards` / 世界包条目中。
- `mobile/src/*.ts` 既有导出：只**追加**函数与类型，不修改现有函数签名（避免影响 P2 已验收的行为）。
