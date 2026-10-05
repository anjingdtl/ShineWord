# Phase 8 验收与收尾报告

日期：2026-10-04。最终源码：`main@ab2be05`（后续文档 commit 见 git log）。应用 V0.8.0 / versionCode 80000。

## 当前结论

**第八阶段施工与验收完成。** 894 项核心测试全绿；移动端类型检查、版本一致性、debug APK 构建、设备安装与真实回合全链路通过。验收矩阵 32+2 PASS / 1 部分 / 2 NOT RUN / 0 FAIL（明细见 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md) 与 [FINAL_REPORT.md](FINAL_REPORT.md) §3/§7）。

开发期单协议政策已落地：`shineword-core@0.3.0`、ActionContract 2.0、save-9（save-2..8 逐版本拒绝）、story-memory 观察协议、迁移 33。无旧规则适配器、无旧存档转换、无双轨运行时、无 legacy 全量上下文回退。

> **时间标注（2026-10-05 收尾轮补注）**：上句中的“迁移 33”是 **0.8.0 发布时点**的数据库迁移链版本，为历史叙述，保留不改。其后“重验收与加固轮”已将数据库政策收敛为**单基线 version 100**（新空库一次装全、旧/不完整库显式拒绝且绝不静默修复）；**现行政策以 version 100 为准**，详见本文件「重验收与加固轮」段与 `ACCEPTANCE_MATRIX.md` 的 P8-RA 节。

## 真实模型与设备证据

- 真实 GLM（GLM-5.3-Flash，授权 coding 端点，测试配置窗口 128K/输出 8192）：三组合旅程合计约 175 次物理 HTTP，全部入 `llm_request_attempts` 账本；fantasy 的 sent→outcome_unknown→人工批准→租约过期接管→重放成功是 A16/A17/A18 的完整真实链；daily 的修复轮两连拒绝→failed→dirty 重建是诚实失败样本。密钥未输出；私有脚本与旅程数据库在忽略目录 `.tmp/`。
- 累积规模（本地确定性）：100/300/1000 回合单分支连续累积，handoff 覆盖 100%，下一回合分页读取 1000 回合 3ms。
- 设备（emulator-5554，Medium_Phone，API 37.1）：安装 `ShineWord-V0.8.0-debug.apk`（SHA-256 `8ed7afe30b3ba6a354ebf6c4f0f9208d41ceff611e23ba0cf42b1379c17f8818`）。验证：启动无崩溃；强停+冷启动恢复；增量迁移至 33 且 P7 项目数据与记忆保留（**2026-10-04 证据，早于单基线政策**；该“增量迁移至 33”路径已随单基线 version 100 收敛为旧库显式拒绝 + 新建库，见本文件「重验收与加固轮」）；真实设备回合 turn-0018（camp-mutegp5i）的 Planner/Narrator/记忆批次 v9-17 全部 succeeded，冻结根与 outbox handoff（episodic_indexed=1）落库；p7-novel-excerpt 项目新回合 turn-0018 同样留下冻结根+pending handoff。

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

## 重验收与加固轮（2026-10-05）

第八阶段收尾后追加一轮“重验收 + 引擎加固”，补强身份、存档、规则与数据库基线不变量，并补回被网络中断的真实旅程证据。

- **工程门禁**：`npm run verify:core` **916/916**（新增 `tests/phase8-reacceptance.test.cjs`）；移动端严格类型检查 0；`npm run verify:version` PASS（0.8.0 / 80000）；Debug APK 独立构建成功。
- **加固**：请求/缓存身份指纹由 FNV-1a 32 位改为可移植 SHA-256（Node/RN 同源）；稳定存档门禁（拒绝未完成冻结回合、在途或未批准的未知物理请求、运行中记忆后处理，移除静默 try/catch 兜底）；`storyMemoryChain` 存档记忆链校验；`runtimeRules` 预设工厂接入生产；伪造配置哈希、非安全整数参数、未类型化约束显式拒绝；数据库单基线 version 100 + 旧/不完整库拒绝且不静默修复 + 移动端“创建新的开发数据库”入口。
- **设备**：旧开发库拒绝 UI 走查（Maestro 流程 `fresh-baseline-reset` + `ui-legacy-refused.xml`），Keychain 重置前后 SHA-256 一致；设备导入真实《放开那个女巫》1504 章并达可玩（`ui-final-library.xml`）。
- **真实旅程复测**（替换此前被 `fetch failed` 中断的残缺样本）：三组合各 24 回合、0 失败、记忆 clean、账本全入账；明细见 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md)“重验收轮证据”。
- **新关闭验收项**：A10、A27、A34（A36 保留 NOT RUN）。校准后 **PASS 31 / NOT RUN 5（A05/A09/A11/A30/A36）/ FAIL 0**。
- **私有资产**（不入库）：`.tmp/phase8-reacceptance-20261005/`（真实旅程驱动、设备 dump、metrics、SQLite 快照）。

## 收尾轮（2026-10-05 Round 2：补齐 5 项 NOT RUN）

日期：2026-10-05（Asia/Shanghai）。基线：`main@501bf20` 工作副本之上；本轮新增 `tests/phase8-closeout-round2.test.cjs`（6 用例）与设备走查，逐项报告见 [CLOSEOUT_ROUND2_2026-10-05.md](CLOSEOUT_ROUND2_2026-10-05.md)。

- **工程门禁**：`npm run verify:core` **922/922**（`916 → 922`）；移动端严格类型检查 0；`npm run verify:version` PASS（0.8.0 / 80000）；`git diff --check` 0 行；Debug APK 独立构建 BUILD SUCCESSFUL。
- **NOT RUN 清零**：A05（对抗泄漏样本）、A09（Narrator+Prepared+repair 组合超窗）、A11（冻结后不漂移）、A30（确定性重放）新增独立用例转 PASS；A36（设备端“故障后”横幅与恢复入口）经 emulator-5554（API 37）实机走查转 PASS。
- **校准后汇总**：PASS **36** / NOT RUN **0** / FAIL **0**（以 [ACCEPTANCE_MATRIX.md](ACCEPTANCE_MATRIX.md) 逐项为准）。
- **仍开放项（不冒充完成）**：真机 NOT RUN；小说自动映射质量未评分；同源多项目语义未定；BUG-SCHED-1（结算等待无进度反馈，产品决策）；设备旧项目政策（新协议战役须新建项目）。
- **私有资产**（不入库）：`.tmp/closeout-round2/`（A36 设备截图/UI dump、设备库回拉快照、夹具与流程脚本）。
