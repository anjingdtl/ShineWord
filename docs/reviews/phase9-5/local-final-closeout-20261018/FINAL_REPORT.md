# ShineWord Phase 9.5 本地最终收口报告

日期：2026-10-18（Asia/Shanghai）
工作树：`F:\sw95local-20261018`
分支：`fix/phase95-local-final-closeout-20261018-short`
远端：`https://github.com/anjingdtl/ShineWord`
PR：[ #15 Phase 9.5 local final closeout and opening evidence recovery ](https://github.com/anjingdtl/ShineWord/pull/15)

## 分阶段结论

- **阶段 9.5：PARTIAL。** 已用真实 GBK 小说、已认证 GLM 配置和当前分支 Debug APK，在专用 Android 37 模拟器上完成导入、开局、实际 Planner/Narrator 调用、骰点、原子 turn 提交、后续规划及终局 UI 检查。两局均由执行者按 QA 场景操作，不能算真人决定或独立试玩。当前 partial 世界没有任何合格的 package method entry，L1 物理路径未运行；最终状态也没有已消费的延迟后果。
- **Runtime 工程收束：PASS-ENGINEERING（列明范围）。** 三项确认代码缺陷都具备 RED → 最小修复 → GREEN 证据：结构化开局证据补建、Canon 开局方案采用、终局/暂停状态禁止继续提交变更行动。最新全量 Core 1,348/1,348、mobile typecheck、version check 通过；当前 APK 已在保留原应用数据的 AVD 安装，二进制身份匹配。
- **阶段 9 历史遗留：PARTIAL。** 人类有效决定 0/80、独立试玩 0/4、自然结局未验、L1/L2 匹配性能 10+10 未验；合法 save-10 与 Stage-1/8 历史资产缺失。自动化、代理 QA、模型生成内容和 CI 不替代这些验收。

## 基线、提交与 CI

- 再次 `git fetch origin` 后，实际 `origin/main` 为 `87eef899281f267a17e02357cc643dd475cabd7c`。原本地仓库、main 与其他工作树保持原样；施工在隔离工作树完成。
- 已独立提交的代码修复：`8ab0419`（Canon 开局方案采用）与 `3847339`（Runtime 终局行动门控）。M6 有界补建修复与各节点文档提交保留原提交历史。
- PR #15 针对 main 开放且未合并。精确最终 HEAD 的 Core Verify / Android Verify 结果以 [PR #15 checks](https://github.com/anjingdtl/ShineWord/pull/15/checks) 上显示的当前 SHA 为准；基线 PR #14 和旧 PR head 的 CI 不代替本轮验证。

## 本地回归与 Android 包

- `npm run verify:core`：1,348/1,348 passed，0 failed / skipped，36.92 s。
- `npm --prefix mobile run typecheck`：通过；`npm run verify:version`：通过（1.0.0 / versionCode 1000000）。
- 当前 Debug APK：`F:\sw95local-20261018\dist\apk\debug\ShineWord-V1.0.0-debug.apk`；本地构建与模拟器安装包 SHA-256 均为 `C5B27FAEAAF8B1DF60946A8B826952DC4C1EC77A3AB4EA3BC26072FDFA26AF10`。
- 专用 AVD `ShineWord_Phase95_LocalFinal_20261018`，设备 `emulator-5556`，API 37 / Android 17 / 1080×2400 @420 dpi。使用 `adb install -r`，没有清除数据库、小说、Keychain 或模拟器数据。

## 小说、真实模型和游玩证据

- 原小说 SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`，7,178,905 bytes，Windows-936/GBK。设备解析 1,504 章、3,260 chunks；本轮 GLM scope 只覆盖 0–9,600 code points，未上传全书。章节计数 1,498 与设备解析 1,504 的差异仍待归因。
- GLM 配置更新后，`opening_goal` 实际 HTTP 200。小说真实世界有 29 次成功和 1 次旧配置 HTTP 401；独立 localhost mock world 另有 1 次 429 和 1 条 `world_extract outcome_unknown`，不计作 GLM 失败。两份 ledger 未重派/确认/清除 unknown。真实成功调用并发峰值 1；token totals：输入 261,323、输出 69,611、reasoning 7,729。用户授权不设模型额度上限；账户人民币实际扣费无法从设备账本确认。
- 公开 partial package 有 49 explicit 与 3 inference facts、52 个来源引用、8 skills、4 scenes、11 个角色模板；`method` 条目数为 0。故真实 L1 eligibility 缺内容依据，不能把 `Planner` 次数或本地建议冒充 L1；真实 L2 Planner 路径已运行。
- 第一局有 5 个代理 QA 行动，含真实 GLM Planner/Narrator、骰点、原子提交及后续行动机会；其中 talk 成功将 testimony counter 从 0 增至 10，后续失败最终把 Runtime 推到 `failed` / `ending-case-lost`。第二局有 1 个代理 QA 行动：Planner 与 Narrator 成功，骰点 `[1]`、d4、难度 4、余量 -3，state version 2→3 原子提交；后续两次 replan 提交到版本 5，并产生 `ending-failure`。一次严重失败即进入结局是值得独立玩家评价的可玩性观察，不据此直接定性为代码缺陷或合格自然结局。
- 在第二局终局页，`guidance-submit-*` 与观察行动按钮数量为 0，输入框 disabled；此为终局行动门控的设备 GREEN 证据。设备最终停在该终局页，没有再提交行动。
- 真实因果范围仍有限：testimony +10 在后续状态中保留，但两局最终 `deferredConsequences` 均为空；延迟结果触发/消费及其后续玩家反馈没有通过。

## 缺陷修复登记

- `SW95-M6-01`：发布验证返回结构化 `opening_entity_unproven` 时，旧恢复条件只看中文错误消息，漏掉有界开篇补建。RED 后新增只识别该 machine-code 前缀的判定 helper；定向 2/2 GREEN，不改 validator、scope 或 ledger。
- `SW95-M3-01`：Canon 开局计划把规划阶段建议技能错误写入 `initialSkills`，导致采用时与 Canon payload 比较触发假 drift。RED 后只在 Canon intent 不绑定规划建议技能，并兼容已存旧建议字段；定向 5/5 GREEN。
- `SW95-M3-02`：Runtime 已 `failed` / `paused` 时，Play projection 仍显示可变更行动且 controller 允许直接提交。RED 后把权威 campaign status 投影至 UI，并在 UI/controller 两层门控；保留只读查看线索。定向 7/7 GREEN，安装后的终局页复测通过。
- 复核未新增第二套 Runtime、状态权威、规则语义或账本；未放宽既有内容验证，也未改写冻结 turn、骰点或历史 unknown。

## 未完成项 / 明确阻滞

1. L1：当前世界 package 不含 method entry；不能对缺少 `difficultyPolicy` / `evidenceBinding` 的 legacy 内容做默认推断。
2. 真人与外部验收：0/80 真人决定、0/4 独立试玩；本轮默认角色、行动与骰点由执行者用于 QA。
3. 延迟后果：无一个可核验的已触发且已消费 delayed consequence 消费者链。
4. 旧存档与故障恢复：save-10、Stage-1/8 不存在于隔离 AVD；live turn force-stop、Narrator 前后杀进程、outbox 与旧 worker 矩阵未执行。
5. 性能与无障碍：本轮非匹配的长会话样本 PSS 196,443 KB / RSS 285,960 KB；GfxInfo 累计 10,169 frames、modern jank 140 (1.38%)、p50/p90/p95 17/30/31 ms。它不是独立 benchmark。TalkBack、API 24、小屏和 10+10 L1/L2 matched test 未运行。
6. 小说标题计数差异与实际模型人民币费用未知；不通过估算或改 parser 消除。
7. PR #15 未合并；最终 HEAD 与两项 exact-head CI 需以 PR checks 实际结果核对，不自动合并。

## 私有证据边界

- 带模型生成文本的最新终局截图仅保存在本机 `C:\Temp\shineword-phase95-local-final\after-plans.png`（SHA-256 `7E8DE69217CB96A843B3B6D5E69AFEAC3832DE4731201C1145DD2C28CC2A3F4D`），不加入仓库。
- 只读 SQLite 证据副本 `C:\Temp\shineword-phase95-local-final\shineword-current.db`（SHA-256 `673695A70BC6DE208C0AE99A0DA3749CDF951C03FF7942EFB47BD8935C61F04C`，`integrity_check=ok`）只留在本机；不包含密钥值，但含本地世界与测试状态，因此不提交。
- 已提交的开局身份页截图只显示身份控件与空姓名输入，不含小说正文或生成剧情。未将密钥、小说正文、LLM 提示词/响应、数据库、终局截图加入 PR。
