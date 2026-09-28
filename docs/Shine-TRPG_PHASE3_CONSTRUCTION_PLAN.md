# Shine-TRPG 第三期建设方案（P3 + P4）

> 文档状态：第三期正式建设基线  
> 制定日期：2026-09-28  
> 代码基线：`main` @ `c6c6c7a1f003275e8d8e713aa41fd2c543ec2f51`  
> 仓库：`anjingdtl/ShineWord`  
> 产品统一品牌：**Shine-TRPG**  
> 第三期范围：**P3 页面精修 / 品牌统一 / UI 架构收口 + P4 核心游玩页 / 角色卡 / HUD 重构**  
> 前置成果：P1 主题系统、P2 React Navigation 导航骨架已完成并合入 `main`

---

## 0. 文档目的

本方案是 Shine-TRPG 第三期的**唯一施工总控文档**，用于后续本地 Agent / Codex / 人工协同开发。

第三期不再重复 P1/P2 已完成的主题地基和路由级拆屏，而是在当前代码基础上完成两个目标：

1. **P3：把 P2 的“可运行搬迁态”升级成正式产品 UI**
   - 统一品牌为 **Shine-TRPG**；
   - 非游玩页全面组件化、Token 化；
   - 清退 `legacyStyles.ts` 在非 Play 页的使用；
   - 把开局页改造成真正的新游戏分步向导；
   - 形成一致、可维护、可换肤的 UI 架构。

2. **P4：把 PlayScreen 从“功能调试面板”升级为真正的互动小说 TRPG 游玩界面**
   - 叙事流；
   - 骰点与结果呈现；
   - 常驻行动输入；
   - 本地情境快捷行动；
   - 队伍 HUD；
   - 玩家 / 同伴 / NPC 角色卡；
   - 遭遇战 HUD；
   - 任务 / 物品 / 知识面板；
   - 保持规则域、确定性骰点和存档语义不变。

每一个子阶段完成后必须执行：

**实现 → Review → Fix → 回归 → Commit → 再进入下一子阶段。**

禁止跨越 Review/Fix 门禁连续堆叠多个阶段。

---

# 1. 当前基线确认

## 1.1 已完成能力

当前 `main` 已完成：

- P1 四套主题：
  - 墨 `ink`
  - 烛 `fantasy`
  - 漫 `manga`
  - 梭 `scifi`
- `ThemeContext`
- Token 化颜色、字号、间距、圆角、字体、效果
- 主题装饰组件
- 基础组件：
  - `Button`
  - `Card`
  - `Header`
  - `Chip`
  - `PipTrack`
  - `AttributePips`
  - `Bar`
  - `DieBadge`
  - `EmptyState`
  - `Surface`
  - `ScreenShell`
- React Navigation：
  - Bottom Tabs：
    - 书库
    - 战役
    - 我的
  - Native Stack：
    - WorldDetail
    - Opening
    - Play
    - ThemeGallery
- `mobile/App.tsx` 已从约 1950 行缩减为约 60 行；
- 页面已经迁移到 `mobile/src/ui/screens/`；
- `docs/reviews/ui/data-availability.md` 已完成角色卡字段可达性审查；
- 当前核心回归基线：152/152。

## 1.2 当前主要问题

P2 的目标是“搬迁并接通导航”，因此页面内部仍保留大量旧 UI：

- `legacyStyles.ts` 仍有大量硬编码颜色、字号、圆角；
- `TouchableOpacity + styles.secondary` 被大量直接使用；
- Library / Campaigns / WorldDetail / Opening / Play 仍偏工程调试界面；
- OpeningScreen 是一个过长的 ScrollView，不像“创建角色 / 开新游戏”流程；
- PlayScreen 同时承担数据、业务调用和几乎全部游戏 UI；
- 遭遇、队伍、训练、存档、休息、叙事、输入全堆在 Play 主屏；
- P4 原设计中的“Planner 快捷建议”在当前 Planner 协议中**并不存在数据来源**；
- 角色卡部分字段存在桥接层只读投影不足；
- 当前用户可见品牌仍为 `ShineWord`。

---

# 2. 第三期总体原则

## 2.1 不重写已经稳定的规则域

第三期原则上不修改：

```text
src/domain/**
src/application/** 的写路径
migrations/**
现有骰点规则
ActionContract 确定性流程
RollRecord 持久化语义
分支 / rewind 语义
存档完整性规则
世界包不可变版本语义
```

允许的例外：

- P4 为 UI 增加**只读 Projection / 查询接口**；
- 只允许“读取已有数据”，不得改变权威状态写入规则；
- 如确实需要修改 `src/application/**` 读路径，必须单独 Review，并证明：
  - 不改变写路径；
  - 不改变存档 schema；
  - 不改变既有 P2 行为；
  - 有新增回归测试。

## 2.2 Screen 与 Feature 分离

第三期不继续无意义地拆 Route 文件。

稳定保留：

```text
mobile/src/ui/screens/
├─ LibraryScreen.tsx
├─ CampaignsScreen.tsx
├─ ProfileScreen.tsx
├─ WorldDetailScreen.tsx
├─ OpeningScreen.tsx
└─ PlayScreen.tsx
```

新增：

```text
mobile/src/ui/features/
├─ library/
├─ campaigns/
├─ profile/
├─ world-detail/
├─ opening/
└─ play/
```

原则：

- `Screen`：导航、数据装配、页面编排；
- `Feature Component`：可视化与局部交互；
- `runtime.ts`：mobile 与应用层之间的只读/写入桥接；
- `domain/application`：规则权威层。

## 2.3 禁止新增大型 UI 框架

继续沿用当前依赖策略。

第三期默认**不新增**：

- React Native Paper
- NativeBase
- Tamagui
- Lottie
- react-native-vector-icons 字体包
- Reanimated
- 第三方 Bottom Sheet 大型依赖

动画优先使用：

- React Native `Animated`
- `LayoutAnimation`
- `Modal`

如必须新增依赖，需单独说明：

1. 解决什么现有能力无法解决的问题；
2. APK 增量；
3. Android minSdk 兼容；
4. Fabric/Hermes 影响。

---

