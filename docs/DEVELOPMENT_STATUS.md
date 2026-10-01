# ShineWord 项目建设进度（PROGRESS）

更新日期：2026-10-01。当前设备验收见 [Android 验收报告](reviews/android-qa-20261001/TEST_RESULTS.md)，发版产物见 [V0.4.2 发版记录](releases/V0.4.2.md)；更早阶段保留为历史快照。

## 当前阶段（V0.4.2 稳定性修复与发版）

版本：`0.4.2` / versionCode `40200`，SQLite schema 26。七个 Android 模块完成设备测试、修复和复测：启动、配置、小说与世界构建、开局、连续游玩、存档/恢复和导航稳定性。指定 GLM 与完整《白篱梦》完成 16 个新真实回合及 2 次休息；588 项核心回归通过。

已测主路径没有遗留阻断缺陷。循序精编仅验证第一阶段 r1；实际战斗、招募、物品转移、训练、后续精编阶段、真机性能和跨 Android 版本仍需验证。本次交付不改变历史阶段中尚未通过的全量验收结论。

## 历史快照（第四期本地建设与复验，2026-09-29）

版本：`0.3.0-progressive.2` / versionCode `16`。第四期建设和本地复验已形成可审查交付；**整体验收未通过，不是 Alpha/Beta，不可称为可发布**。

### 本轮完成

- **文字优先主屏**：故事滚动区、最多三项文字行动和显式输入；默认页移除常驻战斗 HUD。四主题、1.3×/2×系统字、键盘与窄屏布局有 API37 模拟器截图。
- **规则与恢复**：场景资格遭遇入口、隔离的遭遇意图协议、StoryEntry 安全摘要、NPC 自动推进 operation journal 与 migration 16 已实现；有旧 `revealAt='1'`、目标/协议边界、幂等、fence、上限及 commit/checkpoint 故障注入回归。
- **工程门禁**：`npm run verify:core` 237/237；mobile typecheck exit 0；96 项文本对比度检查和组件断言 PASS；Debug 与签名 Release 本地构建成功。
- **现有模拟器**：使用 `ShineQA` / `emulator-5554`（Android 17 API 37），候选包同签名 `install -r` 后保留两个合成 QA 世界；Release 断网强停冷启动到达书库。默认故事页在 412×915、360×800、320×640 dp 的故事滚动区分别为 66.6%、61.8%、52.3%。

### 未达到的出口

- 本轮没有调用真实 LLM、没有 SAF 导入《白篱梦》或《凡人修仙传》，没有 3 次独立开局、10 次玩家决定、真实 campaign 恢复或 TTFP 样本。配置文件轮换状态没有证据，未读/未用凭据。
- 设备没有提交普通故事行动；当前 QA 包缺明确 scene/template 冲突资格，所以没有设备遭遇行动或自动 NPC 轮转。
- 架构仍没有独立 `UnifiedActionGateway` 类。自动行动精确 Android 强停注入、TalkBack、API24、Android 15/16 真机与端上 P95 未测。
- 仅 API37 模拟器并不关闭设备矩阵。Release 候选保留 versionCode16，未递增、未上传、未发布。

完整状态、命令退出码、证据路径和限制见 [Q4_FINAL_REPORT.md](reviews/phase4/Q4_FINAL_REPORT.md)、[Q4_DEVICE_MATRIX.md](reviews/phase4/Q4_DEVICE_MATRIX.md)、[Q4_COMPATIBILITY_REPORT.md](reviews/phase4/Q4_COMPATIBILITY_REPORT.md) 与 [Q4_LLM_NOVEL_REPORT.md](reviews/phase4/Q4_LLM_NOVEL_REPORT.md)。

## 历史快照（最终收尾验收轮 F0–F6，2026-09-29）

版本：`0.3.0-progressive.2` / versionCode `16`（情况 B：工程绿、真实可玩外部阻断；非 Alpha）。

### 本轮完成

