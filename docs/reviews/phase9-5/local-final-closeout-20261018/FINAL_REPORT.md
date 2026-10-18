# ShineWord Phase 9.5 本地最终收口报告

日期：2026-10-18（Asia/Shanghai）
工作树：`F:\sw95local-20261018`
分支：`fix/phase95-local-final-closeout-20261018-short`
远端：`https://github.com/anjingdtl/ShineWord`
PR：[ #15 Phase 9.5 local final closeout and opening evidence recovery ](https://github.com/anjingdtl/ShineWord/pull/15)

## 分阶段结论

- **阶段 9.5：PARTIAL。** 真实 GBK 小说 partial world、已测通 GLM 配置和当前分支 Debug APK 在专用 API 37 AVD 上完成真实开局与 agent-driven QA。三局主线有 14 个行动级提交，另一个隔离分支有 1 个 method-bound action turn，共 15 个，全部由测试执行者驱动。骰点、Narrator、原子提交、下一轮和 3 项延迟后果消费均有 SQLite/物理请求账本证据。campaign-scope L1 均使用显式固定空 evidence policy；stage 5 内容候选经 validator 拒绝，完整剧情仍阻滞。所有 QA 选择均不计真人决定或独立试玩。
- **Runtime 工程收束：PASS-ENGINEERING（列明范围）。** 六项确认代码缺陷均具 RED → 最小修复 → GREEN 证据：结构化开局证据补建、Canon 开局方案采用、终局/暂停状态行动门控、effect 上限 repair guidance、long-plan consequence repair guidance、stage completion producer repair guidance。最新全量 Core 1,354/1,354、mobile typecheck、version check 通过；当前 APK 已在保留原应用数据的 AVD 安装，二进制身份匹配。
- **阶段 9 历史遗留：PARTIAL。** 人类有效决定 0/80、独立试玩 0/4、自然结局未验、L1/L2 匹配性能 10+10 未验；合法 save-10 与 Stage-1/8 历史资产缺失。自动化、代理 QA、模型生成内容和 CI 不替代这些验收。

## 基线、提交与 CI

- 再次 `git fetch origin` 后，实际 `origin/main` 为 `87eef899281f267a17e02357cc643dd475cabd7c`。原本地仓库、main 与其他工作树保持原样；施工在隔离工作树完成。
- 已独立提交的六项代码修复：`dd17ccf`（bounded opening evidence recovery）、`8ab0419`（Canon 开局方案采用）、`3847339`（Runtime 终局行动门控）、`00f3625`（bounded campaign effect repair）、`b6c7d00`（missing long-plan consequence repair）、`cbacbb0`（local stage completion repair guidance）。三个 campaign-plan guidance 缺陷均先增加 helper 与 retry 集成 RED，再最小修复并分别 GREEN。
- PR #15 针对 main 开放且未合并。已验证 head `c0ae86e3c6b9853faee1c397f73491c7aa11fbae` 的 Core Verify run 147 (`39120253593`) 与 Android Verify run 111 (`39120253591`) 均 success。后续仅报告状态更新仍需 push 并核验当前 PR HEAD；基线 PR #14 或旧 PR head 的 CI 不代替最终 HEAD 验证。

## 本地回归与 Android 包

- `npm ci --ignore-scripts --no-audit --no-fund` 与 `npm --prefix mobile ci --no-audit --no-fund`：均退出码 0。
- `npm run verify:core`：1,354/1,354 passed，0 failed / skipped，37.58 s。
- `npm --prefix mobile run typecheck`：通过；`npm run verify:version`：通过（1.0.0 / versionCode 1000000）。
- `mobile/android/gradlew.bat :app:assembleDebug --stacktrace`：BUILD SUCCESSFUL，1m27s；构建期 `mobile/src/version.json` hash 未改变。
- 最终报告修改完成后执行 `git diff --check` 并通过；代码相关验证均在 `cbacbb0` 后当前源码上完成。
- 当前 Debug APK：`F:\sw95local-20261018\dist\apk\debug\ShineWord-V1.0.0-debug.apk`；本地构建与模拟器安装包 SHA-256 均为 `3B3A8A33463F74A37617BBE5B47B000D80CC1BBE51972D00404D3E5A6BE03167`。
- 专用 AVD `ShineWord_Phase95_LocalFinal_20261018`，设备 `emulator-5556`，API 37 / Android 17 / 1080×2400 @420 dpi。使用 `adb install -r`，没有清除数据库、小说、Keychain 或模拟器数据。

## 小说、真实模型和游玩证据

- 原小说 SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`，7,178,905 bytes，Windows-936/GBK。设备解析 1,504 章、3,260 chunks；本轮 GLM scope 只覆盖 0–9,600 code points，未上传全书。章节计数 1,498 与设备解析 1,504 的差异仍待归因。
- GLM 配置更新并通过设备连接测试后，`opening_goal` 与后续 L1/L2、Narrator、campaign plan 均真实 HTTP 200。按小说 world、其三个 campaigns 及映射 branches 的物理 attempt 去重：65 次请求，64 次成功、1 次旧配置 HTTP 401、真实模型 unknown=0、在途=0；观察窗口峰值并发 2，后续调用依次等待。token totals：输入 846,768、输出 204,224、reasoning 30,202。独立 localhost mock world 的 429 与 `outcome_unknown` 分开保留。用户授权不设模型额度上限；账户人民币实际扣费无法从设备账本确认。
- 公开 partial package 有 49 explicit 与 3 inference facts、52 个来源引用、8 skills、4 scenes、11 个角色模板；world package `method` 条目数仍为 0。第三局 campaign-scope artifact 另生成并实际提交 6 个显式 fixed difficulty / fixed empty evidence / rule-bound 的 L1 actions（无 Planner），同时真实 L2 行动产生 Planner；不证明非空来源 evidence 的 L1 或 package method 覆盖。
- 前两局分别有 5 与 1 个 agent-driven QA actions，既有骰点与终局证据仍保留。第三局有 8 个 actions，状态 v1→v12：L2 turn-0002 使用 Planner/Narrator；L1 turn-0003/0006/0008/0009/0010/0011 仅需 Narrator；stage 4 turn-0011 `[4,5,6]` / 3d6 / difficulty 3 / margin +3 full_success 原子提交 v10→v11，随后三个 deferred consequences 消费；stage 5 自由输入 L2 turn-0012 用 Planner/Narrator 成功并提交 v11→v12。另在 `camp-mvdjtr22-bmvdo8467` branch 从 v9 提交 `turn-0010` 至 v10，结果 failure，Narrator HTTP 200 且 Planner=0。另有空 v11 rewind branch，无 action、无模型请求。全局共 15 个 agent-driven action turns，均不计真人决定。
- 第二局终局页仍验证 `guidance-submit-*` 与观察行动为 0、composer disabled，作为 M3-02 的设备 GREEN。之后在保留数据的 AVD 上创建第三局并推进到 v12；当前活动 Runtime 为 stage 5，stage 5 `content_prep` 未解决，UI 显示准备失败/降级指导，3 个 guidance 与自由输入仍可用，空输入时 submit disabled。
- 真实因果范围从即时 counter 扩展到代理 QA 分支上的 3 项 deferred consequence 已触发并消费：turn-0010 消费 `conseq-town-tension`；turn-0011 消费 `conseq-barov-attention` 与 `con-tension-peaked`。`con-barov-offer` 仍 pending，因 stage 5 content prep unresolved，未验证第四项消费者与玩家后续回应。

## 缺陷修复登记

- `SW95-M6-01`：发布验证返回结构化 `opening_entity_unproven` 时，旧恢复条件只看中文错误消息，漏掉有界开篇补建。RED 后新增只识别该 machine-code 前缀的判定 helper；定向 2/2 GREEN，不改 validator、scope 或 ledger。
- `SW95-M3-01`：Canon 开局计划把规划阶段建议技能错误写入 `initialSkills`，导致采用时与 Canon payload 比较触发假 drift。RED 后只在 Canon intent 不绑定规划建议技能，并兼容已存旧建议字段；定向 5/5 GREEN。
- `SW95-M3-02`：Runtime 已 `failed` / `paused` 时，Play projection 仍显示可变更行动且 controller 允许直接提交。RED 后把权威 campaign status 投影至 UI，并在 UI/controller 两层门控；保留只读查看线索。定向 7/7 GREEN，安装后的终局页复测通过。
- `SW95-M3-03/04/05`：stage completion producer、effect-array 上限、long-plan consequence 数量的 validator 错误原先没有合同保真的 repair guidance。三项各自以 helper + generation retry 集成反例先 RED，再分开提交最小 guidance 修复并 GREEN。修复后 stage-5 新 job 两次 HTTP 200，但候选转而因 `skill_check` 的 `destinationId` 无效而被 validator 拒绝，未采用，不能声称 stage 5 已通过。
- 复核未新增第二套 Runtime、状态权威、规则语义或账本；未放宽既有内容验证，也未改写冻结 turn、骰点或历史 unknown。

## 未完成项 / 明确阻滞

1. L1：6 次真实 L1 使用 campaign-scope fixed empty evidence 与规则绑定；world package 仍无 method entry，非空 evidence L1 与 legacy 缺字段内容不得通过默认推断补齐。
2. 真人与外部验收：0/80 真人决定、0/4 独立试玩；本轮默认角色、行动与骰点由执行者用于 QA。
3. stage 5：早期 v10 计划因缺少 ordinary-success 完成 effect producer 被拒；v11 候选两次 HTTP 200 后因 full_success/success effect 数超过 8 被 validator 拒。针对前一问题的代码修复有 RED→GREEN；修复后的新 job 2/2 HTTP 200，但候选因 `firstSituation.methods[1].firstStep.destinationId: not valid for skill_check` 被拒且未采用。revision 4 只含 stage 4 situation，stage 5 `content_prep` unresolved。已消费的 3 项延迟后果为 agent-driven，第四项和玩家后续反馈未验。
4. 旧存档与故障恢复：save-10、Stage-1/8 不存在于隔离 AVD；live turn force-stop、Narrator 前后杀进程、outbox 与旧 worker 矩阵未执行。
5. 性能与无障碍：本轮非匹配的长会话样本 PSS 196,443 KB / RSS 285,960 KB；GfxInfo 累计 10,169 frames、modern jank 140 (1.38%)、p50/p90/p95 17/30/31 ms。它不是独立 benchmark。TalkBack、API 24、小屏和 10+10 L1/L2 matched test 未运行。
6. 小说标题计数差异与实际模型人民币费用未知；不通过估算或改 parser 消除。
7. PR #15 保持开放且未合并；上述代码/closeout HEAD 两项 exact-head CI 均通过。最后的 CI 状态说明提交仅变更验收文档；推送后还须核对这个最新 HEAD 的两项 check，不自动合并。

## 私有证据边界

- 带模型生成文本的截图只保存在本机，不加入仓库。第三局 v12 当前屏幕截图 SHA-256 `953FA7E8755212D12B8C3E26B7FD972C5BF1AA28525DEB8B18D1854FD496FC1F`，本地路径 `C:\Temp\shineword-phase95-local-final\after-stage5-fallback-l2.png`。
- 第三局状态 v12 的只读 SQLite 副本 SHA-256 `AF7BB3B76BA8F90636C77AE8CF7C34C6773124C0C92B7FE4B846D8F30DE4F8C5`，`integrity_check=ok`；完整 DB 仅留在本机。仓库新增的 `evidence/third-campaign-sanitized-summary.json` 不含剧情原文、提示词或密钥。
- 已提交的开局身份页截图只显示身份控件与空姓名输入，不含小说正文或生成剧情。未将密钥、小说正文、LLM 提示词/响应、数据库、终局截图加入 PR。
