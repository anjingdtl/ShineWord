# P4 阶段 Review（P4.2 – P4.11）

> 方案：`docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md` §13–§27
> 分支：`feature/phase3-ui-gameplay`
> 数据层决策与只读投影见 [P4_DATA_REVIEW.md](./P4_DATA_REVIEW.md)（P4.1）
> 本轮不运行测试 / typecheck / APK / 模拟器；所有运行期与构建期验证项均标注为**待线下开发机验证**。

---

## P4.2 Controller 与 UI 解耦

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| Controller（新增） | `features/play/hooks/usePlayController.ts` | 承载 loadState / loadHistory / submit / refresh / rest / rewind / export / train / party action / encounter action / error / notice / busy |
| 页面收缩 | `screens/PlayScreen.tsx` | 不再包含任何业务函数；只保留路由上下文、Controller 与（待后续阶段替换的）展示层 |
| 世界皮肤接入 | `screens/PlayScreen.tsx` | 整页包在 `ThemeScope` 中，世界主题覆盖在游玩页同样生效（P3.5 已实现于世界详情） |
| 数据契约 | `mobile/src/runtime.ts` | `TurnView` 增加结构化 `roll`（diceCount/dieSides/rolls/highest/difficulty/margin/grade）与 `stateVersion`，供 P4.3 的 RollStrip 使用；不再拼接展示字符串 |
| 本地战斗推导 | `usePlayController` 的 `combat` | 攻击目标 / 待援救同伴 / 标准移动 / 疾行 / 可加入同伴 / requestId 全部本地推导，不新增 LLM 调用 |

### 原则核对（方案 §17）

| 原则 | 核对结果 |
|---|---|
| Controller 不画 UI | 满足：文件内无 JSX、无样式 |
| 不保存新的权威状态 | 满足：只保存投影/历史/界面态（busy、notice、intent），分支快照仍是唯一权威 |
| 不重新实现 Session 逻辑 | 满足：每个动作都调用与 P2 相同的 Session 方法，参数与 P2 逐项对齐（含 `requestId` 形状与 `rewind` 的新分支 id 规则） |

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 旧页面在遭遇面板里用 `state.cards` 查找待加入者姓名 | 已改为投影名册（玩家 + 队伍），语义一致 |
| 2 | `rewind` 依赖 `state.stateVersion`，投影化后需重新取数 | 已改用 `projection.stateVersion`；回退目标版本算法不变（`stateVersion - 1`） |
| 3 | 同伴指令按钮原样显示 `follow/protect` 等内部枚举 | 已改中文标签（跟随/支援/保护/节省资源/撤退），并标出当前指令 |
| 4 | 招募与重入列表依赖 `state.cards` 判断是否已在队 | 改为基于投影名册过滤，行为等价 |
| 5 | 提交失败后的重试语义 | 保持：失败时把 intent 写回输入框，且清空「拟定检定…」提示 |
| 6 | 历史数据只有玩家 intent 缺失（方案 §18.1 不允许伪造） | 本阶段未新增 intent 字段；RollStrip 只展示真实存在的骰点字段，intent 留待未来版本 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| 回合 / 短休 / 长休 / 回退 / 导出 / 训练 / 队伍 / 遭遇动作的真机回归 | **未验证** |
| 世界主题覆盖在游玩页生效 | **未验证** |

### P4.2 出口对照（方案 §17）

| 出口条件 | 状态 |
|---|---|
| PlayScreen 代码显著缩减，并保持当前行为回归 | 满足：业务函数 0 行留在页面（全部迁入 Controller）；行为待真机回归 |

---

