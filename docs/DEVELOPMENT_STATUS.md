# ShineWord 开发状态

更新日期：2026-09-27

## 当前阶段

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

## 当前阶段（二阶段）

### P2-0 基线整改 — ✅ 完成（模块 + App 接入 + 模拟器通过）

- [x] 历史回退：完整快照（skills/relationships 每次提交盖入）+ fork 从分叉点单事务恢复；遗留快照拒绝伪造历史。
- [x] 分支 Canon 覆盖层 `branch_canon_overrides`（迁移 005）：`canon_events.status` 永不被分支改写；`listEvents(branchId)` 合成分支状态。
- [x] 开局时间锚点强制 + validFrom/validTo/revealAt 三重过滤 + 证据可见性约束映射（后期技能无法漏进早期开局）。
- [x] 成长重做：去重键 `(branch, encounter, actor, skill, kind)` + `reward_ledger` 硬防双奖（同事务中止）；满阈值仅"可训练"，晋阶须显式训练（导师/资源/前置）；里程碑 1～2 练习点。
- [x] 结算原子化：奖励/技能/关系/战利品与回合同一 SQLite 事务，快照结算后盖章。
- [x] 端上解码：分块 UTF-8（Hermes 安全）+ 生成式 GBK 表（23940 码全表对照 0 误差）+ UTF-16；同源哈希世界自动续建。
- [x] 存档 v2：canonical payload 摘要、完整校验、`restoreSave` 单事务恢复为新战役（依赖/哈希显式校验）。
- [x] 回归：核心测试 88/88 → 后续累计 104/104。

### P2-1 世界包与三宝书 — ✅ 完成（模块 + App 接入 + 模拟器通过）

- [x] 内容模型：11 类条目、条目/字段级 provenance（explicit/inferred/rule_mapping/design_fill/user_override）、三级可见性。
- [x] 发布验证器：逐 kind 校验、悬空依赖/依赖环拒绝、战斗数值完整门槛；发布不可变 revision，blocking 冲突禁止发布。
- [x] 三宝书 = 同一包三个视图（player_handbook / gm_guide / monster_manual），同一技能全库单源。

### P2-2 建卡与真实战役 — ✅ 完成（模块 + App 接入 + 模拟器通过）

- [x] 统一 ActorCard（玩家/同伴/NPC/生物）；原创卡预算硬约束（4 自由点/单项 3 上限/3 技能/4 准备槽）。
- [x] `createCampaign` 单事务：依赖锁、开局锚点、队伍、卡片、资源、主目标、首分支、完整快照；依赖缺失显式失败，无演示回退。
- [x] `CampaignSession`：显式 campaignId/branchId；**demo-main 固定上下文/固定 2d8/固定属性已全部移除**；骰点完全由角色卡 + 世界技能目录驱动。
- [x] 移动端重构：书架（逐分支）→ 三宝书阅读（来源标签）→ 开局向导 → 剧情页（行动/休整/训练/回退）。

### P2-3 规则闭环 — ✅ 模块完成 + 部分设备验收

- [x] 世界钟 clockSeconds；V0.2 效果白名单（restoreResource+cap、引擎专用 removeCondition/grantItem）；合同来源区分（planner/engine）。
- [x] 遭遇流程：冻结先攻（敏捷→洞察→稳定 ID）、区域距离带、NPC 确定性策略、一次性战利品。
- [x] 设备端：休整/训练门禁/回退/恢复实测通过；敌对遭遇的设备端完整触发未实测（模块级测试覆盖），列入 Beta。

### P2-4 小说自动三书 — ✅ 完成（模块 + App 接入 + 模拟器通过）

- [x] WorldMapper 管线：严格 JSON、枚举白名单、数值字段强制 rule_mapping 标注；本地清洗；design_fill 兜底（明确标注）；冲突 blocking 阻止发布；LLM 畸形自动降级可发布。
- [x] 端上接入：抽取 → 映射 → 发布 → 书架三书/开局全链路。

### 模拟器实测（Medium_Phone / API 37.1，真实 GLM-5.3-Flash）

- [x] 自创小说全流程：导入 → 构建 → 三宝书 → 建卡 → 开局 → 行动（3d6 卡片驱动）→ 休整 → 训练门禁 → 回退 → 杀进程恢复 → 双游戏隔离（证据：DB 快照 + 截图，见 `docs/reviews/P2_REVIEW.md`）。
- [x] 《白篱梦》前 10 章：26 块抽取、158 实体/211 事实、发布 r1、4 个 major 审核项如实拦截。
- [x] 《白篱梦》中断续建：失败重入复用全部成果；全书 100 万字（944 块）推进 45 块后杀进程进度保留、续建无重跑（全书完整抽取约需 4 小时模型时间，机制已验证）。
- [x] GBK 小说端上完整构建（一期限制解除）。

回归结果：Core tests 104/104、core + mobile typecheck PASS、`:app:assembleDebug`/`:app:assembleRelease` BUILD SUCCESSFUL。

### 交付物与已知限制

- 交付：`dist/apk/debug/ShineWord-V0.2.0-p2.1-debug.apk`（全部模拟器验收基于它）。
- 未验收（如实标注）：Release 签名 APK 未重建（`SHINEWORD_RELEASE_*` 口令仅维护者掌握；`assembleRelease` 打包链路已编译验证，注入口令即可出包）；设备端敌对遭遇完整剧本、存档导出/导入 UI 入口（领域闭环已测试）、真机/minSdk 24 环境未验收。
- 详细缺陷修复记录与证据索引：`docs/reviews/P2_REVIEW.md`。

## 本地验证命令

```bash
npm install
npm run verify:core

cd mobile && npm install && npm run typecheck
# Windows: 使用 wrapper 缓存 Gradle 9.3.1
gradle -p mobile/android :app:assembleDebug
# Release 签名包（需维护者环境）:
#   SHINEWORD_RELEASE_STORE_PASS / SHINEWORD_RELEASE_KEY_PASS 注入后
#   gradle -p mobile/android :app:assembleRelease
```

M1~M5 + P2-0~P2-4 已具备：无 LLM 确定性内核 + 安卓 LLM 闭环 + 原著世界构建 + 完整游戏系统 + Alpha 工程化 + 二阶段世界包/三宝书/角色卡战役/自动三书。下一步：P2-5 编辑与迁移交付、P2-6 Beta 验收（长程/多模型/设备性能/故障注入收口）。
