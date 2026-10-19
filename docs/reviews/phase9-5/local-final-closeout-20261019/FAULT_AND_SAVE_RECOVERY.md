# 故障恢复与旧存档摘要

日期：2026-10-19。旧存档与更早故障记录见 [2026-10-18/19 报告](../local-final-closeout-20261018/FAULT_AND_SAVE_RECOVERY.md)，本轮 Narrator 响应写入故障见 [M4_RESPONSE_WRITE_FAILURE.md](M4_RESPONSE_WRITE_FAILURE.md)。

- 合法 save-10 与精确依赖 world package 已在 Android 原生导入、历史 turn/roll 对照、冷启动和续玩验证；save effects 往返缺陷已经修复并有独立证据。
- M4 AVD 的合成 outbox insert abort 做了三轮 RED/GREEN 注入：事务回滚保留行动合同、骰点和 Candidate；移除 trigger 后恢复同一候选，不新增 Planner/Narrator 请求。完整详情见 M4_FAULT_AND_RECOVERY.md。
- Planner 在途 force-stop 和 Narrator 在途 hold/force-stop 均留存 outcome_unknown 并在 cold start 不重派。Narrator success response 的 ledger update 注入失败后也保持 outcome_unknown；mock HTTP 200 不能被冒充成持久化 response success。
- 响应写入 test 最终仅移除了临时测试 trigger；100 张业务表数据逐表相同，数据库 integrity=ok，触发器为 0，attempt unknown 与 pending contract/roll 原样保留。没有点击批准、恢复或重派。
- SQLite lease/fence、CAS、旧 worker refusal 的 focused Core suite 64/64 通过；但真 Android 上两个 worker 竞争同一分支的设备注入尚未安全构造。
- Stage-1/8 原始历史资产没有可用的身份文件；不以本轮合成存档顶替，不对历史 turn/dice/Canon 作补写或修订。
- 临时 mock 18591 已停止；响应写入 evidence 不含请求正文、小说段落、Authorization 或真实密钥。
