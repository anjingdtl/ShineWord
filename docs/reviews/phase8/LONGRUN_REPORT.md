# 长程实测收尾报告（200+ 轮，2026-10-05）

## 执行概况
- 目标：完整 TXT 导入 → 完整构建 → ≥200 轮真实回合 → 分模块采集 BUG → 修复回归。
- 结果：**206 轮有效成功**（part1 21 + part2 185），零回合失败；novel-gbk（1576 章完整导入）完整构建 4/4 步完成，记忆 6/6 批；游戏状态 v29→v144，时钟、骰点、引导全程正常。
- 设备：emulator-5554（Medium_Phone API 37.1）；V0.8.0（80000）→ 修复后同版本重装。
- 真实 GLM：约 470+ 次物理请求全部入账本（planner 164+ 成功、narrator 161+ 成功、memory_checkpoint 73 + memory_repair 27 成功等），2 条 planner outcome_unknown 保留审计。

## 发现的 BUG（按模块）

| 模块 | 编号 | 严重度 | 现象 | 根因 | 修复 | 回归 |
|---|---|---|---|---|---|---|
| 导入/书库 | BUG-IMPORT-DEDUP-1 | 高 | 同源 TXT 再导入谎报「已创建项目 fangqienu」，实际静默合并进已有 novel-gbk 世界；下游：开局按钮无响应、审查页标题错位、「规则 0.2.0」误读 | UI 用文件名造项目名并作导航 title，而 worldId 指向已有世界（同源去重为设计行为） | toast 诚实区分 reusedSource；导航 title 用真实世界标题；标题查询下沉 projectLibrary.getWorldTitle（UI 不触 DB） | 重导入显示「该小说已存在项目「novel-gbk」…」，落在正确项目页（截图 regression-reimport-notice.png） |
| 后台协调器 | BUG-MEM-LAG-1 | 高 | 144 回合后记忆整理停在 v51（failed/dirty@41），outbox v42..144 共 93 行卡 running 永不恢复 | claim 只匹配 pending/retryable；worker 中断后过期 lease 的 running 行永不可重领 | claim 接受过期 running 行（fencing token 递增保证安全）；无记忆能力时不认领已索引行（防 8 行死循环） | 真实设备 DB 副本：93 行全部回收，记忆 51→80 推进至 clean、dirty 清空、剧情目标内容保留 |
| 调度/UX | BUG-SCHED-1 | 低（定性） | 单次回合「正在结算」最长 ~5 分钟无进度反馈 | mobile provider 超时 300s 为 reasoning 模型合法上限；极端尾部等待而非挂起 | 不改（UI 反馈优化待产品决策）；驱动等待窗放宽 | 长测自愈继续 |

## 附带验证
- 驱动与手动 uiautomator 会话互斥（测试规程问题，非产品）；人工干预改纯坐标 tap。
- 完整 TXT 二次导入解析 1504 章 · 3260 块与首次一致（确定性解析）。
- 设备 DB FK 检查 0 违规；branch_events 行数符合回合效果分布（观察类回合事件少）。

## 遗留
- BUG-SCHED-1 的 UI 进度反馈（如"已等待 X 秒"）未做。
- fangqienu 项目从未真实存在；如需"同名新项目"语义（同源多项目），需要产品决策 + world 归属模型扩展。
