# Phase 8 最终报告

| 项目 | 内容 |
|---|---|
| 报告日期 | 2026-10-04 |
| 施工范围 | P8-0 ～ P8-10（方案 `docs/Shine-TRPG_PHASE8_CONSTRUCTION_PLAN.md` v1.0） |
| 最终源码 revision | `main@ab2be05`（历史身份见 git log；本文所有结论以本 revision 为准） |
| 应用版本 | V0.8.0 / versionCode 80000（`npm run verify:version` PASS） |
| 测试规模 | 894 项测试全部通过、0 跳过（`npm run verify:core`） |
| 移动端 | `npm --prefix mobile run typecheck` PASS；debug APK 构建成功（见 §6） |
| 单协议 | `shineword-core@0.3.0`、ActionContract 2.0、save-9、story-memory 观察协议、迁移 33；旧输入逐版本拒绝 |

## 1. 交付总结

第八阶段按方案 P8-0～P8-10 顺序完成施工，每包通过门禁后独立提交（13 个范围清晰的本地 commit，未 push）：

| 施工包 | Commit | 交付 |
|---|---|---|
| P8-0 | 4f289a3 | 协议登记冻结（PROTOCOL_BASELINE.md）、所有权登记、六类缺口回归（开工 RED 即门禁证据） |
| P8-1 | 9eac725 | turn-material-1 类型化材料、判别式检查点资格、Pending Bridge、分页读取（G1/G2 转绿） |
| P8-2 | 8b20ccc | 删除 legacy 全量回退、零发送预算政策、最终 wire 门、记忆逐实体 compact（B05/B07/T06） |
| P8-3 | 9154af9 | 持久化冻结根 + 损坏显式失败（G3 转绿，T01/I05）、迁移 33、请求身份关联结构 |
| P8-4 | bb6811c | commit+outbox 唯一提交边界（G4 转绿）、分支串行协调器、记忆 CAS（G5 转绿，B08/I02/I09） |
| P8-5 | 8536575 | 观察编译器+known-change 门（G6 转绿，T11/A23）、证据时间推导（B10）、原子批次应用（B09）、fork 仅 applied（B15） |
| P8-6 | 951a147 | 机制注册表、world-rule-config-1、能力闭包（B12/B13）、core 0.3.0/合同 2.0、V1 链删除 |
| P8-7 | ace6693 | pressure_track 新模块（A28）、三题材配置（A27）、规则预览 |
| P8-8 | 68474f7 | save-9 单协议（A33）、记忆/覆盖随档往返零 LLM（A32）、fork 仅 applied 重放（A31）、数据库基线与旧库拒绝（A34） |
| P8-9 | 71ab575 + fd0b7b2 + ab2be05 | 100/300/1000 累积旅程（A25）、真实 GLM 三组合旅程、协调器两处真实缺陷修复 |
| P8-10 | d5b7b80 + 本报告 | 版本 0.8.0/80000、CHANGELOG、验收矩阵闭合 |

## 2. 六类缺口回归（开工 RED → 终态全绿）

| 编号 | 开工证据（RED） | 终态 | 关闭 commit |
|---|---|---|---|
| G1 当前局面漏装 | `candidatesFromParts` 静默丢弃 `【当前局面】` | 类型化收集器：mapped 或诊断，永不静默 | 9eac725 |
| G2 未来记忆 | ahead 检查点 body 可进入上下文 | `future_evidence` 等五类判别拒绝，不暴露 body | 9eac725 |
| G3 冻结损坏 | 无持久化冻结 | 损坏 JSON/hash 显式失败、保留信封、零 LLM | 9154af9 |
| G4 outbox 回滚 | 无 outbox、提交后处理分离 | outbox 同事务、故障注入整笔回滚 | bb6811c |
| G5 CAS 覆盖 | 裸 UPSERT 可被旧 worker 覆盖 | `saveStateCas` 指纹 CAS 拒绝 | bb6811c |
| G6 空观察 | 空观察推进 clean | known-change 门：缺失即修复/blocked | 8536575 |

## 3. 验收矩阵结论（A01–A36）

详细证据见 `ACCEPTANCE_MATRIX.md`。汇总：

- **PASS（32 项）**：A01–A08、A11–A33（其中 A05/A15/A16/A17/A18 含真实设备/真实 API 证据，A25 含 100/300/1000 规模证据）。
- **部分通过（1 项）**：A10 — Preview 与 Send 同源由共享 `planLlmRequest` 保证（既有 llm-budget-preview 契约测试保持通过）；但"恢复路径逐项比较请求快照"的端到端用例未单列，由 A13/A32 的恢复证据部分覆盖。
- **NOT RUN（3 项）**：
  - A34（设备侧旧库提示 UI）：`detectLegacyDevelopmentDatabase` 有单元证据（phase8-p8-8），但设备 UI 提示流程未单独走查（移动 UI 未接提示入口，见 §5 开放项）。
  - A35（移动端 composition root 同组合验证）：mobile `database.ts` 已接线 SqliteStoryMemoryStore/SqliteEpisodicStore/llmLedger，session 内部协调器在两端同代码路径；但未做"设备上专门验证协调器批次数"的独立取证。
  - A36（故障后 UI 诚实性）：核心/账本层证据齐全（outcome_unknown 不显示为成功，账本-DB 对照见 §4）；设备 UI 层的错误呈现走查未执行。

按方案 §21 规则：NOT RUN 不计入通过。**最终结论：32 PASS / 1 部分 / 3 NOT RUN，无 FAIL。**

## 4. 真实 LLM 旅程证据（P8-9b）

