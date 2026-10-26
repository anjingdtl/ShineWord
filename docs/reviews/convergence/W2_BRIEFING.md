# W2 简报：向导去 LLM 化（opening_goal）

> 工作包：W2｜分支：`codex/startup-convergence-w0`（提交 `30bcd64`、`ef7af26`、`f650b74`）｜2026-10-26

## 改了什么

- 新增 `src/application/campaign/localOpeningGoals.ts`：确定性模板目标（≤2 条、每条 ≤28 码点、动词开头、去重），输入与 `OpeningGoalSuggestionInput` 对齐；锚点序号前缀（`序N · `）剥离，人物缺失回退地点、再回退中性目标。
- `OpeningScreen.tsx`：挂载与改锚点**零请求**——先在挂载帧用已加载 setup 同步生成芯片，锚定投影到达后本地刷新；`getWorldSetup` 调用改用 `createReadOnlySession()`（stub provider），不再每次构建真实 provider。
- 显式"AI 换一批"按钮（`QuickOpeningConfirm`/`StepConfirm`）：唯一 `opening_goal` 请求路径，沿用原治理（账本/缓存/世界在位检查）；失败静默、本地芯片保留；按钮下文案诚实标注当前来源（"以上是本地推荐；AI 换一批会发起一次模型请求" / "以上是 AI 建议"）。
- `tests/local-opening-goals.test.cjs`：确定性、长度、去重、回退 6 项。
- 顺带修复：MiniMax 预设 wire id 过期（`-Preview` 后缀已被供应商移除，2026-10-26 经 `GET /models` 验证），否则预设能力声明与模型名互相矛盾会阻断构建。

## 证据（类别与状态）

| 项 | 证据类别 | 状态 | 数据 |
|---|---|---|---|
| C-03 自动化：本地生成确定性与约束 | 自动化测试 | PASS | `tests/local-opening-goals.test.cjs` 6/6（含于 verify:core 1391/1391） |
| C-03 设备：挂载→目标可见耗时 | 模拟器 UI + trace | **PASS（边缘）** | 5 次采样 72/76/78/104/107 ms，中位 78 ms；瓶颈为世界包 SQLite 读（`getWorldSetup`），非生成。K3 目标 100 ms 在中位达成、p95 边缘超出，后续可随 W5 数据优化或维持 |
| C-03 设备：挂载/改锚点请求增量 0 | 模拟器 + 物理预算账本 | PASS | 向导 5 轮进出期间 scoped 物理预算无 `opening_goal` 消耗（期间仅有的 1 次新请求为构建完成后的后台 `style_analyzer`，属 T-C 档，与向导无关） |
| C-04：点击"AI 换一批"才发 `opening_goal` | 模拟器 + 物理预算账本 | PASS | 点击后恰好 1 次 `opening_goal`（预算 2→3/60），trace `wizard_goal_ready{source:llm,count:2,via:manual}`，文案切换"以上是 AI 建议" |
| C-04：失败静默 | 自动化测试（既有） | PASS | `suggestOpeningGoals` 既有测试覆盖 provider 失败返回 []；UI 处理器 catch 静默 |

设备：模拟器 ShineQA AVD（API 37）；APK SHA-256 见 `test-logs/convergence-w0/`（本机）。截图：`wizard-confirm-local-goals.png`、`wizard-ai-refresh-button.png`（本机 test-logs，不入库）。

## 真实凭据使用登记（本次会话）

- scoped 预算 `convergence-20261026`（上限 60 物理请求），已用 **3**：`world_extract` ×1（开局抽取，108.7s 流式，3661 帧）、`style_analyzer` ×1（后台，19s）、`opening_goal` ×1（本次 C-04 取证）。Key 经 `tools/phase9-secret-bridge.cjs` 一次性注入 Keychain，未入库、未入日志。世界构建 4/4 完成、可开局（含 1 项 canon_conflict 人工审查：两时点位置描述按补充事实保留）。

## 未验范围

- 改锚点时的本地刷新未单独采样（结构与挂载同路径）；K3 的 p95 需更大样本才能断言稳定 ≤100ms。
- 真机/低端设备：NOT RUN。

## 下一步

C2（W3 三个提交）。本向导世界（fangkai-nvwang，可开局）将用于 W3 提交 3 的 C-08 设备测量。
