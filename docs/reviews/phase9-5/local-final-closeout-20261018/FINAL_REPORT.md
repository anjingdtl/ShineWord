# ShineWord Phase 9.5 本地最终收口报告

日期：2026-10-18（Asia/Shanghai）
工作树：F:\sw95local-20261018
分支：fix/phase95-local-final-closeout-20261018-short

## 结论

- Runtime 收束工程：M6 的有界开局证据恢复修复达到 PASS-ENGINEERING；当前分支 Core、mobile typecheck、Debug APK 与安装回归通过。设备的旧 finalization task 使用已完成 extraction 响应后达到 4/4 和 ready。该 scoped result 不代表完整 Runtime 玩法已收口。
- 阶段 9.5：PARTIAL。真实小说 SAF 导入和有限 GLM 世界样本成功并可打开开局页；真实 L1 未确认，角色/战役/玩家行动/Narrator/原子 turn commit/下一轮剧情均未由玩家完成。
- 阶段 9 历史遗留：PARTIAL。真实有效决定 0/80，独立试玩 0/4，自然结局 NOT RUN，真实 L1/L2 matched performance 10+10 NOT RUN；历史 save-10 和 Stage-1/8 为 BLOCKED-ASSET。

## 基线与变更

- 重新 fetch 后 origin/main 为 `87eef899281f267a17e02357cc643dd475cabd7c`，PR #14 已包含；原 main 和其他既有 worktree 未改写。
- 本分支从该基线开始，M0、M1、M6 与 M2–M5 各自保留独立提交。M7 文档提交完成后，最终 SHA 以当前 PR HEAD 为准。
- 本地 PR/CI 尚待 M7 推送后建立与验证。待创建 PR 将只针对 main，不自动合并；Core Verify 和 Android Verify 必须绑定 PR 的实际最终 HEAD。基线 PR #14 的 CI 不能代替本轮结果。

## 核心验证

- M6 RED：结构化 `opening_entity_unproven` 反例原先预期触发、实际未触发；legacy 中文信号通过。最小 helper 修复后定向 2/2 GREEN。
- `npm run verify:core`：1,344/1,344 passed，0 failed、0 skipped；本次收口复跑 33.97 s。
- mobile TypeScript typecheck：通过；Debug APK Gradle 构建：成功。
- 当前 M6 APK 与设备 installed base.apk SHA-256 一致：`B42AAE7C176D80A49B9C7605375F6B93332FB53405F522291798290B1F1F5843`。
- AVD `ShineWord_Phase95_LocalFinal_20261018`（API 37 / Android 17，1080×2400 @420 dpi）书库、项目 hub、开局身份页通过；姓名框不输入内容时正确禁用下一步。当前模拟器保留在开局身份页等真人选择。

## 真实小说和模型

- 原始小说 SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`，7,178,905 bytes，Windows-936/GBK。仅本机处理；partial package 的模型 scope 为 0–9,600 code points，未发送全书。
- 3 次 GLM 成功：world_extract ×2、style_analyzer ×1；合计 input 9,569、output 6,201、reasoning 20 tokens。另 1 次 opening_goal 是已知 HTTP 401，无 usage/provider request ID；CNY 实际费用未知。用户已授权不限请求/费用，本轮并发峰值仍为 1。
- 用户已说明密钥已轮换，但本地 `GLM-TEST.txt` 时间戳未更新；模拟器读取的配置仍返回 401。没有重试该配置，也未要求用户将密钥贴入聊天；待本地文件更新后再继续真实模型请求。
- 早先 Maestro 输入密钥的一次本地运行曾在运行诊断中暂存凭据字节。对应诊断在任何后续模型调用前完成脱敏；本轮再次保存配置的诊断也在检查后清除。当前可检索诊断中密钥匹配数为 0；没有把值写入仓库或报告。用户已知此安全事件。
- 本地 429 fixture 记录 1 次 loopback HTTP 429；原项目后续 network_unknown 保留在 needs_review，没有重派，不属于 GLM 请求。

## 阻滞与下一步

1. 用户更新本机有效 GLM key 后，重新进入模拟器 opening 页，确认真实 `opening_goal` 成功；随后由真人决定身份、姓名、地点/锚点与行动，继续观察 L1/L2、骰点、Narrator、commit 和下一轮机会。
2. 真实模型费用需要从用户实际账户账单确认；本机 request ledger 只有 token usage，没有 CNY 费用字段。
3. 小说本地章节标题计数 1,498 与 Android parser 1,504 的差异尚未归因；不能静默规范化或减弱证据。
4. 真实 action fault matrix、完整历史数据恢复和外部试玩仍未完成；缺少合法 save-10 / Stage-1/8 identity-bound assets。
5. M7 完成后，推送修复分支、创建 PR，等待实际 PR HEAD 的 Core Verify 与 Android Verify 全绿；最终 URL、SHA 和 workflow checks 以 PR 实测回填到报告与 CHECKPOINT。
