# 启动收束检查点（Startup Convergence CHECKPOINT）

> 供换会话接手：每完成一个里程碑更新本文件。验收矩阵状态见各工作包简报与本文件汇总。

## 当前状态

- 里程碑进度：**C0 完成**（W0+W1）｜**C1 完成**（W2 + W5 测量并入 W0）｜**C2 完成**（W3 三提交）｜C3 进行中
- 分支：`codex/startup-convergence-w0`，提交序列：W0 埋点 `82614b7`、W1 策略表 `b93c883`、W0 文档 `5151c29`、C0 检查点 `64f9424`、W2 `30bcd64`/`ef7af26`/`f650b74`/`ed78089`、W3 `8749bcf`/`40236fe`/`62d61bc`。
- 门禁：每提交后 `verify:core`（最新 1398/1398）+ `verify:version` + mobile typecheck 全绿；远端 CI 在基线 `e7f5e9d` 绿。
- 方案文档 `docs/Shine-TRPG_STARTUP_CONVERGENCE_PLAN.md` 仍为工作树未跟踪文件（规划 agent 所留，按交付规则暂不提交；W7 收束时再定）。

## 已完成工作包

| 工作包 | 状态 | 证据 |
|---|---|---|
| W0 基线仪器+普查 | PASS-ENGINEERING | `W0_BASELINE.md`；冷启动 5 次采样（boot_end p95≈2.1s、db_runtime p95≈0.9s）；§2.2 全部核实 |
| W1 策略表+守卫 | PASS-ENGINEERING | `usagePolicy.ts` + 普查测试（C-01 PASS） |
| W2 向导去 LLM 化 | PASS | `W2_BRIEFING.md`；挂载→目标中位 78ms、0 请求；"AI 换一批"1 次请求取证 |
| W5 测量部分 | PASS-ENGINEERING | 并入 W0 冷启动数据；改动部分在 C4 依数据实施 |
| W3 本地优先开局计划 | PASS（模拟器） | `W3_BRIEFING.md`；C-05/06/07/09/10 自动化 PASS；C-08 设备 p95≈1.9s、0 LLM 请求 |

## 真实凭据与预算登记

scoped 预算 `convergence-20261026`（上限 60 物理请求）：已用 **4**——`world_extract` ×1（开局抽取 108.7s 流式）、`style_analyzer` ×1（后台）、`opening_goal` ×1（C-04 取证）、`campaign_plan` ×1（本地开局后的后台后继预备，T-C）。Key 经一次性桥写入 Keychain，未入库未入日志。测试世界：fangkai-nvwang（可游玩，1 段就绪）。

## 与方案的冲突（以代码为准，需回改方案）

1. `verify:core` 基线 1377（现 1398），非文档记载 1334。
2. standalone debug `__DEV__`=false：trace sink 无条件安装（字段白名单保证隐私）。
3. `summarizer`/`world_adjudication` 无生产调用点；`registry`/`timeline` 不在 mobile 开局链上；memory 类为提交后后台。
4. W3 实测补充：K3 向导目标中位 78ms（瓶颈是世界包读，非生成）；K1 本地路径 1.7–1.9s 中约 1.3s 是游玩页投影加载与渲染（本地编译+采用仅 0.4s）——若需进一步压 K1，优化点在游玩页加载，非计划编译。

## 未完成项与阻塞

- C3：W4a/W4b 实现 + W4c RFC（进行中）。
- C4：W5 改动（冷启动拆分，空间 ≤0.9s）+ W7 文档收束。
- C-17（真实模型完整旅程）/C-18（外部试玩）：BLOCKED（待用户预算授权/安排）。
- C-08/C-03 真机、首次运行空库冷启动、离线 10 回合：NOT RUN。

## 下一步

C3 施工（W4a 高置信本地匹配→L1；W4b 无骰动作固定策略；W4c 只写 RFC 不实现）。
