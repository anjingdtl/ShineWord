# 接续检查点

更新时间：2026-10-16 09:58，Asia/Shanghai。当前检查点位于 `main`；本轮生产代码与证据发布提交为 `c94e62e1dd7f6ceea4ca92253d68d6a500b1780d`，其 Core Verify #135 与 Android Verify #100 均成功。本检查点后续提交只更新文档；接续时用 `git rev-parse HEAD` 与 `origin/main` 确认最终提交身份。生产APK SHA-256 `3d74e582f40a6203cb997e682e1d767eccdd9eaf70758b129c4e49c9c429095b`，110,156,351 bytes。

## 当前现场身份

- 仓库逻辑名：ShineWord。
- origin：https://github.com/anjingdtl/ShineWord.git。
- 最新fetch：2026-10-16 01:58 UTC；`origin/main` 与 main worktree 在本检查点文档更新前均为 `c94e62e1dd7f6ceea4ca92253d68d6a500b1780d`，0/0 ahead/behind，工作树干净。施工分支 `codex/phase95-closeout-short` 也已推送到该提交。
- worktree：逻辑资源 phase95-closeout-worktree；主 worktree 在 `F:/ClaudeWorkSpace/projects/ShineWord`，施工 worktree 在 `F:/c95`；`sw95` detached evidence worktree 和 10/15 worktree 均保留原状。接续时应重新发现 worktree。
- PR：#13 base main/head c94。c94 快进进入 main 后，GitHub 于 2026-10-16 01:51:41 UTC 自动将 PR 记录为 merged；没有显式调用 PR merge，也没有发布 Release。
- Android逻辑资源：phase95-isolated-avd:ShineWord_Phase95_20261016，API37 / x86_64 / 1080×2400 / 420dpi / 约3GB RAM。设备只运行隔离测试APK；未卸载、未清数据。
- R5本地mock已停止；无在途本地测试请求。endpoint只监听宿主loopback。
- 用户提供的GLM配置与小说资源逻辑引用为 user-authorized-GLM-test-profile、user-authorized-novel-fixture；本轮均未读取内容、未进入仓库。

## 当前节点

R0–R4有先前定向工程证据；R0本轮聚焦复验13/13。R5新增合成APK行动与force-stop冷启动后的同turn回放，仍PARTIAL。R6保存/迁移/三意图隐私保持PARTIAL。R7等待当前budget scope、真实旅程和有效决定证据。R8补做小屏单视口与TalkBack焦点/语义冒烟，但匹配性能、完整可访问性和独立试玩仍未完成。R9证据交接完成；本轮发布提交 c94 的 Core Verify #135、Android Verify #100 均通过。阶段验收仍PARTIAL。

## 通过证据

- R0 node --test tests/game-opening-chain.test.cjs：13/13。
- QA helper复审修复了合成存档生成器覆盖输出的问题；正常导出与冲突路径保护均通过定向验证。
- R5合成save/world依赖拒绝与导入、UI自由输入、skill-check、3d6骰点和commit；branch camp-mva64y1h-main 冷启动后仍v2，行动/结果/耗时/骰型/骰值/叙事回放断言通过。
- R5 local mock日志11条：campaign_plan 7、Planner 2、Narrator 2；真实provider请求0；该turn一对Planner/Narrator，无重播；新建outcome_unknown=0。
- APK与installed base.apk SHA一致；APK信息见 ANDROID_EVIDENCE.md 与 EXECUTION_IDENTITY.json。
- 小屏结束后显示恢复为1080×2400/420dpi，TalkBack设置恢复为关闭/null；隔离AVD没有卸载应用或清理数据。
- 生产/证据提交 `c94e62e1dd7f6ceea4ca92253d68d6a500b1780d` 的 CI：Core Verify #135（38837360165）success；Android Verify #100（38837360167）success，含 mobile typecheck 与 Debug APK 构建。27a515b/#133/#98 和 3e48e437/#134/#99 均保留为较早 tip 的历史通过证据。

## 未决事项、责任与恢复条件

| 事项 | 责任角色 | 恢复条件 |
|---|---|---|
| 真实GLM/R7与配额旅程 | 产品预算持有人/模型授权者 | 给出本轮有效budget scope、物理请求cap、费用/用量边界及可用授权配置；建立逐attempt账本后才开始有界真实测试。 |
| 历史预算差异与outcome_unknown | provider/应用账本持有人 | 只读提供同scope provider逐attempt ledger、应用SQLite和原始响应/传输关联；先核对身份，未证明可安全恢复前不重派。 |
| save-10/Stage-1/8精确回放与旧库兼容 | 历史QA资产持有人/维护者 | 提供来源、hash、branch/turn身份一致的合法只读资产；先在副本核验，再决定可执行回放。 |
| 80个有效决定、UI份额与自然结局 | 产品/内容QA负责人 | 依据阶段9原合同绑定旅程/分支和语义审核；合成回合、A40压力不计数。 |
| 四名独立试玩者 | 产品/内容QA负责人 | 4名未参与施工的参与者完成四问与六维评分。 |
| 匹配10+10真实性能、完整可访问性、API24与实体机 | QA/设备负责人 | 提供相同模型/设备/材料基线和最终样本，代表设备及TalkBack人员。 |

## 预算与unknown

- 本轮真实provider/GLM物理请求：0；budgetScope=null；physicalRequestCap=null；feeBoundary=null。
- 合成loopback HTTP：11；均有本地响应，不属于provider账本或付费请求。
- 本轮outcome_unknown：0。历史unknown及预算差异：NOT VERIFIED，未改账、未清零、未自动重派、未借用额度。
- 本地 mock campaign_plan HTTP 200没有通过业务校验；不可计为候选有效或采用成功。

## 源码/APK/证据与下一安全动作

- R5/R8续跑未修改生产代码；此前施工分支包含R0–R4与后续R1/R2/R4修复。已测提交c94的Core/Android CI通过；本轮已安装APK SHA与installed base.apk相同。阶段9.5、阶段9遗留均为PARTIAL。
- 续跑证据目录：docs/reviews/phase9-5/closeout-2026-10-16-run-continued-local-ui/。
- 下一最小安全动作：另一台机器先 `git fetch origin`，确认 `main` 与 `origin/main` 同 SHA、工作树干净，再按本检查点与 ACCEPTANCE_MATRIX.md 继续。依赖未到位时仅做本地确定性工程验证。没有新一轮明确的budget scope、请求上限和费用边界前，不启动真实付费调用；不得重派unknown或改历史数据。
