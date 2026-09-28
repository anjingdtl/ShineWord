# P3 阶段 Review（P3.1 – P3.7）

> 方案：`docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md` §5–§12
> 分支：`feature/phase3-ui-gameplay`
> 说明：本任务约束本轮**不运行** core tests / mobile typecheck / APK 构建 / 模拟器与真机测试，
> 因此本文所有验证结论均为**静态源码审查**结果；未执行的验证项逐条标注为「待线下开发机验证」。

---

## P3.1 品牌地基 + 缺失基础组件

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 品牌层（新增） | `mobile/src/ui/brand/brand.ts` | `PRODUCT_NAME = 'Shine-TRPG'`、`PRODUCT_TAGLINE`、`BRAND_COLORS`、`useBrandPalette()`；品牌色仅在此处与 `theme/tokens.ts` 出现 |
| 品牌层（新增） | `mobile/src/ui/brand/BrandMark.tsx` | D20 六边形 + 内三角 + "S" 故事路径，48 单位几何固定，仅颜色随皮肤适配 |
| 品牌层（新增） | `mobile/src/ui/brand/BrandWordmark.tsx` | 产品名使用主题字阶，文本常量取自 `PRODUCT_NAME` |
| 品牌层（新增） | `mobile/src/ui/brand/BrandLockup.tsx` | 标记 + 字标 + 标语组合（column = 启动页 / row = 页内） |
| 品牌层（新增） | `mobile/src/ui/brand/index.ts` | 导出面 |
| 基础组件（新增） | `components/TextField.tsx` | normal / focus / disabled / error / secure / multiline / placeholder / 主题适配；错误态带 ⚠ 图形提示，非纯颜色表达 |
| 基础组件（新增） | `components/SegmentedControl.tsx` | 世界详情 Tab / 角色类型 / 三宝书 Tab / 面板 Tab 通用；选中态同时有强调底色 + 下划线 |
| 基础组件（新增） | `components/StatusBanner.tsx` | info / success / warning / error 四态，各带图形 + 左侧色条 |
| 基础组件（新增） | `components/SectionHeader.tsx` | 统一章节标题节奏 |
| 基础组件（新增） | `components/ProgressSteps.tsx` | Opening 分步向导用（1 起点 → 2 角色 → 3 同伴 → 4 确认），完成步显示 ✓ |
| 组件导出 | `components/index.ts` | 新增五个组件与 `ScreenShell` 的导出 |
| 启动页 | `mobile/App.tsx` | 打开发首页改为 `BrandLockup` + 「正在载入世界…」；无假进度条 |
| Android 品牌 | `android/app/src/main/res/values/strings.xml` | `app_name` = `Shine-TRPG` |
| Android 图标 | `drawable/ic_launcher_foreground.xml`、`mipmap-anydpi-v26/ic_launcher.xml`、`ic_launcher_round.xml`、`values/colors.xml` | 矢量前景 + Adaptive Icon（API 26+） |
| Android 图标（API 24/25 回退） | `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher[_round].png` | minSdk 24 需要真实位图；由 `scripts/gen-brand-icons.py`（纯标准库）从同一几何生成，10 张共约 30KB |
| Android 12 启动 | `values-v31/styles.xml` | `windowSplashScreenBackground` / `windowSplashScreenAnimatedIcon` |
| Android 清单 | `AndroidManifest.xml` | `android:icon` / `android:roundIcon` 指向正式图标 |
| Debug 门禁 | `navigation/AppNavigator.tsx`、`screens/ProfileScreen.tsx` | ThemeGallery 仅 `__DEV__` 注册与可达，Release 不暴露 |
| 品牌文案 | `README.md` | 标题、产品名、描述统一 Shine-TRPG；内部兼容标识保留并注明 |

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | `BrandMark` 初版路径把 "S" 画成了 "C"（双弧缺少中间对角连接） | **已修复**：改为「上弧 + 对角连接 + 下弧」，并同步 `ic_launcher_foreground.xml` 与 PNG 生成器；重新生成 10 张位图并逐档目视确认 48px 仍可辨识 |
| 2 | `TextField` 使用了 RN 0.85 已废弃的 `blurOnSubmit` | **已修复**：改用 `submitBehavior`（单行默认 `blurAndSubmit`，多行默认 `newline`） |
| 3 | 品牌层曾加入方案清单之外的 `BrandGlyph` 备选组件 | **已移除**：品牌层严格保持方案 §3.4 规定的 4 个文件 + index |
| 4 | ThemeGallery 仅在 Release 无入口，但路由仍可被程序化访问 | **已修复**：路由注册与入口同时 `__DEV__` 门禁 |
| 5 | `ProfileScreen` 仍使用本地 `legacyInput` 与旧品牌文案（About / FirstRun） | **登记为 P3.4 范围**，不在本阶段处理（方案 §9） |
| 6 | `mobile/app.json`、`NativeModules.ShineWordFiles`、`shineword.*` storage key、Ornament `patternId` | **保留**：均为兼容性/内部标识（方案 §3.6），非用户可见品牌 |