# 3. 品牌统一：Shine-TRPG

## 3.1 品牌命名冻结

自第三期开始，软件对用户统一使用：

# **Shine-TRPG**

中文产品描述建议统一为：

> **AI 驱动的互动小说 TRPG**

或短描述：

> **小说世界里的单人 TRPG**

不得再在新增用户界面中出现 `ShineWord` 作为产品品牌。

## 3.2 品牌层与世界主题层分离

Shine-TRPG 有四套世界主题，但**品牌本身只能有一套身份**。

因此必须建立两层：

### 品牌层 Brand Layer

固定：

- 产品名；
- Logo 几何；
- App Icon；
- 启动页；
- About；
- 首次启动身份；
- 品牌字距与 Logo 安全区；
- 产品级文案。

### Theme Layer

可变：

- 墨；
- 烛；
- 漫；
- 梭；
- 世界卡片风格；
- 游玩页装饰；
- 角色卡装饰；
- 背景纹理；
- 强调色。

原则：

> **皮肤可以变化，产品身份不能变化。**

同一个 Shine-TRPG Logo 可根据皮肤做单色适配，但不能每个主题设计一套完全不同 Logo。

## 3.3 品牌视觉核心

品牌视觉关键词：

- 故事
- 选择
- 骰子
- 世界
- 光 / Shine
- TRPG

建议 Logo 方向：

> **“S”路径 + D20 多面骰轮廓 + 翻开的书页 / 分叉故事路径**

Logo 不要求复杂插画，应适合：

- 48dp App 图标；
- 24dp 小标；
- 启动页；
- 顶部品牌标；
- GitHub README。

### 品牌固定色

品牌图标自身采用少量固定色，页面仍由 Theme Token 控制。

建议 Brand Token：

```ts
brand.dark   = #0B0D12
brand.light  = #F4EFE5
brand.shine  = #D9A441
brand.arc    = #35E0FF
```

注意：

- 这些是**品牌资产色**；
- 不替代四套主题 Token；
- 普通组件不得直接使用 Brand Token；
- Logo 可在不同主题下使用单色 / 双色综合版本。

## 3.4 品牌组件

新增：

```text
mobile/src/ui/brand/
├─ brand.ts
├─ BrandMark.tsx
├─ BrandWordmark.tsx
├─ BrandLockup.tsx
└─ index.ts
```

建议常量：

```ts
export const PRODUCT_NAME = 'Shine-TRPG';
export const PRODUCT_TAGLINE = 'AI 驱动的互动小说 TRPG';
```

JS/TS 用户界面不再散落硬编码产品名。

## 3.5 本期必须修改的用户可见品牌

| 位置 | 当前 | 第三期 |
|---|---|---|
| Android 桌面 App 名 | ShineWord | Shine-TRPG |
| Bootstrap 初始化文案 | ShineWord | Shine-TRPG |
| First Run | ShineWord | Shine-TRPG |
| 关于页面 | ShineWord | Shine-TRPG |
| README 标题 | ShineWord | Shine-TRPG |
| README 产品描述 | ShineWord | Shine-TRPG |
| 启动页 | 无统一品牌 | Shine-TRPG |
| Launcher Icon | 未形成正式品牌资源 | 新增正式 Icon |
| 默认导出文件前缀 | `shineword-*` | 新导出文件改 `shine-trpg-*` |
| UI 新增文案 | 可能沿用 ShineWord | 必须统一 Shine-TRPG |

## 3.6 本期暂不修改的兼容性内部标识

以下名称即使包含 `shineword`，第三期**不强制改名**：

```text
GitHub repository: anjingdtl/ShineWord
Android applicationId: com.shineword.app
Android namespace: com.shineword.app
SQLite database: shineword.db
NativeModules.ShineWordFiles
既有 AsyncStorage key: shineword.*
既有 SAVE_SCHEMA_VERSION: shineword-save-*
既有存档兼容扩展名: .shineword-save.json
既有世界包兼容扩展名: .shineword-world.zip
既有签名环境变量
```

原因：

- applicationId 变化会被 Android 识别成新应用；
- SQLite 名称变化需要迁移；
- Native Module 名称变化无用户收益；
- Save Schema 改名会增加兼容复杂度；
- 已存在的旧存档 / 世界包必须继续导入。

### 新导出文件命名规则

可以把**文件名前缀**改为：

```text
shine-trpg-<campaign>-<branch>.shineword-save.json
shine-trpg-<world>-r<revision>.shineword-world.zip
```

即：

- 品牌前缀采用 Shine-TRPG；
- 兼容扩展名继续保留 `.shineword-*`；
- 导入逻辑继续兼容历史文件。

内部技术标识的彻底迁移应放到未来独立 Migration Phase，不和 UI 第三期混做。

---

# 4. 第三期目标目录结构

```text
mobile/src/ui/
├─ brand/
│  ├─ brand.ts
│  ├─ BrandMark.tsx
│  ├─ BrandWordmark.tsx
│  └─ BrandLockup.tsx
├─ components/
│  ├─ Button.tsx
│  ├─ Card.tsx
│  ├─ Header.tsx
│  ├─ Chip.tsx
│  ├─ PipTrack.tsx
│  ├─ AttributePips.tsx
│  ├─ Bar.tsx
│  ├─ DieBadge.tsx
│  ├─ EmptyState.tsx
│  ├─ Surface.tsx
│  ├─ ScreenShell.tsx
│  ├─ TextField.tsx
│  ├─ SegmentedControl.tsx
│  ├─ StatusBanner.tsx
│  ├─ SectionHeader.tsx
│  └─ ProgressSteps.tsx
├─ features/
│  ├─ library/
│  ├─ campaigns/
│  ├─ profile/
│  ├─ world-detail/
│  ├─ opening/
│  └─ play/
├─ navigation/
├─ screens/
└─ theme/
```

---

# 5. P3：页面精修、品牌统一与 UI 架构收口

---

## P3.0 基线冻结

### 任务

1. 从当前 `main` 建第三期工作分支：

```bash
git checkout main
git pull --ff-only
git checkout -b feature/phase3-ui-gameplay
```

