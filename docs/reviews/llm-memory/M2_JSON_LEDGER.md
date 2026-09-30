# M2 Review — JSON Resilience Layer + Durable Physical Request Ledger

> 阶段：M2
> 基线：`ef51917`（M1）

## 1. JSON Resilience Layer

### 交付物

| 文件 | 内容 |
|---|---|
| `src/application/llm/responseNormalizer.ts` | reasoning wrapper 剥离（`<think>/<thinking>/<reasoning>`）、markdown fence、**平衡 JSON 提取**（字符串/转义感知，替代 indexOf/lastIndexOf）、字符串外尾逗号修复、≤2 层双重编码解包、字段别名（canonical 缺失才提升，绝不覆盖）、枚举别名（白名单按字段）、截断检测 |
| `src/application/llm/structuredOutput.ts` | `parseStructuredOutput()` 管线：direct → fence → balanced 候选逐个尝试 parse+repair+decode+alias → 可选 validator；失败分类 `no_json_found / json_invalid / json_truncated / schema_invalid`（截断≠格式差，plan §76） |

### 宽进严验边界（plan §77）

- 管线只做 transport/syntax/known-alias 归一；
- `assertValidActionContract` / `assertValidPlannerProposal` / `validateNarrative` 仍在原位置原强度执行（V1 在 actor 归一之后，V2 在 repair 环节）；
- **不自动补** actorId / stateVersion / skillId / difficulty / outcomes / 数值 / location；
- 内部持久化 JSON（persisted ActionContract、staged turns）继续走 `parseStrictJsonObject()` 严格解析（plan §95）。

### 已接入

- V1 Planner/Narrator（`llmTurn.ts`）、V2 Planner/Narrator（`v2Turn.ts`）、Summarizer（`summarizer.ts`，替换了手写 `extractJson` 首尾大括号截取）。
- Planner 别名白名单：`type→op`、`effectType→op`、`to→locationId`、`resource→resourceId`、`condition→conditionId`。
- 枚举别名：**空**——按 plan §47 只录入真实 Provider 观察确认的映射，本阶段无观察记录，故不预置（测试用显式白名单验证机制）。
- World Extract/Mapping 未接入（按 plan §94 逐步来，M6 统一）。

### 测试（`tests/llm-json-ledger.test.cjs` JSON 部分，21 用例）

严格 JSON / prose 包装 / ```json fence / 无标签 fence / 尾逗号（字符串内不误修）/ 字符串内 `{}`、`,}` / 转义引号 / 嵌套 object / 嵌套 array / 双重编码 / 三重编码拒绝 / type→op / effectType→op / 别名不覆盖 canonical / 枚举别名 / 前置无关 JSON / 尾部无关文字 / 截断分类 / 无 JSON / 缺必填字段（schema_invalid）/ 恶意额外字段直达 validator / reasoning wrapper 剥离 —— **全部通过**。

## 2. Durable Physical Request Ledger

### 交付物

| 文件 | 内容 |
|---|---|
| `src/application/ports/llmLedger.ts` | 端口：attempt 记录、六态生命周期、`LlmFailureClass` 16 类 |
| `src/application/llm/requestLedger.ts` | `LedgeredProvider`（prepared→sent 持久化先于 HTTP；成功记 usage/providerRequestId；失败记 failure_class/http_status）；`classifyLlmFailure()`；`recoverInterruptedAttempts()` 冷启动清扫；`OutcomeUnknownReplayError` 重发阻断 |
| `src/infra/sqlite/sqliteLlmLedgerStore.ts` | SQLite 实现；attempt_id=`<logical>#a<N>`，attempt_no 递增 |
| migration **19** `llm_request_ledger` | `llm_request_attempts` 表 + logical/status 双索引 |

### 关键规则落地

- **LlmRequest.ledger 元数据**：v1/v2 Planner（`planner:<branch>:<turnId>`）、Narrator（`narrator:<branch>:<turnId>`）、Summarizer（`summarizer:<branch>:<from>-<to>`）已携带；无元数据请求（世界构建）透传不落账（下阶段迁移）。
- **CampaignSession**：`deps.llmLedger` 存在时自动用 `LedgeredProvider` 包装（mobile `runtime.ts` 已接线）；provider 字段类型放宽为 `LlmProvider`。
- **冷启动恢复**：`mobile/src/database.ts` 初始化即执行 `recoverInterruptedAttempts()`——prepared/sent 残留 → `outcome_unknown`（errorCode=interrupted_by_process_exit），并 `console.warn` 数量。
- **outcome_unknown 禁自动重发**：同 logical id 再来请求 → `OutcomeUnknownReplayError`（含中文可操作提示）；`allowOutcomeUnknownReplay` 仅作显式操作员逃生门。
- reasoning_only 物理重试在 Provider 内部进行（bounded ×2），账本按一次业务 dispatch 记一行，usage 以最终响应为准。

### 测试（ledger 部分，7 用例）

prepared→sent→succeeded（含 usage 四列/providerRequestId/attempt_no/branch/stateVersion 落库）/ sent→failed（http_server+500）/ 重试 attempt_no 递增且同 logical / 崩溃→outcome_unknown→重放被阻断（不产生新 attempt）/ 操作员逃生门 / 无元数据透传 / migration 19 建表 —— **全部通过**。

## 3. 门禁

- `npm run verify:core`：**347/347 PASS**（320 + 27 新增）
- `npm run typecheck --prefix mobile`：PASS
- `git diff --check`：PASS

## 4. 遗留（转后续阶段）

1. World build 物理请求（extract/mapping/adjudication/probe）进统一 ledger —— M6。
2. Ledger 行与 `onPhysicalRequest` 逐物理 attempt 指标的合并视图（成本审计 UI）—— M6 调试面板。
3. 枚举别名观察记录机制（真实 GLM 观察后入白名单）—— M6 实测时补。
