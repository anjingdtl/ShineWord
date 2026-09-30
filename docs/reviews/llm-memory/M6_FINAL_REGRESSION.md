# M6 最终回归 — 真实 GLM · 长篇边界 · Android

> 阶段：M6（全量回归 / 设备 / 真实模型）
> 基线：`0241a1f`
> 真实模型：GLM-5.3-Flash @ open.bigmodel.cn（key 仅存在于本机测试文件与进程内存；未入库/入日志/入截图）

## 1. 代码门禁（最终轮）

| 门禁 | 结果 |
|---|---|
| `npm run verify:core` | **399/399 PASS**（M0 基线 296 → +103 新测试） |
| `npm run typecheck` | PASS |
| `npm run typecheck --prefix mobile` | PASS |
| `git diff --check` | PASS |
| `npm run apk:debug --prefix mobile` | PASS（91.78 MB，含全部 M1–M5 改动，2026-09-30） |

## 2. 真实 GLM 门禁（M6a，`tools/real-glm-gates.cjs`，≤8 物理请求）

| 场景 | 结果 | 证据（脱敏，artifacts/m6a-glm-gates.json） |
|---|---|---|
| GLM Planner | **PASS** | actionKind=skill_check，2.9s，proposalVersion 2.0，actorId 正确 |
| GLM Narrator | **PASS** | envelope 完整，text ≥ 94 字，grade 未被篡改 |
| GLM Memory Patch | **PASS**（修复后一次过） | status=clean，2 characters / 1 relationship / beats 落库 |
| GLM JSON 变体 | **PASS** | 模型按指示用 ```json fence + 前置说明 → 管线正确解出 |
| Ledger | **PASS** | 4 行全 succeeded，input/output/reasoning/cached 四列记录 |
| reasoning | **OBSERVED** | reasoningTokens=4（low 档）；cachedInputTokens=256/261（前缀缓存命中） |

修复记录（真实模型暴露、本轮已修）：
1. Memory patch 验证器把「省略节」当错误 → 改为省略=无变更（类型错误仍拒绝）。
2. 渐进开局预算：8K wire 上限未容纳 reasoning reserve → GLM 预设会在开局即 profile_budget 失败 → content 钳制、思考保持开启。
3. Planner 看不到合法 skillId → 【可用技能】入 authority board（plan §40）。

## 3. 《白篱梦》真实 10 回合（M6b，`tools/real-glm-bailimeng.cjs`，23 物理请求）

**PASS**。链路：TXT import（300 章 / 965,458 码点 / 135ms）→ 开局 dossier（**1 次真实请求、零 repair、13.2s**，逐字引文通过本地校验）→ 本地编译+发布开局包（11 entries）→ 原创主角建战役 → 10 次真实玩家决策。

- 9/10 回合完整提交（覆盖 automatic / success / failure / severe_failure / 对话 / 观察 / 技能检定 / 移动 / 人物互动 / Quest / 历史再提及）；T6 提议了不存在的地点「main-hall」被**本地规则安全拒绝**（无骰子回退、无计费浪费）——权威边界按设计工作。
- **Memory checkpoint 真实触发**：cadence 在 v8 达标后台执行，最终 state clean / through=8 / 1 人物 / 1 关系 / **2 冲突 / 2 线索 / 8 beats**，指纹链 `smp:camp-m6b-main:0-8`。
- **早期事件 Recall PASS**：T2 的「玉簪信物·三日之约」→ T9 提及时 episodic recall candidate 在场且**包含 turn-0002**（`recallMentionsTurn2=true`）。
- 上下文动态生长：T1 仅 3 boards → T2 起 5 boards（storyMemory/recentHistory 随历史出现）。
- 账本：planner/narrator/memory_checkpoint 全 succeeded；总用量 input 73,980 / output 11,788 / reasoning 804 / **cached 6,400**。
- 已知 harness 瑕疵：脚本外层计数包装 + session 内 LedgeredProvider 双层记账使行数翻倍（生产单层，无影响）。

## 4. 《凡人修仙传》长篇边界（M6c，`tools/real-glm-fanren.cjs`，2 物理请求）

**PASS**（按方案 §57 边界：代表阶段 + 少量真实请求，不整本跑）。

- 大文本 import：**2469 章 / 7312 chunks / 7,601,316 码点 / 估算 6.87M tokens / 1476ms**（桌面 Node）。
- 大上下文真实请求：54,495 估算 token 前缀（provider 计 39,224 input）→ JSON 单次通过，3.8s。
- 前缀缓存：重复前缀 **cached 39,168/39,229 = 99.8%** 命中。
- 结论：1M 窗口 + 内核预算 + 缓存可以承载长篇代表批次；更大规模由预算内核钳制（M1 B12：分配 ≤ 需求）。

## 5. Android 实测（M6d，ShineQA AVD / API 37）

| 步骤 | 结果 |
|---|---|
| `adb devices` 确认 | PASS（emulator-5554） |
| 安装 Debug APK | PASS（旧包签名冲突 → 专用 QA AVD 上仅卸载应用包后重装；未 clear/wipe） |
| 打开 / Metro 渲染 | PASS（首启 Profile 页正常渲染） |
| Profile 保存 → 书库 | PASS（设备上使用**占位假 key**；真实 key 依红线禁止输入 adb/会话日志） |
| 设备 DB 迁移 | **PASS** — 拉库验证 `schema_migrations` 1–21 全部应用；`llm_request_attempts / story_memory_states / story_memory_patches / episodic_turn_index` 四表在位 |
| force-stop → 冷启动 | **PASS** — 强杀后重启直达书库，profile 持久化，ledger 冷启清扫运行，无错误日志 |
| 设备真实 LLM 旅程（导入白篱梦→10 回合） | **BLOCKED**（真实 Key 无法合规输入设备） |
| 设备 in-flight force-stop ledger | **BLOCKED**（同上）；outcome_unknown/禁重发语义由 27 项单测 + Node 真实链路覆盖 |

## 6. Release 构建

正式签名环境变量本会话不可用 → Release assemble/apksigner **NOT TESTED**（按提示允许；已知风险「Release bundle 未感知 src/** 修改」记录在案，发布时须 `--rerun-tasks` 强制重打 JS bundle）。

## 7. 结论

- 真实模型五门（Planner / Narrator / Memory Patch / JSON 变体 / reasoning observed）全过；短篇 10 回合真实闭环全过；长篇边界按方案执行全过；Android 工程链路过、设备真实 LLM 受密钥红线 BLOCKED。
- 详见 `FINAL_REPORT.md`。
