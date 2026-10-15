# 隐私、存档与兼容证据

## 本轮执行

定向命令：

node --test tests/m4-game.test.cjs tests/phase9-sqlite.test.cjs tests/phase9-domain.test.cjs tests/phase9-clues.test.cjs tests/phase9-fork-save-history.test.cjs tests/phase8-save9.test.cjs tests/migrations.test.cjs tests/phase6-save-compatibility.test.cjs tests/phase9-replan.test.cjs

结果：58/58 通过。覆盖 SQLite 约束、存档导入/导出、迁移兼容边界、fork/save 历史绑定、坏 hash/依赖拒绝、私有字段禁止导出、replan 与历史状态保护等自动化场景。测试使用本地合成 fixtures 和临时数据库。

## 隐私材料边界

- 用户提供的 GLM 配置与授权小说素材已确认存在，但本轮没有读取内容、没有写入仓库、没有用于真实模型派发。
- 自动化检查中的秘密值为合成标记。覆盖到的字段拒绝和导出路径不能代替按 J1/J2/J3 全层级对照 CampaignPlanner、Turn Planner、Narrator、引子、标题、方法、机会投影、记忆和日志。
- 本轮没有任何真实模型响应、小说正文或密钥进入日志、提交、报告或截图。

## 结论与缺口

R6 为 PARTIAL。工程自动化证明若干存档、迁移和隐私约束仍有效；没有完成 save10 当前 APK 往返后继续行动、所有坏输入零写入/HTTP 的端到端设备证明、三意图完整隐私矩阵、用户真实库 integrity/foreign_key 检查或历史存档身份核验。不得将旧报告中的私有数据库结果作为本轮结果。

恢复条件：取得可合法复制的私有存档/SQLite 只读快照及其源码/APK 身份后，先校验 hash 与 schema，再在副本上做往返、拒绝输入和差异审计；原件保持只读。
