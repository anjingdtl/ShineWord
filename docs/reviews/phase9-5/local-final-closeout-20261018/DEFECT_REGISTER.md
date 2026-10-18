# 缺陷登记与 RED → GREEN 证据

日期：2026-10-18（Asia/Shanghai）

## QA-PROC-01：宿主机 live-LLM pilot 未持久化 attempt identity

- 类型：测试流程偏差；未确认产品代码缺陷。
- 现象：两个独立 synthetic `CampaignSession` pilot 都进入 Planner；host transport 返回无 HTTP status 的 `transport_error`，provider 分类为 `dispatchState=unknown`。没有 HTTP/provider ID、usage 或 turn commit。
- 根因：fixture 方法缺失 L1 所需 evidence/difficulty binding，未形成 L1 对照；临时 harness 将 `SqliteLlmLedgerStore` 绑定到 `:memory:` DB，退出前只输出了脱敏汇总，没有导出 logicalRequestId / attemptId。
- 处置：两次未知均未重派；停止新增真实模型调用；把聚合结果与身份丢失记录在 `evidence/host-glm-pilot-transport-unknown-sanitized.json`。无法凭现存证据确认 provider 是否收到请求。
- 后续门槛：恢复 matched 10+10 前，先使用可保留的隔离账本、合格 L1 绑定与逐 attempt 脱敏导出；不重用这两条未知逻辑请求。
- 后续状态：matched 10+10 已在独立 persistent production fixture、独立 logical request IDs 和非空 evidence 上完成；未确认或重派此处两条 unknown。两条 unknown 仍无法恢复 attempt identity。

## SW95-M6-01：结构化开局证据码未触发有界补建

- 严重度：P1。缺少必要开局证据时，首轮构建会停在可恢复失败状态。
- 根因：`mobile/src/sourceImport.ts` 的恢复判定只识别 `Error.message` 中的部分中文提示；发布校验通过 `errorCodes` 返回结构化 `opening_entity_unproven:<entity>`。
- RED：新增结构化错误码反例前，helper 未识别机器码、预期补建未触发；legacy 中文提示仍触发。
- 最小修复：`src/application/worldBuild/openingEvidenceRecovery.ts` 只接受 `opening_entity_unproven` 前缀，保留旧中文提示；provider/config 错误和 `outcome_unknown` 不会触发补建。未改 validator、Canon、scope、ledger。
- GREEN：定向 2/2；全量 Core 1,354/1,354；mobile typecheck、version check、Debug APK 成功。既有 AVD 的 cached extraction 恢复到 4/4 / ready；设备没有实际发起新 extension request，不能声称运行了真实 9,600–12,000 延伸。

## SW95-M3-01：Canon 开局计划采用时误报 identity drift

- 严重度：P1。真实模型返回合法原著角色开局计划后，采用被“setup anchor/protagonist drift”错误拒绝。
- 根因：`campaignPlanning.ts` 将规划阶段建议技能写入 Canon `initialSkills`，而 Canon payload 不含该 planning-only 字段；采用校验把额外建议误判为原著身份变化。
- RED：`tests/phase9-planning.test.cjs` 在修复前以 Canon 计划含建议技能为反例，采用应成功、实则 drift 拒绝；跨身份不匹配仍应拒绝。
- 最小修复：Canon intent 不绑定原创人物的建议技能；对已存旧 Canon proposal 中的规划字段兼容，其他身份不匹配仍拒绝。没有放宽 anchor、protagonist 或 Canon payload 校验。
- GREEN：定向 5/5；最新全量 Core 1,354/1,354，mobile typecheck 通过。
- Android：实际 GLM 开局方案在保留既有数据的 AVD 上采用成功，三个独立 campaign branch 均可写入 adoption turn 与后续 Runtime state。
- 提交：`8ab0419 fix(phase95): allow canon opening plan adoption`。

## SW95-M3-02：终局/暂停 Runtime 仍可提交可变更行动

