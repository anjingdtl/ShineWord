# A01～A18 逐项验收矩阵

记录日期 2026-10-03。**工程证据通过与完整场景验收分列**。核心回归以最终 TEST_RESULTS 为准。合成模型、故障端点、Node SQLite 和 Android 适配 harness 验证事务/协议；真实 GLM 证明已执行的小范围模型路径；API30 软件模拟器只证明实际完成的设备流程。没有把这些替换成真机/人工内容/统计性能结论。

| ID | 工程可执行证据 | 真实资源/设备证据与未验范围 |
|---|---|---|
| A01 | import-streaming、phase6-import-batch、source-index：UTF-8/GBK、emoji、无标题、长段、精确坐标/hash、缺失 shard 失败、有界缓存 | 授权GBK兼容长篇7.18MB已在生产适配harness导入，API30实际active/1504章/3260chunks；严格GBK解码全文件成功、UTF-8 strict探测失败，之前文档编码标注已纠正。API30同授权文本UTF-8前部样本已active（76178CP/35章/74chunks）；真机峰值内存未验 |
| A02 | multi-part-import、contracts、source-index、incremental、artifacts：二/三部镜像/范围、旧 ID/hash 与追加兼容，不重索引旧源 | 仅一个授权完整TXT；同书分段转码夹具可用，但未执行设备追加闭环，也不等于第二/第三部独立真实小说 |
| A03 | mobile-integration、opening-policy、incremental、artifacts：默认开局小范围、20事实及行动/引用闭包，失败不 ready | 新本地真实 API 项目一个 52.046秒可玩成果；服务端热缓存、最终策略n=1；API30新TXT一次精准抽取后真实冲突阻断，正常逐事实转待核实后缓存发布1ready artifact；不计自动90秒成功。稳定90秒、全冷未验 |
| A04 | opening-policy/incremental/publication-safety：缺依赖/不明地点/引用/冲突严格阻断、诊断持久化、需求补建 | 极短书头不足、真实冲突与错误地点样本确实被阻断；API30正常审查保留1speculation与审计，27explicit通过原门禁并缓存发布，0重复抽取/映射。人工语义支持率/独立召回标注未验 |
| A05 | segments、mobile-runtime：停留不扫书、主域/支线/动作依赖、延迟驱动第二缓冲、上限2、暂停/预算停止 | 真实两个后段各1200CP均已发布/采用：第二段抽取后曾触及私有上限，核对第六次fetch未调用证据后仅审批该attempt，一次追加映射成功。3个adopted artifacts，旧事实/抽取复用；另API30实际6400..9600/9600..12800两个后段分别发布/采用，缓存复用与历史冻结通过；其后两个未来缓冲真实冲突阻断并正常停止。完整主线/停留/支线实际旅程仍未验 |
| A06 | request-governance、mobile-scheduler：P0优先、槽位/RPM/TPM保留、已发送不可抢占、排队原因持久化 | 早期host修复样本两回合、API30原生两回合真实GLM成功；API30两个回合操作与P2抽取时间线重叠，但P0 HTTP在P2响应后发送；不证明HTTP并发或统计排队达标，真机体感未验 |
| A07 | request-governance：总并发1/2/4、低RPM/TPM、并发1保守P2/P3策略、多host额度原子 | 真实模型并发2的小样；1/4和低配额实际压测未验，不能声称P95≤2秒 |
| A08 | ledger-races、rate-limit-governance、build-downsize/recovery：真实HTTP合成429/Retry-After、连接拒绝、截断、reasoning-only恢复、完成成果保留 | 真实 GLM 一次映射JSON失败后已知结局续试成功。真实供应商429/断网/截断矩阵未验 |
| A09 | ledger-races/request-governance：sent进程退出模拟、冷账本unknown、换端点仍阻断、双provider抢发、精确审批 | 测试请求上限前transport抛错的sent记录保守unknown保留；核对未fetch证据后单attempt显式审批恢复，历史unknown及审批时间保留、没有自动重发；API30实际unknown精确Alert取消/确认、审批后run不变/不自动发、单独继续成功；Android sent时强杀真实计费请求未验 |
| A10 | execution-host、resident/build-stop-resume、ledger-races：waiting_unlock、用户/系统暂停竞态、双runner/lease/fence与dataSync timeout协议 | API30第一后段映射后正常暂停、空闲冷停、重启保持暂停、明确继续从done缓存0重复调用发布；Android15/16时限、通知停止/锁屏Keychain真机矩阵未验 |
| A11 | segments/artifacts：同范围共享去重、多源非连续范围、两分支各自采用、取消一支不误取消共享sent工作 | 两分支真实同时模型/设备游玩未验 |
| A12 | campaign-style/publication-safety/artifacts：Planner中ready但adopt pending、同版本manifest fence、fork/rewind历史binding、角色不被后台改写 | 数据库集成有实际调用；API30正常回退创建独立fork，原分支v3与fork v2保留；新TXT分支两次安全采用binding1→2→3，已冻结历史/正文/风格逐行保留；运行中发布设备竞态矩阵未验 |
| A13 | source-index：partial不误报无结果、页损坏/证据损坏、冷启动、别名变化、append局部补齐、缓存LRU、跨页中文名 | 用户长篇首段确实索引；真机索引CPU/内存/磁盘量级与损坏恢复流程未验 |
| A14 | writer-style/campaign-style：source/preset/custom、CAS编辑冲突、用户覆盖、分析缓存/建议、每回合本地降档与快照 | 一次真实独立分析ready13.507秒；三模式本地编译。API30三模式/自定义calm-direct保存、真实回合冻结风格、SAF save7导出已执行，详见DEVICE_RESULTS；另三成果v4 save7正常导出/导入冷核验见DEVICE_RESULTS；三题材人工评分未验 |
| A15 | writer-style、segment-knowledge、权限回归：越权/未来人物/GM字段拒绝、源内已知范围、风格不改裁定/知识/预算 | 工程负例通过；无人工红队/跨供应商生成评分 |
| A16 | migrations、save-compatibility、旧world-build-recovery：schema28→31/FK、旧操作/步骤、旧stage/config、包/存档双跳、故障回滚 | API30 install-r升级与冷启动见设备报告；真实旧用户库和API24/Android15/16升级未验 |
| A17 | incremental/segments/ledger-races/execution-host/writer-style：删除/来源替换/取消后迟到写拒绝，API切换新冻结intent，unknown/live禁止换 | 生产入口harness真实SQLite覆盖；设备构建中删除/切真实API未验 |
| A18 | mobile-runtime、progressive-content、campaign-style、持久interaction/action草稿：等待依赖保留意图、无授权不提交，冷启动对账/快照恢复 | 设备离开/强停/重入见DEVICE_RESULTS；真实依赖等待动作完整跨重启未验 |