2. 记录：
   - HEAD；
   - `git status`；
   - 当前 APK version；
   - 当前 debug / release 包大小；
   - 当前 P2 截图。

3. 执行：

```bash
npm run verify:core
npm run typecheck --prefix mobile
npm run apk:debug --prefix mobile
```

4. 记录基准到：

```text
docs/reviews/phase3/P3_BASELINE.md
```

### 出口

- 核心测试不得低于当前 152/152；
- mobile TypeScript clean；
- Android debug 可构建；
- 无未提交杂项；
- 保存当前关键页面截图。

### Commit

```text
docs(phase3): freeze phase-3 baseline
```

---

# 6. P3.1 品牌地基 + 缺失基础组件

## 6.1 品牌实现

新增：

```text
mobile/src/ui/brand/**
```

完成：

- `PRODUCT_NAME = 'Shine-TRPG'`
- BrandMark
- BrandWordmark
- BrandLockup

修改：

```text
mobile/android/app/src/main/res/values/strings.xml
```

把：

```xml
<string name="app_name">ShineWord</string>
```

修改为：

```xml
<string name="app_name">Shine-TRPG</string>
```

## 6.2 App Icon

新增 Android 正式图标资源。

要求：

- 矢量优先；
- 至少支持普通 launcher icon；
- Android 8+ Adaptive Icon；
- Android 12 Splash 兼容；
- 不打包大型位图资源；
- 48dp 仍可辨识。

推荐路径：

```text
mobile/android/app/src/main/res/
├─ drawable/
├─ mipmap-anydpi-v26/
└─ values-v31/
```

## 6.3 启动页

BootstrapScreen：

当前：

> 正在初始化 ShineWord…

改为品牌启动态：

```text
[BrandMark]

Shine-TRPG
AI 驱动的互动小说 TRPG

正在载入世界…
```

禁止做耗时假进度条。

## 6.4 基础组件补齐

### TextField

必须统一：

- normal；
- focus；
- disabled；
- error；
- secure；
- multiline；
- placeholder；
- 主题适配。

### SegmentedControl

用于：

- 世界详情 Tab；
- 角色类型；
- 三宝书 Tab；
- 面板 Tab。

### StatusBanner

四态：

- info
- success
- warning
- error

### SectionHeader

统一页面章节标题。

### ProgressSteps

用于 Opening 分步向导：

```text
1 起点 → 2 角色 → 3 同伴 → 4 确认
```

## 6.5 ThemeGallery

ThemeGallery 继续作为开发工具：

- Debug：保留；
- Release：默认不可见；
- 不得作为正式产品功能入口。

### P3.1 出口

- Android 桌面名称显示 Shine-TRPG；
- 启动页出现统一品牌；
- About 不再新增旧名称；
- 新基础组件四主题通过；
- 无 CJK 字体；
- typecheck PASS；
- debug build PASS。

### Commit

```text
feat(brand): establish Shine-TRPG identity and phase-3 UI primitives
```

---

# 7. P3.2 书库 Library 产品化

## 7.1 当前问题

当前 Library：

- 功能完整；
- 信息层级弱；
- 构建过程只是旧 Card + Text；
- 世界卡片仍像测试列表；
- 直接依赖 `legacyStyles.ts`。

## 7.2 目标结构

```text
书库
把小说变成可以进入的世界
                         [导入世界包]

┌─────────────────────────────┐
│ ＋ 导入小说 TXT              │
│ 构建人物、事件、规则与三宝书 │
└─────────────────────────────┘

构建任务
┌─────────────────────────────┐
│ 抽取与映射                  │
│ 正在处理：……                │
└─────────────────────────────┘

我的世界

┌─────────────────────────────┐
│ 白篱梦                       │
│ 已发布 · r1                  │
│ 世界已经可以开始冒险         │
│ [世界详情]   [开始冒险]      │
└─────────────────────────────┘
```

## 7.3 组件拆分

```text
features/library/
├─ ImportNovelCard.tsx
├─ BuildStatusCard.tsx
├─ WorldCard.tsx
└─ WorldList.tsx
```

## 7.4 原则

不得假造：

- 章节数；
- 进度百分比；
- 世界质量评分；
- AI 完成时间。

BuildStatus 只能展示真实存在的：

- phase；
- message；
- buildStatus；
- revision；
- review issue 数。

## 7.5 出口

- Library 不再 import `legacyStyles`;
- 不再直接使用旧 `styles.secondary/card/...`;
- 世界卡信息层级清晰；
- 空态一致；
- 四主题截图通过。

### Commit

```text
feat(ui): polish Shine-TRPG library experience
```

---

# 8. P3.3 战役 Campaigns 产品化

## 8.1 目标

战役页从：

> title + branchId + status

升级为：

- 战役卡；
- 分支关系视觉；
- 明确“继续冒险”入口；
- 存档导入入口；
- 保持现有 branch 行为不变。

## 8.2 建议结构

```text
我的战役

白篱梦 · 何世恒
进行中

主线
└─ main

分支
├─ b01
└─ b02

[继续冒险]
```

## 8.3 组件

```text
features/campaigns/
├─ CampaignCard.tsx
├─ BranchBadge.tsx
├─ BranchList.tsx
└─ ImportSaveAction.tsx
```

不为了丰富卡片新增数据库字段。

### 出口

- Campaigns 不使用 `legacyStyles`;
- 多 branch 可清楚区分；
- 空态 / 导入存档 / 错误态完整；
- 点击继续仍进入正确 branch。

### Commit

```text
feat(ui): refine campaign and branch presentation
```

---

# 9. P3.4 Profile / First Run / 品牌入口

## 9.1 Profile

完成：

- `legacyInput` 删除；
- 全部改用 `TextField`;
- 主题选择卡产品化；
- 模型与密钥区域与主题区域分层；
- About 使用 Shine-TRPG。

## 9.2 First Run

首次启动至少体现：

```text
[BrandMark]

Shine-TRPG
AI 驱动的互动小说 TRPG

配置你的 AI 模型
```

仍保持：

- API Key 只进 Keychain；
- 不显示 Key；
- 不改变 Profile 存储逻辑。

### 出口

