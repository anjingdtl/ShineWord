# A01～A18 逐项验收矩阵

记录日期 2026-10-03。**工程证据通过与完整场景验收分列**。核心回归以最终 TEST_RESULTS 为准。合成模型、故障端点、Node SQLite 和 Android 适配 harness 验证事务/协议；真实 GLM 证明已执行的小范围模型路径；API30 软件模拟器只证明实际完成的设备流程。没有把这些替换成真机/人工内容/统计性能结论。

| ID | 工程可执行证据 | 真实资源/设备证据与未验范围 |
|---|---|---|
| A01 | import-streaming、phase6-import-batch、source-index：UTF-8/GBK、emoji、无标题、长段、精确坐标/hash、缺失 shard 失败、有界缓存 | 授权 UTF-8 长篇 7.18MB 在真实生产适配 harness 导入；Android 实际导入另见 DEVICE_RESULTS。真实 GBK 长篇、真机峰值内存未验 |
| A02 | multi-part-import、contracts、source-index、incremental、artifacts：二/三部镜像/范围、旧 ID/hash 与追加兼容，不重索引旧源 | 仅一个授权完整 TXT；没有新增第二/第三部真实材料，设备多部闭环未验 |
| A03 | mobile-integration、opening-policy、incremental、artifacts：默认开局小范围、20事实及行动/引用闭包，失败不 ready | 新本地真实 API 项目一个 52.046秒可玩成果；服务端热缓存、最终策略n=1；稳定90秒、全冷未验 |
| A04 | opening-policy/incremental/publication-safety：缺依赖/不明地点/引用/冲突严格阻断、诊断持久化、需求补建 | 极短书头不足、真实冲突与错误地点样本确实被阻断；已有响应修复不重复付费。人工语义支持率/独立召回标注未验 |
| A05 | segments、mobile-runtime：停留不扫书、主域/支线/动作依赖、延迟驱动第二缓冲、上限2、暂停/预算停止 | 真实第一后段1200CP完成/采用；第二段只抽取，映射触及自设请求上限。完整主线/支线及两次后续成功采用未验 |
| A06 | request-governance、mobile-scheduler：P0优先、槽位/RPM/TPM保留、已发送不可抢占、排队原因持久化 | 早期修复开局两次真实回合成功；持续模型游玩与后台同时运行的统计排队/设备体感未验 |
| A07 | request-governance：总并发1/2/4、低RPM/TPM、并发1保守P2/P3策略、多host额度原子 | 真实模型并发2的小样；1/4和低配额实际压测未验，不能声称P95≤2秒 |
| A08 | ledger-races、rate-limit-governance、build-downsize/recovery：真实HTTP合成429/Retry-After、连接拒绝、截断、reasoning-only恢复、完成成果保留 | 真实 GLM 一次映射JSON失败后已知结局续试成功。真实供应商429/断网/截断矩阵未验 |
| A09 | ledger-races/request-governance：sent进程退出模拟、冷账本unknown、换端点仍阻断、双provider抢发、精确审批 | 测试请求上限前transport抛错的sent记录保守unknown保留且未自动重发；Android sent时强杀真实计费请求未验 |
| A10 | execution-host、resident/build-stop-resume、ledger-races：waiting_unlock、用户/系统暂停竞态、双runner/lease/fence与dataSync timeout协议 | API30启动/恢复见设备报告；Android15/16时限、通知停止/锁屏Keychain真机矩阵未验 |
| A11 | segments/artifacts：同范围共享去重、多源非连续范围、两分支各自采用、取消一支不误取消共享sent工作 | 两分支真实同时模型/设备游玩未验 |
| A12 | campaign-style/publication-safety/artifacts：Planner中ready但adopt pending、同版本manifest fence、fork/rewind历史binding、角色不被后台改写 | 数据库集成有实际调用；设备运行中发布/回退/分叉未验 |
| A13 | source-index：partial不误报无结果、页损坏/证据损坏、冷启动、别名变化、append局部补齐、缓存LRU、跨页中文名 | 用户长篇首段确实索引；真机索引CPU/内存/磁盘量级与损坏恢复流程未验 |
| A14 | writer-style/campaign-style：source/preset/custom、CAS编辑冲突、用户覆盖、分析缓存/建议、每回合本地降档与快照 | 一次真实独立分析ready13.507秒；三模式本地编译。设备风格流程见DEVICE_RESULTS；三题材人工评分未验 |
| A15 | writer-style、segment-knowledge、权限回归：越权/未来人物/GM字段拒绝、源内已知范围、风格不改裁定/知识/预算 | 工程负例通过；无人工红队/跨供应商生成评分 |
| A16 | migrations、save-compatibility、旧world-build-recovery：schema28→31/FK、旧操作/步骤、旧stage/config、包/存档双跳、故障回滚 | API30 install-r升级与冷启动见设备报告；真实旧用户库和API24/Android15/16升级未验 |
| A17 | incremental/segments/ledger-races/execution-host/writer-style：删除/来源替换/取消后迟到写拒绝，API切换新冻结intent，unknown/live禁止换 | 生产入口harness真实SQLite覆盖；设备构建中删除/切真实API未验 |
| A18 | mobile-runtime、progressive-content、campaign-style、持久interaction/action草稿：等待依赖保留意图、无授权不提交，冷启动对账/快照恢复 | 设备离开/强停/重入见DEVICE_RESULTS；真实依赖等待动作完整跨重启未验 |

复测必须仅使用授权资源，保留小说hash、起点、模型、推理档位、设备与配额；失败和缓存状态不能从统计剔除。第二段 unknown 必须先核对账本和远端已发送证据，经明确逐attempt确认后才能重新发，不能为完成矩阵绕过保护。