新增文件固定使用主题 Token 与组件，未引入新依赖（图标全部为矢量或本地生成位图，无字体包）。

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| Android 桌面名称显示 Shine-TRPG | **未验证**（需安装 APK） |
| 启动页品牌视觉 / Launcher Icon 48dp 与 Adaptive 表现 | **未验证**（需真机或模拟器） |
| 新基础组件四主题视觉抽查 | **未验证**（需截图） |
| CJK 字体未打包 | 静态确认未新增字体依赖，**打包级验证未运行** |
| Release 构建中 ThemeGallery 不可见 | **未验证**（需 Release APK） |

### P3.1 出口对照（方案 §6.5）

| 出口条件 | 状态 |
|---|---|
| Android 桌面名称显示 Shine-TRPG | 源码就绪，**待设备验证** |
| 启动页出现统一品牌 | 源码就绪，**待设备验证** |
| About 不再新增旧名称 | 本阶段未新增；About 旧文案在 P3.4 清理 |
| 新基础组件四主题通过 | **待截图验证** |
| 无 CJK 字体 | 未新增字体依赖（静态），**待打包验证** |
| typecheck PASS | **未运行** |
| debug build PASS | **未运行** |

> 结论：P3.1 源码实现完成，静态审查问题全部关闭；所有运行期/构建期验证项均**未执行**，
> 不得据此判定通过，需在线下开发机补齐。

---

## P3.2 书库 Library 产品化

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 只读数据补充 | `mobile/src/worldImport.ts` | `WorldLibraryEntry` 增加 `packageRevision`（最新**已发布** revision）与 `openReviewIssues`（待审核数），全部来自既有只读查询 `worldStore.listWorldPackages()` / `listReviewIssues()`；未新增写路径、未改 schema |
| 页面组件（新增） | `features/library/ImportNovelCard.tsx` | 「＋ 导入小说 TXT / 构建人物、事件、规则与三宝书」+ 世界包导入 |
| 页面组件（新增） | `features/library/BuildStatusCard.tsx` | 构建任务卡：真实 phase / message / 文本块进度 / 章节·实体·事实·revision·待审核数；失败时给续建提示 |
| 页面组件（新增） | `features/library/WorldCard.tsx` | 世界卡：标题、`已发布 · r{n}` 或真实构建状态、更新时间、[开始冒险/继续冒险] + [世界详情] +（有真实待审核时）待审核 chip |
| 页面组件（新增） | `features/library/WorldList.tsx` | 世界列表 + 空态 |
| 页面重写 | `screens/LibraryScreen.tsx` | 只做数据装配与路由；数据流与 P2 完全一致（同样的 bridge 调用与 focus 刷新） |
| 组件微调 | `components/Button.tsx` | `secondary` 变体改用 `bg.overlay` 填充，使次级按钮在 raised 卡片上仍有可见面 |

`LibraryScreen` 已**不再 import `legacyStyles`**，页面内无 `styles.secondary/card/...` 旧样式。

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | `WorldCard` 初版导出了仅本文件使用的 `worldStatusLine` | **已修复**：收回为模块内部函数 |
| 2 | 次级按钮（`bg.raised` 填充）放在 raised 卡片上只剩细边框，可辨识度不足 | **已修复**：`secondary` 改为 `bg.overlay` 填充（token 驱动，四主题一致） |
| 3 | 旧书库把「审核队列」入口常驻在每张世界卡上，与方案 §7.2 卡片层级不符 | **已修复**：仅当 `openReviewIssues > 0` 时显示「待审核 n」 |
| 4 | 未发布三宝书的世界点「开始冒险」必然失败（`createCampaign` 要求已发布 revision） | **已修复**：按真实能力置灰，并在卡片正文说明「再次导入同一文件可继续构建三宝书」 |
| 5 | 展示 revision 需要新查询 | **采用只读复用**：`listWorldPackages` + `listReviewIssues`，无新增写路径、无 schema 变更 |
| 6 | 方案 §7.4 禁止假造章节数/进度百分比/质量分 | 已核对：进度条仅在 `chunksTotal` 真实存在时渲染，其余数字全部来自 `BuiltWorldSummary` |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| Library 四主题截图 | **未截图** |
| Library 空态 / 构建中 / 构建失败 / 已发布 关键状态截图 | **未截图** |
| 导入 TXT、导入世界包的真机流程 | **未验证** |

