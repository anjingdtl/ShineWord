# Phase 9.5 long-run baseline and stop snapshot

## 最新定向复验身份（2026-10-12）

- 分支/HEAD 不变。生产 scope-v3：c472f040b0744bae6edec171e6d4c42cae7609820308f88d13a49f1219115dad。
- 605 文件路径→SHA256 JSON 补充指纹：f225d765495932e6f999deaafa24089b434fb3634e86fc5b589d4b9493dc6a45；私有逐文件清单 test-logs/phase9-5-followup-2026-10-12/identity.json。
- Debug APK：110046827 bytes，18881ec96e97f8e6c6ec5a0eb74cf9ed226c1ca41c4f8d08f30abab5fcf4e907，V1.0.0 / 1000000，未安装。
- 定向 33/33、core 1300/1300、移动 typecheck、version、Debug build、diff PASS。精确副本新 fork 的正式后继采用/使用及 J1 新行动提交通过；全部是离线进程内响应桩，原数据和预算不变。
- Android 只读启动被自动审批拒绝，端上 NOT RUN。完整证据、初次失败及边界见 [定向复验追加](FOLLOWUP_VERIFICATION_2026-10-12.md)。下面的身份继续作为历史记录保留。

## 2026-10-12 修复后身份追加

原停测身份保留于下方。本次进入/结束的独立指纹配方、逐文件增量及结果见 [修复复验记录](REPAIR_VERIFICATION_2026-10-12.md)，私有清单为 test-logs/phase9-5-repair-2026-10-12/entry-identity.json、exit-identity.json。

- 分支/HEAD 未变。scope-v3 生产指纹：30d9ff5c0abbaf0bdd1e851d52d5cfa475b2c6f7b3f34aff658072984c84b7de。
- 603 文件的补充路径→SHA256 JSON 指纹：9990c5fd6564e74d172ce807ff51e0968d1e52755ee70f203e429321a84f0477；不冒充旧 9275fb… 的同配方指纹。
- 新 Debug APK：110044959 bytes，ebf2a4aa38c16e6eb9d1ec5a7eea7c82aded733da6a111e5b4eb210e4f2ef4cc，V1.0.0 / 1000000。只构建未安装，设备仍保留旧安装身份。
- 最终 verify:core 1298/1298、移动 typecheck、version、Debug build、diff check PASS。第一次全量两个失败保留，修复边界后重跑全绿。
- 原 J1 精确快照只读检查前后哈希相同；预算仍 453/600，新增真实请求 0。没有设备/存档/原失败/版本号改写。

**报告截止：** 2026-10-12（Asia/Shanghai）
**状态：** 用户要求结束测试并汇总；本文件以下的当前状态取代早期“in progress”检查点。测试、模拟器操作和产品代码改动已停止，只整理已保存证据。

## 当前身份

- 实际工作树：F:/sw95；分支：codex/phase9-5-emulator-longrun；HEAD：6710e3007fc73df16b9f647b62affd7336a0c37b。
- 工作树包含未提交的生产代码、测试和工具修改；本报告没有改动这些文件，也没有提交、推送、合并或发布。
- 对 src、mobile/src、mobile/scripts、tools、tests 中 601 个 TS/TSX/JS/CJS/MJS/Java/JSON 文件按相对路径与 SHA-256 汇总的当前源码指纹：9275fb6a1f208c7af94e6b33f5b3d5aae8a61d86e6c26d00b6615a5cf3e1ccb4。它用于标识当前脏工作树，不能替代逐文件 diff。
- 当前 Debug APK：F:/sw95/dist/apk/debug/ShineWord-V1.0.0-debug.apk，V1.0.0 / versionCode 1000000，110,046,787 bytes，SHA-256 B8CD7B64992702A2C8658BEECAFD49124CBF9AAF89A13C863024E54C322E90E6。已有设备侧读取结果与本地产物哈希一致；没有在报告阶段重装或重新构建。
- Android：emulator-5554，Android 17 / API 37；包名 com.shineword.app。最后界面是战役列表。应用数据保留，没有清除或卸载。
- 源身份核对：完整小说文件原始字节 SHA-256 为 7f45fe0b11ea30eca95f5a736232dd4c466a57f0c2cc9f67530e432015ecc6f4；配置指纹为 5992f5fe6919e95c77ab68782e7b4e90e3a3c7314a98059699ad31c493b7d90e。报告不包含小说正文、提示词、响应或密钥。

## 工程门禁与设备证据

本轮最终代码身份下已有记录的工程门禁为：

- npm run verify:core：1293/1293 通过。
- npm --prefix mobile run typecheck：通过。
- npm run verify:version：通过。
- npm run apk:debug：成功，当前 APK 哈希如上。
- git diff --check：通过。

这些是停止前的已有结果，并非本次报告阶段重新执行。它们不能替代 UI 长测、独立玩家评估或 Phase 9 全矩阵复验。

J1 的只读 SQLite 快照 quick_check=ok；BUG-95-009 中的未提交回合仍被冻结。J4A/J4B 和新战役有多份 UI 树、审计 JSON 与只读数据库快照保存在忽略证据目录。没有宣称整次长测期间完成了完整崩溃、ANR、存档导入、冷恢复或 10+10 性能验收。

## 物理请求账本

只有一个 Phase 9.5 作用域：F:/sw95/test-logs/phase9-5-longrun-2026-10-11/budget-manifest.json，scope shineword-phase9-5-20261011，硬上限 600。停止时 spent=453，账本有 453 条物理 attempt，全部 completed，sent=0、outcome_unknown=0；剩余 147 次没有使用。这个数字是物理模型请求数，不能称为玩家回合或有效决策数。

## 旅程状态摘要

五份主旅程审计的提交回合/候选有效行动数分别是：J1 54/31、J2 33/16、J3 11/6、J4A 70/37、J4B 68/36。J4A/J4B 的审计包括分叉前继承历史，候选值不可直接相加。它们也尚未按原合同的 UI 理由、实际用途和分叉去重口径逐项人工确认为有效决策。80 个有效 UI 决策未获证明。

停止时可恢复的新战役 camp-mv51iswg-main 为 v8；J1 主线 camp-mv3mw9hk-main 为 v70，turn-0071 有成功骰点但尚未提交；J2 在 v39 自然进入 failed 终态；J3 在 v15 自然完成；J4A 为 v86、J4B 为 v84，均为活动分支。详见 CHECKPOINT.md。

## 初始基线（历史起点，非当前身份）

- 实际隔离工作树从 6710e3007fc73df16b9f647b62affd7336a0c37b 开始。主工作树在任务开始前已有修改；其跟踪文件补丁与清单保存在 C:/Users/Administrator/AppData/Local/Temp/ShineWord-phase9-5-baseline-20261011/，补丁 SHA-256 为 C3958AAAD88CC0B3CE70D9C004B8E862E84239299FD714C010772FD8E10A9A27。
- 初始 Debug APK 是源码改动前构建，103,771,573 bytes，SHA-256 4839a669250d36aa15306818d593a77af92366d92c241c27c455478ddbba8499。它不是当前安装 APK。
- 小说原文件为 7,178,905 bytes，GB18030，完整文件经 Android 系统文件选择器导入；报告不包含正文。
- 实际 provider 配置显示名 GLM-5.3-Flash；配置密钥留在应用既有安全存储。密钥及请求正文未保存到公开报告。