复测必须仅使用授权资源，保留小说hash、起点、模型、推理档位、设备与配额；失败和缓存状态不能从统计剔除。任何新的 unknown 必须先核对账本与dispatch/远端证据，按逐attempt明确审批后才能重新发，不能因已有审批或完成矩阵而自动重试。

## 本地接续轮补充证据（2026-10-03，API37.1 WHPX 模拟器，正常 UI）

在云端矩阵基础上新增的设备级证据；未改变任何行的"未验"边界（真机/人工评分/统计性能仍开放）。

| ID | 本地新增设备证据 | 仍未验 |
|---|---|---|
| A02 | 同书分段第二部（UTF-8 80000..160000 rawCP 转码，第 2 成员）追加闭环：35 章入册、旧段/旧证据不变、新段抽取→审查→映射→发布（第 4 段）；**第三部追加暴露 L4：3 成员段发布被 invalid_artifact_structure 确定性阻断；根因已定位（CJK 键进入 canon id 违反工件 TOKEN 字符集）并于 2026-10-04 代码级修复（slug 整体转义 + 存量修复通道 + 双构建入口接线，796/796 门禁、独立复审通过）** | 独立第二/三部真实小说；L4 设备端 part3 复现回归 |
| A03 | 新增独立冷缓存开局样本 B：UTF-8 前 80k 新项目导入点击→可玩 74.5s（2.3s+56.2s 冷抽取+本地发布，零人工干预）；与样本 A（冷抽取 60.6s+1 次人工审查）合计 n=2 冷样本 | 稳定 90 秒统计结论、真机 TTFP、三题材质量 |
| A04 | 开局/追加两轮 canon 冲突正式逐事实审查（6 张对比卡），引文 offset 逐字核验原文全部命中；invalid_proposal 按"按事实解决"（不走豁免） | 独立人工召回标注 |
| A05 | 支线移动（回合5）+集市停留（回合6）期间 world_build_runs 保持 3，0 新段排队 | 更长停留/多支线统计 |
| A06 | 8 真实回合含 P2 后台段发布重叠（账本逐条对齐，无绕行） | HTTP 并发/排队统计与真机体感 |
| A08 | 合成 429（单请求、无重试风暴、草稿保留、解除后续试成功）；发送后断连（drop）按 unknown 处理 | 真实供应商 429/断网矩阵 |
| A09 | 发送后断连→outcome_unknown 精确审批：核对转发器"未到上游"证据后显式批准，同逻辑 ID #a2 重试成功、#a1 unknown 行保留、回合提交、无自动重发 | Android sent 时强杀真实计费请求 |
| A10 | 映射在途暂停（"等待当前模型请求结束后暂停，可撤销"）→force-stop 冷重启保持已暂停、0 新调用→明确继续 done 缓存复用发布（ccfe68e 修复路径） | 锁屏 Keychain、Android15/16 dataSync 时限、双 runner |
| A12 | save7 导出（525KB）→v5 回退分叉（主线 v6 保留）→导入为独立战役 camp-musqch8m（v6，0 新调用） | 回合处理中发布的设备竞态矩阵 |
| A14 | 跟随原著（已学）→悬疑预设→自定义→回原著，基调恢复 0 新分析调用 | 自定义字段逐项设备编辑、三题材人工评分 |
