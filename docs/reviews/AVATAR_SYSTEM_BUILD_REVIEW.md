# 玩家头像系统建设与验收报告

> 实施日期：2026-10-05 · 基线：`76654f5`（方案基线 242b0f9 之上、含 agent prompt 文档提交）
> 合同文档：[docs/AVATAR_SYSTEM_UI_PLAN.md](../AVATAR_SYSTEM_UI_PLAN.md)
> 结论：**40 瓦片素材 + 注册表/状态/选择器 + 游玩页常驻头像全部落地；自动化三项全绿；模拟器 8 项手检 8 过 0 未验**。版本升至 `0.9.0`（versionCode 90000）。

---

## 1. 建成内容（对应方案 §4–§7）

### 1.1 素材管线

- 新增 `tools/avatars/split_avatar_sheets.py`（Pillow 一次性脚本，App 构建不依赖）：均匀 5×2 网格、每边内缩 8px、LANCZOS 320×320、WebP q88；留 `--png` 后备开关。
- 分隔线实测（四图逐张）：线带位于 x≈393–401 / 791–797 / 1187–1193 / 1585–1589、y≈391–400，均在均匀网格边界 ±4px 内；8px 内缩完全覆盖（最宽线带 日系 col1 395–401 vs 内缩后左格右缘 388.6 / 右格左缘 404.6），**无需按图单独修偏移**。
- 产出 `mobile/src/assets/avatars/{theme}_{m|f}_{slot}.webp` 共 40 个，**合计 1,266 KB**（单张 20–33 KB，低于预估 34–41 KB，总量 ≈1.24 MB 在预期 ≈1.5 MB 内；WebP 体积随画面复杂度浮动，无需回查）。
- **裁切抽查（通过）**：40 格全量拼接对照图 + 两张对角格（ink_m_1 / scifi_f_5）原分辨率复检——无分隔线残影、无邻格内容混入、人物主体完整；职业气质与附录 A 一一对应（侠客/弓手/谋士/刺客/雅士 · 骑士/游侠/法师/盗贼/牧师 · 武士/游侠/法师/忍者/神官 · 佣兵/技师/骇客/浪人/医师）。
  - 证据：`evidence/avatar/crop-montage-all40.png`（40 格，红条为拼图分隔非素材）、`evidence/avatar/crop-corner-fullres.png`。

### 1.2 新增模块（`mobile/src/ui/features/avatar/`）

| 文件 | 要点 |
|---|---|
| `avatarRegistry.ts` | `AvatarPreset` 模型 + `AVATAR_THEME_LABEL` / `AVATAR_ROLES` + **40 条字面量 require**（Metro 无运行时拼路径）+ `findAvatar` 防御查找；排序 = THEME_ORDER → 男/女 → 槽位 |
| `AvatarContext.tsx` | 逐行照抄 ThemeContext 成熟模式：键 `shineword.ui.avatar.v1`、useEffect hydration + `hydratedRef` 防 hydration 前回写、读失败/非法值归一化 `null`、`setAvatarId` fire-and-forget（清空走 `removeItem`）、Provider 外回退默认值不抛错；**未动 ThemeContext** |
| `AvatarCard.tsx` | 克隆 ThemeSkinCard 结构：Card + SectionHeader + SegmentedControl 四段页签（序 = THEME_ORDER、初始 = 当前皮肤题材、不随换肤联动）+ 男女各 5 个 56dp 圆形瓦片（cover + overflow hidden + radius.pill）+ 选中态 `accent.primary` 描边（hairline+1）+ 右下角 `space.lg` ✓ 角标（双通道）+「不使用头像（默认字牌）」caption 单选行；瓦片 radio 语义 + `（当前）` 后缀 |
| `index.ts` | barrel 导出 |

### 1.3 最小挂载编辑（3 个文件）

- `mobile/App.tsx`：+1 import、`AvatarProvider` 包于 `ThemeProvider` 内。
- `mobile/src/ui/screens/ProfileScreen.tsx`：副标题改「模型端点 · 密钥 · 头像 · 主题皮肤 · 关于」；`<AvatarCard />` 插于 ThemeSkinCard 与 ProfileFormCard 之间。
- `mobile/src/ui/features/play/PlayHeader.tsx`：actions 槽世界时钟与「☰ 信息」之间插入 32dp（space.xxl）圆形头像——容器描边 `accent.primary`、radius.pill、overflow hidden、内图 100%×100% cover；`accessible` + label「玩家头像：{label}」+ `testID="play-avatar"`；非交互；未设置时不渲染（零布局影响）。PlayScreen 零改动。

### 1.4 不触碰清单核验

根 `src/`、`tests/`、`schemas/`、`migrations/`、`tokens.ts`、`ThemeContext.tsx`、`navigationTheme.ts`、PartyStrip、PlayScreen 及其它一切屏幕与功能组件：**零改动**（git diff 仅含 §1.3 三文件 + 版本号文件）；无新增 npm 依赖（Pillow 仅开发机）；源合图未复制进仓库、未提交。

---

