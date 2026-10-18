# M3：真实开局、游玩与剧情因果

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL / BLOCKED-PLAYER-AND-GLM-CONFIG。

## 已验证

- 当前分支 APK 在专用 AVD 上打开真实小说的 published partial world，项目页明确显示可开始冒险；World setup projection 成功加载。
- 开局向导到达“身份与姓名”第一步。姓名为空，“下一步”保持禁用；数据库此时 campaigns=0、turns=0。
- 由于这是玩家决定的真实入口，执行者没有替玩家填写姓名、选择原创/原著身份、锚点、地点、同行者、目标、行动或骰点，也没有创建 campaign。模拟器暂留在该输入页，等待真实玩家继续。
- 开局页自动 goal suggestion 请求因当前本地凭据配置返回 HTTP 401，已知失败且无 usage；没有自动重试 unknown。真实 GLM 后续请求暂停，等待有效本地配置。

## 未完成的验收

尚无真实玩家决定、合格 L1 或有效 L2 planner 决策、骰点结算、Narrator、原子 SQLite turn commit、下一轮行动机会或玩家对剧情因果的确认。物理 real-model action turns=0，player decisions=0。Core 确定性回归与已发布世界包不能替代这些结果。

阶段 9.5 与阶段 9 的结论保持 PARTIAL；继续条件为：有效 GLM 本地配置，以及由真人选择的角色和开局意图。没有将自动化测试、默认角色或模型建议算作玩家选择。
