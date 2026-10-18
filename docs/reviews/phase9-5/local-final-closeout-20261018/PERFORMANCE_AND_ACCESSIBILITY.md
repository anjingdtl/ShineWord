# M5：性能与交互检查

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL；样本范围仅限 API 37 专用 AVD 和开篇样本。

## 实测

- TXT 7,178,907-byte 私有副本完成 SAF 导入；设备 SQLite 中有 1,504 chapters、3,260 source chunks。全书本地解析不等于全书发给模型；GLM 仅收到 0–9,600 code points。
- 从测试 world 创建 13:16:34.738 至 package ready 13:25:19.020 为 524.282 秒。该窗口内两条 world_extract 分别 40.95 秒和 35.80 秒；一条 style_analyzer 12.15 秒。等待时间没有分解到设备 CPU、SQLite、lease 或轮询阶段，因此不声称模型决定了全部等待。
- 当前安装包运行时 dumpsys meminfo 样本：TOTAL PSS 130,997 KB、TOTAL RSS 180,504 KB。Gfxinfo 自进程统计起 139 frames、22 janky frames（15.83%）；p50 20 ms、p90 38 ms、p95 81 ms。不是独立冷启动/长时 benchmark，也不代表整场战役性能。
- 姓名框焦点冒烟通过：输入法显示状态为 true；返回键后 mInputShown=false。没有输入文本。
- 在专用设备临时设字号 1.3 时，开局身份页可见姓名框、身份切换和主按钮，未见内容溢出到屏幕外；顶部长标题以省略号截断。系统 font_scale 已恢复 1.0。
- crash buffer 的 FATAL EXCEPTION 与 AndroidRuntime error 计数均为 0（本轮采样窗口）。

## 未验

- TalkBack 当前 secure accessibility_enabled=0，没有启用，也没有验证完整焦点顺序/播报；标记 NOT RUN。
- 未完成 Android 旋转/多窗口、API 24/小屏设备、大字完整页面矩阵、长历史滚动、PlayScreen/骰点/结果布局。
- 真实 L1 与 L2 匹配 10+10 性能、TTFT/成本对比均 NOT RUN。不得以三个成功 GLM 请求外推费用或性能下降百分比。
