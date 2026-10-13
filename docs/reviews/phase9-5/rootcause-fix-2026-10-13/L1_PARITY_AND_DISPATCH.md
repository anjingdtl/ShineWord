# L1 等价性与请求派发

## 本轮结果

- 当前生产路径仍为 `CampaignSession → v2Turn/编译与冻结 → Narrator → settlement → atomic commit`；OpportunityProjection 是只读派生，不增加第二份 Graph 进度权威。
- `LocalCompileReadiness` 对缺难度、证据、权限/绑定字段采用安全分流；缺字段旧方法走 L2。相关 final core 和本地编译回归通过。
- 确定性 L1 回归中，显式固定难度、固定非空可见 evidence 的选中方法不派 Planner；该夹具检查到 Narrator 1、Planner 0。它是工程测试，不是 Android/真实 GLM 派发证据。
- A40 确定性累积回放使用 L2 fallback，stub 角色统计 Planner 1000 / Narrator 1000；物理 HTTP=0。不能把它解释为 L1 失败或真实账单。
- 最终 APK 的 Play UI 只恢复 v31 状态，没有提交行动，因此本轮 Android 合格 L1 的物理 Planner 派发数不可测；全局 `L1_eligible / publishedMethods` 分布也未测。

## 账本与请求资格

权威账本仍为 `shineword-phase9-5-20261011`，600 上限、510 已完成、90 余额；本轮开始与结束均为 510。scope 环境变量固定为用户指定绝对账本路径、cap 600 和该 scope ID。确定性 provider 不走网络。

应用数据库仍有一个位于冻结 J1 的历史 Narrator `outcome_unknown`，attempt id 为 `narrator:camp-mv3mw9hk-main:turn-0037#a1`；它不匹配 510 条 scoped physical audit 中的任何 attempt。它没有在本轮重发，也没有从 J1 恢复。预算账本行数和数据库 attempt 行数不一致是当前真实派发阻断项。

指定 profile 的非机密信息为 endpoint `https://open.bigmodel.cn/api/coding/paas/v4`、model `glm-5.3-flash`、客户端 endpoint `http://127.0.0.1:18591`。本轮 18591 无监听、设备无 `adb reverse` 规则，没有 HTTP 请求。

## 安全边界

读取指定配置时，我的解析脚本曾把凭据字节显示在本地工具输出中。它没有被发出 HTTP 请求，也没有写入仓库或公开报告；凭据应视为暴露并轮换。轮换后的配置路径尚未提供。本轮真实派发为零；不要把原 key 放回配置或重试。

本轮没有收到当前候选的 Core Verify / Android Verify 结果：GitHub CLI 对候选分支及 main 的查询均返回 HTTP 401。脱敏摘要保存在私有 `test-logs/phase9-5-rootcause-fix-2026-10-13/private/ci-query-summary.json`。

## 证据

- 测试：`verify-core-final.log`、`required-regressions-final.log`、`contracts-final.log`。
- 账本：唯一权威 `test-logs/phase9-5-longrun-2026-10-11/budget-manifest.json`；未复制、重置或扩容。
- 数据库 attempt 摘要和原始账本行关联检查可用私有 `reconcile-unknown-attempt.cjs` 复现；本轮输出确认数据库有 510 个 succeeded 和 1 个未匹配 scoped ledger 的 `outcome_unknown`，没有包含 prompt、response 或 key。
