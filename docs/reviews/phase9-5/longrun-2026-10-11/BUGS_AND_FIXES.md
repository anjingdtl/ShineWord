# Phase 9.5 blockers, root causes and fix status

## 2026-10-12 定向生产链复验追加（最新）

继续离线验证后，BUG-95-001 的精确拒绝候选已在私有数据库副本中新建合法分支，通过生产重规划/严格编译/正式新 revision 采用，并实际使用新机会。发现额外的问路成功事件无消费者，新增对应定点修复指导；新候选以不结束阶段的准备事实和独立消费者闭合。原 validator、候选、已采用工件和历史不改。

BUG-95-009 的精确 J1 v70 同样在副本中正式分叉，经真实 Session 载入参与者并提交新行动，无再次冻结；该固定新行动结果为 failure，没有改骰点强求成功，没有恢复原 turn-0071。原失败/骰点及原数据库哈希保留。

最新定向 33/33、core 1300/1300、移动 typecheck、version、Debug build、diff check PASS。真实模型请求 0，预算文件未变。Android 启动命令被自动审批拒绝，端上同场景 NOT RUN；真实模型生成质量及独立玩家仍未验证。BUG-95-001/009 工程子项新增 PASS，端上故障整体不标 CLOSED。详见 [定向复验追加](FOLLOWUP_VERIFICATION_2026-10-12.md)。后文保留前次检查点。

## 2026-10-12 修复追加（当前源码）

本次进行了授权的离线修复与构建，真实模型请求和设备操作为零。下方停测报告原文保留为历史证据；最新源码身份、完整文件增量、命令和结果见 [修复复验记录](REPAIR_VERIFICATION_2026-10-12.md)。

| 项目 | 代码/离线证据 | 端上及剩余状态 |
|---|---|---|
| BUG-95-009 | 修正 scene-only 初始化遗漏已采用 participantEntryIds；新行动边界合法载入，四档角色预检。精确只读快照四档结算及普通成功原奖励通过；新 SQLite 行动路线可见、载入、提交通过 | Android 新合法分支同场景 NOT RUN；旧 J1 v70/turn-0071 及骰点未恢复、未改写，故障整体不标 CLOSED |
| BUG-95-001 | 三项诊断被分号合并，完整单条正则此前漏匹配；拆分诊断并明确新的 required-main trigger/消费者。精确候选指引及严格因果正反例通过，validator 未改 | 正式新 revision 真实生成/采用/UI 使用 NOT RUN，供给故障整体仍 OPEN |
| A15/A36 | 普通成功硬门的定点修复指导；固定 SQLite 内容证明准备 counter 和失败代价/知识被不同方法实际消费 | 历史三意图和独立玩家复验 NOT RUN，A15/A36 仍 FAIL；通用开局空效果未伪造为进展 |

归属校正：精确 cons-crest-truth/cons-settlement 拒绝候选在只读库中绑定 J3 v3，不是旧叙述的 J2。按真实候选修复，不用相似开局代码替代原故障证明。最终 core 1298/1298、移动 typecheck、version、Debug 构建和 diff check PASS；无真实请求。第一次全量两项失败及后续修复日志保留。

以下保留停测时点报告，不将旧失败或旧身份改写成本次复验。

**更新：** 2026-10-12。以下状态以当前工作树代码与已留存回放证据为准。
**停测边界：** 用户要求测试告一段落。此后只读审计和报告写作，没有再操作模拟器或修改产品代码。历史故障证据保留；“代码中已有防护”不等于旧失败存档已恢复。

## 根因与状态总览

| ID | 用户影响 | 当前结论 |
|---|---|---|
| BUG-95-001 | 成功调查后，后续主线计划被拒绝，主目标没有可用后继 | OPEN：同案手动重规划未复验 |
| BUG-95-002 | 旧 Method 需要 Planner 决定难度和证据 | L1 协议/运行路径已实现；真模型 UI 样本有 Planner=0；长期覆盖未完成 |
| BUG-95-003 | 开局计划因线索证据引用不属于开局现场而被拒绝 | CLOSED：请求材料补齐精确现场证据 ID，严格校验保留 |
| BUG-95-004 | 长开局计划反复生成重复延迟触发、无后续消费者的内容 | CLOSED（已复现流）：修复指导后计划通过并采用；长期后果消费验收未完成 |
| BUG-95-005 | Windows 并发时测试预算锁把合法竞争误判为 I/O 故障 | CLOSED：锁竞争重试修复，专项及全量工程回归通过 |
| OBS-95-006 | 列表显示的旧建议在点击时变陈旧 | 安全拒绝并刷新，属预期 fail-closed；未见无状态变化时反复发生 |
| BUG-95-007 | stale 后继准备任务吞掉相同触发器，未来阶段不再排队 | CLOSED（同场景回放）：新 stale 去重行为已生成新任务并重新计划 |
| BUG-95-008 | 计划重规划换 planId 后，仍绑定当前节点的完成路线被投影隐藏 | CLOSED（同场景回放）：合法旧 source artifact 继续可见并完成阶段 |
| BUG-95-009 | 成功掷骰后结算因收尾奖励角色无法解析而冻结回合 | OPEN：根因已定位，当前代码已有掷骰前阻断；历史 J1 回合尚未安全复验 |
| OBS-95-010 | 新战役一次自由输入检定失败，提交后没有权威状态变化 | 观察项：只出现一次，不能据此判为持续软锁；根因未确定 |

