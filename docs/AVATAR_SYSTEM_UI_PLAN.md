# ShineWord 玩家头像系统 UI 配置改造方案

> 状态：已定稿待实施（2026-10-05）· 本文档只做方案，不动代码
> 范围：仅 mobile UI 层新增「预设头像库」；不触碰核心引擎（根 `src/`）、主题令牌（`tokens.ts`）、存档与 LLM 链路
> 三条需求：① 新增用户角色头像设置；② 头像从预设库中选取（不可自定义上传）；③ 游玩过程中在右上角显示用户头像

---

## 1. 背景与目标

「我的」页目前只有 主题皮肤 / 模型与密钥 / 关于 三个板块，玩家在 App 内没有视觉身份；游玩页（`PlayScreen` → `PlayHeader`）右上角只有世界时钟 + 「☰ 信息」按钮。本方案引入一套**预设头像库**（四题材 × 男女 × 5 职业 = 40 个），玩家在「我的」页选定后，游玩页右上角常驻显示。

设计原则（与既有 UI 体系一致）：

- **纯增量**：只新增文件 + 三处最小挂载编辑，不改任何既有组件的行为、props 与 testID。
- **令牌驱动**：头像容器（描边、圆角、底色、选中态）全部走 `useTheme()` 令牌，随四套皮肤（墨/烛/漫/梭）自动适配，不新增颜色字面量。
- **用户身份 ≠ 世界皮肤**：头像是玩家的 App 级身份，进入世界的 `ThemeScope` 换肤**不**自动换头像；只保证容器描边/圆角随当前皮肤变化。
- **降级安全**：未设置 / 存储值非法 / 资源缺失时回退到现有的「首字字牌」样式，功能永不阻塞游玩。

## 2. 素材盘点（已核验，2026-10-05）

素材源：`C:\Users\Administrator\Pictures\png\`（仓库外，不进 git）。

| 文件 | 尺寸 | 网格 | 内容 |
|---|---|---|---|
| `东方武侠.png` | 1983×793 | 5 列 × 2 行 | 上排男 / 下排女：侠客、弓手、谋士、刺客、雅士 |
| `日系二次元.png` | 1983×793 | 5 列 × 2 行 | 上排男 / 下排女：武士、游侠、法师、忍者、神官 |
| `欧洲风格.png` | 1983×793 | 5 列 × 2 行 | 上排男 / 下排女：骑士、游侠、法师、盗贼、牧师 |
| `赛博科幻.png` | 1983×793 | 5 列 × 2 行 | 上排男 / 下排女：佣兵、技师、骇客、浪人、医师 |

像素级核验结论：

- 单元格约 **396.6 × 396.5 px**；分隔线实测位于 x ≈ 395–400 / 791–795 / 1187–1192 / 1583–1587，y ≈ 394–398（各图略有差异，部分为金色装饰线）。
- 每列上男下女成对，列 = 职业槽位，四题材的五个槽位在气质上一一对应（近战 / 远程 / 智法 / 敏捷暗杀 / 辅助雅致）。
- 四题材与现有四套主题皮肤**一一对应**，直接复用 `ThemeId` 作为头像题材 ID，不引入第二套主题词汇：

| 头像题材 | 皮肤 ThemeId | 皮肤 label | 用作选择器页签名 |
|---|---|---|---|
| 东方武侠 | `ink` | 中国古典 · 墨 | 东方武侠 |
| 欧洲风格 | `fantasy` | 欧洲奇幻 · 烛 | 欧洲奇幻 |
| 日系二次元 | `manga` | 日本漫画 · 漫 | 日系二次元 |
| 赛博科幻 | `scifi` | 未来科技 · 梭 | 赛博科幻 |

## 3. 素材加工管线

### 3.1 裁切脚本（一次性，可复跑）

新增 `tools/avatars/split_avatar_sheets.py`（Python + Pillow，仅开发机使用，App 构建不依赖它）：

- 输入：`--src`（默认 `C:\Users\Administrator\Pictures\png`）下四张合图，按 §2 映射表输出题材 ID。
- 裁切：均匀 5×2 网格，**每边内缩 8px** 消除分隔线/邻格残影（覆盖实测 ±3px 的线条带宽）。
- 缩放：LANCZOS 重采样到 **320×320**。
- 输出：`mobile/src/assets/avatars/{theme}_{gender}_{slot}.webp`，`theme ∈ {ink,fantasy,manga,scifi}`，`gender ∈ {m,f}`，`slot ∈ 1..5`，共 40 个文件。
- 体积实测（320px）：WebP q88 单张 34–41 KB，**40 张合计 ≈ 1.5 MB**；PNG 单张 ≈ 200 KB、合计 ≈ 8 MB，否决。脚本留 `--png` 开关作后备。

### 3.2 格式与兼容

- Android minSdk 24，原生支持有损 WebP（Fresco 解码），无兼容风险。
- APK 体积增量 ≈ +1.5 MB（若实施时认为偏大，可降为 256×256 ≈ 1.1 MB，纯改脚本参数重跑）。
- RN 的 `Image` 资源必须**静态 `require()`**（Metro 不支持运行时拼路径），因此注册表手写字面量 require，脚本不生成代码。

## 4. 数据模型与注册表

新增 `mobile/src/ui/features/avatar/avatarRegistry.ts`：

```ts
import type { ImageSourcePropType } from 'react-native';
import type { ThemeId } from '../../theme/tokens';

