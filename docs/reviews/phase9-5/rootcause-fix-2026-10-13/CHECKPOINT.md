# 复验检查点

## 当前安全恢复点

- 工作树：`F:\sw95`，branch `codex/phase9-5-final-pass-20261012`，HEAD `9416adfd07c901414618e0518b008de0060b9ec3`。不要 reset/clean；工作树的生产/测试/报告改动均未提交。
- 最终 APK 已安装在 `emulator-5556`，设备数据未清除。最终 UI 停在 `camp-mv66t99t-main` stateVersion 31 Play 页；输入框空、submit disabled。
- 该分支由官方 UI save-10 导入生成，来源是 `camp-mv5kpgrf-bmv65sk2n` v31。它有 6 条 pending consequences，其中两条依赖已 superseded 的节点。不要直接触发不存在的历史路线。
- J1 `camp-mv3mw9hk-main` v70/turn-0071 冻结；v33 来源主分支保留 turn-0033 修复前重复奖励，不得回放或修改。

## 证据位置

- 本轮公开报告：`docs/reviews/phase9-5/rootcause-fix-2026-10-13/`。
- 本轮私有原始证据：被忽略的 `test-logs/phase9-5-rootcause-fix-2026-10-13/private/`。
- 根因原始 RED/最终 GREEN：`contracts-red.log`、`contracts-final.log`、`audit-final.log`。
- 工程门禁：`final-gates-summary.txt`、`verify-core-final.log`、`required-regressions-final.log`、`mobile-typecheck-final.log`、`verify-version-final.log`、`apk-debug-final.log`、`diff-check-final.log`。
- 最终身份：`private/source-apk-identity-final.json`；设备前后数据库与受保护表比较在 `private/device-db-final-ui-replay-postinstall` 及对应摘要脚本。
- 有效玩家决定 ledger：`private/decision-ledger.jsonl`，9 行均可解析、0 个有效玩家决定；旧损坏文件仍在 `test-logs/phase9-5-final-pass-2026-10-13/` 未覆盖。
- A40：`private/a40-accumulation-20261013-l2.jsonl` 和独立 SQLite QA DB；不能算玩家决定。

## 续跑门槛

1. 不触碰旧未知请求；先以 requestKind 合同对账账本外 `outcome_unknown`。不盲目重发，不把它按免费处理。
2. 轮换已暴露的 GLM key；新配置通过安全路径载入，核验 profile/模型绑定和 loopback budget proxy 后才能发新请求。
3. 由独立真人在最终 APK 试玩并填四问/六维量表；不能由施工者或自动化代填。
4. 从 v31 QA 分支通过正式 UI 继续，先处理可恢复内容供给；每个新生产修复都重跑核心/定向门禁、重建、`install -r` 和同场景复验。
5. 真实因果验收要让合法路线触发并由下游消费两条后果；不能用取消 pending 或改历史状态替代。
6. 补 J1/J2/J3、同快照 J4A/J4B、80 个有效 UI 决定、20 动作稳定窗口、A15/A28、两个题材受控样本、matched performance、当前候选 CI。

预算账本仍为 510/600、余额 90；本轮没有真实请求。此余额不解除数据库 unknown 阻断，也不是新增预算。