- 严重度：P1。Runtime 进入 `failed` / `paused` 后，建议行动与 composer 仍可能诱发变更提交。
- 根因：Play projection 没有投影权威 campaign status；screen 与 controller 的提交路径因此不能共同拒绝非 active Runtime。
- RED：`tests/phase3-play-projection.test.cjs` 先验证 projection 应暴露 `campaignStatus=failed`，修复前实际为 `undefined`；终局 action availability 对照失败。
- 最小修复：`PlayUiProjection` 只读映射唯一 Runtime status；`canSubmitCampaignAction()` 仅允许 active Runtime（保留 legacy campaign 兼容）；屏幕隐藏变更行动、过时 guidance 并禁用 composer；controller 的直接提交和 guidance 提交也在 draft/network 前拒绝。只读 inspect choice 保持独立处理。
- GREEN：定向 7/7；最新全量 Core 1,354/1,354；mobile typecheck 与 Debug APK 构建通过。
- Android：在实际 `campaignStatus=failed` 的 AVD 终局页重新核验，`guidance-submit-*`=0、观察 action=0、composer disabled。该次复测包 SHA-256 为 `3B3A8A33463F74A37617BBE5B47B000D80CC1BBE51972D00404D3E5A6BE03167`；后续 standalone 包身份与冷启动证据见 `DEVICE_AND_APK.md`。
- 提交：`3847339 fix(phase95): gate actions after campaign termination`。

## SW95-M3-03：stage completion producer 缺失时没有结构化修复指导

- 严重度：P1（stage content repair blocked）。stage-only 计划生成遇到既有 validator 的明确 completion error 后，repair classifier 没有向下一次 plan generation 说明如何保留完成合同并补出本地可达的状态/事件 producer。
- 复现：validator 返回 `artifact: current stage stage-5 completion has no local effect producer; provide a realizable outcome path.`；两个新 RED 反例分别验证 helper guidance 和 generation retry 集成，修复前均没有补充指导。
- 最小修复：`src/application/campaignPlan/generationService.ts` 为该特定 validator 错误增加定向 guidance：保留 completion condition tree、IDs、thresholds 和 dependencies；只增加合法可达的 local status/counter/promise/event producer；不放宽 gates、不伪造事件、不用 prose 充当 state。
- GREEN：`tests/phase9-plan-contract-guard.test.cjs` helper 反例与 `tests/phase9-planning-budget.test.cjs` generation-retry 集成反例均在修复后通过；全量 Core 1,354/1,354、mobile typecheck、version check 与 Debug APK build 通过。提交 `cbacbb0 Guide local stage completion repairs`。
- AVD 复测：该修复后的 v10 candidate 顺序使用 2/2 `campaign_plan` attempts，均 HTTP 200；candidate 因 `firstSituation.methods[1].firstStep.destinationId: not valid for skill_check` 被既有 validator 拒绝，未采用、branch 未前进、revision 未变。validator 拒绝正确。后续不同 QA branch 的 stage-5 action 与 plan adoption 另有验证，不改变此候选结果；字段冲突缺少修复指导另登记于 `SW95-M3-06`。

## SW95-M3-04：effect 数量 validator 错误缺少保留完成路线的 repair guidance

- 严重度：P1（结构候选被限次拒绝且修复方向不清）。当具体 `effects` 数组超过 8 个模板时，repair helper 没有按 validator 路径解释如何在既有上限内保留普通成功 completion。
- RED：`tests/phase9-plan-contract-guard.test.cjs` 直接验证路径级 guidance；`tests/phase9-planning-budget.test.cjs` 验证生成 retry 的第二次请求确实包含该 guidance。修复前两种情形均无对应指引。
- 最小修复：只对精确的 `effects must be an array of ≤8 templates` validator 错误追加对应数组路径、保留普通 success completion、移除冗余效果或拆成有真实前提的后续办法；没有放宽 8 项上限或删除 gate。
- GREEN：helper 与 generation retry 两个定向反例通过；最新 Core 1,354/1,354、mobile typecheck、version check、Debug APK build/install identity 通过。提交 `00f3625 Guide bounded campaign effect repairs`。

## SW95-M3-05：缺少两项可执行延迟后果时没有合同保真修复指导

