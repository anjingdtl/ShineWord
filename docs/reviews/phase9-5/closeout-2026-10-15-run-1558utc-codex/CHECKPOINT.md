# 接续检查点

更新时间：2026-10-16（Asia/Shanghai；R2 文档补记后、R5 设备验证前）

## 当前身份

- 仓库逻辑名：`ShineWord`；`origin`：`https://github.com/anjingdtl/ShineWord.git`。
- 本轮 fetch 基线：`origin/main = 599d038efa6a65d7107f276961bc7b66caab37f6`；待推送前重新 fetch 核验。
- 施工分支：`codex/phase95-closeout-short`；当前源码 HEAD：`b871b882180b33d664ab93b2a1e427e25a726cfa`。
- 原主 checkout `F:\ClaudeWorkSpace\projects\ShineWord` 与既有 worktree `F:\sw95` 均未施工；本轮在短路径 worktree `F:\c95`。
- 当前工作树：仅有 `progress.md` 和本轮证据文档的待提交记录；R0、R1、R4、R2 源码/测试分别已提交。临时 APK 不绑定此 HEAD，不作为交付产物。
- 当前节点：R3 工程合同 PASS、私有账本 NOT VERIFIED 已记录；继续 R5 构建与保留用户数据的 AVD UI 验证，随后 R6/R7/R8/R9。

## 已通过证据

- R0 D01：远端 main 基线 `game-opening-chain` 9/10；修复定向 13/13，历史 Core 1317/1317。提交 `2bbf179…`。
- R1：`npm run verify:core` 1328/1328，0 failed/skipped/todo；引用、修复边界及冻结历史完成条件合同。提交 `40e85a2…`。
- R4：`node --test tests/phase9-journey-audit.test.cjs` 9/9，含真实 Session 写入临时 SQLite 与源库只读 hash。提交 `b51331a…`。
- R2：D14 `ownedFields` 对齐 `GameStateSnapshot.discoveries`；`npm run build:core` 通过，定向测试 34/34。提交 `b871b88…`。
- R3：预算 authority、并发/fence、preview/approval/recovery、unknown 与 timeout targeted tests 53/53；仅证明合成/本地合同，不含本轮私有运行账本。
- R3 对账边界：见 `REQUEST_RECONCILIATION.md`；物理请求 0；历史额度与 unknown 未继承、未更改、未重派。
- `DEFECT_REGISTER.md` 记录 D01、D04、R01、R4-AUDIT-01、D14 的反例、修复与证据边界。

## 未决与资源

- Android 逻辑设备：QA AVD `ShineWord_P2_Clean`；最近核对时 adb 无在线设备。保留现有 userdata，仅使用升级安装 `adb install -r`；不 wipe、uninstall、clear data。
- Android SDK、adb、emulator、Node/npm、JDK 17 已发现。最终同 SHA 构建、设备身份和 APK SHA 尚未生成。
- 用户授权的 GLM 配置与小说素材以逻辑名登记；内容未读取、未入仓。本轮没有明确预算 scope、物理请求数上限和费用边界，因此真实模型请求为 0。
- 本地未找到本轮可核验的历史私有账本/原始 attempt；旧 `outcome_unknown`、账本差异与旧额度一律不继承、不改账、不重放。R3/R7 保持 PARTIAL / NOT VERIFIED。
- 设备 UI、真实完整旅程、80 个有效决定、人工可访问性检查、4 名外部试玩尚无本轮证据。
- GitHub CLI 凭据曾报告无效；推送、PR 和 CI 尚未完成，需收尾时重查可用认证路径。

## 下一最小安全动作

提交当前证据文档更新；执行 R5 适用移动端类型/版本/Debug APK 门禁，启动已有专用 AVD 并在保留数据前提下安装和检查实际 UI。后续源码不再变更后，重跑最终 Core/mobile/version/APK 与 diff 门禁，写齐验收矩阵和报告，复核远端基线并尝试推送施工分支/创建 PR。