- **工程门禁全绿**：`npm run verify:core` **226 passed / 0 failed**（224 基线 + 2 新增）；`npm run typecheck`、`npm run typecheck --prefix mobile`、`git diff --check` 全 PASS；`:app:assembleDebug` BUILD SUCCESSFUL（Java 17）。
- **F1 视觉/交互（代码级）**：新增 `accentOnBase` / `semanticText` token，修 14 个语义色文字槽；对比度审计 84 项文本/大字 **0 低于 WCAG 下限**；修复 3 处真实 <44dp 触控面（SegmentedControl compact / ProgressSteps / PartyStrip）。
- **F2.4 NPC 公开投影安全**：新增 GM-only/Future 泄漏硬门禁用例（entityId、templateId、gm ability/quest、future lore、resourceMax），单元 PASS；UI 用「未探明」占位。
- **F3.1 opening 诊断加固**：`OpeningPreparationError` 增加分阶段 `errorCode`（`json_parse` / `schema` / `citation` / `reference_closure` / `compile` / `publish`），脱敏（不含原文/响应/prompt/key）；单测覆盖 4 类阶段。
- **F0/F5 基线**：沙箱无 `adb` / `emulator` / `/dev/kvm` / system-images / API Key → 设备与真实端点验收登记为外部阻断。

### 三项结论

1. 工程修复与核心规则/投影：**通过**（226/226，两处 typecheck，debug APK）。
2. 第三期验收：**未通过**（四主题设备截图、键盘/SafeArea 实测、完整设备旅程、Release 签名-安装仍未取证）。
3. Progressive 快速开局：**BLOCKED**（真实端点未产出可发布 dossier；无设备；TTFP 未测）。工程侧 **Progressive Engineering Ready / First Playable Acceptance Blocked**。

完整未完成清单与外部阻断登记见 [final-closeout/FINAL_REPORT.md](reviews/final-closeout/FINAL_REPORT.md)。

## 历史快照（二期收尾 C0–C7）

更新日期：2026-09-28。逐阶段证据与结项矩阵见 [closeout/FINAL_REPORT.md](reviews/closeout/FINAL_REPORT.md)；此前 R6 基线保留为历史快照。

### 本轮完成（对应用户三大问题）

- **工程门禁恢复**：mobile typecheck EXIT=0、核心回归 188/188（156 原有全保留 + 32 新增）、debug/release APK 可构建；修复依赖缺失与 24 个文件的真实导入路径错误。
- **P0 哈希缺陷修复**：mobile 字节哈希适配器对任意 bytes 正确散列；污染库自愈（upsert+状态重置）；复用指纹（extractor 版本+模型）；事件提案原子 checkpoint 与 DB 重放；失败块不再标 ready。
- **流式构建管线**：私有源暂存+分片持久化（整本 base64 移除）；批/流式解析等价；预算分组+分段协议（真实模型小样 7/7 引文命中）；映射分批断点+跨批归并+usage 聚合。
- **真实进度**：DB 驱动任务卡（真实计数、暂停/继续/失败明细、重进/重启恢复，无模拟百分比）。
- **后台执行**：dataSync 前台服务+Headless runner+租约单执行者（设备验证：服务运行、通知发布、权限拒绝不阻断、失败可重试）。
- **disabled fate 合同状态机**：独立规则引擎（触发/退出/计时/结局/权威事件/快照回退），7 项回归。
- **Release**：versionCode 13，证书与要求一致，干净安装冷启动通过。

### 三项结论

1. 工程修复：**完成**（Android 15/16 真机限制矩阵除外）。
2. 第三期验收：**未通过**（四主题截图、完整最终包旅程等设备/视觉验收缺口）。
3. 二期 Beta：**未通过**（全文真实模型构建、双模型、三题材标注、召回质量、真机矩阵未具备）。

完整未完成清单与证据见 FINAL_REPORT.md。

## 历史快照（R6 及以前）


更新日期：2026-09-28。当前验收基线与逐项证据见 [P2_ACCEPTANCE_CLOSEOUT_R6.md](reviews/P2_ACCEPTANCE_CLOSEOUT_R6.md)。一期 M0～M5 与 R3～R5 报告保留为历史快照，不代表二阶段出口。

## 当前阶段（二阶段 · R6 收尾验收）

### 本轮已完成

