# M4：故障恢复、请求账本与历史存档

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL。真实 Android/GLM action commit 已覆盖；故障注入和历史 save 验收仍受资产限制。

## 本轮可核证

- 小说 world、对应三个 campaigns 与映射 branches 的最新 GLM attempt ledger 合计 64 HTTP 200 successes 和 1 个旧配置 opening_goal HTTP 401；没有真实 GLM `outcome_unknown` 或在途请求。401 未重派，配置更新后通过新请求 HTTP 200 验证连接。65 次请求的 token 汇总为 input/output/reasoning `846,768 / 204,224 / 30,202`，观测并发峰值 2；后续调用逐条等待。
- 单独的本地 mock world `world-src-7f45fe0b11ea30ec-mvdbwylw` 保留一次 HTTP 429 与一次 `network_unknown/outcome_unknown`，后者无 HTTP/provider request ID / tokens，`estimated_usage=1`。项目 remains needs_review；没有确认、清账、再派发或从真实 GLM 预算借额。
- 两局真实 APK QA 的 action turn 均落在 SQLite 原子 commit；第一局 turn v2→v7 有多轮下一行动，第二局 severe failure 的 turn v2→v3 后，replan turn 继续提交到 v5。Roll record、state version 与 ending event 都可读。
- 使用 `adb install -r` 更新 APK，之前的小说、Keychain、campaign、world 与旧故障现场仍保留。没有卸载、清库、模拟器 factory reset 或历史 turn 改写。
- 旧 v12 数据库只读快照与后续稳定快照 `PRAGMA integrity_check=ok`；文件只保存在本机，既不提交也不将响应内容写入报告。某临时副本恰逢 journal 写入时 integrity check 不通过，已排除证据；待 journal 空闲后重取稳定副本通过，不是设备 DB 损坏。
- 最新全量 Core 1,354/1,354 覆盖 unknown park、attempt fencing、atomic commit、turn replay/stateVersion、outbox、存档/导入合同；这些自动化结果不等于现场故障矩阵完成。
- `SW95-M3-03` 修复后的真实 stage-5 replan 使用 2/2 顺序物理 attempts，均 HTTP 200；候选因 skill_check destinationId 无效被 validator 拒绝，branch v10、plan revision 4 均未变化。没有重试已耗尽 job，没有重派 `outcome_unknown`。
- 另在既有 campaign 隔离 branch 新增 1 个 method-bound agent action（v9→v10、failure、Narrator HTTP 200、Planner=0），以及 1 个没有行动/模型调用的 v11 rewind branch。它们是预期测试数据写入；第三局 main v12 与既有冻结历史保持不变。

## 未执行 / 阻滞

- 没有在已提交 turn 的中间时点 force-stop，也未在 Narrator 前后终止 app、触发 outbox 故障或制造旧 worker 竞态。已生成的剧情和模型请求不可通过回放/重试补齐这些证据。
- 隔离 AVD 不含合法 identity-bound save-10、Stage-1/8 或历史骰点/Canon fixture。没有从个人 AVD 或 ignored long-run ledger 导出、覆盖、重写资产。
- 没有运行真实 save export/import、fork/rewind、旧 schema migration 或历史 hash 精确读回。
- 真实行动存在严重失败并结束局面的样本，但不是故障注入；不得把游戏内失败归类成崩溃恢复测试。
- mock 429 和 unknown 都是合成 localhost 现场，不能代替 GLM 真实 timeout/未知扣费对账。当前实际人民币费用未知。

## 保护规则

- 冻结历史 turn、骰点、前两局 campaign endings、第三局运行状态和所有真实模型 ledger 按原样保留。
- 唯一 old `outcome_unknown` 是 mock world；没有 replay。读取 live SQLite 时只在 journal 空闲后对本地副本做查询；一次事务中副本未通过检查的临时快照未作为证据，设备数据库未被写入。
