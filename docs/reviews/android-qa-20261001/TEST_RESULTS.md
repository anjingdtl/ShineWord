# Android 验收执行记录

测试日期：2026-10-01（Asia/Shanghai）。基线：`0adadcd`，V0.4.1。

| 模块 | 状态 | 结果与证据 |
| --- | --- | --- |
| M0 | 通过（已修复） | 577/577 核心回归，移动类型与版本门禁通过；独立 debug APK 安装、冷启动与重启通过，v2 签名有效 |
| M1 | 通过（已修复） | 设备 GLM 低/高/最高三档真实连接成功；配置、Keychain 密钥重启复用成功；修复无密钥保存失败却发布配置 |
| M2 | 通过（已修复） | 完整小说导入、第一阶段发布、暂停/重启续建和同文件去重通过；修复冲突审查与续建死路 |
| M3 | 通过（已修复） | 原创两步开局、原著四步开局、首回合生成、重启继续通过；修复游玩页返回入口 |
| M4 | 通过（已修复） | 同一分支 10 次真实行动；三档、4 次本地掷骰、五个面板与 v8 记忆保存；修复时间与阅读跟随 |
| M5 | 通过（已修复） | 存档与世界包往返、校验失败、分支休息、断网重试、后台、两处强停恢复通过；修复恢复死路、导入标题和菜单回执 |
| M6 | 通过（已修复，性能有环境限制） | 五轮导航、三次冷启动、ZIP 新项目开局、日志和数据库审计通过；修复导航栈重复保留页面；最终 APK 与安装包哈希一致 |

完整范围与通过条件见 [TEST_PLAN.md](TEST_PLAN.md)。

## M0 构建与启动

- 设备：`emulator-5556`，ShineWord_P2_Clean 临时只读实例，Android 17 / API 37.1，x86_64，1080×2400 / 420dpi。
- 原 debug APK（91.76 MiB）安装后显示 `Unable to load script`。原因：debug 被列为 `debuggableVariants`，Gradle 跳过 JS bundle，无法脱离 Metro 启动。
- 修复：`apk:debug` 指定 `shinewordStandaloneDebug=true`，嵌入 Hermes bundle 并关闭该构建的 Metro 支持；普通 `run-android` 保留开发服务器流程。打包脚本新增 bundle 存在性检查。
- 修复后 APK：`dist/apk/debug/ShineWord-V0.4.1-debug.apk`，97.54 MiB，包名 `com.shineword.app`，versionCode 40100，一名签署者，v2 验签通过。
- 未启动 Metro、无 adb reverse；冷启动实际进入首次模型配置页，再次强停启动也成功。首次 Activity 启动耗时 1,983ms（不等同于全部 JS UI 首帧耗时）。截图：[M0_FIRST_RUN.png](M0_FIRST_RUN.png)。
- 构建环境阻滞：JDK 在默认 Windows 短路径 TEMP 中创建 Unix-domain socket 时失败；指定本次进程 `jdk.net.unixdomain.tmpdir=C:\Temp\shineword-qa` 后 Selector 探针与 Gradle 均成功，操作见构建文档。
- 原始证据：本地目录中的 `build-debug.log`、`build-debug-fixed.log`、`m0-baseline-block.xml`、`m0-cold-restart.xml`。

## M1 模型设置与凭据

- 使用用户文件指定端点，选择内置 `glm-5.3-flash` 预设。设备真实连接探针：Low 5,340ms，High 1,599ms，Max 3,026ms，均返回成功；这证明请求参数被端点接受，不推断模型内部推理深度。
- 缺陷复现：首次只填端点与模型、不填 Key，点保存提示失败；强停重启却进入书库。原因是普通配置在 Keychain 检查前已经持久化。
- 修复：配置验证后先确认/写入 Keychain，成功后才发布普通配置。新增 3 项回归，验证缺少密钥、Keychain 失败、无效配置不会发布新配置或更换密钥，并验证已保存密钥可复用、普通存储只包含 keyRef。
- 设备复测：缺少 Key 保存失败后重启仍显示首次配置；填真实 Key 完成保存后重启进入书库；「我的」Key 输入保持空白，从 Keychain 复用进行连接测试成功（2,148ms）。截图：[M1_CONNECTION.png](M1_CONNECTION.png)。
- `profile-store` 11/11 通过，移动端类型检查与独立 debug 重新构建通过。
- 原始证据：`m1-missing-key-restart.xml`、`m1-missing-key-fixed-restart.xml`、`m1-probe-{low,high,max}-result.xml`、`m1-keychain-reuse.xml`。

