# FINAL_REPORT — LLM 上下文与长期记忆基础设施专项

> 分支：`feature/llm-context-memory-infrastructure`
> 提交链：M0 `3fde845` → M1 `ef51917` → M2 `87f696c` → M3 `b38aa31` → M4 `0996945` → M5 `69b584a` → M6 `0241a1f`+
> 真实模型：GLM-5.3-Flash（智谱 open.bigmodel.cn）
> 验收目录：`docs/reviews/llm-memory/`（M0–M6 + 本报告 + artifacts/ 脱敏证据）

## 一、总览结论表

| 项 | 结论 |
|---|---|
| Budget Kernel | **PASS** |
| JSON Resilience | **PASS** |
| Request Ledger | **PASS** |
| Story Memory V2 | **PASS** |
| Episodic Recall V2 | **PASS** |
| Planner Context（Elastic） | **PASS** |
| Narrator Context（独立预算） | **PASS** |
| Branch / Rewind 隔离 | **PASS** |
| Long-run 100 | **PASS** |
| Long-run 300 | **PASS** |
| Long-run 1000 | **PASS** |
| DeepSeek real | **NOT TESTED**（本轮仅 GLM key 可用） |
| GLM real | **PASS**（除设备端两项，见下） |
| Android | **PARTIAL**（工程链全过；设备真实 LLM 与 in-flight 强杀 BLOCKED） |

## 二、23 问逐项回答

1. **Budget Kernel 是否通过？** PASS。能力来源五级治理、Soft/Burst/Hard、mandatory 保护、确定性、reasoning 双方言单次扣减、wire 上限、output demand 与能力分离（B01–B12 + 32/64/128/200K/1M 矩阵 24 用例）。
2. **JSON Resilience 是否通过？** PASS。21 用例：fence/prose/平衡提取/尾逗号/双重编码/别名（不覆盖 canonical）/枚举白名单/截断分类/恶意字段直达 validator/三重编码拒绝；权威校验器位置与强度未动。
3. **Request Ledger 是否通过？** PASS。迁移 19 + 六态生命周期 + outcome_unknown 禁自动重发 + 冷启清扫 + attempt_no 递增 + usage 四列；7 用例 + 真实 GLM 4 行验证。
4. **Story Memory V2 是否通过？** PASS。双轨、Patch 化、确定性 merge、指纹链、smart cadence、no-stall、fork 隔离（补丁折叠 ≤fork）；20 用例 + 真实 checkpoint（clean/2冲突/2线索/8 beats）。
5. **Episodic Recall V2 是否通过？** PASS。CJK n-gram + IDF + 实体 boost（歧义别名不 boost）+ 混合 Top-K + 预算打包；完全本地零 LLM；20 用例。
6. **Planner 是否已接入 Elastic Context？** PASS。六 board 候选 → 内核预算 → 冻结 → 分节渲染；legacy 显式回退。
7. **Narrator 是否已独立预算？** PASS。独立上下文（无 worldKnowledge/sourceEvidence/协议）+ 独立 output 预算；session 集成测试断言严格小于 Planner。
8. **32K/128K/1M 是否测试？** PASS（另含 64K/200K；含 1M 不塞满约束）。
9. **Story Memory 是否会阻塞 Play？** 不会（no-stall）。维护全程后台、失败仅标记 failed；hard gap 时 fail-closed（不虚构历史）。
10. **Rewind/Fork 是否隔离未来记忆？** PASS。fork 事务内补丁链 ≤forkVersion 折叠 + episodic/memories/turns ≤fork 复制；测试断言 b2 无 fork 后内容、源分支不变。
11. **100 Turn Recall？** PASS（t3/t18 命中，1.1ms）。
12. **300 Turn Recall？** PASS（t3/t18/t73 命中，2.3ms）。
13. **1000 Turn Recall？** PASS（t3/t260 同时命中，4.7ms；目标 <2500ms）。
14. **GLM Planner 真实调用成功？** PASS（10 回合全真实 + 门禁单测）。
15. **GLM Narrator 真实调用成功？** PASS（同上，grade 未篡改）。
16. **Memory Patch 真实调用成功？** PASS（白篱梦 v0-8 checkpoint clean；首轮失败暴露「省略节」问题→已修复→复测通过）。
17. **reasoning_only 是否有正确恢复机制？** PASS（机制层：bounded ×2 自动提预算重试、不提交空结果、思维永不关闭；真实 GLM low 档未复现 reasoning_only → 分类/恢复由 27 项单测覆盖）。
18. **JSON 常见异常是否可恢复？** PASS（真实 fence 变体 + 21 本地矩阵）。
19. **App 强杀后 sent request 是否 outcome_unknown？** PASS（语义：单测冷启清扫 + 重放阻断；设备端 in-flight 场景 BLOCKED，见第 22 问）。
20. **《白篱梦》真实 10 回合是否通过？** PASS。9/10 完整提交 + 1 次虚构地点被本地规则安全拒绝（权威边界正确）；memory checkpoint + 早期事件召回（T2 约定 → T9 命中）+ 账本 41 行 succeeded。
21. **《凡人修仙传》长篇压力验证结果？** PASS。2469 章 import 1.5s；54K-token 真实请求 3.8s 通过；重复前缀 99.8% 缓存命中；未整本跑真实 API（成本边界，按方案）。
22. **Android 是否通过？** PARTIAL。安装/冷启/Metro/书库/迁移 1–21（拉库实证）/force-stop 冷启恢复全 PASS；**BLOCKED** 项：设备真实 LLM 旅程与 in-flight 强杀 ledger——真实 API Key 依红线禁止输入 adb/会话日志（设备上仅使用占位 key）。该两项语义已由单测 + Node 真实 GLM 链路覆盖。
23. **当前还有哪些 BLOCKED？**
    - 设备端真实 LLM 旅程（密钥红线）。
    - Release 签名构建（签名环境变量不可用；发布时须 `--rerun-tasks` 防旧 JS bundle）。
    - DeepSeek 真实门禁（无可用 key）。
    - 真实 Provider 枚举别名观察记录（机制就绪，白名单为空，待 M6 后持续观察）。

