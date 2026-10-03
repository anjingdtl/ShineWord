# P6-0 基线与合同决议

- 基线：main@51033973445825f01b730b7e62eec0a3352414e1（2026-10-02 获取）；方案提交是 HEAD 且 ancestor 校验成功。工作区最初干净，无 AGENTS.md。
- 产品版本 0.5.0 / versionCode 50000，SQLite schema 28。本轮交付 PR，不合并、不打 tag、不发布。
- Node 24.19.0 / npm 11.9.0；当前 JDK 21.0.12.1，SDK/adb/设备尚不可用，后续尝试合理配置。
- 已读取 944 行方案全文、README、VERSIONING、core/android CI、来源/检索/构建/采用/预算/移动装配源码。
- `npm ci` 与移动依赖安装成功；基线 `verify:core` exit 0，620/620；日志在任务工作区 scratch（不含请求正文）。移动基线检查另记录。

## 冻结合同与所有权

`phase6-contracts-1`：`src/domain/build/phase6.ts`、`src/domain/style/types.ts`、`src/application/ports/phase6/index.ts`。来源范围、成员快照、逻辑段与请求批次分离；运行状态复用既有 run/unit。来源哈希和范围内容哈希均为 SHA-256，源内码点半开区间。增部兼容检查逐成员执行，不用 sourceSetHash 全局失效旧工作。

M0 唯一负责共享合同、builtinMigrations、database/runtime/sourceImport 装配、全局存档/版本与集成；M1 来源；M2 派生索引；M3 段计划/需求；M4 既有 canon/run/unit/映射；M5 不可变内容及分支采用；M6 既有账本/调度；M7 Android host，使用 M4 lease；M8 项目风格；M9 UI 与既有战役接线。禁止第二事实库、请求账本、租约或跨域写表。

## 迁移与协议决议

- 统一新增 schema 29（各模块提供 SQL，由 M0 集中注册）；只增表/列，引用实际 worlds/branches/source 主键，清理纳入项目删除。索引可再生，不在升级时全书重建。
- 原 `stage-plan-1` 及旧 scope 原样恢复。新 `segment-plan-1` 通过执行器创建来源内范围 run，每个 range 可分多个 analysis batch；保留历史执行/账本/租约。
- 新世界级 `shineword-segment-artifact-1` 显式携带 sourceId/hash/源内坐标。旧 `shineword-progressive-delta-1` 的 64 ranges / 12,000 CP / 500 entries 限制不放宽；兼容桥需要分割合法单元且唯一确定源身份，不能猜测最新部。
- 世界 ready 和分支 adopted 分离，采用事务核对 stateVersion/manifest/running interaction。世界共享原著成果不修改 originBranchId 的旧分支 delta。
- 项目即 world，一对一 projectId=worldId，无第二套项目主键。风格快照持久化内容而非只有 hash；默认无分析状态不冒充已经学习原著。
- 存档兼容以显式版本扩展、不可变内容哈希与递归禁键检查为门禁；旧历史正文不再生成。
- 默认开启新计划创建，旧计划读取/恢复不随新模式改变。新调用必须进入既有预算/账本。

## 请求角色决议

Planner/Narrator 与当前回合必须的摘要为 P0；bootstrap、已提交动作依赖与明确目标推荐为 P1；近域/缓冲 P2；独立风格分析、全书整理、探测与普通后台摘要 P3。registry/timeline 属于 extractor 配套，继承意图级别；Checker/adjudication 为 mapper 配套。`other_existing` 限已登记兼容调用，不能成为绕行通道。端点未知配额按 endpoint 共享，不能 model/profile 各自用满。

## 测量口径和阈值

ImportTime、BuildTTFP、UserTTFP、FirstNarrativeTime、RequiredBuildWait、BackgroundQueuePenalty、ReuseRate、CostPerCoverage、StyleOverhead 按方案定义，分开计时；固定同小说 hash/起点/profile/推理/设备/配额，冷/热缓存和估算/真实 usage 分开。

质量硬门禁保留 20 条事实启发式并增加必要闭包校验；引用定位 100%，future/GM-only/跨分支泄漏、未知结局自动重发、迟到重复完成均为 0。工程确定性 fixture 不替代语义支持或真实提速。真实 API/小说/设备当前未提供：TTFP 相对降低 30%、必需等待降低 50%、交互新增排队 P95 2 秒保留为待验目标，不伪造实测阈值或 P95；并发1不可抢占场景单列。

## P6-0 review → fix → 验证

- 审查：旧范围缺 sourceId 不可直接转换；增部不能让旧缓存全部失效；单写入所有者；domain 不反向依赖 application/infra/mobile。
- 修复：范围 guard 拒绝负值/小数/空哈希/未知来源，绑定拒绝重复成员/序号；intent 核验 planVersion/generation/来源快照。接口继承 indexed type 的 TS 错误修正为交叉类型。
- 验证：合同测试覆盖旧范围拒绝、范围越界、源替换/移除/重编号、追加兼容和可替换 executor。详情见 TEST_RESULTS。

## 最终集成补充（2026-10-03）

实际配置 JDK17.0.20.1/Android SDK36、NDK27、Gradle9.3.1；schema最终31（29共享域，30旧粗读恢复，31普通回合interaction fence）。版本0.6.0/60000。最终来源/段/artifact协议、所有权、存档7与归档4说明见 COMPATIBILITY.md。

用户后续授权提供GLM与一部小说并调整开局目标90秒；模型10%为上限，最终冻结opening-90s-3单次精准抽取+本地证据规则编译。保留所有质量门禁，不为达90秒放宽引用/冲突。测量将source-active至成果发布（BuildTTFP）与导入+发布分开；52.046秒为实际harness从开始导入到已验证成果的总时长，不包含Android开局表单人工交互，不能写成端上UserTTFP。n=1且服务端缓存热；原30%/50%/P95性能对照目标仍待同条件资源复测。