## BUG-95-001 — 调查成功后手动后继计划不可用

- 影响：J2 调查到证词并公开转向西侧森林后，自动计划因状态绑定变化变 stale。玩家使用“准备后续主线”后，手动候选经过一次模型修复仍被本地结构校验拒绝，界面仍展示旧目标且无 ready 主线路线。
- 失败候选的精确拒绝包括：cons-crest-truth 没有下游消费者；cons-settlement 触发早于所需两阶段间隔；cons-settlement 也没有下游消费者。拒绝本身正确，不能放宽 causal validator。
- 根因边界：计划生产/修复链无法把校验器提出的多个因果闭合约束转成可执行修复；单次修复重复了不满足延迟和 consumer 约束的结构。结果是“模型返回成功”但没有可采用的后继内容。
- 当前状态：BUG-95-004 的新 structural repair 指引已增强生成约束，且另一条长开局路径通过；但这条较早的手动 replan 失败样本没有经同场景重新生成、采用和玩家使用。不能因相似代码改动自动关闭。
- 修复 Agent 建议：从原 DB 只读快照离线重建计划/校验输入，确保可行 required-main 触发节点、两阶段延迟和消费条件进入 repair guidance；另在新合法 revision 上经 UI 确认采用，并验证新机会可玩。不要编辑旧候选或历史回合。

## BUG-95-002 — L1 快路径及旧工件兼容

- 原阻滞：旧协议把难度和证据留给 Planner。同一 Method 在没有内容约束时可能得到不同难度/证据；把缺字段默认成 normal / 空 evidence 会静默改变规则。
- 根因：旧方法工件没有声明难度策略、证据绑定和编译规则身份；运行时无法证明玩家选定的方法足以确定完整规则合同。
- 当前实现：新增显式 fixed / planner_required 策略和规则 hash；空 evidence 列表是明确值，缺失策略的旧工件仍走 L2。LocalCompileReadiness 检查分支、状态、可见性、权限、发布工件、campaign binding 和 rule binding。符合条件的玩家选择经过既有 runV2Turn、冻结、原骰持久化、完整结算、Narrator 和原子 commit。
- 验证：工程 L1/四档等价回归在停止前的 verify:core 通过；一条由真实 GLM 生成并正常采用的方法已通过 Android 选择并提交，app ledger 与 proxy ledger 均见 1 次 Narrator、0 次 Planner。该项证明一个真实样本可用，不代表所有生成内容都 eligible，也不代表全局 Planner=0。
- 状态：协议和窄路径不再是已确认的代码缺失；20 决定稳定使用窗口、更多实际内容的 eligibility 分布和完整阶段验收仍未完成。

## BUG-95-003 — 开局候选缺失本场景证据 ID（已修复）

- 根因：buildPlanRequestMaterials 提供了场景名和世界目录线索，却没有给模型当前开局位置允许使用的 scene.definition.clues 精确 ID。生成内容只能猜或引用错误层级 ID。
- 后果：开局计划及一次受限修复虽成功返回，严格本地编译器因证据不属于开局场景而拒绝。
- 修复：payload 现在携带当前开局现场精确、排序去重的 evidence ID；prompt 明确禁止引用别的现场、全局目录、事实或未来内容。没有放宽校验。
- 验证与状态：回归断言精确 ID 被包含、异地 ID 被排除；后续 UI 计划越过了证据绑定校验并进入因果校验。此项根因关闭；更广的计划可玩性不由此结论覆盖。

## BUG-95-004 — 开局因果计划重复触发且无后续消费者（已修复同场景）

