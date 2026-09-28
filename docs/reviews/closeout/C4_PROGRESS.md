# C4 真实动态进度与任务界面

日期：2026-09-28。基于 C3 提交后的工作区。全部命令本机实测。

## 目标与出口（对照总控方案 C4 行）

全阶段真实计量、重进页面恢复、失败任务可定位；四主题、可访问性；不得模拟百分比。

## 实现

### 数据层（`mobile/src/buildTasks.ts`）

- `listOpenBuildTasks()`：直查 `world_build_runs LEFT JOIN imported_sources`，返回持久化快照（phase、status、units_done/total/failed、lastErrorCode/Message、租约占用判断）。SQL 已用 node:sqlite + 全量迁移冒烟验证列名与过滤条件。
- `listFailedUnits(runId)`：前 10 个 failed_retryable / needs_review / failed_terminal 单元（unitId、错误分类、attempt）——失败可定位到具体单元。
- `taskProgressLine()`：**只渲染已提交计数**（"抽取事实 3/12 组 · 1 待重试"）；无计数时只给阶段名，不制造百分比或 ETA。

### 任务卡（`mobile/src/ui/features/library/BuildTaskCard.tsx`）

- 复用现有主题化组件（Card/Bar/Button/typeStyle），四主题自动生效；Bar 带 `accessibilityLabel`（"构建进度 N of M 组"），进度不只靠颜色传达。
- 真实比例条 = `units_done / units_total`（DB 提交值，非计时器推算）；运行中显示**暂停**，非运行态显示**继续构建/开始构建**；失败显示错误分类与消息摘要；可展开 runId/计数/更新时间明细。
- `LibraryScreen`：`refresh()`（focus 与操作后都会跑）加载任务列表，渲染在导入卡上方；`resumeTask` 走 `runExtraction`（租约门禁保证同 run 单执行者）；`pauseRun` 通过模块级 abort 注册表让在途 `executeRun` 在下一个单元边界停止——协调器释放租约并把 run 置 `paused_user`，进度留在 DB。

### 恢复语义

- 重进页面 / 重启进程：任务卡从 DB 重读，计数不归零、任务不丢（C2/C3 的 run/unit 表即事实源；回归测试已覆盖崩溃后续建不重付）。
- 进度回调（`onUnitDone` → 页面文案）只作即时刷新提示；真相永远以 DB 为准，丢事件后重新 focus 即恢复一致。

## 门禁与证据

| 门禁 | 结果 |
|---|---|
| `npm run verify:core` | 181/181（本阶段无核心代码变更，C2/C3 已覆盖任务表行为） |
| `npm run typecheck --prefix mobile` | **EXIT=0** |
| debug APK | BUILD SUCCESSFUL（见构建输出） |

四主题/44dp 触控面：任务卡全部由现有主题化基础组件构成（Button 自带 hitSlop 触控补偿）；逐主题截图验收归 C7 设备矩阵。

## 边界与移交

- **系统通知**与前台常驻通知由 C5 前台服务承接；本阶段提供了通知所需的同一持久化快照读取函数。
- 映射阶段（buildPackageFromCanon）目前仍在抽取完成后由页面 Promise 驱动，其进度走 onProgress 文案；把映射并入 run/unit（phase=mapping 的 map_batch 单元）是后续整合项。
- 暂停是"下一单元边界"语义：在途的单个 LLM 请求不被中断（避免半途废弃已付 token）；取消后晚到响应由租约 fencing 拒绝提交。
- 任务卡的设备端实测（重进页面、进程重启、四主题渲染）在 C7 验收。
