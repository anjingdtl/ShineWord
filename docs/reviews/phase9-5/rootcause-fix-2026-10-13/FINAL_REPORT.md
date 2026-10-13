# 阶段 9.5 根因修复复验结论

## 结论

**阶段 9.5：未完全 PASS。** 本轮完成四类根因的生产修复和离线回归，并在最终 Debug APK 上完成正式 QA 分支创建、中文控件输入验证、save-10 导出/系统导入、冷启动恢复和冻结数据复核。最终 APK 没有提交新行动；真实 GLM、因果消费链、80 个玩家决定及独立真人质量评分仍未闭环。

## 已证实修复

- 一次性履约与首次知识不再被验证器无限重复计入；受限 +10/≥20 合成反例最终拒绝。
- 采用前以 `all/any/not` 和节点终态检查 pending consequence 可达性，拒绝本次新造悬空后果；不改写已有历史。
- 对称/不对称成功等级、历史方法版本和新回合重复奖励由冻结 promise fact + reward target key 在 compile/settlement 中统一处理；已履约旧 promise 仍能提交新知识和阶段收尾。
- 原始根因套件从 2 PASS/4 RED 收敛到 6 PASS/0 FAIL；最终 core 1305/1305，定向回归 47/47。

## 最终源码、APK 与设备

- HEAD：`9416adfd07c901414618e0518b008de0060b9ec3`
- productionSourcesHash：`79c3bea6b13e06ee89530e806e42d245cccd87080004afb0f26c0addd249646e`
- Debug APK SHA-256：`51065228fa9fbc6c5421b288a396b5a7a6ca06414fb8f6332e6c9a977c5cf7cb`
- `com.shineword.app` / 1.0.0 / 1000000，安装到 `emulator-5556` API37，base.apk SHA 相同；使用 `adb install -r` 保留数据。

## 不能宣称通过的直接证据

- 冻结 v31 来源分支有 6 条 pending 后果，两条依赖已 superseded 的 stage-3/4；没有真实触发与下游消费。
- final Play 页输入框可用，但 submit disabled；没有真实模型请求、骰点、结算、叙事和新行动。
- 账本显示 90 余额，但应用数据库有一个未关联到唯一 scoped ledger 的历史 Narrator unknown；本轮停止派发。
- `GITHUB Actions` 当前候选/主分支记录查询返回 401；独立真人试玩没有发生。用户选择的模拟操作不能替代 A36/V95-12。
- 有效玩家决定账本 0/80，final APK 稳定窗口 0/20；没有匹配性能 baseline10/final10，也没有第二题材旅程。

凭据配置解析曾在本会话本地工具输出中暴露密钥内容；没有 HTTP 派发，没有把 key 放入仓库或本报告。该凭据需轮换。公开文档不包含密钥、原著正文、提示词、模型响应、数据库原文或未脱敏截图。

## 最小续跑行动

1. 轮换 GLM key 并提供新配置路径；先对账应用 DB unknown 与唯一 scoped ledger，未对清前保持真实请求停止。
2. 提供一位未参与施工的真人试玩者，使用最终 APK 完成四个理解问题和六维评分。
3. 在上述安全条件满足后，从 `camp-mv66t99t-main` v31 QA 分支继续正式 UI 行动；完成内容供给、普通成功收尾、失败恢复、两条真实后果消费、20 动作稳定窗口和 80 决定合同。

本报告不申请发布、合并或提交代码。完整逐项状态见 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md)，复现入口见 [CHECKPOINT.md](CHECKPOINT.md)。
