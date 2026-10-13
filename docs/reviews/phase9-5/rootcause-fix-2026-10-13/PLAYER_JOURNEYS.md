# 玩家旅程与决定合同

## 本轮正式 UI 路径

1. 最终 Debug APK 安装到 `emulator-5556` 后，通过战役列表打开导入副本 `camp-mv5kpgrf-main` v33，只读检查。
2. 使用产品“回退创建分支”入口先建 v32 QA 分支 `camp-mv5kpgrf-bmv657z83`，再从该分支建 v31 QA 分支 `camp-mv5kpgrf-bmv65sk2n`。没有提交行动；v31 不包含 turn-0032/0033。
3. 在 Play 页验证中文测试输入能进入实际 `EditText`，随后清空；没有调用提交按钮或直接调用 `playTurn`。
4. 从产品菜单使用 Android 系统文件选择器导出 v31 save-10；再从战役页使用系统导入选择器导入为 `camp-mv66t99t-main`。冷启动后重新打开该分支。
5. 最终 APK 屏幕停在 v31 Play 页；输入框可用、空输入时 submit disabled。没有新行动、骰点、结算或 Narrator。

UI、数据库和安装核验相互吻合。导入分支 head/stateVersion=31、32 个 snapshots；提交记录中 3 failure、1 severe_failure、28 success。save-10 导入重绑了 plan/artifact archive identity；计划 hash、12 个 artifact refs、内容绑定 hash 均通过，6 条 deferred consequences 与来源状态一致。

## 覆盖状态

| 路线 | 本轮有效玩家决定 | 结果 |
|---|---:|---|
| J1 保护/救援 | 0 | 冻结 J1 未触碰；未从保护路线创建并继续实玩。 |
| J2 调查/探索 | 0 | 仅打开指定小说导入副本的 v31 状态，未提交探索行动。 |
| J3 合作/日常和合理自由输入 | 0 | Unicode 控件注入后清空；自由输入没有提交。 |
| J4A / J4B 同快照分叉 | 0 / 0 | 做了回退分支操作，没有两条玩家路线及汇合对比。 |
| 第二题材 QA 世界 | 0 | 未生成或游玩第二题材。 |

新私有 JSONL 账本 `test-logs/phase9-5-rootcause-fix-2026-10-13/private/decision-ledger.jsonl` 共 9 行，逐行可解析、8 个唯一 QA/工程事件、0 条有效玩家决定。机械分支管理、save 管理、确定性 provider 的工程回合都明确排除在 80 决定之外。旧损坏 JSONL 保留未覆盖。

当前合同计数为 **0/80**。最终 APK 稳定窗口为 **0/20**；A40 累计回合来自独立确定性 QA 库，不能计入玩家合同。

## 真人试玩

用户选择“你模拟操作”。本轮助手执行的 UI 操作不是独立玩家体验，也没有填写四个理解问题或六维评分，因此 V95-12/A36 保持 NOT RUN。施工者自评、UI 自动化、模拟人格和模型评分均未替代真人。

私有操作时间线和 UI/DB 证据在 `test-logs/phase9-5-rootcause-fix-2026-10-13/private/`；本报告不含原著句子或原始截图。
