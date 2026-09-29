# R7 设备实测进度（2026-09-29，进行中）

> 本文档记录第三期收尾 r7 轮的**截至当前时刻**的实测进度。本轮从复验报告 [LOCAL_REACCEPTANCE_2026-09-29.md](LOCAL_REACCEPTANCE_2026-09-29.md) 出发，在隔离模拟器上执行真实设备旅程。任务尚未全部完成，剩余项见 §8；最终逐项判定以收尾版报告为准。

## 0. 基线与环境

| 项 | 值 |
|---|---|
| 源码基线 | `main@2e445657165458470cf8aaf205b0685ebfb89875`（复验基线一致，无漂移） |
| 版本 | `0.3.0-progressive.2` / versionCode 16 |
| 隔离设备 | 新建 `ShineQA` AVD（手工 config.ini，共享只读 android-37.1 google_apis_playstore_ps16k/x86_64 镜像；独立数据目录，未触碰用户 `Medium_Phone`） |
| 设备元数据 | `emulator-5554` · Android 17 (API 37) · 420dpi · 1080×2400 · x86_64 |
| 工具链 | JDK 17.0.19 (Temurin) · Android SDK build-tools 36.0.0 · Gradle wrapper 9.3.1 · WHPX 加速可用 |
| 用户修改 | `.workbuddy/memory/2026-09-28.md` 原样保留；未 reset/clean/wipe 任何设备 |

## 1. 本轮代码修复（缺陷 → 修复 → 回归）

### A1（复验报告 P2）TextField placeholder 对比度

- **缺陷**：`TextField.tsx` 输入框内部背景恒为 `bg.overlay`，但 placeholder 颜色随宿主 tone 取 `text.muted`（tone="base" 时），墨/漫/梭三主题实测 4.45 / 3.36 / 4.29:1，低于 4.5:1。
- **修复**：输入框内部文字（placeholder 与密码显隐图标）统一改用 `onRaised.secondary`（"输入框在 overlay 上用 on-raised 坡道"），宿主 label/hint 仍按 tone 区分。实测四主题 5.80 / 7.64 / 7.32 / 5.51:1，全部 ≥4.5:1。

### A2（复验报告 P2）队伍条可视数值

- **缺陷**：`PartyStrip.tsx` HP/体力仅有两条色条，数值只在 accessibilityLabel。
- **修复**：每条资源条右侧渲染 `current/max` 微字号数值（`resourceValue()`），文字色 `text.secondary`（四主题 6.46～9.48:1）。设备实测游玩页队伍条显示 `10/10 10/10`。

### A3（复验报告 P2）NPC 卡旧错误残留

- **缺陷**：`NpcCharacterSheet.tsx` 的 effect 切换角色时只重置 loading，旧 error 持续遮蔽新角色成功结果。
- **修复**：effect 起始即 `setError(null); setNpc(null);`，保留 `cancelled` 晚回包取消护栏（旧响应不落状态）。

### D1（本轮新发现，P2）密码显隐触控面不足

- **发现**：设备 a11y bounds 实测显隐按钮可视 ≈18dp（47×48px@420dpi），加原 hitSlop 8×2 后有效 ≈34dp < 44dp。F1 旧报告"34+16=50"把 18dp 视觉误当 34dp。
- **修复**：hitSlop 改为 `ceil((touch.min − 18) / 2)`=13dp，有效 ≈44.3dp，仍在输入框行内不越界。

### D2（本轮新发现，P3）世界主题提示文案错误

- **发现**：世界覆盖生效后，WorldDetail 提示行"全局皮肤仍是「X」"显示的是覆盖主题而非全局（ThemeScope 内 `themeId` 已被覆盖）。设备实测：覆盖=梭时提示行也显示梭，但书库实际仍为墨。
- **修复**：ThemeContext 新增 `globalThemeId`（provider 原值，ThemeScope spread 透传），提示行改读全局值。

### D3（本轮新发现，P1·阻断开局）无锚点世界开局死路

- **发现**：设备实测 novel-small（无原著锚点事件）开局向导"缺少场景条目，无法创建战役"。根因：`evidenceVisible` 对无锚点查询要求 `fact.revealAt === null`，而 `compileProgressiveOpeningPackage` 写入的四条开局 facts 全带 `revealAt:'1'` → scene 条目与 canon 地点全部被过滤 → `getWorldSetup().locations` 为空。核心测试只覆盖锚点=1 路径（`tests/progressive-opening.test.cjs` 的 anchor worldTimeOrder:1），从未测无锚点查询。
- **修复**：开局 facts 的 `revealAt` 改为 `null`（开局事实即世界起点状态；`scope:'opening'` 已界定范围；gm-only/validFrom 门控不受影响；包 manifest 哈希不含 world facts，已发布包语义不变）。
- **回归**：新增测试 `anchor-less world setup still exposes the compiled opening location and lore (r7 D3)`——编译后用 `CampaignSession.getWorldSetup`（无锚点）断言 `locations` 含 `opening-location` 且开局 lore 可见。
- **兼容性说明**：修复只影响新导入；修复前导入的世界（含本轮早期一次失败导入）需重新导入。因历史 Release 从未成功发布过开局包，无真实用户世界受影响。

