# 隐私、存档与兼容证据

## 自动化合同

前一轮R6定向集合58/58通过，覆盖SQLite约束、save导入/导出、迁移边界、fork和历史绑定、坏hash/依赖拒绝、禁止字段导出、replan历史保护。输入均为合成fixture和临时数据库。完整命令与边界见本目录 TEST_REPORT.md。

## 本轮 Android 合成存档

- 使用生产fixture/export代码生成一个合成save和匹配的world archive；hash、大小见 R5_SYNTHETIC_UI.md。
- 在world缺失时，Android SAF save导入明确拒绝依赖缺失，没有创建半campaign；随后先导入world、再导入save成功。
- 成功导入后在新campaign中走一轮合成行动，并在force-stop/relaunch后看到同一骰点、结果和叙事。
- 这是新建合成数据，不是用户私有save、真实历史save-10或原著小说。
- 未访问 GLM 配置内容、用户小说正文、私有SQLite、签名材料或模型原始响应。

## 未关闭范围

R6仍PARTIAL。尚未完成J1/J2/J3三意图对CampaignPlanner、Planner、Narrator、公开引子/标题/方法/机会投影/记忆/日志的全层对照；未对用户原始数据库进行只读完整性和外键检查；未验证历史save-10身份/兼容、Stage-1/8精确回放、坏hash等全部输入在设备上零写入和零HTTP。

恢复条件：由资产持有人提供可合法只读复制的历史save/SQLite及来源hash；只在副本核对身份和schema，再做往返/拒绝差异验证，保留原件。