- Profile / FirstRun 零旧品牌；
- 无 legacy input；
- 品牌一致；
- 保存端点行为不变。

### Commit

```text
feat(ui): unify onboarding and profile under Shine-TRPG brand
```

---

# 10. P3.5 世界详情 WorldDetail 产品化

世界详情继续保留四页：

```text
资料
三宝书
审查
世界包
```

不重新设计信息架构。

## 10.1 资料页

加入：

- 世界名称；
- package revision；
- ruleset version；
- 构建状态；
- 关联战役；
- 创建战役；
- 世界级主题覆盖设置。

### 世界主题

提供：

```text
跟随全局
墨
烛
漫
梭
```

复用 P1 已有：

```text
worldId -> themeId
```

存储能力。

## 10.2 三宝书

### 玩家视图

强调：

- 只显示玩家可见资料；
- Discoverable 内容按战役知识解锁。

### 编辑模式

必须做明显模式切换：

```text
⚠ 世界编辑模式
当前正在查看完整资料，其中可能包含主持人秘密。
```

编辑器本期仍可保留 JSON，不必扩大为 Schema Editor。

但需要：

- `TextField multiline`;
- 条目选择组件；
- visibility segmented control；
- 差异面板；
- 发布风险提示。

## 10.3 审查页

从“JSON 调试卡”升级为 Review Issue Card。

主视图显示：

- 严重级别；
- 问题标题；
- 可读摘要；
- 处理动作。

原始 detail JSON：

> 折叠“技术详情”查看。

## 10.4 世界包

保持轻量：

- 当前版本；
- hash 摘要；
- 导出；
- 说明“不含小说原文”。

### 出口

- WorldDetail、Books、Review 不再引用 `legacyStyles`;
- 四主题均正常；
- 玩家视图 / GM 编辑模式视觉上绝不混淆；
- 主题覆盖实际生效。

### Commit

```text
feat(ui): productize world detail and world-theme override
```

---

# 11. P3.6 Opening：真正的新游戏向导

这是 P3 的重点页面。

当前数据和业务能力已经足够，本期主要重做 UI 流程。

## 11.1 改为四步

```text
01 世界起点
02 我的角色
03 同伴
04 确认开局
```

## 11.2 Step 1 世界起点

展示：

- 原著事件锚点；
- 事件摘要；
- 可选地点。

使用卡片式单选，不再使用 `☑ / ☐` 纯文本模拟。

## 11.3 Step 2 我的角色

入口：

```text
原创角色 | 原著角色
```

### 原创角色

显示：

- 姓名；
- 自由点剩余；
- 六属性；
- 初始技能 0/3。

属性采用 `AttributePips`：

```text
体魄 ●●○
敏捷 ●○○
洞察 ●●○
```

技能显示：

- 中文名；
- 关联属性；
- 初始 d6；
- 是否允许无训练尝试。

### 原著角色

显示角色卡片：

- 名字；
- 可用信息；
- 不泄漏未来或 GM 数据。

## 11.4 Step 3 同伴

最多 2 名。

每个同伴：

- 名称；
- 描述；
- 选择状态；
- Directive：

```text
跟随
支援
保护
节省资源
撤退
```

## 11.5 Step 4 确认

Review：

```text
世界
起点
角色
属性摘要
技能
同伴
目标
世界包 Revision
规则版本
主题
```

最后按钮：

> **开始冒险**

## 11.6 导航行为

当前 `Opening -> replace('Play')` 会让返回落回 Tabs。

P3 必须明确修正为产品预期：

- 创建成功后进入 Play；
- 不允许 Back 回到已完成的 Opening；
- Play 返回应回到合理的战役/世界上下文。

推荐：

```text
Tabs -> WorldDetail -> Play
```

或：

```text
Tabs(Campaigns) -> Play
```

禁止出现：

```text
Opening 已创建战役 → Back 又回到创建向导
```

### 出口

- Opening 不使用 `legacyStyles`;
- 4 步流程可来回；
- 数据校验仍由原业务逻辑兜底；
- 不改变 `createCampaign` 规则；
- 真机完整创建一场战役通过。

### Commit

```text
feat(ui): rebuild opening flow as a four-step game wizard
```

---

# 12. P3.7 P3 收口

## 12.1 legacyStyles 门禁

P3 完成时：

```text
Library        0
Campaigns      0
Profile        0
WorldDetail    0
Books          0
Review         0
Opening        0
Play           允许暂留
```

`legacyStyles.ts` 只允许 PlayScreen 继续引用。

## 12.2 品牌扫描

必须扫描：

```text
ShineWord
shineword-
```

将结果分成：

### 必须消除

用户可见：

- App 文案；
- README 品牌；
- About；
- Launcher label；
- 新导出默认文件名前缀。

### 必须保留

兼容性内部名称：

- package；
- namespace；
- db；
- schema；
- storage key；
- native module；
- old extension。

## 12.3 P3 Review

产出：

```text
docs/reviews/phase3/P3_REVIEW.md
```

至少包含：

- 文件变更；
- 品牌迁移矩阵；
- 四主题截图；
- Opening 四步截图；
- TypeScript；
- core tests；
- APK；
- 包体积；
- 已知偏差。

## 12.4 P3 出口

P3 通过后才允许进入 P4。

### Commit

```text
review(phase3): close P3 product UI and Shine-TRPG branding
```

---

# 13. P4 强制开工前置

P4 开工前，执行 Agent **必须完整阅读**：

```text
docs/reviews/ui/data-availability.md
```

不得仅阅读摘要。

同时必须阅读：

```text
docs/UI_REDESIGN_PLAN.md
docs/ui-prototype/play-screen-themes.html
mobile/src/runtime.ts
mobile/src/ui/screens/PlayScreen.tsx
src/application/campaign/session.ts
src/domain/characters/card.ts
src/domain/state/types.ts
```

---

# 14. P4 数据层决策——第三期正式锁定

以下决策在本方案中冻结，执行 Agent 不再自行选择。

## 14.1 NPC / 生物公开投影：选择 B

采用：

```ts
getNpcPublicProjection(...)
```

原则：

- 新增专用只读查询；
- 不修改 `getSummary()` 既有降级行为；
- 不泄漏 GM-only 属性；
- 允许返回明确公开或已观察数据。

