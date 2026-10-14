# 测试报告 — 阶段 9.5 收尾 2026-10-14

本报告只记录**本轮实跑**的门禁与证据。历史 PASS 不自动带入；未跑的项目如实标注 NOT RUN，不以推断代替执行。

## 1. 测试身份

| 项 | 值 |
|---|---|
| 仓库 | `E:\AiWorkSpace\ShineWord`，分支 main |
| HEAD | `08b64522939b2fd84b5cb2762296538ad70b5ef3` |
| productionSourcesHash（修复后） | `2f5466b929111b31ee4b84c37ee4b9935619893f9144b0888f40d92fa59cb6a7` |
| Debug APK（修复后） | `5c17b33106c70a290fb60603ea4af5d44f63fc0486705400fb0f680a4b192d9a`，109,969,071 字节 |
| 设备 | `emulator-5556` / API 37 / ShineQA；包 `com.shineword.app` 1.0.0 (1000000) |

设备侧 `base.apk` SHA-256 与本机构建产物逐字节一致（`adb shell sha256sum` 核对通过）。

## 2. 工程硬门（全部实跑）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 核心类型 + 测试 | `npm run verify:core` | **PASS — 1311/1311** |
| 版本一致性 | `npm run verify:version` | PASS — version=1.0.0 versionCode=1000000 |
| 移动端类型 | `npm --prefix mobile run typecheck` | PASS（`tsc --noEmit` 无输出） |
| 构建 | `npm run apk:debug` | PASS — BUILD SUCCESSFUL |
| 差异空白 | `git diff --check` | PASS（仅 LF/CRLF 提示，无空白错误） |

修复前核心基线为 1305/1305，修复后 1311/1311，新增 6 条生命周期合同测试。

## 3. 本轮修复的生产缺陷与验证

### 缺陷

ROOT_CAUSE_AUDIT §2 指出：延迟后果协议声明 `pending/triggered/discharged/cancelled` 四态，但生产代码**只赋值过 `pending` 与 `triggered`**；`discharged` 在整个 `src/` 中仅出现于类型声明（`types.ts:165`）。后果：

1. 悬空 pending 后果永久滞留，冒充"未来可消费内容"，且无任何审计处置路径。
2. 已应用后果永远停留在 `triggered`，运行时无法区分"待应用"与"已应用"。

### 修复

新增 `src/domain/campaignPlan/consequenceLifecycle.ts`，并在 `settlement.ts` 接线：

- `dischargeAppliedConsequences`：效果实际应用后置 `discharged`，发出 `campaign_consequence_discharged` 事件。
- `dischargeStrandedConsequences`：触发节点已退役、永不可达的 pending 置 `cancelled` + `cancelReason='trigger_node_retired'`，发出 `campaign_consequence_cancelled` 事件；**不改写 triggerCondition 与 description**。
- 可达性判定为三值：非节点事实（计数器/承诺/关系/人物）一律视为"仍可能"，未知绝不当作 false。

### 修复过程中暴露的更深语义

`settlement.ts:172` 的 `appliedConsequences` 由 `status === 'triggered'` **反推**已应用集合，说明 `triggered` 状态同时承载"刚触发"与"已应用"两种含义。`discharged` 将该隐含契约显式化。这是 6 处既有测试断言 `triggered` 的真实原因，属生产语义收敛，而非测试写错。

### 测试调整（6 处 stale 断言 → 更强断言）

| 文件 | 变更 |
|---|---|
| `tests/phase9-turns.test.cjs` | `triggered` → `discharged`（同一次提交内触发并应用） |
| `tests/phase9-settlement-closure.test.cjs` | 4 条/6 条计数由 `triggered` 改为 `discharged` |
| `tests/phase9-adoption-settlement.test.cjs` | 断言文案「triggered means effects were applied」→「discharged means effects were applied」 |
| `tests/phase9-closeout.test.cjs` | `triggered` → `discharged` |
| `tests/phase9-flow.test.cjs` | `triggered` → `discharged` |
| `tests/phase9-5-opportunity-projection.test.cjs` | `triggered` → `discharged` |

