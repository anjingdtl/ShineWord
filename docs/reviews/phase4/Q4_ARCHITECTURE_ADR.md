# Q4-01 ADR：统一文字行动、遭遇分发与恢复

日期：2026-09-29
状态：实现审查已完成；代码级回归通过；设备完整行动闭环仍未验收
依据：第四期主控方案 §7–9、§12；第三期方案 §14–16、§35–38

## 问题与现状

1. CampaignSession.playTurnInForeground 先调用 assertNoActiveEncounter。该保护是正确的；统一入口必须将活动遭遇分发到 EncounterService，不能移除该断言。
2. EncounterService 已有独立 begin、attack、NPC/同伴 turn、move、dash、rescue、pass/guard、retreat 接口。多数动作根据 requestId 派生 encounter turnId，并先用 getCommittedTurn 做重放检查。它们可作为规则权威；资格和目标仍由服务复验。
3. beginEncounter 的请求可以创建稳定遭遇 ID，但目前接收调用方提供的 hostiles 模板，没有校验模板是否是当前公开场景 actors 的合法冲突对象。正式入口必须另加公开场景资格投影，不能继续使用全世界模板列表。
4. 普通 Session.playTurn 使用基于 stateVersion 的 turn ID；可显式指定 turnIdOverride，但该覆盖值当前还会被解析成 stateVersion。协调层不能把任意 operationId 塞进 turnIdOverride。
5. SQLite turns 表已保存 ActionContract JSON、expected stateVersion、状态、提交版本与 RollRecord；SqliteTurnStore 有 stageRollTurn、getStagedTurn、getCommittedTurn、listCommittedTurns。Narrator 恢复路径复用已冻结合同和骰点。
6. 当前没有玩家交互级 operation journal、branch 级单执行者或跨进程 checkpoint。
7. loadHistory 过滤 narrativeText=null，因此已提交但 Narrator 缺失的机械结果被隐藏。Turn 的 publicSummary、effects 与 action_contract_json 不能未经可见性审核直接显示。
8. data-availability.md 是 2026-09-28 的历史核查。当前已有核心 PlayUiProjection、NPC public projection 和安全回归；移动桥接在 mobile/src/playProjection.ts。未重新发明其字段接口。

## 决策

### A. 路由与协议

- 新增应用层 UnifiedActionGateway 与 InteractionOrchestrator。界面只提交 {kind, choiceId, sourceBranchId, sourceStateVersion} 或自由文本；gateway 按 branch/stateVersion 重建已发布的合法 Choice 并重新校验。
- Choice 区分 act 与 inspect。inspect 只打开人物、记录、物品或检定资料，不改变 stateVersion；act 才创建 operation。
- 普通文本和普通故事选择继续走 V2 Planner → 本地合同/骰点/commit → Narrator。休息、训练等明确结构化命令调用既有 Session 方法。
- 活动遭遇的结构化命令直接调用 EncounterService；自由文本经独立版本化 EncounterIntentProposal 适配器，只能返回有限 intent kind 与公开目标引用。不能扩展或污染 V2 PlannerProposal。
- 玩家以外的遭遇行动由 EncounterService 与已有同伴策略推进；每一步重查玩家/结束/fate 状态，在玩家决策点停止。
- 正式 begin 入口只展示当前公开 SceneDefinition 中明确引用、有效期和模板公开性均匹配的冲突对象。当前若无可信映射就不开放新遭遇选择，并在诊断中说明；不按名字猜模板。

### B. operation journal 与幂等

Q4 将新增 migration 16，建立只存协调元数据的 interaction_operations / interaction_steps：

- operation 记录稳定 operationId、campaign/branch、接受时 baseStateVersion、policyVersion、有限期精确用户输入、状态、generation/fencing token、checkpoint/stopReason 和时间戳。
- step 记录 sequence、经验证的命令引用、稳定子 requestId、调用前 expectedStateVersion、accepted/committed 状态及提交 stateVersion。
- 同一 branch 同时只能有一个 active operation；在 SQLite 写事务中验证 branch head、插入 operation 并确保唯一 active 约束。相同 operationId 重投返回既有 operation；不同操作冲突时拒绝并保留草稿。
- 子 requestId 从 operationId + step sequence 派生，并保证 EncounterService 需要的 1–96 字符约束。普通故事行动保留核心当前 stateVersion turnId；不把 operationId 当 turnIdOverride。
- 每个 action API 成功后，从 turns/encounter 权威记录按同一 requestId 查询提交结果，再 CAS 更新 checkpoint。commit 后、checkpoint 前进程崩溃时，恢复者先查询同 requestId 的提交；若已提交则仅补 checkpoint，若未提交则以相同 requestId 重试。
- 恢复接管递增 fencing token；旧执行者只能完成旧 operation，任何后续 checkpoint 必须校验 token。所有 core 调用固定原 branchId，切分支后的回包不得写入新 branch。分支 head 仍由核心 expected stateVersion/CAS 保护。
- 操作完成或停止后清除 journal 中的用户原文；历史显示从 committed contract/narrative 的已验证来源读取，不把协调表变成第二份游戏状态或存档格式。
- 后台/锁屏在原子动作边界暂停。恢复时只续跑明确已接受 operation，不生成新玩家动作。上限沿主控方案：每次最多 32 个机械动作、每批最多 4 步、10 秒墙钟、两步无权威进展即停。