## 14.2 Play UI 使用聚合只读 Projection

不建议 UI 连续调用 5～8 个零散接口。

新增：

```ts
getPlayUiProjection(campaignId, branchId)
```

目标：

> 同一次刷新得到同一 `stateVersion` 的 UI 数据。

示意：

```ts
interface PlayUiProjection {
  campaignId: string;
  branchId: string;
  stateVersion: number;
  worldId: string;
  packageRevision: number;
  clockSeconds: number;

  player: ActorUiProjection | null;
  party: ActorUiProjection[];

  skills: ActorSkillProgressView[];
  relationships: RelationshipView[];
  discoveries: DiscoveryView[];
  quests: QuestProgressView[];
  inventory: InventoryView[];
}
```

注意：

- 这是 ViewModel；
- 不是权威状态；
- 不得用于直接写库；
- 所有写动作仍调用现有 Session 方法。

## 14.3 名称解析

桥接层提供统一展示解析：

```text
skillId -> name
abilityId -> name
itemId -> name
questId -> name
entryId -> title/name
```

UI 不得大量直接显示：

```text
skill-stealth
item-001
quest-main-03
```

只有 Debug 详情可以展示内部 ID。

## 14.4 clockSeconds

P4 UI Projection 提供：

```ts
clockSeconds
```

`clockMinutes` 可继续保留兼容。

不同主题允许不同格式：

- 墨：时辰风格；
- 烛：自然时间；
- 漫：简洁数字；
- 梭：HUD timecode。

权威值仍是 `clockSeconds`。

## 14.5 快捷行动不是 Planner 建议

原设计“Planner 快捷建议”正式改名：

# **情境快捷行动 Contextual Quick Actions**

理由：

当前 Planner 工作流是：

```text
玩家输入 intent
↓
Planner 编译 Proposal
↓
本地引擎冻结 Contract / Roll
↓
Narrator
```

当前不存在：

```text
Planner 先生成 3 个选项
```

第三期禁止为快捷行动新增第三次 LLM 调用。

快捷行动必须由本地状态推导，例如：

探索：

```text
观察四周
与同伴交谈
查看任务
移动
```

遭遇：

```text
攻击
移动
援救
戒备
撤退
```

点击快捷行动：

> **只填入输入框，不自动发送。**

用户永远可以自由输入。

---

# 15. P4 目标 Play 架构

当前 PlayScreen 是业务和 UI 的单体组件。

目标：

```text
features/play/
├─ hooks/
│  ├─ usePlayController.ts
│  ├─ usePlayProjection.ts
│  └─ useContextualActions.ts
├─ PlayHeader.tsx
├─ NarrativeFeed.tsx
├─ TurnCard.tsx
├─ RollStrip.tsx
├─ QuickActions.tsx
├─ PartyStrip.tsx
├─ ActionComposer.tsx
├─ GameMenu.tsx
├─ character/
│  ├─ CharacterSheet.tsx
│  ├─ PlayerCharacterSheet.tsx
│  ├─ CompanionCharacterSheet.tsx
│  └─ NpcCharacterSheet.tsx
├─ encounter/
│  ├─ EncounterHud.tsx
│  ├─ InitiativeStrip.tsx
│  ├─ ZoneTrack.tsx
│  ├─ CombatantCard.tsx
│  └─ CombatActions.tsx
└─ panels/
   ├─ PlayPanel.tsx
   ├─ PartyPanel.tsx
   ├─ QuestPanel.tsx
   ├─ InventoryPanel.tsx
   └─ KnowledgePanel.tsx
```

最终 `PlayScreen.tsx` 只负责：

- route 参数；
- Controller；
- 页面编排。

---

# 16. P4.1 只读 Projection 建设

## 16.1 新增

建议在：

```text
mobile/src/runtime.ts
```

或拆出：

```text
mobile/src/playProjection.ts
```

避免 `runtime.ts` 无限膨胀。

## 16.2 数据

### Player / Companion

提供：

- card；
- runtime state；
- hp/stamina；
- conditions；
- lifeStatus；
- skills；
- practicePoints；
- ability cooldown；
- inventory；
- relationship；
- directive。

### Quest

提供：

- status；
- counters；
- display name。

### Discoveries

提供：

- entryId；
- knownVia；
- knownAt；
- display name。

### NPC

单独公开 Projection：

```ts
interface NpcPublicProjection {
  actorId: string;
  name: string;
  kind: 'npc' | 'creature';
  description?: string;
  knownSkills: ...;
  morale?: ...;
  visibleConditions?: ...;
  relationship?: ...;
  unknownSections: ...;
}
```

必须经过 visibility 过滤。

## 16.3 测试

新增测试证明：

- 玩家全量；
- 主队同伴全量；
- 离队角色不泄漏；
- GM-only NPC 字段不泄漏；
- Public NPC 字段可见；
- stateVersion 一致。

### Commit

```text
feat(ui-data): add read-only play projections for P4
```

---

# 17. P4.2 Controller 与 UI 解耦

新增：

```text
usePlayController()
```

负责：

- load state；
- load history；
- submit；
- refresh；
- rest；
- rewind；
- export；
- train；
- party action；
- encounter action；
- error；
- notice；
- busy。

PlayScreen 不再直接包含几十个业务函数。

### 原则

Controller：

- 不画 UI；
- 不保存新的权威状态；
- 不重新实现 Session 逻辑。

### 出口

PlayScreen 代码显著缩减，并保持当前行为回归。

### Commit

```text
refactor(play): separate play controller from presentation
```

---

# 18. P4.3 叙事流 NarrativeFeed

目标是让 Shine-TRPG 的核心体验变成：

> 阅读故事 → 做决定 → 看结果。

## 18.1 Turn 视觉

当前：

```text
turn-0001 · success
2d8: [4,7]
文本
```

升级为结构化 TurnCard：

```text
检定
洞察 · d8 × 2
4 · 7
成功

剧情
火光映照下……
```

如果历史数据当前没有玩家 intent：

- 不伪造；
- 不为了显示 intent 修改旧存档；
- 可以未来版本新增。

