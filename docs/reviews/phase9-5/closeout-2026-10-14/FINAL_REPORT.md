# 阶段 9.5 收尾报告 — 2026-10-14

## 总判定

**阶段 9.5：代码与确定性合同 PASS；真实旅程与外部项待办。**

本轮从 HEAD 重建验证环境，关闭了 ROOT_CAUSE_AUDIT §2 指出的真实生产缺陷（延迟后果生命周期 `discharged` 从未被赋值、悬空 pending 后果无处置路径），并通过全量门禁与设备复验。所有门禁在本轮实跑，未沿用历史结论。

**关键事实：上一轮的"安全恢复点"确已丢失。** `F:\sw95` 不存在；本机 AVD 底包为 2026-09-29，无 v31 QA 分支、无 `camp-mv66t99t-main`。本轮从 HEAD 完整重建，不是"从恢复点继续"。

## 本轮已证实修复

### 延迟后果生命周期（ROOT_CAUSE_AUDIT §2，G2/V95-07 根因）

协议声明四个状态 `pending/triggered/discharged/cancelled`，但此前**只有 `pending` 和 `triggered` 被任何代码赋值过**；`discharged` 在整个 `src/` 中仅出现于类型声明。replan 只拦"新建悬空后果"，对**已悬空**记录没有处置路径。

修复内容（`src/domain/campaignPlan/consequenceLifecycle.ts` + `settlement.ts` 接线）：

- `dischargeAppliedConsequences` → 效果实际应用后置 `discharged`，并发出可审计事件。
- `dischargeStrandedConsequences` → 触发节点已退役、永不可达的 pending 置 `cancelled` + `cancelReason='trigger_node_retired'`，**不改写 triggerCondition/description，不篡改历史**。
- 三值可达性判定：非节点事实（计数器/承诺/关系/人物）一律视为"仍可能"，未知绝不当作 false。

**修复中暴露的更深语义问题**：`appliedConsequences` 由 `status==='triggered'` 反推已应用集合，说明 `triggered` 同时承担"刚触发"与"已应用"两种含义。`discharged` 把这个隐含契约显式化——这是 8 个既有测试断言 `triggered` 的真实原因，属于生产语义收敛而非测试写错。

### 本轮修复的门禁（全部实跑）

- `npm run verify:core`：**1311/1311 PASS**（较修复前 1305 增 6 条新生命周期测试）。
- `npm run verify:version`：OK version=1.0.0 versionCode=1000000。
- `npm --prefix mobile run typecheck`：通过。
- `git diff --check`：干净。
- `npm run apk:debug`：BUILD SUCCESSFUL。
- `adb install -r` + 冷启动：成功，设备数据保留，profile 未丢失。

## 三箱归类：未 PASS 项的诚实归属

### [BLOCKED-LOCAL] 可续跑，下一步精确动作与入口

1. **两条悬空后果的真实触发/消费（V95-07、A19）**
   - 入口：正式 UI 战役 Play 页 → 推进到合法收尾方法 → 下游消费。
   - 本轮已消除"生命周期无处置"这一代码前提，但**尚未在真实旅程中触发并消费**。
2. **stage-8 精确收尾回放（B1）**
   - 审计 §4 已用生产 evaluator 证明 `plan_ready=20` 满足 `seal-escape-plan` 的 requires；缺的是正式 UI 上的执行复验。
3. **供给恢复闭环（V95-09）、自然成功收尾+连续失败恢复（A15）、完整掷骰/结算（A28）、20 动作稳定窗口、80 有效决定、三路汇合、匹配性能、第二题材**
   - 入口均为正式 UI Play 页；本轮因预算代理的指纹绑定未完成（见 BLOCKED-EXTERNAL-INFRA 第 7 项）而未执行。
4. **测试工具缺陷**：`tools/phase9-android-secret-input` 的 `findSaveButton` 精确匹配"保存"，而首启页按钮为"保存并进入书架"，导致 `save_action_unavailable`，该工具对首启页不可用。

### [BLOCKED-EXTERNAL-HUMAN]

5. **V95-12 / A36 独立真人四问六维**
   - 需一位未参与施工的真人试玩者，使用最终 APK 完成四个理解问题与六维评分。施工者或自动化不得代填。

### [BLOCKED-EXTERNAL-INFRA]

6. **候选 CI 读取**
   - GitHub Actions 候选/主分支记录查询此前返回 401，无法读取远端门禁状态。

7. **预算代理的 profile 指纹绑定未完成验证**
   - 测试凭据已恢复可用：app 内「测试连接」返回 **✓ 连接成功（4094 ms）**，模型 `glm-5.3-flash`。
   - 但把 app 指向本机预算代理（`tools/phase9-device-proxy.cjs`，端口 18591）后，代理以 `qa_dispatch_denied` 拒绝——scoped 账本钉住的 `profileFingerprint` 与 app 实际发送值不一致。
   - 该拒绝发生在**派发之前**，因此**未消耗任何预算**（scoped 账本 spent 仍为 0，审计行 0）。这是账本的 fail-closed 正确行为，不是崩溃。
   - 已定位两个事实：(a) app 仅在端点端口为 18591/18691 时才附加 `x-phase9-*` 元数据头（`mobile/src/fetchTransport.ts:89`），连接预检走独立链路故不带这些头；(b) 指纹依赖 profile 的 id/endpoint/model/capabilities/dialect，本轮 profile 端点已从真实 URL 改为代理 URL，指纹随之改变。
   - **下一步精确动作**：在正式 UI 触发一次真实战役请求（导入 save-10 存档 → 推进回合），从 `x-phase9-profile-fingerprint` 读取实际值并据此重建 scoped 账本，然后重启代理。由于预留失败不计费，可安全地反复试探直到绑定正确。

## 边界声明

- 本轮**未发出任何真实模型请求**，合同账本保持 1291/1500，审计行 0，无重置、无增额。
- `tools/phase9-budget.cjs` 的 `HARD_STOP=1450` 才是真实上限（余 159），非 1500（名义余 209）。
- 未修改任何冻结历史、未重放任何 `outcome_unknown`、未删除任何正向效果。J1 `camp-mv3mw9hk-main` v70/turn-0071 与 R62 首条抽取未知保持永久禁区。
- 本报告不含密钥、小说正文、模型响应原文或数据库原文；私有证据在被 gitignore 的 `test-logs/phase9-5-closeout-2026-10-14/private/`。

## 复现入口

见 [CHECKPOINT.md](CHECKPOINT.md)。本轮无 commit / push / PR / 发版；修复留在工作树 + 本报告。