### P3.2 出口对照（方案 §7.5）

| 出口条件 | 状态 |
|---|---|
| Library 不再 import `legacyStyles` | 满足（静态确认） |
| 不再直接使用旧 `styles.secondary/card/...` | 满足（静态确认） |
| 世界卡信息层级清晰 | 源码就绪，**待截图验证** |
| 空态一致 | 源码就绪（统一 `EmptyState`），**待截图验证** |
| 四主题截图通过 | **未执行** |

---

## P3.3 战役 Campaigns 产品化

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 页面组件（新增） | `features/campaigns/BranchBadge.tsx` | 「主线 / 分支」角色徽记 + 真实 branchId + stateVersion |
| 页面组件（新增） | `features/campaigns/BranchList.tsx` | 分支树：主线优先，分支显示父分支与创建日期，每行独立「继续冒险 / 继续」 |
| 页面组件（新增） | `features/campaigns/CampaignCard.tsx` | 战役卡：标题、真实状态、创建日期、分支数量、分支树 |
| 页面组件（新增） | `features/campaigns/ImportSaveAction.tsx` | 存档导入入口与说明（`.shineword-save.json`，旧版兼容） |
| 页面重写 | `screens/CampaignsScreen.tsx` | 数据装配与路由；不再把分支摊平成独立战役行；不再 import `legacyStyles` |
| 复用清理 | `screens/CampaignsScreen.tsx` | 删除文件内私有的 UTF-8 解码实现，改用 `textDecode.decodeUtf8`（同一逻辑去重） |

`BranchList` 通过 `mainBranchIdOf(campaignId)` 复用规则域既有的 `${campaignId}-main` 约定判断主线，不新增分支命名规则。

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | `BranchList` 初版用嵌套三元构造 `ordered`，主分支缺失时逻辑难验证 | **已修复**：改为「`-main` 命中优先，否则取最早一条」的显式写法 |
| 2 | 旧战役页把「一个分支 = 一张战役卡」，多分支时战役身份丢失 | **已修复**：战役卡聚合，分支以树形呈现并标注父分支 |
| 3 | 旧页面内的 `decodeUtf8` 与 `textDecode.decodeUtf8` 重复（且原实现有掩码缺省问题） | **已修复**：统一使用桥接层 `decodeUtf8` |
| 4 | 方案 §8.3 要求「不为了丰富卡片新增数据库字段」 | 已核对：卡片仅使用 `campaigns` / `branches` 表的既有字段（title/status/createdAt/branchId/parentBranchId/stateVersion） |
| 5 | 需保证「点击继续进入正确分支」 | 每行按钮以该行 `branchId` 直接导航 `Play`，不做默认分支推断 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| Campaigns 四主题截图 | **未截图** |
| 空态 / 导入成功 / 导入失败状态截图 | **未截图** |
| 多分支（rewind 产生 b*）在真机的区分与进入正确分支 | **未验证** |
| 存档导入真机流程（含旧 `.shineword-save.json`） | **未验证** |

### P3.3 出口对照（方案 §8.3）

| 出口条件 | 状态 |
|---|---|
| Campaigns 不使用 `legacyStyles` | 满足（静态确认） |
| 多 branch 可清楚区分 | 源码就绪，**待截图验证** |
| 空态 / 导入存档 / 错误态完整 | 源码就绪，**待截图验证** |
| 点击继续仍进入正确 branch | 逻辑静态确认，**待真机验证** |

---