- 秘密 actor_template 不再进入开局同伴、遭遇或 Planner 玩家投影；createCampaign 和运行期招募服务端拒绝 GM/未来/无关系资格模板 ID。A08 增加了秘密模板、嵌套场景引用和非法直提模板回归。
- §11 的招募、退出、分队、重入、指令理由、角色级知识、显式通信、物品来源与状态事件进入版本化快照；A11 覆盖拒绝场景、历史回退与存档恢复。失能命运合同状态机仍有缺口，未将援救称为完整生命周期。
- 修复三书过滤后隐藏 entryId 仍残留在分节元数据的泄漏；同伴支援未满足条件时将解释实际 fallback 动作。
- 核心回归 147/147；第一轮原复现 7/7；第二轮原复现 5/5；移动端 TypeScript 检查 PASS；git diff --check PASS。
- 已重新核实旧 p2.8 Release 签名，并构建当前 p2.9 签名 Release；bundle 与 Gradle 生成文件哈希一致，在隔离 API 37.1 模拟器断网冷启动到设置页，无 Metro 依赖或启动崩溃。

### 尚未达到的出口

- P2-0～P2-6 整体仍未完成。P2-3 的单人加两名同伴完整 UI 冒险没有贯通探索、社交、战斗、休整、成功训练、任务/线索/知识/奖励、三书发现视图和恢复。
- P2-4 缺三类获准小说、≥200 条独立关键事实标注、真实模型召回与字段引文评估、人工语义支持记录。
- P2-6 缺当前推理开启政策下至少两种真实模型及 ≥100 个动作实跑；历史 Error/non_provider 无法由所留摘要定位根因。还缺 API 24 系统镜像、真机、端上 P95 和 20 万/100 万字素材性能数据。
- 失能状态已有事件和保存恢复，但 captured/rescued/death_risk/ending 尚未由发布世界/遭遇合同驱动成完整状态机。

### 当前 Release 与设备证据

- p2.8 已签名 Release 仍存在，其旧 bundle 不含本轮投影实现；R5 的“无 Release 签名证据”是当时快照结论，现已更正。
- 最新 p2.9：dist/apk/release/ShineWord-V0.2.0-p2.9-release.apk；versionCode 10，minSdk 24，targetSdk 36；SHA-256 为 46B6E47B22577B2EB19E26279B54558DDA56B70B284BFF2151B70461D4AE4446；apksigner v2 和 zipalign 均通过。完整证书、bundle 与对应源码哈希见 R6。
- emulator-5556 是本轮新建的隔离 API 37 / Android 17 测试设备；断网安装后冷启动成功。emulator-5554 原安装与 app 数据未改动。本轮未验证 API 24 或真机。
- 本轮按用户授权仅提交 Phase2 修复、对应回归与验收文档；不推送。既有 Android 构建/签名/脚本及 UI 工作区改动未纳入本次提交。APK 构建产物、密钥、私人小说、存档及敏感日志未加入仓库。
## 当前阶段（一期，历史记录）

### M0 方案与抽取审计 — ✅ 完成

已完成：

- [x] 锁定 `tavo-mini` 第一轮参考提交。
- [x] 核查 React Native / React / TypeScript / SQLite / Keychain 技术基线。
- [x] 检查 TXT 导入、LLM 入口、安全存储、上下文预算四个核心模块。
- [x] 明确第一轮复用与不复用边界。
- [x] 完成 Provider、Scheduler、TXT Streaming、Parser、SQLite/Keychain 与 Android 工程的函数级审计；见 `docs/M0_FUNCTION_AUDIT.md`。

### M1 确定性内核 — ✅ 完成

已落地：

- [x] ShineWord Ruleset V0.1 常量与 JSON 规则包。
- [x] 六属性基础约束（1～3）。
- [x] 未训练 d4 / 入门 d6 / 熟练 d8 / 精通 d10 / 大师 d12。
- [x] `clamp(属性 + 情境修正, 1, 4)` 骰池。
- [x] 多骰取最高与精确成功率公式。
- [x] 四档结果等级。
- [x] 行动资格预判：阻断 / 自动成功 / 需要检定。
- [x] Action Contract TypeScript 模型、JSON Schema、稳定序列化与 SHA-256 Provider 接口。
- [x] 禁止 Planner 注入骰点、骰池、结果等级等本地权威字段。
- [x] 回合状态机及非法跳转阻断。
- [x] 可注入随机源、拒绝采样算法与不可变 RollRecord。
- [x] SQLite M1 核心 schema。
- [x] `schema_migrations` 迁移执行器：顺序校验、幂等执行、失败回滚。
- [x] stateVersion 比较交换语义与原子提交。
- [x] 平台无关 SQLite `TurnStore`。
- [x] branch event / snapshot / RollRecord 同事务持久化。
- [x] 风险回合先冻结 Action Contract，再持久化 RollRecord。
- [x] Narrator 失败或进程重启后复用原 RollRecord，禁止重掷。
- [x] 固定“雨夜潜入藏书阁”小世界的无 LLM 单回合测试。
- [x] 无 LLM 三回合完整执行器测试：风险检定 → 风险检定 → 自动行动。
- [x] GitHub Actions 核心验证工作流，不上传构建产物。

