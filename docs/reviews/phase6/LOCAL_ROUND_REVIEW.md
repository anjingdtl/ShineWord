# 本地接续轮实现审查记录（2026-10-03）

按"实现→review→fix→验证→commit"执行的三笔修复与一项未关闭缺陷。每批 diff 由独立复审 agent 评审（fresh eyes，含按行核对与旧代码回滚验证），结论与吸收情况如下。

## L1 预设脱离陷阱（commit 529497e）

- 复现：首启表单点 GLM 预设→清空模型名（updateModel 检测到值≠预设→清 presetId+两能力字段）→重输同名→保存成功但 capabilities 缺失→导入小说时 `Profile contextWindow is unknown (capability-source governance)` 英文阻断。
- 修复：模型名精确匹配预设且两个能力字段为空时重新附带预设（不覆盖用户已填值）；LibraryScreen 导入错误把治理/预算族报错映射为可操作中文。
- 复审结论 approve-with-nits：确认三处 nit（clearPreset 可被重输击败、同名别名获得预设能力、闭包脆弱性）均为窄路径/可接受取舍，不改。域层英文报错字符串被 4 个测试文件断言，保留原文、仅在 UI 边界映射。
- 验证：mobile typecheck 0；设备复现清空→脱离、重输→预设✓与"预留 2K"恢复。

## L2 故事面板刷新（commit f9d6a72）

- 复现：依赖恢复路径提交的回合（turn-0002）叙事已持久化（DB 338 字）但故事面板不渲染，重进屏幕才显示；同型再现于 turn-0003（检定回合）。
- 修复：乐观合并行 `{...item}`→`{...turnView}`；refresh() 加启动序号守卫（旧读不得覆盖新读，成功与错误路径都守卫）；AppState 回前台时刷新一次（挂载期 epoch=0 跳过避免重复）。
- 复审结论 approve-with-nits，唯一 should-fix（catch 未守卫）与建议（预算族正则扩展）当场吸收。
- 验证：791/791；设备上回合 4 提交后即时显示，前台切换刷新生效。

## L3 映射暂停丢弃已结算响应（commit ccfe68e）

- 复现（设备，修复前）：映射 99,131 字符请求在途时暂停→响应到达（账本 #22 已结算 41,669 tokens）→在 done 检查点写入前被 `signal.aborted`(:1002) 与 `assertCurrent`(:1030) 丢弃→恢复重发同尺寸请求（#23，42,717 tokens）重复计费。抽取路径自身合同（coordinator "Dropping a successful response here would bill the same unit again" + closeout-c3 回归）与映射路径相反。
- 修复：删除响应到手后的 abort 丢弃；assertCurrent+signal 检查移至批次检查点写入之后（循环顶部 :882 与发送侧 mapping_request_fence_lost 仍拦新发送）；saveRuleMapping 无围栏写入补注释（内容寻址幂等）。
- 复审结论 approve：确认 saveRuleMapping 幂等安全、zombie 租约写一个额外批次检查点可被新 runner 作为缓存命中（防双计费方向）、截断恢复/暂停组合无重发环路；两条 nit（assertCurrent 半边测试、注释）当场吸收。
- 验证：新增两条回归测试（signal 暂停在途、stale fence 在途），旧代码 18/1 失败、新代码 20/20；792/792；设备 part2 映射在途暂停→冷重启→继续 0 新调用发布。

## L4 追加第三部段发布结构阻断（未修复，准确记录）

- 现象：novel-utf8-part3（同书 160000..240000 rawCP 转码，第 3 成员）追加后，抽取/审查（invalid_proposal 按事实解决）完成，段发布被 `isSegmentArtifactV1` 结构守卫拒绝，`segment_publication_diagnostics` 两行 `invalid_artifact_structure`；运行 failed_retryable/validating，继续构建在本地循环失败且无待审项。2 成员（part2）追加闭环正常，仅 3 成员路径复现。
- 疑点（未定谳）：守卫内 `citations.length !== expectedCount` 等不变量；相关映射 proposal 出现 `fact-ent-*` 合成实体事实 ID 作为 evidenceFactIds；以及 part3 恢复时一次 batchHash 1 字符漂移导致的映射重发。
- 保留：设备 DB 快照（live6/live7.db）、诊断行、完整复现步骤（本地 scratch）；part3 运行已正常停止、全部数据保留。修复留待下一轮，不放宽任何门禁。
