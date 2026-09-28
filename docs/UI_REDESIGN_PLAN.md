# ShineWord UI/UX 重构设计方案

> 状态：已确认方向（2026-09-28）· 尚未动代码
> 三项已确认决策：① 四套主题皮肤用户可选；② 允许引入依赖但严控包体积；③ 游玩页输入框常驻、选项作为快捷建议。

## 1. 现状问题

| 维度 | 现状（mobile/App.tsx，1915 行单文件） | 问题 |
|---|---|---|
| 结构 | 6 个屏幕 + 1 个共享 StyleSheet 塞在一个文件，`useState<Screen>` 手动切页 | 无导航栈、无返回手势，页面与业务逻辑纠缠 |
| 信息架构 | 图书馆页平铺世界导入/战役/存档/世界包/预览 | 功能不分区，所有操作同一层级 |
| 视觉 | 单一深蓝 + 金色，纯文字按钮，无图标、无空状态、无加载骨架 | 只有一层卡片，无视觉层级 |
| 规范 | 颜色 hex 硬编码，字号 11~28 混用，间距无节奏 | 无 design token，无法换肤 |
| 交互 | 触控区小、无按压反馈、无 SafeArea | 接近调试面板 |

有利条件：`mobile/src/*.ts`（database/runtime/worldImport 等）已与 UI 完全分离，UI 集中在 App.tsx，重构 UI 几乎零业务风险。

## 2. 目标信息架构

**顶层 = 底部 3 Tab；游玩/开局 = 全屏沉浸流程（无 Tab）**

```
ShineWord
├── 顶层（底部 Tab）
│   ├── 书库      世界卡片 · 导入 TXT/世界包 · 世界详情
│   │   └── 世界详情（子页签：资料 / 三本书 / 审查 / 世界包管理）
│   ├── 战役      进行中战役 · 分支 fork/rewind · 存档导入导出
│   └── 我的      模型端点 · 密钥 · 主题皮肤 · 关于
└── 沉浸流程（全屏）
    ├── 开局向导  选角色 → 配属性 → 确认（分步，每步一个决定）
    └── 游玩页    叙事流 + 常驻输入区 + 快捷建议 + 侧边抽屉
```

- 原 BooksScreen（三本书）与 ReviewScreen 并入「世界详情」子页签，不再是平级孤岛页。
- 原 LibraryScreen 拆为「书库」（世界管理）与「战役」（游玩管理）两个意图明确的 Tab。

## 3. 主题皮肤系统（核心）

### 3.1 机制

- **一套组件树 + 四套 Token**：主题 = 一组 design token（颜色/圆角/描边/字族/装饰件），经 `ThemeContext` 注入；组件只引用 token 名，不写死 hex。
- **双层设置**：App 级默认主题（我的 → 主题皮肤）+ 每个世界可指定主题（导入时按题材自动推荐，可改）。进入某世界的战役时自动套用该世界主题。
- **零图片资源**：皮肤差异全部用颜色/形状/排版/SVG 图案实现，不打包任何位图，四主题对包体积贡献 ≈ 0。

### 3.2 四套主题 Token

#### ① 中国古典风「墨」（默认深色：夜读卷轴）

| Token | 值 | 说明 |
|---|---|---|
| bg/base · raised · overlay | `#12100C` · `#1D1913` · `#2A241B` | 玄色底，暖调 |
| text/primary · secondary | `#EFE6D0` · `#A99E86` | 宣纸色字 |
| accent/primary | `#C8442F` 朱砂 | 主按钮、判定强调 |
| accent/secondary | `#C9A063` 泥金 | 标题、分隔 |
| 字族 | 标题/叙事 serif，UI sans | 系统字体回退，不打包字体 |
| 装饰 | 云纹如意角花（SVG 双线卷草 + 朱砂圆点）、回纹式竖线分隔、印章角标、菱形朱砂章节分隔饰、竹简式竖线底纹（repeating 细线）、章节用「卷一·」式编号 | |
| 圆角/描边 | 圆角 4（方中带圆），1px 细线 `#3A3226` | |

#### ② 欧洲奇幻风「烛」（现版升级）

| Token | 值 | 说明 |
|---|---|---|
| bg/base · raised · overlay | `#0A0E1A` · `#101828` · `#1A2438` | 午夜蓝 |
| text/primary · secondary | `#F1F5F9` · `#A8B8C6` | 现 `#8ea1b2` 提亮至 ≥4.5:1 |
| accent/primary | `#D9A441` 烛金（沿用） | 每屏仅一个主行动色 |
| accent/secondary | `#91B6D7` 钢蓝 | 骰点、链接 |
| 字族 | 标题/叙事 serif，UI sans | |
| 装饰 | 卷草藤蔓角花（SVG 蔓线 + 叶瓣 + 金珠）、卡片双线框（外描边 + 内细线错位 1px）、─ ❖ ─ 章节饰线、卡牌式骰点卡、标题加宽字距 | |
| 圆角/描边 | 圆角 8/12，1px `#263A4D` | |

#### ③ 日本漫画风「漫」（Neubrutalism 变体）

