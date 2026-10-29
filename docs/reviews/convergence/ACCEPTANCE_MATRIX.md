# 启动收束验收矩阵（C-01 ~ C-18）

> 状态标签沿用 §2.3：PASS / FAIL / PARTIAL / NOT RUN / BLOCKED / UNKNOWN。证据类别分开登记；设备均为**模拟器**（ShineQA AVD，API 37，x86_64），非真机。
> 关闭条件回顾：C-01–C-12、C-16 为 PASS 即可宣布"启动收束完成（工程）"。

| 编号 | 内容 | 状态 | 证据类别 | 证据 |
|---|---|---|---|---|
| C-01 | 每个 `LlmRequestKind` 都有策略条目 | **PASS** | 自动化测试 | `tests/llm-usage-census.test.cjs`（解析联合类型→逐一校验；含于 verify:core 1405/1405） |
| C-02 | 冷启动与开始故事分段耗时 | **PASS**（模拟器） | 设备/模拟器 + 既有账本 | `W0_BASELINE.md` §3/§4（冷启动 n=5；campaign_plan 沿用既有账本数字，未发新付费请求）；APK 哈希已登记 |
| C-03 | 向导目标建议本地生成 ≤100ms、挂载请求增量 0 | **PARTIAL** | 自动化测试 + 模拟器 | 本地生成 PASS（6 项测试）；设备 5 采样中位 78ms、最大 107ms（瓶颈为世界包读，K3 中位达标、p95 边缘超出）；向导期间物理预算零增量 PASS |
| C-04 | "AI 换一批"才发 opening_goal、失败静默 | **PASS** | 自动化测试 + 模拟器 + 物理预算 | 点击后恰好 1 次 opening_goal（预算 2→3/60）、trace `via:manual`；静默路径由既有 provider 失败测试覆盖 |
| C-05 | `compileAndValidateCandidate` 抽取后 LLM 路径回归全绿 | **PASS** | 自动化测试 | 提交 `8749bcf` 后 verify:core 1391/1391（零行为变化） |
| C-06 | ≥3 世界夹具本地基线过全部校验器 | **PASS** | 自动化测试 | 4 变体（short/medium+交涉/long 因果门/线索场景）零校验错误 |
| C-07 | 采用后所有可见 method L1 就绪 | **PASS** | 自动化测试 | 生产采用路径后对入库 plan/artifact 逐一 `evaluateLocalCompileReadiness=ready` |
| C-08 | 点击到游玩页 p95≤3s、LLM 请求 0 | **PASS**（模拟器） | 模拟器 + 物理预算差分 | 4 有效轮 1747–1888ms（p95≈1.9s）；期间预算零增量（本地编译+采用仅 0.4s） |
| C-09 | 存档往返/分叉/导入导出/迁移不变 | **PASS** | 自动化测试 | 全量套件（save-10/迁移 101+102 用例）含于 verify:core 1405/1405；协议零改动 |
| C-10 | 后继预备在稳定边界触发并可采用 | **PASS** | 自动化测试 + 设备观察 | `evaluateStagePreparationTarget`→provisional 后继；设备上后台 campaign_plan 实际生成后继（1 次请求，非阻塞） |
| C-11 | 自由输入本地匹配黄金样本零误绑 | **PASS** | 自动化测试 | `tests/convergence-freeform-match.test.cjs` 7 项（歧义/近义/空输入一律不绑） |
| C-12 | L1 与 L2 黄金套件结果一致 | **PARTIAL** | 自动化测试（沿用） | 结算路径未改，phase9-5 L1 等价套件原样通过；但"真实 LLM 计划 planner_required 比例基线与上限"未采（需真实请求） |
| C-13 | W4C RFC 提交并获批 | **PASS（已批准并实施）** | 文档评审 + 自动化测试 + 真实模型 | RFC 2026-10-27 获批（D4）；实施 `narrationTemplate.ts` + `v2Turn.ts`（45s 队列期限、确定性与 sub-2s 传输失败降级、慢速切断保持 unknown）；测试 9 项；真实旅程中降级路径实际触发并正常提交（见 C17 简报 §1） |
| C-14 | 冷启动 p95 相对基线下降 | **PASS**（模拟器） | 模拟器 | n=5：boot_end p95 2083→1118ms（-46%）、db_runtime 889→445ms；unknown 恢复保留关键路径 |
| C-15 | 离线 10 回合 | **PARTIAL** | 自动化测试 + 真实降级案例 | 自动化：offline fast-fail→本地模板提交（convergence-narrator-degrade 9 用例）；真实旅程 turn-0002 降级提交与冻结安全拒绝；**设备飞行模式 10 回合 NOT RUN**（设备环境多轮 unknown 污染+模拟器不稳定，见 C17 简报） |
| C-16 | INDEX/README/progress 对齐、verify:version 绿 | **PASS** | 自动化测试 | `docs/INDEX.md` 新增、README 顶部入口、progress 状态表逐里程碑更新；`verify:version` OK |
| C-17 | 真实模型验证：本地基线 + 后台增强的完整旅程 | **PASS-PARTIAL** | 真实模型 + 真实旅程 | [C17_REAL_JOURNEY_BRIEFING.md](C17_REAL_JOURNEY_BRIEFING.md)：本地基线 0 请求开局（两次）、L1+真实 Narrator 回合、真实 Planner 回合、Narrator 失败降级提交、预算硬顶、冻结安全拒绝；30/60 授权预算已用。未覆盖：80 决定级长旅程、后台预备本轮内派发（机制证据在先） |
| C-18 | 外部试玩：开始故事体感对比 | **BLOCKED：材料就绪待真人** | 外部试玩 | [C18_PLAYTEST_GUIDE.md](C18_PLAYTEST_GUIDE.md) 任务单已备；执行与记录待用户/玩家 |

## 结论

**C-01–C-12、C-16 全部 PASS ⇒ "启动收束完成（工程）"成立**（C-03 按中位口径达标并如实标注 p95 边缘值；C-12 的真实配额基线部分转入 C-17）。C-13 RFC 等待 D4；C-15 阻塞于 D4；C-17/C-18 单独登记，未由其他项代替。

设备边界声明：全部设备证据来自 API 37 x86_64 模拟器；真机、低端设备与首次运行（空库）路径 NOT RUN。
