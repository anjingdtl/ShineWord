# ShineWord UI 重构 · 开工提示词（交接给执行 Agent）

> 用法：把本文件全文（或下方分割线以内部分）作为提示词发给执行 Agent。

---

# 任务：ShineWord App UI/UX 重构建设（另立分支）

你是 React Native 资深工程师。ShineWord 是一个 Android 平台的 AI 互动小说跑团 App（React Native 0.85 + TypeScript，Hermes）。功能规则域已全部完成（M0–M5），现在**只做 UI/UX 重构，不改任何业务逻辑**。设计方案与可交互原型已评审通过，你的任务是按方案动工。

## 0. 先读三份材料（必读，不要跳过）

1. `docs/UI_REDESIGN_PLAN.md` —— 完整设计方案：信息架构、四套主题 Token 表、装饰组件库、角色卡系统、分阶段路线、验收清单。
2. `docs/ui-prototype/play-screen-themes.html` —— 可交互高保真原型：四主题切换、游玩页/角色卡双视图、玩家/NPC 投影切换。**视觉细节以此为准**（角花样式、pip 轨、队伍条、气泡尾巴等）。
3. `mobile/App.tsx`（约 1900 行）—— 当前全部 UI 所在的单文件；`mobile/src/*.ts` —— 桥接层（database/runtime/worldImport/secureKeyStore 等）。

## 1. 建立分支

```bash
git checkout -b feature/ui-revamp
```

基线 = 当前工作区代码（先确认 `git status` 干净或先提交既有改动，不要把无关改动带进新分支）。

## 2. 铁律（违反即返工）

1. **不改业务逻辑**：禁止修改 `src/`（规则域）、`mobile/src/`（桥接层）、`migrations/`。只允许新增 `mobile/src/ui/`（主题与组件）和重写 `mobile/App.tsx` 及其拆分产物。
2. **依赖白名单制**：只允许新增 `@react-navigation/native`、`@react-navigation/native-stack`、`@react-navigation/bottom-tabs`、`react-native-screens`、`react-native-svg`、`lucide-react-native`。**禁止** vector-icons 整包字体、lottie、reanimated（动画用内置 Animated API）。引入前先看 `mobile/package.json`，每加一个记录在 PR 描述里。
3. **禁止打包中文字体**：字体只用系统回退（serif / sans-serif / monospace）。
4. **零硬编码**：组件内不允许出现 hex 色值、写死的字号/圆角/间距，全部走 ThemeContext 的 token。
5. 每完成一个阶段必须 `cd mobile && npx tsc --noEmit -p tsconfig.json` 通过，且 APK 可构建（`npm run apk:debug` 或已有构建命令），并真机/模拟器目检截图存档到 `docs/reviews/ui/`。

## 3. 阶段划分与本次开工范围

按方案 §6 的 P1→P5 推进。**本轮只做 P1 + P2**，做完停下来汇报，不要一口气冲到 P4：

### P1 · 主题地基（最先做）
- 新建 `mobile/src/ui/theme/`：
  - `tokens.ts` —— 四套主题（ink 墨 / fantasy 烛 / manga 漫 / scifi 梭）的完整 Token 对象，字段与方案 §3.2 对齐（bg 三层 / text 三级 / accent / semantic / radius / border / 字族）。
  - `ThemeContext.tsx` —— Provider + `useTheme()` hook；默认主题持久化到 AsyncStorage（key: `shineword.ui.theme`）；预留按世界覆盖主题的接口（worldId → themeId 映射存 AsyncStorage，本轮只做存取不做 UI 入口）。
  - `ornaments/` —— 装饰组件三槽位：`<OrnamentCorner theme={t} position="tl|tr|bl|br" />`、`<ChapterDivider />`、`<BackgroundPattern />`，用 react-native-svg 按原型 HTML 里的 SVG 路径实现（路径可直接从 `play-screen-themes.html` 的 `<defs>` 搬运换算）。
- 新建 `mobile/src/ui/components/`：`Button`（primary/secondary/chip 三态 + 按压缩放反馈）、`Card`、`Header`、`Chip`、`PipTrack`（pip 轨，支持 total/on/half）、`Bar`（进度条）、`EmptyState`。全部消费 `useTheme()`，支持 manga 主题的 3px 黑边 + 硬投影变体。
- 这一步不接入任何现有页面，只交付组件库 + 一个临时 `ThemeGalleryScreen`（挂在 App 里一个隐藏入口即可），把四主题所有组件摆在一起供目检。