| Token | 值 | 说明 |
|---|---|---|
| bg/base · raised | `#16161E` · `#FFFFFF` 白卡 | 深色底 + 白色漫画格卡片 |
| text/on-card | `#111111` | 白卡上纯黑字 |
| accent/primary | `#FF4757` | 高饱和红 |
| accent/secondary | `#3B82F6` / `#FACC15` | 拟声词标签 |
| 描边 | 卡片 3px 纯黑 + 硬投影（右下 4px 实色偏移，无渐变） | 漫画格 |
| 装饰 | 网点纸纹理（SVG Pattern 圆点）、集中线角标、对白气泡式叙事卡（带尾巴）、星形爆炸拟声词徽章（成功!/大成功!，黑描边硬投影）、3px 粗黑描边 + 实色偏移投影 | |
| 字族 | 全部 sans 加粗 | |

#### ④ 未来科技风「梭」（Cyberpunk HUD）

| Token | 值 | 说明 |
|---|---|---|
| bg/base · raised · overlay | `#05070D` · `#0B101B` · `#111A2B` | 近黑 |
| text/primary · secondary | `#D7E6F5` · `#7D93AC` | |
| accent/primary | `#35E0FF` 青 | 主强调 |
| accent/secondary | `#FF3DF0` 品红 | 判定大成功/危险 |
| 描边 | 1px `rgba(53,224,255,0.25)`，卡片四角 HUD 切角框 | |
| 装饰 | HUD 刻度角框（切角 + 刻度线 + 品红定位点）、六边形网格底纹（SVG Pattern，低透明度）、可选扫描线（默认关）、数值用 mono、状态用进度条式 HUD、判定前缀符号 » / ✕ | |
| 字族 | UI sans，属性/骰点数值 mono | |

### 3.3 装饰组件库

四套主题的角花、分隔饰、纹理统一收进 `src/ui/theme/ornaments/`：每主题一组 SVG 路径（`<OrnamentCorner />`、`<ChapterDivider />`、`<BackgroundPattern />` 三个槽位），全部用 `react-native-svg` 绘制，矢量零位图，四主题合计路径数据约 12KB。组件只声明"槽位"，具体渲染哪套由当前主题决定——新增主题 = 新增一份 token + 一组 SVG 路径，不动任何组件。

### 3.4 字体策略（控体积关键）

**不打包任何中文字体**（单个 CJK 字体 5–20MB）。全部用系统字族回退：
Android `serif`（多数设备为 Noto Serif）/ 默认 sans / `monospace`。标题想要更强风格时，P5 阶段再评估是否仅打包拉丁字形子集（<200KB）。

## 4. 依赖引入与体积预算

| 依赖 | 用途 | 预估 APK 增量 |
|---|---|---|
| `@react-navigation/native` + `native-stack` + `bottom-tabs` | 真正的导航栈/Tab/返回手势 | +0.3 MB（纯 JS） |
| `react-native-screens` | 导航原生依赖 | +0.5 MB |
| `react-native-svg` | 图标与主题图案（网点/扫描线/HUD 角框） | +1.2 MB |
| `lucide-react-native` | 图标（按个 tree-shake，无字体文件） | ≈0（每图标 <1KB） |
| **合计** | | **≈ +2 MB** |

明确不引入：`react-native-vector-icons`（整包字体文件大）、`lottie`（动画库+JSON 资源）、`reanimated`（P4 前用内置 Animated API 足够，后续若要主题切换过渡动画再评估，+2~3MB）。

## 5. 游玩页布局规格（输入常驻 + 快捷建议）

```
┌─────────────────────────────┐
│ 紧凑顶栏：世界名 · 分支名    │  ← 左：返回战役  右：抽屉/设置
├─────────────────────────────┤
│ 叙事流（可滚动）             │
│  · 叙事卡（serif 正文）      │
│  · 骰点条（内联窄条：         │
│    技能 · 骰面 · 结果等级）   │
│  · 系统提示（获得知识/成长）  │
├─────────────────────────────┤
│ 快捷建议区（横滑 chips）     │  ← 本回合 Planner 选项，
│  [调查壁炉] [质问管家] […]   │     点击即填入输入框
├─────────────────────────────┤
│ 队伍条（横排小头像+血条）    │  ← party 成员 + 同伴指令徽标
├─────────────────────────────┤
│ 常驻输入栏                   │
│  [多行输入……………] [掷骰][发送]│  ← 永远可见，自由行动为主
└─────────────────────────────┘
  右侧抽屉（滑出）页签：角色卡 /
  队伍 / 任务 / 物品 / 知识图鉴 /
  关系 / 骰点记录 / 查世界书
```

## 5.5 角色卡系统（玩家 / 同伴 / NPC 共用）

**数据基础已齐备**（`domain/characters/card.ts` + `domain/state/types.ts`）：`ActorCard` 统一建模玩家、同伴、NPC、生物（kind: canon/original/companion/npc/creature），代码注释明确"UI 投影 public/party/gm 由同一模型派生"——角色卡 UI 就是实现这三个投影。