## 2. 工程回归（全部命令实测）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 核心验证 | `npm run verify:core` | **PASS 227/227**（226 基线 + 1 新增 D3 回归；0 fail / 0 skip） |
| 移动端类型 | `npm run typecheck --prefix mobile` | **PASS**（exit 0） |
| 对比度审计 | `node docs/reviews/final-closeout/contrast-check.cjs` | **PASS：96 项 text/large 0 失败 + 4 项组件配对断言全过** |
| Debug APK | `npm run apk:debug --prefix mobile` | PASS（exit 0） |
| Release APK | `npm run apk:release --prefix mobile` | PASS（exit 0；构建脚本自校验预期证书/单签名者/v2/zipalign） |

**contrast-check.cjs 重写**（本轮重点）：不再使用手写 token 镜像，改为**运行时解析 `mobile/src/ui/theme/tokens.ts` 真实字面值**（token 改动即失败）；新增组件实际配对断言层——TextField placeholder 必须绑定 `onRaised.secondary`、禁止绑定宿主 muted；PartyStrip 必须渲染可视数值；NpcCharacterSheet 必须在角色切换时重置 error/npc 且保留 cancelled 护栏。新增 guard 配对 `text.muted / bg.overlay`（A1 旧配对，禁止用于文字）。

## 3. 真实 LLM 连通性（脱敏）

