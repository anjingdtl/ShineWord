# Phase 9 接手收尾复验报告

2026-10-07，Asia/Shanghai。本轮工程门禁与受影响模拟器链路通过，**第九阶段整体尚未验收通过**。A01–A40：29 PASS / 2 FAIL / 9 NOT RUN / 0 BLOCKED。

| 身份/门禁 | 最终结果 |
|---|---|
| 本次接手HEAD | 5a6e07712176fbba1b780bc21ead2d8cfa1aa1e4，接手时干净；前轮4fb5519修复及5a6e077报告已提交 |
| final21修复归档 | 纳入本次修复提交；提交ID见Git历史。未推送或发布；源码身份为工作树指纹，非Git提交SHA |
| 生产源码SHA-256 | 7813f21fae13fb2a3538f9601d6d381f8049670bc5e274ca7bd168b50a041ceb，identity scope v3，含原生/构建输入与实际打包version.json |
| Debug APK | dist/apk/debug/ShineWord-V1.0.0-debug.apk，109439951 bytes |
| APK SHA-256 | 42bbcd35cc600c9d42a127fd9552fcc13605b80e58ff81acf2ec77bcc8d66eb8，设备实际安装包hash一致 |
| 设备 | emulator-5556 / ShineWord_P8_Reacceptance / API37；保留数据安装，V1.0.0 / 1000000 |
| 完整核心 | verify:core 1017/1017，0失败0跳过，36.076s；reaccept-core-final21.log |
| 移动/构建 | typecheck通过；debug APK构建35s，reaccept-mobile-final21.log / reaccept-apk-final21.log |
| 版本/diff | verify:version与git diff --check通过，日志reaccept-version-final21.log / reaccept-diff-final21.log |
| 持久共享预算 | 上限1100，当前1055，余45；不重置；历史起始313含估计，不称全历史精确账 |

先核对M0–M9全流程权威与交接，再在共用边界修复，详见FLOW_REVIEW。R22使新候选的普通成功完成条件必须有必要效果来源，并保留合法替代/延迟语义；R23由提示与解析共用前置字段合同和具体修复反馈。R24纠正QA代理派发后异常伪装503的问题，真实生产账本按未知结果禁止重发，通用错误自动重试与无主线generic兜底已删除。R25纠正有效决定计数及源码身份范围。

R26修正统一进度归约中新准备具体阶段被旧粗节点primary遮蔽的问题。R27明确完整权威归档与当前可用行动的读职责，编译、Planner、准备态Narrator、立即保存和冷启动指引共用生命周期投影；事件完成但局面仍active时旧方法退出，历史、冻结合同、旧承诺和延迟后果完整保留。四项新增生命周期回归和全量核心通过，未通过人工改SQL或UI独有屏蔽修复。

真实模拟器主分支camp-muxpraio-main：final19 UI生成加修复后r7采用到v29，暴露R26；final20本地短休v30激活原r7新主线办法（额外1次narrator_guidance刷新有账），UI回报v31普通success同时兑现v23旧承诺，自动r8采用v32并正确激活；UI进言v33普通success自然completed/改判之约，立即停止。实际结局仅取得代安娜发言资格，不能宣称安娜获救或原著死亡被改写。新增后果同v31立即触发，不计隔两决定证据。

final20结束后旧夜攀城墙按钮复现的失败截图保留。final21在原v33保留数据冷启动验证：结束主线卡、阶段列表、最终叙事、campaign_ending事件和runtime一致；旧战役方法退出，世界探索保留。runtime/全部归档hash不变，旧承诺仍fulfilled，分叉仍v37；新增0玩家决定、0HTTP。A34据此PASS，A38完整最终旅程仍NOT RUN。证据reaccept-device/final21-ending-reacceptance.json及final21-natural-ending、ending-review、ending-narrative.png。

前轮“final18 J1 UI23≥20、J4 UI10完成必需设备配额”撤销。只读审计证明J1 v24–28五次空效果重复必须排除，余18仅为可评估上限；J4新增v28–37十次全为无新事实/进度/后续机会的重复，全部排除。重启停滞守卫不能补数。final20三个新增决定跨身份只作诊断，不拼成最终同身份20。旧503账本记录与随后过期指引安全拒绝分别留存，不由后者推断前者上游结果已知。

100/300/1000生产Session/SQLite本地累积实际通过：snapshot5128/5129/5133 bytes，runtime1414/1414/1415、结构1412恒定，jobs=1；查询约0.912/2.395/5.871ms。LLM/RNG为确定性边界，范围是已准备局面，不外推无限重规划或真实模型性能。证据reaccept-longrun.json。

final14显示实测保留自身身份：360/411dp×1.3/2字号、行动/目标键盘、前后台、动态字体、草稿、四主题截图。final21移动/原生显示和共用构建输入逐文件与final14一致，打包版本元数据独立登记，见final21-display-source-equivalence.json；没有将历史截图改写成新身份。当前结束界面另有final21实际截图。

剩余合同：最终同身份J1/J2/J3各20、J4-A/B各10有效决定及必需Android UI20+10；两个隔两次有意义决定仍影响人物/办法的持续后果；三意图六维均≥3；原著角色换起点、后段按需补建、成功救援后存活、模板外组合；同设备/模型/范围10基线+10新回合性能对照。独立玩家体验未验。不能以工程门禁、必要结构门或累计提交次数替代这些证据。

清理已通过正式模型配置UI恢复真实GLM端点，Keychain引用保留；只读核对持久配置后，按PID/命令行/监听端口验证停止本轮QA代理。字体1.0、物理1080×2400、Gboard；原模拟器/数据库保留，App在配置保存后force-stop。没有卸载、清数据或替换设备SQLite。证据final21-cleanup.json。

2026-10-07后续：用户授权先commit再推进剩余验收。本次提交保存final21修复与真实复验检查点；完整阶段验收结论保持未通过。
