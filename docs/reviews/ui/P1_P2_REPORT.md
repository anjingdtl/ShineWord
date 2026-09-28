# P1 + P2 收尾报告 · UI/UX 重构

> 分支：`feature/ui-revamp` · 2026-09-28 · 范围：P1 主题地基 + P2 导航骨架（按要求停在 P2，未进入 P3/P4）
> 交付物中的 ①–⑥ 见本文对应小节；第七节是接管后额外完成的规则域修复与真实 LLM 端到端实测。

---

## 0. 提交记录

| commit | 内容 |
|---|---|
| `95f9cbf` | `chore: checkpoint M0-M5 work before UI revamp` —— 先把 main 上既有改动落定，再开分支（避免把无关改动带进新分支） |
| `4d07c33` | `feat(ui): add theme tokens, ThemeContext and the base component library`（P1） |
| `63d31f4` | `fix: close player projection leaks`（另一会话的规则域收尾，已并入本分支） |
| `e67f85c` | `feat(ui): real navigation shell with themed tabs and stack pages`（P2） |
| `8aab4a3` | `fix(worldBuild): retire stale review notices and stop dropping good proposals`（第七节） |

---

## ① 变更文件清单

### P1 · 主题地基（全部新增，`mobile/src/ui/`）

| 文件 | 作用 |
|---|---|
| `theme/tokens.ts` | 四套主题完整 token：bg 三层（base/raised/overlay/sunken）、text 三级、`onRaised`、`onAccent`、`accent.{primary,secondary,tertiary}`、`accentText`、`semantic`、`border`、`chip`、`pip`、`bar`、`die`、`radius`、`space`、`touch`、`font`（serif/sans/mono 系统回退）、`type`（8 档字号+行高+字重+字距+字族）、`effects`（cardBorderWidth / cardShadow / controlShadow / insetFrame / clipCorner / scanlines / pressedScale / dividerUsesAccent）、`ornament` 槽位 id |
| `theme/ThemeContext.tsx` | Provider + `useTheme()` + `useThemedStyles()`；默认皮肤持久化（`shineword.ui.theme`）；`worldId → themeId` 覆盖映射（`shineword.ui.worldTheme`，本轮只做存取与解析，不做入口）；无 Provider 时降级返回默认皮肤而不是抛错 |
| `theme/ornaments/specs.ts` | 三槽位的矢量数据表（角花 4 套 / 分隔饰 4 套 / 底纹 4 套），路径来自原型 HTML 的 `<defs>`；颜色只声明语义 `tone`，不写 hex |
| `theme/ornaments/OrnamentCorner.tsx` | `<OrnamentCorner position=tl/tr/bl/br />` + `<OrnamentFrame />`（四角一次挂载，镜像矩阵与原型 CSS `scaleX/scaleY` 一致） |
| `theme/ornaments/ChapterDivider.tsx` | `<ChapterDivider label />`：两侧细线用 View 拉伸，中间 motif 用 SVG，支持 fantasy 双线 |
| `theme/ornaments/BackgroundPattern.tsx` | `<BackgroundPattern />`（竹简竖线 / 网点纸 / 六边形网格）+ `<ScanlineOverlay />`（默认关，由 token 开关控制） |
| `components/` | `Button`（primary/secondary/chip 三态 + 按压缩放 + hitSlop 补足 44dp）、`Card`（tone/ornament/onPress/cut）、`Header`、`Chip`、`PipTrack`（total/on/half）、`AttributePips`、`Bar`、`DieBadge`（d4–d12）、`EmptyState`、`Surface`（描边/硬投影/内框/HUD 切角的唯一实现）、`ScreenShell`（页面底色 + 安全区）、`typography.ts`（token → TextStyle）、`a11y.ts`（触控补足策略） |
| `screens/ThemeGalleryScreen.tsx` | 临时目检台（四主题 + 全组件），经「我的」标题长按进入 |

### P2 · 导航骨架

