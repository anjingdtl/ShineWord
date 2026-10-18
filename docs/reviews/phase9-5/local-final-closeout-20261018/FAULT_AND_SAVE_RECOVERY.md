# M4：故障恢复、请求账本与历史存档

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL。真实 Android/GLM action commit 已覆盖；故障注入和历史 save 验收仍受资产限制。

## 本轮可核证

- 小说 world 与其三个 campaign branches 的 GLM attempt ledger 合计 53 successes 和 1 个旧配置 opening_goal HTTP 401；没有真实 GLM `outcome_unknown`。401 未重派，配置更新后通过新请求 HTTP 200 验证连接。
- 单独的本地 mock world `world-src-7f45fe0b11ea30ec-mvdbwylw` 保留一次 HTTP 429 与一次 `network_unknown/outcome_unknown`，后者无 HTTP/provider request ID / tokens，`estimated_usage=1`。项目 remains needs_review；没有确认、清账、再派发或从真实 GLM 预算借额。
- 两局真实 APK QA 的 action turn 均落在 SQLite 原子 commit；第一局 turn v2→v7 有多轮下一行动，第二局 severe failure 的 turn v2→v3 后，replan turn 继续提交到 v5。Roll record、state version 与 ending event 都可读。
- 使用 `adb install -r` 更新 APK，之前的小说、Keychain、campaign、world 与旧故障现场仍保留。没有卸载、清库、模拟器 factory reset 或历史 turn 改写。
- 终态本地数据库快照只读检查 `PRAGMA integrity_check=ok`；文件只保存在本机，既不提交也不将响应内容写入报告。
- 全量 Core 1,348/1,348 覆盖 unknown park、attempt fencing、atomic commit、turn replay/stateVersion、outbox、存档/导入合同；这些自动化结果不等于现场故障矩阵完成。

## 未执行 / 阻滞

- 没有在已提交 turn 的中间时点 force-stop，也未在 Narrator 前后终止 app、触发 outbox 故障或制造旧 worker 竞态。已生成的剧情和模型请求不可通过回放/重试补齐这些证据。
- 隔离 AVD 不含合法 identity-bound save-10、Stage-1/8 或历史骰点/Canon fixture。没有从个人 AVD 或 ignored long-run ledger 导出、覆盖、重写资产。
- 没有运行真实 save export/import、fork/rewind、旧 schema migration 或历史 hash 精确读回。
- 真实行动存在严重失败并结束局面的样本，但不是故障注入；不得把游戏内失败归类成崩溃恢复测试。
- mock 429 和 unknown 都是合成 localhost 现场，不能代替 GLM 真实 timeout/未知扣费对账。当前实际人民币费用未知。

## 保护规则

- 冻结历史 turn、骰点、前两局 campaign endings、第三局运行状态和所有真实模型 ledger 按原样保留。
- 唯一 old `outcome_unknown` 是 mock world；没有 replay。读取 live SQLite 时只在 journal 空闲后对本地副本做查询；一次事务中副本未通过检查的临时快照未作为证据，设备数据库未被写入。
