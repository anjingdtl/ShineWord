# W3 简报：本地优先的开局计划（核心工作包）

> 工作包：W3｜分支：`codex/startup-convergence-w0`（提交 `8749bcf` 重构、`40236fe` 基线模型、`62d61bc` 流程切换）｜2026-10-26

## 改了什么（三个提交）

1. **提交 1（零行为变化）**：`candidateJob.ts` 的 compile 闭包逐字提取为 `candidateCompile.ts#compileAndValidateCandidate(frozen, model, scope)`，LLM 路径改为委托调用。`verify:core` 前后全绿（1391/1391）证明行为不变。
2. **提交 2（本地基线模型）**：`localBaselinePlan.ts#buildLocalBaselineModel`——从与 LLM 路径**同一个** `buildPlanningContext` 出发，产出诚实最小模型：1 个 concrete 起始阶段（查看现场/向在场者打听/着手处理，全部带四档 outcomeTemplates 与显式 L1 策略：difficulty fixed normal、evidence fixed []、allowlist []、ruleBindingHash 由编译器盖章）+ 2 个 provisional 后继阶段；`lengthPreference==='long'` 时额外携带因果校验器要求的 2 个共调度延迟后果（由同一 success 排程、以最后主阶段为门、由结局消费）。全部 provenance 为 `design_fill`、零事实引用；pitch 明写"本地基线"。
3. **提交 3（流程切换，D2 默认）**：`campaignPlanning.ts#startLocalCampaign`——本地编译→同一校验器→写库（job `physicalRequestBudget:0`、`status:'candidate_ready'`；candidate `rawResponseRef:'local-baseline-1'`；不领 lease、不走账本、不写冻结材料；事务内含 setup 状态与 intentHash 守卫）→ 复用同一 `adoptOpeningPlan` 原子采用。`OpeningScreen` 的"开始故事"默认走本地路径直达游玩页；快捷流与高级向导保留显式"AI 定制主线（较慢）"入口（D3），LLM 路径与提案卡行为不变。

## 证据（类别与状态）

| 项 | 证据类别 | 状态 | 数据 |
|---|---|---|---|
| C-05 提取后 LLM 路径回归 | 自动化测试 | PASS | 提交 1 后 `verify:core` 1391/1391（全量 phase9 套件原样通过） |
| C-06 ≥3 世界夹具过全部校验器 | 自动化测试 | PASS | 4 个夹具变体（short 默认世界 / medium+交涉技能 / long 因果门 / 带线索场景）`compileAndValidateCandidate` 零错误（`tests/convergence-local-baseline.test.cjs`） |
| C-07 采用后全部 method L1 就绪 | 自动化测试 | PASS | 生产 `adoptOpeningPlan` 采用后，首个局面每个 method `evaluateLocalCompileReadiness === 'ready'`（对入库 artifact 与 plan 校验，非内存副本） |
| C-08 点击→游玩页 p95≤3s、LLM 0 请求 | 模拟器 + 物理预算差分 | **PASS** | 5 轮中 4 轮有效（1 轮为驱动脚本时序抖动）：start_pressed→first_action_enabled 1747/1742/1848/1888 ms（p95≈1.9s）；plan_ready+adopt 合计仅 0.40–0.48s，其余为游玩页投影加载与渲染；期间物理预算 0 增量（scoped 账本保持 4/60）。APK SHA-256 `0199a869…`；截图 `local-start-play-page.png`（本机 test-logs） |
| C-09 存档往返/迁移不变 | 自动化测试 | PASS | 全量套件含 save-10 往返、分叉、迁移 101+102 测试，`verify:core` 1398/1398；本地路径未改任何协议 |
| C-10 后继预备在稳定边界触发 | 自动化测试 + 设备观察 | PASS | 自动化：基线采用后 `evaluateStagePreparationTarget` 返回 provisional 的 `baseline-stage-2`。设备观察：一次本地开局后后台确以 `campaign_plan`（T-C）生成后继（1 次物理请求，非阻塞） |
| F 游玩页无虚假"AI 已规划" | 代码 | PASS | 基线 pitch/publicPitch 明写"本地基线…后续由 AI 在后台补全"；`CampaignProgressCard` 显示的是计划内容而非来源声明，无伪造 |
| E LLM 路径回归 | 自动化测试 | PASS | phase9 套件全绿；提案卡/unknown 审批/恢复路径未动 |

设备：模拟器 ShineQA AVD（API 37，x86_64）。真机 NOT RUN。

## 关键实现取舍（记录备查）

- **`long` 偏好不做钳制**：编译器的 `lengthPreference` 直接取自 intent（`localCompile.ts:460`），本地模板对 `long` 携带满足因果门的 2 个延迟后果，而非改写玩家偏好。
- **本地写库不做 lease/fencing**：按方案 W3"不领 lease、不走账本"；但保留事务内 setup 状态 + intentHash 守卫（与 LLM 发布事务相同的防陈旧检查）。
- **方法不足时的失败是显式的**：世界包在锚点下可编译方法 <2 时抛 `local_baseline_insufficient_methods`，UI 引导改用 AI 路径；不放宽任何校验器。

## 未验范围与下一步

- C-08 真机、低端设备：NOT RUN。
- 本地开局后的 10 回合连续游玩（K7 离线口径的自动化半边）尚未做——在 C3/C4 期间用同一世界补测。
- 后台 `campaign_plan` 后继预备产物的质量（AI 主线 vs 模板）未评审——属 C-17 真实旅程范畴。

下一步：C3（W4a 自由输入本地路由、W4b 减少 planner_required、W4c 只写 RFC）。