## P4.3 叙事流 NarrativeFeed

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 顶栏（新增） | `features/play/PlayHeader.tsx` | 战役名 + 分支 + 地点 + 世界钟（按皮肤格式：墨=时辰、烛=第 N 日、漫=D#、梭=T+ddd:hh:mm）+ 状态版本；`clockSeconds` 仍是唯一权威值 |
| 回合卡（新增） | `features/play/TurnCard.tsx` | 结构：回合序号 + v 状态版本 → 检定条（若有骰）→ 剧情正文；断点恢复标记 |
| 骰点条（新增） | `features/play/RollStrip.tsx` | `DieBadge` + `NdM 取高` + 每颗骰值（取高者高亮加粗）+ 难度/余量 + 四档结果（大成功/成功/失败/大失败，图形 + 文字，非颜色单通道） |
| 叙事流（新增） | `features/play/NarrativeFeed.tsx` | FlatList；`onScroll` 跟踪是否贴近底部，只有读者在底部时才自动滚到最新；busy 不清空历史，仅在底部追加「正在结算…」 |
| 页面替换 | `screens/PlayScreen.tsx` | 顶栏与叙事流改用新组件；遭遇面板 / 队伍面板 / 输入区仍为待替换的 P2 结构 |

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 结果等级必须与规则域枚举一致 | 已核对：仅映射 `full_success` / `success` / `failure` / `severe_failure` 四档，未知值原样显示而不猜测 |
| 2 | 历史没有玩家 intent（方案 §18.1 禁止伪造） | 未新增 intent 字段，回合卡也不显示 intent；骰点条只展示 `RollRecord` 中真实存在的字段 |
| 3 | 自动滚动会打断阅读旧内容 | 已实现「仅当贴近底部（48dp 内）才自动滚动」，并加一帧延迟等待新行测量 |
| 4 | `busy` 期间旧实现把提示塞进输入区，且历史列表被整体重渲染 | 改为 feed 底部轻量提示，历史数组不被清空 |
| 5 | 旧实现把骰点拼成字符串（`2d8: [4, 7]`）后由 UI 解析 | 改为结构化 `TurnRollView`（diceCount/dieSides/rolls/highest/difficulty/margin/grade），UI 不再解析字符串 |
| 6 | 时辰换算属展示派生、非规则 | 已核对该逻辑只用于世界钟格式化，未参与任何检定/结算 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| 叙事流四主题截图 | **未截图** |
| 有骰回合 / 无骰自动成功回合 / Narrator 失败恢复 / App kill 后恢复的展示 | **未验证** |
| 「阅读旧内容时不抢滚动」的真机行为 | **未验证** |
| 世界钟四皮肤格式（墨=戌时三刻 / 梭=timecode 等） | **未验证** |

---

## P4.4 ActionComposer + 情境快捷行动

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 快捷行动（新增） | `features/play/hooks/useContextualActions.ts` | 本地推导：遭遇态给「攻击 <目标> / 援救 <队友> / 移动到 <区域> / 戒备 / 撤退」，探索态给「观察四周 / 查看人物 / 与同伴交谈 / 查看任务（仅有进行中任务时）/ 推进任务：<名>」 |
| 快捷 chips（新增） | `features/play/QuickActions.tsx` | 横滑 chip 条；点击只调用 `onChangeText`（填入输入框），**不存在** 自动发送路径 |
| 常驻输入栏（新增） | `features/play/ActionComposer.tsx` | 快捷条 → 多行 `TextField`（500 字上限，接近上限显示计数）→ 「行动」按钮（≥44dp，busy 明确） |
| 页面替换 | `screens/PlayScreen.tsx` | 输入区改用 `ActionComposer`；旧 `TextInput` + 旧 `primary` 按钮移除 |

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 方案 §14.5/§35 禁止为快捷行动新增 LLM 调用或自动发送 | 已核对：`useContextualActions` 纯本地推导；`QuickActions` 只 `onChangeText`，且 `ActionComposer` 的 `onSubmit` 仅由按钮触发 |
| 2 | 计划中的「Planner 快捷建议」在现有协议下没有数据来源 | 名称与实现统一为「情境快捷行动」，来源是遭遇/任务/队伍等本地状态，不使用不存在的数据 |
| 3 | 键盘遮挡风险 | AndroidManifest 已为 Activity 设置 `windowSoftInputMode="adjustResize"`，输入栏位于页面底部、不参与滚动，键盘弹出时随窗口上移；真机行为待验证 |
| 4 | 提交失败必须恢复输入 | 由 Controller 负责写回 intent（P4.2 已实现），输入栏不做二次处理，避免两处状态 |
| 5 | 移动端 Enter 语义 | 多行输入保留换行；发送只由按钮触发，避免误发 |
| 6 | 字数上限「合理」 | 500 字上限 + 接近上限时显示剩余字数；上限只在 UI 层，未改任何协议 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| 输入栏常驻、键盘弹出不遮挡（adjustResize） | **未验证** |
| 点击快捷行动只填入、不发送 | **未验证** |
| 提交失败后输入内容恢复 | **未验证** |
| 无新增快捷行动 LLM 请求 | 静态确认（代码路径中无 LLM 调用），**运行期未验证** |

---