| 文件 | 变更 |
|---|---|
| `mobile/App.tsx` | **1954 行 → 60 行**：只保留 ThemeProvider / SafeAreaProvider / AppSessionProvider / AppRoot + 首启门禁 |
| `mobile/src/ui/navigation/types.ts` | `RootStackParamList` / `RootTabParamList` / `AppTabNavigation`（Tab 与 Stack 的组合导航类型）/ 全局 `ReactNavigation.RootParamList` 增强 |
| `mobile/src/ui/navigation/navigationTheme.ts` | token → React Navigation Theme（容器、卡片、文字、边框） |
| `mobile/src/ui/navigation/AppNavigator.tsx` | 根部 native-stack（Tabs/WorldDetail/Opening/Play/ThemeGallery）+ bottom-tabs（书库/战役/我的），Tab 栏与图标全 token 化（lucide 按个引入） |
| `mobile/src/ui/state/AppSessionContext.tsx` | profile/loading/error 上下文（原 App.tsx 内 useState + props 透传） |
| `mobile/src/ui/screens/legacyStyles.ts` | 原共享 StyleSheet **原样搬迁**（P3 起逐屏 token 化） |
| `screens/LibraryScreen.tsx` | 书库 Tab：导入 TXT 构建 / 导入世界包 / 世界卡片（详情·创建战役·审核队列） |
| `screens/CampaignsScreen.tsx` | 战役 Tab：战役+分支列表 / 导入存档 / 跳游玩页 |
| `screens/ProfileScreen.tsx` | 我的 Tab：四主题切换 + 模型与密钥 + 关于；同组件兼顾首启（`FirstRunScreen`） |
| `screens/WorldDetailScreen.tsx` | 世界详情：子页签 资料 / 三宝书 / 审查 / 世界包 |
| `screens/WorldDetailBooks.tsx` | 原 BooksScreen 主体（玩家视图过滤 + 编辑模式草稿/验证/发布）原样搬迁 |
| `screens/WorldDetailReview.tsx` | 原 ReviewScreen 主体原样搬迁 |
| `screens/OpeningScreen.tsx` | 开局向导（全屏 stack），`onCreated` 改为 `replace('Play')`（向导不留死链） |
| `screens/PlayScreen.tsx` | 游玩页（全屏 stack），逻辑原样，仅换主题化头部与返回栈 |
| `screens/worldPackageExport.ts` | 世界包导出被两处复用，抽成单一实现 |
| `mobile/tsconfig.json` | `include` 增加 `src/**/*.tsx`（**否则新组件完全不参与类型检查**） |
| `mobile/android/.../MainActivity.kt` | `super.onCreate(null)`——react-native-screens 的官方要求，避免原生 fragment 状态与导航器抢管 |
| `mobile/android/gradle.properties` | `org.gradle.jvmargs` 2 GB → 4 GB（打包期 OOM，见 ④） |
| `mobile/android/app/build.gradle` | 版本号 9→10 / `0.2.0-p2.8`→`0.2.0-p2.9`（与 `mobile/package.json` 对齐，`apk:debug` 的版本门禁要求一致） |
| `scripts/png_probe.py` | 自写极简 PNG 像素采样器：切角几何、主题配色、对比度都用它做**数值取证**（不靠肉眼） |

**铁律遵守情况**：`src/`（规则域）在 P1/P2 内零改动——`src/**` 的唯一改动来自第七节的缺陷修复，且都是有测试覆盖的 bugfix；`mobile/src/`（桥接层）既有导出**只增不改**（新增 `screens/worldPackageExport.ts`、`state/AppSessionContext.tsx` 均在 `mobile/src/ui/` 下）；`migrations/` 未改。

---

## ② 四主题 ThemeGallery 截图（12 张）

`docs/reviews/ui/P1-theme-{ink,fantasy,manga,scifi}-{1-top,2-mid,3-bottom}.png`

实测确认的皮肤特征：