## P3.4 Profile / First Run / 品牌入口

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 表单状态（迁移） | `features/profile/useProfileForm.ts` | 从 `ProfileScreen.tsx` 原样迁出；持久化路径未改（`saveApiProfile` + `KeychainSecretStore`，密钥不回显） |
| 页面组件（新增） | `features/profile/ProfileFormCard.tsx` | 模型与密钥卡：端点 / 模型 / API Key 全部改用 `TextField`（含 secure 与 hint）；成功与失败使用 `StatusBanner` |
| 页面组件（新增） | `features/profile/ThemeSkinCard.tsx` | 主题皮肤产品化：四个可选皮肤瓷砖，各自展示名称、氛围与色板；选中态有 ✓ 与加粗（非纯颜色表达） |
| 页面组件（新增） | `features/profile/AboutCard.tsx` | 使用 `PRODUCT_NAME = Shine-TRPG`，并说明保留的兼容性内部标识 |
| 页面重写 | `screens/ProfileScreen.tsx` | 「我的」= 皮肤 / 模型与密钥 / 关于 三层；删除本地 `legacyInput` 样式对象 |
| 首次启动 | `screens/ProfileScreen.tsx` | `FirstRunScreen` 改为品牌锁定组合（BrandLockup）+「配置你的 AI 模型」+ 同一表单 |

品牌入口：`BrandLockup` 与 `AboutCard` 都只读 `brand.ts` 常量，界面中不再出现 `ShineWord` 字样。

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 旧实现用本地 `legacyInput`（原始 `TextInput` + 硬编码圆角/内边距），无 focus/error/disabled 状态 | **已修复**：三处输入全部替换为 `TextField`（normal/focus/disabled/error/secure/placeholder 齐备） |
| 2 | 主题选择只有一个 chips 行，看不出各皮肤差别 | **已修复**：改为瓷砖（名称 + 氛围 + 色板），仍使用同一 `setThemeId` 持久化路径 |
| 3 | 旧 About / FirstRun 标题仍写 `ShineWord` | **已修复**：统一 `PRODUCT_NAME`；旧品牌字样在 `mobile/src/ui` 中已清零（`mobile/app.json`、原生模块名等内部标识按方案 §3.6 保留） |
| 4 | 主题皮肤卡原有的「入口在后续阶段接入」提示已过时（世界主题入口在 P3.5 落地） | 文案已更新为指向「世界详情 → 资料」，P3.5 完成后此处不再需要改动 |
| 5 | 首启保存行为 | 未改动：仍由 `AppRoot` 依据 `profile` 是否存在切换导航，保存端点逻辑与 P2 完全一致 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| 首次启动品牌页与保存流程（真机） | **未验证** |
| Profile 四主题截图 | **未截图** |
| 表单 disabled / error / secure 状态截图 | **未截图** |

### P3.4 出口对照（方案 §9.2）

| 出口条件 | 状态 |
|---|---|
| Profile / FirstRun 零旧品牌 | 静态确认（`mobile/src/ui` 内 `ShineWord` 仅剩注释类内部标识，已逐条核对） |
| 无 legacy input | 满足（静态确认，`legacyInput` 已删除） |
| 品牌一致 | 源码就绪，**待截图验证** |
| 保存端点行为不变 | 静态确认（hook 逻辑逐行对照 P2 版本） |

---

## P3.5 世界详情 WorldDetail 产品化

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 主题能力（新增） | `theme/ThemeContext.tsx` `ThemeScope` | 把子树钉在指定皮肤上（只覆盖 `theme`/`themeId`，不写全局偏好），使 P1 起就存在的 `worldId → themeId` 覆盖**真正生效** |
| 页面组件（新增） | `features/world-detail/WorldOverviewPanel.tsx` | 资料页：世界名、已发布 revision、规则版本、构建状态、关联战役/分支、待审核数、[创建战役] |
| 页面组件（新增） | `features/world-detail/WorldThemeOverrideCard.tsx` | 世界主题：跟随全局 / 墨 / 烛 / 漫 / 梭，复用既有写入路径 |
| 页面组件（新增） | `features/world-detail/WorldBooksPanel.tsx` | 三宝书：玩家视图 / 编辑模式二分切换 + 三本书 Tab + 条目阅读 |
| 页面组件（新增） | `features/world-detail/WorldBooksEditor.tsx` | 编辑模式：条目选择、`TextField multiline` JSON、可见性 `SegmentedControl`、差异面板、发布风险提示、草稿/验证/发布动作 |
| 页面组件（新增） | `features/world-detail/ReviewPanel.tsx`、`ReviewIssueCard.tsx` | 审查页改为 Review Issue Card：严重级别 + 可读摘要 + 处理动作；原始 JSON 折叠在「技术详情」 |
| 页面组件（新增） | `features/world-detail/WorldPackagePanel.tsx` | 世界包：当前版本、content hash 摘要、规则版本、导出、说明不含小说原文 |
| 页面重写 | `screens/WorldDetailScreen.tsx` | 四 Tab 使用 `SegmentedControl`，整页包在 `ThemeScope` 中 |
| 文件迁移/删除 | `screens/WorldDetailBooks.tsx`、`WorldDetailReview.tsx`、`screens/worldPackageExport.ts` | 逻辑迁入 `features/world-detail`；旧文件删除，`WorldDetail*` 不再引用 `legacyStyles` |
| 品牌（补做） | `features/world-detail/worldPackageExport.ts`、`screens/PlayScreen.tsx` | 新导出文件名前缀改为 `shine-trpg-*`，兼容扩展名 `.shineword-world.zip` / `.shineword-save.json` 保持不变 |
| 只读补充 | `worldImport.ts` | 新增 `getWorldEntry(worldId)`（复用同一 `toLibraryEntry` 只读映射）；资料页取构建状态与待审核数 |
| 共享助手 | `features/worldStatus.ts` | 世界状态文案统一，书库卡与资料页共用 |

