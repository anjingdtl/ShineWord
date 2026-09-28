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