# 本地收口基线与环境

记录时间：2026-10-18（Asia/Shanghai）
目标：ShineWord Phase 9.5 本地终验。此处只记录脱敏环境信息；不包含密钥、小说正文、私有存档或原始 HTTP 内容。

## Git 基线与隔离

- 远端：`https://github.com/anjingdtl/ShineWord.git`
- 执行 `git fetch origin` 后，实际 `origin/main` 与原本地 `main` 均为 `87eef899281f267a17e02357cc643dd475cabd7c`；本地与远端无 ahead/behind，原 `main` 工作树干净。
- PR #14（Phase 9.5 runtime convergence）已合并，merge commit 与上述 HEAD 相同。基线 HEAD 检查：Core Verify #139 / run `38989018424` success；Android Verify #103 / run `38989018421` success，均绑定该 SHA。
- 起始盘点的既有 worktree：`F:\c95`（`c94e62e`）、`F:\ClaudeWorkSpace\projects\ShineWord-phase95-closeout-20261015`（`2bbf179`，落后当时远端 22）、`F:\sw95`（detached `08b6452`）。Git status 均干净；其中 `F:\sw95` 有被 Git 忽略的私有 `test-logs`，按历史数据保留，不执行写入、删除或重放。
- 新建隔离 worktree：`F:\ClaudeWorkSpace\projects\ShineWord-phase95-local-final-closeout-20261018`，分支 `fix/phase95-local-final-closeout-20261018`，从当时的 `origin/main` 创建。原仓库、其他分支与 worktree 未改写。
- `git fetch origin` 成功；PR #14 的合并状态也由 GitHub connector 只读确认。`gh pr view` 本机 CLI 返回 HTTP 401，后续远端操作使用已连通的 GitHub app 能力或再验证凭据，不以该错误推断远端不可用。

## 本机工具链

- Node.js `v24.14.1`；npm `11.14.1`（符合仓库 `>=24.3.0` 要求）。
- Temurin JDK `17.0.19+10`；`JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot`。
- Android SDK：`C:\Users\Administrator\AppData\Local\Android\Sdk`；ADB `1.0.41` / `37.0.0-14910828`。`adb devices -l` 起始时无运行设备。
- Android emulator 位于 SDK 内，初始 AVD 列表有 8 个既有模拟器（含 API 37.1 Play Store 镜像）；全部未启动，未使用或清除其数据。SDK 已安装 API 37.1、Build Tools 37.0.0 与 16 KB page size x86_64 镜像。
- 仓库 Gradle wrapper 为 `9.3.1`。SDK manager 提示命令行工具的 SDK XML 版本旧于当前元数据，并报告重复的 `platform-tools-2`；实际 `adb` 解析为标准 SDK `platform-tools\adb.exe`。
- 起始可用内存约 19.5 GiB / 31.7 GiB；C: 可用约 65.9 GiB，F: 可用约 520.8 GiB。

## 已发现测试材料与预算门

- 本地 TXT 存在，大小 `7,178,905` bytes，SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`；本机检测为 Windows-936/GBK，章节标题计数 1,498。只读取元数据用于识别；正文未写入本目录。
- 本机 GLM 配置在用户回复确认已轮换后更新；脱敏识别为 endpoint host `open.bigmodel.cn`、模型 `GLM-5.3-Flash`。凭据值及其指纹不写入证据。用户确认轮换不等同于费用核验，真实调用仍须通过预算门。
- 只读检查 `F:\sw95\test-logs\phase9-5-longrun-2026-10-11\budget-manifest.json`：既有 scope cap `600`、spent `510`、remaining `90`；510 条物理 dispatch 均为 `completed`，未发现 `prepared/sent/outcome_unknown`；`lastReservation` 能匹配一条 completed dispatch。该忽略文件保留原样，不重置、不增加 cap、不克隆、不借用额度。
- 起始 M0 盘点按附件默认值记录至多 20 次 / ¥10，后续用户对本项目明确授权不限额度；该初始保守门已被后续直接授权覆盖。实际调用与费用状态见最终 checkpoint 和 REAL_NOVEL_AND_LLM.md。

## 本节点证据边界

这是 M0 环境与基线记录，不代表本地依赖安装、Core/Android 构建、模拟器旅程、真实模型、真实玩家或完整阶段验收已通过。后续各节点的实测结果另行记录。

## 最终状态（覆盖施工中的临时观察）

- 用户明确授权本项目 GLM 测试不设额度上限；实际物理并发峰值为 1。累计请求及 token 使用见 [真实小说与 GLM 报告](REAL_NOVEL_AND_LLM.md)，账户 CNY 实扣仍无账单证据。
- 配置更新前的 `opening_goal` HTTP 401 保留为已知失败；用户随后更新本地文件并确认 GLM 连接测试成功，应用侧新请求 HTTP 200。未对旧 401 重派；原始密钥/指纹未写入本文件或仓库。
- 本地测试小说只通过 SAF 导入 CRLF 私有副本，模型 scope 为 source 0–9,600 code points；未传全书。章节计数差异待查。
- 再次 `git fetch origin` 后 `origin/main=87eef899281f267a17e02357cc643dd475cabd7c`。本轮施工 worktree 为 `F:\sw95local-20261018`，分支 `fix/phase95-local-final-closeout-20261018-short`；原始 checkout、main 和其他 worktree 保持原样。
- PR #15 已存在且未合并；当前最终修复和报告位于该分支。检查结果以 PR #15 当前 SHA 的 live checks 为准，不引用旧 head。
- 私有 mock fault 世界与小说 GLM 世界分开。旧 localhost 429 与 `network_unknown` 均保留在 needs_review，未修改、确认或重派；没有从 ignored history ledger 借用额度。