# 启动收束检查点（Startup Convergence CHECKPOINT）

> 供换会话接手：每完成一个里程碑更新本文件。验收矩阵状态见各工作包简报与本文件汇总。

## 当前状态

- **D4/C-17/C-18 三项批准已执行**（2026-10-27/29）。分支 `codex/convergence-w4c-narrator-degrade`（W4c 实现 `1d391f4`、fast-fail 修复 `967821f`、journey 驱动与文档）。最终门禁 `verify:core` **1415/1415**。
- **W4c 已实施**：45s 队列期限 + 确定性/sub-2s 传输失败 → 本地模板降级（真实旅程中实际触发并正常提交）；慢速切断保持 unknown。设备实测发现 RN fetch 拒连无错误码 → RFC 实施附录新增 narrator 专属 fast-fail 窗（2s）。
- **C-17 完成（PASS-PARTIAL）**：host 侧 production pipeline 真实旅程——本地基线 0 请求开局、L1+真实 Narrator、真实 Planner、降级提交、预算硬顶、冻结安全拒绝。预算共支 **30/60**（详见 [C17_REAL_JOURNEY_BRIEFING.md](C17_REAL_JOURNEY_BRIEFING.md)，含 18 笔抽取重试的诚实记录）。
- **C-18 材料就绪**：[C18_PLAYTEST_GUIDE.md](C18_PLAYTEST_GUIDE.md) 任务单待真人执行。
- 设备遗留（如实登记）：ShineQA 模拟器三次崩溃；设备战役 A 带 unknown 待确认状态（不自动重放）；dist 的 V1.1.0 debug APK 含 W4c 修复前代码，合入后需重构建。

## 已完成工作包

| 工作包 | 状态 | 证据 |
|---|---|---|
| W0 基线仪器+普查 | PASS-ENGINEERING | `W0_BASELINE.md`；冷启动 5 次采样（boot_end p95≈2.1s、db_runtime p95≈0.9s）；§2.2 全部核实 |
| W1 策略表+守卫 | PASS-ENGINEERING | `usagePolicy.ts` + 普查测试（C-01 PASS） |
| W2 向导去 LLM 化 | PASS | `W2_BRIEFING.md`；挂载→目标中位 78ms、0 请求；"AI 换一批"1 次请求取证 |
| W5 测量部分 | PASS-ENGINEERING | 并入 W0 冷启动数据；改动部分在 C4 依数据实施 |
| W3 本地优先开局计划 | PASS（模拟器） | `W3_BRIEFING.md`；C-05/06/07/09/10 自动化 PASS；C-08 设备 p95≈1.9s、0 LLM 请求 |
| W4a 自由输入本地路由 | PASS | `W4_W5_W7_BRIEFING.md`；黄金样本零误绑 7 项 |
| W4b 减少 planner_required | PASS（门槛+提示词） | 新创作解析门：无骰动作禁 planner_required；真实产出比例待 C-17 |
| W4c Narrator 降级 | RFC 已交付 | `W4C_NARRATION_DEGRADE_RFC.md`，等 D4 |
| W5 冷启动拆分 | PASS（模拟器） | boot_end p95 2083→1118ms；unknown 恢复保留关键路径 |
| W7 文档收束 | PASS | 方案入库登记、INDEX.md、README 入口、progress 状态表 |

## 真实凭据与预算登记

scoped 预算 `convergence-20261026`（上限 60 物理请求）：已用 **4**——`world_extract` ×1（开局抽取 108.7s 流式）、`style_analyzer` ×1（后台）、`opening_goal` ×1（C-04 取证）、`campaign_plan` ×1（本地开局后的后台后继预备，T-C）。Key 经一次性桥写入 Keychain，未入库未入日志。测试世界：fangkai-nvwang（可游玩，1 段就绪）。

## 与方案的冲突（以代码为准，需回改方案）

1. `verify:core` 基线 1377（现 1398），非文档记载 1334。
2. standalone debug `__DEV__`=false：trace sink 无条件安装（字段白名单保证隐私）。
3. `summarizer`/`world_adjudication` 无生产调用点；`registry`/`timeline` 不在 mobile 开局链上；memory 类为提交后后台。
4. W3 实测补充：K3 向导目标中位 78ms（瓶颈是世界包读，非生成）；K1 本地路径 1.7–1.9s 中约 1.3s 是游玩页投影加载与渲染（本地编译+采用仅 0.4s）——若需进一步压 K1，优化点在游玩页加载，非计划编译。

## 未完成项与阻塞

- **C-18**：等真人按 [C18_PLAYTEST_GUIDE.md](C18_PLAYTEST_GUIDE.md) 执行并记录。
- C-17 长旅程（80 决定级）与后台预备在本轮预算内的派发：NOT RUN（剩余授权预算 30 保留；机制证据在设备侧 2026-10-26 已有）。
- 真机验证、K3 p95 大样本：NOT RUN。
- 发版：W4c 合入 main 后建议发 V1.1.1（PATCH：narrator 降级与 fast-fail 修复），另需重建含修复的 debug APK 供设备复测。

## 下一步（换会话接手）

1. 推送 `codex/convergence-w4c-narrator-degrade` 并开 Draft PR（由用户决定合并）。
2. 用户执行 C-18 试玩并回填记录。
3. （可选）合入后发 V1.1.1；若继续 C-17 长旅程，剩余预算 30，建议先解决 MiniMax 抽取输出兼容性（独立评审，勿放宽校验器）。
