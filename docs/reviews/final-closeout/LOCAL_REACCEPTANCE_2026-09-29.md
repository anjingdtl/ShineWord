# 第三期本地独立复验（2026-09-29）

基线：`main@2e445657165458470cf8aaf205b0685ebfb89875`，`0.3.0-progressive.2` / versionCode 16。

结论：**PARTIAL，不能宣布第三期完全通过。** 除设备证据缺口外，本轮静态复核发现尚未关闭的代码缺陷。未修改产品代码，保留原有 `.workbuddy/memory/2026-09-28.md` 修改。

## 本轮已复验

- `npm run verify:core`：PASS，226/226，0 fail、0 skipped。
- `npm run typecheck --prefix mobile`：PASS。
- `npm run apk:debug --prefix mobile`：PASS，91.76 MiB；构建不代表安装/运行通过。
- `npm run apk:release --prefix mobile`：PASS，44.83 MiB；构建脚本确认预期证书、单签名者、v2 签名和 zip alignment。此包配置包含 arm64-v8a 与 x86_64，不能记作 arm64 单 ABI 包体；安装、冷启动和升级仍未测试。
- `node docs/reviews/final-closeout/contrast-check.cjs`：84/84 PASS，但覆盖不完整，见下文。
- `git diff --check`：PASS（产品基线）。
- 未调用真实 LLM，未执行设备 UI 旅程，未查询远端 CI；这些维度不能算本轮 PASS。

本轮 Release：`dist/apk/release/ShineWord-V0.3.0-progressive.2-release.apk`，SHA-256 `0CBB5C96E9D156623043BD7020B23B9ABBF388EB916B5843D99CD003B285E2A1`；aapt2 确认 applicationId `com.shineword.app`、versionCode 16、versionName `0.3.0-progressive.2`、targetSdk 36、ABI `arm64-v8a x86_64`。构建日志在本机 TEMP 下 `shineword-audit-core.log`、`shineword-audit-debug.log`、`shineword-audit-release.log`，未加入 Git。

## 明确未通过项

### A1 / P2：行动输入框占位文字对比度不足

`mobile/src/ui/components/TextField.tsx:83` 按宿主 tone 决定 `hostMuted`，第 113 行将其用于输入框内部 placeholder；输入框实际背景始终为 `theme.bg.overlay`（第 99 行）。`ActionComposer.tsx` 传入 `tone="base"`，因此实际形成 `text.muted / bg.overlay`。

本轮直接转译并读取当前 `tokens.ts`（只替代 Platform.select 为 Android 分支），按相对亮度计算：

| 主题 | 占位文字 | 输入框背景 | 对比度 | 4.5:1 门禁 |
|---|---|---|---:|---|
| 墨 | #8A8A8A | #2A241B | 4.451 | FAIL |
| 烛 | #8EA1B2 | #1A2438 | 5.831 | PASS |
| 漫 | #8A8A93 | #FFFDF5 | 3.360 | FAIL |
| 梭 | #6C8098 | #111A2B | 4.292 | FAIL |

现有 contrast-check 使用手写 token 镜像，未覆盖此真实配对；其中 `guard` 配对也不触发失败。84 项通过不能证明所有组件合规。应将输入框内部文字颜色与宿主 label/hint 颜色分开，并为实际使用组合增加回归。

### A2 / P2：队伍条资源缺少可视数值

`mobile/src/ui/features/play/PartyStrip.tsx:69` 仅在 accessibilityLabel 提供 HP/体力数值；第 108～127 行可视资源区域只有两条色条，之后只显示角色名和状态。方案 §20.1 示例和 §30 明确要求资源条同时显示数值。读屏标签不能替代普通用户可见的数值。

### A3 / P2：NPC 卡读取失败后错误状态不会随角色切换清除

`mobile/src/ui/features/play/character/NpcCharacterSheet.tsx:54` 的 effect 只重置 loading；catch 设置 error，后续成功仅 setNpc/setLoading。第 82 行只要 error 非空就持续显示失败。