守卫要点：编辑模式与玩家视图是两个互斥模式，编辑模式上方常驻 `⚠ 世界编辑模式` 警告条；玩家视图默认过滤 `gm` 条目并按战役发现集过滤 `discoverable` 条目（`assembleBook` 原有投影规则未改）。

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 世界主题覆盖此前只存储、不生效（P2 注释亦承认「入口在后续阶段接入」） | **已修复**：新增 `ThemeScope`，世界详情整页按该世界有效皮肤渲染；游玩页接入留到 P4（已在 UI 文案中说明） |
| 2 | 编辑模式与玩家视图此前的区别仅是若干 `styles.danger` 文本，模式边界弱 | **已修复**：改为 `SegmentedControl` 二选一 + 常驻警告条 + 发布风险提示，模式切换不可能被忽略 |
| 3 | 审查页主视图直接铺 `detailJson.slice(0,300)` | **已修复**：优先展示 `message/summary/title/reason/detail` 字段的可读摘要，原始 JSON 折叠在「技术详情」 |
| 4 | 旧编辑器用原始 `TextInput` + 硬编码 `placeholderTextColor: '#6f7b86'`（四主题下对比度不成立） | **已修复**：改用 `TextField multiline monospace`，颜色全部来自 Token |
| 5 | 旧编辑器的 status 文案用 `includes('失败')` 判断颜色，无图形提示 | **已修复**：改为 `{tone, message}` 结构化状态 + `StatusBanner`（含图形提示） |
| 6 | 编辑器重置时机：草稿保存后 `entries` 更新会重建 `selectedEntry` 对象，若按对象身份重置会清空状态提示 | **已修复**：重置只依赖 `selectedEntryId`，保存状态不会被自己抹掉 |
| 7 | 导出文件名仍是 `shineword-*` 前缀 | **已修复**：世界包与存档导出改 `shine-trpg-*`；扩展名与导入兼容性不变 |
| 8 | 资料页展示「构建状态」需要世界行数据 | **采用只读复用**：`worldImport.getWorldEntry`，无新增写路径 |
| 9 | `WorldOverviewPanel` 初版残留未使用的 `StyleSheet` 与占位样式 | **已修复**：删除 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| WorldDetail / 三宝书 / 审查 / 世界包 四主题截图 | **未截图** |
| 玩家视图与编辑模式的视觉区分（含 GM 秘密不泄漏） | **未验证**（需真机 + 真实世界包） |
| 世界主题覆盖实际生效（切到某世界看皮肤变化） | **未验证** |
| 草稿保存 / 验证 / 发布新版本的真机流程 | **未验证** |
| 世界包导出文件名前缀 `shine-trpg-*` | **未验证**（需真机导出） |

### P3.5 出口对照（方案 §10.4）

| 出口条件 | 状态 |
|---|---|
| WorldDetail、Books、Review 不再引用 `legacyStyles` | 满足（静态确认，`grep legacyStyles` 仅剩 PlayScreen / OpeningScreen） |
| 四主题均正常 | **待截图验证** |
| 玩家视图 / GM 编辑模式视觉上绝不混淆 | 源码就绪，**待截图验证** |
| 主题覆盖实际生效 | 已实现 `ThemeScope` 接入，**待真机验证** |

