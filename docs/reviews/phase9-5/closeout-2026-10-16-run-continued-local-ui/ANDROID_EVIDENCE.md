# Android 证据

## 本轮新增

| 证据 | 结果 | 限制 |
|---|---|---|
| 缺少世界包时导入合成存档 | App 明确拒绝缺少 world 依赖；未创建半 campaign。 | 合成 save；不覆盖坏 hash、冻结 JSON、旧 save2–9 或用户数据库拒绝矩阵。 |
| 安装世界包后 SAF 导入合成存档 | 生成隔离新 campaign，后续可继续。 | 不是历史 save-10，也不证明所有迁移版本。 |
| 当前 Debug APK UI 行动 | 合成本地 Planner → skill-observation 3d6 检定 → Narrator → commit；页面显示成功、10分钟、骰值1/2/4和故事。 | 不是真实模型，不计有效玩家决定。 |
| 进程冷启动与精确回放 | force-stop/relaunch 后同分支仍是 v2；重新打开的 UI 断言同一行动、结果、耗时、骰型、骰值与叙事。 | 只验证已提交后的读回；没有检定中/候选采用前/Narrator发送中/outbox lease故障注入。 |
| 本地请求台账 | 11个loopback mock HTTP请求；该回合仅1 Planner + 1 Narrator，无重播；真实provider请求0。 | 私有历史ledger/SQLite未核验。 |
| 小屏布局冒烟 | 将隔离 AVD 临时设为 720×1600、320dpi（逻辑 360×800dp）；行动、结果、耗时、骰点和故事在同一结果卡内完整可见，底部输入区固定。 | 仅一条合成回合和一个视口；不覆盖主题、横屏、多字体或滚动全状态。 |
| TalkBack 冒烟 | 开启系统 TalkBack 后检查当前页面的焦点框和节点可访问性；关键行动/结果文本可见，交互控件暴露可聚焦/可点击语义。关闭后系统 accessibility 设置恢复为 enabled=0、service=null。 | 未完成完整焦点顺序、逐项语音播报、无障碍人员验收；仅保留焦点截图，不将它记作完整 TalkBack 验收。 |

## APK 与设备

- AVD逻辑名：ShineWord_Phase95_20261016；API37、Android17、x86_64、1080×2400、420dpi、约3GB RAM。
- APK identity：com.shineword.app 1.0.0 / code 1000000；110,156,351 bytes；SHA-256 3d74e582f40a6203cb997e682e1d767eccdd9eaf70758b129c4e49c9c429095b。
- 已安装 base.apk 与该APK SHA相同；本轮没有重新构建，因为生产源码没有变化。
- 使用 Maestro 读取控件树、输入文本、验证回放；用 ADB 做安全force-stop、启动和截图。ADB的CJK input text在该镜像报 NullPointerException，因此文本通过Maestro送入；该输入缺陷只影响ADB输入路径。
- 小屏测试后已执行 `wm size reset` 与 `wm density reset`；复核恢复为物理 1080×2400、420dpi。TalkBack 也已关闭并复核原状态。
- 原QA AVD未操作；隔离AVD未卸载、未清数据。没有实体设备、完整可访问性或性能验收。

## 证据等级

本轮通过：代码在本地当前Debug APK上的合成端点UI集成、已提交turn冷启动后重读，以及单视口小屏布局与TalkBack焦点/语义冒烟。尚未通过：真实模型、真实授权小说旅程、Stage-1/Stage-8精确历史回放、A15/A28故障恢复矩阵、当前Android全状态面、完整TalkBack、主题、API24、实体机与外部试玩。
