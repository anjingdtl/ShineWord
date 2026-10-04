# Phase 8 验收与收尾报告

日期：2026-10-04。最终源码：`main@ab2be05`（后续文档 commit 见 git log）。应用 V0.8.0 / versionCode 80000。

## 当前结论

**第八阶段施工与验收完成。** 894 项核心测试全绿；移动端类型检查、版本一致性、debug APK 构建、设备安装与真实回合全链路通过。验收矩阵 32+2 PASS / 1 部分 / 2 NOT RUN / 0 FAIL（明细见 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md) 与 [FINAL_REPORT.md](FINAL_REPORT.md) §3/§7）。

开发期单协议政策已落地：`shineword-core@0.3.0`、ActionContract 2.0、save-9（save-2..8 逐版本拒绝）、story-memory 观察协议、迁移 33。无旧规则适配器、无旧存档转换、无双轨运行时、无 legacy 全量上下文回退。

## 真实模型与设备证据

- 真实 GLM（GLM-5.3-Flash，授权 coding 端点，测试配置窗口 128K/输出 8192）：三组合旅程合计约 175 次物理 HTTP，全部入 `llm_request_attempts` 账本；fantasy 的 sent→outcome_unknown→人工批准→租约过期接管→重放成功是 A16/A17/A18 的完整真实链；daily 的修复轮两连拒绝→failed→dirty 重建是诚实失败样本。密钥未输出；私有脚本与旅程数据库在忽略目录 `.tmp/`。
- 累积规模（本地确定性）：100/300/1000 回合单分支连续累积，handoff 覆盖 100%，下一回合分页读取 1000 回合 3ms。
- 设备（emulator-5554，Medium_Phone，API 37.1）：安装 `ShineWord-V0.8.0-debug.apk`（SHA-256 `8ed7afe30b3ba6a354ebf6c4f0f9208d41ceff611e23ba0cf42b1379c17f8818`）。验证：启动无崩溃；强停+冷启动恢复；增量迁移至 33 且 P7 项目数据与记忆保留；真实设备回合 turn-0018（camp-mutegp5i）的 Planner/Narrator/记忆批次 v9-17 全部 succeeded，冻结根与 outbox handoff（episodic_indexed=1）落库；p7-novel-excerpt 项目新回合 turn-0018 同样留下冻结根+pending handoff。

## 施工中修复的真实缺陷（旅程/设备发现）

| 缺陷 | 修复 |
|---|---|
| 协调器 claim 后携带旧 fencing token，条件终结更新永远失败，handoff 卡 'running' | claim 后 re-read 携带新 token（fd0b7b2） |
| 无 provider 时早退判定用索引后集合，最旧 8 行永久空转 | claim 排序优先未索引行 + `episodic_indexed` 旗标 + claim 时判定早退（ab2be05） |
| 双重 LedgeredProvider 包装导致同逻辑请求双重记账 | 驱动层传裸 provider，session 统一包装一次 |

## 开放项（不冒充完成）

1. **A34/A36 设备 UI 走查**：旧开发库的"开发重置"引导页与故障后 UI 呈现未单独走查（检测函数与账本-DB 对照证据已具备）。
2. **A10 恢复路径请求快照逐项比较**：共享规划内核同源已证，端到端用例未单列。
3. **小说自动映射质量评分**：本期结论为"人工配置组合通过"；整本小说自动映射未评分。
4. **真机**：NOT RUN。
5. 设备上的 P7 旧项目经增量结构迁移可打开（0.2.0 语义数据原样保留，不转换为新规则项目）；新协议战役应通过新建项目开始。

## 证据索引

- 协议与所有权：[PROTOCOL_BASELINE.md](PROTOCOL_BASELINE.md)
- 施工与检查记录：[IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md)
- 验收明细：[ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md)
- 最终报告（费用/规模/身份）：[FINAL_REPORT.md](FINAL_REPORT.md)
- 私有旅程资产：`.tmp/p8-real-journey.cjs`、`.tmp/p8-journey-{suspense,fantasy,daily}.sqlite`（不入库）