## 18.2 RollStrip

使用：

- `DieBadge`
- grade semantic
- highest
- diceCount / dieSides

结果语义：

- critical success；
- success；
- failure；
- critical failure。

实际命名必须与规则域枚举一致。

## 18.3 滚动行为

- 新回合完成后滚到最新 Turn；
- 用户正在阅读旧内容时不得强制抢滚动；
- busy 不清空历史；
- resumed 状态可显示轻量恢复标记。

### Commit

```text
feat(play): rebuild narrative feed and roll presentation
```

---

# 19. P4.4 ActionComposer + 情境快捷行动

## 19.1 常驻输入栏

必须始终处于游玩页底部：

```text
[快捷行动横滑 chips]

你打算怎么做？
┌────────────────────┐
│                    │
└────────────────────┘
             [行动]
```

## 19.2 要求

- multiline；
- `adjustResize` 下不被键盘遮住；
- busy 时明确；
- submit 失败恢复原 intent；
- Enter 行为符合移动端；
- 字数合理；
- 发送按钮触控 ≥44dp。

## 19.3 Contextual Actions

本地推导。

示例：

普通状态：

```text
观察四周
查看人物
与同伴交谈
查看任务
```

战斗：

```text
攻击 <target>
移动
援救 <ally>
戒备
撤退
```

点击：

```text
setIntent(...)
```

绝不：

```text
autoSubmit()
```

### Commit

```text
feat(play): add persistent composer and contextual quick actions
```

---

# 20. P4.5 Party Strip + Character Sheet

## 20.1 Party Strip

叙事流和输入区之间：

```text
[我 ♥8 ◆5] [李毅 ♥6 ◆4] [阿德 ♥5 ◆6]
```

显示：

- 小型角色徽记；
- HP；
- stamina；
- critical / disabled 等状态；
- directive 可用轻量图标。

点击：

> 打开 Character Sheet。

## 20.2 展现载体

手机端采用：

# **Bottom Sheet / Modal Sheet**

内部组件名称可仍为：

```text
PlayPanel
```

实现使用：

- Modal；
- Animated；
- 不引入 Reanimated。

未来平板可以把同一内容变成右侧 Drawer。

---

# 21. P4.6 玩家与同伴角色卡

## 21.1 玩家卡

完整展示：

### 身份

- name；
- kind；
- origin/path；
- powerTier；
- defense。

### 属性

六维 1～3：

```text
体魄 ●●○
敏捷 ●○○
...
```

### 技能

显示：

```text
调查
熟练 · d8
练习 12 / 20
```

Pip 进度按真实：

```text
PRACTICE_THRESHOLDS = 5 / 10 / 20 / 40
```

### 资源

- hp；
- stamina；
- condition；
- life status。

### 能力

四 Prepared Slots：

- ability name；
- cooldown；
- empty slot。

### 装备

- 名称；
- 来源；
- 当前 owner。

### 关系

面向玩家的可见关系。

## 21.2 同伴卡

与玩家卡接近。

额外：

```text
当前指令：保护
```

允许从同伴卡调整：

- follow；
- support；
- protect；
- conserve；
- retreat。

不得把队伍全部管理动作堆回主 Play 页面。

### Commit

```text
feat(play): add player and companion character sheets
```

---

# 22. P4.7 NPC / 生物公开角色卡

严格使用 `getNpcPublicProjection()`。

## 22.1 示例

```text
黑风寨喽啰
敌对 · 普通

已知印象
动作粗鲁，持刀警戒。

战斗倾向
谨慎

技能
剑术       已观察
？？？       未探明

状态
轻伤

更多能力
未探明
```

## 22.2 未探明原则

不能简单隐藏整个区域。

要显示：

```text
未探明
```

让“知识可见性”成为玩家感知得到的玩法反馈。

## 22.3 绝不显示

除非明确公开：

- 完整 GM attributes；
- 完整 hidden skill；
- 私密未来信息；
- GM-only world entries。

### Commit

```text
feat(play): implement safe NPC public character projections
```

---

# 23. P4.8 Encounter HUD

当前 Encounter 是大量文字 + Button。

重做为：

```text
第 3 轮

行动顺序
[何世恒] → [山贼甲] → [李毅]

距离
近 ───── 中 ───── 远
我         山贼

敌人
山贼甲
HP ███░

当前行动
[攻击]
[移动]
[援救]
[戒备]
[撤退]
```

## 23.1 InitiativeStrip

读取：

- currentActorId；
- actors；
- round。

## 23.2 ZoneTrack

读取：

- zones；
- actor.zoneId；
- exits。

不需要地图引擎。

## 23.3 CombatActions

仍调用既有：

- `encounterAttack`
- `encounterRescue`
- `encounterPassTurn`
- `encounterMove`
- `encounterDash`
- `encounterQueueJoin`
- `encounterRetreat`
- `encounterNpcTurn`

规则不得复制到 UI。

### Commit

```text
feat(play): replace encounter debug panel with combat HUD
```

---

# 24. P4.9 游戏信息面板

P4 第一版只做五个核心面板：

```text
角色
队伍
任务
物品
知识
```

## 24.1 角色

玩家和可见人物。

## 24.2 队伍

- main group；
- split groups；
- directive；
- recruit/rejoin；
- leave；
- share knowledge；
- transfer item。

复杂操作进入此处，不再占据主叙事区。

## 24.3 任务

显示：

- available；
- active；
- succeeded；
- failed；
- abandoned；
- counters。

## 24.4 物品

显示：

- 名称；
- owner；
- source；
- transfer。

## 24.5 知识

显示：

- 已知条目；
- `knownVia`：
  - witnessed
  - told
  - inferred

可用主题化徽记。

### 暂缓到 P5

- 关系网络图；
- 骰点历史大面板；
- 世界书全文浏览；
- 前情提要高级 UI。

### Commit

```text
feat(play): add party quest inventory and knowledge panels
```

---

# 25. P4.10 系统动作收纳

当前 Play 主屏底部：

- 短休；
- 长休；
- 回退；
- 导出；
- 训练。

第三期必须重新归位。

## 25.1 Game Menu

顶部 `…`：