---

## P3.6 Opening：真正的新游戏向导

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 向导模型（新增） | `features/opening/openingModel.ts` | 世界投影类型、六属性表、同伴指令表、`FREE_POINT_BUDGET = 4` / `MAX_SKILLS = 3` / `MAX_COMPANIONS = 2`、四步名称 |
| 通用选择卡（新增） | `features/opening/ChoiceCard.tsx` | 卡片式单选：选中 = 强调边框 + ✓ + 加粗（非颜色单通道） |
| 步骤 1（新增） | `features/opening/StepWorldStart.tsx` | 01 世界起点：原著事件锚点卡（含摘要）+ 地点卡；无锚点/无地点时给明确空态与错误态 |
| 步骤 2（新增） | `features/opening/StepCharacter.tsx` | 02 我的角色：原创/原著二分；姓名、自由点剩余、六属性 `AttributePips` + 步进按钮、初始技能（关联属性 / d6 / 无训练尝试） |
| 步骤 3（新增） | `features/opening/StepCompanions.tsx` | 03 同伴：最多 2 名，每名可设 5 种指令；可零同伴开局 |
| 步骤 4（新增） | `features/opening/StepConfirm.tsx` | 04 确认开局：世界 / 起点 / 地点 / 角色 / 属性摘要 / 技能 / 同伴 / 目标 / 世界包 r / 规则版本 / 主题 + `开始冒险` |
| 页面重写 | `screens/OpeningScreen.tsx` | `ProgressSteps` 四步 + 分步门禁 + 底部上一步/下一步；不再 import `legacyStyles` |

业务行为未变：`session.getWorldSetup` 投影、锚点切换后的重投影、`createCampaign` 调用参数逐字保持 P2 版本。

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 原实现用 `☑ / ☐` 文本前缀模拟选择（方案 §11.2 明确禁止） | **已修复**：全部改为 `ChoiceCard` 卡片单选 |
| 2 | 角色名解析写成 `a ?? b \|\| c`，`??` 与 `\|\|` 混用会直接语法错误 | **已修复**：加括号 `a ?? (b \|\| c)`（静态审查发现，未运行编译器） |
| 3 | 初版残留与 `StepWorldStart` 加载态重复的占位 Card 块与未使用导入 | **已修复**：删除重复块，移除 `Card` / `ChoiceCard` / `typeStyle` 未用导入 |
| 4 | 技能卡同时显示 `d6` 文本与 `DieBadge`，信息重复 | **已修复**：保留 `DieBadge`，描述行承载关联属性与无训练标记 |
| 5 | 步骤门禁缺失会导致空数据创建战役 | **已修复**：第 1 步要求锚点与地点有效；第 2 步要求角色有效（原创 ≥1 技能 / 原著已选人物）；第 4 步要求世界包已发布；按此置灰「下一步 / 开始冒险」 |
| 6 | 涉及「Back 回到已创建向导」的导航语义 | **保持并明确**：`replace('Play')` 使向导不留在返回栈；Header Back 仅回退向导步骤 |
| 7 | 原著角色是否可能泄漏 GM / 未来资料 | 已核对：仅使用 `getWorldSetup` 的玩家投影（`canonCharacters` 只有实体与名字），未读取角色卡 GM 字段 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| Opening 四步截图（含四主题） | **未截图** |
| **真机完整创建一场战役**（方案 §11.6 出口） | **未验证** |
| 四步来回切换与门禁（含无技能/无人物等边界） | **未验证** |
| 创建后 Back 不回向导、Play 返回落在战役/世界上下文 | **未验证** |

### P3.6 出口对照（方案 §11.6）

| 出口条件 | 状态 |
|---|---|
| Opening 不使用 `legacyStyles` | 满足（静态确认） |
| 4 步流程可来回 | 源码就绪，**待真机验证** |
| 数据校验仍由原业务逻辑兜底 | 静态确认（`createCampaign` 原样） |
| 不改变 `createCampaign` 规则 | 静态确认（参数与 P2 一致） |
| 真机完整创建一场战役通过 | **未验证** |

---

## P3.7 P3 收口

### legacyStyles 门禁（方案 §12.1）

