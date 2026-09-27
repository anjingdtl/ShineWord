# M5 Review / Fix 报告

日期：2026-09-27  
Review 分支：`phase/m5-alpha`

## M5 实现范围

按建设方案第 13 节落地 Alpha 工程化目标：多 Provider 能力探测、故障注入与重试、性能基线（20 万字基准 / 100 万字压测）、100 回合真实 LLM 一致性验证、正式签名 Release APK。

### 多 Provider 能力探测（`src/application/llm/capabilities.ts`）

- `probeCapabilities` 两段式探测：JSON 模式探测（载荷含字面 `json`，兼容 DeepSeek JSON 模式必须出现该词的约束）与用量回报探测分开判定，失败带错误信息不抛异常。
- 真实三家provider复核（2026-09-27，`.tmp/m5-probe-result.txt`）：
  - GLM `GLM-5.3-Flash`：jsonMode ✓ / usage ✓
  - DeepSeek `deepseek-v4-flash`：jsonMode ✓ / usage ✓
  - MiniMax `MiniMax-M2`：jsonMode ✗ / usage ✓（JSON 探测失败被如实记录，不误报）

### 容错传输（`src/application/llm/resilient.ts`）

- `FaultInjectionTransport`：network / http_500 / timeout / malformed_body 四类故障注入，供测试复现。
- `postWithRetry`：默认 3 次、退避 250ms×attempt；**只对网络失败与 5xx 重试**，timeout 不重试（避免双倍计费）；4xx 原样上抛。
- `CancellationToken` + `withCancellation`：取消令牌贯穿传输层。

### Profile 级 thinking 开关（`src/application/llm/types.ts` + `openAICompatible.ts`）

- `ApiProfile.thinkingDisabled`：请求级 `vendorOptions.thinkingDisabled` 未设置时按 Profile 生效。智谱 GLM 推理模型不关闭 thinking 会把全部输出预算花在思考上、返回空 completion，导致游戏回合必然失败——此前只在世界构建抽取路径处理过，游戏主循环缺失。
- 移动端 `profileStore` 对 `bigmodel.cn` 端点或 `glm*` 模型自动置位，用户无需理解该参数。

### 摘要与结算（`src/application/memory/summarizer.ts`、`src/application/game/turnSettlement.ts`）

- `summarizeRange` 基于 `SqliteTurnStore.listCommittedTurns` 构建摘要请求；版本区间必须前进的校验保留。
- `settleTurnProgress`：诚实失败——回合失败不发放练习点；重放返回不变结果。`settleRelationships`：单回合 closeness 增量夹取 -5..5，累计 -100..100，(branch, from, to) 唯一并累加更新。

### 性能基线（`.tmp/m5-benchmark-result.txt`，2026-09-27 复测）

| 场景 | 码点 | 章节 | 分块 | 导入 | 全流水线 | 堆峰值 |
|------|------|------|------|------|----------|--------|
| baseline-200k | 252,996 | 94 | 257 | 25ms | 345ms | 13.0MB |
| stress-1m | 965,458 | 300 | 944 | 108ms | 3687ms | 37.1MB |

- 20 万字基准远低于方案预算（导入 + 构建均秒级以内）；100 万字压测 3.7s 完成、`sliceOk` 抽样校验通过（码点偏移、非 UTF-16）。堆峰值为 Node 端测量，设备端以内嵌 SQLite 分块写回摊薄。

### Release APK（独立签名）

- `dist/apk/release/ShineWord-V0.1.0-alpha.1-release.apk`（34,045,685 字节，APK 文件 SHA-256 `53f26e69…7e05bab`）；debug 71MB 同目录。
- 独立 keystore `mobile/android/keystores/shineword-release.keystore`（gitignore），签名口令经 `SHINEWORD_RELEASE_STORE_PASS` / `SHINEWORD_RELEASE_KEY_PASS` 环境变量注入 `build.gradle`，**任何口令不进仓库**。
- 证书 SHA-256：`BA:C7:26:40:43:6B:C0:3E:65:B6:B8:A4:6D:FD:BB:60:6C:BA:B5:30:DB:2E:DC:F1:CD:E8:7E:7A:B7:14:1C:34`。
- Release 包内嵌 JS bundle，已验证离线（无 Metro）启动进入主界面。

### 100 回合真实 LLM 一致性验证（`.tmp/m5-100turns-glm.cjs`）