## M2 小说导入、阶段构建与审查

- 完整用户 TXT 3,065,535 bytes，SHA-256 `6faa89e68bba97a96e1dacc0cc969de2b3217dc9c59167e9bfdb2b9e27971c81`，模拟器文件与本机文件相同。系统文件选择器导入成功：300 章、944 块、965,462 code points，UTF-8。
- 循序构建第一阶段覆盖前 106 章、295 块、3 个并行批次。真实 GLM 抽取分别耗时 80,162 / 109,393 / 98,247ms；时间线 34,575ms；映射 55,130ms。账本合计 5 个成功请求。
- 抽取期间点暂停并回到桌面，前台服务保持运行；批次完成后进入 `paused_user` 3/3。强停重启仍保留 3/3，继续构建复用抽取和时间线，没有重复已完成请求。
- 阻滞：不同 JSON 描述被视为冲突，发布只显示笼统错误；旧「按事实解决」只改审查提示，不改冲突事实；新增明确分类后，待审查状态又阻止显式续建。
- 修复：按人物显示已有/待核对描述及逐字证据，提供「补充事实保留」或「待核实」决定；事务保存事实状态、保留证据与审查记录；剩余冲突持续阻塞，全部处理后才允许续建。普通续建仍不能重放计费结果不明的请求。
- 设备通过 UI 核对：周景云身世作为补充保留；庄篱地点记录引用仅支持姓名，转为待核实，未强行纳入世界映射。最终 64 explicit / 4 inference / 2 speculation，冲突清零，三个审查记录已解决。
- r1 已发布，包范围 `[0, 290271)`，`incremental / partial`；界面出现可游玩入口，玩家手册、城主指南、怪物图鉴及世界包页能打开。图鉴无可见条目时显示空态。后续两阶段尚未触发，不能据此声称全文已精编；修正项目页的阶段完成提示。
- 同一完整 TXT 再导入后自动回到原项目；仍为 1 世界 / 1 active 源 / 1 run / 5 请求，未重复计费。导入提示显示小说名称。
- 核心回归 582/582、移动类型检查通过；新增审查/续建回归验证证据保存、不能空豁免、无证据不能确认、待核实不映射、跨世界/重复决定拒绝与保留已完成批次。
- 原始证据：`m2-review-blocked.xml`、`m2-reviewed-detail.xml`、`m2-second-conflict.xml`、`m2-three-books.xml`、`m2-mapping-status.xml`、`m2-reimport-final.xml`；截图：[M2_REVIEW.png](M2_REVIEW.png)、[M2_PUBLISHED.png](M2_PUBLISHED.png)。

## M3 两种身份开局与重入

- 原创两步流程：空姓名时下一步禁用；填写 Shiheng、短描述与目标，确认推荐属性/技能、原著事件锚点与定安伯府地点后成功创建。无可招募同伴时展示独自开局空态。
- 原著四步流程：世界起点 → 原著角色（定安伯）→ 同伴 → 确认，通过证据派生属性/技能，世界包 r1 与规则 0.2.0 锁定。两个独立战役各完成首个真实观察回合，Planner 与 Narrator 均成功，状态版本各为 v1。
- 开局初始页明确要求第一个行动；首回合才生成故事。原创首回合 Planner 3,522ms、Narrator 3,194ms，角色卡显示气血/体力 10/10、六属性和初始技能。
- 重装保留数据并强停重启，在战役列表看到两场战役，继续原创战役时保留原叙事与 v1，无额外模型请求。
- 缺陷：从项目开局后「‹ 战役」实际返回项目页。修复为显式返回战役列表，设备复测入口与标签一致；移动类型检查和独立 APK 构建通过。
- 连续游玩模块继续核查已发现的夜间时钟与清晨叙事不一致；不将 M3 首回合证明扩大为全部叙事质量保证。
- 证据：`m3-quick-identity.xml`、`m3-quick-confirm.xml`、`m3-advanced-world.xml`、`m3-advanced-companions.xml`、`m3-advanced-confirm.xml`、`m3-canon-first-turn.xml`、`m3-restart-campaigns.xml`、`m3-original-reentered.xml`、`m3-back-fixed.xml`；截图：[M3_FIRST_TURN.png](M3_FIRST_TURN.png)、[M3_CANON_START.png](M3_CANON_START.png)。

