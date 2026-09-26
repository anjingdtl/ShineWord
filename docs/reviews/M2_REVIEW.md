# M2 Review / Fix 报告

日期：2026-09-27  
Review 分支：`phase/m2-android-loop`  
M2 基线提交：`40e3c1823136846b68679d57c0dbbfdaa43f5b7b`

## Review 范围

- LLM 权限边界（Planner / Roll / Narrator 职责隔离）。
- OpenAI-compatible Provider、Fetch Transport、每回合物理请求预算。
- API Profile 与 Key 引用分离、Keychain 安全存储。
- 回合状态机、ActionContract 本地验证、合同哈希。
- 先持久化 RollRecord 再调用 Narrator；重试禁止重掷。
- SQLite 原子提交、stateVersion 比较交换、幂等重放、迁移执行。
- Narrator 失败 / 进程中断后的恢复策略。
- Android 应用壳（`com.shineword.app` / `shineword.db` / 独立 Keychain namespace）。
- Android Native SecureRandom 与 Native SHA-256 桥接。
- 基础游戏 UI 与 API 设置页。

## Review 结论（基线 `40e3c18`）

核心链路审查全部通过：

- Planner 只输出 ActionContract；`diceCount`、`dieSides`、`randomValue`、`rolls`、`highest`、`margin`、`grade`、`balance`、`newLevel` 等本地权威字段被合同验证拒绝。
- 骰点由本地拒绝采样引擎执行，Narrator 收到的是已冻结的 grade；`validateNarrative` 拒绝 Narrator 改写 outcomeGrade。
- RollRecord 先持久化再调用 Narrator；恢复时复用 staged 合同与已持久化骰子，`FailIfUsedRandom` 测试证明恢复路径不触发 RNG。
- SQLite `commitAtomic` 在单事务内完成 stateVersion 比较交换、状态重写、快照、回合标记与事件追加；`(branch_id, committed_state_version)` 唯一索引阻止同分支重复结算。
- Narrator Candidate 不可变；提交后不得回退为 Candidate。
- API Key 仅写入 Keychain（`WHEN_UNLOCKED_THIS_DEVICE_ONLY`），AsyncStorage 只保存不含 Key 的 profile（keyRef 引用）。
- 请求预算默认单回合 4 个物理请求，Planner + Narrator 正常消耗 2 个。

### 发现问题

1. **P1（UI 功能缺陷）**：设置页保存时无条件写入 Keychain。当 API Key 输入框为空时 `KeychainSecretStore.set` 抛错，导致用户无法只修改 Endpoint / Model；且设置表单不回填已保存 profile 的值。
2. **P2（数据可见性缺陷）**：已提交回合历史只存在于内存 FlatList，重启后剧情列表为空。SQLite 中数据完整但 UI 未读取；同时 FlatList 以 `turnId` 作 key，重复提交同回合会产生重复 key。
3. **P3（工程卫生）**：`.gitignore` 只覆盖根级 `android/` 构建目录，`mobile/android/` 的 Gradle 产物与 `local.properties` 未被忽略；仓库缺少 npm lockfile。

## Fix

- `mobile/App.tsx`：设置表单回填当前 profile；仅当输入了新 Key 才写 Keychain，未输入时校验 Keychain 已有 Key，否则提示输入；回合列表按 `turnId` 去重合并。
- `mobile/src/runtime.ts`：新增 `loadHistory()` 从 SQLite 读取已提交回合（叙事 + 骰子摘要）。
- `src/infra/sqlite/sqliteTurnStore.ts`：新增 `listCommittedTurns(branchId)`，联查 turns / turn_narratives / roll_records，含类型谓词的行窄化。
- `tests/m2-loop.test.cjs`：30 回合测试追加历史联查断言（数量、排序、叙事状态、无骰回合 / 有骰回合区分）。
- `.gitignore`：补充 `mobile/android/` 构建产物与 `local.properties`。
- 提交根目录与 mobile 的 `package-lock.json`。

## 回归结果

### Core Verify（本地 + GitHub Actions）

- tests: 38
- pass: 38
- fail: 0
- typecheck: pass

