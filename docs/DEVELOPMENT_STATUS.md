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

### M3 原著世界构建 — 进行中

目标：TXT 导入 → 不可变原文 → chapter/chunk → fact extraction → entity merge → timeline/conflict → world rule mapping → interactive world；fact 五类状态与证据定位；时间有效性、事件依赖与 divergence marker；NPC 认知隔离；原著/自创角色开局。详见 `docs/CONSTRUCTION_PLAN.md` 第 4、5 节。

## 本地验证命令

```bash
npm install
npm run verify:core

cd mobile && npm install && npm run typecheck
gradle -p mobile/android :app:assembleDebug   # 或 CI 同版本 Gradle 9.3.1
```

M1/M2 已具备：无 LLM 多回合内核 + LLM Planner/Narrator 安卓闭环 + 断网恢复。下一步进入 M3 原著世界构建。