| 主题 | 截图可见 |
|---|---|
| 墨 ink | 玄色底 + 竹简竖线底纹（5% 泥金）；叙事卡云纹如意角花 + 朱砂圆点；印章菱形分隔饰；圆角 3；朱砂主按钮 + 宣纸白字 |
| 烛 fantasy | 午夜蓝底；藤蔓角花；卡片**双线内框**；─ ❖ ─ 分隔饰；钢蓝 pip、金/钢蓝双色资源条 |
| 漫 manga | 深色网点纸底 + 纯白漫画格（3px 纯黑描边 + 右下 4px 实色硬投影，双层 View 错位实现）；集中线角标；黑底白字骰面徽章；黄底黑字高亮 chip |
| 梭 scifi | 近黑底 + 六边形网格；HUD 切角卡（16dp 斜切，见下）；青/品红；刻度角框；数值等宽字体 |

**切角是本次唯一需要"和框架对抗"的实现**：RN 无 `clip-path`，先试 `react-native-svg` 绝对定位填充（在 `overflow:hidden` 卡片内**不绘制且吞掉卡片内容**），最终改用纯 View——4 个 45° 旋转方块挖角（边长 `cut×√2`，因旋转正方形覆盖 `|x|+|y| ≤ size/√2`）+ 4 条旋转细线画斜边。像素级验证：卡片顶行填充起点 x=87（卡片左边 45 + 42px = 16dp），随 y 线性收敛到 0，与设计值完全一致。

---

## ③ 三 Tab 导航真机截图

| 文件 | 内容 |
|---|---|
| `P2-tab-library.png` / `-ink.png` / `-manga.png` | 书库 Tab（梭/墨/漫三皮肤），含导入入口、EmptyState、世界卡片 |
| `P2-tab-campaigns.png` / `-ink.png` / `-campaigns-real.png` | 战役 Tab：空态与**真实战役**（camp-mul05qt2-main · active） |
| `P2-tab-profile.png` / `-ink.png` / `-manga.png` | 我的 Tab：四皮肤切换器 + 色板 + 模型表单；切换后整个 App（含 Tab 栏、Stack 头部）即时换肤 |
| `P2-theme-gallery-entry.png` | 「我的」标题长按进入主题自检页（Stack 路由 + 主题化返回 chip） |
| `P2-worlddetail-overview.png` / `-books.png` / `-review.png` | 世界详情四子页签：资料概览、三宝书（含真实技能条目与「原文/归纳/设计补全」来源标注）、审查队列 |
| `P2-play-composer.png` / `P2-play-turn-success.png` | 游玩页：常驻输入框 + 真实回合结算（见第七节） |

---

## ④ `tsc --noEmit` 与 debug 构建结果

```
mobile  : cd mobile && npx tsc --noEmit -p tsconfig.json     → exit 0（无输出）
root    : npx tsc --noEmit -p tsconfig.json                  → exit 0
tests   : npm test                                           → 152 passed / 0 failed
bundle  : npx react-native bundle --platform android --dev false → OK（1.75 MB）
```

**APK 构建：`BUILD SUCCESSFUL`，但 `npm run apk:debug` 脚本以非 0 退出**，两处原因都记在这里：

1. **OOM（已修复）**：首次尝试 `java.lang.OutOfMemoryError: Java heap space`，发生在 `ApkFlinger` 写包阶段。原因是 debug 包的 `.so` 体积翻倍后 2 GB 堆不够 → `gradle.properties` 提到 4 GB，之后 57 秒构建成功。
2. **脚本后置校验在沙箱内失败（环境问题，非代码问题）**：`build-apk.js` 用 `spawnSync(cmd.exe, …)` 调 `aapt`/`apksigner`，在沙箱里报 `spawnSync C:\Windows\system32\cmd.exe EBUSY`（gradle 本身已成功并产出 APK）。手工用同一份 `aapt` 核验通过：`package: name='com.shineword.app' versionCode='10' versionName='0.2.0-p2.9'`，与 `app/build.gradle` 完全一致。

### 包体积：**不达标，需要决策**

| | 体积 |
|---|---|
| baseline debug APK（`dist/apk/debug/ShineWord-V0.2.0-p2.8-debug.apk`） | **68.01 MB** |
| 现状 debug APK | **91.74 MB** |
| 增量 | **+23.73 MB（+34.9%）** |

验收清单要求「APK 增量 ≤ +3 MB（对比当前 debug 基线）」。**这个口径下无法达成**，且与实现无关，构成如下（解压后字节）：