## 三、真实用量与成本边界

- M6a 门禁 ≤8 请求；M6b 白篱梦 23 请求（含 5 次试错均为本地校验快速失败，未浪费）；M6c 2 请求；每场景先计划后调用，无循环烧 API。
- 白篱梦全程：input 73,980 / output 11,788 / reasoning 804 / cached 6,400 tokens。
- 未 commit：小说原文、完整 prompt、API key、reasoning_content（artifacts 仅含指标/ID/长度）。

## 四、修复的存量缺陷（本专项之外）

1. fork 不复制 committed 历史行（turns/rolls/narratives/events/memories）→ 长程记忆与召回在新分支无从谈起 → 已在 fork 事务内补齐。
2. 渐进开局 8K wire 上限与 reasoning reserve 冲突（GLM 预设开局即失败）→ content 钳制。
3. Memory patch 协议「可省略节」与验证器必填矛盾（真实模型首个受害者）→ 省略=无变更。
4. Planner 上下文缺合法 skillId 列表（真实模型必然猜错）→ 【可用技能】入 authority。

## 五、遗留与建议（下一轮）

1. DeepSeek 真实门禁 + 设备端真实 LLM 旅程（需可合规注入的测试通道，如 debug-only ContentProvider 或 QR 输入）。
2. FrozenTurnContext / ContextTrace 持久化 + 调试面板（lastTurnContexts 已就绪）。
3. 世界构建 LLM 调用统一到 capability resolver + ledger（plan §62 第 5 条）。
4. Memory Queue 跨入口串行化（当前由单 playTurn 后台链保证）。
5. 世界构建固定输出预算（timeline 8192 等）迁入 DEFAULT_OUTPUT_DEMANDS。
6. 枚举别名观察白名单的持续录入流程。

## 六、门禁快照（合并前）

- Core Verify：**399/399**（基线 296 + 新增 103）
- Mobile typecheck：PASS；Core typecheck：PASS；`git diff --check`：PASS
- Debug APK：PASS（91.78 MB）
- 真实 GLM：五门 PASS / reasoning OBSERVED
- 合并条件：Core Verify GREEN ✓ Android Verify GREEN（本地等价门禁；CI 在 PR/main 触发）✓ 全量本地测试 GREEN ✓ Review 无 P0/P1 ✓ FINAL_REPORT 完成 ✓