### C. StoryEntry 安全投影

- StoryEntry 由稳定 turn/encounter commit ID、branchId 与 committed stateVersion 排序；含 narration 时显示 narration。无 narration 时仅从审核过的引擎动作类型生成有限机械摘要。
- 对普通失败采用安全回退“行动已提交，故事补述待恢复”，不会直接渲染未经审核的 publicSummary/effects/decisionBasis。
- 用户原话优先来自 operation 接受记录；旧数据只能从合法 ActionContract.intent 中提取，无法证明来源时显示“行动记录未保存”。绝不把当前输入框草稿当历史行动。
- roll 只展示 RollRecord 的真实值，GM-only、future、隐藏模板 ID 与合同效果全文不进入正文、选项、资料页或 Planner 用户上下文。

## 竞争方案与原因

- 删除 assertNoActiveEncounter：拒绝，破坏现有场景边界并把遭遇误路由到普通规则。
- 把 attack/rescue/retreat 塞入 V2 PlannerProposal：拒绝，现有枚举不是遭遇协议，也会扩大旧合同解释范围。
- 只依赖 UI busy：拒绝，不能处理多控制器、进程重启和 commit/checkpoint 缝隙。
- 以 publicSummary 字段名证明安全：拒绝；显示路径必须由可信动作类型和可见性规则决定。
- 修改骰点/遭遇服务来包办新编排：拒绝；新层只协调调用与恢复，规则继续由现有服务决定。

## 回归与验收

自动回归将验证：重复提交、陈旧 choice、inspect 无写入、活动遭遇走独立 API、非法/隐藏目标拒绝、玩家回合立即停止、上限和无进展暂停、双执行者/跨分支 fencing、commit 后 checkpoint 前强停恢复、Narrator 失败不重掷、旧无 journal 故事可读、旧 revealAt='1' partial 包兼容。测试需断言提交数、requestId、stateVersion、RollRecord 与分支状态。

原始决策记录在施工前不表示机制已经落地。下方实现复核更新代码与故障注入状态，并单列尚未关闭的设备和 gateway 范围。

## 实现复核（2026-09-29）

### 已实现并由回归覆盖

- `CampaignSession.playTurnInForeground` 仍调用 `assertNoActiveEncounter`；遭遇行动继续走 `EncounterService` 的独立本地 API，没有把 encounter kind 塞进 V2 PlannerProposal。
- `getCurrentSceneEncounterOptions` / `beginSceneEncounter` 只按当前公开场景、有效 actor template 与明确资格建立入口。无资格映射时返回空选项并拒绝 begin；没有回退为全世界模板列表或按名字推断。
- `encounterIntent.ts` 将自由战斗文本限缩为攻击、援救、撤退、戒备或澄清；目标来自当前公开遭遇视图，伤害、射程和状态仍由本地规则服务决定。
- migration 16 建立 `interaction_operations`、`interaction_operation_steps` 与 `interaction_campaign_fences`。`SqliteInteractionOperationJournal` 为遭遇自动行动固定原分支，写稳定子 requestId，使用 stateVersion 和 campaign fence，最多 32 步、每 4 步让出 UI、10 秒后暂停。
- `storyEntry.ts` 从已提交 narrative 或受限机械动作类别生成历史项，不直出 `publicSummary`、effects 或决策依据。移动端历史已纳入没有 narrative 的已提交机械结果。
- `openingRecommendation.ts` 仅从可见技能与规则预算生成推荐；自定义能力和同伴可选流程仍保留。
- `tests/phase2-acceptance.test.cjs` 的提交后/检查点前注入使用 Node SQLite 执行真实游戏 commit，再在 checkpoint 前抛出故障；恢复时复用同一个 child requestId，断言仅有一次 turn commit、一次 stateVersion 推进。`tests/phase4-interaction-orchestrator.test.cjs` 另覆盖通用 journal 恢复、步数上限、四步 yield、过期跨分支 fence 和受限遭遇意图。

### 未关闭项

- 当前 React 入口由 `PlayScreen` 的 `onChoose` 分支调用 `submit`、`beginSceneEncounter` 或 EncounterService；代码中尚无独立、可复用的 `UnifiedActionGateway` 类来统一验证所有 choiceId 与 stateVersion。核心服务仍会校验遭遇资格和状态版本，但这项 ADR 的集中 gateway 设计尚未完全落地。
- 提交后/检查点前故障注入通过 Node SQLite 与 failpoint 模拟真实 SQLite commit 窗口；本轮没有在 Android 上精确终止进程于该窗口。模拟器目前使用的 QA 世界没有公开合格的场景遭遇选项，不能从默认页面完成设备遭遇行动。
- 本次 Release 默认故事页已在 API 37 上检查；没有执行普通玩家行动，因此 V2 调用、真实叙事、commit 后恢复、Narrator 断网重试仍需真实凭据与完整设备旅程补证。

因此：实现层的大部分边界和故障恢复机制有代码与自动化证据；集中 gateway、设备端正式遭遇入口和精确 Android 故障注入仍是未关闭项。本状态不得写为 ADR 全部通过。