## M4 连续行动、三档与面板

- 原创战役同一分支完成 10 次真实行动：观察、查脚印、交谈、请求许可、查走廊、听门内动静、叩门、核对痕迹、运动跨沟、告退。首回合使用中文预设选项，其余自由输入使用英文，模型主要以中文叙事。10 条 turn 与 narrative 全部 Committed，版本到 v10。
- 本地掷骰：交涉 `[6]` / DC4 成功、交涉 `[4]` / DC4 成功、运动 `3d6 [1,5,3]` 取高 5 / DC4 成功、告退交涉 `[2]` / DC3 失败。模型叙事未改变持久化的本地结果。
- 实际档位：Low 8 回合，High 1，Max 1。High Planner/Narrator 26,336 / 42,307ms；Max 15,270 / 42,016ms；Low 平均 4,890 / 9,468ms。UI 等待期间禁用行动，仍可打开信息；测试脚本的 45 秒轮询到期不等于应用超时，账本显示请求继续并成功。
- 角色、队伍、任务、物品、知识五面板可打开；独自行动与无可见任务/物品/知识时展示空态。当前包没有可招募同伴/图鉴遭遇，本轮未验证实际招募、物品转移或战斗。
- v8 触发真实 `memory_checkpoint`，一次修复请求后 `story_memory_states` 为 clean / through v8；两请求均成功，分别 26,101 / 25,372ms。
- 时间缺陷：时辰刻数从偶数小时计算，与 23:00 起点错位；模型上下文没有当前时刻，首次叙事写成清晨。修复刻数偏移，将当前时刻放入必需上下文，并向 Narrator 提供本回合起止时间，明确时间不能被旧叙事覆盖。真实续写已转为夜间，并从子时五刻推进到丑时二刻。
- 阅读缺陷：键盘缩小视窗和新增内容被误判为读旧故事，最新故事偶尔藏在下面。修复为记录用户滚动意图，在原生尺寸测量稳定后跟随末尾。设备验证：第 7/10 回合自动显示新故事；主动上滑阅读 5/6 回合时，第 8 回合提交保持原位置，手动下滑可看新故事。
- 核心回归 584/584、移动类型检查、独立 APK 构建通过；时间边界与 Planner/Narrator 必需上下文新增回归通过。
- 证据：`m4-turn02.xml`、`m4-turn03-watch.xml`、`m4-turn05-complete.xml`、`m4-turn06-complete.xml`、`m4-reading-old.xml`、`m4-turn08-reader-position.xml`、`m4-turn09-visible.xml`、`m4-turn10.xml`、`m4-panel-{party,quests,items,knowledge}.xml`；截图：[M4_LATEST_TURN.png](M4_LATEST_TURN.png)、[M4_TURN10.png](M4_TURN10.png)。

## M5 存档、分支与故障恢复