| 页面 | `legacyStyles` 引用 | 状态 |
|---|---|---|
| Library | 0 | 达标（P3.2） |
| Campaigns | 0 | 达标（P3.3） |
| Profile | 0 | 达标（P3.4） |
| WorldDetail | 0 | 达标（P3.5） |
| Books | 0 | 达标（P3.5，文件已迁入 `features/world-detail`） |
| Review | 0 | 达标（P3.5，文件已迁入 `features/world-detail`） |
| Opening | 0 | 达标（P3.6） |
| Play | 1 | **允许暂留**（P4 删除 `legacyStyles.ts`） |

静态扫描命令与结果：

```bash
grep -rn "from './legacyStyles'" mobile/src   # 仅 PlayScreen.tsx 命中
```

旧硬编码 Hex（`#08141f` / `#d9a441` / `#263a4d` / `#0e2030` / `#f1f5f9`）扫描结果：
仅存在于 `mobile/src/ui/theme/tokens.ts`（合法主题 Token）与 `mobile/src/ui/screens/legacyStyles.ts`（P4 删除目标），
UI Feature 与其余 Screen 中为零。

### 品牌迁移矩阵（方案 §12.2）

**必须消除 —— 用户可见品牌（本期已全部处理）**

| 位置 | 处理结果 |
|---|---|
| Android 桌面 App 名 | `strings.xml` → `Shine-TRPG` |
| 品牌启动页 | `BrandLockup` + 「正在载入世界…」 |
| First Run | 品牌锁定组合 + 「配置你的 AI 模型」 |
| About | `PRODUCT_NAME` = `Shine-TRPG` |
| README 标题与描述 | 改为 `Shine-TRPG`，并注明内部兼容标识不变 |
| Launcher Icon | 矢量前景 + Adaptive Icon + 5 档回退位图 |
| 新增 UI 文案 | 全部使用 `PRODUCT_NAME` / 主题 Token，无旧品牌字面量 |
| 新导出默认文件名前缀 | `shine-trpg-*`（世界包、存档） |

**必须保留 —— 兼容性 / 内部标识（本期未改）**

| 类别 | 现值 | 保留原因 |
|---|---|---|
| GitHub 仓库 | `anjingdtl/ShineWord` | 仓库地址 |
| applicationId / namespace | `com.shineword.app` | 变更会被 Android 视为新应用 |
| SQLite 数据库 | `shineword.db` | 变更需要迁移 |
| 原生模块 | `NativeModules.ShineWordFiles` / `ShineWordCrypto` | 用户无收益，改名会破坏桥接 |
| AsyncStorage key | `shineword.ui.*` | 既有主题偏好必须继续可读 |
| 存档 schema / 扩展名 | `shineword-save-2..5` / `.shineword-save.json` | 旧存档必须继续导入 |
| 世界包扩展名 | `.shineword-world.zip` | 旧世界包必须继续导入 |
| Ruleset id | `shineword-core`（`SHINEWORD_RULESET_ID`） | 规则域冻结 |
| 世界包归档 schema | `shineword-world-archive-1` | 归档格式冻结 |
| ActionContract schema 标题 | `ShineWord Action Contract v1` | 冻结契约 |
| LLM 角色提示词 | `You are ShineWord …` | 属已验证抽取/叙事写路径，改名不影响用户可见品牌，留待独立迁移期 |
| RN 组件注册名 / Gradle 工程名 | `ShineWord`（`app.json`、`settings.gradle`、`MainActivity`） | 内部注册标识 |
| 构建产物名 | `ShineWord-V<version>-<variant>.apk` | 开发机构建产物命名，非应用内导出 |
| npm 包名 / 包描述 | `shineword-mobile`、核心包 description | 内部元数据 |
| 测试与文档 | `tests/**`、`docs/**` 历史报告 | 不属用户界面，保持历史可追溯 |

> 用户可见界面中 `ShineWord` 品牌字面量：**0**（`mobile/src/ui` + `mobile/App.tsx` 静态核对）。

### 版本（方案 §33）

| 项 | 变更 |
|---|---|
| `mobile/package.json` version | `0.2.0-p2.9` → `0.3.0-p3` |
| `build.gradle` versionName | `0.3.0-p3` |
| `build.gradle` versionCode | `10` → `11`（下一次真实 APK 发布使用） |

### 本阶段文件变更总览（P3.1 – P3.7）

