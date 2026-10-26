# W4/W5/W7 简报：回合收束、冷启动拆分与文档收束

> 工作包：W4a/W4b/W4c（回合热路径）、W5（冷启动改动）、W7（文档收束）｜分支：`codex/startup-convergence-w0`｜2026-10-26

## W4a 自由输入本地路由（C-11）

- 新增 `src/application/game/freeformMethodMatch.ts`：三级高置信匹配（exact＝首步原文归一相等；title＝玩家输入包含唯一办法标题；keyword＝与标题/目标共享 ≥4 字连续片段且唯一）。任一层命中 >1 即拒绝（宁多调 Planner 不误绑）。
- 接线：`session.ts` 在无点选 candidateRef 且精确匹配未命中时先本地匹配，命中后仍走同一 `evaluateLocalCompileReadiness`（policy 决定 L1 或 Planner，匹配器不越权）。
- 证据：`tests/convergence-freeform-match.test.cjs` 7 项全绿（黄金样本零误绑：歧义文本、近义改写、空输入一律不绑）；`verify:core` 1405/1405。
- 未验：真实玩家输入分布下的命中率（需真实旅程，C-17 范畴）；"Planner 占回合比例"基线沿用 L1_PARITY 文档口径（L2 回合 1 次 Planner/回合）。

## W4b 减少 planner_required（C-12 的一半）

- 新创作门槛（`candidateModel.ts` 解析层）：observe/talk/interact/move 且证据白名单为空或仅一项时，显式 `planner_required` 是作者合同错误（无骰动作由引擎自动结算，不存在"需 Planner 闭合"的档位）；skill_check 保留模型档位选择。存档产物不再解析，不受影响（未合成任何默认值）。
- 提示词（`generationService.ts`）显式加入该规则。
- 证据：`verify:core` 1405/1405（phase9-5 的 skill_check+planner_required 用例原样通过，证明门只作用于无骰动作）。
- 未验：真实模型对新提示词的 planner_required 产出比例（需真实请求，C-17 范畴）；L1/L2 黄金套件四档一致性沿用 phase9-5 既有结论（本次未改结算路径）。

## W4c Narrator 期限与降级（C-13：RFC 已交付，未实施）

- `W4C_NARRATION_DEGRADE_RFC.md`：四时点恢复语义矩阵、触发条件（attempt 已派出则绝不自动降级）、模板文本规范（仅冻结合同事实）、迟到响应处置（v1 丢弃+计数）、账本/recovery 影响清单。**未改任何运行行为**，等待 D4 批准。
- 无风险项核实：本地动作回合（训练/休息）本就不调 Narrator（`session.ts:3426+`）；SSE 流式指标已存在（实测开局抽取 3661 帧）。

## W5 冷启动拆分（C-14）

- 改动：`database.ts` 将 FTS5 探测与风格分析恢复移出关键路径（`deferredRecovery` promise；fts5 字段保守 false 且当前无消费者）；`recoverInterruptedAttempts` **保留在关键路径**（unknown 保护不换速度）；`writerStyle.ts` 全部 projectStyle 调用先 `await deferredRecovery` 防清理与新变更竞态。
- 证据（模拟器 ShineQA AVD，n=5，同 APK 线）：boot_end p95 2083→**1118ms**（-46%）、db_runtime p95 889→**445ms**（-50%）。`verify:core` 1405/1405、mobile typecheck 绿。
- 未验：真机、首次运行空库。

## W7 文档收束（C-16）

- 方案文档已提交并登记为唯一执行入口；README 顶部加"当前施工"指引（版本六处一致性门禁保持绿）；新增 `docs/INDEX.md`（现行/历史/reviews 速查）；progress.md 顶部状态表逐里程碑更新；本轮全部证据在 `docs/reviews/convergence/`。
- 截图哈希（本机 `test-logs/convergence-w0/`，不入库）：`wizard-confirm-local-goals.png` sha256 前缀 `8b7d07a0ec8ba9a2`、`wizard-ai-refresh-button.png` `778b2b668b0db5c1`、`local-start-play-page.png` `67a6604d1257ff1d`。

## 预算登记（累计）

scoped `convergence-20261026` 用量 **4/60**（world_extract×1、style_analyzer×1、opening_goal×1、campaign_plan×1 后台）。C3/C4 施工期间零新增物理请求。

## 未验范围

C-15（离线 10 回合）：**BLOCKED**——依赖 W4c/D4（Narrator 先于提交，无网络时回合无法完成；L1 编译本身零网络）。真实模型 C-17、外部试玩 C-18 待用户安排。
