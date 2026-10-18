# ShineWord Phase 9.5 本地最终收口报告

日期：2026-10-18（Asia/Shanghai）
工作树：`F:\sw95local-20261018`
分支：`fix/phase95-local-final-closeout-20261018-short`
远端：`https://github.com/anjingdtl/ShineWord`
PR：[ #15 Phase 9.5 local final closeout and opening evidence recovery ](https://github.com/anjingdtl/ShineWord/pull/15)

## 分阶段结论

- **阶段 9.5：PARTIAL。** 真实 GBK 小说、GLM 和专用 API 37 AVD 上完成了开局、连续行动、历史 save-10 恢复续玩以及 stage-5 隔离分支推进。累计 17 个行动级回合全部由测试执行者驱动；3 项延迟后果已核对消费，第 4 项的下游读回和玩家反馈仍缺。stage 5 已在 QA branch 完成并进入 stage 6，但原 main 保持 v12/r4；campaign-scope L1 使用显式 fixed empty evidence。非空来源证据 L1、main 当前内容补建、真人和独立试玩仍未验收。另有两次宿主机 GLM transport unknown（详情见脱敏证据），不重派且不计入持久应用账本。
- **Runtime 工程收束：PASS-ENGINEERING（列明范围）。** 八项确认代码缺陷均具 RED → 最小修复 → GREEN 证据：结构化开局证据补建、Canon 开局方案采用、终局/暂停状态行动门控、effect 上限 repair guidance、long-plan consequence repair guidance、stage completion producer repair guidance、action-reference mismatch guidance，以及 start-node recovery guidance。最新全量 Core 1,356/1,356、mobile typecheck、version check 通过；standalone APK 已在保留原应用数据的 AVD 安装，二进制身份匹配并通过脱离 Metro 的冷启动。
- **阶段 9 历史遗留：PARTIAL。** 人类有效决定 0/80、独立试玩 0/4、自然结局未验、L1/L2 匹配性能 10+10 未验；Stage-1/8 历史资产和多项故障注入仍缺。合法 save-10 已真实恢复、续玩并保留历史记录。自动化、代理 QA、模型生成内容和 CI 不替代玩家验收。

## 基线、提交与 CI

- 再次 `git fetch origin` 后，实际 `origin/main` 为 `87eef899281f267a17e02357cc643dd475cabd7c`。原本地仓库、main 与其他工作树保持原样；施工在隔离工作树完成。
- 已独立提交的八项代码修复：`dd17ccf`（bounded opening evidence recovery）、`8ab0419`（Canon 开局方案采用）、`3847339`（Runtime 终局行动门控）、`00f3625`（bounded campaign effect repair）、`b6c7d00`（missing long-plan consequence repair）、`cbacbb0`（local stage completion repair guidance）、`76a51fc`（action-reference mismatch repair guidance）、`447bd67`（start-node recovery guidance）。campaign-plan guidance 缺陷均先增加 helper/retry 集成 RED，再最小修复并分别 GREEN。
- PR #15 针对 main 保持开放且未合并。最终验收只认 PR #15 Checks 页面上当前 head 的 Core Verify 与 Android Verify；旧 SHA、main 基线或 PR #14 的 CI 不代替 exact-head 核验。PR 正文记录最终 SHA 与当前检查结果。
- 最终本地应用代码回归基于 `9d749ed87b043a0f3a1c94d8534a397b0a212da8`；本地 Core、version、mobile typecheck 和 standalone APK 均通过。更早的代码 HEAD `f6ea06acf09a428bd04951cab52e68474ca9b379` 对应 Core Verify #149 / run `39124990104` 与 Android Verify #113 / run `39124990038` 均 success。此后新增内容仅为脱敏验收文档与设备证据；PR 正文和 Checks 页维护最终文档 HEAD 的最新 exact-head CI，旧 run 不代替最终 HEAD。

## 本地回归与 Android 包

- `npm ci --ignore-scripts --no-audit --no-fund` 与 `npm --prefix mobile ci --no-audit --no-fund`：均退出码 0。
- `npm run verify:core`：1,356/1,356 passed，0 failed / skipped，约 38.9 s。
- `npm --prefix mobile run typecheck`：通过；`npm run verify:version`：通过（1.0.0 / versionCode 1000000）。
- 使用项目入口 `npm run apk:debug` 成功构建 standalone Debug APK；入口验证内嵌 `assets/index.android.bundle`。直接调用普通 Gradle `assembleDebug` 只生成依赖 Metro 的开发包，曾出现 “Unable to load script”，随后已用 standalone 包修复运行环境并复测。
- API 37 AVD 的 Play QA 分支经过 portrait → landscape → portrait 控件断言；360×800dp 虚拟显示下重新进入同一 branch 后，progress/composer/submit 断言通过。Android 夜间 dark 模式下 composer/submit 断言也通过，测试结束恢复显示密度、尺寸和夜间设置。TalkBack 焦点/语音未取得可核证结果，仍为 NOT RUN。
- 最新应用代码在 `447bd67` 后完成全量 Core、mobile typecheck、version check、standalone APK 构建、安装身份核验及脱离 Metro 冷启动。其后本轮只修改脱敏 Markdown/JSON 证据；同一 APK 上完成 save-10 原生恢复、续玩与隔离 stage-5 行动/plan adoption。MainActivity 可运行且原有用户数据保留。
- 当前 standalone Debug APK：`F:\sw95local-20261018\dist\apk\debug\ShineWord-V1.0.0-debug.apk`；本地构建与模拟器安装包 SHA-256 均为 `C42A097F490595E3C46D1BC04CCB73E7BE0700F892170DFCD8CDA054EE755B44`。
- 专用 AVD `ShineWord_Phase95_LocalFinal_20261018`，设备 `emulator-5556`，API 37 / Android 17 / 1080×2400 @420 dpi。使用 `adb install -r`，没有清除数据库、小说、Keychain 或模拟器数据。
- 应用户要求检查并精简 AVD：通过 Android SDK 管理器删除 7 台历史 ShineWord 专项 AVD；已注册设备从 10 台减至 3 台，保留当前小说实测机、M4 故障回归机和共享 `Medium_Phone`。F 盘可用空间实测增加约 45.53 GiB；未注册且归属不明的 `Pixel_10.avd` 残留目录保留。设备清理记录见 `AVD_CLEANUP_LOCAL.md`。
- 收口期间另起的宿主机 GLM benchmark pilot 失败：fixture 不具备 L1 所需 binding，两次均被送往 Planner；两次 transport outcome 均为 unknown，且临时内存账本未导出 attempt identity。未重派、未将其计入 79 条持久应用账本；该 QA 流程偏差列入 `DEFECT_REGISTER.md`，也使本轮不能宣称所有潜在 endpoint 尝试都已对账。

## 小说、真实模型和游玩证据

- 原小说 SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`，7,178,905 bytes，Windows-936/GBK。设备解析 1,504 章、3,260 chunks；本轮 GLM scope 只覆盖 0–9,600 code points，未上传全书。章节计数 1,498 与设备解析 1,504 的差异仍待归因。
- GLM 配置已由用户确认测通。真实小说 world、三个 campaigns 与 mapped branches 的持久应用账本共 77 次物理 attempt：76 次 HTTP 200、1 次轮换前配置 HTTP 401。观测并发峰值 2，后续请求按序等待。成功 token totals：输入 1,117,695、输出 258,924、reasoning 40,902。实际人民币扣费仍无法从 app ledger 确认。
- 后续排查发现设备账本里那条 `world_extract` 429 的冻结 endpoint 是本地故障注入 `10.0.2.2:8765`，不是 GLM；其同一 logical request 的 attempt 2 保持 `outcome_unknown`，未重派。另有独立开篇样本两次 HTTP 200。上述持久应用账本与开篇样本共 79 次已知记录（78 HTTP 200、1 次旧配置 HTTP 401；其中真实 GLM 429=0）。另两次面向 GLM 的宿主机 transport attempt 没有 HTTP status，dispatch outcome unknown，且 identity 未持久化；不能将其计作已确认成功/失败，不能重派。详情见 `evidence/glm-429-attribution-and-retest-sanitized.json` 与 `evidence/host-glm-pilot-transport-unknown-sanitized.json`。
- 公开 partial package 有 49 explicit 与 3 inference facts、52 个来源引用、8 skills、4 scenes、11 个角色模板；world package `method` 条目数仍为 0。第三局 campaign-scope artifact 另生成并实际提交 6 个显式 fixed difficulty / fixed empty evidence / rule-bound 的 L1 actions（无 Planner），同时真实 L2 行动产生 Planner；不证明非空来源 evidence 的 L1 或 package method 覆盖。
- 前两局分别有 5 与 1 个 agent-driven QA actions，既有骰点与终局证据仍保留。第三局 main 有 8 个 actions、v1→v12；6 个 campaign-scope L1 与 2 个 L2 完成骰点、Narrator、原子提交和下一轮。stage 4 turn-0011 `[4,5,6]` / 3d6 / difficulty 3 / margin +3 `full_success` v10→v11，后续三项 deferred consequence 已消费。`camp-mvdjtr22-bmvdo8467` branch 另有 1 个 method-bound failure action。随后隔离 QA branch 的 stage-5 `turn-0014` 成功 v13→v14、无骰点、Narrator HTTP 200；两个串行 plan attempts 后采用 r7、进入 stage 6。Save-10 branch 也完成 1 个恢复后续玩行动。共 17 个新增 agent-driven action turns，均不计真人决定。
- 第二局终局页仍验证 `guidance-submit-*` 与观察行动为 0、composer disabled，作为 M3-02 的设备 GREEN。之后第三局 main 推进至 v12，stage-5 降级提示与安全自由输入也曾现场验证。该 main 保持 v12/r4；应用创建的隔离 branch `camp-mvdjtr22-bmvdq6wys` 后续经 stage-5 action 推进至 v15/r7，stage 5 succeeded、stage 6 active、stage 7/8 planned。最新设备 SQLite 完整性检查为 `ok`。
- 真实 save-10 已在原生 Android UI 恢复到新 campaign/branch，六条历史 turn 和两条历史 roll 的合同/hash/结果对照一致；恢复后新增一次行动并在冷启动后继续打开。详细证据见 `evidence/save10-device-restore-sanitized.json`。
- 真实因果范围从即时 counter 扩展到 3 项 deferred consequence 的 trigger → discharge → 下游消费：turn-0010 消费 `conseq-town-tension`；turn-0011 消费 `conseq-barov-attention` 与 `con-tension-peaked`。stage-5 action 已运行，但第 4 条 consequence 尚无独立完整的下游消费对照，玩家后续回应也未验。

## 缺陷修复登记

- `SW95-M6-01`：发布验证返回结构化 `opening_entity_unproven` 时，旧恢复条件只看中文错误消息，漏掉有界开篇补建。RED 后新增只识别该 machine-code 前缀的判定 helper；定向 2/2 GREEN，不改 validator、scope 或 ledger。
- `SW95-M3-01`：Canon 开局计划把规划阶段建议技能错误写入 `initialSkills`，导致采用时与 Canon payload 比较触发假 drift。RED 后只在 Canon intent 不绑定规划建议技能，并兼容已存旧建议字段；定向 5/5 GREEN。
- `SW95-M3-02`：Runtime 已 `failed` / `paused` 时，Play projection 仍显示可变更行动且 controller 允许直接提交。RED 后把权威 campaign status 投影至 UI，并在 UI/controller 两层门控；保留只读查看线索。定向 7/7 GREEN，安装后的终局页复测通过。
- `SW95-M3-03/04/05`：stage completion producer、effect-array 上限、long-plan consequence 数量的 validator 错误原先没有合同保真的 repair guidance。三项各自以 helper + generation retry 集成反例先 RED，再分开提交最小 guidance 修复并 GREEN。对应的早期 stage-5 candidate 因 `skill_check.destinationId` 无效被 validator 拒绝；该 candidate 未采用。之后独立 branch 的可用行动和 plan-r7 adoption 通过设备验证，二者证据分别记录。
- `SW95-M3-06`：候选把 `destinationId` 附到 `skill_check` 时，validator 正确拒绝，但 repair classifier 没有说明只删除冲突字段并保留 action kind。定向用例先 RED（27 项中 26 项通过），新增精确诊断匹配 guidance 后 27/27 GREEN；全量 Core 为 1,356/1,356。两个 post-fix GLM candidates 均未重现此 mismatch，故没有 live 触发该特定指导路径。
- `SW95-M3-07`：validator 报 `plan: startNodeIds required.` 时，repair classifier 原先没有解释入口由既有 concrete required-main stage 的 `activation:null` 派生。RED 27 pass / 1 fail；加入仅对精确错误的入口指导后定向 28/28、全量 Core 1,356/1,356。真实 GLM job 的候选将 stage-5 入口置为 null，但该 candidate 随后因两个 consequence 过早触发、trigger 重复及缺少后续权威效果消费者而 invalid，未采用。另一次真实 UI 行动在隔离 branch 完成 stage 5 并推进到 stage 6；见 [stage-5 device evidence](evidence/stage5-live-adoption-and-replay-sanitized.json)。
- 复核未新增第二套 Runtime、状态权威、规则语义或账本；未放宽既有内容验证，也未改写冻结 turn、骰点或历史 unknown。

## 未完成项 / 明确阻滞

1. L1：6 次真实 L1 使用 campaign-scope fixed empty evidence 与规则绑定；world package 仍无 method entry，非空 evidence L1 与 legacy 缺字段内容不得通过默认推断补齐。
2. 真人体验：0/80 真人决定、0/4 独立试玩；世恒哥明确由自己后续完成体验，此项不阻挡本轮自动化工程交付，也不在此宣称已验收。
3. stage 5：M3-07 生成候选本身仍按 validator 拒绝，后续可用 UI action 在隔离 branch 完成 stage 5 并采用 plan r7 进入 stage 6；原 main v12/r4 未同步，完整 main 线路与玩家选择未验。
4. 旧存档与故障恢复：save-10 已恢复、逐项对照历史 turn/roll 并续玩；Stage-1/8、live turn force-stop、Narrator 前后杀进程、outbox 与旧 worker 矩阵未执行。
5. 性能与无障碍：本轮非匹配的长会话样本 PSS 196,443 KB / RSS 285,960 KB；GfxInfo 累计 10,169 frames、modern jank 140 (1.38%)、p50/p90/p95 17/30/31 ms。它不是独立 benchmark。360×800dp 虚拟显示及旋转/暗色核心控件冒烟已运行；TalkBack、API 24、真实小屏物理设备和 10+10 L1/L2 matched test 未运行。
6. 小说标题计数差异与实际模型人民币费用未知；不通过估算或改 parser 消除。
7. PR #15 保持开放且未合并。M7 仅按 PR Checks 页当前 head 的 Core Verify 与 Android Verify 判断；旧 SHA 的 success 不替代 exact-head 结果。核验 SHA、run 与状态记录在 PR 正文，不自动合并。

## 私有证据边界

- 带模型生成文本的截图只保存在本机，不加入仓库。第三局 v12 当前屏幕截图 SHA-256 `953FA7E8755212D12B8C3E26B7FD972C5BF1AA28525DEB8B18D1854FD496FC1F`，本地路径 `C:\Temp\shineword-phase95-local-final\after-stage5-fallback-l2.png`。
- 本轮小屏 Play 截图 SHA-256 `F98D9451488927A8A782E149832AA5E1A443553207981D74A93EEC7D59016F6A`，本地路径 `C:\Temp\sw95-phase95-active\small-before-maestro.png`。新提交的 save-10 与 stage-5 JSON 仅包含脱敏状态、标识和 hash，不含正文、提示词、响应、数据库或截图。
- 第三局状态 v12 的只读 SQLite 副本 SHA-256 `AF7BB3B76BA8F90636C77AE8CF7C34C6773124C0C92B7FE4B846D8F30DE4F8C5`，`integrity_check=ok`；完整 DB 仅留在本机。仓库新增的 `evidence/third-campaign-sanitized-summary.json` 不含剧情原文、提示词或密钥。
- 已提交的开局身份页截图只显示身份控件与空姓名输入，不含小说正文或生成剧情。未将密钥、小说正文、LLM 提示词/响应、数据库、终局截图加入 PR。