- 严重度：P1（长篇计划候选修复失败）。当 validator 报告 `long plan: at least two executable delayed consequences are required.`，repair helper 没有指出如何在保持玩家目标与阶段门槛的前提下补齐同一可达旅程上的触发、排程、等待和权威消费。
- RED：`tests/phase9-plan-contract-guard.test.cjs` 覆盖直接 helper 错误；`tests/phase9-planning-budget.test.cjs` 覆盖 retry 请求的修复内容和有界物理请求数。修复前均没有能保留约束的 targeted guidance。
- 最小修复：只识别该 long-plan validator 错误，提示补足独立 consequences、真实 success/full_success trigger、至少两段 required main stage delay 与后续 completion/activation/ending 的状态消费；明确拒绝互斥方法拼接、放宽条件或用 `record_event` 文案冒充状态效果。
- GREEN：helper 与 retry 集成定向测试通过；最新 Core 1,354/1,354、mobile typecheck、version check 与 Debug APK build/install identity 通过。提交 `b6c7d00 Guide missing long-plan consequence repairs`。既有 live job 仍因候选不满足阶段延迟条件而 invalid，未采用。

## SW95-M3-06：动作类型与 firstStep 引用字段冲突时缺少定向修复指导

- 严重度：P1（stage-content 候选在唯一修复位仍可能被拒）。既有 validator 正确拒绝 `skill_check` 方法附带 `destinationId`，但结构化修复提示只回传错误，未指示删除哪个字段并保留原行动类型。
- RED：在 `tests/phase9-planning-budget.test.cjs` 用真实候选错误形状先跑定向测试；修复前 27 项中 26 项通过、新用例失败，明确暴露 retry 指引没有“保留 skill_check/只删除 destinationId”的约束。
- 最小修复：`src/application/campaignPlan/generationService.ts` 仅为精确的 `firstStep.(skillId|abilityId|destinationId): not valid for <actionKind>` validator 诊断生成字段级 guidance。只移除不兼容字段，保留 action kind、意图和其它合法引用；不改变 validator、不猜造 ID、不放宽合同。
- GREEN：定向规划预算文件 27/27；全量 Core 1,355/1,355；mobile typecheck 与 version check 通过。独立提交 `76a51fc fix(phase95): guide action reference mismatch repair`。
- AVD：通过 `npm run apk:debug` 构建 standalone APK，`adb install -r` 后停止 Metro、冷启动，书库页恢复且 fresh crash buffer 无应用异常。后续新 candidate 未返回 `skill_check.destinationId` mismatch，因此 M3-06 的 live repair path 尚未触发。该项不表示完整 stage-5 路径未通过：隔离 QA branch 后续已有真实 UI stage-5 action/plan adoption 证据。

## SW95-M3-07：缺少编译 startNodeIds 的入口修复提示

- 严重度：P1（合法现有 required-main 入口会被拒绝，且单次 bounded repair 没有本地编译规则提示）。本地编译器从 `stages[].activation === null` 派生 startNodeIds；当候选只有现有 concrete main 入口但其 activation 非 null 时，validator 报 `plan: startNodeIds required.`，而模型不能通过输出顶层 startNodeIds 覆盖派生行为。
- RED：在 `tests/phase9-planning-budget.test.cjs` 构造 startNodeIds、unreachable main 与 no concrete start situation 的聚合诊断；修复前新增反例失败（27 pass / 1 fail），证明 repair classifier 未把该精确 `plan:` 错误拆分并指导入口 activation。
- 最小修复：将 `plan:` 纳入聚合错误拆分；只对 `plan: startNodeIds required.` 指出 startNodeIds 的本地派生规则及候选已有 concrete required-main ID，要求仅将承载当前 firstSituation 的未完成必做入口设为 `activation:null`，保留 ID、completion、依赖和后续链。未增加模型字段、未放宽 validator。
- GREEN：定向规划预算文件 28/28；全量 Core 1,356/1,356；mobile typecheck、version check、standalone APK 构建安装通过。独立提交 `447bd67 fix(phase95): guide replan start-node recovery`。
- AVD / GLM：在安装 SHA-256 `C42A097F490595E3C46D1BC04CCB73E7BE0700F892170DFCD8CDA054EE755B44` 的 APK 上运行新 job `replan:camp-mvdjtr22-bmvdq6wys:v11:2026-10-18T11:34:15.046Z:5e606cda282e`，2/2 顺序 HTTP 200。修复候选已将 concrete required-main `stage-5` 置为 `activation:null`，直接验证了该提示的目标修正；但两项延迟后果仍共享过早 trigger，且缺少后续必做状态消费者，validator 拒绝整个 candidate。无 adoption、branch 仍 v11 / revision 4；这一结果不等于 stage 5 已修好。

