# 故障与修复

## 已履约承诺可重复领取奖励

复现只在新建的存档导入副本 camp-mv5kpgrf-main 进行，没有改动原始分支。

1. turn-0031 在 stateVersion 30 自然成功；承诺 tyl-supplies-promise 变为 fulfilled，所属旧局面 resolved；计划计数 plan_ready +10、关系 +2。
2. stateVersion 31/32 的 Android 引导仍展示同一补给方法。
3. turn-0033 自然成功后，承诺本身状态不变，但 plan_ready 再次 +10、关系再 +2，证明奖励能重复领取。
4. 保存该历史作为缺陷证据；修复 APK 用 install -r 保留数据。新代码引导已不再展示此路线。

routeReadiness 新增“承诺已解决”阻塞码。若普通成功和大成功都只会履约/打破同一承诺，而该承诺已 fulfilled/broken，机会投影会隐藏路线，CampaignSession 提交前 guard 也会拒绝精确行动，避免创建新回合、骰点或模型请求。刷新引导会显示阻塞原因。未解决承诺的履约路线不受影响。

新增回归覆盖：已解决承诺路线不可用、刷新引导不含此路线、提交前拒绝、提供器调用为零、没有 interaction operation 或未提交 turn。聚焦测试 1/1，核心测试 1302/1302 通过。

## 相关 readiness 保护

- 固定 promise_create 已存在、且没有开放的履约/打破路线时，会在引导和提交前被拦截。
- 普通成功只重复已知线索或产生无人消费事件时，路线会被判为无进展。
- 收尾奖励所需人物缺失时，readiness 检查会阻止该完成路线进入骰点流程。

J1 冻结 turn-0071 没有被重跑。因此旧 A28 失败没有被本地守卫测试替换为端上验收。

## 尚未关闭的边界

- 两次 v27 候选未通过严格延迟结构验证；导入副本后续正式重规划才采用修订 11、12。
- 导入副本 v33 阶段仍 active；没有行动证明最终阶段完成或下游后果触发。
- 最终 APK UI 树显示重复路线已隐藏，但端上没有键入中文旧行动并提交：ADB input text 对中文返回 KeyCharacterMap NullPointerException，Maestro 只枚举到另一台 API 33 设备。相同精确行动的提交前拒绝由核心回归验证；不把端上输入限制写成 UI 提交通过。
- A15、A28、A36 仍失败。

## 私有证据

重复前：test-logs/phase9-5-final-pass-2026-10-13/repeat-fulfilled-promise-preaction.json
重复后数据库：test-logs/phase9-5-final-pass-2026-10-13/after-repeat-fulfilled-promise.db
修复前后引导：ui-48-repeat-promise-pre.xml、ui-57-postfix-final.xml
输入限制：postfix-android-input-limit.json
回归：tests/phase9-5-opportunity-projection.test.cjs
