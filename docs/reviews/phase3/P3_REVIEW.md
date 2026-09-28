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