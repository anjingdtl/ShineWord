# 阶段 9.5 测试与真实设备报告 — 2026-10-15

本报告记录接手后至停止点的测试结果。工程测试、模拟器、真实模型、旅程语义和阶段验收分开判定。

## 源码与 APK 身份

| 项 | 停止点结果 |
|---|---|
| 分支/基准 HEAD | `main` / `5f04b8d94bc9d6dee7d9586d98735dc8bfe95226`（生成 APK 时的 HEAD） |
| scope-v3 productionSourcesHash | `5f17b1ceed260d740bb81ae70f17356f82c1638275d3be913af697afa45c81dc` |
| Debug APK | SHA-256 `d2bd7882c1a851ac0aa702a01f641f8390c220eb12018e2b3b92be7a976041e8`；109,977,423 bytes |
| 安装核对 | emulator-5554 上已安装；从设备拉取的 base APK SHA-256 与本地 APK 一致 |
| Android | emulator-5554，API 37，`com.shineword.app` 1.0.0 / versionCode 1000000；非真机 |
| 模型 | 用户指定的 MiniMax-M3.1-Flash-Preview；报告不包含凭据或原始模型响应 |

该 scope-v3 hash 是当时完整工作树的源码快照，包含未纳入本次提交的既有工作区改动。它绑定本次 APK/模拟器证据，但不能解释为本次提交在干净 checkout 上的源码身份。较早 APK `cfe5080c0c5c9dafa3a74a4f29fa41e1cdea83416e2e45652d18cf974a76c783` 属于 `e9dd9a606248bdd4bf7ec6743b906c2d7dbdecead24a38657aec0c2c5fa5426f` 源码快照；其旅程结果另行列出，不与最新 fork 合并。

## 工程回归

| 命令/范围 | 结果 |
|---|---|
| `node --test tests/phase9-preparation.test.cjs tests/phase9-stage-preparation.test.cjs tests/phase9-adoption-settlement.test.cjs` | PASS，32/32 |
| `npm run verify:core` | PASS，1325/1325；0 fail / 0 skipped |
| `npm --prefix mobile run typecheck` | PASS |
| `npm run verify:version` | PASS，1.0.0 / 1000000 |
| `git diff --check` | PASS；有 LF/CRLF 转换提示 |
| APK 构建与模拟器安装核对 | PASS；本地构建与设备 base APK SHA-256 一致 |

新增回归覆盖：（1）同名重复 canon entity 经 actor template 不会重复生成玩家角色 NPC；（2）当前内容不能生成的自定义 `committed_event` 不会被接受为本阶段完成条件。测试通过仅证明所覆盖的工程合同，不代表内容质量或旅程验收通过。

## 真实旅程证据

### 已完成的较早分支

branch `camp-mv92k6h0-main` v10 自然结束于“边陲立足”。只读审计记录 4/4 个提交有意义、2 条延迟后果 discharged、0 条取消。目标 R69 artifact `segment-artifact-0480ea330e9e484b635d958c7ef3075da0942040c775091eae73fae390376129` 已在 artifact manifest v4；manifest hash `62def8276f6aa8a714ba704687dd1e7d1ae99331cd5cfc596064fe024e44a434`。此旅程属于较早源码/APK 身份，只作为独立阶段证据。

### 停止时的最新 fork

branch `camp-mv8y62m2-bmv9axe9u`，head v18，campaign active。只读审计 `private/phase9-journey-audit-fork-v18.json` 记录 12 个玩家提交、6 个候选有意义决定、6 个排除、0 条延迟后果，且 `semanticReviewRequired=true`。v17 计划 job 已 adopted、候选验证错误为空、计划修订为 6。v18 计划 job 为 invalid，错误：`firstSituation.methods[0].firstStep.skillId: stable string id required.`。所以没有形成后续可玩阶段，不能宣称全旅程完成。

## MiniMax 物理预算与应用账本

停止点 scope `phase95-minimax-20261015`：cap 104，spent 65，remaining 39；物理 dispatch audit 共 65 条，其中 64 条 `completed`、1 条 `outcome_unknown`。v18 后继计划的请求结果如下：

| Attempt | 物理预算账本 | 应用 SQLite | 结论 |
|---|---|---|---|
| v18 #a1 | `outcome_unknown`，未记录 HTTP 状态 | failed / `http_rate_limit` / HTTP 429 | 账本状态存在差异；保留原值，不手改 |
| v18 #a2 | completed / HTTP 200 | succeeded / HTTP 200，响应有 hash | 计划校验失败，job 最终 invalid |

应用 SQLite 另保留两条历史 `outcome_unknown`：旧 branch `camp-mv8y62m2-main` 的 planner attempt，以及一次 world_mapping attempt。后者代理记录过 HTTP 200，但应用未持久化响应，重入 UI 曾显示待审核；本轮没有批准重试。所有 unknown 均未自动重放。本次阶段报告不把代理 HTTP 成功当成 app 已接收或候选可采用。

停止后已停止本地 Phase 9 代理 Node 进程；PID 36488 已退出，端口 18591 不再监听。

## Stage-8、A15/A28 与验收边界

- Stage-8 历史 v33 快照离线生产规则评估：`plan_ready=20`，`seal-escape-plan` 条件 true / unknown=false，普通成功效果经生产 progress reducer 后 stage-8 为 succeeded。没有当前 APK 中的 UI 选择、掷骰、Narrator、提交和持久状态回放，仍为 PARTIAL。
- 最新 fork 的 turns 中有失败与状态变化记录，但 A15 连续失败恢复/普通成功链、A28 掷骰—采用—提交—租约中断组合测试均未闭环，按 PARTIAL 计，不按 PASS。
- 未完成 Stage-1 软锁真实存档、V95-08 三意图 prompt/context 隐私对照、第二题材/匹配性能样本、80/100/300/1000 决定窗口、V95-12/A36 四名独立试玩者。
- 用户指定原提示词文件不可访问；附件截图只能证明截图可见范围，不能证明隐藏任务已经核对。

私有原始证据位于 `.tmp/phase9/closeout-20261015/`，含数据库快照、预算账本、审计 JSON、设备截图和 APK 副本；这些文件不纳入代码提交。
