# 第六阶段持续建设状态

- 分支：`feat/phase6-progressive-build-and-writer-style`；基线 `origin/main` 为方案提交 `51033973445825f01b730b7e62eec0a3352414e1`。无 reset、clean、force push。
- 集成负责人：M0 root。阶段提交：P6-0 `fdf4612`；P6-1 `a60093a`；P6-2 `6614585`；P6-3 `a71beb4`。
- 当前：P6-4 兼容、竞态与恢复修复已实现，审查修复完成、全量 752/752 通过，准备阶段提交；P6-5 真实 GLM 内容验收同时推进。每阶段 review → fix → 验证 → commit 后继续。
- M1～M9 已生产接线：流式来源、持久中文索引、段计划、变化映射、不可变成果、分支采用、统一队列/账本、Android host、独立项目风格、回合/项目/等待 UI、存档。
- 最新开局决议：新运行冻结 opening-90s-3，单次定向抽取；前部输入上限为模型上下文 10%，另受总预算和 6400 码点硬上限约束。可核验事实在本地编译基础行动规则；数值默认明确标为 rule_mapping。20 事实、人物/地点/事件/证据/行动闭包和冲突门禁保留。旧配置及指纹仍可恢复，已有抽取不因解析形状修复重新付费。
- P6-4 修复：普通 Planner 前持久交互 guard；后台不改人物卡，在下次玩家动作边界载入已采用场景 NPC；旧迁移保留操作及步骤；回退/推进释放过期需求，其他分支共享需求保留；换 API 创建新冻结 intent/run，未知结局需账本确认；显式全书整理最多同时规划两段。
- 最新验证：P6-3 全量 741/741 通过。P6-4 首轮全量 751 中 748 通过，3 个失败为 runtime 测试夹具缺少新增需求释放端口，已补端口及行为断言，正在复测。26 个开局/M4/M3/移动导入定向通过；最终以 TEST_RESULTS 最新记录为准。
- 真实模型：前部单次抽取约 39～49 秒；多个样本因地点形状或引用依赖未闭包而阻断，负例保留。已有响应本地修复后发布 1 个有效开局成果、1 名 NPC；两次真实回合成功。两段后续抽取被依赖/冲突门禁阻断，尚不算两次补建采用通过。全新本地项目一次真实请求开局 TTFP 52.046 秒，29事实/6事件/1成果；服务端缓存命中，不能称全冷或稳定90秒。
- Android：Node24/JDK17/SDK36/NDK27；Debug 曾构建并安装成功。无 KVM；API36 软件启动失败；API30 TCG 启动、首配及书库正常，授权 7.18MB TXT 正在实际 UI 导入。真机性能及后台限制不能由此替代。
- 私有凭据、小说、原始响应、SQLite、APK 均仅在 scratch/dist（忽略目录），不得入仓。付费请求有界，禁止 outcome_unknown 自动重发。
- 未完成：P6-4 提交；增量复用/真实补建闭包修复；完整 APK 重建及模拟器流程；A01～A18 验收矩阵；0.6.0 版本同步；最终全量检查；P6-5/P6-6 文档/提交；推送 PR 与实际 CI。没有真机、多部真实小说和人工标注资源，明确记为未验。
- 命令：npm run verify:core、npm run typecheck、npm run typecheck --prefix mobile、git diff --check、npm run verify:version；JAVA_HOME=/workspace/toolchains/jdk17 ANDROID_HOME=/workspace/toolchains/android-sdk GRADLE_USER_HOME=/workspace/toolchains/gradle npm run apk:debug --prefix mobile。
- 下一步：完成 P6-4 复测/审查/commit；完成 P6-5 有界真实实验与修复；P6-6 回归、文档、版本、APK、PR、CI。不合并 main、不打 tag、不发布 Release。