## 观测结果，未登记为代码缺陷

- 两个 agent-driven QA campaign 的 severe failure 后由已采用的规划结局进入 failed：第一局 5 个玩家模拟行动后结束；第二局仅 1 个玩家模拟行动，观察行动 severe failure 后经两次 plan replan 到 failed。数据库的 user turns、roll records、ending ID 和终局 UI 一致，未发现状态/结局投影不一致；“一次严重失败即结束”留作独立玩家可玩性评估，不在无 RED 代码反例时登记为代码缺陷。
- Partial world package 的 `package_entries.kind='method'` 数量仍为 0；但第三局 campaign-scope artifact 实际执行了 6 个规则绑定的 L1 turn，且每个方法都有显式 fixed `difficultyPolicy` 与 fixed empty `evidencePolicy`。这验证了 campaign 内容 L1 路径，不覆盖非空来源 evidence，也不把 package method 缺项误报成代码缺陷。
- 第三局 main 从 state v1 推进至 v12，stage 1–4 成功，三个 deferred consequences 已触发、消费并产生下游事件。stage-5 isolated QA branch 后续提交 turn-0014，并采用 plan r7 进入 stage 6；没有据此宣称第四项 delayed consequence 已完成下游消费。执行者的 QA 操作不等于玩家对后果的反馈。
- 早期 stage-5 候选的 completion-producer 修复指导缺陷已按 `SW95-M3-03` 修复；`skill_check.destinationId` guidance 已按 `SW95-M3-06` RED → GREEN，但 post-fix GLM candidates 均未触发该错误。M3-07 start-node guidance 在真实 candidate 中修正入口，该 candidate 本身仍因既有延迟 consequence、trigger 去重与消费者规则失败而被正确拒绝。之后独立 branch 的真实 UI action 与 bounded plan repair 成功，stage 5 在该 branch 已完成；原 main 仍 v12/r4。未改验证规则、未重派 unknown，也未将 agent QA 记为玩家验收。

## 安全边界

- 代码没有新增 Runtime、Store、Reducer、schema 或第二套规则语义。
- 已提交历史 turns、骰点和 frozen content 仅只读核验，没有重放或编辑。第三局的新 turns 是隔离 QA 分支中的正常游戏提交；旧 world_extract unknown 保留，未确认、清账或重派。
- 模型生成的剧情截图及本地 SQLite snapshot 留在本机临时目录；密钥、小说正文、提示词和原始响应不提交。

## SW95-M6-02：包发布失败提示空审查队列，诊断没有移动端读取路径

- 日期：2026-10-19；严重度：P2（发布失败后无法从任务详情定位 validator 分类）。
- 现象：`package_finalize_failed` 任务提示用户查看审查问题，但实际可没有任何 open review issue；分段发布诊断已持久化在 `segment_publication_diagnostics`，移动端没有对应查询和展示路径。
- RED：`tests/world-build-recovery.test.cjs` 先构造“诊断存在、审查队列为空”的反例；原行为缺少 `listPublicationDiagnostics`，定向测试失败。随后增加投影隐私断言，旧投影返回 `segmentId`/generation/time，继续以 RED 明确证明这些字段不应离开诊断读模型。
- 最小修复：`mobile/src/buildTasks.ts` 只读取最近 5 条诊断的机器类别前缀，投影仅返回类别；展开 `package_finalize_failed` 任务卡时显示合并后的安全类别。`coordinator.ts` 提示用户展开任务诊断，不再引导查看空审查队列。没有修改 validator、存档、Canon、Runtime、schema、账本或失败历史。
- GREEN：隐私 RED 改为类别-only 后，诊断读模型定向测试和生产 mobile pipeline 集成反例均通过；全量 Core 1,357/1,357、mobile typecheck、version check 通过。standalone APK 构建、保留数据安装与最新 Maestro 冷启动/导航复测见 `DEVICE_AND_APK.md` 与 `evidence/maestro-cold-launch-smoke-sanitized-20261019.json`。
- 设备边界：当前 live world UI 展示的是 `canon_conflict` 和 1 个 open review issue，不是该 `package_finalize_failed` 场景；本轮未宣称设备上已截图验证这条精确诊断卡片。合成生产集成测试验证了无审查 issue 时诊断可读，最新 APK 的书库和战役导航 smoke 通过。

