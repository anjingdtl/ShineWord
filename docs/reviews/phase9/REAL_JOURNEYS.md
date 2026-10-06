# REAL_JOURNEYS — Phase 9 真实 GLM 旅程证据

| 项目 | 内容 |
|---|---|
| 执行日期 | 2026-10-06（Asia/Shanghai） |
| 驱动 | `tools/real-glm-phase9.cjs`（主机生产服务链：mobileHarness + 真实 SQLite + 真实 GLM HTTP，非模拟） |
| 模型 | GLM-5.3-Flash @ bigmodel coding paas v4（密钥仅内存，未落任何跟踪物） |
| 输入 | 《放开那个女巫》全本生产渐进导入（1504 章 / 3260 块 / 9 构建组；世界 `world-src-7f45fe0b11ea30ec-muvmrxho` r1 已发布） |
| 预算 | 400 次物理请求上限；实际消耗 **313**（manifest：`.tmp/phase9/test-manifest.json`） |
| 世界构建真实评审 | 导入命中真实 canon_conflict 审查门（1 组冲突事实）与 3 条 invalid_proposal（模型引用未发布 item/situation 目标）；经**生产解决 API**（`resolveCanonFactConflict`/`resolveReviewIssue`）逐条处理后发布成功 |

## 旅程总表（合计 90 个有效玩家决策）

| 旅程 | 意图 | 决策 | 物理请求 | 错误（可恢复拒绝） | 主线结果 |
|---|---|---:|---:|---:|---|
| SMOKE | 调查（J2 画像） | 10 | ~22 | 0 | stage-1 active |
| J1（重跑，含结局守卫） | 保护受威胁者 | 20 | ~46 | 5（非法地点×3、过期路径×2，全部安全回退后换行动成功） | stage-1 succeeded；结局「灰烬之名」(failure) 于 turn-0002 条件触发 |
| J2 | 调查异常 | 20 | ~43 | 0 | stage-1 succeeded → stage-2 active |
| J3（3 次规划尝试后成功） | 合作/日常建设 | 20 | ~44 | 1（未知地点，安全回退） | stage-1 active；结局「冷却的铁」(pyrrhic) 于 turn-0017 条件触发 |
| J4-A | 分叉后护送路线 + 换目标 | 10 | ~22 | 0 | intentRevision 2、goal_changed；节点收敛 |
| J4-B | 分叉后调查路线 | 10 | ~21 | 0 | intentRevision 1、原目标；节点收敛 |

决策日志（每决策含意图、candidateRef、grade、campaignEvents、nodeStates、耗时、请求数）：`.tmp/phase9/journey-{smoke,J1,J2,J3,J4}.jsonl`。

## 逐旅程要点

### J1 保护（20 决策）
- 规划：1 请求 46s 直接 ready；开局两路线（调查/直接介入）+ 四档结果模板。
- 途中 5 次本地规则拒绝（Planner 提议 `loc-border-town` —— 原著地点存在但非已发布场景；以及一次过期办法引用）：回合**零检定安全回退**后换行动继续 —— A13 的生产行为证据。
- 保护对象在第 2 回合的严重失败后果中死亡 → 结局条件（failure）成立，「灰烬之名」自然触发。战役阶段 stage-harbor-escape 先行 succeeded，证明进度先于结局正常求值。

### J2 调查（20 决策）
- 0 次拒绝；自由输入（同义改写每 3 次一次原文）与引导点选混用；grade 分布 failure/severe 偏多（无技能主角的现实骰运）。
- stage-harbor-ash succeeded → stage-convoy-road superseded → stage-truth-reveal succeeded（部分节点在 fork 前完成）。

### J3 合作/建设（20 决策）
- 3 次规划尝试：第 1 次命中"结局在开局即成立"新守卫（正确拒绝）；第 2 次机械同型路线由编译器补齐第二路线；第 3 次成功（2 请求）。
- 结局「冷却的铁」(pyrrhic) 在 turn-0017 由条件触发 —— **真实旅程中自然达成的可验证结局**（方案 §16.3 短篇结局要求满足）。

### J4 同快照双路线（10+10）
- fork 于 J2 战役 v4 快照：两分支 runtime 完全隔离 —— A 分支 `changeCampaignGoal` 后 intentRevision=2、目标「护送关键证人…」、replanReasonCodes=[goal_changed]、v15；B 分支保持原调查目标、v14（A31 运行时隔离实证）。
- 节点终态在两分支收敛（剩余阶段的事件条件在两条玩法路线下都达成）；权威差异体现在 runtime 意图/目标/版本与提交历史。
- A 分支换目标后触发真实 replan：见下。

## 真实 LLM 重规划（A20 部分）— FAIL（fail-closed 正确）

- 触发链真实工作：换目标 → 管理提交（campaign_goal_changed 事件 + runtime intentRevision+1）→ 单飞 replan job 入队（重复触发合并为同一 job）。
- 候选生成经 6 次真实往返（12 请求）全部被**严格结构门禁拒绝**：模型在修订任务上反复输出结构漂移（modelVersion 拼写、stages 缺展示字段、completion/ending 形态）。其中 4 类漂移已通过解析容错修复并通过 18/20 离线再解析验证；剩余漂移（firstSituation 字段命名等）在预算止损前未再消耗请求。
- 诚实结论：**重规划的本地机制（触发/单飞/稳定边界 CAS 采用/局面沿用）由 4 项 phase9-replan 单测证明；真实 GLM 修订往返未产出可 ready 候选 —— 严格门禁按设计拒绝伪装计划**（A07/T07 行为正确，A20 的 LLM 半环 FAIL）。

## 预算与耗时（对账）

- 总物理请求 313/400（账本逐条可查 `llm_request_attempts`）；其中世界导入+评审解决 ~34、规划 ~15、回合 ~250、重规划尝试 12。
- 规划耗时：46–120s/次（1–2 请求）；回合结算中位数 ~13s（2 请求/回合：Planner+Narrator）；最长 51s（含 guidance 请求的第 3 请求回合）。
- 普通回合无固定 campaign_plan 请求（A37 语义满足：主线推进全部由本地 reducer 求值）。

## 未达成/差异（如实）

1. **Android UI 完成全部 J1/J4 旅程**：设备侧因会话时长限制执行了开局链路验证（见 FINAL_REPORT 设备段），未完成 30 个 UI 决策的完整重放 —— 主机生产链已完成同等决策数。
2. **A19 旅程级后果持续**：三次战役的模型计划未产出存活的延迟后果（schedule_consequence 缺失或触发即决）；机制由单测证明（phase9-domain/turns），真实内容样本未覆盖。
3. 真实 LLM replan 候选生成（见上）。
