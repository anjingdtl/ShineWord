# ShineWord 第六阶段进度与本地接续

记录日期：2026-10-03。范围依据：`docs/Shine-TRPG_PHASE6_CONSTRUCTION_PLAN.md`，方案入库提交 `51033973445825f01b730b7e62eec0a3352414e1`。本文件记录实际完成范围，不把工程通过等同于全部内容、设备和性能验收通过。

## 当前交付

M0～M9 已接入 Android 生产路径，P6-0～P6-6 已分阶段实现、审查、修复、验证并提交。最终生产源码提交：`37149b45d948422ac99ce3e6c097f933fb929fb9`。用户最新明确授权提交并推送主分支，已将远端 `main` 从方案基线安全快进到该源码提交；本次进度和验收证据另作文档提交继续推送 `main`。完整历史保留，无 reset、clean、force push、tag 或 Release。

原任务分支：`feat/phase6-progressive-build-and-writer-style`。审查历史：[PR #10](https://github.com/anjingdtl/ShineWord/pull/10)，主分支快进后自动显示 merged/closed。版本仍为 V0.6.0 / versionCode 60000，SQLite schema31、save7。

## 已完成实现

| 模块 | 已接入的实际行为 |
|---|---|
| M0 | 共享运行时合同、单写入所有者、迁移、database/runtime 装配和旧协议适配；区分 SourceChunk、AnalysisBatch、Segment、PublishArtifact |
| M1 | 本地流式 UTF-8/GBK 导入、来源成员与镜像 ID、规范化 hash、源内码点坐标和精确证据；追加兼容旧范围 |
| M2 | 持久中文索引，稳定文本与动态别名/权限分离，覆盖不足与损坏不误报“原著没有” |
| M3 | 小段与需求合并、readiness、当前域/依赖/耗时驱动的近期缓冲，上限2及停止/预算约束 |
| M4 | 范围抽取复用、变化集及认证依赖闭包映射、fencing 检查点；新草稿按权威事实投影 provenance，不篡改旧发布内容 |
| M5 | 严格引用/冲突/来源验证、正式逐事实审查、不可变世界成果与安全边界分支采用；历史正文/状态/风格冻结 |
| M6 | P0～P3 优先队列、交互资源保留、并发/RPM/TPM/预算、唯一请求账本；unknown 禁止自动重发；开局建议也经统一治理 |
| M7 | Android 前台服务与通知、waiting_unlock/用户暂停/系统时限、原租约与单执行者/fencing、生命周期缓存恢复 |
| M8 | 跟随原著/预设/自定义风格，独立分析、用户覆盖、本地预算降档编译、回合冻结与存档基线 |
| M9 | 项目、等待恢复、审查、风格编辑、回合与存档实际生产 UI 接线 |

没有另建事实库、请求账本或租约，也没有加入产品中心服务器、桌面预处理依赖、端上大模型或强制向量数据库。

阶段提交：P6-0 `fdf4612`、P6-1 `a60093a`、P6-2 `6614585`、P6-3 `a71beb4`、P6-4 `16231fe`、P6-5 `f053c1b`、P6-6 `717fd68`。后续修复：`fc6c475` 键盘焦点；`4cdaace` 范围身份；`bb7065a` 精确请求恢复/租约CAS/缓存/root bundle；`ee09cb4` 逐事实审查；`98fe882` 开局建议治理/跨API unknown；`c867284` 新草稿 provenance/缓存复用；`37149b4` 有效拆批集合/规范化定义比较。独立只读复审未发现最后修复的剩余工程阻断。

## 已验证结果

最终本地命令全部退出0：

- `npm run verify:core`：790/790，0 failed/skipped/todo，146327.166ms；包含 root 严格类型检查。
- `npm run typecheck`、`npm run typecheck --prefix mobile`：独立执行均0。
- `npm run verify:version`、`git diff --check`：均0。
- `npm run apk:debug --prefix mobile`：完整 standalone Debug 构建成功，3m51s；JDK17/SDK36/NDK27/Gradle9.3.1。

源码 `37149b4` 的实际主分支 [Core CI 37129047811](https://github.com/anjingdtl/ShineWord/actions/runs/37129047811) success，790/790；[Android CI 37129047814](https://github.com/anjingdtl/ShineWord/actions/runs/37129047814) success，移动严格类型0，Gradle5m20s。最终证据提交仅改文档，Core 会触发，Android 按既有路径过滤不会重跑；交付时核对文档提交实际 Core 结果，不冒称该 head 重跑了 Android。

最终 APK 107011415bytes，SHA256 `15469a83d8e210b4333cbf9abf0fd9e92306f76903d0a8daf0762b82ae5cd272`，真实重新打包 root 引擎代码。API30 TCG 模拟器保留 userdata 升级安装成功；无 KVM、无真机，此设备耗时不能当真机性能。

真实资源仅使用用户授权小说和 GLM：

1. 授权长篇原始字节 strict GBK 可解码，7,178,905bytes、3,460,333规范化码点、1504章/3260chunks；Android 正常 SAF 导入 active。同书前80k rawCP转 UTF-8 样本也正常导入 active，76178规范化CP、35章/74chunks。
2. `opening-90s-3` 输入受模型上下文10%上限、6400码点和总预算约束，定向提取人物/地点/事件/时间关系/行动依赖，证据充分时本地编译规则。保留20事实及有效人物、地点、事件、行动/引用闭包、冲突门禁。
3. host 新本地项目导入至合格成果52.046秒：导入9.142、构建42.859；29事实/6事件/1成果，1次真实HTTP200。provider缓存5056/5064、最终策略n=1。**不能宣称稳定90秒、全冷样本或 Android 用户开局耗时。** host 两个后段已分别发布/采用。
4. API30 新 TXT 项目首次真实抽取39.881秒。引用不足先严格阻断，正常逐事实转待核实并明确继续，0重复抽取/映射发布。两个真实 Planner/Narrator 回合完成；后台两个P2抽取与前台操作时间线重叠，但P0 HTTP在P2响应之后发送，不证明远端HTTP并发或排队P95≤2秒。
5. 原生第一后段6400..9600CP映射25.915秒，正常暂停、空闲冷停、重启保持暂停、明确继续缓存发布；采用binding1→2。第二后段9600..12800CP映射63.233秒，provenance错误被M5阻断；修复升级后M7正常冷启动复用done缓存发布，0新增付费抽取/映射；再次采用binding2→3。历史正文、冻结风格和已提交状态保持。
6. 正常短休到v4/clock70，3成果save7经SAF导出/导入创建独立campaign；最终空闲冷DB integrity=ok/FK=0，3不可变成果、5历史快照、4turns、2正文/2冻结行动风格精确保留，仅合法重绑定branch身份。旧两个artifact及两raw mapping整行保持，0新增模型请求。
7. 三风格/用户覆盖、旧0binding存档和正常回退分叉已执行；开局建议真实唯一M6账本与成功缓存复测通过。设备QA19attempt：18已知HTTP200、1已审查unknown，上限20；未知/null用量与精确审批保留，没有自动重发。

## 未完成验收与本地下一步

工程与协议门禁通过；内容/风格、设备和统计性能完整验收仍未完成。后续两个未来P2候选12800..16000/16000..19200CP虽抽取成功，但新canon冲突阻断，已通过正常UI停止并保留缓存/诊断。既有3成果可继续游玩；未来内容需对原文逐事实审查并明确继续，不能放宽验证器或改库制造通过。

本地依次推进：

1. 安全同步最新main，先读本文件、STATE、完整建设方案、兼容说明、各 REVIEW、TEST_RESULTS、MEASUREMENTS 和 A01～A18矩阵，核验 AGENTS、真实工作区与本地工具/设备。保留本地修改，建立接续工作分支。
2. 用本地授权 GLM 与 TXT 做有上限的真实链路复测；已完成抽取/映射兼容时复用。云端私有SQLite/截图/APK/请求证据不在仓库，也不能假设本地已有云端任务或同一campaign。首次记录本地 novel hash、编码、模型、推理、额度及缓存；密钥和原文不提交。
3. 原生完整主线/停留/支线、至少两次后续补建/采用、连续游玩与后台、同书分段或授权多部追加（同书转码分段不等于独立第二部小说）；单独覆盖并发1/2/4与低配额、通知暂停/锁屏/系统限制、sent强杀/unknown、双runner、构建中删除和切API、存档/分叉恢复。
4. 真实故障结论与合成故障严格分开；稳定90秒需固定质量/小说/起点/模型/推理/设备/配额的独立冷/热样本，保留全部失败与provider缓存。不得只靠mock速度宣称提速。真机/API24/Android15/16、人工内容/风格标注和统计性能未验项继续开放。
5. 每次实际发现问题都实现→review→fix→验证→commit，更新本文件和STATE/TEST_RESULTS/验收矩阵；源码变化后运行相应全量门禁/Debug并检查实际CI。用户当前main授权覆盖本轮云端交付；本地后续代码默认通过PR交付，未经另行授权不合并/tag/Release。

## 用户指定的本地资源

- 项目：`F:\ClaudeWorkSpace\projects\ShineWord`
- 测试LLM配置：`C:\Users\Administrator\Desktop\AIstudio\Test-key\GLM-TEST.txt`
- 测试小说：`C:\Users\Administrator\Desktop\AIstudio\放开那个女巫.txt`

这些路径用于本地接续与测试配置，不硬编码进 Android 产品代码。LLM 文件只在本地读取，输出/日志/提交中隐藏密钥。

交接提示词见 [LOCAL_AGENT_HANDOFF.md](docs/reviews/phase6/LOCAL_AGENT_HANDOFF.md)。详细证据：[STATE.md](docs/reviews/phase6/STATE.md)、[TEST_RESULTS.md](docs/reviews/phase6/TEST_RESULTS.md)、[FINAL_REPORT.md](docs/reviews/phase6/FINAL_REPORT.md)、[ACCEPTANCE_MATRIX.md](docs/reviews/phase6/ACCEPTANCE_MATRIX.md)、[COMPATIBILITY.md](docs/reviews/phase6/COMPATIBILITY.md)、[DEVICE_RESULTS.md](docs/reviews/phase6/DEVICE_RESULTS.md)、[MEASUREMENTS.json](docs/reviews/phase6/MEASUREMENTS.json)。
