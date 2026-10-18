# Checkpoint

更新时间：2026-10-18（Asia/Shanghai）
工作树：`F:\sw95local-20261018`
分支：`fix/phase95-local-final-closeout-20261018-short`

## 当前结论

- **阶段 9.5：PARTIAL。** 已完成真实小说导入、已测通 GLM 配置、Android 开局和三局 agent-driven QA，共 14 个 action turns。第三局有 6 个 campaign-scope L1、2 个 L2、骰点/原子提交与 3 个延迟结果消费者；不将执行者操作算作真人决定。stage 5 仍缺可采用的内容候选。
- **Runtime 工程收束：PASS-ENGINEERING（列明范围）。** M6 结构化开篇证据补建、M3 Canon 方案采用、M3 终局行动门控均具 RED→GREEN 证据；最新 Core 1,348/1,348，mobile typecheck 与 version check 通过，Debug APK 已安装且 hash 匹配。
- **阶段 9 历史遗留：PARTIAL。** 真人决定 0/80；独立试玩 0/4；自然结局、非空 evidence L1、L1/L2 matched 10+10、TalkBack 与历史存档矩阵未验；stage 5 和第四项延迟消费者未完成；save-10 / Stage-1/8 为 BLOCKED-ASSET。

## 节点状态

- M0：PASS-ENGINEERING。最新 `git ls-remote` 确认远端 main 实际 HEAD=`87eef899281f267a17e02357cc643dd475cabd7c`；施工工作树隔离，原工作树和其他本地账本未改写。
- M1：PASS-DEVICE（限定范围）。API 37 专用 AVD 上运行当前 Debug APK，安装包与构建物 SHA-256 均为 `C5B27FAEAAF8B1DF60946A8B826952DC4C1EC77A3AB4EA3BC26072FDFA26AF10`；三局 Android action/roll/commit 真实运行。当前第三局 stage 5 内容准备失败并降级。
- M2：PARTIAL。真实 GBK 小说仅以 0–9,600 code points partial scope 供 GLM 建包；设备解析 1,504 章。opening_goal HTTP 200；campaign-scope 六个 L1 合法提交，method package entry 仍为 0，章节计数差异待查。
- M3：PARTIAL / HUMAN-ACCEPTANCE-NOT-RUN。三个 branch、5+1+8 个 agent-driven actions；第三局推进 stage 1–4 并验证 3 项后果消费者，stage 5 内容 unresolved。真人仍需作决定。
- M4：PARTIAL。真实 GLM 旧配置 401 保留；小说 world 无 unknown/在途请求。旧 `world_extract outcome_unknown` 属于独立 mock world，保留未清账、未重派。live gameplay crash/outbox/force-stop 矩阵未跑，旧存档资产缺失。
- M5：PARTIAL。键盘、字号与当前降级指导/自由输入页已检查；长会话采样 PSS 196,443 KB / RSS 285,960 KB，GfxInfo 10,169 frames、1.38% modern jank、p50/p90/p95 17/30/31 ms，不是独立 benchmark。TalkBack 与匹配 10+10 未跑。
- M6：PASS-ENGINEERING；设备范围通过。结构化 recovery helper RED→GREEN，Core 1,348/1,348，typecheck / version check / Debug APK 通过。
- M7：PR #15 已承载最终修复和本次更新的报告，未合并。每次推送后，Core Verify 与 Android Verify 必须按 PR 页面实际当前 SHA 核验；旧 HEAD 与 PR #14 结果不作最终 SHA 证据。

## GLM 账本快照

用户明确授权本项目不限额度；小说 world 与三个 branch 的物理 attempt ledger 峰值并发 2，且本轮最终无在途请求。当前账本汇总：

| Request kind | 成功 | 已知失败 | outcome_unknown |
|---|---:|---:|---:|
| campaign_plan | 22 | 0 | 0 |
| narrator | 14 | 0 | 0 |
| opening_goal | 3 | 1（旧配置 HTTP 401） | 0 |
| planner | 8 | 0 | 0 |
| memory_checkpoint | 2 | 0 | 0 |
| style_analyzer | 1 | 0 | 0 |
| world_extract | 3 | 1 | 1（旧记录）|

表中 world_extract 成功 3 次属于小说 GLM world；该行 1 次 HTTP 429 失败和 1 条 outcome_unknown 属于单独 localhost mock world。真实小说 GLM 与三个 branch 合计 53 次成功、1 次旧配置 HTTP 401、0 unknown；成功调用 input/output/reasoning 合计 587,980 / 153,011 / 20,845 tokens。人民币实扣金额无设备账本证据。mock unknown 未重派。

## 当前模拟器与数据保护

- AVD `ShineWord_Phase95_LocalFinal_20261018` / `emulator-5556`，API 37。当前第三局 Runtime active、branch state v12、primary node stage 5；stage 5 `content_prep` unresolved，界面显示失败/降级状态，但通用 guidance 与 freeform composer 可用，L2 turn-0012 已成功提交。
- 三局 Runtime 与 novel world 留在模拟器供用户检查。应用数据、Keychain 与源文件没有通过清库或覆盖处理。
- 第三局只读数据库快照 SHA-256 `AF7BB3B76BA8F90636C77AE8CF7C34C6773124C0C92B7FE4B846D8F30DE4F8C5`，SQLite integrity check `ok`；完整快照在本机，仓库只有脱敏摘要。
- 旧 `world_extract outcome_unknown` 仍是唯一非终结账本状态，属于独立 mock world；小说真实请求无 unknown、无在途请求、没有 replay。

## 下一步与阻滞

1. 推送最终分支后，确认 GitHub PR #15 head 与本地 HEAD 一致，等待并验证该精确 SHA 的 Core Verify / Android Verify。
2. 真人仍需选择并完成 80 个有效决定；外部试玩 0/4。
3. 需要非空来源证据 L1、stage 5 可采用内容、第四项 deferred consumer 与玩家后续回应；不能放宽 validator 或手工补造小说 package method。
4. 需要合法旧存档与 live crash/outbox 测试，以及匹配 10+10 的 L1/L2 性能数据。
5. 章节计数差异和真实 CNY 费用未知。
