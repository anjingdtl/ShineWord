# 根因与最小修复

范围：针对 2026-10-13 根因反例中的四个 RED，先保留原失败，再修复生产路径并在最终源码身份重跑。没有改写历史快照、降低阶段门槛、增加计数或制造骰点。

## 1. 一次性供给被乐观当成可重复

**RED：** 一次履约只增加 10，而普通成功收尾要求至少 20；没有其他可达准备路线时，原验证器把正向 delta 当成可无限重复供给。

**修复：** `ordinaryCompletionBeforeExit` 把履约、承诺创建、首次知识获取和它们的伴随效果按有限供给只计一次；可重复准备仍使用现有生产效果规则。收尾路线单独回放一次，不把它反向计入无限供给。

**证据：** `contracts-red.log` 的 `One-use +10 ... >=20` 原失败；`contracts-final.log` 同项通过。最终审计仍证明真实 v33 的 `stage-8` 可由已存在的普通成功收尾方法完成；合成的受限供应变体拒绝不足的计划。两者没有混为同一输入。

## 2. 重规划可新造悬空的待触发后果

**RED：** 待触发条件依赖拟退役节点时，重规划没有比较采用前后的可达性；简单检查 `any` 叶子会把“另一条叶子仍可达”误判为不可达。

**修复：** `replanService` 新增纯可达性比较，按 `all`、`any`、`not` 和终态节点状态计算可能为真/假。仅当本次采用把原先仍可能触发的 pending consequence 变为不可能时拒绝；已有历史悬空义务不阻断无关操作，也不会被伪造为已触发。

**证据：** `phase9-replan.test.cjs` 覆盖 `all/any/not`、终态和旧快照情形；最终核心与定向套件通过。v31 实际快照仍保有两条历史 pending 后果，其 stage-3/stage-4 已 superseded。本轮没有改 trigger、补 succeeded、取消后果或发奖励。

## 3. 普通成功与大成功奖励判断不对称

**RED：** 一次成功包含 promise 履约和计数/关系奖励时，大成功结构不同可能省略履约转换、保留同一奖励，造成二次领取；按 methodId/revision 判断也会让历史旧版本放行。

**修复：** 新增 `promiseEffectPolicy`，在冻结合同中以 branch-local promise fact + reward target 形成稳定收益身份，身份不依赖 methodId、artifact revision 或 roll grade。提交时仅在承诺事实成立后写入 claim；重复的新回合与同事务恢复分别由现有提交/操作日志合同处理。重复收益被剔除时，新的知识事实和阶段关闭效果仍保留。

**证据：** 最终 `contracts-final.log` 的不对称 grade、不同 methodId/revision、一次性计数/关系奖励反例全部通过。`phase9-5-local-compile.test.cjs` 新增已履约旧 promise 同回合仍提交新知识及普通阶段关闭的生产编译和 settlement 回归，最终 7/7。

## 4. 真实收尾与 Android 正常玩法

离线审计确认 v33 的收尾条件成立，现有普通成功可完成 stage-8；这只证明生产函数路径，不等于最终 APK 已提交该行动。最终 APK 下只创建 v31 QA 分支、检查自由输入控件、导出/导入并冷启动恢复，没有发起 Narrator/Planner 请求。输入留空后提交按钮禁用。真实新行动被独立预算账本外的历史 `outcome_unknown` 和待轮换凭据阻止，故 Android 同场景结算与后继消费仍未闭环。

## 变更与复现入口

- 生产改动：`src/domain/campaignPlan/ordinaryCompletion.ts`、`src/domain/campaignPlan/promiseEffectPolicy.ts`、`src/domain/campaignPlan/types.ts`、`src/domain/turns/types.ts`、`src/application/game/v2Compile.ts`、`src/application/campaignPlan/settlement.ts`、`src/application/campaignPlan/routeReadiness.ts`、`src/application/campaignPlan/replanService.ts`、`src/application/campaign/session.ts`。
- 根因复现：`test-logs/phase9-5-rootcause-fix-2026-10-13/contracts-red.log`；最终：`contracts-final.log`、`audit-final.log`。
- 生产回归：`test-logs/phase9-5-rootcause-fix-2026-10-13/required-regressions-final.log`、`verify-core-final.log`。

全部原始快照、SQLite 副本和层级 XML 位于被忽略的私有证据目录。公开报告不复制小说文本、提示词、响应或数据库内容。
