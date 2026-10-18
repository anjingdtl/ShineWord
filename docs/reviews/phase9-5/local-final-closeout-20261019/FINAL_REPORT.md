# ShineWord 第 9.5 阶段本地最终收口报告

日期：2026-10-19（Asia/Shanghai）
仓库：https://github.com/anjingdtl/ShineWord
工作树：F:\sw95local-20261018
分支：fix/phase95-local-final-closeout-20261019
PR：[PR #17 — Phase 9.5 local closeout: M4 recovery and safe action errors ](https://github.com/anjingdtl/ShineWord/pull/17)

## 分层验收结论

- **Runtime 工程收束：PASS-ENGINEERING（本报告列明的生产代码和回归范围）。** 两项玩家错误提示缺陷及 PlayHeader 大字标题缺陷均按 RED → 最小修复 → GREEN 完成；最终 Core 1,366/1,366、mobile typecheck、version check、focused worker/fence suite 64/64 通过。现有设备上的 outbox、Narrator、response-write、unknown cold-start 和 PlayHeader constrained-layout 子矩阵有合成设备证据。旧 worker 双 worker 设备 race 尚未现场注入。
- **阶段 9.5：PARTIAL。** 真实 GBK 小说、GLM、Android 和 save-10 使用均有实际证据，但新开篇 package 被 1 blocking + 3 major content review issue 挡住，没有发布。真实小说包非空来源 evidence L1 未验证。真人游玩由世恒哥负责，agent-driven 19 turns 不计为玩家决策；阶段 9.5 不宣称 FULL PASS。
- **阶段 9 历史遗留：PARTIAL。** 80 个真实有效决定未完成，独立试玩 0/4，自然结局的玩家质量未验；Stage-1/8 有身份历史资产不可用。synthetic production fixture 的 live GLM 10+10 是工程样本，不能替代小说包或玩家决定。

## 基线与保护

- 执行时 fresh fetch 得到 origin/main=9030c2674eea12bc3882ebe8c1cc155342e722c，PR #16 已在该基线上。新隔离分支以该 SHA 为 parent；主工作目录保持 clean，其他 registered worktrees 未更改。
- 本机 AVD 实际登记仍为 3 台：共享 Medium_Phone、ShineWord_M4FaultQA_20261018、ShineWord_Phase95_LocalFinal_20261018。之前已经删除 7 台 ShineWord 旧 AVD，实测释放约 45.53 GiB；本轮没有新增或删除设备。未登记的 Pixel_10 数据归属 TAVO-MINI，保留。
- 小说原文、密钥、HTTP 请求/响应正文和真实存档未进入 Git。主小说 emulator-5556 有活动进程和约 55 MB 数据库，本轮未更新或清理；最新 APK 保留安装在专用 M4 AVD 上。

## 最终本地验证与设备

- npm run verify:core：1,366/1,366 passed，0 failed。
- npm --prefix mobile run typecheck：PASS。
- npm run verify:version：PASS，version 1.0.0 / versionCode 1000000。
- node --test tests/phase8-reacceptance.test.cjs tests/phase9-sqlite.test.cjs tests/phase9-planning-lease.test.cjs tests/llm-json-ledger.test.cjs：64/64 passed。
- 最终 M4 Debug APK/base.apk SHA-256：`2DFAC97CCED93D0990489478A230359E7FE06AD727A4BFC984061F53AE6759CA`，安装在现有 API37 M4 AVD；安装保留数据库。PlayHeader font scale 2.0 与 360dp 窄视口 Maestro 标题断言通过，字号/屏幕设置均已恢复。
- M4 response-write test 在 localhost mock 上只发生 Planner/Narrator 各一次 HTTP 200。Narrator 成功态 ledger update 被临时 trigger abort 后，attempt 为 outcome_unknown、无已存 response_json/hash，branch 保持 v4。两次 cold-start/reopen 总请求仍是 2；已有 5 个已提交 turns 与 3 条历史骰点 hash 不变。唯一 trigger 已清理，100 张业务表数据相同、SQLite integrity=ok、设备回读文件 hash 与清理文件相同。unknown、turn-0005 和其骰点保留，没有批准或重派。
- 临时服务已停止且 TCP 18591 无监听；M4 AVD 仍显示安全恢复入口。此测试没有调用真实 GLM。

## 真实模型、429 与费用

- 用户明确授权本项目的智谱模型测试不限额度；本次仍采用串行/有界请求。
- 已知真实 endpoint 物理记录为 113 次：112 个 HTTP 200、1 个轮换前配置 HTTP 401；两条宿主机 transport unknown 的 attempt identity 未持久化，均未重派。真实 GLM 429=0。
- 9,601 code-point novel opening sample 的 timeline、extract、mapping 为 3 次 HTTP 200、并发 1；审查仍有 1 blocking 与 3 major。
- synthetic production fixture live GLM matched 10+10 完成 20/20 action commits、30 个 HTTP 200，L1 平均 6.705 秒、L2 8.901 秒，峰值并发 1；不是小说 package L1 验收。
- 已知成功 token 汇总 input/output/reasoning 为 1,152,193 / 265,801 / 41,097；应用 ledger 不证明实际人民币金额，因此费用未知。M4 两次 synthetic HTTP 200 不计入真实 GLM 数量。

## 交付与 exact-head CI

- 修复分支已 push 并创建 [PR #17](https://github.com/anjingdtl/ShineWord/pull/17)。没有自动合并 main。
- PR 正文在最终文档 commit push 后记录确切 PR HEAD SHA，以及该 SHA 上 Core Verify / Android Verify 的 run links 和结果；最终回复也列明。这些 exact-head checks 不由更早 SHA 或本地回归替代。
- M0–M7、G0–G5、V95、R0–R9、A01–A40 的详细状态见 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md)。

## 剩余事项

1. **非人工工程/设备证据**：双 worker stale-fence device race 尚未安全注入（Core focused coverage 已通过）；Stage-1/8 原始历史资产不存在；真实小说新 package 的内容审查未过，因而 package method / non-empty source evidence L1 无法测。继续自动化时需有身份的历史资产，且不能自动放行内容审查。
2. **人工体验**：真人连续游玩、80 个真实决定、自然终局和独立试玩由人完成，本报告不将其列为自动化 PASS。
3. **无障碍/设备矩阵**：TalkBack spoken/focus、多窗口、API 24、真实小屏和完整大字仍未验；虚拟屏测试不替代物理设备体验。