覆盖：30 回合 scripted Planner/Narrator 连续游戏（含历史联查断言）、离线 Narrator 失败恢复（不重新 Planner、不重掷）、SQLite 明确事务 / 回滚 / 串行化、迁移、概率公式、拒绝采样、资格判定、合同校验、恢复策略、平台适配器。

### Mobile / Android

- mobile TypeScript typecheck: PASS
- `:app:assembleDebug`（Gradle 9.3.1，与 CI 同版本）: BUILD SUCCESSFUL
- debug APK：`mobile/android/app/build/outputs/apk/debug/app-debug.apk`（约 71 MB）

### 本地模拟器 Smoke Test（Medium_Phone / API 37.1，emulator-5554）

debug APK 为 RN dev 变体（`debuggableVariants = ["debug"]`，不内嵌 bundle），通过 Metro + `adb reverse tcp:8081` 加载 JS。LLM 侧使用本地 mock OpenAI-compatible 服务器（`http://10.0.2.2:8787/v1`），未使用任何真实 API Key。

| # | 场景 | 结果 |
|---|---|---|
| 1 | APP 正常启动 | ✅ |
| 2 | 无启动白屏 / Native crash | ✅（首启 RedBox 为 dev 变体缺 bundle，Metro 接入后消失，非缺陷） |
| 3 | API 设置页正常显示 | ✅ |
| 4 | Endpoint / Model / API Key 可输入 | ✅（Key 输入框为密文显示） |
| 5 | API Key 不写入 AsyncStorage / SQLite / shared_prefs | ✅（全 app 数据目录 grep 0 命中） |
| 6 | Keychain 写入可用 | ✅（保存后进入游戏，重启后仍生效） |
| 7 | 游戏主界面正常进入 | ✅ |
| 8 | 全新安装执行 SQLite migration | ✅（`schema_migrations` v1 core + v2 narratives） |
| 9 | Demo campaign 自动初始化 | ✅（`demo-main` 分支 + actor + snapshot v0） |
| 10 | Native SecureRandom 可被 JS 调用 | ✅（真实骰点 `2d8:[3,2]`、`2d8:[5,6]`） |
| 11 | Native SHA-256 可被 JS 调用 | ✅（合同哈希驱动 RollRecord 校验链，骰子持久化成功即证明） |
| 12 | 自由行动 → Planner → local rule → Narrator | ✅（mock 收到 Planner esv=0，本地掷骰定 grade，Narrator 按冻结 grade 叙事） |
| 13 | 关闭 APP 重进 SQLite 数据仍在 | ✅（重启后历史从 SQLite 加载，骰子与 DB 一致） |
| 14 | Narrator 失败不改变已投骰结果 | ✅（故障注入 500 后 turn-0002 停在 Resolved、`[5,6]` 已持久化；重试只调 Narrator，骰子不变，`success` 提交） |
| 15 | 已 Committed 回合不二次结算 | ✅（turn-0001 重启后无变化；同 turn 重放走 committed 读取路径） |

## 已知限制

- Demo 世界将 `resolveRollSpec` 固定为 `attribute: 2 / skillRank: trained`；角色属性与技能派生在 M4 成长系统中接入。
- Demo 世界没有 Canon 事实库，`evidenceIds` 仅作占位引用；M3 接入真实证据校验。
- 设置页能力字段（JSON mode / 上下文窗口等）为固定默认值，M5 做能力探测。
- 回合内等待只有 busy 状态，无"拟定检定 / 等待投骰 / 生成剧情 / 校验"分步展示（剧情页增强随 M3/M4 推进）。
- debug 变体不含 JS bundle；Alpha 分发使用 release 变体（M5 处理独立签名，不复用 ShineWriter keystore）。

## M2 出口结论

建设方案出口条件"在小型人工世界完成 30 回合，可断网恢复"已满足：

- Core 测试 38/38 通过（含 30 回合连续游戏与离线恢复）。
- Android debug 构建成功，模拟器 15 项 smoke 全部通过，含故障注入下的骰子不可变与恢复。
- API Key 全程未进入任何明文存储、日志或仓库。
