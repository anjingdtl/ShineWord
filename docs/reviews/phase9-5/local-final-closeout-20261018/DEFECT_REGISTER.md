# 缺陷登记与 RED → GREEN 证据

日期：2026-10-18（Asia/Shanghai）

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
- Android：在实际 `campaignStatus=failed` 的当前 AVD 终局页重新核验，`guidance-submit-*`=0、观察 action=0、composer disabled。数据未清除。后续最新 APK 与设备安装包 SHA-256 均为 `3B3A8A33463F74A37617BBE5B47B000D80CC1BBE51972D00404D3E5A6BE03167`。
- 提交：`3847339 fix(phase95): gate actions after campaign termination`。

## SW95-M3-03：stage completion producer 缺失时没有结构化修复指导

- 严重度：P1（stage content repair blocked）。stage-only 计划生成遇到既有 validator 的明确 completion error 后，repair classifier 没有向下一次 plan generation 说明如何保留完成合同并补出本地可达的状态/事件 producer。
- 复现：validator 返回 `artifact: current stage stage-5 completion has no local effect producer; provide a realizable outcome path.`；两个新 RED 反例分别验证 helper guidance 和 generation retry 集成，修复前均没有补充指导。
- 最小修复：`src/application/campaignPlan/generationService.ts` 为该特定 validator 错误增加定向 guidance：保留 completion condition tree、IDs、thresholds 和 dependencies；只增加合法可达的 local status/counter/promise/event producer；不放宽 gates、不伪造事件、不用 prose 充当 state。
- GREEN：`tests/phase9-plan-contract-guard.test.cjs` helper 反例与 `tests/phase9-planning-budget.test.cjs` generation-retry 集成反例均在修复后通过；全量 Core 1,354/1,354、mobile typecheck、version check 与 Debug APK build 通过。提交 `cbacbb0 Guide local stage completion repairs`。
- AVD 复测：修复后新的 stage-5 job 在 v10/base plan revision 4 上顺序使用 2/2 `campaign_plan` attempts，均 HTTP 200。最终候选因 `firstSituation.methods[1].firstStep.destinationId: not valid for skill_check` 被既有 validator 拒绝，未采用、branch 未前进、revision 未变。修复 guidance 已运行，但 stage 5 仍未修好；不将新候选错误登记成已确认代码缺陷。

## 观测结果，未登记为代码缺陷

- 两个 agent-driven QA campaign 的 severe failure 后由已采用的规划结局进入 failed：第一局 5 个玩家模拟行动后结束；第二局仅 1 个玩家模拟行动，观察行动 severe failure 后经两次 plan replan 到 failed。数据库的 user turns、roll records、ending ID 和终局 UI 一致，未发现状态/结局投影不一致；“一次严重失败即结束”留作独立玩家可玩性评估，不在无 RED 代码反例时登记为代码缺陷。
- Partial world package 的 `package_entries.kind='method'` 数量仍为 0；但第三局 campaign-scope artifact 实际执行了 6 个规则绑定的 L1 turn，且每个方法都有显式 fixed `difficultyPolicy` 与 fixed empty `evidencePolicy`。这验证了 campaign 内容 L1 路径，不覆盖非空来源 evidence，也不把 package method 缺项误报成代码缺陷。
- 第三局从 state v1 推进到 v12，stage 1–4 成功，三个 deferred consequences 已触发、消费并产生下游事件；`con-barov-offer` 仍 pending。执行者的 QA 操作不等于玩家对后果的反馈。
- stage 5 仍有内容阻滞。早期 v10 候选的 completion-producer 修复指导缺陷已按 `SW95-M3-03` 修复；另一 v10 retry 因 `skill_check` 的 destinationId 不匹配被拒。既有 v11 候选的两次 GLM 响应均 HTTP 200，因 success/full_success effect 数超过验证上限而被拒。revision 4 仍仅带 stage 4 situation，stage 5 `content_prep` unresolved。未改验证规则、未自动重派 unknown，也未声明 stage 5 可完成。

## 安全边界

- 代码没有新增 Runtime、Store、Reducer、schema 或第二套规则语义。
- 已提交历史 turns、骰点和 frozen content 仅只读核验，没有重放或编辑。第三局的新 turns 是隔离 QA 分支中的正常游戏提交；旧 world_extract unknown 保留，未确认、清账或重派。
- 模型生成的剧情截图及本地 SQLite snapshot 留在本机临时目录；密钥、小说正文、提示词和原始响应不提交。