尚未完成：

- [x] Android 原生同步安全随机字节端口已定义，`NativeSecureRandomByteSource` 接入拒绝采样器。
- [x] React Native SQLite 结构化驱动桥接 `ReactNativeSqliteAdapter` 已完成并测试。
- [x] Draft / Planned / AwaitRoll / Resolved / Narrated / Validated / Repair / Paused / Committed 恢复策略已固化并测试。
- [x] M1 Review/Fix 完成：首次 CI 暴露恢复策略 unreachable branch，修复后 32/32 测试通过。

### M2 安卓闭环 — ✅ 完成

已落地：

- [x] OpenAI-compatible LLM Provider（HTTPS 强制、本地/私网例外、错误归一化、usage 记录）。
- [x] Fetch Transport 超时与取消。
- [x] API Profile 与 Key 引用分离；AsyncStorage 仅存 keyRef。
- [x] API Key 安全存储（Keychain，`WHEN_UNLOCKED_THIS_DEVICE_ONLY`，独立 `com.shineword.app.secret.*` namespace）。
- [x] 每回合物理请求预算（默认上限 4）。
- [x] Planner JSON ActionContract 生成、本地验证、合同哈希冻结与暂存持久化。
- [x] 本地确定性掷骰（Android SecureRandom → 拒绝采样），RollRecord 先持久化再调用 Narrator。
- [x] Narrator 结果验证：turnId / 冻结 grade / 文本长度限制；Candidate 不可变。
- [x] SQLite 原子状态提交、幂等重放、committed 唯一索引。
- [x] Planner / Roll / Narrator 中断恢复；重启不重新 Planner、已持久化骰子不重掷。
- [x] Android 应用壳：`com.shineword.app`、`shineword.db`、Native SecureRandom、Native SHA-256。
- [x] 基础游戏 UI：API 设置页、自由行动输入、剧情卡片、骰子摘要。
- [x] Android CI（mobile typecheck + `:app:assembleDebug`）。
- [x] M2 Review/Fix：修复设置页 Key 保存逻辑、新增 SQLite 回合历史加载、补齐 gitignore 与 lockfile；见 `docs/reviews/M2_REVIEW.md`。
- [x] 本地模拟器 Smoke Test 15 项全部通过（Medium_Phone / API 37.1 + 本地 mock OpenAI-compatible 服务器，含 Narrator 故障注入恢复与 Key 泄漏扫描）。

回归结果：Core tests 38/38、mobile typecheck PASS、`:app:assembleDebug` BUILD SUCCESSFUL。

## 当前阶段

### M3 原著世界构建 — ✅ 完成

已落地（详见 `docs/reviews/M3_REVIEW.md`）：

- [x] Migration 003：worlds / source_chapters / source_chunks / entities / entity_aliases / canon_facts / fact_sources / canon_events / event_dependencies / divergence_markers / world_rule_mappings / knowledge_records / world_jobs。
- [x] TXT 导入：编码探测（BOM/UTF-8/GBK）、归一化、标准/宽松/兜底分章、SHA-256 哈希分块、码点偏移体系；《白篱梦》100 万字 300 章导入 94ms。
- [x] Extractor 协议：LLM 只给 verbatim 引文，本地解析偏移并强制证据校验（source location 100%）。
- [x] 事实五类状态；speculation 永不升 canon；多值/单值谓词冲突策略。
- [x] 实体合并候选（同名不自动合并）；两类角色开局（原创 1+4 自由点 / 原著从 canon 派生）。
- [x] 事件依赖 + `markEventsPendingAfter` 分叉失效；knowledge_records 建表。
- [x] 构建管线：chunk 任务、哈希复用、失败恢复、并发 1~2。
- [x] 200+ 条人工标注事实测试集（fixture 286 条）+ 召回 ≥90% 测试。
- [x] 真实 GLM-5.3-Flash 抽取《白篱梦》3.6 万字：11/11 块成功、91 条事实全部带证据入库。
- [x] Android：SAF 文件选择原生模块、世界书架 UI、设备端真实导入构建（实体 29/事实 40/事件 8/失败 0）。
- [x] M3 Review/Fix：分章边界、REPLACE 级联自毁、动态 import、跨 chunk 事件依赖、冲突误判、GLM thinking、Hermes 兼容。

