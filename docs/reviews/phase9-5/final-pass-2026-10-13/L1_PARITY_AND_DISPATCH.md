# L1 协议、规则派发与等价性

## 调用路径

Android 提交行动后，CampaignSession 冻结行动合同及内容/规则绑定；runV2Turn 调用本地规则和判定；settlement 统一应用结果并原子提交；Campaign 状态、进度和后果仍只有这一条权威写入路径。机会引导从同一状态派生为只读投影，刷新不会创建第二份进度权威。

入口文件：
- src/application/campaign/session.ts
- src/application/campaignPlan/opportunityProjection.ts
- src/application/campaignPlan/routeReadiness.ts

## L1 安全边界

- 本地方法只有在难度策略、证据绑定、权限、内容绑定与当前状态均明确时才可安全派发。
- 缺少 difficultyPolicy 或 evidenceBinding 不使用默认值绕过检查；按当前协议转入 needs_planner 或拒绝。
- 已履约/已打破承诺不能再次走承诺奖励路线。
- 提交前 guard 使用当前冻结状态，避免过期路线在模型请求或骰点前继续执行。

## 本轮证据

- 最终核心套件 1302/1302 通过；确定性生产路径覆盖四个判定档位。
- turn-0031 是一个真实 Android 派发样本：可审计方法仅发出 Narrator 请求，没有 Planner 请求。该结论只适用于该行动。
- 整个 600 次作用域含 89 个 Planner 请求，主要用于 L2/后台；不能将单个 L1 样本外推为全局 Planner=0。
- 四档 parity 是同合同、同状态、同规则和同骰流的确定性夹具结果，不是同一真实状态的四种 live 模型结果。
- 修复后已解决承诺路线的请求前拒绝由核心回归覆盖；最终 APK UI 隐藏该路线。端上中文自由文本提交未完成，原因见 BUGS_AND_FIXES.md。

V95-02 通过当前静态/确定性协议检查。V95-03 仅一个真实样本通过。V95-04 仅确定性通过；真实状态四档 parity 未证明。双击、竞争、中断和 unknown outcome 仍待 V95-05。