驱动：`.tmp/p8-real-journey.cjs`（私有，不入库；生产 `CampaignSession` + `LedgeredProvider` + 统一提交边界 + `TurnPostProcessingCoordinator`）。模型 GLM-5.3-Flash（授权 coding 端点，档位 low，声明窗口 128K/输出 8192——测试配置值，非供应商认证）。骰点固定 RNG_MAX 以复现。

| 组合 | 权威提交 | 有效整理批次 | 最终记忆 | 物理请求（账本） |
|---|---|---|---|---|
| 现代悬疑（含 pressure_track，无战斗） | 26 | 3（全 succeeded） | clean through=24 | 29 planner + 27 narrator + 3 memory = 59 |
| 奇幻冒险（含战斗） | 26 | 3（2 succeeded + 1 经 outcome_unknown 恢复后 succeeded） | clean through=24 | 27 + 26 + 4 = 57 |
| 日常关系（无战斗、训练成长） | 22 | 7（6 checkpoint + 2 repair，含 dirty 重建） | clean through=22 | 28 + 22 + 9 = 59 |

关键真实证据：

1. **A16/A17/A18 完整恢复链（fantasy）**：第 3 批 HTTP 发出后进程退出 → 冷启动 `recoverInterruptedAttempts` 标 `outcome_unknown`（不自动重发）→ 人工批准重放 → 旧 worker 租约过期后新 worker 接管（新 fencing token）→ 批次成功，原 unknown 尝试保留审计。修复轮（memory_repair）与推理恢复同计 ≤3 HTTP/逻辑批次（daily 的 a1+a2 修复序列为真实样本）。
2. **known-change 核对（方案 §22.3 五步）**：三组合的采用正文与结构化事件中的变化（关系变化/任务开启/物品转移）在 DB checkpoint 中真实落地；生产 parser 输出非假空态；compiler 接受/拒绝符合 evidence 规则；实体时间随各自证据版本（v21–v24，非批次终点压平）；head 之后零未覆盖提交（Pending Bridge 清空）。
3. **诚实失败样本**：daily 一批两次修复 HTTP 后仍被本地验证拒绝 → 状态 failed（不假装成功），随后以 dirty 重建走通；suspense/fantasy 各 1–2 个回合被本地资格拒绝（模型提议不存在地点/Narrator turnId 不匹配）→ 零状态副作用，本地拒绝即门禁工作。
4. **费用**：三组合合计约 175 次物理 HTTP，全部入 `llm_request_attempts` 账本；usage 由 Provider 返回，未知不估算。

限制（不扩大结论）：旅程使用确定性迷你世界夹具（2 场景 + 4 条目）而非整本小说自动映射；`loadActors` 只提供主角提示，模型将 NPC 归一到主角 id（`rel:pc->pc`）——验证器正确限制了未知 actor，但演员表不完整导致关系主体错配，记录为已知限制；未做《放开那个女巫》全书 TXT→配置的自动映射质量评分（P7 已证明人工 design_fill 链路，本期未重复）。

## 5. 累积规模证据（P8-9a，A25）

`tests/phase8-p8-9-journey.test.cjs`，单分支连续累积（非重建空态），确定性事件 + 本地 merger 折叠 + 协调器索引：

| 规模 | 提交阶段 | 记忆折叠 | 索引 | 下一回合读取（40 回合窗口） | DB 字节 |
|---|---|---|---|---|---|
| 100 | 34ms | 2ms | 26ms | 1ms | 1.19 MB |
| 300 | 127ms | 2ms | 137ms | 1ms | 1.84 MB |
| 1000 | 926ms | 9ms | 1312ms | 3ms | 6.34 MB |

handoff 覆盖率 100%、episodic 索引唯一计数 100%、记忆折叠至 head 且 beats 封顶 20。此证据证明结构与规模，不证明 1000 次真实 LLM 文学质量（后者由 §4 的真实旅程按比例证明）。

## 6. 设备与构建身份

- 最终 debug APK：`dist/apk/debug/ShineWord-V0.8.0-debug.apk`（构建于 `main@ab2be05` 之后的最终源码；SHA-256 见构建产物清单）。
- 移动端类型检查 PASS；版本一致性 PASS（0.8.0/80000）。
- 设备验收（emulator-5554）：见 `ACCEPTANCE_CLOSEOUT.md` 的设备章节（安装、启动、新项目创建、回合、强停恢复）。
- 模拟器证据覆盖最终候选构建；真机未执行，按方案标注 NOT RUN，不写"全设备稳定"。

## 7. 开放项与未完成范围

1. **A34/A35/A36 的设备 UI 层取证**（见 §3）：核心逻辑均有单元/事务证据；设备 UI 走查（旧库提示入口、设备端协调器批次数、错误呈现）未执行。影响：移动 UI 尚未提供旧开发库的显式"开发重置"引导页（检测函数已具备）。
2. **A10 恢复路径请求快照逐项比较**：共享规划内核已保证同源，未单列端到端用例。
3. **小说自动映射质量评分**：本期证明"人工配置组合通过"；从整本小说自动生成世界配置的映射质量未评分（方案 §24 允许此结论表述）。
4. **pressure_track 的世界包发布链**：模块与配置编译已验证；"从 TXT 映射自动启用 pressure_track"未做（属延后项）。
5. **真机**：NOT RUN。

## 8. 结论

第八阶段的完成定义（方案 §26）——"一个 TXT 世界采用合法配置后规则与书一致；一个行动使用冻结材料和本地结果；一个提交 durable 地成为历史；一段记忆有证据、时间、权限和 CAS；下一回合能够正确消费；当前格式保存、分叉和重启维持同样事实"——已在工程与真实 API 证据层面成立；设备 UI 层的三项走查（A34/A35/A36）与真机为明确的剩余范围，已在 §7 列出，不冒充已完成。
