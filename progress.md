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

## 本地接续轮（2026-10-03，本地开发机）

环境：Windows 主机 + `emulator-5554`（`Medium_Phone` AVD，API 37.1，x86_64 + WHPX 硬件加速；非真机、非云端 TCG）。本地 `npm run verify:core` 基线 790/790（约 9 秒）。Debug APK 独立构建两次（修复前后），`install -r` 保留数据升级；本地模拟器原有 V0.5.0 旧签名安装（2026-10-01）因签名不匹配卸载后全新安装，云端证据不复存在本地、未做任何假设。

真实资源与云端同源：授权小说 SHA256 `7f45fe0b…` 与 MEASUREMENTS 记录一致；本地复刻 UTF-8 前 80k rawCP 样本 hash `947164f4…` 与云端夹具逐字节一致。私有 QA 转发器（本地 scratch，不入仓库）经 `adb reverse 18765` 注入授权 Key，硬上限 60 请求 / 1,000,000 Token；本轮实际 35 次 attempt：33 次 HTTP200（input 276,411 / output 43,372，其中 cached 37,376）、1 次合成 429、1 次发送后断连。密钥与原文未入库。

### 发现并修复的问题（实现→审查→修复→验证→commit）

| 编号 | 问题 | 修复提交 |
|---|---|---|
| L1 | 首启表单选预设后编辑模型名会静默脱离预设并清空能力字段，保存"无上下文窗口"配置，导入小说时才以英文治理错误阻断 | `529497e`：模型名精确回输预设自动重新附带（不覆盖用户已填值）；导入侧治理/预算报错映射为可操作中文 |
| L2 | 依赖恢复路径提交的回合完成后故事面板不刷新（乐观合并行 `{...item}` 保留旧条目、并发 refresh 无序、回前台不重读） | `f9d6a72`：合并改写新视图、refresh 按启动序号串行化、回前台刷新一次 |
| L3 | 映射请求在途时用户暂停，已到手且账本已结算的响应在 done 检查点写入前被丢弃，恢复时整批重发重复计费（与抽取路径自身合同相反） | `ccfe68e`：在手响应先落内容寻址检查点，暂停/租约检查移至批次边界；两条回归测试分别钉住 signal 暂停与 stale fence（旧代码失败、新代码通过） |
| L4 | 追加第三部后段发布被 M5 以 `invalid_artifact_structure` 确定性阻断。根因：CJK 实体键经 `slug()` 原样进入 entity/fact/mapping id（如 `ent-…-边陲镇`），这些 id 进入段工件后违反协议 TOKEN 字符集 `[a-zA-Z0-9._:-]`，结构守卫必然拒绝 | 本轮（见下）：`slug` 改为 `sanitizeTokenFragment(历史算法输出)`（非 CJK 键 id 逐字节不变，保护重放身份；CJK 键转义结果与存量修复逐字符同构）；新增 `normalizeNonconformingCanonIds()` 存量修复通道（FK 校验事务内重写全部 canon 侧引用，幂等）；watchdog 与 headless runner 双入口在构建前调用 |
| L5 | part3 恢复时映射整批重发（#26 与 #25 输入仅差 1 字符→batchHash 漂移→done 检查点未命中）。密码学级定谳：run A 首次 finalize 中投影事实（温蒂-named-mention 等 3 条）在**内存追加到 facts 数组末尾**后进 mapper prompt，重试 run B 从 DB 重读时位于 `ORDER BY fact_id` **排序位置**——序列化顺序不同导致内容寻址 hash 必然不同（用生产管线+设备 DB 快照逐字节复现了两个 hash：b6794184/167cfa06）；wire 的 +1 字符是请求信封层噪音，与 hash 无关 | 本轮（见下）：mapper prompt 的 facts 按 factId 规范排序（entities/events/entries 保持调用方序——重载本稳定，排序反而作废既有检查点）；批次切分前同样排序（多批路径成员漂移一并消除）；`canonSnapshotHash`（决定 artifactId）同修 |

三笔修复均通过独立复审（approve / approve-with-nits，意见已吸收），最终门禁 `verify:core` 792/792、root/mobile 严格类型、`verify:version`、`git diff --check`、独立 Debug 构建全部通过；L1/L2 在设备上按原始复现路径验证，L3 由真实 SQLite 协议级测试钉住（设备端 part2 映射暂停→冷重启→继续时 0 重复调用发布）。

