# M4 响应返回后账本写入失败与冷启动复核

日期：2026-10-19（Asia/Shanghai）

结论：本故障子项为 **PASS-DEVICE（合成故障注入范围）**；M4 整体仍为 **PARTIAL**。本次没有生产代码缺陷，因此没有新增代码修复，也没有把合成 mock 结果描述为 GLM 响应。

## 隔离范围

- 仅使用现有专用 AVD ShineWord_M4FaultQA_20261018（emulator-5560，API 37 / Android 17）。未新建 AVD。
- 使用已安装的当前 M4 Debug APK，包版本 1.0.0 / versionCode 1000000，安装物 SHA-256 为 EFA99A71AF8FF21509C9B7701214D9BA45D3A64342922B320E06CDE390CE9223。
- 目标仅为合成 campaign branch camp-mvef22x8-main。注入前 branch stateVersion=4、SQLite integrity=ok，且该 branch 的先前 7 次请求均为单次成功。旧 synthetic unknown branch camp-mvedidrh-main 没有访问或修改。
- 冻结的 Android profile 为 P95-local-mock，model glm-5.3-flash，endpoint host/port 10.0.2.2:18591，profile concurrency=3。该地址只映射至本机临时 mock；本轮没有 GLM 或外部模型请求。
- mock 日志仅记录请求种类、campaign/branch/state version、attempt 编号和 HTTP 状态；请求体和 Authorization 均未保存或记录。

## 故障构造和结果

从设备数据库的离线副本添加了一个范围受限的 SQLite BEFORE UPDATE trigger，只在目标 branch、stateVersion 4、Narrator attempt 更新为 succeeded 时返回 abort。注入前后数据库均通过 SQLite 完整性检查。

随后在 Android 上通过 Maestro 只提交一次 guidance-submit-1 行动：

| 观察项 | 结果 |
|---|---|
| 本地 mock 请求 | Planner 1 次 HTTP 200、Narrator 1 次 HTTP 200；两者 attemptNo=1 |
| 应用请求账本 | Planner 为 succeeded/http 200；Narrator 为 outcome_unknown，failureClass/errorCode=unknown，没有 httpStatus、providerRequestId、responseJson 或 responseHash |
| 分支提交 | stateVersion 保持 4；没有提交新的 turn 或推进状态 |
| 保留的待处理材料 | turn-0005 的行动合同哈希为 e99bb72b74e4b752f0f6d17a3f178fa3fcec1e5e92ac23f2d3b2efba13404b07；该记录无 committedStateVersion/outcomeGrade；总骰点记录从 3 增至 4，未补掷 |
| 历史一致性 | 原有 5 条已提交 turn 的行哈希在注入前后相同：788b78404a8c316fd8bee3bb8fc00a3ee447ba4baf739db1c67cbc6f59fe88af；原有 3 条骰点哈希相同：644d13f8955d32ed41977a995701dd71eccdcc1aca53c2f4854dec1b013b6b19 |
| 恢复 UI | 冷启动并重新打开同一 branch 后，play-recover-turn 可见、composer disabled；未显示 [object Object]、SQLite 细节或 trigger 名称 |

外部 mock 的 HTTP 200 只能证明合成响应已返回。由于成功响应写入 ledger 的 SQLite 更新失败，ledger 正确保持 outcome_unknown；不能据此把响应当成可重用的已持久化成功结果。该请求始终 attemptNo=1，没有确认、重派或重试。

## 冷启动及清理

- 在 trigger 仍安装时 force-stop 并冷启动，再打开目标 branch；mock 物理请求总数仍为 2，未自动重派。
- 从设备快照的本地副本仅移除 p95_response_write_abort trigger。移除前后 100 张业务表的所有行数据逐表一致；完整性为 ok，trigger 数量为 0。
- 将已清理副本写回专用 AVD 后，设备读回 SHA-256 与写入副本完全一致：AE8B6E109F32F48E5D0C3E621EDD90F172A09C64A6D880D927D7F8846132260B。branch v4 与 Narrator outcome_unknown 均保留。
- 移除 trigger 后再次冷启动并打开目标 branch，mock 请求总数仍为 2；恢复入口仍可见，composer 仍禁用。
- 停止了临时 mock 服务，宿主机 TCP 18591 无监听。专用 AVD 中的 unknown 和 turn-0005 留存作证据，没有点击恢复、批准重放或清除它们。

## 范围限制

此结果是 Android 上的合成数据库写入故障与恢复证据，不证明真实 GLM 在该时点如何计费，也不构成玩家验收。M4 仍缺旧 worker 设备竞态复现，以及真实带身份的 Stage-1/Stage-8 历史资产复核；这些缺口不能由本次 mock 验证替代。