可达路径：游戏信息的角色页保持打开 → NPC A 读取失败 → 切换 NPC B → B 读取成功，旧 error 仍使 B 显示失败。`GameInfoPanel` 在切换两个 NPC 时复用同一组件类型且没有 key。此为源码确认的错误状态缺陷，本轮未在设备注入失败复现。应清理请求状态，并验证失败→切换成功、快速切换晚回包两种路径。

## 仍未取得完整通过证据

1. 四主题关键实屏、触控面 44×44dp、键盘/Safe Area、Sheet/Back、100 TurnView 滚动。特别复核 compact SegmentedControl：token 推导父行自然高度约 33～35dp，不能只凭 hitSlop 推算就判触控通过，需实际边缘点击验证。
2. 方案 §29 全部 P3/P4 设备旅程：首启/Profile/导入/世界详情/三宝书/审查/主题覆盖/Opening/战役；普通及有骰回合、恢复、训练、队伍、Encounter、信息面板、NPC 安全、存档与 rewind。
3. 当前版本签名 Release 安装、断网冷启动、升级保留数据和 Release arm64 体积口径。旧版本截图/签名不覆盖本轮代码。
4. 真实小说 TXT→Opening→Campaign→第一回合 committed，以及重启恢复。后续 Progressive 十回合、资料增量/绑定/生命周期与 TTFP 属于后续收尾扩展门禁，应与第三期 P3/P4 分开判定。
5. API 24 / Android 15、16 兼容矩阵仍缺证据；不能把 API 37.1 一台模拟器的结果外推。

## 本机环境核验

- Android SDK、adb、emulator、JDK 17 存在；`adb devices -l` 当前无连接设备；AVD 列表有 `Medium_Phone`，系统镜像目录仅见 `android-37.1`。尚未验证该 AVD 能成功启动。
- 四个 Release 签名变量在当前进程可见，未输出值。不能沿用旧沙箱“无签名配置”的结论。
- 用户指定 GLM 配置文件存在，本轮未读取内容，端点有效性未验证。
- `《白篱梦》.txt` 为 3,065,535 bytes；`凡人修仙传.txt` 为 22,513,508 bytes。文件存在不等于导入或真实 LLM 闭环通过。
- 旧报告的“无设备/无端点配置/无签名配置”描述属于历史执行环境；本地 Agent 必须重新检测，不能直接复制作为阻塞理由。

## 可直接复制给本地 Agent 的提示词

你正在 E:\AiWorkSpace\ShineWord 为世恒哥完成第三期收尾建设和模拟器实测验收。请实际执行，不要只写计划或复述旧报告。

先做只读基线：读取 AGENTS.md、docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md、docs/reviews/ui/data-availability.md、docs/reviews/final-closeout/LOCAL_REACCEPTANCE_2026-09-29.md、FINAL_REPORT.md、F1～F5 以及 progressive-opening/FINAL_AUDIT.md；记录当前 HEAD、状态、版本和构建环境。保留所有用户现有修改，特别是 .workbuddy/memory/2026-09-28.md。不要 reset/clean，不要清理用户 AVD 或覆盖其存档。当前复验基线是 2e44565、versionCode 16，若 HEAD 变化请重新核实。

一、修复并回归本报告 A1～A3：TextField 的输入框内部 placeholder 使用与实际背景匹配的 token；PartyStrip 显示可视 HP/体力数值；NpcCharacterSheet 消除旧错误状态残留并保留晚回包取消保护。用真实 token 和实际组件配对完善对比度回归，禁止只改脚本阈值或复制一份颜色让检查变绿。复核 compact SegmentedControl 及其他 icon-only 控件的实际触控区域，必须结合 bounds、屏幕密度和边缘点击证明 ≥44×44dp，不能仅看 hitSlop。

二、准备隔离模拟器：本机有 ANDROID_HOME、JDK 17、Medium_Phone 和 API 37.1 镜像，但需实际启动验证。新建或使用确认无用户数据的独立 QA AVD，全部 adb 命令显式指定 serial。禁止对既有设备 pm clear、卸载覆盖、wipe-data。优先运行当前源码构建的包；记录 APK 哈希、版本、ABI、设备/API、时间和源码 HEAD。