export type AvatarGender = 'm' | 'f';
export type AvatarThemeId = ThemeId; // ink | fantasy | manga | scifi

export interface AvatarPreset {
  id: string;              // 如 'ink-m-1'
  theme: AvatarThemeId;
  gender: AvatarGender;
  slot: number;            // 1..5，职业槽位
  label: string;           // 如 '东方武侠 · 男 · 侠客'（a11y 与副标题共用）
  source: ImageSourcePropType;
}

export const AVATAR_THEME_LABEL: Record<AvatarThemeId, string> = {
  ink: '东方武侠', fantasy: '欧洲奇幻', manga: '日系二次元', scifi: '赛博科幻',
};
export const AVATAR_ROLES: Record<AvatarThemeId, string[]> = {
  ink: ['侠客', '弓手', '谋士', '刺客', '雅士'],
  fantasy: ['骑士', '游侠', '法师', '盗贼', '牧师'],
  manga: ['武士', '游侠', '法师', '忍者', '神官'],
  scifi: ['佣兵', '技师', '骇客', '浪人', '医师'],
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'ink-m-1', theme: 'ink', gender: 'm', slot: 1, label: '东方武侠 · 男 · 侠客',
    source: require('../../assets/avatars/ink_m_1.webp') },
  // … 共 40 条，字面量 require，按 THEME_ORDER → 男/女 → 槽位 排序
];

export function findAvatar(id: string | null | undefined): AvatarPreset | null;
```

40 个头像完整清单见附录 A。

## 5. 状态与持久化

新增 `mobile/src/ui/features/avatar/AvatarContext.tsx`，**逐行照抄 `ThemeContext` 的成熟模式**（`mobile/src/ui/theme/ThemeContext.tsx:95-168`）：

- 存储键：`shineword.ui.avatar.v1`（AsyncStorage，与 `shineword.ui.theme` 同族命名）。
- 值：头像 id 字符串，或 `null`（未设置 = 回退字牌，即默认态）。
- `useEffect` 内 hydration + `hydratedRef` 防「默认值回写」；读取失败 / 值不在注册表中 → 归一化为 `null`（照抄 `parseThemeId` 的防御语义）。
- `setAvatarId(id)`：setState + fire-and-forget `AsyncStorage.setItem`，写失败静默。
- Context 值：`{ avatarId: string | null; hydrated: boolean; setAvatarId }`，Provider 外使用时回退默认值而非抛错（照抄 `useTheme` 的降级语义）。
- **不动 `ThemeContext`**：独立小 Context，避免触碰已被全局依赖的主题模块。

挂载：`mobile/App.tsx` 在 `ThemeProvider` 内包一层 `<AvatarProvider>`（+1 import，+1 JSX 元素）。

## 6. UI 设计

### 6.1 选择器：`AvatarCard`（「我的」页）

新增 `mobile/src/ui/features/avatar/AvatarCard.tsx`，结构完全克隆 `ThemeSkinCard`（`mobile/src/ui/features/profile/ThemeSkinCard.tsx`）的成熟模式：`Card` + `SectionHeader` + 瓦片网格 + radio 语义 + 选中描边加粗。

挂载点：`ProfileScreen.tsx:43-44`，插在 `ThemeSkinCard` 与 `ProfileFormCard` 之间；同步把页首副标题（`ProfileScreen.tsx:37`）改为 `模型端点 · 密钥 · 头像 · 主题皮肤 · 关于`。

```
┌ Card ───────────────────────────────────────────┐
│ 玩家头像                                         │
│ 当前：东方武侠 · 男 · 侠客（未设置时：默认字牌）    │
│ ┌─────────────────────────────────────────────┐ │
│ │ 东方武侠 │ 欧洲奇幻 │ 日系二次元 │ 赛博科幻    │ │ ← SegmentedControl（4 段，
│ └─────────────────────────────────────────────┘ │   既有组件，页签序 = THEME_ORDER，
│                                                  │   初始页签 = 当前皮肤对应题材）
│ 男                                               │
│ (侠)(弓)(谋)(刺)(雅)   ← 5 列圆形头像，56dp        │
│ 女                                               │
│ (侠)(弓)(谋)(刺)(雅)                              │
│                                                  │
│ ○ 不使用头像（默认字牌）            [恢复默认]     │
└──────────────────────────────────────────────────┘
```

规格要点：

- **题材切换**：`SegmentedControl`（支持 2–5 段，4 段恰好）；初始选中 `useTheme().themeId` 对应题材（仅初始排序推荐，不随换肤联动）。
- **头像瓦片**：`Pressable` + 圆形 `Image`（56dp，`resizeMode="cover"`，容器 `overflow:'hidden'` + `radius.pill`）；选中态 = `accent.primary` 描边加粗（照抄 ThemeSkinCard 的 `borderWidth: hairline + 1` 惯用法）+ 右下角 `theme.space.lg` 尺寸的 ✓ 角标（绝对定位小圆，同 `PartyStrip` 角标布局）；触控区 ≥ `touch.min`（44dp）由瓦片内边距保证。**选中态是「描边 + ✓」双通道，不依赖颜色单一指示**（同 SegmentedControl §30 的灰度可辨原则）。
- **未设置项**：网格下方一行 caption 按钮「不使用头像（默认字牌）」，选中它 = `setAvatarId(null)`；同样给 radio 语义，与瓦片构成同一组单选。
- **可访问性**：`accessibilityRole="radio"`、`accessibilityState={{ selected }}`、`accessibilityLabel` = 头像 `label`（如「东方武侠 · 男 · 侠客」）+ 选中时缀「（当前）」；`testID="avatar-option-{id}"`，未设置项 `testID="avatar-option-none"`，页签容器 `testID="avatar-theme-tabs"`。
- 局部状态（当前题材页签）用 `useState`，选中头像直接来自 `useAvatar()`。

### 6.2 游玩页右上角常驻头像：`PlayHeader`

编辑 `mobile/src/ui/features/play/PlayHeader.tsx:56-88` 的 `actions` 槽，在世界时钟与「☰ 信息」按钮之间插入头像（32dp，尺寸/描边/圆角完全对齐 `PartyStrip.tsx:80-93` 的玩家字牌惯用法）：

```
‹ 战役   战役标题              亥时三刻  (◉)  ☰ 信息
                                     32dp 圆形   既有按钮
