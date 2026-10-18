# 缺陷登记与 RED → GREEN 证据

日期：2026-10-18（Asia/Shanghai）

## SW95-M6-01：结构化开局证据码未触发有界补建

- 严重度：P1。缺少必要开局证据时，首轮构建会停在可恢复失败状态。
- 根因：`mobile/src/sourceImport.ts` 的恢复判定只识别 `Error.message` 中的部分中文提示；发布校验通过 `errorCodes` 返回结构化 `opening_entity_unproven:<entity>`。
- RED：新增结构化错误码反例前，helper 未识别机器码、预期补建未触发；legacy 中文提示仍触发。
- 最小修复：`src/application/worldBuild/openingEvidenceRecovery.ts` 只接受 `opening_entity_unproven` 前缀，保留旧中文提示；provider/config 错误和 `outcome_unknown` 不会触发补建。未改 validator、Canon、scope、ledger。
- GREEN：定向 2/2；全量 Core 1,348/1,348；mobile typecheck、version check、Debug APK 成功。既有 AVD 的 cached extraction 恢复到 4/4 / ready；设备没有实际发起新 extension request，不能声称运行了真实 9,600–12,000 延伸。

## SW95-M3-01：Canon 开局计划采用时误报 identity drift

- 严重度：P1。真实模型返回合法原著角色开局计划后，采用被“setup anchor/protagonist drift”错误拒绝。
- 根因：`campaignPlanning.ts` 将规划阶段建议技能写入 Canon `initialSkills`，而 Canon payload 不含该 planning-only 字段；采用校验把额外建议误判为原著身份变化。
- RED：`tests/phase9-planning.test.cjs` 在修复前以 Canon 计划含建议技能为反例，采用应成功、实则 drift 拒绝；跨身份不匹配仍应拒绝。
- 最小修复：Canon intent 不绑定原创人物的建议技能；对已存旧 Canon proposal 中的规划字段兼容，其他身份不匹配仍拒绝。没有放宽 anchor、protagonist 或 Canon payload 校验。
- GREEN：定向 5/5；最新全量 Core 1,348/1,348，mobile typecheck 通过。
- Android：实际 GLM 开局方案在保留既有数据的 AVD 上采用成功，两个独立 campaign branch 均可写入 adoption turn 与后续 Runtime state。
- 提交：`8ab0419 fix(phase95): allow canon opening plan adoption`。

## SW95-M3-02：终局/暂停 Runtime 仍可提交可变更行动

- 严重度：P1。Runtime 进入 `failed` / `paused` 后，建议行动与 composer 仍可能诱发变更提交。
- 根因：Play projection 没有投影权威 campaign status；screen 与 controller 的提交路径因此不能共同拒绝非 active Runtime。
- RED：`tests/phase3-play-projection.test.cjs` 先验证 projection 应暴露 `campaignStatus=failed`，修复前实际为 `undefined`；终局 action availability 对照失败。
- 最小修复：`PlayUiProjection` 只读映射唯一 Runtime status；`canSubmitCampaignAction()` 仅允许 active Runtime（保留 legacy campaign 兼容）；屏幕隐藏变更行动、过时 guidance 并禁用 composer；controller 的直接提交和 guidance 提交也在 draft/network 前拒绝。只读 inspect choice 保持独立处理。
- GREEN：定向 7/7；最新全量 Core 1,348/1,348；mobile typecheck 与 Debug APK 构建通过。
- Android：在实际 `campaignStatus=failed` 的当前 AVD 终局页重新核验，`guidance-submit-*`=0、观察 action=0、composer disabled。数据未清除。APK 与设备安装包 SHA-256 均为 `C5B27FAEAAF8B1DF60946A8B826952DC4C1EC77A3AB4EA3BC26072FDFA26AF10`。
- 提交：`3847339 fix(phase95): gate actions after campaign termination`。

## 观测结果，未登记为代码缺陷

- 两个 agent-driven QA campaign 的 severe failure 后由已采用的规划结局进入 failed：第一局 5 个玩家模拟行动后结束；第二局仅 1 个玩家模拟行动，观察行动 severe failure 后经两次 plan replan 到 failed。数据库的 user turns、roll records、ending ID 和终局 UI 一致，未发现状态/结局投影不一致；“一次严重失败即结束”留作独立玩家可玩性评估，不在无 RED 代码反例时登记为代码缺陷。
- Partial world package 的 `package_entries.kind='method'` 数量为 0；所以 L1 阻滞是样本内容/资格不足，不通过手工补造或放宽 `difficultyPolicy` / `evidencePolicy` 把它伪装成缺陷修复。
- Talk 成功将 `testimony` counter 0→10 并在后续状态中保留；最终两局 `deferredConsequences` 都为空。没有触发/消费延迟结果的证据，因此不声称该链通过。

## 安全边界

- 代码没有新增 Runtime、Store、Reducer、schema 或第二套规则语义。
- 两局已提交 turn 与 dice 仅查询，不重放、不编辑；旧 world_extract unknown 保留，未确认、清账或重派。
- 模型生成的剧情截图及本地 SQLite snapshot 留在本机临时目录；密钥、小说正文、提示词和原始响应不提交。
