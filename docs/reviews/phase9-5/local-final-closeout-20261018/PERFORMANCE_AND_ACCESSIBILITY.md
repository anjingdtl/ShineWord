# M5：性能与交互检查

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL；只覆盖 API 37 专用 AVD 和 0–9,600 code-point 小说样本。

## 实测

- 私有 GBK TXT 的 7,178,907-byte CRLF 副本完成 SAF 导入；设备 SQLite 解析 1,504 chapters / 3,260 chunks。GLM 只收到开篇 0–9,600 code points。
- 从测试 world 创建 `13:16:34.738` 至 partial package ready `13:25:19.020` 共 524.282 秒。world_extract 约 40.95 / 35.80 秒，style_analyzer 12.15 秒；其他本地阶段未拆分，因此不把首次 ready 时间归因于模型。
- 最新 APK 完成多轮开局/Runtime QA 后，终局页当前 `dumpsys meminfo` TOTAL PSS `196,443 KB` / RSS `285,960 KB`。GfxInfo 自该 activity 进程统计起 10,169 frames、modern jank 140（1.38%），p50/p90/p95 `17/30/31 ms`；历史 legacy jank 2,988（29.38%）。这是长会话累计值，不是独立冷启动或固定交互 benchmark。
- 姓名输入框焦点冒烟通过；模拟器 Gboard 首次打开的手写教程被取消，系统屏幕键盘菜单打开后正常输入并提交过 QA action。该教程是 AVD 初始输入法状态，不作为应用缺陷。
- 临时将系统字号调至 1.3 时，开局核心字段和按钮仍可见，长标题以省略号截断；测试后恢复 1.0。
- Runtime failed 的终局页检查了隐藏变更候选、禁用 composer 与提交按钮；没有禁用只读 Runtime 状态显示。当前 crash buffer 采样未发现 app FATAL EXCEPTION。

## 未验

- TalkBack 未启用（secure accessibility_enabled=0）；焦点顺序与无障碍播报为 NOT RUN。
- 未运行旋转/多窗口、API 24 / 小屏设备、大字完整页面、长历史滚动和完整战役各屏布局矩阵。
- 没有匹配 L1/L2 各 10 次的真实请求性能、TTFT 或费用对比；本轮仅有 campaign-scope fixed-empty-evidence L1 样本，world package 仍没有 method entry，也没有非空 evidence L1。
- PSS 与 GfxInfo 样本来自长会话，不应与独立、固定步骤基准比较，也不能外推低端设备表现。