回归结果：Core tests 54/54、mobile typecheck PASS、`:app:assembleDebug` PASS、模拟器端到端通过。

### M4 完整游戏系统 — ✅ 完成

已落地（详见 `docs/reviews/M4_REVIEW.md`）：

- [x] 成长引擎：练习点 5/10/20/40 阈值、每遭遇每技能 1 点（turn-id 去重阻断回档刷点）、里程碑 1~2 级仅限已解锁技能。
- [x] 叙事战斗：near/mid/far 距离带、冻结先攻（跳过阵亡、环绕计轮）、伤害模板减护甲下限 0、0 HP disabled + 场景合同结局枚举。
- [x] Migration 004：campaigns / actor_skills / relationships / encounters / encounter_actors / memories / llm_requests。
- [x] 检索记忆：可见性 → 时间窗 → 状态有效性 → 分支作用域 → 相关度（强制顺序）；秘密/未来/过期/跨分支/冲突全部拦截；每 8 回合摘要节奏。
- [x] 分支：fork/rewind（历史快照 fork）、技能与关系复制、源分支不可变、跨分支无泄漏。
- [x] 导出：`.shineword-save.json`（manifest + 哈希引用世界）+ 递归禁键扫描（API Key 结构性不可入备份）+ 导入校验。
- [x] LLM 用量记录接入回合管线（llm_requests，模型/tokens/估算标记）。
- [x] 100 回合长程一致性测试：100 committed + fork-50 回退双分支独立 + 重放不重掷。

回归结果：Core tests 69/69、mobile typecheck PASS、`:app:assembleDebug` PASS、模拟器 smoke 通过（llm_requests 落库验证）。

### M5 Alpha 验收 — ✅ 完成

已落地（详见 `docs/reviews/M5_REVIEW.md`）：

- [x] 多 Provider 能力探测（GLM ✓✓ / DeepSeek ✓✓ / MiniMax json✗ usage✓，两段式探测、如实报告失败）。
- [x] 容错传输：FaultInjectionTransport 四类故障注入、postWithRetry（5xx/网络重试、timeout 不重试）、CancellationToken。
- [x] `ApiProfile.thinkingDisabled` Profile 级开关（GLM 推理模型空 completion 修复）+ 移动端自动置位。
- [x] Planner 合同门硬化：缺失/未知 op、非布尔 achieved、畸形 resourcePreconditions 显式拒绝；GLM 方言确定性归一化（`normalizePlannerEffects`）；单 actor 战役故事名 actorId 重映射；Narrator 字段类型检查。
- [x] 摘要执行器 `summarizeRange` 与回合结算（练习点诚实失败、关系增量夹取）。
- [x] 性能基线：20 万字（252,996 码点/94 章/257 块）导入 25ms + 全流水线 345ms；100 万字（965,458 码点/300 章/944 块）导入 108ms + 3,687ms、堆峰 37.1MB。
- [x] 100 回合真实 GLM 一致性：93/100 committed、7 次干净拒绝、0 崩溃、finalStateVersion 与 committed 严格一致、193 次 LLM 请求用量落库（23.1 分钟）。
- [x] Release APK 独立签名（SHINEWORD_RELEASE_* 环境变量注入、keystore 不入库）并交付 `dist/apk/{release,debug}/`；离线启动验证通过。

回归结果：Core tests 82/82、core + mobile typecheck PASS。

### 最终全量回归 — ✅ 完成

20/20 回归项 + 12/12 人工审查项全部通过（详见 `docs/reviews/FINAL_REGRESSION.md`）：确定性概率、恢复、分支隔离、时间/知识泄漏、100 回合长程（本地 + 真实 GLM）、TXT 导入与真实《白篱梦》100 万字、证据定位、Canon 测试集、导出/导入、秘密扫描、debug 构建、双构建模拟器冒烟（release 离线 + debug Metro + run-as DB 校验）、release 签名核查、CI 绿（deterministic-core + android-debug）。README 已更新至 Alpha 状态。