```text
短休
长休
回退到上一状态
导出存档
战役信息
退出到战役列表
```

## 25.2 训练

训练是角色成长行为，应放到：

> Character Sheet → Skills

而不是主 Play 页。

## 25.3 存档

“导出存档”放 Game Menu。

## 25.4 Rewind

明确显示：

> 回退会创建新分支，不覆盖当前历史。

避免用户误以为 Undo。

### Commit

```text
feat(play): move system actions into contextual game surfaces
```

---

# 26. P4.11 四主题完整适配

P4 完成后必须用四主题逐个验收完整游戏画面。

## 墨

强调：

- 夜读卷轴；
- 朱砂；
- 泥金；
- 云纹；
- 竹简线；
- 时辰式世界钟。

## 烛

强调：

- 午夜蓝；
- 烛金；
- 钢蓝；
- 藤蔓；
- 双线框；
- 卡牌感。

## 漫

强调：

- 白色漫画格；
- 3px 黑边；
- hard shadow；
- 网点；
- 拟声 / 爆炸徽记；
- 绝不因白卡造成文字 token 错用。

## 梭

强调：

- HUD；
- cyan；
- magenta；
- mono；
- 六边形；
- 切角；
- 数值信息感。

## 品牌

四主题中：

- 产品名仍是 Shine-TRPG；
- BrandMark 几何保持一致；
- 只允许颜色适配。

### Commit

```text
feat(ui): complete four-theme gameplay polish
```

---

# 27. P4 收口：删除 legacyStyles

P4 完成后：

```text
mobile/src/ui/screens/legacyStyles.ts
```

必须：

# **删除**

不得为了少量旧组件继续保留整份旧样式系统。

扫描：

```text
#08141f
#d9a441
#263a4d
#0e2030
#f1f5f9
```

确认 UI Feature 中不存在旧硬编码回流。

允许的 Hex 只存在：

- theme tokens；
- brand tokens；
- Android native resource；
- 明确的测试 fixture。

---

# 28. 第三期 Review / Fix 门禁

每一个子阶段执行固定流程。

## 28.1 自动回归

最低：

```bash
npm run verify:core
npm run typecheck --prefix mobile
```

Android：

```bash
npm run apk:debug --prefix mobile
```

P4 数据桥接发生修改时必须增加：

- projection tests；
- visibility tests；
- save compatibility tests。

## 28.2 UI Review

每阶段至少：

- 默认主题截图；
- 受影响页面四主题抽查；
- 关键状态：
  - loading
  - empty
  - success
  - error
  - disabled

## 28.3 Fix

Review 中发现的问题：

- 先修；
- 再重复测试；
- Review 文档标注关闭；
- 才允许 commit 阶段出口。

---

# 29. 真机 / 模拟器测试矩阵

## P3

至少：

- 首次启动；
- Profile 保存；
- 四主题切换；
- 导入 TXT；
- Library；
- WorldDetail；
- 三宝书；
- Review Queue；
- 世界主题覆盖；
- Opening 4 Steps；
- 创建战役。

## P4

至少：

- 进入已有战役；
- 首回合；
- 有骰回合；
- 无骰自动成功回合；
- Narrator 失败恢复；
- App kill 后恢复；
- 短休；
- 长休；
- 技能训练；
- 队伍指令；
- 分队；
- 重入；
- 知识分享；
- 物品转移；
- encounter；
- attack；
- rescue；
- move；
- dash；
- NPC turn；
- retreat；
- rewind；
- 导出存档；
- 导入存档；
- 角色卡；
- NPC public projection；
- Quest；
- Knowledge；
- 四主题。

---

# 30. 可访问性标准

第三期继续强制：

- 文本对比度 ≥ 4.5:1；
- 控件实际触控面 ≥ 44×44dp；
- 禁止仅靠颜色表达状态；
- 所有 icon-only button 提供 accessibility label；
- 角色资源条同时显示数值；
- disabled 状态有视觉变化；
- Modal / Sheet 可关闭；
- Android Back 在 Sheet 打开时先关 Sheet。

---

# 31. 性能标准

## UI

目标：

- 普通 Tab 切换无明显掉帧；
- NarrativeFeed 使用 FlatList；
- 不把全部三宝书长期挂在 Play 页面；
- Character Sheet 按需打开；
- 不在 render 中重新解析完整世界包；
- Projection 可缓存到当前 stateVersion。

## LLM

第三期不得为了 UI：

- 增加每回合强制 LLM 请求；
- 用 LLM 生成纯 UI 文案；
- 用 LLM 判断本地可推导的 combat affordance。

## APK

P1/P2 已确认 debug 体积会受到 Fabric 原生依赖影响。

第三期包体评估采用两个口径：

1. Debug：仅观察异常回归；
2. Release arm64：作为正式产品体积指标。

不得用 debug 未 strip Native SO 增量直接判定产品包体。

---

# 32. 兼容性要求

## 必须继续兼容

- 当前数据库；
- 当前 campaign；
- 当前 branch；
- 当前世界包；
- 当前 `.shineword-save.json`；
- 当前 `.shineword-world.zip`；
- 当前 Keychain；
- 当前 AsyncStorage 主题设置。

## 品牌更名不得造成

- App 被 Android 识别为新 App；
- 已有数据丢失；
- Save 无法导入；
- World Package 无法导入；
- Key 无法读取。

因此第三期不修改：

```text
applicationId
database filename
save schema name
native namespace
```

---

# 33. 建议版本策略

当前：

```text
0.2.0-p2.9
```

建议：

### P3 完成

```text
0.3.0-p3
```

### P4 完成

```text
0.3.0-p4
```

### 第三期完整验收后

可进入：

```text
0.3.0-alpha
```

`versionCode` 每次真实 APK 发布必须递增。

---

# 34. Commit 策略

禁止第三期做一个巨型 commit。

建议：