- 新增品牌层：`mobile/src/ui/brand/**`（5 文件）+ Android 图标资源（12 文件）。
- 新增基础组件：`TextField`、`SegmentedControl`、`StatusBanner`、`SectionHeader`、`ProgressSteps`。
- 新增 Feature 目录：`features/library`、`features/campaigns`、`features/profile`、`features/world-detail`、`features/opening`、`features/worldStatus.ts`。
- 重写 Screen：Library / Campaigns / Profile / WorldDetail / Opening。
- 删除：`screens/WorldDetailBooks.tsx`、`screens/WorldDetailReview.tsx`（逻辑迁入 features）。
- 主题能力：`ThemeScope`（世界主题覆盖生效）。
- 只读桥接：`worldImport.getWorldEntry`、`WorldLibraryEntry.packageRevision / openReviewIssues`。
- 生成脚本：`scripts/gen-brand-icons.py`。

### 未执行的验证项（本阶段统一待办）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core`（core 回归，方案基线 152/152） | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| Release APK 与 arm64 包体积 | **未测量** |
| 四主题截图（Library / Campaigns / Profile / WorldDetail / Opening / Play） | **未截图** |
| Opening 四步截图 | **未截图** |
| 方案 §29 P3 真机矩阵（首次启动、Profile 保存、四主题切换、导入 TXT、Library、WorldDetail、三宝书、Review Queue、世界主题覆盖、Opening 4 步、创建战役） | **未执行** |

### 已知偏差与说明

1. **验证类 DoD 未勾选**：本轮的测试、typecheck、APK、模拟器/真机项全部未执行，相关 DoD 项保持未勾选。
2. **品牌范围**：LLM 提示词、npm 包名/描述、构建产物名仍是历史名称（见上方「必须保留」表）；方案 §3.5 未要求，且改动提示词会影响已验证的抽取/叙事行为，故不在本期。
3. **`Play` 页面仍引用 `legacyStyles`**：方案明确允许暂留，P4 收口删除。
4. **世界主题覆盖生效范围**：世界详情页已生效；游玩页待 P4 接入 `ThemeScope`（已在 UI 文案中向用户说明）。
5. **`SegmentedControl` 采用「选中底色 + 下划线 + 加粗」三重提示**，与原型仅用底色略有增强，属可访问性要求（§30 禁止仅靠颜色表达状态）。
6. **`Button secondary` 填充色由 `bg.raised` 调整为 `bg.overlay`**，以保证次级按钮在 raised 卡片上的可辨识度；四主题均由 Token 派生，无新增字面量。

### P3 Definition of Done 对照（方案 §36）

| DoD 项 | 状态 |
|---|---|
| 用户可见产品品牌统一为 Shine-TRPG | ✅ 静态确认（用户界面 0 处旧品牌） |
| Android launcher label 为 Shine-TRPG | ✅ 源码就绪 / **待安装验证** |
| 品牌启动页完成 | ✅ 源码就绪 / **待设备验证** |
| 正式 App Icon 完成 | ✅ 资源就绪（矢量 + Adaptive + 位图回退）/ **待安装验证** |
| FirstRun 品牌完成 | ✅ 源码就绪 / **待设备验证** |
| About 品牌完成 | ✅ 源码就绪 |
| README 品牌完成 | ✅ |
| 新导出默认文件名前缀使用 `shine-trpg-` | ✅ 源码就绪 / **待真机导出验证** |
| 兼容性 `.shineword-*` 扩展名仍可读 | ✅ 未改动导入路径（静态）/ **待旧存档真机验证** |
| Library 零 legacyStyles | ✅ |
| Campaigns 零 legacyStyles | ✅ |
| Profile 零 legacyStyles | ✅ |
| WorldDetail 零 legacyStyles | ✅ |
| Books 零 legacyStyles | ✅ |
| Review 零 legacyStyles | ✅ |
| Opening 零 legacyStyles | ✅ |
| Opening 改成 4 步向导 | ✅ 源码就绪 / **待真机验证** |
| 世界级主题覆盖有正式入口 | ✅ 入口 + `ThemeScope` 生效 / **待真机验证** |
| 四主题视觉通过 | ⬜ **未截图，待验证** |
| typecheck PASS | ⬜ **未运行** |
| core regression PASS | ⬜ **未运行** |
| Android APK PASS | ⬜ **未运行** |
| P3 Review/Fix 关闭 | ✅ 本文件各阶段 Review/Fix 已逐项关闭（除运行期验证项） |

> P3 结论：**源码实现与静态审查完成**；所有构建、测试、截图与设备验收项均未执行，
> 不得判定 P3 已通过，需在具备 Android 环境的线下开发机补齐后再进入 P3 出口判定。