## SW95-M3-08：战役终局后待触发延迟后果没有关闭

- 日期：2026-10-19；严重度：P2（终局 Runtime 保留不可达的 pending obligation）。
- 现象：真实 Android 分支在 stage 8 选择提前脱身后，campaign 已进入 `completed`，stage 8 仍 active；其未来触发的 `consequence-barov-network` 留在 `pending`，不可能再被消费。
- RED：提交 `39a8d15 test: cover pending consequences on campaign ending` 增加 settlement 合同反例。旧实现结束 campaign 后仍保留 pending，预期 `cancelled/campaign_ended` 的断言失败。
- 最小修复：`dischargeStrandedConsequences` 在 `completed`、`failed`、`ended` 状态关闭全部 pending consequence，保留原 trigger/description 并写入 `campaign_ended` 和 `campaign_consequence_cancelled`；`settlement.ts` 在 ending pass 后运行该生命周期清理。未改变已触发/已消费记录、阶段条件、结束判断或历史状态。
- GREEN：定向 settlement closure 7/7；全量 Core 1,358/1,358；mobile typecheck、version check、standalone APK build 通过。提交 `e6a0bbd fix: cancel pending consequences when campaigns end`。
- Android/GLM：更新现存专用 API 37 AVD（`adb install -r` 保留数据库），经 UI rewind 创建新分支。提前脱身分支 v20 的 consequence 变为 `cancelled/campaign_ended`；同一 v19 起点的守住阵地分支 turn-0020 在 v19→v20 成功，stage-8 consequence `triggered → discharged`，写入 `barov_network_opened`、`knowledge_discovered` 和权威 `branch_knowledge`。两个 Narrator 请求均为单次 HTTP 200，无 unknown 或重派。原来源分支保持原样。脱敏证据：`evidence/android-terminal-consequence-cleanup-20261019.json`。
- 提交：RED `39a8d15`；fix `e6a0bbd`。

## SW95-M6-03：弹层键盘打开时首次点击被滚动容器吞掉

- 日期：2026-10-19；严重度：P2（目标表单需要重复点击，正常路径容易误判未保存）。
- 根因：`PlayPanel` 中的 `ScrollView` 使用 React Native 默认键盘点击策略；输入框聚焦后，第一次触摸按钮只收起键盘，没有交给目标按钮。
- RED：旧 APK 上 Maestro `sw95-l1-keyboard-disambiguation`（run `2026-10-19_025709`）输入 QA 标记后只点击一次，20 秒内 `campaign-adopt-goal` 仍可见；之后单独点击才卸载表单。未以该测试重派模型请求。
- 最小修复：`mobile/src/ui/features/play/panels/PlayPanel.tsx` 的弹层 `ScrollView` 设置 `keyboardShouldPersistTaps="handled"`。不改状态、账本、模型分流或存档语义。
- GREEN：standalone APK SHA-256 `A9987513029084AD8D37372A64421ACB32B63DDBD775976F18AEDED29A0169A0`，经 `adb install -r` 更新现存主 AVD并保留数据；新隔离 fork 上 Maestro `sw95-keyboard-single-tap-green`（run `2026-10-19_033457`）单击后表单在 60 秒内卸载。目标重规划 busy 在 180 秒内结束；没有可见错误或未知恢复控件。UI 检查未取得 provider HTTP status，不能据此计作 GLM 200。
- 回归：Core 1,358/1,358；mobile typecheck、version check、`git diff --check` 通过；standalone Debug APK 构建成功。脱敏证据：`evidence/play-panel-keyboard-submit-red-green-sanitized-20261019.json`。