```text
docs(phase3): freeze phase-3 baseline

feat(brand): establish Shine-TRPG identity and phase-3 UI primitives
feat(ui): polish Shine-TRPG library experience
feat(ui): refine campaign and branch presentation
feat(ui): unify onboarding and profile under Shine-TRPG brand
feat(ui): productize world detail and world-theme override
feat(ui): rebuild opening flow as a four-step game wizard
review(phase3): close P3 product UI and Shine-TRPG branding

feat(ui-data): add read-only play projections for P4
refactor(play): separate play controller from presentation
feat(play): rebuild narrative feed and roll presentation
feat(play): add persistent composer and contextual quick actions
feat(play): add player and companion character sheets
feat(play): implement safe NPC public character projections
feat(play): replace encounter debug panel with combat HUD
feat(play): add party quest inventory and knowledge panels
feat(play): move system actions into contextual game surfaces
feat(ui): complete four-theme gameplay polish
refactor(ui): remove legacyStyles after P4 migration

review(phase3): complete P4 and full third-phase regression
```

---

# 35. 明确禁止事项

第三期 Agent 禁止：

1. 擅自重写游戏规则；
2. 擅自改变骰点算法；
3. 擅自改变技能成长阈值；
4. 擅自改变存档 schema；
5. 擅自修改 applicationId；
6. 擅自重命名数据库；
7. 擅自删除旧存档兼容；
8. 擅自让 NPC UI 读取 GM-only 卡；
9. 擅自为快捷行动新增 LLM 调用；
10. 擅自自动发送快捷行动；
11. 擅自新增大型 UI 框架；
12. 擅自修改 P2 已验证写路径；
13. 擅自在 UI 层复制业务规则；
14. 擅自把 Debug ThemeGallery 暴露为 Release 正式功能；
15. 未 Review/Fix 就进入下一阶段。

---

# 36. P3 Definition of Done

P3 完成必须全部满足：

- [ ] 用户可见产品品牌统一为 **Shine-TRPG**
- [ ] Android launcher label 为 Shine-TRPG
- [ ] 品牌启动页完成
- [ ] 正式 App Icon 完成
- [ ] FirstRun 品牌完成
- [ ] About 品牌完成
- [ ] README 品牌完成
- [ ] 新导出默认文件名前缀使用 `shine-trpg-`
- [ ] 兼容性 `.shineword-*` 扩展名仍可读
- [ ] Library 零 legacyStyles
- [ ] Campaigns 零 legacyStyles
- [ ] Profile 零 legacyStyles
- [ ] WorldDetail 零 legacyStyles
- [ ] Books 零 legacyStyles
- [ ] Review 零 legacyStyles
- [ ] Opening 零 legacyStyles
- [ ] Opening 改成 4 步向导
- [ ] 世界级主题覆盖有正式入口
- [ ] 四主题视觉通过
- [ ] typecheck PASS
- [ ] core regression PASS
- [ ] Android APK PASS
- [ ] P3 Review/Fix 关闭

---

# 37. P4 Definition of Done

P4 完成必须全部满足：

- [ ] Agent 开工前已阅读 `data-availability.md`
- [ ] 新增一致 stateVersion 的 Play UI Projection
- [ ] NPC Public Projection 不泄漏
- [ ] PlayScreen Controller 与 UI 分离
- [ ] NarrativeFeed 上线
- [ ] RollStrip 上线
- [ ] 常驻 Composer 上线
- [ ] Contextual Quick Actions 上线
- [ ] 无新增快捷建议 LLM 请求
- [ ] Party Strip 上线
- [ ] 玩家角色卡上线
- [ ] 同伴角色卡上线
- [ ] NPC 公开角色卡上线
- [ ] practicePoints 正确显示
- [ ] ability cooldown 正确显示
- [ ] HP / stamina / condition / lifeStatus 正确
- [ ] Encounter HUD 上线
- [ ] 角色 / 队伍 / 任务 / 物品 / 知识面板上线
- [ ] 短休 / 长休 / rewind / 存档从主页面移入合理入口
- [ ] 技能训练迁入角色卡
- [ ] 四主题 Play 完整适配
- [ ] `legacyStyles.ts` 删除
- [ ] typecheck PASS
- [ ] core regression PASS
- [ ] Android APK PASS
- [ ] 关键真机/模拟器旅程通过
- [ ] P4 Review/Fix 关闭

---

# 38. 第三期最终验收

P3 + P4 完成后执行完整回归。

产出：

```text
docs/reviews/phase3/
├─ P3_BASELINE.md
├─ P3_REVIEW.md
├─ P4_DATA_REVIEW.md
├─ P4_REVIEW.md
└─ PHASE3_FINAL_REGRESSION.md
```

最终至少确认：

## 产品

- Shine-TRPG 品牌一致；
- 非开发用户界面不再出现 ShineWord 品牌；
- 四主题统一；
- 开局流程完整；
- Play 主流程自然。

## 架构

- Screen 精简；
- Feature Component 成型；
- `legacyStyles.ts` 删除；
- UI 不复制规则；
- Play Projection 只读；
- NPC Projection 安全。

## 业务

- 创建战役；
- 回合；
- 骰点；
- 训练；
- 队伍；
- 战斗；
- 任务；
- 知识；
- 存档；
- rewind；
- 恢复；
- 分支；

全部不回退。

## 工程

- Core tests PASS；
- Mobile typecheck PASS；
- Debug APK PASS；
- Release APK PASS；
- Release arm64 包体记录；
- Git diff clean；
- 无密钥 / 私人小说 / 存档进入 Git。

---

# 39. 第三期完成后的产品状态

第三期之前：

> ShineWord 是一个功能能力已经较强、但 UI 仍带明显工程验证痕迹的互动小说 App。

第三期之后：

> **Shine-TRPG** 应成为一个品牌统一、世界主题鲜明、以“阅读剧情 → 做出行动 → 本地规则检定 → AI 叙事反馈”为核心体验的移动端单人 TRPG 产品。

核心首页职责明确：

```text
书库
管理世界

战役
管理游戏

我的
管理模型与产品设置
```

开局职责明确：

```text
选择世界起点
↓
创建角色
↓
选择同伴
↓
确认开局
```

游玩职责明确：

```text
阅读故事
↓
查看角色 / 队伍 / 世界信息
↓
自由输入或选择情境快捷行动
↓
本地规则检定
↓
AI 叙事
↓
继续冒险
```

这就是第三期的最终目标。
