# C5 Android 后台执行与 C6 命运状态机

日期：2026-09-28。基于 C4 提交后的工作区。

## C5：前台服务 + Headless runner

### 实现

| 文件 | 内容 |
|---|---|
| `WorldBuildForegroundService.kt` | `HeadlessJsTaskService` 子类：`dataSync` 前台类型、低优先级常驻通知（点击回应用、真实计数文本、`setOnlyAlertOnce`）、6h 任务超时上限、`onTimeout` 诚实停止（不清假完成）、`START_REDELIVER_INTENT` |
| `WorldBuildServiceModule.kt` | JS 桥：`startService(runId)/stopService()/notifyBuildProgress(done,total)`；后台启动限制下 start 失败返回 false（UI 内联兜底），桥上只过 runId 与整数计数 |
| `mobile/src/buildRunner.ts` | Headless JS 任务 `WorldBuildRunner`：只收 runId；凭据不可得时安静退出（run 保持可恢复）；进度回写通知 |
| `mobile/src/buildServiceBridge.ts` | RN 侧服务桥接 |
| Manifest | `FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_DATA_SYNC`、`POST_NOTIFICATIONS`、`WAKE_LOCK` 权限 + `dataSync` service 声明 |
| `index.js` | `AppRegistry.registerHeadlessTask` |
| `LibraryScreen` | 导入完成即 `startBuildService(runId)`（不等重度解析），失败回退内联执行；续建同样优先服务。**单执行者由 run 租约保证**，服务与 UI 双入口不会双跑 |

### 编译与静态证据

- `gradlew assembleDebug`：**BUILD SUCCESSFUL**（含新 Kotlin 三文件）。
- `npm run typecheck --prefix mobile`：EXIT=0。
- debug 安装到 emulator-5554（API 37）：`Success`；冷启动进程存活（debug 包无 Metro 时 JS bundle 不加载，属 RN debug 变体预期；自包含验证使用 release 包，见下）。

### 设备验证（emulator-5554，API 37 / Android 17 镜像）

- release（versionCode 13，0.3.0-closeout）构建与签名校验见 C7 报告。
- 冷启动、通知渠道、服务前台化的逐项矩阵在 C7 统一执行记录（同一安装源），本阶段先交付代码与编译证据。

### 边界（如实记录）

- Android 15/16 真机的 dataSync 6h 累计限时、Doze、锁屏 Keychain（`WHEN_UNLOCKED_THIS_DEVICE_ONLY`）行为**未在本轮实测**（模拟器 API 37 无法代表 15/16 限时语义）；`onTimeout` 已实现诚实停止 + DB 可恢复，但端上触发路径待 C7 或后续真机矩阵。
- 锁屏下凭据不可得 → headless 任务安静退出、run 保持可恢复（设计如此，未在真机锁屏实测）。
- 通知权限拒绝场景：FGS 仍可运行（Android 13+ 无通知不阻断 dataSync FGS），UI 可见性差异未逐屏验证。

## C6：disabled fate 合同驱动状态机

### 实现（`src/domain/combat/disabledFate.ts`，纯规则引擎）

- **SceneFateContract**：每遭遇一份，规则按 priority 排序、first-match；`appliesTo` 区分 player/companion/npc；`minDisabledRounds` 支持延迟触发。
- **四种结局出口**：`awaits_rescue`（保持 active 等待援救/治疗）、`death_risk`（逐轮计时，`lethalAfterRounds` 到期死亡，`stabilize` 重置时钟）、`encounter_ends`（按指定 outcome 结束遭遇）、`ends_campaign`（触发指定 endingId）。
- **触发/退出**：失能进入 pending → 规则命中转 active（`fate_assigned` 事件）→ 救援（`rescueFate`，仅 captured/death_risk 可救）/治疗（自动 freed）/计时死亡（`fate_resolved died`）/结局（`ending_triggered`）。
- **权威事件**：每次转换返回 `FateEvent[]`（assigned/escalated/resolved/ending/encounter_end），引擎自身不落库——由调用方按现有事件管道持久化。
- **快照/rewind/save**：`EncounterState.fates?: Record<actorId, DisabledFateState>` 随遭遇快照原样序列化；回退到旧快照重放得到完全一致的确定性路径（测试覆盖）。
- **合同校验**：未知 fate、重复 priority、ends_campaign 缺 endingId、death_risk 非法阈值均拒绝。

### 回归证据

`tests/closeout-c6.test.cjs` 7 项全过（含在 188/188 总量中）：合同校验 ×4 拒绝路径、规则选择（side/同伴/延迟）、玩家失能→战役结局、同伴被俘→援救/治疗双出口、NPC 濒危逐轮升级→阈值死亡、stabilize 重置时钟、快照往返+回退重放确定性。

### C6 边界（移交 C7 / 后续）

- 命运引擎是**独立规则模块**；encounterService 逐回合调用点、遭遇合同从世界包 ContentEntry 装配、HUD 命运展示与三书/旅程 UI 的完整接线未在本轮完成——同一次援救不能闭项，本阶段交付的是可独立审查的合同状态机与快照语义。
- 完整 1+2 队伍 App 端到端旅程（探索→社交→战斗→休整→成功训练→知识/任务/三书/rewind/存档）需要已发布世界包 + 真实模型构建后才能在最终包上执行，归 C7 验收矩阵（当前未通过项如实记录）。