- 根因：长计划候选把两个延迟后果绑定到同一个成功节点，没有后续 required-main 节点以硬依赖和肯定效果消费它们；strict validator 正确拒绝，旧修复说明却没有把具体可用触发节点、阶段间隔、consumer 和条件映射成明确操作指令。
- 修复：结构修复指引现在提供真实 eligible required-main 节点，说明触发冲突，并要求在足够靠后的 required-main 节点建立 dependsOn 与匹配正向效果条件；可共同排程的后果合并到一条成功路径。验证保持严格。
- 验证：开局 UI 重新生成的计划通过本地严格验证并采用；后继准备成功；一个真实可见 Method 在 UI 提交，app/proxy 记录 Planner=0、Narrator=1。
- 状态：原先“重复触发/无消费者导致开局失败”在该流中关闭。两条真实延迟后果是否在间隔至少两项有效决定后触发并被下游实际消费，仍未证明。

## BUG-95-005 — Windows 多进程预算锁竞争（已修复）

- 根因：多个进程对同一 scoped manifest 执行独占文件创建；Windows 将同时竞争返回的 EACCES/EPERM 当成不可恢复 I/O 错误，代码只把 EEXIST 视为锁竞争。
- 修复：对 EEXIST、EACCES、EPERM 在有界时间内重试；其它错误仍失败关闭。
- 验证：8 个进程竞争的定向测试连续通过 3 次；全量 core suite 随后通过。生产硬上限保持 fail-closed，实时 manifest 没有被测试重置。
- 状态：关闭。

## OBS-95-006 — 指引在点击前变陈旧（安全拒绝）

- 表现：已显示的 available method 在状态/内容刷新后变 stale。选中时本地拒绝，保留未提交草稿并刷新可见选项；第一次拒绝无 turn、无 provider attempt、无版本递增。玩家选刷新后的路线后正常提交。
- 判断：这是避免把旧选项偷偷变为另一条收费动作的正确安全行为。当前没有证据表明无状态改变时持续复现。若再次出现，应查 UI 刷新竞态，不应删掉本地拒绝。

## BUG-95-007 — stale 后继准备任务吞掉重试触发（已修复并复验）

- 根因：SqliteCampaignPlanStore.enqueueJobMergingTriggers 把“同触发理由”当成可复用条件，即使最新 job 已是 stale。随后 runCampaignReplan 只查活动 job，找不到 queued/running job，导致下一次相同触发不再创建新 job。
- 修复：同触发去重不再复用 stale 记录；保留旧记录供审计，针对当前 state/content binding 创建新任务。
- 验证：SQLite 定向回归通过；同样的 stale 同触发场景重放后创建新鲜任务并完成重规划，未重用旧绑定。首个新计划 revision 被采用，玩家继续行动。
- 状态：该根因同场景关闭；所有其它后台并发/故障边界仍按矩阵未测范围处理。

## BUG-95-008 — replan 后 active-node artifact 被投影隐藏（已修复并复验）

- 根因：投影仅接受 source planId 等于当前 planId 的 artifact。但 immutable artifact 在 plan revision 更新后仍被当前 branch binding 和新计划明确引用，且 nodeId/situationRef 完全匹配；过严的 planId 等值检查把有效路线误判为 content_gap。
- 修复：只有 branch-bound、被 current plan 明确引用、且 authored nodeId/situationRef 与 current node 精确匹配的旧 artifact 才可继续作为来源；其它历史 artifact 仍拒绝。
- 验证：定向投影测试通过；保留数据重建安装后，J4B 的阶段 5 路线重新显示；玩家提交后关闭阶段 5、启用阶段 6，数据库 quick_check=ok。紧随其后的 J4B/J4A 行动也继续推进。
- 状态：本次复现路径关闭。新计划中的机会差异、后果消费和全部状态类别仍需更广验收。

## BUG-95-009 — 成功掷骰后角色引用失效，回合停在提交边界

