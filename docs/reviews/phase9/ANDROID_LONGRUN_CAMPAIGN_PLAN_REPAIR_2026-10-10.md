# Android 长程验收：战役规划修复进度（2026-10-10）

## 本次范围

本记录覆盖真实模拟器长程验收中发现的战役计划候选校验失败，以及对应的候选修复提示和回归。它是阶段性工程记录，不代表第九阶段整体验收通过。

真实规划的自动修复已把两个 consequence 的效果消费关系放到触发阶段之后的必做阶段；该候选随后仍因 clue 的 `sourceEntryIds` 引用了冻结目录之外的条目而被拒绝。针对这两类校验错误，本次在 `generationService.ts` 增加候选定点修复指引：从候选依赖图计算可用下游主阶段，为支持的效果生成结构化消费者条件示例；对越界目录 ID 指示只删除被拒值并保留合法 provenance。生产校验规则、原始模型响应和失败历史均未修改。

## 代码和回归

- 源码：`src/application/campaignPlan/generationService.ts`
- 回归：`tests/phase9-planning-budget.test.cjs`
- 新增回归覆盖：下游 consequence 消费阶段、`grant_knowledge` 对应条件、循环门槛修复约束、目录 ID 与 `sourceFactIds` 命名空间隔离，以及一次有界修复请求。
- 定向测试 `node --test tests/phase9-planning-budget.test.cjs`：23/23 通过。
- `npm run build:core`：通过。
- `npm run verify:core`：1250/1250 通过。
- `npm run typecheck --prefix mobile`：通过。
- `npm run verify:version`：通过，应用版本仍为 1.0.0 / version code 1000000。
- `npm run apk:debug --prefix mobile`：通过。
- `git diff --check`：通过；Git 只提示工作区换行符转换。

## 模拟器与预算证据

- 设备：`emulator-5554`，包名 `com.shineword.app`。
- 新 Debug APK 已以 `adb install -r` 覆盖安装；安装前后 `firstInstallTime` 为 `2026-10-05 03:29:05`，保留了原安装和用户数据。
- 本地 APK 与从设备拉取的 `base.apk` SHA-256 相同：`eea0eb1efd47cdd4699bc85ce5a52d753a8d1fe99208a4b4ad1653b2e61e532f`；APK 大小 109,646,695 字节。
- 安装后 `versionName=1.0.0`、`versionCode=1000000`；本模块没有做版本升级。
- 当前代码身份（identity scope v3）：生产源码 hash `b5b2b5597b689e661c57e3e986b8a646458e99f91c9e875993bb05f474cd3d9b`。记录时 HEAD 为 `35b8358329aa27ba38b476d7b3c8ed53a4ff8b71`；提交后应以最终提交 HEAD 和安装 APK 哈希关联。
- 本轮隔离模拟器账本 `.tmp/phase9/simulator-longrun-20261010/dispatch-budget.json` 显示 200 上限中已用 76、剩余 124，reserved=0，outcome_unknown=0。旧失败规划没有恢复或重放；本次修复后的 APK 尚未再次创建规划，因此没有新增有效玩家决定。

## 未闭合项与下一步

修复提示目前由集成回归覆盖，尚缺修复后新战役的真实 UI 规划复验。下一步应从应用中创建独立新战役，用当前已安装 APK 走正式新规划入口；不要恢复先前失败的规划。检查自动修复是否同时产出目录内引用与可追溯的下游效果消费，再继续真实用户决定及其后果消费验收。

该复验完成前，不能把本模块称为模拟器验收闭环，也不能据此宣布 A01–A40、80 个有效决定或整个第九阶段通过。当前没有版本升级或发版；本次提交只作为可审阅的修复检查点。