## P4.5 队伍条 + 角色卡载体（Party Strip & Modal Sheet）

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 队伍条（新增） | `features/play/PartyStrip.tsx` | 玩家 + 同伴横排：姓名首字徽记、气血/体力双细条（数值同时给出）、濒危 `⚠危` / 失能 `⛔失能` 文字标记、同伴指令角标（跟/援/护/省/退）；点按打开角色卡 |
| 面板载体（新增） | `features/play/panels/PlayPanel.tsx` | `Modal` + `Animated` 底部弹层（**未引入 Reanimated / 第三方 Sheet**）；背景遮罩淡入、面板上滑；Android Back 由 Modal `onRequestClose` 优先关闭面板 |
| 角色卡框架（新增） | `features/play/character/CharacterSheet.tsx` | 身份区（名/类型/出身·道途/等阶/防御/队伍归属/指令）+ 资源区（气血/体力条 + 状态）+ 属性区；后续阶段以 `children` 追加技能/能力/装备/关系区块 |
| 页面接线 | `screens/PlayScreen.tsx` | 叙事流与输入栏之间插入队伍条；点按打开 `PlayPanel`，内嵌 `CharacterSheet` |

> 说明：方案 §4 的目标结构里角色卡分成 `PlayerCharacterSheet / CompanionCharacterSheet / NpcCharacterSheet`，本阶段先落地共用的 `CharacterSheet` 框架（玩家/同伴共用），
> P4.6 在同一框架上补齐玩家与同伴的完整区块，P4.7 再加入 NPC 公开投影变体；阶段提交按此拆分（P4.5 用「party strip and modal sheet carrier」，P4.6 沿用方案 §21.2 的
> `feat(play): add player and companion character sheets`）。

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 方案禁止新增大型 UI 框架 / Reanimated | 满足：仅 `Modal` + `Animated`；`useNativeDriver: true` |
| 2 | 方案 §30 要求「Modal / Sheet 可关闭」「Android Back 先关 Sheet」 | 已实现：遮罩点击、✕ 按钮、`onRequestClose`（Back）三条关闭路径 |
| 3 | 角色资源条必须同时显示数值 | 已实现：`Bar` 的 `valueText` 输出 `当前 / 上限`，并带无障碍标签 |
| 4 | 队伍条上的状态不能只靠颜色 | 已实现：濒危/失能用「⚠危 / ⛔失能」文字，指令用字符角标 |
| 5 | 面板打开动画在关闭时会不可见（Modal 立即卸载） | 已简化为仅保留入场动画，删除无意义的退场补间 |
| 6 | 队伍条不应触发任何游戏动作 | 已核对：只 `onSelect` 打开角色卡，所有写动作仍走 Controller |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| 队伍条四主题截图 / 面板四主题截图 | **未截图** |
| Android Back 先关面板、面板可关闭 | **未验证** |
| 队伍条气血/体力与真实状态一致（含濒危、失能） | **未验证** |

---

## P4.6 玩家与同伴角色卡

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 区块（新增） | `features/play/character/CharacterSections.tsx` | 技能区（骰面 / 等阶名 / 五阶阶梯 / 真实练习进度 `practicePoints / PRACTICE_THRESHOLDS[rank]` / 终阶显示「已至终阶」）、能力四槽（含冷却到期的状态版本）、装备与物品（含来源）、关系（按显示名 + 亲密条）、同伴指令五态选择 |
| 玩家卡（新增） | `features/play/character/PlayerCharacterSheet.tsx` | 框架 + 技能（含训练动作）+ 能力 + 装备 + 关系 |
| 同伴卡（新增） | `features/play/character/CompanionCharacterSheet.tsx` | 框架 + 指令（可就地调整）+ 技能（只读）+ 能力 + 装备 |
| 投影补充 | `src/application/campaign/playProjection.ts` | 新增 `actorNames`（玩家 + 当前可见角色显示名），关系行不再需要打印 actorId |
| 页面接线 | `screens/PlayScreen.tsx` | 面板按角色类型渲染玩家 / 同伴卡；**移除主页面上的技能训练入口**（迁移进玩家卡，方案 §25.2） |

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 练习点必须按真实阈值显示（5/10/20/40），master 无阈值 | 直接从核心投影取 `threshold`（null = 终阶），UI 不做任何换算 |
| 2 | 四预备槽要能显示空槽 | 以 `preparedAbilitySlots`（规则域常量）补空槽，空槽用虚线 + 降透明度 + 「空槽」文字 |
| 3 | 装备需要显示来源 | 来源标签映射 `starting_loadout/recruitment/quest_reward/encounter_loot/transfer`，未记录时明示「来源未记录」 |
| 4 | 关系行不能显示 `actor-npc-1` 这类 id | 已新增投影 `actorNames`；仍未知时回退显示 id（Debug 场景），正常路径为显示名 |
| 5 | 主页面仍残留训练按钮，与方案 §25.2 冲突 | **已修复**：主页面训练入口删除，训练只在玩家卡技能区 |
| 6 | 同伴指令不应只出现在主页面队伍面板 | 已加入同伴卡；主页面队伍面板将随 P4.9 迁入队伍面板，避免两处重复 |
| 7 | 角色卡信息不得泄漏 GM 数据 | 玩家/同伴卡只渲染 `ActorUiProjection`（来源即 party 投影），不含 GM 字段 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| 玩家卡 / 同伴卡四主题截图 | **未截图** |
| `practicePoints` 与 `PRACTICE_THRESHOLDS` 实际显示一致 | **未验证** |
| 能力冷却状态与实际一致 | **未验证** |
| 技能训练在角色卡内执行（真机） | **未验证** |