### 未关闭缺陷（准确记录）

- **L4（已关闭，2026-10-04 设备回归通过）**：根因确认为 CJK 实体键进入 canon id 违反段工件 TOKEN 字符集（见上表）。代码修复过全量门禁与独立复审（approve-with-nits，应修项已吸收）；设备端按 part3 原始路径回归通过（证据见”L4 修复轮”），缺陷关闭。
- **L5（已关闭，2026-10-04 密码学级定谳并修复）**：batchHash 1 字符漂移的完整根因链与修复见上表；独立复审（approve-with-nits）另发现并同步修复同类缺陷两处（批次切分成员漂移、canonSnapshotHash 漂移），修复后生产管线在设备 DB 快照上对”首跑追加序/重试重载序”均收敛同一 hash（167cfa06），且重载路径 hash 不变（既有检查点零失效）。

### 本轮新增设备证据（API37.1 WHPX 模拟器，正常 UI 驱动）

1. 全量 GBK 7.18MB 原生导入→1 段开局→两轮 canon 冲突正式逐事实审查（5+1 张对比卡，引文逐字核验原文全部命中）→两次后续补建/发布/安全边界采用（回合依赖含 3 artifacts）。
2. 连续 8 个真实回合（含 3d6 检定失败回合）、支线移动、集市停留（停留期间 0 新增段构建，"停留不扫书"成立）。
3. 90 秒开局两个独立冷缓存样本：样本 A 冷抽取 60.6s（含 1 次必要人工冲突审查）；样本 B（UTF-8 前 80k 新项目）导入点击→可玩 **74.5s**（导入 2.3s + 冷抽取 56.2s + 本地发布），零人工干预。n=2、单设备、非统计结论、非真机。
4. 暂停/冷恢复：映射在途暂停（"等待当前模型请求结束后暂停，可撤销"）→映射完成→暂停生效→force-stop 冷重启→保持暂停、0 新模型调用→明确继续→done 缓存复用发布。
5. 故障：合成 429（单请求、无重试风暴、草稿保留、恢复后续试成功）；发送后断连→`outcome_unknown` 精确审批流（转发器证据确认未到上游后显式批准→同逻辑 ID #a2 重试成功、#a1 unknown 行保留、回合正常提交）。
6. 风格三模式往返（跟随原著→悬疑预设→自定义→回原著），回原著后已学基调恢复，0 新分析调用；存档导出（525KB save7）→回退分叉（v5 新分支、主线 v6 保留）→存档导入为独立新战役 camp-musqch8m，全程 0 新模型调用。

未验（本轮明确保留）：真机/API24/Android15-16、锁屏 Keychain waiting_unlock、双 runner、构建中删除/切 API 设备路径、三题材人工内容评分、L4 设备端复现回归、90 秒统计样本量。

## L4 修复轮（2026-10-04，本地开发机）

根因链：模型返回的中文实体键经 `slug()`（旧规则保留 `\u4e00-\u9fa5` 原样）进入 entity/fact/mapping id → 这些 id 以 entryId/zoneId/sourceFactIds/targetEntityId 等形式进入段工件 → 工件协议守卫 `TOKEN = ^[a-zA-Z0-9._:-]{1,256}$`（`segmentPublication/protocol.ts`）结构性拒绝 → `invalid_artifact_structure`。第二部能闭环是因为该段恰好无 CJK 键实体进入工件；第三部命中即确定性阻断。

修复（实现→独立复审→吸收→全量门禁）：