- 用户影响：Stage-6 收尾方法出现在玩家可选项中，掷骰成功后不产生 commit；应用显示“继续未完成回合”，这条战役不可继续。该回合必须原样保留，不能重掷、改合同或点击恢复来碰运气。
- 精确失败：J1 camp-mv3mw9hk-main，已提交版本 v70。turn-0071 的冻结合同和成功骰点已持久化；commit version/outcome_grade/effects 均未写入，interaction journal 是 paused_system。J1 的只读 SQLite 快照 quick_check=ok。
- 根因链：该方法最严重 outcome 的 relationship effect 与 stage-6 completion reward policy 都引用同一个无法解析的 campaign actor；当前 actors/cards 快照里只有玩家 actor。精确 actor ID 留在私有快照中，不在报告暴露隐藏身份。路线展示/投骰前没有验证方法结果与节点收尾奖励所需的 actor 是否都能在本战役解析。玩家因此先消耗骰点，随后唯一结算路径 settleCampaignProgress 在解析 campaignActor 时抛错。这个 fail-closed 结算行为避免了幽灵关系奖励，却把可预见的内容绑定缺陷推迟到已掷骰后的提交点。
- 当前代码变化：routeReadiness.campaignCompletionRewardBlocker 在当前路线能关闭 active 节点时，解析其 branch-bound reward policies 的关系双方和奖励接收者；缺 actor 返回 campaign_completion_reward_actor_unavailable。CampaignSession 在方法显示/派发边界均有调用，给出“奖励所需人物尚未加入当前战局”的本地拒绝。对 J1 v70 的精确旧计划/工件/快照做过只读离线调用，当前函数返回该阻断码；不是 Android 同案回放。
- 根因状态：旧分支仍停在 v70；turn-0071 与成功 roll 保留。没有在最终 APK 上新建分支后复验该方法被隐藏/拒绝，也没有证明其它 actor alias、可选奖励结果、stage completion 路径覆盖充分。故障发现成立，生产修复有强迹象，端上关闭证据缺失，标记 OPEN / LIVE REPLAY NOT RUN。
- 给修复 Agent：不要恢复或提交 J1 turn-0071。先以只读精确快照加确定性测试验证所有 completion reward actor 引用在 roll 之前拦截；再用新的合法分支/场景和最终 APK 证明玩家看到可用替代路线，且不多发 Planner/Narrator、不重掷、不改历史。如果要修正生成内容，创建正式新 revision，不回写旧工件。

## OBS-95-010 — 一次失败自由输入没有持久后果（待判定）

- 最新新战役的 v8 审计中，一次 freeform methodRef=null 的检定为 failure，turn 已提交但无 effects/state diff，因此审计排除它，不计有效决策。
- 单次无变化失败可能是内容质量缺陷，也可能是合法但叙事弱的失败；没有同一场景连续重现、资源消耗、停滞或软锁证据，故不升格为已确认阻滞，也不虚构其根因。
- 修复 Agent 可在不触碰历史 J1 的新分支上检查：允许失败有代价、线索或可用替代局面；若失败确实无世界/规则用途，修复 producer/合同/结算而不是只润色 Narrator。

## Phase 9 carryover — A15/A36 meaningful-progression quality failure (open)

This carryover is grounded in older Phase 9 evidence, not asserted as a newly reproduced longrun defect. The historical A15 and A36 statuses remain FAIL until a comparable player-facing run clears them.

- Observed root pattern: some generated methods have descriptive text, a skill and first step but no success/failure effects, outcome templates or transition. A committed check may therefore narrate an action without creating a new usable fact, stage completion or next opportunity.
- A second observed pattern is that completion effects or requirements can be reachable only on full_success, while ordinary success changes a counter that no later completion condition consumes. The UI then repeats methods or a player must wait for an unusually high grade. Numeric version/counter movement alone does not solve that dead end.
- Prior Phase 9 audit evidence includes a generic opening with no state effects, a mainline whose three methods bound completion to full_success, and repeated attempts that changed numbers without opening a new route. The evidence and exact historical scope are in docs/reviews/phase9/ROOT_CAUSE_REPORT_2026-10-09.md and docs/reviews/phase9/REAL_JOURNEYS.md. They are a prior-code diagnosis, not a claim that every current story has the same defect.
- Current v8 story adds one consistent but isolated sample: a freeform failure committed with no effect/state diff and was excluded. One occurrence cannot prove a persistent softlock; it should be watched on a new route.
- Repair direction: validate a meaningful ordinary-success path, a failure route that imposes a useful cost or exposes another opportunity, and a later consumer for each lasting effect. Do not force better dice, count empty turns, or accept model self-ratings as independent quality review.
- A36 also requires an independent participant and three six-dimension scorecards. That acceptance evidence is absent; it is a test-coverage gap, not a code change an implementation Agent can certify alone.

## BUG-95-009 follow-up: guard versus actual playable repair

The pre-roll blocker prevents another wasted roll on the same unresolved actor binding. It does not materialize the missing actor or fix the authored reference. If all stage-closing methods depend on that reward policy, simply hiding/refusing the method can leave the player without any legal completion route. The repair Agent must verify either a valid actor binding/initialization path or a genuinely usable alternative; a local refusal message alone is not closure.
