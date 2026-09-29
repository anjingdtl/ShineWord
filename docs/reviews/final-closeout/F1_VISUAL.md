# F1 — 四主题视觉与交互验收

**阶段：** F1（第三期 P3/P4 最终视觉验收）
**分支：** `feature/final-acceptance-closeout`
**基线：** `6c1bc790f64f8e13e27340f768e0fad6fd923673`（main HEAD，versionCode 15 / 0.3.0-progressive.1）
**更新：** 2026-09-29（Asia/Shanghai）

## 0. 本轮能做什么、不能做什么（先说结论）

| 验收项 | 本轮结论 | 依据 |
|---|---|---|
| F1.1 对比度（WCAG 2.1） | **PASS（静态）** | token 级对比度审计，84 项文字/大字检查全部达标 |
| F1.2 触控面 ≥ 44dp | **PASS（代码级）** | 组件源码审查 + 修复 3 处真实缺陷；未做 UIAutomator bounds 实测 |
| F1.3 键盘 / Safe Area / Sheet Back | **PARTIAL** | 清单与 windowSoftInputMode / Modal onRequestClose 已核；无设备，未实测像素遮挡 |
| F1.4 长叙事历史（100 TurnView） | **NOT TESTED** | 需要运行中的 App，本地沙箱无设备 |
| 四主题真机截图 | **NOT TESTED（外环境阻断）** | 本地沙箱无 Android SDK 运行设备、无 `/dev/kvm`，无法启动模拟器 |

对照 §十～十三：本轮把**可在无设备条件下确定完成的对比度与触控面**关闭，并把**必须依赖运行设备**的截图 / 键盘 / 长列表项如实标注为 `NOT TESTED`，不伪造。

---

## 1. F1.1 对比度验收（静态，PASS）

### 1.1 方法与判据