1. `src/application/world/extraction.ts`：新增 `sanitizeTokenFragment()`（逐码点 ASCII 转义，`uXXXX` 形式）；`slug()` 重写为 `sanitizeTokenFragment(历史算法输出)`。合同要点：非 CJK 键的 id 与历史规则逐字节一致（存量世界重放不产生重复实体）；CJK 键的转义结果与存量修复通道对旧 id 的转义逐字符同构（修复后的世界重放派生同一 id）。自审发现并纠正了初版逐字符重写在两类场景（非 CJK 标点键、CJK+标点混合键）破坏重放一致性的缺陷，新增回归测试钉住"修复产物 == 新派生 id"不变量。
2. `src/infra/sqlite/sqliteWorldStore.ts`：新增 `normalizeNonconformingCanonIds()`——GLOB 选出三张表中的不合规 id，转义重命名并在单事务内重写全部 canon 侧引用（entity_aliases、canon_facts.subject_entity_id、world_rule_mappings.target_entity_id、source_index_aliases、fact_sources、knowledge_records），事务前 `PRAGMA foreign_keys=OFF`、事务内 `foreign_key_check` 验证后提交；幂等；超长转义 id 以确定性截断+FNV-1a 尾缀兜底保持合规与幂等。事件 id 有意不在范围（不进工件 TOKEN，无法阻断发布）。
3. `mobile/src/buildWatchdog.ts` 与 `mobile/src/buildRunner.ts`：构建启动前调用修复通道（watchdog 主路径 + headless 重投递路径双入口，后者为复审发现的绕行缺口）；修复失败仅告警不阻断，守卫仍然兜底。
4. 测试：`tests/canon-id-normalization.test.cjs` 4 条（TOKEN 合同与确定性、存量修复含引用重写与幂等、CJK 派生工件通过守卫而原始 CJK id 仍被拒、修复/派生一致性与非 CJK 历史身份）；`resident-build-p4.test.cjs` 期望值改为按生产函数推导并钉住 ASCII 合同。

独立复审结论 approve-with-nits：GLOB 语义、PRAGMA/事务顺序、FK 引用覆盖（对照全部迁移）、重放一致性同态均被逐项验证；4 项应修（headless 绕行、超长 id 幂等、静默吞错、fact_sources 作用域）已全部吸收，事件 id 不对称以注释定谳。

门禁：`verify:core` **796/796**（原 792 + 4 新增）、root/mobile 严格类型 0、`verify:version` 0、`git diff --check` 0。

### L4 设备端回归（2026-10-04，emulator-5554 / Medium_Phone AVD / API37.1 WHPX）

含修复的独立 Debug 构建（SHA256 `a553efb7dabf55874fc9d0469c36fe39226e0ddc32bd777d09d892f250b7c1d0`）`install -r` 保留数据升级，冷启动后**仅经正常 UI**（项目卡→继续构建）恢复 part3 任务，无任何数据库手工干预：

- Pre-state（安装前取证）：L4 世界 `…-musjtyqo` 存量 13 实体 / 2 事实 / 8 映射 id 不合规（如 `ent-…-夜莺`）；目标 run `phase6-seg-36c8dda…-g1-r0` 为 `stopped_user`/`package_finalize_failed`，诊断表有其 `invalid_artifact_structure` 两行；已发布 4 段；账本 35 attempt。
- 恢复过程：构建启动即执行存量修复（`夜莺→u591cu83ba`、`安娜→u5b89u5a1c`、`凡纳→u51e1u7eb3`、`北坡矿山→u5317u5761u77ffu5c71` 等）；引用被重命名实体的映射批次缓存按预期失效，产生 **1 次真实重映射调用**（HTTP 200，35.7s，38,531 tokens，cached 0）；随后第 5 段（3 成员 part3 段）发布成功。
- Post-state（发布后取证）：残留不合规 id **0/0/0**；引用零孤儿（facts→entities、mappings→entities、aliases、fact_sources 四路 LEFT JOIN 均 0）；`PRAGMA foreign_key_check` 0 违规、`integrity_check` ok；目标 run `completed`/publishing/`last_error_code=null`；工件 5 段；诊断表 **0 新增行**（原 L4 阻断行保留为历史）；账本 **36 = 35+1**，与私有转发器逐条一致（本轮 cap 8 请求/200k token，实用 1）。
- 日志无 FATAL/无 crash、无修复告警输出（修复成功路径静默）。转发器已停、adb reverse 已移除、0 在途请求。
- 边界：单设备单次回归（n=1、模拟器非真机），不外推统计性能；"继续构建"前的审查项在本路径为空（上次运行已完成审查）。

## L5 修复轮（2026-10-04，本地开发机，纯 host 取证）

**取证方法**：不依赖猜测——用 dist 生产代码 + 设备 pre-fix DB 快照（`pre-install.sqlite`）复刻 mobile `sourceImport.ts` 的 finalize 输入（intent/binding/fingerprint/previousEntries/publishedEvidence/mappingVersion 逐项对齐），包装 `sha256Hex` 截获 hash 原文：