### P2 · 导航骨架
- 引入 react-navigation（白名单内的三个包）：
  - 根部：`native-stack`；首层：`bottom-tabs` 三个 Tab（书库 Library / 战役 Campaigns / 我的 Profile）。
  - 把 App.tsx 现有 6 个屏原样搬进 `mobile/src/ui/screens/`（LibraryScreen→书库 Tab；拆分出 CampaignsScreen=原 LibraryScreen 里战役相关部分→战役 Tab；SettingsScreen→我的 Tab；Books/Review 合并为 WorldDetailScreen 的子页签；Opening/Play 保持全屏 stack 页面）。**本轮只做"原样搬迁 + 导航接通"，不重排页面内部布局**（P3/P4 才做）。
  - 删除 `useState<Screen>` 手动导航，改用 navigation；返回行为走系统返回栈。
- Tab 栏与 Stack 头部应用当前主题 token；主题在「我的」页加一个四选一切换入口（本轮可以先放这里，不做世界级覆盖 UI）。

## 4. 视觉规格速查（细节以原型 HTML 为准）

- **墨 ink**：bg `#12100C/#1D1913/#2A241B`，text `#EFE6D0/#A99E86`，accent 朱砂 `#C8442F` + 泥金 `#C9A063`，圆角 3，叙事 serif，云纹角花 + 竹简竖线底纹 + 印章角标。
- **烛 fantasy**：bg `#0A0E1A/#101828/#1A2438`，text `#F1F5F9/#A8B8C6`，accent 金 `#D9A441` + 蓝 `#91B6D7`，圆角 10，藤蔓角花 + 双线框。
- **漫 manga**：bg `#16161E` + 网点底纹，卡片纯白 `#FFF` + 3px 黑边 + 右下硬投影（4px 实色偏移，RN 里用双层 View 错位实现，不用 shadow），accent `#FF4757/#3B82F6/#FACC15`，白卡上文字 `#111/#555`，集中线角标 + 气泡尾巴。
- **梭 scifi**：bg `#05070D/#0B101B/#111A2B`，text `#D7E6F5/#7D93AC`，accent 青 `#35E0FF` + 品红 `#FF3DF0`，圆角 2，HUD 切角卡（clipPath）+ 六边形底纹 + 数值等宽字体；扫描线默认关（做成 token 开关）。
- 对比度：正文 ≥ 4.5:1；触控目标 ≥ 44×44dp；所有 Pressable 有按压反馈。

## 5. 领域知识速查（后面 P4 角色卡要用，本轮先了解）

- 角色数据：`src/domain/characters/card.ts` 的 `ActorCard`（六属性 1–3、技能五档↔d4–d12、能力四槽、resourceMax、kind 五类、powerTier 三阶）。
- 实时状态：`src/domain/state/types.ts`（resources 当前值、conditions、practicePoints 阈值 5/10/20/40、relationships stance+closeness、itemOwners）。
- **P2 收尾时做一个"数据可达性核查"**：确认 session 层（`application/campaign/session.ts` 及 mobile 侧 getCampaignState）当前已暴露哪些字段到 UI，哪些（练习点/关系/物品/条件）需要只读扩展——产出一份 `docs/reviews/ui/data-availability.md`，列出"角色卡所需字段 × 现状 × 获取方式"，作为 P4 开工依据。注意：如需扩展，只允许在桥接层**新增只读查询函数**，不改写任何写路径。

## 6. 交付与汇报

- 完成后在分支上提交（conventional commits，如 `feat(ui): add theme tokens and context`）。
- 输出：① P1/P2 变更文件清单；② 四主题 ThemeGallery 截图；③ 三 Tab 导航真机截图；④ `tsc --noEmit` 与 debug 构建结果；⑤ `docs/reviews/ui/data-availability.md`；⑥ 遇到的方案偏差（凡与 `UI_REDESIGN_PLAN.md` 冲突的实现选择，必须列出并说明理由）。