- 原创 v10 通过系统文件选择器导出 79,011 bytes 的 v6 存档，包含 10 回合、11 个快照与 4,500 秒世界时间。改变状态但不更新摘要的副本被拒绝（`Payload digest mismatch`），没有创建半成品战役；完整存档导入为新战役并保持 v10，原战役不变。
- 导入战役从 v10 回退到新分支 v9；主线仍 v10。短休和长休分别推进 1,800 / 28,800 秒，得到 v11 / 34,500 秒，两次均为本地结算，无模型请求。
- 断网时提交失败，输入恢复、v11 不变；联网后重试并连续点两次，仅提交一个回合到 v12。账本为 Planner 已知网络失败 a1 → 成功 a2，Narrator 成功 a1；没有重复结算。网络错误补上中文提示。
- 下一次交涉生成期间切到桌面再返回，正常提交 v13；本地 `[1]` / DC4 大失败，叙事保持失败结果。
- 强停阻滞复现：第 14 回合 Planner 已成功，本地状态 `Resolved`、骰点 `[3]` 已保存，Narrator 请求发送后强停。重启失去原输入；重试被 `outcome_unknown` 保护挡住，界面却没有账本确认或恢复入口。
- 修复：migration 26 保存提交前的原始行动；恢复旧版已冻结合同；增加说明上次可能已计费的「确认重试这一回合」，只认可当前战役/分支/状态下明确选定的未知请求，保留未知状态与用量而非伪造完成。新一次中断仍需再次确认，其他动作不能绕过未完成回合。Narrator 恢复沿用冻结行动，既有骰点不重掷。
- 设备复测救回 v14：合同哈希仍为 `0c11cc0549d9b8c44f27e3109d38625d6bc34a71f0fd2bcc1dfb2ecd15aafb03`，原 `[3]` 与创建时间不变；Planner 仍只有 a1，Narrator 为原未知 a1（记录确认时间）及成功 a2。连续点恢复按钮未新增第三次尝试。
- 再于第 15 回合 Planner 发送时强停。重启完整恢复原英文输入；无自动重发；确认后 Planner a2 / Narrator a1 成功，分支 v15，行动草稿清零。普通输入和选择在未完成回合中禁用，恢复后重新可用。
- 菜单导出成功提示原先在折叠视窗外，移至菜单顶部，设备无需滚动即可看到回执。新存档保存战役标题，旧存档从世界名和玩家卡恢复标题；实际重新导入旧 v10 文件显示「《白篱梦》作者：希行 · Shiheng（导入）」并可继续。此前已导入的旧战役不改名。
- 世界包 r1 导出 ZIP 202,954 bytes，包含 `package.json`；经 UI 导入为独立可游玩项目，没有额外模型调用。导出存档、世界包未包含真实凭据。
- 80 项针对性回归、588/588 核心回归、移动类型和版本门禁通过；独立 APK 构建、保留数据更新、migration 25→26 和上述恢复复测通过。
- 证据：`m5-exported.xml`、`m5-corrupt-rejected.xml`、`m5-save-imported.xml`、`m5-offline-error.xml`、`m5-background-result.xml`、`m5-kill-blocked.xml`、`m5-recovery-fixed.xml`、`m5-recovered-turn14.xml`、`m5-planner-draft-recovery.xml`、`m5-planner-recovered15.xml`、`m5-export-receipt-fixed.xml`、`m5-import-title-fixed.xml`、`m5-world-import-final.xml`；截图：[M5_RECOVERY.png](M5_RECOVERY.png)、[M5_RESUMED_ROLL.png](M5_RESUMED_ROLL.png)、[M5_IMPORTED_SAVE.png](M5_IMPORTED_SAVE.png)。

## M6 稳定性、性能与最终产物

