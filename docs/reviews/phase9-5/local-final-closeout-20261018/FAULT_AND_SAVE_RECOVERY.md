# M4：故障恢复、请求账本与历史存档

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL。

## 本轮可核证证据

- 专用 AVD 的隔离 mock 测试向 localhost one-shot fixture 发送了一次物理请求；fixture 丢弃 request body、不记录 Authorization，只返回合成 429。provider ledger 记录 HTTP 429。
- 后续本地代理关闭时形成 network_unknown/outcome_unknown；此项 frozen config 指向 10.0.2.2 的本机代理，不是 GLM。记录无 HTTP 状态、无 provider request ID、无 tokens，保留在 needs_review。没有确认请求重派、重置 attempt 或修改该 ledger。
- 当前真实模型账本中两条 world_extract 与一条 style_analyzer 为成功；opening_goal 是明确 HTTP 401。没有未知真实模型尝试。物理模型并发峰值为 1。
- M6 安装期间保留应用数据库和 Keychain；使用只读 run-as 导出做表/状态查询，未清空、覆盖或回写 app 数据。
- 当前 Core suite 为 1,344/1,344；涵盖 unknown park、请求 fencing、atomic commit、turn replay/stateVersion、outbox 和存档/导入等自动化合同。但这不等于设备故障矩阵全部执行。

## 未执行 / 阻滞

- 本轮没有对 live gameplay 做双击、并发点击、turn 中 force-stop、Narrator 前后杀进程、outbox 故障或旧 worker 竞态，因为真实 campaign 尚未建立且不能伪造玩家行动。
- 专用 AVD 是新建隔离设备，没有 identity-bound save-10、Stage-1/8 或其他合法历史存档。按合同标记 BLOCKED-ASSET；未从个人 AVD/忽略目录复制或改写历史数据。
- 本轮未在导入/恢复路径运行真实 save export/import、fork/rewind、旧 schema 迁移或历史骰点/Canon 精确哈希读回。
- mock fixture 脚本和 flow 仅用于干净隔离 AVD；不可在含未知 ledger 的现有项目上重复运行。
