# R5 合成 Android UI 回放

## 运行身份

- 时间：2026-10-15 23:20–23:35 UTC（2026-10-16 07:20–07:35 Asia/Shanghai）。
- APK：com.shineword.app 1.0.0，SHA-256 3d74e582f40a6203cb997e682e1d767eccdd9eaf70758b129c4e49c9c429095b。
- 设备：逻辑资源 phase95-isolated-avd:ShineWord_Phase95_20261016，emulator-5554，API37 / x86_64 / 1080×2400 / 420dpi / 3GB RAM。
- 输入：由当前 phase9CampaignFixture.cjs 和生产 save/world export API 生成的合成存档与世界包。Save 34,691 bytes，SHA-256 fe27fd633a6cab73e8cdbb5a772322082cf60ad91a228719a6951d44e5e29041；world ZIP 3,250 bytes，SHA-256 5baa836f8009b1395c70acd5d39882dbb1fc39f58b5a92284276d87fd4072a04；package content hash dd00bdecf9265a04ab8d224dc109c86610324736a08b36fc53669014383cb281。无私人小说或用户 SQLite。
- Provider：phase95-local-mock，模拟器配置指向宿主 10.0.2.2:18591，本地 Node 服务只监听宿主 127.0.0.1:18591。服务只记录经过白名单筛选的 request metadata，不记录 Authorization、prompt、story text 或响应正文。

## 操作与结果

1. 先尝试通过 Android Storage Access Framework 导入合成 save，但当前设备未安装所需世界包。App 明确拒绝并提示缺少 world 依赖；没有创建半成品 campaign。证据 R6-missing-world-dependency-blocked.png，SHA-256 10CC878E8C7DDEE469C407C52F807EAFA217D3ABFA50F6D5BA918710F5072E12。
2. 通过“书库 → 导入世界包”导入对应合成 world，再通过“战役 → 选择存档文件”导入同一合成 save。App 创建隔离新 campaign；重复导入用于第二个隔离分支，未操作原有 QA AVD。
3. 第一个 campaign camp-mva5wsgm 的 Talk 行动由 mock 完成并提交为 branch v1。其 Narrator 文本错误地描述“检查现场”，与 Talk 意图不符；此为合成服务器语义不匹配，原 turn 和截图保留，不重放或篡改。
4. 第二个 campaign camp-mva64y1h / branch camp-mva64y1h-main 中，Maestro 输入“仔细查看青石巷现场寻找线索”并提交。Planner 返回 skill_check、skill-observation、method:camp-sit-open:sweep。UI 显示：
   - 行动结果：成功；耗时 10 分钟。
   - 掷骰：3d6 取高；单骰 1、2、4；结果为成功，余量 +0。
   - 故事：“你检查了现场，找到一些可供继续调查的线索。”
   - 后续机会和本地建议可见。
5. 战役列表提交后显示 branch v2。执行 am force-stop 后重新启动 app（未清理数据、未卸载），进入“战役”列表仍显示该分支 v2；重新打开后，Maestro 对行动、结果、耗时、骰型、骰值、成功标签和叙事逐项断言通过。回放期间没有新的 Planner/Narrator 请求，原骰点未重掷。

## 当前轮本地请求计数

ANDROID_LOCAL_MOCK_REQUESTS.jsonl 共 11 条成功返回的本地 mock HTTP 请求：campaign_plan 7、Planner 2、Narrator 2。第二个 sweep turn 对应一个 Planner attempt 与一个 Narrator attempt，逻辑请求分别是 planner:camp-mva64y1h-main:turn-0002 和 narrator:camp-mva64y1h-main:turn-0002；没有 attempt 重试或 unknown。其余请求是计划/准备路径，HTTP 200 不能证明候选有效；已观察到 fixture candidate 回答被 campaign preparation 合同拒绝并退到本地建议。这个 mock mismatch 属于测试夹具限制，不是本次确认的产品根因。

本地 mock 的所有 HTTP 请求均在本机 loopback 服务记录。真实 provider/GLM 物理请求为 0；本轮 budget scope、physical cap 和 fee boundary 均为 null。历史私有账本仍 NOT VERIFIED。

## 证据文件

- R5-synthetic-sweep-turn-result.png — 提交后结果卡。
- R5-synthetic-sweep-cold-start-campaign-list.png — 冷启动后仍是 v2。
- R5-synthetic-sweep-cold-start-replay.png — 重开后的同一骰点与叙事。
- R5-synthetic-sweep-branch-version-before-restart.png — force-stop 前的 campaign 列表。
- ANDROID_LOCAL_MOCK_REQUESTS.jsonl — 无原始请求/响应正文的脱敏本地调用台账。
- Node helper：tests/helpers/phase95LocalMockServer.cjs、tests/helpers/phase95SyntheticArchiveGenerator.cjs。
- 本文档和图片仅证明本地合成端点下的 UI 集成路径，不构成玩家有效决定或阶段9/9.5旅程额度。