- 配置来源：`C:\Users\anjin\Desktop\Ai工作坊\Test-API\GLM-TEST-KEY.txt`（供应方 智谱；端点 `https://open.bigmodel.cn/api/coding/paas/v4`；模型 `GLM-5.3-Flash`；密钥仅内存读取，未入命令行/日志/Git/报告）。
- 最小探测：`max_tokens=32` → 200/1163ms/**empty_completion**（推理消耗全部预算，复现 FINAL_AUDIT 历史现象）；`max_tokens=512` → 200/13.8s/正文"连通"；`max_tokens=2048` → 200/2.4s/正文"连通"。
- 宿主侧用应用自身 `dist/` 管线复现 dossier 提取（novel-small 前 830 码点）：一次 provider_failure（见下），复跑成功（1 次物理请求、40.6s、输出 2221 token 其中 1964 推理）。**教训**：设备侧 dossier provider 限 `maxPhysicalRequests:1`，禁用了 provider 内 reasoning-only 自动重试（预算 1.5×增长）——模型方差下开局成功率受损，已登记为剩余问题 R-4。
- **事故披露**：一次 UI 自动化中密钥误入模型字段并出现在一次 dump 里（`7d27a6…` 片段已在本会话记录中出现）。建议**轮换该测试密钥**。

## 4. APK 元数据

| 构建 | 路径 | SHA-256 | 大小 | ABI | 说明 |
|---|---|---|---|---|---|
| Debug r7 | `dist/apk/debug/ShineWord-V0.3.0-progressive.2-debug.apk` | `64648acb…c49601c` | 91.76 MB | arm64-v8a+x86_64 | **不含 JS bundle（debuggableVariants 依赖 Metro），独立安装必 RedBox**——复验报告"构建≠可运行"实证 |
| Release r7-1 | 同名 release（D3 修复前） | `81965f7f…2f57bcb8` | 44.84 MB | arm64-v8a+x86_64 | 单签名者（CN=TAVO MINI）、v2、zipalign；内嵌 Hermes bundle |
| Release r7-2（当前设备运行） | 同名 release（含 A1–A3/D1–D3 全部修复） | `b7d48b97…5a6d69b` | 47,013,814 B | arm64-v8a+x86_64 | 同上；**多 ABI 口径**，不可记作 arm64 单 ABI 体积 |

冷启动实测（Release r7-2，无需 Metro）：首次 657ms；强停后重启 252ms；进程重建 1035ms。断网冷启动专项待做（见 §8）。

## 5. 设备旅程进度（§29 对照，Release r7-2 实测）

### P3 已通过

- **首启 + Profile**：首启表单（端点/模型/密钥）→ 保存 → 书架；密钥只入 Keychain（保存后表单清空，dump 不回显）。
- **Profile 重启持久化**：强停 + 冷启动直达书架（不回首启）。
- **TXT 导入（真实 SAF）**：documentsui 选 Downloads/novel-small.txt → 流式本地导入（4 章 4 块）→ "只向模型提交小说开头 830 个码点" → 真实 LLM dossier → 引文校验 → 本地编译 → 发布 partial r1。
- **Library / WorldDetail**：世界卡（已发布·r1）、资料/三宝书/审查/世界包四页签、构建状态、三宝书三态（未发现≠不存在）、本地查书入口。
- **三宝书 + 编辑模式警示**："▲ ⚠ 世界编辑模式…可能包含主持人秘密" + 草稿/不可变版本语义。
- **Review Queue**：空态正确（"映射过程中记录的冲突会出现在这里"）。
- **世界主题覆盖**：选择梭 → "当前生效：未来科技 · 梭（世界覆盖）"，书库仍为墨（D2 文案修复后全局提示正确）。
- **Opening 四步**：Step1 地点选择（黑风客栈，来自真实 dossier locationName）；**返回后选择保留**（重进向导 opening-location 仍选中）；Step2 原创/原著切换（原著空态正确）、姓名、六属性自由点 4/4、技能三选；Step3 同伴（QA 世界：两名可选 + **validFromOrder=10 未来同伴被正确排除**）；Step4 汇总 + **重复点击防护**（快速双击仅创建 1 条战役）。
- **创建战役**：camp-mum31lkb-main；向导不留在返回栈。

### P4 已通过

- **无骰自动成功回合**：行动 "Carefully observe…" → 拟定检定 → 叙事（中文武侠风，贴合开篇）42s，v0→v1。
- **规划器提案门控 + 安全回退（×2）**：提案 stealth（未训练，不允许无训练尝试）→ "回合已安全回退（未消耗任何检定）"；提案 perception（世界不存在该技能）→ 同样安全回退。ActionContract 拒绝路径实证。
- **有骰回合（遭遇）**：QA 世界发起遭遇 → 先攻条/距离带/当前行动者 → 同伴守卫甲攻击 **1d8:[8] full_success**（含指令判定依据文案）→ 团丁 NPC 回合对游医乙造成伤害（3/5）。**射程规则**：跨距离带 touch 攻击被拒（"mid range; a touch attack cannot reach it"，回合回退）。
- **移动/疾行**：疾行→well（消耗主要行动）后回合轮转；快捷行动"移动到 well"填入 composer 待提交。
- **NPC 回合**：蒙面团丁（自动）经"推进自动角色行动"推进，先攻完整循环 游医乙→蒙面团丁→同行守卫甲→第2轮。
- **强停恢复**：force-stop + 冷启动 → 战役页恢复 → 重进游玩页，v3 + 叙事历史完整。
- **短休/长休**：短休 子时二刻→子时四刻（v3→v4）；长休 →辰时四刻（→v5）。时钟以"时+刻"精确显示。
- **rewind**：从 v4 创建新分支 `camp-mum31lkb-bmum3sdgv`，原分支与历史完整保留（"共 2 条分支"）。
- **存档导出/导入**：导出 `.shineword-save.json`（37,425 B）到 Downloads → 经 SAF 导入为独立战役 `camp-mum3uihz` → 打开后 v5/回合历史/原分支 ID 完整恢复。
- **角色卡**：队伍条点击 → 玩家卡（资源 10/10、六维与开局一致、防御 2、原创标记）；Sheet Back 关闭不退页。
- **五信息面板**：角色/队伍/任务/物品/知识 全遍历（空态文案正确；队伍页 1 人含你 + 招募提示）。
- **游戏菜单 Sheet**：Back 先关 Sheet（游玩页保留）；遮罩/✕ 可关；无双重退出。
- **1 玩家 + 2 同伴 + Directive**：QA 世界开局选 同行守卫甲（支援）+ 游医乙（保护），确认页同伴带指令；遭遇中队伍条 3 人。
- **合成 QA 世界包导入**：`导入世界包`（SAF）→ "已导入世界包「QA 合成世界 GM 与未来标记」r1…独立世界"。
- **GM-only 不泄漏（部分）**：gm 可见性的 藏书阁守卫 模板**未出现在遭遇模板列表**；未来同伴未出现在开局同伴页。三宝书玩家/编辑视图的 GM 密藏（QA-SECRET-MARKER-01）核验与 NPC 卡投影核验进行中（见 §8）。

### 视觉证据

`docs/reviews/final-closeout/screens-r7/`（全部为合成 QA 内容或不含小说原文的界面，**可入库**）：
r7-01 书库空态(墨) · r7-02 书库世界就绪(墨) · r7-03 WorldDetail 资料(墨) · r7-04/06 三宝书与编辑警示 · r7-05 世界包页 · r7-07 审查队列 · r7-08 世界主题覆盖(梭) · r7-09 覆盖后书库仍为墨(视觉复核) · r7-10 Opening Step1(墨) · r7-11 Step2 角色 · r7-12 Step4 确认 · r7-13 游玩页初始(墨，A2 数值可见) · r7-14 回合1 · r7-15 回合2 · r7-16 休息后 · r7-17 玩家卡 · r7-18 信息面板 · r7-19 游玩页四主题(fantasy/ink/manga/scifi，scifi 经视觉模型确认青色 HUD/输入框/行动按钮) · r7-20 QA 世界 Step4 两同伴 · r7-21 QA 队伍+遭遇HUD · r7-22 遭遇第2轮。

## 6. 真实 Progressive 可玩（§六，进行中）

- **已完成**：novel-small（合成短篇）真实 TXT→LLM dossier→publish r1→Opening→Campaign→**第一回合 committed**（叙事 42s）→ 强停恢复 → 后续多回合（v1→v5）→ rewind 分支 → 存档往返。
- **早期一次开局失败**：首次导入 dossier 阶段失败（设备 provider maxPhysicalRequests=1 + 模型方差），应用记录脱敏 errorCode 后由后台构建重试成功发布 r1——失败→自动恢复路径实证；失败阶段码在 DB 安全度量中（Release 不可 run-as，未读出）。
- TTFP 样本（机器段）：dossier ≈30s（第二次导入成功样本）；导入→向导可用 ≈31s。样本数不足，不宣称 P50/P95。
- **待做**：《白篱梦》（3.07MB）与《凡人修仙传》（22.5MB）真实小说全链路 + ≥10 回合 + 生命周期/fencing/TTFP 记录。私人小说截图将只存仓库外。

## 7. 中期判定（截至本文档）

| 总问题 | 当前状态 |
|---|---|
| 第三期 P3/P4 是否通过 | **进行中**——P3 矩阵全部实测通过；P4 已覆盖约 2/3（缺：rescue、撤退实测、训练、GM 密藏三宝书/NPC 卡终验、键盘遮挡像素级、100 TurnView、44dp 边缘点击、四主题 Opening Step2/4 与角色卡/Encounter 全套截图） |
| Progressive 真实可玩是否通过 | **进行中**——合成短篇全链路 + 首回合 + 多回合 + 恢复已通；**真实两部小说未开始**，≥10 回合未做 |
| 兼容/发布是否通过 | **未通过（尚缺）**——签名/安装/zipalign/多 ABI 已证；断网冷启动、API24、Android15/16、升级兼容未做 |

## 8. 剩余工作清单

1. P4 收尾：rescue（需先制造成同伴失能）、撤退实测、训练/练习点 UI、三宝书玩家视图无 QA-SECRET-MARKER-01（GM 视图有）、NPC 卡（蒙面团丁/守门人）投影核验、快速切换 NPC（A3 晚回包路径）。
2. 视觉/交互：键盘弹出像素级、Safe Area、100 TurnView 长列表、compact SegmentedControl 与 icon-only 控件 bounds+边缘点击（≥44dp）、四主题 Opening Step2/4 与三类角色卡/Encounter/任务知识面板截图补全。
3. §六 真实小说：白篱梦全链路 + 凡人修仙传导入开局 + ≥10 回合 + TTFP 逐次记录 + 后台/锁屏/强停/晚回包 fencing。
4. Narrator 故障恢复专项：断网提交 → 恢复重试 → RollRecord 不重掷验证。
5. 兼容：Release 断网冷启动、API24/Android15/16 模拟器矩阵（实际探测或记录真实尝试证据）、旧版升级（install -r）数据保留验证。
6. R-4（登记）：设备 dossier provider `maxPhysicalRequests:1` 禁用 reasoning-only 重试，建议评估放宽至 2（主 1+重试 1，修复请求仍另计）以提升开局成功率——需按"有证据调参"原则决策。
7. 建议轮换测试密钥（§3 事故披露）。

## 9. 不可变语义合规

本轮全部改动未触碰：规则域写路径、骰点算法、成长阈值、ActionContract/RollRecord 语义、`applicationId`、数据库名、存档 schema、既有世界包内容。D3 修复仅改开局 facts 的 `revealAt` 写入值（新导入生效），已附回归测试与兼容性说明。