| 卡片区块 | 数据来源 | 展示形式 |
|---|---|---|
| 头部徽记 | kind + powerTier（ordinary/enhanced/supernatural） | 圆形徽记（五种 kind 各一图标），等阶三步轨 |
| 姓名/徽标 | name、kind、originId/pathId（出身/道途）、defense | 徽标 chips + 出身·道途副标题 |
| 属性 | attributes（六维，1–3） | 六条 3 格 pip 轨 |
| 技能 | skills（SkillRank 五档 ↔ d4–d12）+ SkillSnapshotEntry.practicePoints + PRACTICE_THRESHOLDS(5/10/20/40) | 骰面徽章（d4–d12）+ 等阶名 + 练习点 pip 进度（参考图的点阵轨） |
| 资源 | ActorState.resources（hp/stamina 当前值）+ resourceMax | 血条/体力条；conditions → 状态图标 chips；lifeStatus 危急态 |
| 能力 | preparedAbilities（4 槽）+ abilityCooldowns | 四格槽位 + 冷却角标 |
| 装备 | itemOwners + ItemDefinition + itemSources | 装备槽 + 持有物列表 |
| 关系 | RelationshipSnapshotEntry（stance + closeness 数值） | 关系条（ stance 标签 + closeness 进度） |

**三种投影**：玩家卡全量展示；同伴卡全量 + 指令徽标（companionDirective 五态）；NPC/生物卡只展示"公开投影"——已观察技能、关系、战斗倾向（morale）、已知印象（description），未探明区块显示「未探明」占位，鼓励玩家侦察——这把规则层的可见性设计变成了玩法。

## 5.6 其他可继续丰富的 UI 交互（按数据就绪度排序）

| 模块 | 已有数据（未充分可视化） | UI 机会 |
|---|---|---|
| 遭遇战 HUD | initiative 先攻顺序、距离带 zones、掩体 coverSpotIds、conditions、撤退阈值 | 先攻顺序条 + 距离带示意条 + 状态图标；替换现在的纯文字按钮堆 |
| 骰点条 | RollRecord（骰面 d4–d12、颗数、取高、四档结果） | 真实骰面图形（多面骰 SVG）+ 四档结果色（大成功金/成功/失败/大失败红） |
| 任务日志 | questProgress（五态 + counters 计数器） | 任务卡列表 + 进度计数（如 收集 2/5） |
| 知识图鉴 | discoveries（knownVia: witnessed/told/inferred 三来源） | 图鉴解锁流，按来源分色徽标 |
| 关系网 | relationships 全量二元数据 | 队伍关系网图（节点+亲密度连线） |
| 世界时钟 | clockSeconds 权威时钟 | 顶栏/抽屉显示世界内日期时辰（古典风可显"戌时三刻"式文案） |
| 记忆回顾 | summarizer/retrieval 产出 | 抽屉「前情提要」页签 |
| 开局向导 | 属性 1–3 + 4 自由点、3 初始技能、4 能力槽 | 点数预算可视化（剩余点数实时扣减）、技能池按属性分组选择 |

- 选项不抢占叙事空间：以横滑 chips 呈现，点击填入输入框（可再编辑），而非一键直发。
- 骰点结果以内联窄条嵌入叙事流，保证「先持久化 RollRecord 再叙事」的确定性语义在 UI 上可读。
- 抽屉承载所有面板类信息，阅读心流不被打断。

## 6. 分阶段路线

| 阶段 | 内容 | 风险 |
|---|---|---|
| P1 地基 | `src/ui/theme/`（4 套 token + ThemeContext）+ `src/ui/components/`（Button/Card/Header/Chip/EmptyState） | 纯新增，零风险 |
| P2 导航 | 引入 react-navigation，Screen union → 路由；底部 3 Tab | 低，逐屏迁移 |
| P3 拆屏 | App.tsx → `screens/{library,campaigns,settings,world-detail,opening,play}/` | 低 |
| P4 游玩页 | 叙事流 + 常驻输入 + 快捷建议 chips + 抽屉 | 中，体验收益最大 |
| P5 打磨 | 按压反馈、骨架屏、空状态、主题切换过渡、扫描线/网点精修 | 低 |

每阶段完成后 `cd mobile && npx tsc --noEmit` + 真机目检，不动 `mobile/src/*.ts` 桥接层与 `src/` 规则域。

## 7. 验收清单（Definition of Done）

- [ ] 四套主题可在「我的」切换，且每个世界可单独指定
- [ ] 全部颜色/圆角/字族来自 token，组件无硬编码 hex
- [ ] 正文对比度 ≥ 4.5:1（重点复查古典风泥金、科技风青）
- [ ] 触控目标 ≥ 44×44dp，所有 Pressable 有按压反馈
- [ ] APK 增量 ≤ +3MB（对比当前 debug 基线）
- [ ] 游玩页输入框常驻，选项以横滑 chips 呈现
- [ ] 角色卡三投影（玩家/同伴/NPC）上线，所有区块数据均可溯源到 ActorCard/ActorState 快照字段
- [ ] 技能练习点 pip 进度与 PRACTICE_THRESHOLDS(5/10/20/40) 一致