- 聚焦循环：战役列表 → 导入 v10 的游玩页 → 游戏菜单 → 关闭 → 返回战役 → 书库 → 我的 → 战役，不发模型请求。旧代码两轮 PSS 从 164,006 增至 196,029 / 229,852 KiB，第三轮部分操作后 240,022 KiB。核对已安装的 React Navigation 7 路由代码，`navigate('Tabs')` 追加页面，旧 Play/Tabs 被留在栈里。
- 修复游玩页返回和菜单退出为 `popTo('Tabs', ...)`，同时修正开局补齐资料后返回书库的同类调用。后者的错误资料补齐分支未在本轮重新触发；受影响页面均通过移动类型检查。
- 修复后的相同五轮循环全部通过，PSS 依次 156,443 / 157,583 / 166,575 / 177,193 / 175,590 KiB；随后同页采样回落至 155,348 KiB。初始 112,333 KiB 是尚未打开游玩与个人页的冷态；五轮采样证明这次页面栈累积已消除，不能证明所有长期内存泄漏均不存在。原始数值见 [PERFORMANCE.json](PERFORMANCE.json)。
- 聚焦五轮 gfxinfo：1,160 帧，170 卡顿帧（14.66%），p50 / p90 / p95 / p99 = 18 / 48 / 93 / 200ms。环境为 Android 17 API 37.1 x86_64、1080×2400、软件 GPU、debug；不视作真机 release 流畅度达标。旧采样期间有本机构建和 UI dump 超时，不做修复前后帧率因果比较。
- 菜单「退出到战役列表」可返回正确列表；系统返回依次回到书库、Launcher，没有重新打开旧游玩页。三次强停后的独立启动均为 COLD，Activity `TotalTime` 1,655 / 1,506 / 1,457ms，每次另通过 UI 树确认书库可用，无 Metro、无 adb reverse。
- 最终 APK 保留数据更新后，已导入的 v10 战役重复打开成功；ZIP 新项目以 Portable 开局并完成真实观察首回合，Planner/Narrator 成功，v1 与夜间时钟一致。系统离开应用后再次打开该战役仍保留故事，没有再次发模型请求。原 TXT 项目仍共存，未把本轮扩大为全新设备隔离迁移证明。截图：[M6_PORTABLE_PLAY.png](M6_PORTABLE_PLAY.png)。
- 终验日志中 crash buffer、ReactNativeJS/AndroidRuntime 错误与 ANR/crash event 为空；进程退出记录只有测试强停、安装更新等已知原因。早期 02:55 的 crash 属于并发 UI dump 的 `uiautomator` 工具进程，不是 APP；驱动也出现过读 UI 树超时，未当作 APP 崩溃，复测恢复后正常。
- 数据库 `integrity_check = ok`，`foreign_key_check` 空；无未提交回合、无 prepared/sent 请求。总计 16 个新真实游玩回合（原创 10、原著 1、恢复分支 4、ZIP 项目 1）和 2 次机械休息。44 次账本尝试：41 成功、1 次主动断网失败、2 次主动强停的未知结果已明确确认恢复，未知计费用量记录仍保留。
- 最终核心回归 588/588、移动类型和版本门禁通过。最终构建日志 `build-m6-navigation.log`：BUILD SUCCESSFUL；包 `com.shineword.app`，V0.4.1 / 40100，minSdk 24 / targetSdk 36，arm64-v8a + x86_64，APK v2 签名有效（1 signer），含 4,754,060 bytes 的离线 JS bundle。
- APK：`dist/apk/debug/ShineWord-V0.4.1-debug.apk`，107,037,263 bytes（约 102.08 MiB）。SHA-256 `2510cb932ec3db506e2ebe0c43d19b851677c0badc3f651fa6ebd98e3970eb34`，与模拟器安装的 `base.apk` 一致。
- 证据：`m6-navigation{,-fixed}.log`、`m6-navigation*-mem-*.txt`、`m6-gfx-fixed-final.txt`、`m6-cold-{1,2,3}.txt`、`m6-cold-*-ui.xml`、`m6-menu-exit-ready.xml`、`m6-system-back-{library,launcher}.xml`、`m6-portable-first-turn.xml`、`m6-final-restored-game.xml`、`m6-final-{crash,js-native,events,exit-info}.txt`、`final-apk-{metadata.json,signature.txt}`、`final-installed-apk-hash.txt`。

## 验收结论与边界

在本次完整列明的主路径中，没有遗留阻断缺陷；debug APK 已真正安装、离线启动并使用指定 GLM 和完整原著完成穿越游玩。构建、设置、导入、审查、开局、连续行动、存档、断网/强停恢复与页面稳定性均有设备证据及对应修复。

- 循序精编仅发布第一阶段 r1（前 106 章），全文已导入；后两阶段尚未触发，不宣称全书可游玩内容已验证。
- 当前世界没有可用遭遇、可招募同伴与相关物品/任务；实际战斗、招募、转移物品、训练等未做本次模拟器实游，核心自动回归的通过不能替代这些设备场景。
- 模型请求有明显档位耗时差异，世界构建单次最长约 109 秒；有一次恢复叙事混入 `Walls`，抽取也存在人物名称归一化重复。这些属于生成质量限制，未自动删除故事文字或合并可能不同的人物。
- 本轮是单个软件模拟器、debug 包和有限时长验收；真机帧率、长时间运行、跨 Android 版本与全新设备迁移仍需另测。

按模块提交：M0 `2d5e108`；M1 `34870ff`；M2 `f44da62`；M3 `cde715f`；M4 `5eb638e`；M5 `3d26c0d`；M6 为本报告所在的 `fix(navigation): release play screens when returning to tabs` 提交。分支：`codex/emulator-qa-20261001`。
