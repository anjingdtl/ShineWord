# 缺陷登记摘要

日期：2026-10-19。此前代码修复、RED/GREEN、细节和保存安全结论见 [既有缺陷登记](../local-final-closeout-20261018/DEFECT_REGISTER.md)。

## 本分支新增确认并修复

### Native SQLite/plain object 错误显示为 [object Object]

- RED：合成设备 outbox abort 后，玩家 UI 显示 [object Object]。
- 根因：玩家行动提交 catch 用 String(error) 格式化非 Error 的原生对象。
- 修复：新增共用错误格式化函数，保留正常 Error/string；对未知原生对象给出中文安全 fallback。回归见 tests/play-error-message.test.cjs；提交 99b1d89。
- 二次 RED：首次修复仍把 SQLite trigger 细节直接显示给玩家。
- 最小修复：不展示未知 native object 内部字段，使用安全提示；同一 M4 AVD 的注入 UI 检查通过；提交 477bebf。
- GREEN：本次完整 Core 回归 1,366/1,366、mobile typecheck、version check 通过；M4 屏幕没有 [object Object] 或数据库细节。

### Narrator 成功态写入失败

- M4 response-write 注入证明应用在 responseJson/hash 无法持久化时将 attempt 保留为 outcome_unknown，冷启动不重派；不是生产代码缺陷，无新增修复。
- 待处理 turn 和骰点保持冻结；unknown 没有获准重试。

### PlayHeader 大字号/窄屏标题消失

- RED：现有 M4 合成战役在 font scale 2.0 下切到 stacked header 后，标题从截图和无障碍树中消失；同屏确认重试入口仍可见。设备截图见 `evidence/play-header-large-font-red.png`。
- 根因：共用 Header 的标题容器在 inline 与 stacked 两种方向都使用 `flex: 1`。切换到纵向堆叠后，标题容器的零基准 flex 尺寸让标题无法获得内容高度。
- 最小修复：抽出 `headerTitleContainerStyle`，inline 保留 `flex: 1`，stacked 改为 `width: 100%` 的内容尺寸行；未改 campaign/runtime 状态或提交路径。
- GREEN：布局合同 RED 后 2/2；mobile typecheck 通过；当前 branch Debug APK 在既有 M4 AVD 重装后，large-text 与 360dp Maestro 标题断言均通过。APK/base.apk hash 相同；数据库仍 2,338,816 bytes；未知回合未点击/重派。见 `evidence/play-header-layout-regression.md` 与配套截图。

## 未关闭的工程/验收项

- 真实小说 sample 正常 review gate 仍有 1 blocking mapping constraint 与 3 major invalid proposals；未发布 package。
- 真实小说包的 source-evidence L1 与 method entry 未证明。
- 双 worker 设备竞态未被现场注入；现有 Core lease/fence tests 通过。
- Stage-1/8 有身份历史资产、TalkBack/多窗口/API24/真实小屏、真人玩家和独立试玩仍缺。