三、真实 LLM 与小说：安全地从 C:\Users\anjin\Desktop\Ai工作坊\Test-API\GLM-TEST-KEY.txt 读取配置，在内存解析，不打印全文、密钥或 Authorization，不把密钥放入命令行参数、截图、日志、Git 或报告；端点/model 按文件实际配置，不凭空猜测。先做最小真实连通性测试，记录脱敏错误类别和耗时。小说路径为 C:\Users\anjin\Desktop\Ai工作坊\《白篱梦》.txt 与 C:\Users\anjin\Desktop\Ai工作坊\凡人修仙传.txt。先用短篇跑通，再测长篇；通过真实 App 文件选择/导入流程推进。允许合成 QA 世界单独验证 HUD/边界，但不得用 mock、预置 dossier 或直接改 SQLite 冒充真实小说开局。

四、完成第三期 §29 的全部设备矩阵：首启、Profile 保存和重启持久化、四主题、TXT 导入、Library、WorldDetail、玩家三宝书/编辑模式警示、Review Queue、世界主题覆盖、Opening 四步（返回、保留选择、重复点击防护）、原创角色/三技能/两同伴/Directive、创建与继续正确 branch。Play 验证普通和有骰/无骰回合、成功与失败、Narrator 故障恢复且 RollRecord 不重掷、App 强停恢复、短长休、训练、队伍指令/分队/重入/知识分享/物品转移、Encounter attack/rescue/move/dash/NPC turn/retreat、玩家/同伴/NPC 卡与五面板、rewind 和旧新存档/世界包往返。NPC 用含 GM-only/future 隐藏标记的 QA 数据检查实际 UI 不泄漏；角色资源、成长点、冷却与权威 stateVersion 一致。

五、视觉交互证据：墨/烛/漫/梭每套覆盖 Library、Opening Step2/4、普通与有骰 Play、三类角色卡、Encounter、任务/知识面板。测键盘弹出后的输入和发送、Safe Area、Sheet Back/遮罩/重开、100 TurnView 上滑阅读不抢滚动与贴底更新。截图逐张审查。私人小说截图只保存在仓库外；可入库截图只用合成 QA 内容。记录缺陷→修复→复测，不得用源码判断冒充设备通过。

六、单列 Progressive 扩展验收：两部小说分别跑真实 TXT→合法 dossier/引用→publish→Opening→Campaign→第一回合 committed→重启恢复，失败按阶段记录脱敏 errorCode 并修复根因；不要以模型返回 200 或导入完成代替可玩。至少一条真实 Campaign 连续完成 ≥10 回合，记录资料查询/缓存/增量/binding stateVersion、额外等待、后台/锁屏/强停恢复和晚回包 fencing。逐次记录 TTFP 与样本数；样本不足时不得宣称 P95 达标，不得伪造耗时。

七、工程与兼容：每轮按实现→Review→Fix→回归推进；核心测试不得低于当前 226 项，并为实际缺陷加有意义的回归。运行 verify:core、mobile typecheck、debug、签名 release；验证签名、zipalign、安装与无需 Metro 的断网冷启动，记录 Release arm64 体积，区分多 ABI APK。沿用本机签名配置，不输出凭据。补 API24、Android15/16 可获得的模拟器矩阵，并把真机项单独标注；无法获得的环境须报告实际探测/尝试/错误证据，不能沿用旧沙箱理由。验证旧版升级后的数据库、Keychain、主题、campaign/branch 和存档兼容。

保持规则域、骰点、成长、ActionContract/RollRecord、存档 schema、applicationId、数据库名和世界包不可变语义；必要的越界修复单列原因及兼容性证据。不要新增大型 UI 框架、快捷行动 LLM 请求或无关功能。禁止提交密钥、小说、私人存档、APK/构建目录。不擅自发布、推送主分支或宣布 Beta。

最终更新验收文档并给出逐项 PASS / FAIL / NOT TESTED / BLOCKED、命令退出码、截图/脱敏日志路径、APK 元数据、真实模型和小说样本结果、剩余问题及复现步骤。分别回答“第三期 P3/P4 是否通过”“Progressive 真实可玩是否通过”“兼容/发布是否通过”；只要必需项有缺口，就明确整体未通过，不用测试数量替代用户旅程。
