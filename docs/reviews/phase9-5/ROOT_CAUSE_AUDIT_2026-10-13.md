# 阶段 9.5 未通过的根因审计 — 2026-10-13

## 结论与范围

未通过包含产品语义缺口和未完成验收两部分。最新 agent 修复了一个真实重复履约领奖样本，完成 APK 安装、save-10 子流程及本地累积测试；这些进展成立。当前不能把所有 FAIL/NOT RUN 都归因于同一个仍在复现的硬阻滞，也不能用“核心 1302 项通过”推断生成内容一定能闭环。

本轮检查 HEAD `9416adfd07c901414618e0518b008de0060b9ec3`、最新提交、10 月 13 日报告、私有 SQLite 快照及逐项证据；重新构建 core，执行相关测试及离线反例。没有读凭据、发送真实模型请求、操作模拟器、修改生产代码或原数据库。真实账本仍为 `510/600`，510 completed。

原证据 `after-repeat-fulfilled-promise.db` 以 SQLite readOnly 打开；前后 SHA-256 相同。受控反例只修改进程内对象，不编辑已采用工件、存档或历史骰点。

## 1. 生成校验和运行资格没有共享“一次性作用”的语义

定位：

- [ordinaryCompletion.ts](../../../src/domain/campaignPlan/ordinaryCompletion.ts:69)
- [普通成功校验](../../../src/domain/campaignPlan/planValidation.ts:142)
- [运行资格](../../../src/application/campaignPlan/routeReadiness.ts:72)

`ordinaryCompletionBeforeExit` 把不关闭局面的成功效果放入 `repeatable`。对于计数条件，只要里面存在一个正向 delta，就乐观认为能够达到门槛；它没有区分“可以无限准备”与“某个承诺只可以履约一次”。函数文档明确这是必要条件上界，并非完整玩法证明，但验收不能把这个上界当作可完成性证明。

受控反例取真实 stage-8 的效果结构，仅保留两个方法：一次履约 `plan_ready +10`，以及需要 `plan_ready >=20` 才能选择的收尾。基线为计数 0、旧承诺 open。

实际结果：

1. 普通成功生成校验返回 0 个错误。
2. 第一次履约后计数为 10，承诺 fulfilled。
3. 新 readiness 拒绝再次履约。
4. 收尾 requires 仍为 false；仅这两个方法无法闭环。

这是生产校验器与运行守卫的确定性反例，**不是宣称当前真实 stage-8 只有这两个方法或已经软锁**。真实 stage-8 另有观察、探路准备方法。

根因：producer/consumer 形状合法，没有证明 producer 可执行的次数、它执行后的资格变化，以及剩余合法方法是否仍能达到 completion。仅继续增强模型说明，无法消除这个跨层盲点。

修复方向：生成/采用时补有界的生产规则回放证据，或共享最小的一次性效果资格模型；对一次履约、已知知识、固定承诺创建的收益使用有限供给，不能一律视为无限准备。不要另写第二套状态引擎，也不要降低门槛掩盖反例。

## 2. 真实快照中两条旧后果已永久失去触发路径

精确输入：导入 QA 分支 `camp-mv5kpgrf-main`，v33，revision 12。

| 已排程后果 | 等待条件 | 当前节点状态 |
|---|---|---|
| consequence-roland-tacit | stage-3 succeeded | superseded |
| consequence-route-verified | stage-4 succeeded | superseded |

两项均仍为 pending。

定位：

- [重规划采用](../../../src/application/campaignPlan/replanService.ts:293)：展开旧 runtime，保留 deferredConsequences，同时把被替换的未来节点设为 superseded。
- [节点推进](../../../src/domain/campaignPlan/progressReducer.ts:241)：所有终态节点直接跳过，superseded 不会再成为 succeeded。
- [后果触发](../../../src/domain/campaignPlan/progressReducer.ts:377)：仅等待原 triggerCondition 成立。
- [后果生命周期类型](../../../src/domain/campaignPlan/types.ts:165)：协议已有 discharged/cancelled，但上述采用过程没有处理这些失去触发路径的记录。