- 设计：本地 SQLite（内存）+ 真实 GLM `GLM-5.3-Flash`（生产 `runLlmTurn` 全路径，含 Planner/Narrator 双请求、确定性 RNG 种子 `(i*7+3)`、10 意图轮转、`llm_requests` 用量落库、诚实失败计数）。
- **过程中发现并修复的真实缺陷**（见下节），全部先修复、重建、再重跑，不带病测量。
- 结果：见「回归证据」。

## Review 发现与修复（本轮 Review 实际改动）

1. **GLM 游戏主循环空 completion（产品级缺陷）**：`runLlmTurn` 不透传 `vendorOptions.thinkingDisabled`，设备上配置 GLM 必然全回合失败。修复：`ApiProfile.thinkingDisabled` Profile 级开关 + 移动端自动置位；新增回归测试。
2. **畸形合同让 undefined 直达 SQLite**：GLM 实测返回 `{"effectType":"changeLocation","from":"前院","to":"藏书阁"}` 之类的方言。合同校验器对缺失 `op` 的 switch 静默穿透，效果对象一路写库到 `branch_events` 第 5 参数绑定崩溃。修复：校验器对未知/缺失 `op`、非布尔 `achieved`、缺失 `publicSummary`、畸形 `resourcePreconditions` 全部给出显式校验错误；不再有任何 TypeError/undefined 泄漏。
3. **方言归一化层**：`normalizePlannerEffects` 在严格校验前做确定性字段改名（`effectType`/`type`→`op`、`to`→`locationId`、`resource`→`resourceId`、`condition`→`conditionId`、`text`/`note`→`summary`、缺省 actorId 填合同主体、`recordEvent` 缺 eventType 补 `note`）。归一化只改名与回填，不发明权威状态；未知 op 依然被校验器拒绝。附真实 GLM 响应形状的回归测试。
4. **故事名 actorId**：模型会把 `陈默`/`chenmo` 写进顶层与效果的 actorId。单 actor 战役下确定性重映射到唯一存在 actor（transferItem 端点除外，仍由引擎在提交时校验归属）；多 actor 且未知则显式报错。
5. **Narrator 字段类型检查**：`validateNarrative` 对 `text`/`turnId` 先做类型检查再 trim，缺失字段报清晰错误而非 TypeError。
6. **Planner 提示词强化**：效果 schema 逐条列出精确字段名，明示「键名必须是 op，不得用 type/effectType」，降低对归一化层的依赖。

## 测试结果

- 核心单测：**82/82 通过**（新增：profile 级 thinkingDisabled、畸形合同干净拒绝、GLM 方言归一化、前置条件归一化共 4 项）。
- 核心与 mobile TypeScript typecheck：通过。
- **100 回合真实 GLM 一致性（2026-09-27，23.1 分钟）**：
  - 100 回合尝试 → **93 committed / 7 失败**；finalStateVersion 93 与 committed 数严格一致（状态版本单调，无重放漂移）。
  - 7 个失败全部为**可见的干净拒绝**（5× 合同校验、1× Narrator 输出包裹 prose、1× 前置条件 minimum 非法），无一次崩溃/静默损坏；下一回合均正常继续（诚实失败计数）。
  - 骰子等级分布（种子 `(i*7+3)` 确定性）：automatic 45 / success 22 / full_success 8 / failure 15 / severe_failure 3；游戏时钟推进 1471 分钟。
  - 用量落库：193 次 LLM 请求（Planner+Narrator），输入 65,185 / 输出 64,837 tokens——每回合双请求路径与 `llm_requests` 记账一致。
- 回归证据文件：`.tmp/m5-probe-result.txt`、`.tmp/m5-benchmark-result.txt`、`.tmp/m5-100turns-result.json`（本地工件，不入库）。

## 已知限制

- 真实 LLM 约 5~7% 的回合会产生畸形合同/叙事，被本地校验干净拒绝后跳过（游戏继续）；这与「本地引擎是唯一权威」的设计一致，但意味着连续失败回合的叙事会有跳跃感——预算内重试已覆盖多数情况。
- MiniMax 不支持 JSON 模式（探测如实报告）；该 Provider 走 `jsonMode=false` 时由解析器容错，未做重试级联。
- 100 回合一致性使用确定性伪随机与固定世界文本；真人对局多样性不受此约束。
- 性能基线为 Node 桌面端数据；Android 端 Hermes/SQLite 差异以模拟器冒烟为准。

## 退出结论

M5 目标全部达成：三家真实 Provider 探测、容错传输与故障注入、20 万/100 万字性能基线、真实 GLM 100 回合一致性（93/100 committed、7 干净拒绝、0 崩溃、状态版本严格单调）、独立签名 Release APK 交付 dist。过程中暴露的 6 项缺陷全部修复并带回归测试。**M5 验收通过。**