| 项 | 每 ABI | ×2 ABI |
|---|---|---|
| `libreact_codegen_rnscreens.so`（react-native-screens Fabric codegen） | +3.70 MB | +7.45 MB |
| `libreact_codegen_rnsvg.so`（react-native-svg Fabric codegen） | +2.26 MB | +4.52 MB |
| `librnscreens.so` | +0.33 MB | +0.66 MB |
| `libappmodules.so`（聚合上述 codegen 后增大） | +3.87 MB | +7.76 MB |
| dex / resources（导航 + lucide + 两个库的 Java 侧，debug 未压缩未混淆） | — | +6.6 MB |

即：**约 20.4 MB / 23.7 MB 来自两个白名单原生依赖在 debug 下的未 strip Fabric codegen 库**。方案 §4 的 ≈ +2 MB 预算是 release 口径（混淆 + strip + 单 ABI），与 §7 的"对比 debug 基线"口径自相矛盾。可选处置（需拍板，我未擅自执行）：

- **A（推荐，零改动）**：把验收口径改成 release APK 单 ABI（`arm64-v8a`）对比，此时增量进入 MB 级；
- **B**：`reactNativeArchitectures` 只留 `arm64-v8a`，debug 增量降到 ≈ +10 MB（代价：x86_64 模拟器需单独出包）；
- **C**：接受 debug 口径超标，release 另行测量。

其余验收项实测通过：正文对比度（四皮肤全部 ≥ 5.26:1，唯一低于 4.5 的 `墨·朱砂当文字` 已由 `accentText` 修掉）、触控目标 ≥ 44dp（紧凑控件用 hitSlop 补足，不改视觉高度）、所有 Pressable 有按压缩放反馈。

---

## ⑤ 数据可达性核查

`docs/reviews/ui/data-availability.md` —— 角色卡所需字段 × 现状 × 获取方式，28 项逐条对照。

结论：**玩家卡与同伴卡在 P4 可以立刻全量渲染**（20 项已曝光字段）；5 项半曝光（仅玩家或仅主队）；5 项需只读扩展（练习点 / 能力冷却 / 关系 / 知识来源 / 任务进度）；**唯一硬缺口是 NPC·生物的「公开投影」**——`getSummary()` 会把非队友角色降级成一张空壳卡（属性全 1、技能空、`templateId` 与 `combatBehavior` 丢失），而 `templateId` 是回到世界包取公开条目的唯一钥匙。文档给出 A/B/C 三条路线并推荐 B（新增 `getNpcPublicProjection()`，完全不动 `getSummary()`，P2 验收用例零影响）。

关键发现：绝大多数"缺口"其实是**桥接层投影不足**而非数据缺失——`CampaignSummary.state` 已是完整 `GameStateSnapshot`，练习点/关系/知识来源/任务进度全都随 summary 到达 mobile 侧，只是没投影进 `CampaignPlayState`。因此扩展全部是"新增只读函数"，无需动 schema、更无需动写路径。

---

## ⑥ 方案偏差清单

与 `UI_REDESIGN_PLAN.md` 冲突或需要说明的实现选择，全部列出：

