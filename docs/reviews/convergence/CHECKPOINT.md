# 启动收束检查点（Startup Convergence CHECKPOINT）

> 供换会话接手：每完成一个里程碑更新本文件。验收矩阵状态见各工作包简报与本文件汇总。

## 当前状态

- **已发版 V1.1.0**（2026-10-27，tag `v1.1.0`，GitHub Release 附正式 APK；versionCode 1010000）。收束轮经 PR #18 快进合入 main（`9914e4b`），发版提交 `e5a5a80`，两提交 CI 双绿。
- 工程收束达成（C-01~C-12、C-16 PASS；见 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md)）。
- **注意**：发版冒烟因 debug→release 签名变更执行了卸载重装，ShineQA AVD 上的测试数据（fangkai-nvwang 世界、profile、Keychain）已清除；若做 C-17 需重建世界（约 1–2 次物理请求，scoped 账本 `.tmp/convergence/minimax-scoped-20261026.json` 仍有效，4/60）。
- 待用户决策：**D4**（W4C RFC 批准→解锁 C-15）；**C-17** 预算授权；**C-18** 外部试玩。**D1**（W6 序章）维持不实施。

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

- **D4 待决策**：W4C RFC（批准后按 RFC §4 顺序实施，解锁 C-15）。
- **C-17**（真实模型完整旅程）：BLOCKED——待预算授权。本会话已用 4/60（world_extract/style_analyzer/opening_goal/后台 campaign_plan 各 1）；scoped 账本 `.tmp/convergence/minimax-scoped-20261026.json`。设备测试世界 fangkai-nvwang 保持可游玩。
- **C-18**（外部试玩）：BLOCKED 待安排。
- 真机、首次运行空库冷启动、K3 p95 大样本：NOT RUN。

## 下一步（换会话接手）

1. 用户批准 D4 → 实施 W4c（模板→期限→not_sent 关闭→端到端强杀矩阵→usagePolicy 回填）→ C-15 离线 10 回合。
2. C-17：授权预算后用 fangkai-nvwang 世界跑完整旅程（本地开局 + 后台增强 + 80 决定级样本）。
3. 推送分支并开 Draft PR（交付规则允许；尚未推送）。
