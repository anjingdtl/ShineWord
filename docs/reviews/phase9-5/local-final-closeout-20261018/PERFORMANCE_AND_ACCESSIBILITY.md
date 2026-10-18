# M5：性能与交互检查

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL；只覆盖 API 37 专用 AVD 和 0–9,600 code-point 小说样本。

## 实测

- 私有 GBK TXT 的 7,178,907-byte CRLF 副本完成 SAF 导入；设备 SQLite 解析 1,504 chapters / 3,260 chunks。GLM 只收到开篇 0–9,600 code points。
- 从测试 world 创建 `13:16:34.738` 至 partial package ready `13:25:19.020` 共 524.282 秒。world_extract 约 40.95 / 35.80 秒，style_analyzer 12.15 秒；其他本地阶段未拆分，因此不把首次 ready 时间归因于模型。
- 最终 novel/campaign 账本：campaign_plan 42 次成功，平均 97,873 ms（最小 31,405 / 最大 193,203）；Planner 8 次平均 8,946 ms；Narrator 17 次平均 12,140 ms。L1 样本无 Planner、L2 样本有 Planner，但这些请求不是匹配输入/状态/骰流的 10+10 benchmark，不能据此估算节省比例或账单。
- 最终真实模型成功用量为 input/output/reasoning `1,117,695 / 258,924 / 40,902` tokens；本机 ledger 不包含实际人民币扣费。save-10 冷启动恢复和 stage-5 再打开只验证可恢复/可继续，没有单独计时基准。
- 最新 APK 完成多轮开局/Runtime QA 后，终局页当前 `dumpsys meminfo` TOTAL PSS `196,443 KB` / RSS `285,960 KB`。GfxInfo 自该 activity 进程统计起 10,169 frames、modern jank 140（1.38%），p50/p90/p95 `17/30/31 ms`；历史 legacy jank 2,988（29.38%）。这是长会话累计值，不是独立冷启动或固定交互 benchmark。
- 姓名输入框焦点冒烟通过；模拟器 Gboard 首次打开的手写教程被取消，系统屏幕键盘菜单打开后正常输入并提交过 QA action。该教程是 AVD 初始输入法状态，不作为应用缺陷。
- 临时将系统字号调至 1.3 时，开局核心字段和按钮仍可见，长标题以省略号截断；测试后恢复 1.0。
- Runtime failed 的终局页检查了隐藏变更候选、禁用 composer 与提交按钮；没有禁用只读 Runtime 状态显示。当前 crash buffer 采样未发现 app FATAL EXCEPTION。
- portrait → landscape → portrait 配置变化后，Play composer、campaign progress 与下一轮提交控件均通过 Maestro 检查。360×800dp 的 AVD 显示覆盖下，先从书库导航到同一隔离 branch，再验证 campaign progress、composer、submit 可见；小屏回归固定从书库建立导航前置条件，避免把尺寸覆盖可能触发的 Activity 重建或 Maestro 冷启动误判成控件缺失。测试结束恢复 1080×2400 @420dpi。
- 切换 Android 夜间模式为 dark 后，Play composer 与 submit 控件断言通过；系统设置恢复为初始 `Night mode: no`。

## 未验

- TalkBack 的实际焦点移动与 spoken output 未验证。设备上 TalkBack 包已安装但服务未启用；临时服务设置探测未能产生可读的 UiAutomator 树，随后精确恢复原服务列表。master `accessibility_enabled` 标志为 1 本身不代表 TalkBack 正在工作。
- 未运行多窗口、API 24 / 真实低尺寸设备、大字完整战役页、长历史滚动和完整战役各屏布局矩阵。360×800dp 结果来自虚拟显示尺寸/密度覆盖，不等同另一台物理设备。
- 没有匹配 L1/L2 各 10 次的真实请求性能、TTFT 或费用对比；本轮仅有 campaign-scope fixed-empty-evidence L1 样本，world package 仍没有 method entry，也没有非空 evidence L1。
- 后续尝试的 L1/L2 小样没有形成有效样本：合成 fixture 缺少 L1 必需绑定字段，两条路径都进入 Planner；两次宿主机 transport attempt 无 HTTP status 且 outcome unknown，attempt identity 未从临时内存账本持久化。两次未重派，完整脱敏偏差记录见 `evidence/host-glm-pilot-transport-unknown-sanitized.json`。
- PSS 与 GfxInfo 样本来自长会话，不应与独立、固定步骤基准比较，也不能外推低端设备表现。

## 2026-10-19 补充：真实 GLM matched 10+10

- 使用同一 production `CampaignSession` synthetic fixture、冻结 root state、固定非空 evidence 与骰点，真实 endpoint 完成 L1 10/10、L2 10/10，所有 turn 原子提交；30 次物理调用全部 HTTP 200，最大并发 1。证据：`evidence/matched-live-l1-l2-synthetic-20261019.json`。
- L1 latency 平均 6,705.2 ms（min 5,254 / max 8,661）；L2 平均 8,900.5 ms（min 7,082 / max 9,749）。这是此小样本下从 app action 到完成的总耗时，不是 TTFT 或统计显著的性能承诺；没有从 token 差异推算人民币账单。
- 配套 tap vs exact-authored-text parity 用确定性 production harness 逐项比较并 PASS，但未再次调用 GLM。两项证据均不等于真实小说 world package method 的 L1 表现，因当前 package 没有 method entry。
- 本轮新增自动化仍未覆盖 TalkBack spoken/focus、多窗口、API 24/真实小屏设备，也未完成 Narrator/outbox/旧 worker 等设备故障注入。真人决定与独立试玩由用户后续完成，不属于 agent 自动化关卡。