## 2. 自动化验证（全绿）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `npm --prefix mobile run typecheck` | 零错误（首次实现即零错误；require 路径修正后复跑仍零错误） | 0 |
| `npm run verify:core`（根） | typecheck + **922 项测试全绿**（`922 pass / 0 fail`）——核心零影响 | 0 |
| `npm run apk:debug` | 首次构建 **失败**（Metro 无法解析 require 路径，见 §5 偏差 1），修正后 **BUILD SUCCESSFUL in 46s** | 1 → 0 |

### APK 体积与哈希

| 项 | 值 |
|---|---|
| 产物 | `dist/apk/debug/ShineWord-V0.9.0-debug.apk` |
| 体积 | **103,248,137 字节**（基线 V0.8.1-debug = 101,916,493 字节） |
| 增量 | **+1,331,644 字节 ≈ +1.27 MB**（≈ 素材实际总量 1,266 KB + 打包对齐开销，符合 ≈+1.5 MB 预期） |
| SHA-256 | `ef97c07472cdf26631036e0eb4f5325d7b87ce4e41f1d3745bee1bd22631d29a` |
| 包信息（aapt badging） | `name='com.shineword.app' versionCode='90000' versionName='0.9.0'`，ABI arm64-v8a + x86_64 |

---

## 3. 模拟器手检（emulator-5554 / AVD Medium_Phone，debug 包 0.9.0）

> 环境事实：设备原库为旧开发库，触发 0.8.x 既有的「需要新的开发数据基线」门禁（与本改造无关）；按应用自带入口换用新数据库文件，**旧 `shineword.db`、API 配置（Keychain）与系统密钥全部保留**（截图 `01`/`20` 可见 API 配置完好）。为在不消耗 LLM 预算的前提下到达游玩页，战役由离线 Node harness（同 `installBaselineSchema` 基线）构建后 `run-as` 注入（详见 §5 偏差 3），战役「头像验收战役」/ 主角罗兰·温布顿。

| # | 检查项 | 结果 | 证据（`docs/reviews/evidence/avatar/`） |
|---|---|---|---|
| ① | 首次进「我的」头像默认未设置；四题材页签可切换、各 10 头像男女各 5 | **PASS** | `02-profile-default.png`（默认字牌+墨题材 10 瓦片）、`03-tab-scifi.png`；uiautomator 计数 fantasy/manga/scifi 各 10（见 §4） |
| ② | 选 `ink-m-1` → 杀进程重启仍选中；游玩页时钟与 ☰ 之间 32dp 圆形头像、testID=play-avatar | **PASS** | `04-ink-m1-selected.png`（描边+✓）、`05-restart-persist.png`/`05b-profile-after-restart.png`（force-stop 后仍选中）、`08-playheader-avatar.png`；dump 命中 `play-avatar` ×1、`content-desc="玩家头像：东方武侠 · 男 · 侠客"` |
| ③ | 皮肤墨→烛→漫→梭：容器描边/角标随皮肤变，头像本体不变 | **PASS** | `08`（墨·朱砂）、`10-play-fantasy.png`（烛·金）、`11-play-manga.png`（漫·红且 hairline+1=3 加粗）、`12-play-scifi.png`（梭·青）；角标同证：`04`（金✓）vs `17`（品红✓）；四图头像本体均为同一 ink 侠客 |
| ④ | 进入配置了其它皮肤的世界（ThemeScope）：头像仍显示且不随世界换肤 | **PASS** | `15-world-ink-theme.png`（世界覆盖=墨，全局仍梭）、`16-play-worldscope.png`（游玩页呈墨皮·时辰钟「子时五刻」，头像仍为所选 ink 侠客；对照 `12` 全局梭时 T+000:00:00 青色描边） |
| ⑤ | 点「不使用头像」→ 游玩页头像消失回退现状布局 | **PASS** | `17-picker-none.png`（✓ 回到未设置行）、`18-play-no-avatar.png`（头部仅时钟+☰，布局与改造前一致） |
| ⑥ | 注入非法 avatar 值 → 重启归一化为未设置且不崩溃 | **PASS** | 经 `run-as` 向 AsyncStorage（Room 库 `AsyncStorage` 表 `Storage`）写入 `shineword.ui.avatar.v1='bogus-avatar-404'` 后重启：`19-invalid-normalized.png` 显示「当前：默认字牌（未设置）」、无崩溃（logcat crash 缓冲与 FATAL 检索均空）；其余偏好（梭皮肤、worldTheme）完好 |
| ⑦ | 回归：主题皮肤卡、模型表单、游玩流程、☰ 菜单、队伍条与改造前逐屏一致 | **PASS**（队伍条见 §5 偏差 4） | 皮肤卡 `02`/`17`/`19` 对照改造前 `docs/reviews/closeout/screens/theme-*-profile.png`（布局一致，唯一差异 = 新增玩家头像卡）；模型表单 `20-profile-form.png`；游玩流程 `08`–`12`/`16`/`18`/`23`；☰ 菜单 `21-play-menu.png`（休息与存档/回退/战役信息/游戏信息齐全，且战役信息「主题：中国古典·墨」再次佐证 ④） |
| ⑧ | uiautomator 确认瓦片 radio 语义与 label 完整 | **PASS** | `uiautomator-avatar-radio.xml`：`avatar-option-ink-{m,f}-{1..5}` + `avatar-option-none` 共 11 个 `android.widget.RadioButton`，label 如「东方武侠 · 男 · 侠客」、选中项 `selected="true"` 且 label 缀「（当前）」（皮肤卡 4 个 radio 同 dump 可见，总计 15）；页签 `avatar-theme-tabs.{ink,fantasy,manga,scifi}` |

