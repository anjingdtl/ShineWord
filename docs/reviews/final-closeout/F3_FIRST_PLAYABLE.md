# F3 — Progressive 首次真实可玩闭环

**阶段：** F3（Progressive 快速开局：真实 TXT → OpeningDossier → publish → Opening → 角色 → Campaign → Play → 第一回合）
**分支：** `feature/final-acceptance-closeout`
**日期：** 2026-09-29（Asia/Shanghai）
**结论：** **BLOCKED（外部端点）** —— 本轮只完成诊断加固（代码），真实端点闭环无法在本沙箱内取得证据。

## 0. 结论先行

| 验收项 | 本轮结论 |
|---|---|
| F3.1 脱敏诊断（区分失败阶段） | **PASS（代码级）** —— 新增分阶段 `errorCode`，单测覆盖 |
| F3.2 模型输出鲁棒性（按证据收紧） | **PARTIAL** —— 未定位到唯一的真实失败字段前不收紧 schema，避免误伤 |
| F3.3 真实 TXT → 第一回合 | **BLOCKED** —— 无可用端点配置 + 无 Android 设备 |
| F3.4 TTFP 精确计时 | **NOT TESTED** —— 依赖 F3.3 |
| F3.5 性能门禁（median ≤60s / P95 ≤120s） | **NOT MEASURED** —— 不满足样本要求，不得判定达标 |

> 在取得「第一回合 committed」之前，不得声明快速开局完成。本轮据此保持 BLOCKED。

## 1. 已知真实阻断（历史基线，非本轮新证据）

来自 [G1.md](../progressive-opening/G1.md) 与 [FINAL_AUDIT.md](../progressive-opening/FINAL_AUDIT.md)：

- **一次可行 dossier**：`glm-5.3` 8,000 输出上限，2 次物理请求、88.281 秒、4/4 引文逐字命中。→ 证明端点**有能力**产出合法 dossier，但**提取本身已超 60 秒**。
- **v15 Release 真实路径**：TXT 导入成功 → 准备好 8,000 码点的 opening 请求 → 端点返回**不可发布结果** → 未进入 Opening / 角色创建。
- **取证受限**：production-signed APK 不允许 `run-as`，其本地安全指标无法从数据库导出；无 response / source / key / DB 被导出。

本轮沙箱**无设备、无端点**（见 [F0_BASELINE.md](F0_BASELINE.md#5-设备与模型可用性)），因此无法在沙箱内复现或关闭该阻断。

## 2. F3.1 诊断加固（本轮实现）

### 2.1 缺口

原 `OpeningPreparationError.category` 只有粗粒度四类（`provider_failure` / `profile_budget` / `empty_completion` / `invalid_dossier` / `package_validation`），无法区分「是 JSON 解析失败、schema 不合法、引文不命中、引用闭包失败，还是发布校验失败」——而这正是 Release 失败时最需要的信息。

### 2.2 实现

[progressiveOpening.ts](file:///workspace/src/application/worldPackage/progressiveOpening.ts#L57-L90) 新增 `OpeningFailureDetail` 与 `errorCode`：

- 阶段标签：`json_parse` / `schema` / `citation` / `reference_closure` / `compile` / `publish`。
- 校验点拆分：
  - strict JSON 解析失败 → `json_parse`
  - 结构性字段缺失（location/setting/situation/goal 及其 quote） → `schema`
  - 引文未在开篇首场景逐字命中 / 地点名不在引文中 → `citation`
  - 引文可定位但无章节覆盖（span 闭包失败） → `reference_closure`
  - 发布校验失败 → `publish`
- [sourceImport.ts](file:///workspace/mobile/src/sourceImport.ts) 落库改用 `error.errorCode`，使设备端 safe metrics 能携带阶段标签。

**红线遵守**：detail 仅是一个静态阶段常量，**不携带任何模型输出 / 原文 / prompt / key**；失败文本仍在内存中丢弃、不落库、不记录。

### 2.3 单测

[progressive-opening.test.cjs](file:///workspace/tests/progressive-opening.test.cjs) 新增用例 `opening preparation failures expose a desensitized stage code for each failing gate`，逐一断言：

- 非 JSON → `invalid_dossier:json_parse`
- 缺 `initialGoal` → `invalid_dossier:schema`
- 引文不在原文 → `invalid_dossier:citation`
- 引文命中但章节不覆盖 → `invalid_dossier:reference_closure`

结果：`tests 10 / pass 10 / fail 0`（含该用例）。

## 3. F3.2 模型输出鲁棒性

**本轮不收紧 schema。** 理由：捕获到 4 类新阶段中，唯一在真实 Release 出现的是「不可发布结果」，但**其精确阶段标签在旧 v15 构建中不存在**，本轮无法回填。在没有真实失败字段前放宽/收紧 schema、数组上限或 maxOutputTokens，属于「无证据调参」，违反「只在定位出真实问题后修复」。

允许且已保持不变的约束（回归守护）：正常路径 1 主请求 + 最多 1 次修复请求 = 最多 2 次物理请求；不关闭推理；不跳过 publish validator；不放宽 citation 校验。相关断言见 [progressive-opening.test.cjs](file:///workspace/tests/progressive-opening.test.cjs)（`calls === 1`、修复路径 `calls === 2`、`vendorOptions === undefined`）。

## 4. F3.3 真实 TXT → 第一回合

目标链路（成功标准，缺一不可）：

```
选择 TXT → 流式本地导入 → 建索引 → Opening Dossier → citation validate
→ compile opening package → publish partial package → Opening 4 Steps
→ 创建原创角色 → 创建 Campaign → Play → 第一行动 → Planner → 本地规则
→ Narrator → Turn committed
```

**本轮状态：BLOCKED。** 未到达任何一步真实设备执行，因此**没有** `Turn committed`，不得称 First Playable。

## 5. F3.4 TTFP 计时

模板已定义（T0–T9：确认 TXT / 本地导入完成 / opening 输入就绪 / LLM 请求 1 / repair / compile / publish / Opening UI / campaign 创建 / 首回合 committed），并区分 machine TTFP 与 interactive TTFP。**本轮无数据**，不填写任何推测值。

## 6. F3.5 性能门禁

- 目标：median ≤ 60s、P95 ≤ 120s。
- **未测量**：不得从 1 次请求推导 median/P95。历史唯一可行 dossier 提取 88.281s 已超目标，但这只是 1 个样本，不构成 median/P95 结论。

## 7. 为关闭本阻断所需的外部条件

1. **可用端点配置**：一个在 8,000 输出预算下能稳定返回合法 dossier 的模型 Profile（当前 `glm-5.3` 8k 曾成功一次但因时延/超时不稳定）。
2. **可取证设备**：允许 `run-as` 的 debug/可调试 Release，或可导出脱敏 safe metrics 的环境，以便把失败落到具体 `errorCode` 阶段。
3. **真实 TXT**：允许本地测试、禁止入库的小说文件（沙箱内不可用）。

一旦具备，本轮新增的 `errorCode` 将直接把失败归因到 `json_parse` / `schema` / `citation` / `reference_closure` / `publish` 之一，从而指导 F3.2 的**有证据**收紧。

## 8. 工程状态口径

- **Progressive Engineering Ready / First Playable Acceptance Blocked。**
- 代码与回归（含新诊断）就绪；真实闭环与 TTFP 因外部端点与设备缺失保持 BLOCKED / NOT TESTED。
- 对应版本策略：**情况 B**（不升级 Alpha）。见 [FINAL_REPORT.md](FINAL_REPORT.md)。