离线用真实 stage-8 的普通成功收尾效果推进，stage-8 正常成为 succeeded；两项旧后果仍 pending。它们是历史重规划留下的悬空记录，不能通过“再多玩几回合”触发。

根因：重规划保护了旧效果正文和历史节点，却没有处理**已排程义务的未来触发可达性**。这不是应当强制让所有条件后果触发；条件失效或路线放弃可以合法地不触发，但需要明确、可审计的生命周期处置，不能永久悬空并冒充未来仍可消费。

修复方向：采用新 revision 前核查 pending trigger 对拟退役节点的依赖。优先保留必要的合法路径；若因玩家改变路线而不再适用，应在新的管理提交中记录经定义的取消/解除理由。改变触发语义需要明确协议设计，不能直接篡改旧条件、补假成功或修改过去的快照。

## 3. 最近的防重复修复覆盖了单一样本，仍有漏拦与误拦

定位：[routeReadiness.ts](../../../src/application/campaignPlan/routeReadiness.ts:62)。

### 3.1 普通成功/大成功结构不对称时漏拦

`resolvedPromiseTransitionsOnly` 要求 success、full_success 两档都存在已解决承诺的转换。

受控反例：普通 success 保留“履约旧承诺 +10 计数 +关系”，full_success 保留独立准备收益而省略 promise_fulfill。这类不同四档结构不能靠当前对称样本证明安全。

实际结果：readiness 返回 null；已解决承诺的 `promise_fulfill` 在底层没有应用，但伴随的计数仍从 20 增加到 30。

对应底层：[transitions.ts](../../../src/domain/situations/transitions.ts:96)。promise 转换的幂等只保护 promise 本身，没有把其他收益与“这次确实发生了首次履约”绑定起来。当前修复是上游模式匹配，不是完整的一次领奖合同。

这是受控的合法效果形状反例；并未证明当前精确存档方法已经绕过修复，因为其两档确实对称，原样本被正确阻止。

### 3.2 只因旧承诺已解决，误拦新的有效阶段收尾

受控反例在当前真实收尾方法的成功两档中附带一个已履约承诺的幂等 fulfill，保留新的 `situation_status resolved`。

实际结果：守卫返回 `campaign_method_promise_already_resolved`，拒绝整个方法，虽然其中存在新的有效阶段关闭。

根因：当前谓词提取并检查 promise 转换，但没有判定其他成功效果是否仍然是新的有效推进。它也没有显式区分“重复索取同一奖励”与“沿用已履约事实完成另一个目标”。

修复方向：定义收益的一次性身份及其事实前提，在编译/结算的既有合同内执行；投影和提交前资格复用同一规则。保留新阶段关闭和独立事实，不因冗余幂等效果拒绝整条合法路线。不能简单删除全部正向效果或增加更多标题/字符串黑名单。

## 4. 当前 v33 并非已证实无法完成 stage-8

最新报告保留 V95-09 FAIL，并以“阶段仍 active、旧失败未端上闭环”为边界。这个整体验收状态可以保留，但不能据此推断**当前分支的每条路线都不可推进**。

真实快照里：

- `plan_ready=20`。
- `seal-escape-plan` requires 为 `plan_ready>=20`。
- 对真实 snapshot 使用生产 condition evaluator，返回 `{value:true, unknown:false}`。
- 当前事件/承诺守卫返回 null。
- 在内存中应用该方法的原始 ordinary-success 转换，再调用生产 progress reducer，stage-8 成为 succeeded。

因此，当前已有一条规则层可关闭该阶段的路线。上述结果不是 Android 选择、掷骰、Narrator、原子提交通过，也没有关闭 G2/V95-09。它说明下一轮应该先做**精确收尾回放**，而不是把“没继续执行”直接判断为需要重新生成主线。

