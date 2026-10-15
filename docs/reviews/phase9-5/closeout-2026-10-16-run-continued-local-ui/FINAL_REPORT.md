# 最终续跑报告

本文件只总结 closeout-2026-10-16-run-continued-local-ui，不覆盖 closeout-2026-10-15-run-1558utc-codex 的历史结论。

## 结论

- 阶段9.5关闭：PARTIAL，未满足关闭合同。
- 阶段9遗留整体关闭：PARTIAL，未满足A01–A40、80个有效决定和UI份额。
- R0当前去重回归13/13；R5新增当前Debug APK上的本地合成行动、骰点、Narrator、提交和冷启动精确回放；R8追加单视口小屏布局与TalkBack焦点/节点语义冒烟。
- 本轮未修改生产源码；改动是确定性Android QA mock/合成存档生成器与可审查证据。代码复审发现生成器可能覆盖既有输出，已改为独占写入并验证冲突时原文件SHA不变。
- 当前真实完整玩法旅程0，有效玩家决定0，独立试玩0/4；合成UI行动不记入配额。
- 真实GLM/provider物理请求0，当前budget scope/cap/费用边界为空；历史私有账本和unknown仍NOT VERIFIED。
- PR #13保留Draft/open，不自动合并main、不发Release、不修改用户数据。

## 发现与处理

R0方案记录的候选去重问题当前已有最小代码修复和回归；在当前分支再次运行 tests/game-opening-chain.test.cjs，13/13通过，无需重复施工。

R5以前只有合同测试和有限首屏证据。本轮用合成fixture确认缺世界依赖时存档导入明确拒绝；安装合成世界包后导入存档并在当前APK中提交一轮skill-check。UI呈现同一行动的3d6骰点1/2/4、成功、10分钟和故事。force-stop/relaunch后campaign仍v2，重新打开能逐项回放相同行动、骰点和叙事。

本轮没有证据证明真实provider或历史save-10路径。campaign_plan mock HTTP 200未通过业务合同；Narrator对第一条合成Talk行动的文字意图不匹配。两项均保留为测试夹具限制，没有降低生产校验或改写旧turn，也没有据HTTP 200宣称候选有效。

## 节点状态

R0、R1、R2、R4保留既有PASS-ENGINEERING；R3 PARTIAL；R5 PARTIAL（新增合成APK路径但缺历史/故障矩阵）；R6 PARTIAL；R7 BLOCKED/PARTIAL；R8 PARTIAL；R9 PARTIAL-HANDOFF。G/V95/A01–A40完整矩阵见 ACCEPTANCE_MATRIX.md。旧工程报告、A40结果和R0–R4根因登记仅作为独立历史证据引用，不冒充本轮重跑。

## 测试与身份

- R0：13/13当前聚焦回归。
- QA helper：两文件 node --check 通过；本地mock白名单日志11条；Maestro冷启动回放assertions通过。
- QA helper生成安全：正常fixture导出hash与设备输入一致；已存在输出路径拒绝覆盖且sentinel原样保留。
- 生产Debug APK：110,156,351 bytes，SHA-256 3d74e582f40a6203cb997e682e1d767eccdd9eaf70758b129c4e49c9c429095b；与安装base.apk SHA一致。它是此前生产输入b4641bd构建的同一APK，本轮未重建。
- 最近与生产输入匹配的CI为PR #13 head 28b8615：Core Verify #132、Android Verify #97均success。当前续跑提交推送后的CI状态在CHECKPOINT与PR记录更新。

## 预算与资料

- 真实请求0；本地loopback mock 11次；本轮新unknown 0。
- 历史未知attempt或预算差额未读取、未改账、未重派。GLM配置与小说正文均未读取或入仓。
- 完整责任角色、恢复条件及下一安全动作见 CHECKPOINT.md。
