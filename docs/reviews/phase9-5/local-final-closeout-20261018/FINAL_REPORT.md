# ShineWord Phase 9.5 本地最终收口报告

日期：2026-10-19（Asia/Shanghai；含 10-19 补充复核）
工作树：`F:\sw95local-20261018`
分支：`fix/phase95-local-final-closeout-20261018-short`
远端：`https://github.com/anjingdtl/ShineWord`
PR：[ #15 Phase 9.5 local final closeout and opening evidence recovery ](https://github.com/anjingdtl/ShineWord/pull/15)

## 分阶段结论

- **阶段 9.5：PARTIAL。** 真实 GBK 小说、GLM 和专用 API 37 AVD 上完成开局、连续行动、合法 save-10 恢复续玩及 stage-5/8 隔离分支。现有 19 个 action turns 全由 QA 执行者驱动。stage 8 的 early-exit/success siblings 已对照终局取消、后果消费与知识写入；stage-5 QA branch 的后果还进入下一回合 frozen context，详情见 10-19 最新补充。原著新 package 非空来源 evidence L1、`method` 供给和玩家反馈仍未完成。campaign-scope L1 使用显式 fixed empty evidence。两次宿主机 GLM transport unknown 保留且未重派。
- **Runtime 工程收束：PASS-ENGINEERING（列明范围）。** 十二项确认代码缺陷均有 RED → 最小修复 → GREEN；最新全量 Core 1,359/1,359、mobile typecheck、version check、standalone APK 构建通过。最新构建已保留数据安装并在现存 API 37 AVD 启动；该构建轮次的 Maestro 层级/流程无结果，故仅记 install/process smoke PASS。
- **阶段 9 历史遗留：PARTIAL。** 人类有效决定 0/80、独立试玩 0/4、自然结局未验；production synthetic fixture 的 live GLM matched 10+10 已通过，但真实小说 package method 路径未覆盖。Stage-1/8 历史资产和若干故障注入仍缺。合法 save-10 已真实恢复并续玩；自动化证据不替代玩家验收。

## 基线、提交与 CI

- 再次 `git fetch origin` 后，实际 `origin/main` 为 `87eef899281f267a17e02357cc643dd475cabd7c`。原本地仓库、main 与其他工作树保持原样；施工在隔离工作树完成。
- 已独立提交的十二项代码修复：既有提交和 RED/fix 顺序记录见下方缺陷登记；本次新增 `f93742f`（Canon 场景线索 RED）与 `2e1a9c8`（最小修复）。M6-03 的 RED/GREEN 与构建哈希记录于 `play-panel-keyboard-submit-red-green-sanitized-20261019.json`。
- PR #15 针对 main 保持开放且未合并。最终验收只认 PR #15 Checks 页面上当前 head 的 Core Verify 与 Android Verify；旧 SHA、main 基线或 PR #14 的 CI 不代替 exact-head 核验。PR 正文记录最终 SHA 与当前检查结果。
- 最后推送提交及对应 Core Verify / Android Verify run 以 PR #15 正文和 Checks 页面为准；当前 head 必须在最终 push 后重新核验，旧 SHA 的 CI 不替代。

## 本地回归与 Android 包

- `npm ci --ignore-scripts --no-audit --no-fund` 与 `npm --prefix mobile ci --no-audit --no-fund`：均退出码 0。
- `npm run verify:core`：Canon 场景线索修复后的最终 CI 同名门禁 1,359/1,359 passed，0 failed / skipped；退出码 0，耗时约 36 秒。mobile typecheck、version check 也在本轮复核通过。
- `npm --prefix mobile run typecheck`：通过；`npm run verify:version`：通过（1.0.0 / versionCode 1000000）。
- 使用项目入口 `npm run apk:debug` 成功构建 standalone Debug APK；入口验证内嵌 `assets/index.android.bundle`。直接调用普通 Gradle `assembleDebug` 只生成依赖 Metro 的开发包，曾出现 “Unable to load script”，随后已用 standalone 包修复运行环境并复测。
- API 37 AVD 的 Play QA 分支经过 portrait → landscape → portrait 控件断言；360×800dp 虚拟显示下重新进入同一 branch 后，progress/composer/submit 断言通过。Android 夜间 dark 模式下 composer/submit 断言也通过，测试结束恢复显示密度、尺寸和夜间设置。TalkBack 焦点/语音未取得可核证结果，仍为 NOT RUN。
- 最新应用代码在 `447bd67` 后完成全量 Core、mobile typecheck、version check、standalone APK 构建、安装身份核验及脱离 Metro 冷启动。其后本轮只修改脱敏 Markdown/JSON 证据；同一 APK 上完成 save-10 原生恢复、续玩与隔离 stage-5 行动/plan adoption。MainActivity 可运行且原有用户数据保留。
- 最新 standalone Debug APK：`F:\sw95local-20261018\dist\apk\debug\ShineWord-V1.0.0-debug.apk`；修复后本机构建与 `emulator-5556` 安装物 SHA-256 均为 `F1D3817DFC3F3972FEBF2C415CE19ABFB3867DE66DD983252AF7860BF8054F88`。此前 `113B8E...` 包是 `d8d9c3e` 轮次的构建，不代表最新修复包；M4 AVD 未在该轮更新。
- 专用 AVD `ShineWord_Phase95_LocalFinal_20261018`，设备 `emulator-5556`，API 37 / Android 17 / 1080×2400 @420 dpi。使用 `adb install -r`，没有清除数据库、小说、Keychain 或模拟器数据。
- 应用户要求检查并精简 AVD：通过 Android SDK 管理器删除 7 台历史 ShineWord 专项 AVD；已注册设备从 10 台减至 3 台，保留当前小说实测机、M4 故障回归机和共享 `Medium_Phone`。F 盘可用空间实测增加约 45.53 GiB；未注册且归属不明的 `Pixel_10.avd` 残留目录保留。设备清理记录见 `AVD_CLEANUP_LOCAL.md`。
- 收口期间另起的宿主机 GLM benchmark pilot 失败：fixture 不具备 L1 所需 binding，两次均被送往 Planner；两次 transport outcome 均为 unknown，且临时内存账本未导出 attempt identity。未重派、未将其计入 79 条持久应用账本；该 QA 流程偏差列入 `DEFECT_REGISTER.md`，也使本轮不能宣称所有潜在 endpoint 尝试都已对账。

## 小说、真实模型和游玩证据

- 原小说 SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`，7,178,905 bytes，Windows-936/GBK。设备解析 1,504 章、3,260 chunks；本轮 GLM scope 只覆盖 0–9,600 code points，未上传全书。章节计数 1,498 与设备解析 1,504 的差异仍待归因。
- GLM 配置已由用户确认测通。真实小说 world、三个 campaigns 与 mapped branches 的持久应用账本共 77 次物理 attempt：76 次 HTTP 200、1 次轮换前配置 HTTP 401。观测并发峰值 2，后续请求按序等待。成功 token totals：输入 1,117,695、输出 258,924、reasoning 40,902。实际人民币扣费仍无法从 app ledger 确认。
- 后续排查发现设备账本里那条 `world_extract` 429 的冻结 endpoint 是本地故障注入 `10.0.2.2:8765`，不是 GLM；其同一 logical request 的 attempt 2 保持 `outcome_unknown`，未重派。另有独立开篇样本两次 HTTP 200。上述持久应用账本与开篇样本共 79 次已知记录（78 HTTP 200、1 次旧配置 HTTP 401；其中真实 GLM 429=0）。另两次面向 GLM 的宿主机 transport attempt 没有 HTTP status，dispatch outcome unknown，且 identity 未持久化；不能将其计作已确认成功/失败，不能重派。详情见 `evidence/glm-429-attribution-and-retest-sanitized.json` 与 `evidence/host-glm-pilot-transport-unknown-sanitized.json`。
- 公开 partial package 有 49 explicit 与 3 inference facts、52 个来源引用、8 skills、4 scenes、11 个角色模板；world package `method` 条目数仍为 0。第三局 campaign-scope artifact 另生成并实际提交 6 个显式 fixed difficulty / fixed empty evidence / rule-bound 的 L1 actions（无 Planner），同时真实 L2 行动产生 Planner；不证明非空来源 evidence 的 L1 或 package method 覆盖。
- 前两局分别有 5 与 1 个 agent-driven QA actions。第三局 main 有 8 个 actions、v1→v12；6 个 campaign-scope L1 与 2 个 L2 完成骰点、Narrator、原子提交和下一轮。stage-4 三项 deferred consequence 已消费。隔离 stage-5 branch 进入 stage 6，save-10 恢复后也成功续玩。新增 stage-8 两条 sibling branches 分别验证 terminal cancellation 和成功后果下游知识写入；本轮累计 19 个 agent-driven action turns，均不计真人决定。分支和状态详见 `GAMEPLAY_CAUSAL_REPLAY.md` 及 `evidence/android-terminal-consequence-cleanup-20261019.json`。
- 第二局终局页仍验证 `guidance-submit-*` 与观察行动为 0、composer disabled，作为 M3-02 的设备 GREEN。之后第三局 main 推进至 v12，stage-5 降级提示与安全自由输入也曾现场验证。该 main 保持 v12/r4；应用创建的隔离 branch `camp-mvdjtr22-bmvdq6wys` 后续经 stage-5 action 推进至 v15/r7，stage 5 succeeded、stage 6 active、stage 7/8 planned。最新设备 SQLite 完整性检查为 `ok`。
- 真实 save-10 已在原生 Android UI 恢复到新 campaign/branch，六条历史 turn 和两条历史 roll 的合同/hash/结果对照一致；恢复后新增一次行动并在冷启动后继续打开。详细证据见 `evidence/save10-device-restore-sanitized.json`。
- earlier device evidence had 3 deferred consequence trigger → discharge → downstream-consumption chains at turns 0010–0011. The latest isolated stage-5 branch additionally triggered and discharged `con-barov-offer`, then included its ID/result event and the affected entity in turn-0016 frozen context. The next Narrator HTTP status was not reconciled; no human response is claimed. See the dated latest review below.

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
5. 性能与无障碍：本轮非匹配的长会话样本 PSS 196,443 KB / RSS 285,960 KB；GfxInfo 累计 10,169 frames、modern jank 140 (1.38%)、p50/p90/p95 17/30/31 ms。它不是独立 benchmark。360×800dp 虚拟显示及旋转/暗色核心控件冒烟已运行；TalkBack 实际焦点/播报、API 24 和真实小屏物理设备仍未运行。Synthetic production fixture 的 matched 10+10 已通过，真实小说 package method/non-empty-source-evidence 样本仍缺。
6. 小说标题计数差异与实际模型人民币费用未知；不通过估算或改 parser 消除。
7. PR #15 保持开放且未合并。M7 仅按 PR Checks 页当前 head 的 Core Verify 与 Android Verify 判断；旧 SHA 的 success 不替代 exact-head 结果。核验 SHA、run 与状态记录在 PR 正文，不自动合并。

## 私有证据边界

- 带模型生成文本的截图只保存在本机，不加入仓库。第三局 v12 当前屏幕截图 SHA-256 `953FA7E8755212D12B8C3E26B7FD972C5BF1AA28525DEB8B18D1854FD496FC1F`，本地路径 `C:\Temp\shineword-phase95-local-final\after-stage5-fallback-l2.png`。
- 本轮小屏 Play 截图 SHA-256 `F98D9451488927A8A782E149832AA5E1A443553207981D74A93EEC7D59016F6A`，本地路径 `C:\Temp\sw95-phase95-active\small-before-maestro.png`。新提交的 save-10 与 stage-5 JSON 仅包含脱敏状态、标识和 hash，不含正文、提示词、响应、数据库或截图。
- 第三局状态 v12 的只读 SQLite 副本 SHA-256 `AF7BB3B76BA8F90636C77AE8CF7C34C6773124C0C92B7FE4B846D8F30DE4F8C5`，`integrity_check=ok`；完整 DB 仅留在本机。仓库新增的 `evidence/third-campaign-sanitized-summary.json` 不含剧情原文、提示词或密钥。
- 已提交的开局身份页截图只显示身份控件与空姓名输入，不含小说正文或生成剧情。未将密钥、小说正文、LLM 提示词/响应、数据库、终局截图加入 PR。

## 2026-10-19 自动化收口补充

- 本次重新读取远端：`origin/main=87eef899281f267a17e02357cc643dd475cabd7c`；工作在隔离 worktree `F:\sw95local-20261018`，原始 checkout 未改动。继 `d8d9c3e` 后完成 `39a8d15`/`e6a0bbd` 终局 consequence 修复；最终分支 SHA 与 exact-head CI 在最终 push 后补录。
- 新确认缺陷 `SW95-M6-02`：发布失败且 review queue 为空时，任务卡引导查看空审查列表，且没有诊断读模型。先用生产集成反例 RED，再增加类别-only 诊断投影与任务卡详情路径，修正通用错误提示。另以隐私断言证明并移除 segment ID 等非 UI 字段。该修复定向 GREEN；后续 Core 为 1,358/1,358。
- 独立 standalone APK `V1.0.0` / versionCode `1000000` SHA-256 为 `113B8EEB41EE167694C574F7B9506929352927F76697A83895059E1B6F7B979F`；两台现存 ShineWord AVD 安装后 pull 出的 base.apk 哈希一致。最新包 Maestro：主设备书库冷启动 run `2026-10-19_004700` 5/5，M4 设备打开战役列表 run `2026-10-19_004738` 7/7。该 exact `package_finalize_failed` UI 错误数据未出现在当前 live 项目，设备层该卡片精确展示仍 NOT VERIFIED；生产集成回归通过。
- 新增 live GLM matched 10+10：同一 synthetic production `CampaignSession`、非空 evidence、20/20 turn commit；L1 每次 1 Narrator / Planner=0，L2 每次 Planner+Narrator；30/30 物理请求 HTTP 200、并发峰值 1、未触及 cap 40。L1 平均 6,705.2 ms，L2 平均 8,900.5 ms。tap/exact-text 完整状态 parity 由无模型 production harness PASS。此结果不替代真实小说 package method path。
- 请求归因：matched run 汇总时为 111 个已知物理 attempt（110 HTTP 200、1 旧配置 HTTP 401），其后 stage-8 两条 UI action 各新增一次 Narrator HTTP 200。此次新增 2 次均串行、没有 unknown；两个历史 host transport unknown 仍未重派。真实 GLM 429=0；已汇总 token `1,152,193 / 265,801 / 41,097` 不含这两次新增调用。实际人民币费用无法从应用 ledger 确认。
- AVD 继续保持 3 个注册项；不增加模拟器。7 台不再使用的 ShineWord 注册 AVD 已删除。`F:\avd\Pixel_10.avd` 为约 20.16 GiB 未注册目录、归属不明，递归删除被安全审查拦截后保留，未绕过。
- 新确认并修复 `SW95-M6-03`：旧 APK 上键盘打开时首次点击目标提交按钮未生效（RED）；弹层 `ScrollView` 设置 `keyboardShouldPersistTaps="handled"` 后，保留数据安装的新 APK 在隔离 fork 上单击通过（GREEN）。最新 APK SHA-256 `A9987513029084AD8D37372A64421ACB32B63DDBD775976F18AEDED29A0169A0`；Core 1,358/1,358、mobile typecheck、version check、Debug APK 均通过。目标重规划 busy 已结束，UI 未显示 error/unknown；本次 UI 核验没有读取到 HTTP status，不将其记为 GLM 200。
- 补丁后只在新隔离 fork 上验证了单击目标提交与后续 busy 结束；本次没有以分支状态版本或骰点 UI 断言来证明一轮行动完成。真实小说 package 的非空 evidence L1 和 `method` 供给阻滞仍保留，详见下列未完成项。

### 自动化未关闭项

1. 真实小说 world package 当前 `method` entry 数为 0；因此真实原著 package 上 non-empty source-evidence L1 与 package method 供给仍未验证。Synthetic production live 10+10 不能代替此项。
2. 设备侧 Narrator 前/后 force-stop、响应已到但写盘失败、outbox 事务失败和旧 worker fencing 竞态矩阵仍不完整；现有 Planner 在途 force-stop 与 Core 原子性/fence 回归不能代替这些设备注入。
3. Stage-1/8 合法历史资产不可用；旧 schema migration、从当前设备 export/import round-trip 与完整 fork/rewind 隔离矩阵仍缺可核证设备数据。
4. TalkBack 实际焦点/播报、多窗口、API 24 与另一台真实小屏设备未完成。当前三台注册 AVD 中只有两台专用 API 37 ShineWord 设备；没有新增模拟器以填矩阵。
5. 已新增 stage-8 独立分支的 trigger→discharge→权威知识消费者对照；先前记载的 stage-5 `con-barov-offer` 在原著 main v12/r4 中仍未验证完整后续链，stage-5 QA branch 进入 stage 6 的证据不能代替它。
6. 本轮真人游玩与 4 人试玩由世恒哥自行安排，明确不算 agent 自动化交付阻滞，也没有宣称 PASS。
7. PR #15 的 Core Verify / Android Verify 只按当前 head 核验；最终 SHA、run 与结论以 PR 正文及 Checks 页面为准。

## 2026-10-19 最新复核：Canon scene evidence、stage 5 与真实小说审查门

- 新增 `SW95-M2-01`：同源公开 Lore 没有进入 Canon 场景 clue/dependency。合成 SQLite package RED 失败后，提交 `2e1a9c8` 只链接同 source fact 且公开、anchor-visible 的 Lore；定向 GREEN 与全量 `npm test` 1,359/1,359 通过。RED/GREEN 脱敏证据在 `evidence/canon-scene-lore-clue-{red,green}-20261019.json`。
- 新建隔离真实小说/GLM scope 再次走生产 world build，前 9,601 code points。timeline、world_extract、world_mapping 共 3 次物理请求，全部 HTTP 200，串行并发峰值 1；真实 GLM 429=0、unknown=0。SQLite 完整性 `ok`。正常 review gate 有 1 个 blocking `mapping_constraint` 与 3 个 major `invalid_proposal`，故 package 没发布；没有自动选案、修改审查结果或重派。脱敏数据 `evidence/real-novel-opening-sample-worldbuild-sanitized-20261019.json`。这次真实 scope 未到 package build、L1 或 Android 行动，不作为其通过证据。
- stage-5 隔离 branch 的 turn-0014 已触发并消费 `con-barov-offer`；turn-0016 frozen material root 包含该 consequence 与结果事件，语义只读检查发现下一轮 Narrator 文本提及受影响实体。下一轮 Narrator HTTP status 未对账；同种事件由 turn 与 consequence 不同 origin 各记录一次，作为内容重复观察保留，不定性为缺陷。证据 `evidence/stage5-con-barov-next-turn-sanitized-20261019.json`；此为 QA branch 因果链，不是玩家反馈或主线分支证明。
- 最新 `npm run apk:debug` standalone APK SHA-256 为 `0ACA6E449598342A409F05790F84C1BF7DF6C1C821A0439F49FDEA943B8D896F`，已 `adb install -r` 安装到 M4 AVD；保留数据，MainActivity 前台、进程在、最近 500 条 AndroidRuntime error=0。该轮 Maestro hierarchy 20 秒及冷启动 flow 30 秒均无结果，UI assertion NOT RUN；详见 `evidence/android-canon-scene-fix-install-smoke-sanitized-20261019.json`。
- 当前新增核心阻滞是新真实小说 package 仍停在内容审查 gate，无法验证真实 package 上非空 evidence L1；旧 host transport unknown 仍不可重派。stage-5 QA branch 因果上下文已有证据，不能替代 main 的玩家决定。
- AVD 实际盘点仍为 3 个已注册、2 个 ShineWord 专用实例在线；未新增或删除共享设备。`Pixel_10.avd` 未注册且归属未明，自动审查拒绝递归删除后继续保留，未换渠道绕过。