| # | 方案原文 | 实际实现 | 理由 |
|---|---|---|---|
| 1 | §3.2 ④ 梭：HUD 切角卡（`clipPath`） | 纯 View 挖角（旋转正方形 + 斜边细线），非真实裁剪 | RN 无 `clip-path`；`react-native-svg` 绝对定位填充在 `overflow:hidden` 卡内不会绘制、且会吞掉卡片内容（已在真机复现）。现方案几何精确（16dp 收敛到 0 已像素验证），且在 `behindColor` 不匹配时只会"退回方角"，不会渲染异常 |
| 2 | §3.2 ① 墨：`accent` 直接用于文字 | 新增 `accentText` token：墨=泥金 `#C9A063` | 朱砂 `#C8442F` 当文字放在玄色上只有 **3.91:1**，低于 §4 的正文 4.5:1 底线。改为"朱砂描边 + 泥金文字"，视觉仍是印章感 |
| 3 | 原型：漫画 white-on-`#FF4757` 主按钮 | 漫画 `onAccent` 用 `#111111`（5.66:1） | 原型白字对比度只有 **3.34:1**；Neubrutalism 里黑字同样惯用，且与 3px 黑描边自洽 |
| 4 | §3.2 ③ 漫：chip 高亮 = 黄底黑字 | 一致（`chip.hotBackground = #FACC15`） | 与原型一致，仅墨/烛/梭的 hot 态由"accent 描边 + `accentText` 文字"实现 |
| 5 | 原型：chip 视觉高度约 34dp | 视觉高度不变，用 `hitSlop` 补到 44dp 触控面 | §4 要求触控 ≥ 44dp，§7 要求视觉忠于原型——两者用 hitSlop 同时满足，不牺牲任一方 |
| 6 | §2：世界详情子页签「资料 / 三本书 / 审查 / 世界包管理」 | 命名「资料 / 三宝书 / 审查 / 世界包」，且"资料"为新增的轻量概览页 | "资料"原方案无对应既有屏；本轮把它做成只读概览（版本、规则、关联战役、创建战役入口），不重排任何既有内容 |
| 7 | §6 P2：「原样搬迁，不重排页面内部布局」 | 遵守；但做了三处必要的最小改动 | (a) 每屏根容器换成 `ScreenShell`（主题底色 + 安全区，原来的 RN `SafeAreaView` 在 Android 上不生效）；(b) 每屏头部换成主题化 `Header`（否则 Tab 栏换肤而页面不换，割裂）；(c) 两处空列表从裸 `<Text>` 换成 `EmptyState`（§1 问题清单明确要求空状态）。列表内容、字段、顺序、交互全部未动 |
| 8 | §6 P2：「删除 useState 手动导航」 | 已删除；但保留"无 profile 则只渲染首启表单"的门禁 | 没有端点的 App 无任何可用功能，若直接挂导航器会进入一个全空的 Tab 壳 |
| 9 | §4 依赖白名单 | 严格照单引入 6 个包，未引入 vector-icons 字体 / lottie / reanimated | 动画只用内置 `Pressable` 按压反馈（缩放 + 透明度），符合"P4 前用内置 Animated API 足够" |
| 10 | §3.4 不打包中文字体 | 遵守；`font` 用 `Platform.select` 在 iOS 上落到 Georgia/System/Menlo | 只是给 iOS 一个真实存在的**系统**字族名，仍然零字体文件 |
| 11 | §7 验收：APK 增量 ≤ +3 MB | **未达标**（+23.73 MB，debug 口径） | 见 ④，需要口径决策 |
| 12 | 方案未提及 | `MainActivity.super.onCreate(null)`、`gradle.properties` 堆 2G→4G、`tsconfig` include `*.tsx`、`app/build.gradle` 版本号对齐 package.json | 分别是 react-native-screens 官方要求、打包 OOM 修复、类型检查覆盖（不改 include 的话新组件完全不参与检查）、构建脚本版本门禁要求 |

---

## ⑦ 接管后补充：规则域缺陷修复 + 真实 LLM 端到端实测

用户提供测试凭据（智谱 `GLM-5.3-Flash` @ `open.bigmodel.cn/api/coding/paas/v4`）与真书《白篱梦》后，我用真机跑了完整链路，并据此定位并修复了 4 类规则域缺陷（commit `8aab4a3`，5 项新增回归测试，全量 152/152 通过）。

### 复现出的问题链

1. 首次导入（2.4KB 测试小说）时映射阶段报 `Network request failed` → 写入 `review_issues(mapping-failed, severity=blocking)`；
2. 用户按提示重试，**映射这次成功了**，但发布门禁扫描到"仍 open 的 blocking 问题"→ 拒绝发布，报错文案却是"映射失败：未生成任何世界包"——描述的是**已经不成立**的旧状态；
3. UI 的审查队列确实能列出该问题（可"按事实解决/豁免"），但"重新构建续建"这条正路走不通，且文案误导；
4. 同时发现 4 条技能提案被拒（`unknown powerTier mundane`）——**模型的 `mundane` 是 `ordinary` 的同义词**，提示词的 schema 行写的是 `"powerTier":string`、Rules 段又只枚举了 attribute/op/provenance，于是模型自由发挥、映射层硬拒，**小说里剑术/轻功/巡山警戒等核心技能全部从三宝书里消失**；
5. 另有主角 NPC 模板被拒（`hp/defense must be a positive number`）——模型把数字写成了字符串。

