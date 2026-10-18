# Phase 9.5 存档历史效果往返修复

日期：2026-10-19（Asia/Shanghai）

## 缺陷与 RED 证据

真实 Android 存档导入前后的只读 SQLite 快照显示：源分支 `camp-mvdsy3v4-bmve82mhb` 有 11 条回合记录，其中 1 条 `effects_json` 非空；导入分支 `camp-mveazmft-main` 同样有 11 条记录，但非空效果数为 0。受影响行为回合为 `turn-0006`，提交版本 6，原始效果字段 110 字节，SHA-256 为 `3cfab6aa1a4636821cc2fc455392683be0a716c8eae5d2bea8357405d947eaf5`。报告不包含效果文本或小说内容。

修复前新增的离线测试 `save round-trip preserves the exact effects JSON of a committed historical turn` 以 1 个 RED、3 个相关既有用例通过结束。RED 断言显示导出对象的 `effectsJson` 为 `undefined`。根因是导出 SQL 未读取 `turns.effects_json`，而恢复 SQL 固定写入 `'[]'`。

## 最小修复

- `SavedTurn.effectsJson` 作为可选的 `save-10` 字段保存数据库中的原始 JSON 字符串，不改数据库 schema 或既有冻结合同。
- 导入校验要求该字段（存在时）为 JSON 数组；不合法数据继续拒绝。
- 新存档恢复时写回原始字符串；旧 `save-10` 文件缺少该字段时仍回退到既有 `'[]'` 行为。

## GREEN 证据

- 定向历史回归：4/4 通过，覆盖提交回合精确保留、旧 `save-10` 兼容和无效效果数据拒绝。
- `npm run verify:core`：1,360/1,360 通过。
- `npm run verify:version`：通过，`1.0.0 / versionCode 1000000`。
- `npm --prefix mobile run typecheck`：通过。
- `npm --prefix mobile run apk:debug`：成功；独立 APK SHA-256 `8c027e060195476ad971c4c25feba37394b3c034c4ca948e574bc1fdd4e8219`。
- APK 通过 `adb install -r` 更新到既有 `emulator-5556` Phase95 AVD；安装后设备 APK 哈希与构建产物一致，未新增 AVD 或清空应用数据。
- Android 原生 UI 端到端：从原始分支导出到新文件，经系统文件选择器导入成独立副本，再从副本导出。源存档与导入副本都通过生产 `validateSaveJson`（`ok=true`、无错误），均有 11 条回合、stateVersion 10；非空效果均为 `turn-0006` / 提交版本 6 / 110 字节，SHA-256 与修复前源记录一致。导入副本标识为 `camp-mvebj83j-main`。导出文件使用新的 QA 文件名，未覆盖原存档。
- 端上流程未发起模型请求；安装和复测后没有发现 `FATAL EXCEPTION` 或应用 ANR。日志中出现的 `no such module: fts5` 来自启动时的 FTS5 能力探测；生产探测捕获不支持结果并走本地搜索实现，不属于本次存档缺陷。

## 验收边界

这证明了已自动化的存档历史导入/导出行为及当前 APK 端上回归，不代表真人玩家体验，也不单独构成阶段 9.5、Runtime 工程收口或阶段 9 历史遗留的整体验收结论。真实 GLM 测试与完整阶段验收仍按各自证据单独报告。
