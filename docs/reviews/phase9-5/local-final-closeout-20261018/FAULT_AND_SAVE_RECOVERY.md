# M4：故障恢复、请求账本与历史存档

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL。真实 Android/GLM action commit 与合法历史 save-10 的依赖恢复、原生导入、冷启动和后续行动均已覆盖；实时中断/事务故障注入及 Stage-1/8 资产仍缺。

## 本轮可核证

- 小说 world、三个 campaigns 与映射 branches 的最终 GLM ledger 合计 77 次物理 attempt：76 HTTP 200、1 个配置轮换前 `opening_goal` HTTP 401；真实模型 `outcome_unknown=0`、in-flight=0。401 未重派。成功 token 汇总为 input/output/reasoning `1,117,695 / 258,924 / 40,902`；观测并发峰值 2，最后 8 个真实请求均串行完成。费用账单不可见，CNY 金额未知。
- 单独的本地 mock world `world-src-7f45fe0b11ea30ec-mvdbwylw` 保留一次 HTTP 429 与一次 `network_unknown/outcome_unknown`，后者无 HTTP/provider request ID / tokens，`estimated_usage=1`。项目 remains needs_review；没有确认、清账、再派发或从真实 GLM 预算借额。
- 两局真实 APK QA 的 action turn 均落在 SQLite 原子 commit；第一局 turn v2→v7 有多轮下一行动，第二局 severe failure 的 turn v2→v3 后，replan turn 继续提交到 v5。Roll record、state version 与 ending event 都可读。
- 使用 `adb install -r` 更新 APK，之前的小说、Keychain、campaign、world 与旧故障现场仍保留。没有卸载、清库、模拟器 factory reset 或历史 turn 改写。
- 旧 v12 数据库只读快照与后续稳定快照 `PRAGMA integrity_check=ok`；文件只保存在本机，既不提交也不将响应内容写入报告。某临时副本恰逢 journal 写入时 integrity check 不通过，已排除证据；待 journal 空闲后重取稳定副本通过，不是设备 DB 损坏。
- 最新全量 Core 1,356/1,356 覆盖 unknown park、attempt fencing、atomic commit、turn replay/stateVersion、outbox、存档/导入合同；这些自动化结果不等于现场故障矩阵完成。
- 从授权的既有 QA 日志只读恢复真实 save-10 和与其绑定的精确世界包；未制作或冒充合成历史存档。世界包依赖先在 Android Library 原生导入，之后通过 Campaigns → Import Save → 系统文件选择器导入 save。身份检查确认 source world、published package r1/content hash 和两个 artifact ID/hash 与 save manifest 完全一致。
- 原生恢复创建新 campaign `camp-mvdsy3v4` / branch `camp-mvdsy3v4-main`，导入后实际 stateVersion 5→6 的 `turn-0006` 成功提交；Narrator HTTP 200，3d6 / difficulty 4 / margin +2。对照显示六条冻结历史 turns 的标识、合同 JSON/hash、状态版本及两条历史 roll 的结果/hash 均与 save 完全一致；导入后计数为 7 turns、3 rolls、7 snapshots。冷停止并重开后 `play-composer`、`play-submit` 仍可见，分支可继续运行。
- 保存设备导入前的只读 SQLite 快照；既有 3 campaigns、9 branches、98 turns 仍在。基线历史行没有删除或改写，只有两条 `llm_resource_buckets` 的 `playingUntil/activities` 随应用活动生命周期变化。Save-10 后续行动与本轮其他 QA 新行动均为 agent-driven，不计真人决定。详细哈希与计数见 `evidence/save10-device-restore-sanitized.json`。
- stage-5 的隔离 QA branch 后续由 v11/r4 完成一次真实 UI action（turn-0014，v13→14，Narrator HTTP 200），并在两个顺序 campaign_plan HTTP 200 后采用 plan r7、进入 stage 6；真实小说 main branch 仍为 v12/r4，历史未改写。详见 `evidence/stage5-live-adoption-and-replay-sanitized.json`。

## 未执行 / 阻滞

- 没有在已提交 turn 的中间时点 force-stop，也未在 Narrator 前后终止 app、触发 outbox 故障或制造旧 worker 竞态。已生成的剧情和模型请求不可通过回放/重试补齐这些证据。
- Stage-1/8 与特定历史骰点/Canon fixture 仍不可用；未从个人 AVD 或 ignored long-run ledger 导出、覆盖、重写这些资产。
- 已验证历史 save-10 及其世界包导入、精确历史回读和恢复后行动；尚未完成从当前应用重新导出再 round-trip、fork/rewind 的完整设备对照或旧 schema migration 矩阵。
- 真实行动存在严重失败并结束局面的样本，但不是故障注入；不得把游戏内失败归类成崩溃恢复测试。
- mock 429 和 unknown 都是合成 localhost 现场，不能代替 GLM 真实 timeout/未知扣费对账。当前实际人民币费用未知。

## 保护规则

- 冻结历史 turn、骰点、前两局 campaign endings、原第三局 main 状态和所有真实模型 ledger 按原样保留；恢复过程只新增一个独立 campaign，未覆盖原 campaign。
- 唯一 old `outcome_unknown` 是 mock world；没有 replay。读取 live SQLite 时只在 journal 空闲后对本地副本做查询；一次事务中副本未通过检查的临时快照未作为证据，设备数据库未被写入。
