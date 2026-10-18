# Checkpoint

更新时间：2026-10-18（Asia/Shanghai）
工作树：`F:\sw95local-20261018`
分支：`fix/phase95-local-final-closeout-20261018-short`

## 当前结论

- **阶段 9.5：PARTIAL。** 已完成真实小说导入、已认证 GLM 调用、Android 开局和两局代理 QA。六个行动级测试操作中，Planner/Narrator、骰点、原子提交及后续规划均有实际账本证据；没有将执行者操作算作真人决定。L1 因当前 partial world package 没有 method entry 而无法执行。
- **Runtime 工程收束：PASS-ENGINEERING（列明范围）。** M6 结构化开篇证据补建、M3 Canon 方案采用、M3 终局行动门控均具 RED→GREEN 证据；最新 Core 1,348/1,348，mobile typecheck 与 version check 通过，Debug APK 已安装且 hash 匹配。
- **阶段 9 历史遗留：PARTIAL。** 真人决定 0/80；独立试玩 0/4；自然结局、真实延迟消费、L1/L2 matched 10+10、TalkBack 与历史存档矩阵未验；save-10 / Stage-1/8 为 BLOCKED-ASSET。

## 节点状态

- M0：PASS-ENGINEERING。最新 fetch 确认 `origin/main=87eef899281f267a17e02357cc643dd475cabd7c`；施工工作树隔离，原工作树和其他本地账本未改写。
- M1：PASS-DEVICE（限定范围）。API 37 专用 AVD 上运行当前 Debug APK，安装包与构建物 SHA-256 均为 `C5B27FAEAAF8B1DF60946A8B826952DC4C1EC77A3AB4EA3BC26072FDFA26AF10`；已验证导入世界、开局、行动、结局页。
- M2：PARTIAL。真实 GBK 小说只以 0–9,600 code points partial scope 供 GLM 建包；设备解析 1,504 章。opening_goal HTTP 200；L1 因 `method` entry 为 0 阻滞，章节计数差异待查。
- M3：PARTIAL / HUMAN-ACCEPTANCE-NOT-RUN。两局均由 QA 执行者选定 Canon Roland、锚点、目标和行动；5+1 个行动级试验提交，第二局在一次 severe failure 与两次 replan 后进入 `ending-failure`。两个真实 Runtime 均能存取；真人仍需作决定。
- M4：PARTIAL。真实 GLM 只有更新前的 401 已知失败；旧 `world_extract outcome_unknown` 属于独立 mock world，保留未清账、未重派。当前没有 `prepared/sent` 请求。live gameplay crash/outbox/force-stop 矩阵未跑，旧存档资产缺失。
- M5：PARTIAL。键盘、字号和当前终局页检查通过；长会话采样 PSS 196,443 KB / RSS 285,960 KB，GfxInfo 10,169 frames、1.38% modern jank、p50/p90/p95 17/30/31 ms，不是独立 benchmark。TalkBack 与匹配 10+10 未跑。
- M6：PASS-ENGINEERING；设备范围通过。结构化 recovery helper RED→GREEN，Core 1,348/1,348，typecheck / version check / Debug APK 通过。
- M7：PR #15 已承载最终修复和报告，未合并。推送完成后，Core Verify 与 Android Verify 必须按 PR 页面当前 SHA 核验；旧 HEAD 与 PR #14 结果不作本轮证据。

## GLM 账本快照

用户明确授权本项目不限额度；实际物理并发峰值 1。当前设备 ledger 汇总：

| Request kind | 成功 | 已知失败 | outcome_unknown |
|---|---:|---:|---:|
| campaign_plan | 10 | 0 | 0 |
| narrator | 6 | 0 | 0 |
| opening_goal | 3 | 1（旧配置 HTTP 401） | 0 |
| planner | 6 | 0 | 0 |
| style_analyzer | 1 | 0 | 0 |
| world_extract | 3 | 1 | 1（旧记录）|

表中 world_extract 成功 3 次属于小说 GLM world；该行 1 次 HTTP 429 失败和 1 条 outcome_unknown 属于单独 localhost mock world。真实小说 GLM 合计 29 次成功、1 次旧配置 HTTP 401；真实 world 没有 unknown。成功调用 input/output/reasoning 合计 261,323 / 69,611 / 7,729 tokens。人民币实扣金额无设备账本证据。mock unknown 未重派。

## 当前模拟器与数据保护

- AVD `ShineWord_Phase95_LocalFinal_20261018` / `emulator-5556`，API 37。最终停在 Runtime failed 的终局页；没有行动提交按钮，composer disabled。
- 两局 Runtime 与 novel world 留在模拟器供用户检查。应用数据、Keychain 与源文件没有通过清库或覆盖处理。
- 本地完整数据库只读快照 SHA-256 `673695A70BC6DE208C0AE99A0DA3749CDF951C03FF7942EFB47BD8935C61F04C`，SQLite integrity check `ok`；包含本地剧情与游戏状态，不提交。
- 旧 `world_extract outcome_unknown` 仍是唯一非终结账本状态；不在途调用，也没有 unknown replay。

## 下一步与阻滞

1. 推送最终分支后，确认 GitHub PR #15 head 与本地 HEAD 一致，等待并验证该精确 SHA 的 Core Verify / Android Verify。
2. 真人仍需选择并完成 80 个有效决定；外部试玩 0/4。
3. 需要有 provenance 且具备固定难度、evidence binding、ruleset 绑定的 L1 方法内容；不能为测试在本轮给小说包临时造方法。
4. 需要触发并消费的真实 delayed consequence、旧存档与 live crash/outbox 测试，以及匹配 10+10 的 L1/L2 性能数据。
5. 章节计数差异和真实 CNY 费用未知。