```

```tsx
const { avatarId } = useAvatar();
const avatar = findAvatar(avatarId);
// actions 内、menu Pressable 之前：
{avatar ? (
  <View
    accessible
    accessibilityLabel={`玩家头像：${avatar.label}`}
    testID="play-avatar"
    style={[styles.avatar, {
      borderColor: theme.accent.primary,
      borderRadius: theme.radius.pill,
      width: theme.space.xxl, height: theme.space.xxl,
    }]}>
    <Image source={avatar.source} style={styles.avatarImage} resizeMode="cover" />
  </View>
) : null}
// styles.avatar: { borderWidth: 1, overflow: 'hidden' }; styles.avatarImage: { width: '100%', height: '100%' }
```

- **非交互**（纯身份展示，避免与「☰ 信息」抢点）；`PlayHeader` 自取 `useAvatar()`，**PlayScreen 零改动**。
- 未设置头像时该位置不渲染（维持现状），游玩功能不受影响。
- 圆形容器对方形图只裁四角，半身立绘主体不受损；若实施后视觉 QA 发现个别头像构图受损，仅改 `resizeMode`/容器为 `radius.lg` 圆角方，不影响其它模块。

### 6.3 明确不做（本期范围外，留作后续候选）

- `PartyStrip` 玩家角色字牌替换为头像（那是「世界内角色」，与本功能「App 级玩家身份」语义不同）。
- `FirstRunScreen` 首启流程加头像步骤、按世界题材自动推荐头像、头像上传/裁剪、游玩页点头像跳转设置。
- 头像写入战役存档或传递给 LLM 上下文（不触碰核心与存档格式）。

## 7. 改动清单（隔离保障）

### 7.1 新增文件（全部）

| 文件 | 内容 | 预估规模 |
|---|---|---|
| `tools/avatars/split_avatar_sheets.py` | 合图裁切脚本（一次性，可复跑） | ~80 行 |
| `mobile/src/assets/avatars/*.webp` | 40 个头像资源 | ≈ 1.5 MB |
| `mobile/src/ui/features/avatar/avatarRegistry.ts` | 数据模型 + 40 条静态注册表 | ~150 行 |
| `mobile/src/ui/features/avatar/AvatarContext.tsx` | 状态 + AsyncStorage 持久化 | ~90 行 |
| `mobile/src/ui/features/avatar/AvatarCard.tsx` | 选择器卡片 | ~160 行 |
| `mobile/src/ui/features/avatar/index.ts` | barrel 导出 | ~5 行 |

### 7.2 修改文件（最小挂载编辑，共 3 个 + 文档）

| 文件 | 编辑量 | 内容 |
|---|---|---|
| `mobile/App.tsx` | +2 行 | 挂 `AvatarProvider` |
| `mobile/src/ui/screens/ProfileScreen.tsx` | +2 行 / 改 1 行 | 插入 `<AvatarCard />`；副标题加「头像」 |
| `mobile/src/ui/features/play/PlayHeader.tsx` | +~14 行 | actions 槽插入头像（§6.2 代码） |
| `CHANGELOG.md` / 版本号 | 按惯例 | 实施合入时按 `docs/VERSIONING.md` 更新 |

### 7.3 明确不触碰

- 核心：根 `src/`、`tests/`、`schemas/`、`migrations/`（`npm run verify:core` 必须不受影响）。
- 主题体系：`tokens.ts`、`ThemeContext.tsx`、`navigationTheme.ts`、 ornaments。
- 其它屏幕与功能组件：`PartyStrip`、`PlayScreen`、`NarrativeFeed`、开局向导、书库/战役/世界详情、LLM/密钥/存档模块。
- 所有既有 testID、存储键、导航路由：一概不变，仅新增。

## 8. 实施步骤

1. **素材管线**：写 `split_avatar_sheets.py` → 产出 40 个 WebP → 人工抽查四角与中间槽位裁切质量。
2. **注册表与状态**：`avatarRegistry.ts`（40 条 + `findAvatar`）→ `AvatarContext.tsx` → `App.tsx` 挂 Provider。
3. **选择器**：`AvatarCard.tsx` → `ProfileScreen` 挂载；开发者菜单式自查四皮肤下选中态/灰度可辨。
4. **游玩页展示**：`PlayHeader` actions 槽插入头像。
5. **验证收尾**：跑 §9 验证清单 → 更新 `CHANGELOG.md` 与版本号（`npm run prebuild` 自动随 apk 脚本重生成 `version.json`）。

## 9. 验证计划

自动化：

- `npm --prefix mobile run typecheck` 零错误（新增文件全部过 TS）。
- `npm run verify:core` 保持绿（证明核心零影响）。
- `npm --prefix mobile run apk:debug` 构建成功，APK 体积增量 ≈ 1.5 MB（偏差大时回查资源尺寸/格式）。

模拟器手检（emulator-5554，装 debug APK）：

1. 首次进入「我的」→ 头像默认「未设置」；四题材页签可切换，各 10 个头像、男女各 5。
2. 选 `ink-m-1` → 杀进程重启 → 仍选中（持久化）；游玩页右上角（时钟与菜单之间）出现 32dp 圆形头像，`testID="play-avatar"`。
3. 切换皮肤（墨→烛→漫→梭）→ 头像容器描边/角标随皮肤变化，头像本体不换。
4. 进入使用其它皮肤的世界（ThemeScope 生效）→ 头像仍显示且不随世界换肤。
5. 点「不使用头像」→ 游玩页头像消失，回退现状布局。
6. 存储注入非法值（`adb shell run-as` 改 AsyncStorage 或 debug 覆盖）→ 启动后归一化为「未设置」，不崩溃。
7. 回归：主题皮肤卡、模型表单、游玩流程、☰ 菜单、队伍条与改造前逐屏一致（截图对比）。
8. 可访问性：`uiautomator dump` 确认瓦片 radio 语义与 label 完整。

## 附录 A：40 头像清单（id / label / 资源文件）

| slot | ink（东方武侠） | fantasy（欧洲奇幻） | manga（日系二次元） | scifi（赛博科幻） |
|---|---|---|---|---|
| 1 | 侠客 | 骑士 | 武士 | 佣兵 |
| 2 | 弓手 | 游侠 | 游侠 | 技师 |
| 3 | 谋士 | 法师 | 法师 | 骇客 |
| 4 | 刺客 | 盗贼 | 忍者 | 浪人 |
| 5 | 雅士 | 牧师 | 神官 | 医师 |

- id 规则：`{theme}-{m|f}-{slot}`，如 `ink-f-3` = 东方武侠 · 女 · 谋士。
- 资源文件：`mobile/src/assets/avatars/{theme}_{m|f}_{slot}.webp`（下划线分隔，共 40 个）。
- 性别语义：合图上排 = 男（`m`），下排 = 女（`f`）。
