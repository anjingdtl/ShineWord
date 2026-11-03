# LLM_REPORT — V1.1.1 Final Closeout

## 预算账本总表

| 账本 | 用途 | 花费/上限 | 状态 |
|---|---|---|---|
| final-closeout-v111 | 初始 MiniMax wire 捕获 + host nvwang 抽取 | 28/30 | 已冻结（MiniMax 欠费） |
| final-closeout-v111-ext1 | nvwang 映射循环（MiniMax→GLM 切换） | 30/30 | 已冻结 |
| final-closeout-v111-ext2 | nvwang GLM 映射 → synthetic 切换 | 30/30 | 已冻结 |
| final-closeout-v111-ext3 | synthetic host 映射循环 | 14+/30 | 进行中 |
| final-closeout-v111-dev2 | 设备 nvwang + synthetic 构建（修复前） | 30/30 | 已冻结 |
| final-closeout-v111-dev3 | 设备 synthetic 构建（修复后） | 6+/30 | 进行中 |

**合计**：~140+ 付费请求。含 MiniMax 欠费切换损耗与 GLM 流中断 unknown 重试。

## 供应商切换记录

| 时点 | 从 | 到 | 原因 |
|---|---|---|---|
| 2026-11-02 | MiniMax-M3.1-Flash | GLM-5.3-Flash | MiniMax 账户额度耗尽（用户确认） |

## 真实模型测试记录

### 1. 抽取（world_extract）

| 数据 | 结果 | 证据 |
|---|---|---|
| nvwang 真实小说（放开那个女巫 GBK 7.18MB） | 设备 rev1+rev2 **已发布** ✓；host 抽取完成，映射进行中 | 设备 DB `world_packages` + wire 捕获 `captures/extract-*.txt` |
| synthetic-novel 合成夹具（13k cp） | host+device 均完成抽取 | dev3/ext3 账本 |

### 2. 供应商 JSON 畸形（MiniMax-M3.1-Flash）

| 发现 | 证据 | 修复 |
|---|---|---|
| 键名闭引号丢失 `"quote:"v"` | `captures/extract-01-response-wire.txt` pos 17616 | `repairDroppedKeyClosingQuote`（白名单） |
| 嵌套对象丢右括号 → evidenceQuotes 错位 | `captures/extract-02-response-wire.txt` 4 处 | `scanMissingClosingBraces` + `evidenceRefsFromCandidate` |
| GLM-5.3-Flash 不产生上述畸形 | `captures/extract-01/02-response-wire.txt` 对照 | N/A |

### 3. 映射（world_mapping）

| 发现 | 影响 | 状态 |
|---|---|---|
| GLM 映射输出不足 → 预算提升重试循环 | host 合成发布迟迟不能完成映射 | 已知限制：GLM 映射输出对某些内容集不够稠密，自动拆批/提额重试需要多轮 |
| GLM 映射流中断 → outcome_unknown | 每次需人工确认后重试（产品安全设计 ✓） | 已知限制 |

### 4. 叙事（Narrator）与规划（Planner）

| 场景 | 结果 |
|---|---|
| 设备端 Narrator（GLM 高档，世界抽取后回合） | 成功（dev2 25/30 前的 nvwang 设备回合） |
| host 端 Narrator（GLM） | 成功（syn2 抽取后真实回合 dev3 提交——参考 convergence journey 模式） |
| 设备端 Planner | 成功（dev3 路由矩阵场景） |

## 密钥安全

- 所有请求通过 QA 代理（tools/phase9-device-proxy.cjs）或 host 驱动（tools/final-closeout-*.cjs）
- 密钥仅通过一次性桥（tools/phase9-secret-bridge.cjs）写入 Android Keychain
- 密钥未入库、未入日志、未入报告
- 代理/驱动日志不含密钥或请求正文