1. **复现 #26（重试路径）**：重建 hash 与设备 job 行 `167cfa06…f3b29ef` 完全一致——重建输入获密码学级验证。
2. **复现 #25（首跑路径）**：把 run A 在 17:55:05.166 创建的 3 条投影事实（`温蒂-named-mention`、`border-town-location-mention`、`边陲镇-location-mention`）从 `ORDER BY fact_id` 排序位置挪到数组末尾（模拟管线 `facts.push` 的内存追加序），重建 hash 精确命中 `b6794184…84603`。
3. **结论**：canon 表在两次计算之间零写入（逐表时间窗核查），两次输入是**同一 DB 状态的不同内存序**；batchHash 对 facts 数组顺序不稳定是根因，wire +1 字符为信封噪音。23,172 次单字段变异枚举零命中也排除了"单字段内容变化"假说。
4. 旁证：账本两行 input_tokens 相同（35336）、治理参数（tier/reserve/wire 上限）逐字段一致。

**修复**（实现→独立复审 approve-with-nits→吸收→门禁）：

1. `buildMapperUserPrompt`（现导出）：facts 按 factId 规范排序——hash 成为存储 canon 的纯函数；entities/events/existingEntries 保持调用方序（重载路径本就稳定，排序反而会改变现有世界的 hash、作废已付费检查点）。
2. 批次切分前排序（`requestMappingProposals` 入口）：消除 >800 事实多批路径的批次成员漂移（复审发现的同类缺陷 5B）。
3. `canonSnapshotHash`（决定 artifactId）：facts 同样排序（同类缺陷 5A）——首跑生成的工件身份从此可由存储 canon 复现。
4. 回归测试 `tests/mapper-prompt-canonical-order.test.cjs`：追加序与排序序的 prompt 逐字节一致；facts 序规范化、其余成员保序分别断言。

**验证**：797/797（+1 新测试）、root/mobile 严格类型、version、diff 全 0；修复后生产管线在设备快照上 reload/append 两路径均收敛 `167cfa06`（重载路径 hash 不变=既有检查点零失效，旧漂移值不再出现）。审查意见（测试恒真断言、existingEntries 未覆盖、5A/5B）全部吸收。



## A17 收尾轮（2026-10-04，本地开发机）

接续 L4/L5 修复轮之后，补齐 A17 的设备路径证据（第二项目 novel-utf8-part1，正常 UI）：

1. **切换 API**：新增并激活配置 B（独立端点+独立转发器日志）；停止中的构建任务保持冻结配置（后续请求仍走 A 端口）；点「用当前 API 继续」后新冻结 intent 的请求实测落 B 端口（B 日志 0→1、A 不变），后续抽取/映射全部走 B。语义与兼容合同一致。
2. **构建中删除**：映射请求在途（89,152 字符）时经正常菜单删除项目：确认弹窗列明范围、删除即时生效、书库/战役立即清理、应用稳定；删除后 60 秒双端口零新增请求，无重试循环或僵尸任务。
3. 环境清理：双转发器停止、adb reverse×2 移除、IME 恢复、激活配置切回 A；主项目（5 段）与全部战役数据保留。

本轮请求消耗：A 口 5 次 + B 口 2 次（含一次在途被删的映射），未触上限。未验项不变：锁屏 waiting_unlock 设备路径、Android15/16 时限、双 runner、真机矩阵、三题材人工评分。

## 用户指定的本地资源

- 项目：`F:\ClaudeWorkSpace\projects\ShineWord`
- 测试LLM配置：`C:\Users\Administrator\Desktop\AIstudio\Test-key\GLM-TEST.txt`
- 测试小说：`C:\Users\Administrator\Desktop\AIstudio\放开那个女巫.txt`

这些路径用于本地接续与测试配置，不硬编码进 Android 产品代码。LLM 文件只在本地读取，输出/日志/提交中隐藏密钥。

交接提示词见 [LOCAL_AGENT_HANDOFF.md](docs/reviews/phase6/LOCAL_AGENT_HANDOFF.md)。详细证据：[STATE.md](docs/reviews/phase6/STATE.md)、[TEST_RESULTS.md](docs/reviews/phase6/TEST_RESULTS.md)、[FINAL_REPORT.md](docs/reviews/phase6/FINAL_REPORT.md)、[ACCEPTANCE_MATRIX.md](docs/reviews/phase6/ACCEPTANCE_MATRIX.md)、[COMPATIBILITY.md](docs/reviews/phase6/COMPATIBILITY.md)、[DEVICE_RESULTS.md](docs/reviews/phase6/DEVICE_RESULTS.md)、[MEASUREMENTS.json](docs/reviews/phase6/MEASUREMENTS.json)。