## 二阶段历史验收快照（R5，2026-09-28）

### 原方案阶段出口

| 阶段 | 状态 | 证据与仍缺范围 |
|---|---|---|
| P2-0 基线整改 | 旧缺陷与本轮战斗缺陷代码/正式回归通过 | 旧版数据升级矩阵和所有历史设备数据边界仍未完整验收 |
| P2-1 世界包与三宝书 | 模型、验证器、编辑/发布和独立 ZIP 代码通过；合成 QA 包 UI 通过 | 真实内容质量和三题材可玩性仍待验 |
| P2-2 建卡与真实战役 | 原创角色、同伴与合成战役在设备端有证据 | 原著角色开局、探索/社交整段 UI 旅程与同伴关系驱动招募仍待验 |
| P2-3 完整规则闭环 | 战斗引擎/事务、行动经济、恢复正式回归通过；设备端移动/攻击/跳过/援救/撤退及恢复有证据 | 成功训练的设备 UI、完整任务/线索/知识/奖励 UI 旅程、探索/社交设备流程仍待验；§11 同伴生命周期与知识隔离未全部实现/验收 |
| P2-4 小说自动三书 | 历史构建流水线及其阶段测试保留 | 现有 286 条夹具由脚本生成，不是独立人工标注集；原方案要求的 ≥200 独立关键事实、≥90% 召回、explicit 引文定位 100% 和人工语义支持率尚未以合格证据关闭 |
| P2-5 编辑、迁移与交付 | 合成包草稿/差异/验证/新版本发布、世界 ZIP 与完整存档双跳恢复有代码和设备证据 | 更广的真实内容迁移与设备矩阵仍待验；存档 JSON 不替代世界 ZIP |
| P2-6 Beta | 未完成 | 多题材、完整用户旅程、双模型、性能/压力、API 24/真机和 Release 签名均未通过出口 |

### 第二轮报告 §4 既定范围

- 世界条目草稿编辑、差异检查、验证与发布新版本：引擎/回归通过，合成 QA 包设备 UI 通过。
- 可移植世界包：`.shineword-world.zip` 独立导入/导出与内容哈希通过；与 `.shineword-save.json` 存档区分。
- 实际发现接入三宝书：玩家视图按当前玩家角色的 branch knowledge 过滤；引擎回归通过，未完成实际“发现后回三宝书逐屏查看”的设备旅程。
- 长期记忆与事实检索：超出最近六条的记忆检索正式回归通过；真实长语料相关度/语义质量仍待验。
- 任务/线索/知识/奖励闭环与回退/存档：正式回归串联并断言快照/分支/存档；完整 UI 任务旅程待验。
- 能力准备、冷却、射程、目标政策与世界硬约束：负例回归通过；还未证明全部能力和场景覆盖。

以上已通过的代码/引擎项不替代原方案对移动端操作旅程、真实资料与 Beta 出口的要求。

### §11 同伴与 NPC 未结范围

原方案要求由招募条件和关系决定加入、默认最多两名同伴；按各 NPC 自身视角隔离知识；退出、失能、死亡风险、分队/重入为显式事件；物品归属和知识来源保留；队友间知识传播必须有明确通信事件和可用通信条件。现有同伴数量上限、角色卡、AI 指令、战斗救援和行动调度并不能证明以上生命周期与知识传播规则已完整实现。此项继续列为二阶段未结要求。

### §19 Beta 矩阵与外部依赖

- 世界题材：武侠、奇幻、低魔悬疑三套世界尚未各自完成角色创建和一段冒险验证。
- 事实质量：`tests/fixtures/facts-medium.json` 的 286 条标注由生成脚本合成；不能充当独立人工标注质量集。需补独立 ≥200 关键事实，并测召回 ≥90%、explicit 字段引文定位 100%、单独人工记录语义支持率。
- 模型：历史报告中有真实 GLM 推理开启的 100 次记录。本轮沿用推理开启配置进行了两次 3 步小样，分别为 2/3 和 1/3 提交；第二次的两次失败仅归类到脱敏的泛化 `Error/non_provider`，未输出错误文本或剧情。样本表现不稳定，未扩至 100 步，不能据此关闭 §19 长程出口。旧 `.tmp/m5-100turns-glm.cjs` 明确配置 `thinkingDisabled=true`，排除为当前政策验收证据。第二个推理模型配置缺失，待验。
- 性能：本轮未测目标设备本地裁定/提交 P95≤100ms、卡片及缓存书页交互 P95≤200ms。历史 20 万/100 万字结果是桌面 Node 数据，不能替代端上性能和压力素材验收。
- Android：p2.8 debug 已安装于 `emulator-5556` 与 `emulator-5558`，均 API 37；无 API 24 运行设备、无真机，无 Release 签名凭据。`emulator-5554` 保留原安装与数据。
- 旅程：战斗 UI 现已补验援救与活动遭遇杀进程恢复；本轮仍未完成探索/社交、发现后书页视图、完整任务闭环 UI、成功训练 UI 的合成 QA 战役旅程。
- 模型/小说资料不会写入仓库；测试 API 配置、私人存档、原始敏感日志和小说全文不属于交付物。