补充：⑥ 存储手术后再次选择 ink-m-1 成功（写入路径完好），最终游玩页头像恢复显示——`23-final-play-avatar.png`。

---

## 4. uiautomator 语义抽样（手检 ⑧ 明细）

```
class="android.widget.RadioButton"  ×15（avatar 11 + theme-skin 4）
  selected="true" → 「主题 中国古典 · 墨（当前）」「不使用头像（默认字牌）（当前）」
  label 样本 → 「东方武侠 · 男 · 侠客」「东方武侠 · 女 · 侠客」
testID → avatar-option-ink-m-1 … avatar-option-ink-f-5、avatar-option-none
       → avatar-theme-tabs.ink / .fantasy / .manga / .scifi
```

游玩页：`content-desc="玩家头像：东方武侠 · 男 · 侠客"`、testID `play-avatar` 命中 1 次。

---

## 5. 与方案的偏差及理由

1. **require 相对路径 `../../` → `../../../`**：方案 §4 代码段的 `require('../../assets/avatars/…')` 是按注册表位于 `features/` 深度假定的；实际文件在 `features/avatar/` 下，到 `mobile/src/assets/` 需三层。首次 apk 构建被 Metro 以 `Unable to resolve module` 拒绝（留证：构建日志），修正为 `../../../assets/avatars/…` 后构建通过。文件命名、40 条目结构与方案完全一致。
2. **「恢复默认」按钮未单独实现**：方案 §6.1 ASCII 示意图右侧画有 `[恢复默认]`，但其规格正文只定义「网格下方一行 caption 按钮『不使用头像（默认字牌）』，选中它 = setAvatarId(null)」。按规格正文实现为单行 radio（ASCII 示意图为装饰性描绘），功能等价。
3. **游玩页验收战役的构建方式**：未走「导入小说→LLM 构建→开局」全流程（避免消耗 LLM 预算与非确定因素），改用与核心测试同源的 Node harness 离线建库（同 `installBaselineSchema` 基线）+ `run-as` 注入 `databases/shineword-baseline-*.db`。应用侧 全部走真实代码路径（书库/战役列表/游玩页）；被替换的是本次门禁新建的空基线库，旧 `shineword.db` 未动。注入脚本在仓库外（`.tmp/avatar-qa/build-qa-db.cjs`，不入库）。
4. **手检 ⑦ 队伍条**：QA 战役为「故事还没开始」空回合态，投影无成员 → PartyStrip 不渲染（既有行为，`PartyStrip`/`PlayScreen` 零改动可由 git diff 佐证）。带成员的队伍条需真实 LLM 回合才能出现，本环境未复现实拍；判定依据 = 组件零改动 + 游玩页其余区域逐屏一致。如实标注为「组件未触碰、带成员形态未实拍」。
5. **设备门禁处理**：设备上既有旧开发库触发 0.8.x 的基线门禁（与本改造无关）。按应用自带「创建新的开发数据库」入口换库——该路径设计上保留旧库文件、API 配置与 Keychain（截图 `01`、`20` 佐证），不属于清档。

## 6. 未验项与遗留

- **模拟器项：无未验**（8/8 执行，其中队伍条带成员形态按 §5.4 口径判定）。
- Release 通道：本轮仅构建 debug（任务范围）；release 构建与签名验收未执行。
- 真机（arm64）实机走查未执行（模拟器为 x86_64 镜像；WebP 在 minSdk 24+ 由 Fresco 原生解码，无平台差异风险）。
- 方案 §6.3 明确不做项（PartyStrip 字牌替换、首启头像步骤、头像入存档/LLM 上下文等）维持范围外。

## 7. 提交清单（白名单）

1. `feat(avatar): split sheets and add 40 webp presets` — `tools/avatars/split_avatar_sheets.py`、`mobile/src/assets/avatars/*.webp`（40）
2. `feat(avatar): avatar registry, context and picker card` — `mobile/src/ui/features/avatar/{avatarRegistry.ts,AvatarContext.tsx,AvatarCard.tsx,index.ts}`、`mobile/App.tsx`、`mobile/src/ui/screens/ProfileScreen.tsx`
3. `feat(avatar): play header avatar display` — `mobile/src/ui/features/play/PlayHeader.tsx`
4. `docs(avatar): build review and evidence` — 本报告 + `docs/reviews/evidence/avatar/*`
5. `chore(release): 0.9.0` — 根/移动 `package.json`、`package-lock.json`、`build.gradle`、`version.json`、`CHANGELOG.md`、`README.md`（`npm run verify:version` 门禁通过）

未跟踪保留：`.workbuddy/`（任务前即存在，不动）。
