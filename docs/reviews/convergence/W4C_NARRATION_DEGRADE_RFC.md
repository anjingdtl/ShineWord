# W4C RFC：Narrator 期限与本地降级（仅评审稿，未实施）

> 状态：**RFC — 等待用户批准（D4）**。本文件不改变任何运行行为；`v2Turn.ts` 的提交顺序、账本规则与恢复路径在批准前保持原样。
> 编制：启动收束施工 agent，2026-10-26。依据：收束方案 §6 W4c、§10 D4；`docs/reviews/phase9-5` 的 unknown 警告。

## 1. 现状：叙事在提交之前，且受账本 unknown 规则约束

`runV2Turn`（`src/application/game/v2Turn.ts`）的权威顺序：

```
Planner（或 L1 本地合同） → 合同冻结 → 骰点（RollRecord 先持久化，可复用）
→ prepareTurnResolution（内存中一次性归约）
→ Narrator 请求（budget.consume；ledger attempt 上限 3；saveCandidate 保留候选）
→ 校验候选（turnId/grade/世界钟）
→ commitResolvedTurn（单一 SQLite 事务：分支版本/栅栏检查、状态、战役投影、
   已提交回合、叙事采用、outbox）
```

含义：
- **Narrator 未完成 ⇒ 回合未提交**。玩家侧看到的是"回合进行中/失败重试"；骰点已入日志，重试复用同一骰点（永不重掷）。
- **Narrator 请求已发送但进程死亡 ⇒ 账本 attempt 停在 prepared/sent**；冷启动 `recoverInterruptedAttempts` 将其转为 `outcome_unknown`，禁止自动重放（防重复计费），须玩家显式确认（`playRecovery`/unknown 审批 UI）。
- 叙事候选在采用前以 `saveCandidate` 保留（`narratives` store），恢复时先查已存候选再考虑请求。

### 1.1 恢复语义矩阵（崩溃/强杀时点）

| 崩溃时点 | 当前回合状态 | 当前叙事状态 | 恢复行为 | 计费风险 |
|---|---|---|---|---|
| A. Narrator 发送**前**（含排队/超时未派出） | 未提交 | 无候选 | 玩家重试；骰点复用；重新走 Narrator | 无（未派出不计） |
| B. 已**派出**、响应未落地 | 未提交 | 无候选 | 冷启动 attempt→`outcome_unknown`；禁止自动重放；玩家确认后才可再派 | 可能已计费（unknown） |
| C. 响应已落地、候选已 `saveCandidate`、**提交前** | 未提交 | 候选已保留 | 恢复路径优先复用已存候选完成提交（`narratives.get` 复用即此意） | 无（响应已到手） |
| D. **提交事务后**、outbox 未投递 | 已提交 | 已采用 | outbox 重放感知（replay-aware）投递 | 无 |

**关键不对称**：C 与 B 的差别只在"响应是否落进本地库"。任何降级设计不得抹掉 B 的 unknown 语义。

## 2. 提案：带硬期限的本地模板降级（前台 T-B 档的正确形态）

### 2.1 降级触发条件（建议）

1. 仅作用于 `narrator` 请求（T-B 前台可降级档，见 `usagePolicy`）；`planner` 不在本次范围。
2. 硬期限：从派出起算（设备端建议 45s，可配置；低于网关 ~300s 断连与 `requestDeadline` 的 narrator 档）。到期**未收到可校验候选**时：
   - 若 attempt 仍处 `prepared`（未派出）→ 本地降级提交，attempt 关闭为 `not_sent`；
   - 若 attempt 已 `sent` 且无响应 → **不自动降级**，进入现有 unknown 确认流（与 B 相同）。理由：响应可能已在途，本地先提交会把 C 情形错误地变成"已提交+迟到响应"，双写叙事。
3. 期限触发与正常失败共用同一条本地模板路径；不新增请求。

### 2.2 本地模板文本规范（建议）

- 模板输入仅限**已冻结的权威事实**：合同 `outcomes[grade]` 文本、骰点点数与结果档、世界钟、地点/人物显示名。模板不得引用正文原文、不得生成新事实、不得含数值以外的推断。
- 文本形状：一句结果事实 + 一句局面提示（例：「检定成功。你确认了眼前的线索，局势推进了一步。」），来源标记为本地模板（storyEntry 的 `mechanicalOnly` 投影已支持无叙事展示，可复用其口径）。
- 模板文案放 `src/application/game/`（纯函数、可快照测试）；**不进存档协议**——采用后叙事记录结构不变，仅文本来自模板。

### 2.3 迟到结果的处置（建议）

- 降级提交后，若原请求响应最终落地（C 变体：response 到达晚于本地提交）：
  - 该叙事**不替换**已提交回合的叙事（回合不可改写，红线 3）；
  - 迟到候选可按现有 outbox/叙事通道作为"补充段落"追加展示（或直接丢弃并留诊断计数）。建议 v1 **丢弃+计数**，避免引入第二种叙事权威。
- 账本：迟到响应按 `completed` 正常记账（计费已发生，如实记录）。

### 2.4 对 recovery 与账本的影响清单

| 位置 | 影响 |
|---|---|
| `v2Turn.ts` | 新增期限计时与模板分支；提交顺序本身不变（降级只是让"叙事来源"多一种，不是先提交后叙事） |
| `requestLedger`/`recoverInterruptedAttempts` | 无协议变化；仅新增"降级提交时 attempt 未派出→not_sent 关闭"的路径 |
| `playRecovery` | B 情形流程不变；需新增"降级回合"恢复文案 |
| 存档/DB 协议 | 不变（shineword-save-10、迁移 101+102） |
| `usagePolicy.narrator.localFallback` | 由"W4c RFC; not yet approved"改为"本地模板（已批准实施）"——批准后同步 |

### 2.5 风险与不做

- **不改提交顺序**为"先本地提交再补叙事"：那会使矩阵 B 段出现"已提交回合+unknown 请求"的复合状态，恢复语义需重写，且违反 phase9.5 已验收的恢复合同。本 RFC 的降级发生在**提交前的叙事阶段内**，矩阵形状保持不变。
- 模板文本质量低于模型叙事——这是显式取舍，仅用于期限/失败兜底。
- 不对 `planner` 做同样降级（自由输入走 W4a 匹配 + Planner 兜底已覆盖）。

## 3. 无风险先做项：核实结论（本轮已完成，未改代码）

1. **本地动作回合已不调 Narrator**：`trainSkill`/rest 走纯规则与 prepared settlement（`session.ts:3426+`、`guidance/ancillary.ts` 注释与实现），narrator_guidance 仅是异步升级。无需改动。
2. **SSE 流式预览评估**：`FetchHttpTransport` 已按 `streamActivityTimeoutMs` 走 XHR 增量读，`SseFrameMonitor` 帧间隔已入 metrics（本轮实测开局抽取 3661 帧、maxGap 533ms）。**感知延迟**的进一步改善可在 UI 层做"叙事生成中"的流式占位（不改协议、不改提交顺序），独立于本 RFC，可另行小步实施。

## 4. 批准后实施顺序（供评审参考，未开始）

1. 模板纯函数 + 快照测试；
2. 期限计时与 not_sent 关闭路径（账本测试：A/B/C/D 四情形不变式）；
3. 降级提交端到端测试（含强杀注入矩阵）；
4. `usagePolicy` 回填 + 设备验证一次降级旅程。
