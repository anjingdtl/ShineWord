# 本轮现场基线

记录时间：2026-10-15 15:22:18 UTC 首次远端核对；本文件更新于 R2 提交 `b871b882180b33d664ab93b2a1e427e25a726cfa`（本地时间 2026-10-16）。

## 仓库与 Git

- 仓库：`https://github.com/anjingdtl/ShineWord.git`（`origin` 已核对）。
- 远端基线：执行时 fetch 得到 `origin/main = 599d038efa6a65d7107f276961bc7b66caab37f6`。
- 本地原始 checkout：`F:\ClaudeWorkSpace\projects\ShineWord`，`main`、HEAD 同为 `599d038…`，工作树初始 clean；未在其中施工。
- 施工 checkout：短路径 worktree `F:\c95`，分支 `codex/phase95-closeout-short`，从上述 `origin/main` 创建。
- 既有 worktree `F:\sw95` 保持 detached HEAD `08b64522939b2fd84b5cb2762296538ad70b5ef3`，未改动。
- 阶段提交：R0 `2bbf1797aa3074bf762855c6d516dd5b2fa2d334`；R1 `40e85a29b1192e75be38821c1c5e4c3c15b02744`。
- R4 `b51331a678ae50927dc1ea8feb84bd548a9bafba`；R0、R1、R4 的源码/测试提交保持独立。
- R2 D14 元数据校正 `b871b882180b33d664ab93b2a1e427e25a726cfa`；`ownedFields` 仅描述能力相关状态域，既不参与 binding/hash，也不执行写入隔离。

## 工具与资源发现

- Node `v24.14.1`、npm `11.14.1`、OpenJDK `17.0.19`。
- `ANDROID_HOME` 当前解析到 `C:\Users\Administrator\AppData\Local\Android\Sdk`；`adb` 存在，emulator 程序位于 SDK 的 `emulator` 子目录。
- AVD 目录 `F:\avd`，发现 `ShineWord_P2_Clean` 等 QA 模拟器；核对时 `adb devices -l` 无在线设备。未启动模拟器、未安装 APK、未清理或重置用户数据。
- 已确认 GLM 测试配置与授权小说素材存在；仅核对存在性/字节数，不读取密钥或原文内容、不复制到仓库。本轮没有真实模型派发，预算 scope 与费用上限未提供。
- 当前 worktree 未发现本轮可合法核验的私有账本、原始 attempt 响应或历史运行 SQLite；旧报告的 budget/unknown 结论只作为历史背景，不继承为本轮账目。

## 远端与 CI

- 方案 SHA 仅作定位，代码施工和测试基于上述 fetch 的远端 main。
- GitHub CLI 身份显示已配置但 token 无效；推送/PR/CI 状态待本轮完成后重新核验。未创建 PR、未合并、未发布。
- `AGENTS.md`：仓库与父目录未发现文件；用户消息提供的协作规则适用。

## 证据边界

- 当前工程测试是本地合成/SQLite 证据；不能代替 Android UI、真实模型、完整真实旅程或独立试玩。
- 上述绝对路径仅为本机现场索引；后续 CHECKPOINT 使用逻辑资源名以便跨机器接续。