---

## P4.7 NPC / 生物公开角色卡

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 公开角色卡（新增） | `features/play/character/NpcCharacterSheet.tsx` | 仅使用 `getNpcPublicProjection()`：身份（名 / NPC·生物 / 战斗方）、已知印象、关系 · 战斗倾向（立场 + 亲密条 + 士气 + 撤退阈值 + 可观察状态）、已观察技能（`已观察` / `？？？ 未探明`）、属性·能力·装备（统一「未 探 明」占位块） |
| 入口接线 | `screens/PlayScreen.tsx` | 遭遇面板中的角色可点按其角色卡：队伍成员 → 玩家/同伴卡，敌对/中立 → NPC 公开卡（P4.8 会由 CombatantCard 复用同一入口） |

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 方案 §22.3 禁止显示完整 GM 属性 / 隐藏技能 / 私密未来信息 | 已核对：渲染面只接受 `NpcPublicProjection`（核心策略层已剥离这些字段，并有单测断言 JSON 中不含模板 id 与隐藏技能 id） |
| 2 | 未探明区域不能简单隐藏，要显示「未探明」 | 已实现：隐藏技能以「？？？」行 + 数量提示呈现（最多画 3 行），属性/能力/装备块显示「未 探 明」 |
| 3 | 技能等阶（rank）属 GM 数据 | 未展示：已观察技能只显示名称与「已观察」标签，不显示骰面或等阶 |
| 4 | 战斗方（敌对/中立）来自遭遇视图，属玩家可见事实 | 由页面把 `side` 传入卡片；不在投影里推断 |
| 5 | 卡片需要按需加载，避免把 NPC 数据挂在主页面 | 已实现：卡片在自己打开时异步读取投影，关闭即卸载 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| NPC 卡四主题截图 | **未截图** |
| 真机确认 GM-only 字段不出现在界面上 | **未验证** |
| 「未探明」占位随侦察解锁 | **未验证**（依赖未来目击记录口径） |

---

