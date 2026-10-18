# 性能、交互与无障碍摘要

日期：2026-10-19。具体观测值和受限条件见 [完整性能报告](../local-final-closeout-20261018/PERFORMANCE_AND_ACCESSIBILITY.md)。

- 已有有限的长会话 PSS/RSS/GfxInfo、软键盘焦点、大字（1.3）、portrait/landscape、360×800dp 虚拟显示、暗色模式和终局页控制证据。
- production synthetic fixture 的真实 GLM matched 10+10 结果为 20/20 committed turns、30 个 HTTP 200、最大并发 1；L1 平均 6.705 秒，L2 平均 8.901 秒。该样本不是小说 package method 性能，也不能换算人民币成本。
- TalkBack spoken output / focus order、多窗口、API 24、真实小屏设备、完整大字页面尚未验证。TTS 语音可懂度与自然玩家可用性需要人工听测；本轮没有新增 AVD。
- 主小说 AVD 留在原运行进程与数据库状态；M4 故障 AVD 留在合成恢复提示页。两者数据未清理。