**未修改**：`tests/phase9-domain.test.cjs:411` 为纯 reducer 单测，settlement 不参与，`triggered` 是正确断言，保留原样。

### 针对性验证

| 验证 | 结果 |
|---|---|
| 新增 `tests/phase9-5-consequence-lifecycle.test.cjs` | **6/6 PASS** |
| 以审计报告中的真实 orphan ID（`consequence-roland-tacit`、`consequence-route-verified`，等待已 superseded 的 stage-3/stage-4）验证 | 正确识别并 cancel，trigger 条件原样保留 |
| 可达路径不被误伤 | `stage-5 succeeded` 型 pending 保持 pending，不被 discharge |
| 非节点条件不被误判 | `situation_counter_at_least` 型 pending 视为仍可能 |
| 玩家视图不再许诺永不可兑现的后果 | `session.ts:400` 按 `pending` 过滤，cancel 后该条目从玩家视图消失 |
| replan 新造悬空仍被拒绝 | `newlyOrphanedPendingConsequences` 行为未变 |

## 4. 设备端集成验证

| 步骤 | 结果 |
|---|---|
| 安装 | 全新安装（经用户授权卸载早于战役系统的 v0.4.1），v1.0.0/1000000，run-as 可用 |
| 修复后重装 | `adb install -r` **保留数据成功** |
| 冷启动 | 冷启动成功，profile 未丢失，未回落到首启页 |
| 配置链路 | 端点/模型/思考强度（high）/Keychain 密钥全部写入并持久化 |
| 真实连通性 | app 内「测试连接」→ **✓ 连接成功，模型返回正常（4094 ms）**，模型 `glm-5.3-flash` |

存档校验：工作树内 `journey-J4AR68C` / `journey-J4BR68C` 两个存档**通过生产 `shineword-save-10` 校验**（`validateSaveJson(json, sha256Hex)`，注意为 async 且必须传入 sha256Hex 实现）。

## 5. 预算账本

- 合同账本 `.tmp/phase9/test-manifest.json`：**1291/1500，审计行 0**，本轮无重置、无增额。
- `tools/phase9-budget.cjs` 的 `HARD_STOP = 1450` 为真实上限 → **剩余 159 次**（非 1500 的名义 209）。
- 该工具默认账本路径 `.tmp/phase9/local-20261014/test-manifest.json` **不存在**，须显式传 `filePath: '.tmp/phase9/test-manifest.json'`。
- 本轮新建 scoped 账本 `.tmp/phase9/closeout-20261014/scoped-budget.json`：`scopeId=phase95-closeout-20261014`，cap=159，**从 0 起记**，未继承丢失机器的 510/600。

**本轮真实物理模型请求数：0。**「测试连接」为连通性预检，不产生战役请求，设备端 `llm_request_attempts` 为 0 行。

## 6. 设备端账本对账（A4）

全新安装，`llm_requests` 与 `llm_request_attempts` 均 **0 行**，无 `outcome_unknown` 需要对账。历史 unknown 属于丢失机器，本机不存在。设备 DB SHA-256：`a226dbb2e3f098d7882d0a56bd201cc088a01d27f27c9bb1edd5cee47e939eb1`。

## 7. NOT RUN（本轮未执行，如实登记）

以下项目均需要真实模型请求，本轮因预算代理的 profile 指纹绑定尚未完成验证而未执行，**不以推断代替**：

- 阶段 B1 stage-8 精确收尾回放（正式 UI 执行）
- 阶段 B2 两条悬空后果的真实触发与下游消费
- 供给恢复闭环（V95-09）、自然成功收尾与连续失败恢复（A15）、完整掷骰结算（A28）
- 20 动作稳定窗口、80 个有效 UI 决定账本
- 三路分支汇合与两条消费链、匹配性能 baseline10/final10、第二题材受控样本
- V95-12 / A36 独立真人四问六维（需外部真人）
- 远端 CI 状态读取（401）

## 8. 结论

**本轮测试结论：修复通过全部工程硬门；真实旅程未执行。**

代码与确定性合同层面 PASS；真实旅程与外部依赖项待办。详见 [FINAL_REPORT.md](FINAL_REPORT.md) 与 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md)。