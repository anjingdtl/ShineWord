# 阶段 9.5 验收矩阵 — closeout 2026-10-14

状态只针对本轮身份。历史 PASS 不自动带入；NOT RUN 不是代码缺陷结论。部分子项有证据时仍不把完整合同写成 PASS。

身份：HEAD `08b64522939b2fd84b5cb2762296538ad70b5ef3`；productionSourcesHash `2f5466b929111b31ee4b84c37ee4b9935619893f9144b0888f40d92fa59cb6a7`；Debug APK `5c17b33106c70a290fb60603ea4af5d44f63fc0486705400fb0f680a4b192d9a`（109,969,071 字节，设备端 base.apk 哈希一致）。

## G 门禁

| 门禁 | 状态 | 当前依据 |
|---|---|---|
| G0 身份、设备、预算 | PASS | 本轮重建：源码/APK/设备哈希三方一致；账本 1291/1500、审计行 0、无重置无增额；全新安装无 unknown 待对账。 |
| G1 安全 L1 竖切 | PARTIAL | 既有固定 policy/evidence 夹具 Planner=0 仍绿（1311 项内）；本轮未新增 Android 真实 L1 派发。 |
| G2 投影与对抗可玩性 | PARTIAL | **根因 #2 已修**：stranded 后果有明确 cancel 处置，`discharged` 语义补齐，玩家视图不再许诺永不可兑现的后果。但三路汇合与两条真实消费链仍无真实旅程证据。 |
| G3 M3 局部生成 | N/A — NOT NEEDED | M3 双启动条件不成立，本轮不发实验请求。 |
| G4 Android 集成/质量/试玩 | PARTIAL | 全新安装→配置→冷启动→数据保留全链通过；匹配性能、第二题材、独立真人试玩未做。 |

## V95

| 项 | 状态 | 证据与边界 |
|---|---|---|
| V95-01 单一生产状态权威 | PASS（代码/测试） | CampaignSession/settlement 写入路径；未另建 Graph 状态副本。 |
| V95-02 缺绑定安全分流 | PASS（代码/测试+UI） | 缺难度/证据的旧方法保留 L2 路径。 |
| V95-03 合格 L1 Planner=0 | PARTIAL | 固定夹具 Planner=0；Android 真实 L1 派发与 eligibility 分布未测。 |
| V95-04 四档等价 | PASS（确定性） | 生产确定性路径四档回归通过；不声称自然随机旅程复现相同骰流。 |
| V95-05 重入/竞争/崩溃/unknown | NOT RUN | 未对最终 APK 完整注入；历史 unknown 未重发。 |
| V95-06 投影只读可重算 | PASS（代码/测试） | 投影回归通过；无 UI 刷新派发或新增状态 authority。 |
| V95-07 分支汇合与两条后果消费 | PARTIAL | **生命周期缺口已补**（discharge/cancel + 事件可审计）；但真实三路汇合与下游消费仍缺真实旅程证据，不判 PASS。 |
| V95-08 三意图 canon/隐私隔离 | NOT RUN | 未做完整三意图未来信息审核。 |
| V95-09 供给恢复与防空转 | PARTIAL | stranded 供给不再挂起；真实 R69 后继采用/使用闭环未跑。 |
| V95-10 save-10/冷启动/绑定隔离 | PASS | 两个 J4 存档通过生产校验；全新安装冷启动成功；`install -r` 保留数据复验通过。 |
| V95-11 M3 条件评估 | N/A — NOT NEEDED | 无反复供给失败证据。 |
| V95-12 独立真人四问/六维评分 | BLOCKED-EXTERNAL-HUMAN | 需未参与施工的真人试玩者。 |

## 本轮修复的生产缺陷（ROOT_CAUSE_AUDIT §2）

| 项 | 状态 | 证据 |
|---|---|---|
| 后果生命周期 `discharged` 从未被赋值 | **已修** | 新增 `consequenceLifecycle.ts` + settlement 接线；新测试 6/6；core 1311/1311。 |
| 悬空 pending 后果无处置路径 | **已修** | `dischargeStrandedConsequences` → `cancelled` + `cancelReason`，不改写历史。 |

## 阶段 9 A01–A40（历史合同，不并入 9.5 判定）

阶段 9 矩阵沿用上一轮结论，本轮未新增 A 项真实旅程证据；A19 因生命周期缺口修复而具备可处置前提，但两条后果的真实触发与消费仍未执行，仍记 NOT RUN/FALSE-未证。详见上一轮 `rootcause-fix-2026-10-13/ACCEPTANCE_MATRIX.md`。

阶段 9.5 总判定：**代码与确定性合同 PASS；真实旅程与外部项待办**。详见 FINAL_REPORT.md。