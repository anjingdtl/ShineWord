# 请求账本与 unknown 对账

## 本轮可核验范围

- 本机未提供此前 closeout 所用的私有物理请求账本、原始 attempt 响应或对应 SQLite。指定的旧临时账本目录不存在；不能用旧报告中的汇总替代逐 attempt 证据。
- 当前施工分支和普通仓库文件不含可核验的本轮真实请求账目。本轮模型派发数为 **0**；GLM 配置文件只登记为本机受授权测试资源，没有读取其内容或发送请求。
- 没有本轮预算 scope、物理请求上限和费用上限。真实请求保持关闭；历史“剩余请求数”不作为本轮预算。

## 本地合同回归

命令：

```text
node --test tests/phase9-budget-authority.test.cjs tests/phase9-planning-budget.test.cjs tests/phase9-proxy.test.cjs tests/phase9-preparation-restore.test.cjs tests/phase9-request-deadline.test.cjs
```

结果：**53/53 pass**，0 fail、0 skipped。该合成/本地测试集覆盖预算 authority 与请求上限、已知失败和发送后 unknown 计费状态、host/emulator 并发预留、预览与显式审批、审批幂等与恢复任务关联、fence/配置变化拒绝、未决请求不自动重派及请求截止时间分类。它不证明任何私有历史 attempt 的状态。

## 历史差异及隔离

此前 closeout 报告曾记录物理账本与应用记录间的状态差异及历史 `outcome_unknown`。本轮没有其原始两侧证据，故这些条目**未重新核实、未改账、未重放，也不继承额度结论**。如需关闭历史调查，维护者/账户所有者需提供对同一 scope 的只读物理账本、应用 SQLite 与原始响应/传输记录，并由其逐项核对 scope、profile 指纹、logicalRequestId、attemptId/attemptNo、request kind、branch、时间线、HTTP 状态、响应 hash 和候选状态。

## 状态与恢复条件

- 工程恢复合同：**PASS（本地合成测试）**。
- 私有历史账本和差异处置：**NOT VERIFIED / PARTIAL**。
- 历史 unknown：保留未决；物理请求和费用仍按原账本状态处理；不得自动重派或以代理 HTTP 结果替换应用持久化状态。
- 恢复责任：维护者/账户所有者提供原 scope 只读证据。恢复条件是逐 attempt 关联完成，差异要么有原始证据结论，要么明确保持 UNKNOWN 并记录责任人与隔离范围。
- 新的独立测试 scope 不能用来覆盖、冲抵或解除旧 scope 的对账阻塞；开始任何真实调用前，仍需单独给出本轮 scope、请求 cap 和费用/用量边界。
