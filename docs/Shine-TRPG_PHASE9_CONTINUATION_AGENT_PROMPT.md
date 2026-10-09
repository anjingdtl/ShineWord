# Shine-TRPG 第九阶段续作 Agent 提示词（R66 之后）

用法：把下面 ```text 代码块整段复制给下一个 Agent。提示词自包含；接手 Agent 应先读列出的文档再动手。

```text
你接手 ShineWord（E:\AiWorkSpace\ShineWord，分支 main）第九阶段的测试+fix收尾，目标：让验收矩阵 A01–A40 全部通过。上一棒（Codex 完成 R60–R65、ZCode 完成 R60 断点复验与 R66a/b/c）已把工程侧打通，现在剩的是内容与旅程配额类缺口。

【先读，按序】
1. docs/reviews/phase9/HANDOFF_R66_2026-10-09.md —— 唯一权威交接：现状表、缺口清单、操作手册、硬合同、证据索引。
2. docs/reviews/phase9/LOCAL_FIX_2026-10-09.md 的 R66 节 —— 本批全部修复与真实路径证据。
3. docs/reviews/phase9/ACCEPTANCE_MATRIX.md —— 40 项状态与证据列。
4. .workbuddy/memory/2026-10-09.md —— 会话记忆（含操作细节）。

【当前事实】
- 完整核心 1187/1187 全绿；移动 typecheck/版本/APK 通过；R66c 源码 scope v3 757e46dc…、APK 8e6cae95…（109786515 bytes，已在 API35 模拟器保留数据安装验证）。
- 共享预算 1283/1500（.tmp/phase9/test-manifest.json），上限不得重置/增额；每个物理请求前必须经 tools/phase9-budget.cjs reserve。
- 真实库：.tmp/phase9/local-20261009/real-world/phase9.sqlite；QA 脚手架全在该目录（qa-runtime.cjs/journey-fixed.cjs/drive2-j1r66.cjs/recover-turn*-r66c.cjs/config.cjs）。
- 测试 LLM：C:\Users\anjin\Desktop\Ai工作坊\Test-API\GLM-TEST-KEY.txt（GLM-5.3-Flash、open.bigmodel.cn coding 端点）；测试小说：C:\Users\anjin\Desktop\Ai工作坊\放开那个女巫.txt（GB18030 编码）。
- 模拟器 AVD：ShineWord_Phase9_API35（本会话末已停机，用时启动）。
- J1R66 战役 camp-j1r66-mv0ixuuq-main 活跃于 v25、无在途回合：n1/n2 节点 succeeded、primary=n3（免于火刑的理据，局面已生成待玩）、plan rev2 已采用；有效决定 5/20（turn-0001/0002/0003/0004/0019）。
- A19 已证 1/2：consequence-visit-introduced 于 v4 排程、v19 显形（"探望成行之后，牢头与守卫对守规矩外乡人留印象，之后牢中交洽更顺利"）。

【任务，按优先级】
1. 【最高杠杆，先诊断再修】A15 类内容接线缺口：通用 situation-opening 方法（survey/ask-around/get-moving）success 档零状态变化，本旅程 21/26 回合因此不计有效决定。先离线复现（读 turns/branch_events 表对照 v5–v18），定位 progressive 开局通用方法为何不产生 counter/completion 事件；若属可修缺陷，按仓库惯例先写 RED（tests/phase9-*.test.cjs）再修，全量 verify:core 必须保持全绿。若判为内容质量类（final18 判例），如实记录不新增硬门禁。
2. J1 补足 20 个有效决定：用 drive2-j1r66.cjs J1R66 N 续跑（战役办法优先）；重规划 candidate_ready 需分支无在途回合才可 journey-fixed.cjs replan J1R66 正式采用；每次决定后用 branch_events/effects 审计有效性，机械重复不计。
3. A19 第二项持续后果 + 隔两次决定的用途实测。
4. J2/J3：照 plan-j1-r66.cjs 模式换 goal（J2 调查恐惧与误解、J3 日常合作改善）派发→独立六维审查（6×3 才准 adopt）→各 20 有效决定。
5. J4 同稳定快照 A/B 双分支各 10；Android UI J1 20 + J4 10（正式 UI 入口，Maestro/uiautomator，禁写设备库）。
6. A02/A03/A06/A10/A12/A26/A37 与 10+10 匹配性能对照、独立试玩。
7. 每完成一批：更新 docs/reviews/phase9/ 各报告（FINAL_REPORT/ACCEPTANCE_MATRIX/IMPLEMENTATION_PROGRESS/CONTENT_QUALITY + LOCAL_FIX 追加节），证据写 .tmp/phase9/local-20261009/，并同步 .workbuddy/memory/。

【硬合同，违反即推翻方法论】
1. outcome_unknown 禁止自动重发。恢复只能：recoverInterruptedAttempts 清扫（sent→outcome_unknown）→ readBuildReplay/acknowledgePlayReplay 人工确认 → 正式重派或 turnIdOverride 续跑。R62 首条与端上抽取未知永久禁区。
2. 冻结 run 的传输模式不可变；换代只走 useCurrentApiForRun。block_effect 类约束提案（事实真、无执行机制）走 rejectMappingConstraint 正式拒绝。
3. 诚实计数与记录：失败证据保留、不删用例、不手改模型响应/骰点/已采用归档、不凑数。
4. 源码一变就要重绑 QA 身份：node tools/phase9-identity.cjs > .tmp/phase9/local-20261009/<批次>-identity.json 并复制为同目录 fix-identity.json（transport 派发前逐请求校验）。
5. 端点特性：缓冲长请求 ~300s 被网关杀；高档长请求必须流式（R66b 已实现，新增长思考类请求要进 EXTENDED_OPERATION_KINDS）。planner/narrator 偶发 socket hang up 属正常未知，按合同恢复。
6. Git：主工作树禁 checkout/switch/stash/reset --hard/clean -fd；.zcodeignore、.workbuddy/memory/2026-09-28.md、2026-09-29.md、docs/architecture/、docs/Shine-TRPG_PHASE4_AGENT_PROMPT.md、docs/Shine-TRPG_SKILL_GENRE_BINDING_AGENT_PROMPT.md 是其他会话的未提交工作，不要动、不要一起提交。commit 前跑完整门禁。

【完成定义】
A01–A40 全 PASS，或每项都有"当前身份下的真实证据 + 明确残余缺口与原因"的诚实记录；最终批次文档齐、证据齐、门禁全绿后按用户授权提交。
```