工具：[contrast-check.cjs](file:///workspace/docs/reviews/final-closeout/contrast-check.cjs)

- 读取与组件同源的 `mobile/src/ui/theme/tokens.ts` 字面值（镜像在脚本内，作为单一事实源核对）。
- WCAG 2.1 相对亮度 + 对比度公式；普通正文 `>= 4.5:1`，大型文字 `>= 3:1`。
- 每个配对带角色：`text`（小号文字）/ `large`（大字）/ `fill`（填充，不计失败）/ `guard`（**禁止**用于文字的回归护栏）。
- 退出码非零仅在 `text`/`large` 低于下限时出现。

运行结果：

```
Text/large checks: 84; below floor: 0
ALL TEXT PAIRS PASS
```

### 1.2 关键风险项核对

**墨（ink，深色）** — 泥金文字 / 朱砂强调 / 深色背景 muted：

| 配对 | 实测 | 下限 | 结论 |
|---|---|---|---|
| text.muted / bg.base | 5.50 | 4.5 | PASS |
| accentText（泥金）/ bg.raised | 7.24 | 4.5 | PASS |
| accentOnBase / bg.base（页面 chrome） | 7.87 | 4.5 | PASS |
| semanticText.bad（朱砂文字）/ bg.overlay | 4.60 | 4.5 | PASS |

> 朱砂 `accent.primary` 作为**填充/描边**（3.9:1）保留；作为**文字**改用 `semanticText.bad = #D96D5C`（本次新增）。

**烛（fantasy，深色）** — 金色标题 / 钢蓝次文字 / Raised·Overlay 卡片：

| 配对 | 实测 |
|---|---|
| accentText（烛金）/ bg.raised / bg.overlay | 7.89 / 6.90 |
| semanticText.info（钢蓝）/ bg.overlay | 7.30 |
| onRaised.secondary / bg.overlay | 7.64 |

全部 PASS。

**漫（manga，最高风险主题）** — 白卡 / 浅色背景 / `onRaised.*` / StatusBanner / TextField placeholder / SegmentedControl：

| 配对 | 实测 | 备注 |
|---|---|---|
| onRaised.primary / bg.raised（白卡正文） | 18.88 | PASS |
| onRaised.secondary / bg.raised | 7.46 | PASS |
| onRaised.primary / bg.overlay | 18.54 | PASS |
| onRaised.secondary / bg.overlay | 7.32 | PASS |
| accentText / bg.raised（面板标签） | 18.88 | PASS |
| accentOnBase（红）/ bg.base（页面 chrome） | 5.39 | 修复了「黑字在深色页面 1.05:1 → 不可见」 |
| semanticText.good / bg.raised | 4.80 | 由亮绿改为深绿 `#1A8345` |
| semanticText.bad / bg.raised | 4.66 | 深红 `#EA0014`（原 #FF4757 仅 3.3:1） |
| semanticText.warn / bg.raised | 4.69 | 深黄褐 `#8C7103`（原 #FACC15 远低） |
| semanticText.info / bg.raised | 4.67 | 深蓝 `#196CF4` |

> **P4.11 历史缺陷「白卡 + text.muted 对比度错误」不再出现**：漫主题的 `text.muted` 只用于 `bg.base`（页面 5.26:1 PASS）；卡片内一律使用 `onRaised.secondary`（7.46:1）。工具中的 `guard` 配对 `text.muted / bg.raised`（3.68:1）作为**禁止用法**护栏保留，确保后续不会退回。

**梭（scifi，深色）** — cyan / magenta / mono 数字 / HUD overlay / disabled：

| 配对 | 实测 |
|---|---|
| text.primary（mono 数字）/ bg.base | 15.85 |
| accentText（cyan）/ bg.overlay | 10.99 |
| semanticText.bad（magenta）/ bg.overlay | 5.95 |
| text.muted / bg.base（disabled 文字底色参考） | 4.97 |

全部 PASS。

### 1.3 本轮对比度修复清单（代码）

| 文件 | 修复 | 关闭的缺口 |
|---|---|---|
| [tokens.ts](file:///workspace/mobile/src/ui/theme/tokens.ts#L62-L81) | 新增 `accentOnBase` + `semanticText` 两个 token 槽 | 漫主题页面 chrome 文字不可见；四主题语义小号文字不达标 |
| [StatusBanner.tsx](file:///workspace/mobile/src/ui/components/StatusBanner.tsx#L30-L49) | 前导规则用 `semantic`（填充）、tone 字形改 `semanticText`（文字） | 「语义色文字」在 overlay 上不达标 |
| [RollStrip.tsx](file:///workspace/mobile/src/ui/features/play/RollStrip.tsx) | `semantic` → `semanticText` | 骰点结果文字不达标 |
| [PlayHeader.tsx](file:///workspace/mobile/src/ui/features/play/PlayHeader.tsx)、[ProgressSteps.tsx](file:///workspace/mobile/src/ui/components/ProgressSteps.tsx)、[TextField.tsx](file:///workspace/mobile/src/ui/components/TextField.tsx)、[CharacterSections.tsx](file:///workspace/mobile/src/ui/features/play/character/CharacterSections.tsx)、[CharacterSheet.tsx](file:///workspace/mobile/src/ui/features/play/character/CharacterSheet.tsx)、[CombatantCard.tsx](file:///workspace/mobile/src/ui/features/play/encounter/CombatantCard.tsx)、[ZoneTrack.tsx](file:///workspace/mobile/src/ui/features/play/encounter/ZoneTrack.tsx)、[ReviewIssueCard.tsx](file:///workspace/mobile/src/ui/features/world-detail/ReviewIssueCard.tsx)、[WorldBooksEditor.tsx](file:///workspace/mobile/src/ui/features/world-detail/WorldBooksEditor.tsx)、[WorldOverviewPanel.tsx](file:///workspace/mobile/src/ui/features/world-detail/WorldOverviewPanel.tsx)、[BuildStatusCard.tsx](file:///workspace/mobile/src/ui/features/library/BuildStatusCard.tsx)、[TurnCard.tsx](file:///workspace/mobile/src/ui/features/play/TurnCard.tsx)、[ThemeGalleryScreen.tsx](file:///workspace/mobile/src/ui/screens/ThemeGalleryScreen.tsx) | 按「文字用 text 槽、填充用 fill 槽、页面 chrome 用 accentOnBase」规则换槽 | 同类语义色/强调色文字对比度问题 |

---

## 2. F1.2 触控面验收（代码级，PASS）

判据：所有交互控件可视/热区 `>= 44 x 44 dp`（`theme.touch.min = 44`）。策略见 [a11y.ts](file:///workspace/mobile/src/ui/components/a11y.ts)：紧凑外观不放大像素，缺口用 `hitSlop` 补齐。

### 2.1 已覆盖控件（继承保障）

| 控件 | 保障方式 |
|---|---|
| 行动按钮、Encounter 动作、面板动作、Sheet Close、Opening +/- | `Button` → `Surface.contentStyle.minHeight = touch.min(44)`；chip 变体再加 `useVerticalHitSlop` |
| Quick Action、技能选择、Directive 选择 | `Chip` → `Button variant="chip"` |
| TextField / 密码显隐 | 输入框 `minHeight = touch.min`；显隐按钮 `hitSlop = space.sm(8)`（约 34dp 视觉 + 16 = 50） |
| PlayHeader 菜单/信息 | `hitSlop = 12`（≈28 + 24 = 52） |
| PlayPanel 关闭 ✕ | `hitSlop = 12`（≈20 + 24 = 44） |
| Opening 步骤跳转、主题卡、ChoiceCard、CombatantCard | 卡片式整块可点，远大于 44 |

### 2.2 本轮发现并修复的真实缺陷（3 处）

| 控件 | 修复前 | 修复 | 依据 |
|---|---|---|---|
| [SegmentedControl.tsx](file:///workspace/mobile/src/ui/components/SegmentedControl.tsx#L33-L46) `compact`（世界详情 / 游戏信息 / 三宝书页签） | 段高 ≈ 23dp，无热区补齐 | 增加**仅纵向** `hitSlop`（默认段 36dp→补 4；compact 段 23dp→补 11）。横向 slop=0，避免相邻段在间隙处抢点 | 真实 F1.2 缺陷 |
| [ProgressSteps.tsx](file:///workspace/mobile/src/ui/components/ProgressSteps.tsx#L44-L56)（开局步骤） | 步骤热区宽 ≈ 24dp（数字圆） | 横向 `hitSlop = ceil((44-24)/2)=10`；步骤间为 flex 分隔条，不会重叠 | 真实 F1.2 缺陷 |
| [PartyStrip.tsx](file:///workspace/mobile/src/ui/features/play/PartyStrip.tsx#L55-L68)（队伍条） | 磁贴宽 ≈ 32dp（头像） | 横向 `hitSlop = ceil((44-32)/2)=6`，恰等于条内 12dp 间距的一半，不越界抢点 | 真实 F1.2 缺陷 |

三处均按 token 推导，未引入魔法数字；`npm run typecheck --prefix mobile` 通过。

### 2.3 未完成部分（如实标注）

- **未做 UIAutomator / Accessibility bounds 实测**：需要运行中的 App。本地沙箱无 Android 运行设备（见 F0/F5）。
- 因此 F1.2 结论为「**代码级 PASS，运行期 bounds 实测 NOT TESTED**」。

---

## 3. F1.3 键盘 / Safe Area / Sheet（PARTIAL）

### 3.1 键盘与安全区（已核清单，未实测像素）

| 检查项 | 静态核对结果 |
|---|---|
| ActionComposer 不被键盘遮挡 | [AndroidManifest.xml](file:///workspace/mobile/android/app/src/main/AndroidManifest.xml#L22) `windowSoftInputMode="adjustResize"`；composer 为普通 RN 输入 + 底部按钮，resize 后仍在可视区 |
| Profile TextField / Opening 姓名·Goal / WorldBooks Editor | 均为主题化 `TextField`，位于可滚动容器内 |
| 底部安全区 | [ScreenShell.tsx](file:///workspace/mobile/src/ui/components/ScreenShell.tsx) 使用 `react-native-safe-area-context` |
| 状态栏不遮 Header | `ScreenShell` 顶部 safe-area inset |
| 导航栏不遮 Composer | `ScreenShell bottom` inset |

> 以上为源码与清单核对；**「键盘弹出后输入框未被遮挡」「发送按钮仍可触达」的像素级实测因无设备标记 NOT TESTED。**

### 3.2 Sheet（Bottom Sheet / Android Back）

| 检查项 | 静态核对结果 |
|---|---|
| Android Back 先关 Sheet | [PlayPanel.tsx](file:///workspace/mobile/src/ui/features/play/panels/PlayPanel.tsx#L50-L54) `Modal onRequestClose={onClose}` |
| 背景遮罩可关闭 | 遮罩为全屏 `Pressable onPress={onClose}` |
| 关闭后焦点正常 | `Modal` 卸载即归还焦点 |
| 不产生双 Modal 卡死 | 角色卡 / NPC 卡由同一 `PlayScreen` 状态机驱动，`onOpenInfo` 先 `setMenuOpen(false)` 再开信息面板；NPC 与角色卡分别由 HUD 选择切换 |

> 运行期「Back 关闭 → 再开 → 焦点」「双 Modal」行为**未实测**，标记 NOT TESTED。

---

## 4. F1.4 长叙事历史（NOT TESTED）

- 计划：构造 ≥100 个 `TurnView` 的 UI fixture，验证 FlatList 不崩溃、向上读旧史不被新内容抢滚动、贴底自动滚底、Sheet 返回位置合理。
- 本轮状态：**NOT TESTED** —— 需要运行中的 App / 设备。

---

## 5. 剩余缺口（进入 FINAL_REPORT 汇总）

1. 四主题关键屏幕设备截图（Library 世界卡 / Opening Step2·Step4 / Play 普通与有骰叙事 / 玩家·同伴·NPC 卡 / Encounter HUD / 任务·知识面板）—— **NOT TESTED（外环境）**。
2. 键盘 / Safe Area / Bottom Sheet 运行期实测 —— **NOT TESTED（外环境）**。
3. 100 TurnView 长列表 —— **NOT TESTED（外环境）**。

原因详见 [F0_BASELINE.md](file:///workspace/docs/reviews/final-closeout/F0_BASELINE.md)：本地沙箱无 Android 运行设备（无 `/dev/kvm`、无 emulator 二进制）。这些项在具备设备的机器上必须补做，才能关闭「第三期验收」中的视觉/设备部分。