### 当前回归与交付证据

- `npm run verify:core`：145/145。
- `node docs/reviews/P2_ACCEPTANCE_REPRO.cjs`：7/7。
- `node docs/reviews/P2_ACCEPTANCE_ROUND2_REPRO.cjs`：5/5。
- `cd mobile && npm run typecheck`：通过。
- APK：现有 `dist/apk/debug/ShineWord-V0.2.0-p2.8-debug.apk`，SHA-256 `2C1E68CC41BB79B8289A90EA9A3C3AE03B9E23F3B4F679688BD3B9FDB8E293CF`。分钟投影修复后的 Gradle 封包在 JDK 17、21 下均被 Windows IPC 错误 `Unable to establish loopback connection` 阻断，未生成新 APK。5558 的 debug 客户端从当前工作树 Metro 运行本轮 JS；Metro bundle SHA-256 `45d1788f8e2bea8aa67fad9015ff4d53771ffadc0405d02113dfc59227e1a332`。
- 设备截图与脱敏证据：`C:\Users\Administrator\AppData\Local\ShineWord\qa-evidence\p2.8\`，含援救/战斗恢复/攻击截图 42～45，以及杀进程重开后短休到 v34、原始快照 `clockSeconds=5436` 与 `clockMinutes=90` 一致的 53 号证据；快照 JSON SHA-256 `845e447570e396f354ca93e15d8077ae239529c7834da1f3c6e62a2a0c46c595`。测试数据库备份在本机 Temp。
- 完整 G01～G06 编号与原方案章节映射、战斗事务/快照证明和逐项证据见 `docs/reviews/P2_ACCEPTANCE_CLOSEOUT_R5.md`。旧报告和第一轮/第二轮复现均保留。

## §1M 全量构建（resident 模式）— 2026-09-29

按 `docs/Shine-TRPG_1M_RESIDENT_BUILD_PLAN.md` 完成 P0–P5 施工（分支 `feature/1m-resident-build`）：

- 打包器 v2：输出预算驱动（content×0.7/est，组上限 32 语义化为证据归属可靠性），在线校准 estOutputPerChunk；解除 8k 输出硬钳；GLM 不可关思考档强制 ≥8k 输出头寸。
- provider：DeepSeek/GLM reasoning 方言透传（仅显式声明）；resident 三段消息（system + 全书 user + 范围指令）；probe v2（前缀缓存双发探测、输出上限探测）。
- coordinator：`mode:'resident'`（85% 窗口 + 前缀缓存门，不满足事务性退化 windowed 并记录原因）；N worker 并发（默认 3，TPM×0.7 封顶）；claimUnit 原子条件 UPDATE；reasoning_only 先升预留重试再拆分。
- Pass 0 全书实体注册表（幂等检查点、scope 注入）；Pass 2 WorldMapper V2（resident 单批全量 facts + ruleMappings，证据纪律同 checkEvidence，windowed 路径不变）；ruleMappings 经 applyExtraction→commitChunkResult 同事务落库，mappingId 稳定幂等；Pass 3 时间线（模型仅提议，本地 resolver 兜底）。
- mobile：DeepSeek V4.1 Flash / GLM-5.3-Flash 预设（1M 窗口、16,384 内容输出、GLM low+2048 预留）。

回归：`npm run verify:core` 266/266；mobile typecheck 通过。真实端点端到端指标（缓存命中率、耗时、费用）未验——见 `docs/reviews/1M_RESIDENT_BUILD_REVIEW.md` 未取证项清单。