### 修复

| 缺陷 | 修复 |
|---|---|
| 陈旧阻断永久挡路 | 构建发现条件已消失时主动退役上一轮通知：映射成功→退役 `mapping-failed`；重新推导拒绝项前→退役 `invalid-proposal-*`；本轮无冲突事实→退役 `canon-conflict`。新增 `resolveReviewIssuesByPrefix()` |
| "已豁免"永久解除门禁（**门禁完整性**） | `saveReviewIssue` 的 upsert 原来只刷新 `detail_json`；改为 `status='open', resolved_at=NULL` 并刷新 kind/severity——"记录问题"的语义就是"此刻成立"，否则一次人工豁免会让后续同样失败**静默放行降级包** |
| 枚举同义词被硬拒 | 提示词显式枚举 `powerTier`，映射层新增同义词归一（中英双语：mundane/凡俗→ordinary、heroic/精英→enhanced、超凡/divine→supernatural；attribute 同样处理），真正未知的值仍然拒绝并进审查队列 |
| 数字字符串被硬拒 | `asFiniteNumber` 接受数字字符串；缺失值仍然拒绝（本地代码绝不为原著 NPC 编造战斗数值，这是设计意图，保留） |

### 真机验证（同一台模拟器、真实 GLM）

- 重跑构建：`构建完成 · 第一章 雨夜客栈：4 章 · 实体 10 · 事实 16 · 三宝书 r1（续建完成）· 待审核 1 项` —— **从 5 条问题降到 1 条，并且成功发布**；
- 查库确认：`mapping-failed` 与 4 条 `invalid-proposal-skill-*` 全部 `status=resolved`，`world_packages` 出现 `r1/published`；
- 被救回的技能进了玩家手册：`剑术 (Swordsmanship)`（来源·原文）、`轻功 (Lightness Skill)`（来源·归纳，描述里还带出"一阵风"的绰号）、`巡山警戒 (Mountain Patrol)`（来源·原文）；
- 开局向导真实读取世界包：原著事件锚点「序1·暮色抵达黑风客栈」、地点「黑风客栈」、技能池含被救回的条目；
- 创建战役 `camp-mul05qt2` 成功，游玩一回合 —— **`turn-0001 · success`**，状态推进到 `v1 · 黑风客栈 · 世界钟 5 分`，叙事文本完全贴合原著与玩家行动（截图 `P2-play-turn-success.png`）。

### 顺带发现（未在本轮改动，已记录）

- 构建失败后世界条目不会自动出现在书库（需重启）——**已修**：`LibraryScreen` / `CampaignsScreen` / `WorldDetailReview` 改为 `useFocusEffect` 聚焦刷新；
- 世界详情的"创建战役"目前会带上下文进入向导，但向导创建成功后用 `replace('Play')` 替换自身，返回栈只剩 `[Tabs, Play]`，因此从游玩页返回落到 Tab 壳而不是世界详情。是否符合预期需产品确认（P3/P4 可调整为 `[Tabs, WorldDetail, Play]`）；
- 本机模拟器（16KB page AVD）存在 `input tap` 时序错位：连续点击时前一击可能落在下一屏，自动化验证必须以 `uiautomator dump` 逐步核对（本文档所有坐标结论均由 dump 得出）。

---

## 下一步建议

1. **先定 APK 体积口径**（④ 的 A/B/C），否则 §7 验收无法收口；
2. P3 拆屏时把 `legacyStyles.ts` 逐屏替换为 token 样式（当前是刻意的过渡态）；
3. P4 开工前回答 `data-availability.md` §4 的 4 个待决问题，尤其 NPC 公开投影选 A/B/C；
4. 世界构建的可用性还有两处值得跟：审查队列的"按事实解决"目前不触发重新映射（解决后仍需手动重跑构建），以及 `mapping` 阶段的网络失败缺少重试/退避。
