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

### M5 Alpha 验收 — 进行中

目标：多 OpenAI-compatible Provider（GLM + MiniMax/DeepSeek）、能力探测、预算与重试/取消/超时、故障注入、20 万字基准 + 100 万字压力、真机/模拟器验收、APK 交付物。

## 本地验证命令

```bash
npm install
npm run verify:core

cd mobile && npm install && npm run typecheck
gradle -p mobile/android :app:assembleDebug   # 或 CI 同版本 Gradle 9.3.1
```

M1/M2 已具备：无 LLM 多回合内核 + LLM Planner/Narrator 安卓闭环 + 断网恢复。下一步进入 M3 原著世界构建。