## P4.8 Encounter HUD

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| HUD 容器（新增） | `features/play/encounter/EncounterHud.tsx` | 轮次头部（当前行动者、是否玩家）+ 顺序条 + 距离带 + 场上角色卡 + 本轮动作；结束态显示结果与最后动作。同文件导出 `EncounterStarter`（从世界包模板发起遭遇的显式入口） |
| 行动顺序（新增） | `features/play/encounter/InitiativeStrip.tsx` | 读取 `initiative` / `currentActorId` / `round`，不自行排序；当前行动者 ▶，已行动 ✓，阵亡降透明度 |
| 距离带（新增） | `features/play/encounter/ZoneTrack.tsx` | 读取 `zones` / `actor.zoneId` / `exits`；显示每区占用者与「可达」标记，不做地图引擎 |
| 角色卡（新增） | `features/play/encounter/CombatantCard.tsx` | 名 / 阵营（队·敌·中）/ 气血条与数值 / 位置 / 已行动·已移动·失能标记；点按打开对应角色卡 |
| 战斗动作（新增） | `features/play/encounter/CombatActions.tsx` | 攻击 / 援救 / 戒备 / 疾行 / 标准移动 / 下一轮加入 / 撤退 / 推进自动角色行动；全部走既有 Session 方法 |
| 页面替换 | `screens/PlayScreen.tsx` | 旧的文字+按钮遭遇面板整体删除；HUD 与旧队伍卡放入**高度受控的滚动区**（≤50% 屏高），保证叙事流始终留有阅读空间 |

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 方案 §23.3 禁止把规则复制到 UI | 已核对：动作只调用 `encounterAttack/Rescue/PassTurn/Move/Dash/QueueJoin/Retreat/NpcTurn`，可用性判断沿用视图上的 `actedThisRound/movedThisRound/conditions/currentActorIsPlayer` |
| 2 | 旧实现把先攻顺序自己排序/拼接 | 改为直接使用遭遇视图的 `initiative` 顺序 |
| 3 | 高大 HUD 会挤掉叙事流（真机小屏风险） | **已修复**：顶部区域包在 `maxHeight = 屏高 × 50%` 的 ScrollView 中（`nestedScrollEnabled`），叙事流保持弹性空间 |
| 4 | 敌人角色卡必须走公开投影 | CombatantCard 只负责点按；打开哪一个卡片由页面按「是否在册（队伍）」分流到玩家/同伴卡或 `NpcCharacterSheet` |
| 5 | 遭遇结果状态语义 | 直接映射 `resolved / escaped / defeated / active`，不发明新状态 |
| 6 | 遭遇模板入口 | 保留为独立标注的「遭遇（测试入口）」，与战斗动作分开，避免误认为正式战术入口 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| HUD 四主题截图 | **未截图** |
| encounter / attack / rescue / move / dash / NPC turn / retreat 的真机回归 | **未验证** |
| 小屏设备上叙事流仍可阅读 | **未验证** |

---

## P4.9 游戏信息面板

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 面板宿主（新增） | `features/play/panels/GameInfoPanel.tsx` | 一个 Bottom Sheet + 五个 Tab（角色 / 队伍 / 任务 / 物品 / 知识）；角色 Tab 内联渲染角色卡，避免嵌套 Modal |
| 队伍（新增） | `features/play/panels/PartyPanel.tsx` | 主队（指令 / 分队 / 退出队伍）、分队（重入主队）、知识分享、招募与重新招募（含不可用原因） |
| 任务（新增） | `features/play/panels/QuestPanel.tsx` | 五态分组（进行中 / 可接取 / 已完成 / 已失败 / 已放弃）+ 真实 counters |
| 物品（新增） | `features/play/panels/InventoryPanel.tsx` | 名称 / 持有者 / 来源 + 转交动作 |
| 知识（新增） | `features/play/panels/KnowledgePanel.tsx` | 已知条目 + `knownVia`（亲眼所见 / 他人告知 / 自行推断，含图形徽记） |
| 顶栏入口 | `features/play/PlayHeader.tsx` | 新增 `☰ 信息` 入口（≥44dp 触达） |
| 页面清理 | `screens/PlayScreen.tsx` | **删除主页面上的队伍/招募/知识分享/物品转交面板**（全部迁入信息面板）；页面缩短到约 190 行 |

命名说明：方案 §4 的目标结构在 `panels/` 下同时列了 `PlayPanel.tsx` 与四个数据面板，而 §20.2 又明确允许 Sheet 载体叫 `PlayPanel`；实现上保留 `PlayPanel` = 载体，Tab 宿主命名为 `GameInfoPanel`，避免同名冲突。

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 复杂操作不得占据主叙事区（方案 §24.2） | 已全部迁入信息面板；主页面只剩叙事流、队伍条、HUD、输入栏 |
| 2 | 嵌套 Modal 在 Android 上易出现层级/返回键问题 | 角色 Tab 内联渲染角色卡（不叠加 Modal）；仅保留两个独立 Sheet（角色卡 / NPC 卡）与一个信息面板 |
| 3 | 招募资格不能由 UI 判断 | 资格与原因字符串直接来自 `getRecruitmentOptions()` / `getRejoinOptions()`，UI 只做置灰 |
| 4 | 知识来源不能只靠颜色 | `knownVia` 三种来源各带图形徽记（👁 / ☞ / ⟳）与中文标签 |
| 5 | 物品转交的两个入口（§24.2 与 §24.4） | 归口到物品面板一处，避免同一动作在两处出现不同实现 |
| 6 | 任务分组顺序 | 按 进行中 → 可接取 → 已完成 → 已失败 → 已放弃 固定顺序，不按字典序 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| 五个面板四主题截图 | **未截图** |
| 队伍指令 / 分队 / 重入 / 招募 / 知识分享 / 物品转交真机回归 | **未验证** |
| 任务与知识面板内容与游戏内记录一致 | **未验证** |