[最新 CHECKPOINT](final-pass-2026-10-13/CHECKPOINT.md:15) 明确写出最终 APK 安装后没有继续行动。隐藏重复路线后，没有完成最终身份稳定窗口。

## 5. 验收执行及证据存在独立缺口

- 80 个有效决定、最终稳定窗口、三路汇合、真实后果消费、故障恢复与 matched 10+10 均没有闭环；不能靠修复某个按钮替代这些合同。
- V95-12/A36 缺独立真人属于外部参与缺口，不是更多生产代码就能自动解决。
- V95-04 的合同是同规则、同冻结状态、同骰流的四档等价。最新 FINAL_REPORT 又把“live 四档 parity”列为强制缺口，需澄清其额外含义；不能要求自然真实随机游玩复制同一骰流，或用新文字标准无限扩大完成线。
- 旧 J1 turn-0071 应继续保留；新合法分支可用于验证修复后的 A28，不应把“必须改写旧冻结回合”当作关闭新版本故障的条件。
- 10 月 13 日 `decision-ledger.jsonl` 的唯一行尾部是字面量 `\\n`，标准 JSONL 解析失败；另一个 replay 文件只有一条 prepared 记录。这没有否定数据库证据，但不能当作已认证的行动结果账本。10 月 12 日账本有 60 个事件行、14 个 decision_result；prepared/submitted/result 不能相加充当有效决定。

应把“已确认产品故障”“当前精确场景未执行”“完整合同未覆盖”“需要真人”四种原因分别登记，避免只更新 PASS/FAIL 总数却没有确定下一条可执行验证。

## 本轮复验与执行限制

| 执行 | 结果 |
|---|---|
| npm run build:core | PASS |
| 机会投影、replan、因果校验、blocker-repair 四套定向测试 | 31/31 PASS |
| 新增离线合同检查 | 2 PASS / 4 RED；上述真实 pending 缺口与三个受控语义反例 |
| 原 DB 只读与前后 SHA-256 | 不变 |
| 真实请求、模拟器操作、生产代码修改 | 均为 0 |

重现工具在当前工作树被忽略的 `.tmp/phase95-rootcause-20261013/`：

```powershell
npm run build:core
node .tmp/phase95-rootcause-20261013/audit.cjs
node --test .tmp/phase95-rootcause-20261013/contracts.test.cjs
```

`contracts.test.cjs` 的四项失败是刻意保存的期望合同 RED，未加入常规 tests/，不会改变原测试套件结果。`audit.cjs` 只读原 DB，反例在内存中执行，不调用任何 provider。

当前主工作树的 scope-v3 原始字节指纹为 `25b6ec738c38b8d076a85bd0341313461e8d90417c726230577cc68a75118d42`，与 agent 安装身份 `1c57c7ee...` 不同。逐文件比对确认差异的 155 个输入全部是 CRLF/LF；归一化后没有实质源码差异，F:/sw95 原文件也没有偏离留存清单。因此本轮反例针对相同生产逻辑，但不冒充安装 APK 的当前原始身份。主工作树已有 APK 也未被当作 agent 最终安装产物使用。

## 修复优先级

1. 先统一一次性作用/收益与普通成功供给模型，关闭受控漏拦、误拦和有限准备反例。
2. 再处理重规划时 pending 后果对退役节点的依赖，补保留路径/取消处置及采用事务回归。
3. 重建最终 APK，在新合法 QA 分支继续实际收尾及下游消费，完成最终身份稳定窗口；保留旧冻结历史。
4. 分开补自动验收和真人参与，修复行动账本格式并按完整合同计数。

不要仅再调模型说明、增加计数、隐藏更多路线或追加大量相同形状的 PASS 用例。根因是跨生成、运行资格、状态转换与重规划的语义闭环尚未形成。
