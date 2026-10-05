# ShineWord 玩家头像系统：施工与测试 Agent 提示词

配套方案：`docs/AVATAR_SYSTEM_UI_PLAN.md`（基线提交 `242b0f9`）。在能访问本仓库、素材源目录 `C:\Users\Administrator\Pictures\png`、Android 工具链与本地模拟器的 agent 中使用；无法读取 Windows 本地素材时不得伪造资源，应停下报告。

复制以下整段作为施工指令：

```text
请在本地仓库 F:\ClaudeWorkSpace\projects\ShineWord 完成玩家头像系统的实际实现、测试与取证交付，不要只改文档或输出计划。

一、基线和工作方式
先读取仓库适用的 AGENTS.md（如存在）与 docs/AVATAR_SYSTEM_UI_PLAN.md——该方案是本轮建设合同，所有命名、结构、尺寸、testID、存储键以方案为准，本文与方案冲突时以方案为准。方案基线为 242b0f9，实施以实际本地 HEAD 与工作区为准，不 reset 到旧 SHA；开工先记录 git status 与 HEAD，保留工作区已有修改与未跟踪文件（.workbuddy/ 等），不清空设备、数据库与用户存档。按阶段推进：实现→自审→修复→回归→取证→阶段提交；提交只含本任务白名单文件，不自动 push、开 PR、合并或发布。持续完成已授权施工，不逐步询问常规实现与测试许可；只有遇到确实缺失的必要配置、不可逆用户数据变更或方案范围外的操作时才停下说明并请求输入。

二、改动边界（硬约束，违反即返工）
只允许：① 新增 tools/avatars/split_avatar_sheets.py；② 新增 mobile/src/assets/avatars/*.webp 共 40 个；③ 新增 mobile/src/ui/features/avatar/ 下 avatarRegistry.ts、AvatarContext.tsx、AvatarCard.tsx、index.ts 四个文件；④ 最小挂载编辑 mobile/App.tsx（+2 行挂 AvatarProvider 于 ThemeProvider 内）、mobile/src/ui/screens/ProfileScreen.tsx（插入 <AvatarCard /> 于 ThemeSkinCard 与 ProfileFormCard 之间，副标题加「头像」）、mobile/src/ui/features/play/PlayHeader.tsx（actions 槽插入头像，约 +14 行）；⑤ 收尾时 CHANGELOG.md 与版本号（按 docs/VERSIONING.md）。
不得触碰：仓库根 src/、tests/、schemas/、migrations/；mobile/src/ui/theme/tokens.ts 与 ThemeContext.tsx；PartyStrip、PlayScreen 及其它一切屏幕与功能组件；任何既有 testID、AsyncStorage 键、导航路由、存档与 LLM 链路。不新增任何 npm 依赖（Pillow 仅限开发机跑一次性素材脚本）；素材源图（C:\Users\Administrator\Pictures\png 四张合图，共约 12MB）不复制进仓库、不提交。

三、素材管线（方案 §2/§3/附录A）
四张合图均为 1983×793、5 列 × 2 行：上排男（gender=m）、下排女（gender=f），列 = 职业槽位 slot 1..5。题材映射：东方武侠.png→ink、欧洲风格.png→fantasy、日系二次元.png→manga、赛博科幻.png→scifi。脚本按均匀网格裁切、每边内缩 8px（实测分隔线位于 x≈395-400/791-795/1187-1192/1583-1587、y≈394-398），LANCZOS 重采样 320×320，WebP 质量 88，输出 mobile/src/assets/avatars/{theme}_{m|f}_{slot}.webp 共 40 个；预期单张 34-41KB、合计约 1.5MB，明显超出时回查格式与尺寸。裁完必须抽查四角与中间槽位各至少一格，确认无分隔线残影、无邻格内容混入、人物主体完整；发现某张合图网格不均匀时按该图实测线位单独修偏移，不得整批带病通过。

四、实现要点（方案 §4-§6）
1) avatarRegistry.ts：AvatarPreset 模型（id/theme/gender/slot/label/source）+ 40 条字面量 require（Metro 不支持运行时拼路径，禁止动态 require）+ findAvatar；label 与职业名严格按方案附录 A（ink：侠客/弓手/谋士/刺客/雅士；fantasy：骑士/游侠/法师/盗贼/牧师；manga：武士/游侠/法师/忍者/神官；scifi：佣兵/技师/骇客/浪人/医师；label 形如「东方武侠 · 男 · 侠客」）。
2) AvatarContext.tsx：逐行照抄 mobile/src/ui/theme/ThemeContext.tsx:95-168 的成熟模式——AsyncStorage 键 shineword.ui.avatar.v1，useEffect hydration + hydratedRef 防 hydration 前回写，读取失败或值不在注册表归一化为 null，setAvatarId 为 setState + fire-and-forget 写入；Provider 外调用回退默认值而非抛错。不改 ThemeContext。
3) AvatarCard.tsx：结构克隆 ThemeSkinCard（Card + SectionHeader + 瓦片网格 + radio 语义）。题材页签用既有 SegmentedControl 四段、顺序 = THEME_ORDER、初始页签 = 当前皮肤 themeId（仅初始推荐，不随换肤联动）；当前题材下男女两行、各 5 个 56dp 圆形头像瓦片（resizeMode cover、overflow hidden、radius.pill）；选中态 = accent.primary 描边 hairline+1 加右下角 space.lg 尺寸 ✓ 角标（双通道指示，不依赖颜色单一差异）；网格下方「不使用头像（默认字牌）」caption 行，选中它 = setAvatarId(null)。可访问性：瓦片 accessibilityRole="radio"、accessibilityState selected、accessibilityLabel=label+选中缀「（当前）」；testID：瓦片 avatar-option-{id}、未设置项 avatar-option-none、页签容器 avatar-theme-tabs。
4) PlayHeader.tsx：在 actions 槽世界时钟与「☰ 信息」按钮之间插入 32dp（space.xxl）圆形头像，容器描边 accent.primary、圆角 radius.pill、overflow hidden，内部 Image 100%×100% cover；accessible + accessibilityLabel「玩家头像：{label}」+ testID="play-avatar"；非交互。头像由 PlayHeader 自取 useAvatar()+findAvatar()，PlayScreen 零改动；avatar 为 null（未设置）时不渲染、保持现状布局。若模拟器视觉 QA 发现个别头像被圆形裁切损坏主体，按方案 §6.2 允许把该容器改为 radius.lg 圆角方，属最小补救，不得扩大改动面。

五、本地环境事实（已核实，直接使用，不要另查）
Windows + Git Bash；Node ≥24.3、JDK 17。模拟器 emulator-5554（AVD Medium_Phone）通常已在运行，adb 已在 PATH；android-emulator MCP 工具传 serial="emulator-5554" 可做安装/截图/UI 断言（android_screenshot、android_ui_describe、android_install_app 等）。命令门禁：npm --prefix mobile run typecheck；npm run verify:core（根目录）；npm --prefix mobile run apk:debug（内含 prebuild 自动重生成 mobile/src/version.json）。设备缺席不阻塞构建与单测，对应模拟器项如实标注未验。

六、验证与取证（全部执行，逐项留证，方案 §9）
自动化三项必须全绿：typecheck 零错误；verify:core 通过（证明核心零影响）；apk:debug 构建成功并记录 APK 体积增量（预期 ≈+1.5MB）与文件哈希。
装 debug 包到 emulator-5554 后逐项手检并截图：① 首次进「我的」头像默认未设置，四题材页签可切换、各 10 个头像男女各 5；② 选 ink-m-1 后杀进程重启仍选中，游玩页右上角（时钟与 ☰ 之间）出现 32dp 圆形头像且 testID=play-avatar；③ 皮肤墨→烛→漫→梭切换，头像容器描边/角标随皮肤变化而头像本体不变；④ 进入配置了其它皮肤的世界（ThemeScope 生效）头像仍显示不随世界换肤；⑤ 点「不使用头像」游玩页头像消失回退现状布局；⑥ 用 adb shell run-as 注入非法 avatar 值后重启，归一化为未设置且不崩溃；⑦ 回归对比：主题皮肤卡、模型表单、游玩流程、☰ 菜单、队伍条与改造前逐屏一致；⑧ uiautomator dump 确认瓦片 radio 语义与 label 完整。
写 docs/reviews/AVATAR_SYSTEM_BUILD_REVIEW.md：逐项映射方案 §7-§9，记录各命令与退出码、8 项手检的截图路径、APK 哈希与体积、裁切抽查结论、阶段提交列表、以及全部未验项。不得把「文件已存在」「typecheck 通过」冒充模拟器验收；任何手检未执行只能标注未验，不得写成通过。

七、交付与提交
阶段提交建议：feat(avatar): split sheets and add 40 webp presets；feat(avatar): avatar registry, context and picker card；feat(avatar): play header avatar display；docs(avatar): build review and evidence。最后按 docs/VERSIONING.md 更新 CHANGELOG.md 与版本号。收尾报告需说明：建成内容、验证矩阵（绿/未验）、与方案的任何偏差及理由、遗留问题。
```
