# Shine-TRPG 二期收尾建设方案

> 2026-09-28 产品路线更新：用户在实际构建耗时约两小时后已选择“快速开局，三宝书随探索补齐”。本文中“默认完整构建后才能游玩”的要求由 [快速开局与渐进式三宝书方案](Shine-TRPG_PROGRESSIVE_WORLD_BUILD_PLAN.md) 替代；本文其余正确性、恢复、数据保护及全量模式验收要求保留。不要继续以全书抽取覆盖作为默认首开门槛。

> 制定日期：2026-09-28  
> 审查代码：`fe2ff3abaf001fd76071fe2d7b507a533da4dd4f`  
> 当前移动端版本：`0.3.0-p4`，Android `versionCode=12`，minSdk 24 / targetSdk 36  
> 范围：二期业务遗留 + 第三期 P3/P4 交付门禁 + 大 TXT / 动态进度 / Android 后台构建  
> 本文是待执行方案，不是完成报告。本次只编写文档，未修复产品代码、未发布 APK。

## 1. 结论与范围解释

**项目尚未按照 `Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md` 完成全部建设及验收。**

P3/P4 大部分 UI 模块已有源码和阶段 Review 文档，不能因此判为全部交付：本次核心回归 156/156 通过，但 mobile TypeScript 检查失败；当前代码的 APK、四主题截图、完整真机旅程没有在本次验证。原第三期最终报告本身也明确将这些运行门禁留待线下。

“二期收尾”沿用本次需求命名，实际包含两条原有建设线：

1. [二期建设方案](PHASE2_CONSTRUCTION_PLAN.md) 与 [R6 未结项](reviews/P2_ACCEPTANCE_CLOSEOUT_R6.md)：世界构建正确性、业务闭环、真实模型、恢复、设备性能和 Beta 条件。
2. [第三期建设方案](Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md)：P3 页面精修及 P4 游玩页重构的可编译、可运行、可验收收口。

新增三个真机问题是本次必做范围。它们涉及应用层写路径、任务持久化和增量数据库迁移，不能继续套用“第三期只改 UI”的限制而不处理；应作为独立建设阶段审查。骰点、成长、世界包不可变版本、分支隔离和旧存档兼容仍是不可回退的约束。

不以完成率百分比代替证据。采用“源码已落地 / 自动验证通过 / 设备验证通过 / 未完成 / 外部条件待补”分级。

## 2. 本轮实查记录

### 2.1 已执行与未执行

| 检查 | 本轮结果 | 边界 |
|---|---|---|
| `git status --short` | 审查开始时干净 | 本轮新增本文与执行提示词 |
| `npm run verify:core` | **156 tests，156 pass，0 fail** | 含核心 TS 编译及 Node SQLite 测试；不等于 Android 链路通过 |
| `npm run typecheck --prefix mobile` | **FAIL，exit 1** | 同时存在缺失安装依赖与真实源码导入路径错误 |
| 第三期实现目录、关键入口和收口报告对照 | 品牌、features、controller、projection、HUD、面板均有实现 | 不以文件存在推定视觉与交互正确 |
| UI 旧品牌 / 旧样式静态扫描 | 未发现用户 UI 中旧品牌字面量；legacyStyles 仅剩说明注释 | 内部兼容标识继续保留 |
| 《白篱梦》本地解析探针 | 见下表 | 仅桌面 Node 解析，不调用 LLM |
| mobile 哈希适配器最小复现 | **两个不同块得到相同哈希** | 使用当前函数源码、真实 SHA-256 的 native stub，非真机性能测试 |
| Android debug / release 构建、安装、截图、后台切换 | **本次未执行** | 当前 TS 门禁已失败，先在施工阶段修复；不可引用旧包充当当前包证据 |
| GLM 实际请求、完整小说模型构建 | **本次未执行** | 方案阶段仅确认测试文件存在，不读取或输出密钥 |

### 2.2 本地素材事实

| 项目 | 实际值 |
|---|---|
| 配置 | `C:\Users\Administrator\Desktop\AIstudio\Test-key\GLM-TEST.txt`，文件存在，147 bytes；本次未读取内容 |
| 小说 | `C:\Users\Administrator\Desktop\AIstudio\《白篱梦》作者：希行.txt` |
| 文件大小 | **3,065,535 bytes，约 3.07 MB / 2.92 MiB**，不是 30 MB |
| 当前解析器结果 | UTF-8，规范化后 965,458 Unicode 码点，300 个章节，944 个文本块 |
| 正确桌面哈希适配器结果 | 944 个块哈希均不同 |
| 单次桌面解析耗时 | 约 106ms；仅说明当前桌面纯解析结果，不能外推 Android 耗时、网络耗时或完整构建耗时 |

因此真实小说可以覆盖接近百万字规模，但 **30 MB 必须另建确定性合成压力样本或取得实际故障文件**。合成样本不能充当真实召回质量样本。测试报告必须同时写 bytes、编码、码点数、章节数、逻辑任务数。

## 3. 第三期建设对照

依据原方案各阶段和 §28–§38 的出口核查。历史报告 [PHASE3_FINAL_REGRESSION.md](reviews/phase3/PHASE3_FINAL_REGRESSION.md) 明确标注运行验证未执行，本轮以新增证据补充，不改写其历史事实。

| 阶段 / 原要求 | 当前代码证据 | 判定与收尾 |
|---|---|---|
| P3.0 基线冻结 | `reviews/phase3/P3_BASELINE.md` | 文档已有；重新冻结当前 HEAD、工具链、依赖和 APK 证据 |
| P3.1 品牌与基础组件 | `mobile/src/ui/brand/`、`components/`、Android icon / values-v31 | 源码已有；修依赖后检查 launcher / Splash、四主题与组件状态 |
| P3.2 书库 | `features/library/`、`LibraryScreen.tsx` | 页面已拆分；构建进度无真实计数，新增任务中心状态接入 |
| P3.3 战役 | `features/campaigns/` | 源码已有；多分支继续与导入存档仍需最终包验证 |
| P3.4 Profile / First Run | `features/profile/`、`ui/state/AppSessionContext.tsx` | 品牌与 TextField 已接入；验证配置持久化、密钥、首次启动 |
| P3.5 世界详情 | `features/world-detail/`、`WorldDetailScreen.tsx` | 四 Tab、主题覆盖、编辑与审核已有；验证玩家 / GM 隔离、差异、发布与 ZIP 往返 |
| P3.6 Opening | `features/opening/`、`OpeningScreen.tsx` | 四步已有；部分核心类型导入路径错误，尚未达到可编译出口；需两类角色、同伴、返回重进验收 |
| P3.7 P3 收口 | `P3_REVIEW.md`，UI 无 legacyStyles 引用 | 静态收口已有；typecheck、APK、截图门禁未关闭 |
| P4.1 投影 | `src/application/campaign/playProjection.ts`、`mobile/src/playProjection.ts`、`tests/phase3-play-projection.test.cjs` | 本轮核心测试通过；仍需同一 stateVersion 的实际 UI、NPC 秘密过滤验收 |
| P4.2 Controller | `features/play/hooks/usePlayController.ts` | 解耦已有；存在到核心投影的错误相对路径 |
| P4.3 叙事流与骰点 | `NarrativeFeed.tsx`、`TurnCard.tsx`、`RollStrip.tsx` | FlatList 与近底部滚动逻辑已有；需长历史、失败恢复和阅读不中断实测 |
| P4.4 输入与快捷行动 | `ActionComposer.tsx`、`QuickActions.tsx`、`useContextualActions.ts` | 本地推导结构已有；需键盘 / 安全区、仅填入不自动发送验证 |
| P4.5 队伍与弹层 | `PartyStrip.tsx`、`panels/PlayPanel.tsx` | 源码已有；验证 Android Back、关闭、滚动、触控面 |
| P4.6 玩家 / 同伴卡 | `character/` | 组件已有但存在内部 components/theme 错误路径；校验练习点、冷却、训练、资源和同伴指令 |
| P4.7 NPC 卡 | `NpcCharacterSheet.tsx`、公开投影 | 核心投影回归通过；逐屏验证未知信息占位及无 GM 数据 |
| P4.8 遭遇 HUD | `encounter/` | 源码已有；验证先攻、距离、行动消耗、攻击、援救、移动、NPC 回合、撤退 |
| P4.9 信息面板 | `panels/{Party,Quest,Inventory,Knowledge,GameInfo}Panel.tsx` | 源码已有；验证知识发现、任务奖励、分队 / 重入 / 转移 |
| P4.10 系统操作 | `panels/GameMenu.tsx`、角色卡训练 | 源码已有；休整、回退、存档和恢复需完整旅程 |
| P4.11 主题与 legacy 删除 | 四主题 tokens、ornaments；legacy 文件已删除 | 静态成立；四主题完整 Play 截图与对比度尚未验证 |
| 最终 §28–§38 门禁 | 核心 156/156；mobile FAIL | **整体不通过**；APK、设备、兼容、视觉、性能缺证据 |

源码错误示例（并非所有 TS 错误都由依赖未安装导致）：

- `mobile/src/ui/features/opening/openingModel.ts:8` 的 `../../../../src/domain/characters/card` 解析到 mobile 下，无法到达仓库根 `src`。
- `mobile/src/ui/features/play/hooks/usePlayController.ts:18` 的核心投影路径同类错误。
- `mobile/src/ui/features/play/character/CharacterSections.tsx` 使用 `../../components/*`、`../../theme/*`，实际应到 `ui/components`、`ui/theme`。
- `react-native-svg`、`lucide-react-native`、React Navigation 等已在 package 声明，但本机当前安装状态不能解析；须先同步依赖，再对剩余编译错误逐一修复，禁止用 `any`、关闭 strict、忽略文件掩盖错误。

## 4. 三项真机问题与额外缺陷

### 4.1 P0：错误哈希同时破坏速度与内容完整性

入口：`mobile/src/worldImport.ts` 的 `makeBytesSha(fileBase64)`。

当 `fileBase64 !== null` 时，`sha256BytesHex(bytes)` 忽略传入 bytes，始终调用 `nativeSha256BytesHex(fileBase64)`。而 `importTxtSource` 将该接口用于原文件、每章和每块哈希。`LibraryScreen` 的真实导入恰好传入 `picked.base64`。

后果：

1. 本应很小的章节 / 块哈希反复 base64 解码并散列整本小说；Kotlin `ShineWordCryptoModule.sha256BytesHex` 每次都会重新解码和散列。
2. 全部章 / 块哈希被写成同一个原文件哈希。
3. `buildWorldFromTxt` + `SqliteWorldStore.findReusableJob` 按相同 contentHash 查成功任务；顺序执行时，后续不同块可能错误复用首个成功块并跳过抽取。返回的 `{ok:true}` 不含可重新绑定的事实 / 证据。
4. “构建成功”“复用很多”“耗时降低”可能实际意味着漏读，不能当作性能提升。

最小复现：取当前函数源码，以真实 SHA-256 实现替代 native 方法；给 factory 固定原文 `whole-file`，分别调用 `chunk-A` 和 `chunk-B`，结果哈希相等，两次 native 都收到 10-byte 原文件，证明参数被忽略。

规模估算（代码调用量，不是实测吞吐）：本次小说每次解析需要 `1+300+944=1245` 次哈希；当前 mobile 入口和核心 builder 又各解析一次，累计整文件散列输入约 **7.63 GB**，尚不含 base64 字符串搬运等成本。30 MB 文件会更加严重。

必须先修：原文件 byte digest、规范化源 digest、chapter / chunk digest 分离；对任意传入 bytes 正确哈希；原文件摘要只计算 / 缓存一次。保留历史兼容 digest 的读取能力，但不要每次无条件重做整本 binary string 转换。

### 4.2 P1：已有分章，但全量导入与执行复杂度不合适

| 当前代码 | 缺口 / 风险 | 建设方向 |
|---|---|---|
| `ShineWordFilesModule.readFileBase64` | 全文 ByteArrayOutputStream、bytes、base64，经桥到 JS 再转 bytes；64 MiB 上限不代表能稳定处理 30 MB | 私有文件暂存 + 原生流式解码 / hash + 有界读取 |
| `worldImport.buildWorldOnDevice` + `buildWorldFromTxt` | 同一全文解析两次，保留多份大对象 | 导入阶段输出持久化 SourceManifest，构建只读 manifest / range |
| `txtImport.ts` | 已有标准 / 宽松 / 兜底分章；默认块 1200 码点，每章 `paragraphs.filter` 扫全部段落 | 双游标单遍分章；物理存储块与 LLM 分组解耦 |
| `extractChunkText` + `applyExtraction` | 每个抽取块两处新建全文 `CodePointOffsetIndex`，每次 O(N) | 有界 SourceReader；过渡版共享只读索引，目标不逐任务扫描全文 |
| 段落累计到阈值后 flush | 超长无换行段落没有硬切上限 | 超长章 / 段安全切片，保留代理对与码点边界 |
| mobile `concurrency:1` | 大量小块逐个网络请求；944 块只是约 3 MB 的当前切法 | 按模型上下文与输出预算自适应分组，有限并发与背压 |
| `saveImportedSource` | 持久化章 / 块元数据，未持久化可续读的全文正文 | 应用私有原文件与规范化文本分片持久化；恢复不要求再次选文件 |

### 4.3 P1：映射与恢复也必须一起修

- `buildPackageFromCanon` 以最多 800 条事实分批，但每批仍携带全量 entities / events；条数上限不等于 token 上限。
- 映射结果保留于内存，没有逐批可恢复 job；后期失败可能重付前面全部映射请求。
- `seenEntryIds` 对后续同 ID 提案直接跳过，可能丢失跨章增量事实。应明确合并、冲突审查与 provenance 并集规则。
- `usage` 当前仅保留最后一次有值响应，不是全任务用量汇总。
- 抽取块 done 写入与 facts / events 落库没有一个完整原子提交边界；events 先放内存，全部 worker 完成后才保存。若在块 done 后、事件持久化前进程死亡，重启跳过 done 块可能永久丢事件。跨恢复轮次的事件依赖集合也需从数据库恢复。
- 直接按 jobId 判断 done 的路径只检查 contentHash；需补齐解析 / 抽取 / prompt / schema / 模型设置指纹，防止版本变化仍复用。
- 底层 builder 即使有 failedChunks 也设置 world `ready`；mobile 虽阻止发布，但持久化世界状态与实际失败状态可能不一致。

这些是源码确认的结构性风险；崩溃窗口和历史数据受影响范围需用故障注入及旧库副本复现，不能声称已在用户真机复现全部情况。

### 4.4 P1：进度 UI 有壳，没有贯通的数据

`WorldBuildProgress` 已声明 `chunksDone/chunksTotal`，`BuildStatusCard` 也有 Bar；但实际流水线没有提供这些计数。抽取阶段没有逐块回调，开始时只有 importing，直到抽取完成准备映射才发 extracting。计数缺失时 Bar 不渲染。

进度、busy、summary 属于 `LibraryScreen.useState`，无法作为重进页面 / 重启进程后恢复的依据。修复必须从持久化任务状态到 UI、通知一起贯通，不能只添加动画计时器。

### 4.5 P1：后台执行没有基础设施

Manifest 当前只有 INTERNET，没有前台任务 Service、FGS 权限、通知入口；`mobile/index.js` 无 Headless JS 任务注册，也没有 WorkManager 调度。构建由页面触发普通 JS Promise，缺少独立任务所有者、后台执行契约及系统回收后的恢复协议。

用户报告的“切后台失败”成立为待修问题；具体一次失败来自挂起、网络、进程回收还是运行时异常，本次未拿到 logcat，不能武断归为单一 Android 原因。

## 5. 参考 tavo-mini：复用设计，不搬业务

已检查本地 `F:\ClaudeWorkSpace\projects\TAVO-MINI`，参考 HEAD `cf278b315eb54595f7118de912aff6b6739de3f9`。以下是可用参考入口，不是对其全项目的质量背书：

| 参考文件（相对 TAVO-MINI） | 可借鉴 | Shine-TRPG 适配要求 |
|---|---|---|
| `android/app/src/main/java/com/shinewriter/ContinuationTextImportModule.kt` | 原生有界解码，避免整本 base64，字节游标 | 保留本项目 Unicode 码点偏移；验证 UTF-8/GBK/UTF-16 跨块边界 |
| `src/services/continuation/continuationImportService.ts` | staging、正文分片、完整性检查、激活、任务进度与恢复 | 适配 world/source/version 和 SQLite adapter，不搬续写数据表 |
| `continuationSourceReader.ts`（同目录） | 绑定源快照、按范围读取、拒绝陈旧源 | 读接口保持 bounded；构建分析范围与玩家知识隔离分别处理 |
| `canon/adaptiveBatchPlanner.ts` | 模型窗口 / 输出预算驱动分组、超长章切片、缩小输入重试 | 不直接复制续写的比例常量；用 TRPG 事实抽取质量实测校准 |
| `canon/canonSourceSlicePlanner.ts` | 总预算、nextCursor、完整覆盖而非截断尾部 | 参考使用 UTF-16，必须显式转换，不能混入码点证据 |
| `canon/canonProgress.ts` | 多阶段任务进度组织 | 本项目数据库 committed counters 为事实源 |
| `android/.../PipelineForegroundService.kt` 与 Module | 常驻通知、任务标识、wake lock 生命周期 | Service 存活不等于 JS 任务恢复；START_STICKY 不恢复内存 job；补系统超时、冷启动、租约与通知动作 |

## 6. 目标架构与数据契约

```text
用户选 TXT
  → 私有源暂存 / 原生流式解码 / 原文件 hash
  → 规范化分片 + 码点索引 + 自动章节 + SourceManifest
  → 章节预览 / 任务预算估计
  → 持久化 BuildRun + 逻辑任务计划
  → 按模型预算分组抽取 → 单组验证及原子提交
  → 实体 / 时间线归并 → 按 token 预算映射并逐批提交
  → 发布门禁 → 新的不可变 package revision

UI / 通知只观察 BuildRun；Android runner 驱动队列；重启从 DB 与私有源恢复。
```

### 6.1 源存储

新增 SourceReader 端口（命名可调整，职责必须具备）：

```ts
interface SourceReader {
  getManifest(sourceId: string): Promise<SourceManifest>;
  readRange(sourceId: string, startCp: number, endCp: number): Promise<string>;
  listChapters(sourceId: string, cursor?: string): Promise<ChapterPage>;
}
```

- manifest 绑定 raw hash、normalized hash、字节数、码点数、encoding、normalizeVersion、chapterSplitVersion、索引版本、源文件位置与激活状态。
- 原生先把 SAF 源复制到应用私有文件，检查空间并原子完成；或在过渡期持久化 URI permission，但最终不能依赖选取器 Activity 存活。
- 增量 normalize 必须与冻结版本规则一致，携带跨块 CRLF、BOM、空行、缩进状态；若规则变化，创建新源版本，不能悄悄改旧证据偏移。
- 正文可选私有规范化文件 + 范围索引，或 SQLite 有界正文分片；本期选定一种并记录 ADR，避免整本单 JSON 行与双份权威正文。
- 建议初始原生 I/O 块 64–256 KiB，桥接文本窗口有硬上限、队列有背压；这些是调参起点，不是验收成绩。
- 中文章/卷、数字标题、英文标题、无标题、目录误判、重复标题、超长段均要处理；低置信度给出预览和可选分章策略。标题是结构，不能因分章失败漏掉正文。
- 导入 staging 不展示为可玩世界，全部分片 hash / 范围校验后激活；中途失败保留可恢复记录，不遗留“成功世界”。

### 6.2 持久化任务与单一执行者

建议新建 `world_build_runs`、`world_build_units`、必要的 source 表；迁移编号必须读取当前迁移注册后分配，不覆盖旧 migration，同步 `builtinMigrations.ts`。已有 world_jobs 可复用，但不能把 `{ok:true}` 当完整 checkpoint。

Run 最少字段：runId、worldId、sourceId、sourceSnapshotHash、pipelineVersion、planVersion、profileRef、modelFingerprint、phase、status、总量/成功量/失败量、leaseOwner、leaseExpiresAt、fencingToken、heartbeatAt、lastErrorCode、createdAt/updatedAt。

Unit 最少字段：unitId、runId、kind、sourceRanges、inputHash、prompt/schema/version 指纹、parentUnitId、status、attempt、retryAt、result 引用、usage、错误分类。唯一键绑定不可变输入与配置，不单独以章节标题或局部 jobId 判断缓存命中。

```text
queued → running → completed
            ↘ waiting_network / waiting_unlock / paused_system / paused_user
            ↘ failed_retryable / needs_review / failed_terminal / canceled
```

- phase 独立于 status：reading / normalizing / indexing / extracting / merging / mapping / validating / publishing。
- 同一 run 只允许一个协调者；DB CAS 租约 + fencing token 防止旧进程 / 前后台双 runner 继续提交。worker 并发共享同一协调者的领取协议。
- 领取事务要短；网络调用不占数据库事务；成功后在一个事务中写入校验结果、facts、事件提案、出处、unit done、进度计数。写失败不得标 done。
- 事件提案立即持久化，依赖解析作为独立、可重放阶段，跨 chunk / group / 重启读取完整事件图。
- 业务持久化幂等；网络付款无法对一般 Provider 保证 exactly-once。响应到达但提交前崩溃可能重复请求，须如实记录此窗口，支持 Provider requestId / 可用的幂等机制。
- 暂停 / 取消接 AbortSignal，中止在途请求；取消后晚到响应用 run generation / fencing 拒绝，不误写完成。
- canceled 保留源和已有有效成果，清理是另一个显式动作；暂停、恢复和重试不要求重新导入小说。

### 6.3 历史错误哈希与旧库迁移

1. 扫描旧源元数据：多个不等文本范围却同 contentHash，尤其等于 raw source hash，是可疑信号，不能仅凭重复正文合法 hash 相同就判污染。
2. 用可信原文重新计算范围 hash；源缺失时标 `needs_source_verification`，提示重新选择同文件并核对原始摘要。
3. 对无法证明来源完整的 done / reused job 禁止继续复用，版本化缓存与构建算法；不得将其算作覆盖。
4. 旧 `INSERT OR IGNORE` 会留下错误块 hash，不能只改 factory；须新 source/build revision 或明确迁移策略重建元数据。
5. 保留用户已有 published package / campaign 引用，新构建生成独立 revision；不能就地删除旧事实、重写旧包或让现有存档指向新包。
6. 一次迁移失败应回滚或留下可解释恢复态；旧库升级、旧包导入、已有战役续玩分别测试。

## 7. 高效构建引擎设计

### 7.1 章节、存储块、模型分组分开

- 章节用于目录与证据归属；物理块用于有界 I/O；模型组用于一次请求的输入预算。不要让 1200 字物理块永远等于一次 LLM 请求。
- 自动打包连续小章节 / 范围；超长章节按段落优先、安全码点硬切兜底。所有有效正文必须落入覆盖账本，重叠上下文不能重复计完成量。
- 跨章节组的协议携带 segments（chapterId、startCp、endCp、text）；模型返回 segmentId 和逐字引文，本地定位到该 segment，再转换到绝对码点。不能沿用单 chunk.chapterId 给整组事实强行赋章。
- 重复引文出现多次时需要 disambiguation；歧义不能任选一处作为确定证据。

### 7.2 模型预算与并发

单请求满足：系统提示 + 当前组正文 + 必要上下文 + schema + 输出/推理预留 + 安全余量 ≤ 已核实模型窗口。字符估算不是精确 token；对中文和异常长 ASCII 采用保守估算，记录实际 usage 校准。

- 首先有限样本比较当前 1200 码点请求与较大分组，质量通过后再选默认范围。不能为了减少次数关闭推理或压缩到不足的输出预算。
- 默认抽取并发 1，可在端点能力与端上内存允许时提升到 2；更高并发是后续压测结果驱动的配置，不直接把所有章节 Promise.all。
- 429 遵循 Retry-After，网络 / 5xx 退避加抖动；401/403 等配置问题暂停任务；JSON 截断、reasoning-only、上下文过大分类处理，必要时拆组重试。
- 拆组要事务化父子任务替换和覆盖范围，不能父组与子组同时计算完成量。失败重试最多次数和总 token / 请求预算均可配置；达到预算停到可恢复状态。
- 分组摘要可用于关联与去重，不得代替原文引文。禁止“只读前几章”“全文先压成一个摘要再当全量事实”来伪造完整构建。

### 7.3 映射和发布

- 从数据库分页读取事实；按 token 分组，随批只带相关实体 / 事件及有界跨组索引，不再每批携带全世界。
- 每批映射结果、版本、指纹、usage 持久化；失败仅重试未完成批。prompt / model / mappingVersion 变化明确使哪些缓存失效。
- 相同 entryId 的跨批提案合并引用与兼容字段，矛盾进入 review，不做静默 first-wins。
- 汇总全部抽取与映射用量，区分缓存命中、首次请求、重试请求和失败成本。
- 全部必需范围已验证成功、依赖完整、冲突门禁通过后才发布；“尝试完所有任务”不等于完成。
- 发布事务幂等：同 run 重试不反复创建相同 revision；中途失败保留最后一个已发布版本与待审草稿。
- 如未来提供局部预览，必须清楚标注范围和未完成状态。本次默认完整构建，不用局部世界替代本次验收。

## 8. 真实动态进度与交互

### 8.1 展示规则

任务卡和通知展示相同 run 的数据：文件名、阶段、状态、章节 / 分组、完成数、失败数、重试、已耗时、最新进度时间、暂停/继续/重试入口。

| 阶段 | 真实计量 | 展示 |
|---|---|---|
| 复制 / 读取 | bytesRead / totalBytes | 已读取 MB 与阶段进度条；总长未知则不定进度 |
| 规范化 / 建索引 | 已处理源 bytes 或码点、已落盘片段 | 不把“扫描到末尾”提前算作索引完整提交 |
| 抽取 | 已原子提交的无重叠有效范围码点 / 计划范围；组数辅助 | “抽取 42% · 18/43 组 · 2 组等待重试” |
| 归并 / 校验 | 可计数单位，否则不定进度 | 明确正在检查内容；不伪造匀速百分比 |
| 映射 | 已提交批 / 冻结计划批 | “映射 3/8 批” |
| 发布 | 真实事务结果 | 只有发布成功才显示整个构建完成 |

默认用阶段条 + 当前阶段真实比例，不制造看似精确的总耗时百分比。若提供总量估计，必须标“估算”，冻结权重/版本，并解释拆组导致分母变化；不能靠 timer 把未完成任务推到 99%。

### 8.2 状态同步

- 数据库为真相，UI 首次打开 / focus / AppState active 读取 snapshot，随后订阅事件；事件只用作刷新提示，丢事件后可恢复。
- 通知由同一持久化 snapshot 驱动；恢复界面显示真实状态，不能重置成 0 或丢任务卡。
- UI 进度节流约 250–500ms，通知约 1s；事务完成后可见状态延迟目标 ≤2s。错误与终态立即刷新。
- 等 LLM 时显示请求已等待多久、attempt 和最近成功提交时间；无新回执不能谎称新进度。
- 断网显示等待网络；凭据不可访问显示等待解锁/配置；后台系统限制显示已保存并暂停；失败显示失败任务数与可重试范围。
- 暂停与取消、全任务重建与失败重试分开，避免误操作付费重跑。
- 按四主题适配 Bar / 状态色 / 文本，百分比有可访问性语义，不只依赖颜色。

## 9. Android 后台执行方案

### 9.1 推荐选择

**用户从前台主动启动的长构建：原生前台服务 + 常驻通知 + 可恢复的 JS runner；数据库租约保证唯一执行者。** 导入 CPU / 文件 I/O 放原生有界执行，TS 保留抽取、校验、世界映射规则。先做垂直验证，再接整个流水线。

不能只增加一个永远显示“构建中”的空 Service。必须验证 RN 0.85.3 当前架构在 Activity 不可见时执行、冷启动恢复和密钥访问；Headless JS 可作为无 Activity 的入口，但不是系统无限保活保证。[React Native 官方 Headless JS 文档](https://reactnative.dev/docs/headless-js-android)

WorkManager 适合约束等待、有限工作片和恢复调度；不要把整个小时级 LLM 流水线塞成无限长 Worker。Android 16 的 long-running Worker 可能消耗 JobScheduler 配额，官方说明可按场景直接启动前台服务。调度器不拥有另一套并行业务循环，必须调用同一 run/lease 入口。[Android long-running workers](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running)

### 9.2 必须实现

1. Kotlin Service/Module、通知 channel、小图标、打开任务详情的 PendingIntent、暂停/取消动作，禁止把小说正文或 API Key 放通知/Intent。
2. 从用户前台操作及时启动并进入 foreground；避免等重度解析结束才启动。补 `FOREGROUND_SERVICE`、对应类型权限；Android 13+ 处理 `POST_NOTIFICATIONS`。
3. 本地处理及云端资料传输可评估 `dataSync`，按官方服务类型适用范围登记。当前 target 36 必须声明正确类型，不冒充 mediaPlayback 等绕限制。[Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
4. Android 15+、target 35+ 的 dataSync 有累计时限（通常每 24 小时后台总计 6 小时）；实现 `onTimeout` 并及时停止服务，runner 的最近事务 checkpoint 保证恢复。不能以连续重启服务逃避限制。[Foreground service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout)
5. Android 12+ 后台启动限制、系统停止、低内存回收、重启、离线、充电策略分别处理；开机广播不直接强拉长 dataSync 服务。到下一次合法执行机会再恢复。
6. Headless 任务参数只传 runId 等标识，不传全文、key 或整个结果；注册入口、前后台切换、promise 结束和任务超时必须释放租约/资源。
7. wake lock 只在确实需要的运行窗口持有，有限超时且所有退出路径释放；暂停/无网络不无限续期。是否需要由锁屏试验和所用调度器行为决定。
8. 锁屏与 Keychain 实测：当前使用 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`，不得为了后台运行改成明文 key。记录平台实际行为；不可取凭据则 `waiting_unlock`，解锁后恢复。
9. 通知权限拒绝不是 FGS 必然不能启动：按平台实际限制处理，页面说明可见性差异。不要把权限拒绝写成“小说构建失败”。
10. Process restart 后扫描未完成 run，过期 running 转可恢复并重新领取；拒绝陈旧执行者提交。对下载/云端 SAF 源需先确保私有副本可读。

### 9.3 对用户承诺的行为

| 场景 | 必须达到 |
|---|---|
| 按 Home / 切其它 App | 正常后台继续处理，有任务通知与真实进度 |
| 锁屏 | 系统和凭据允许时继续；受限时明确暂停且保存进度 |
| 进程被系统回收 / 从最近任务移除 | 不保证毫不中断；再次合法运行时从 checkpoint 续建，不丢已提交成果 |
| 设置中强制停止 | 不承诺系统自动复活；用户再次启动后可以续建 |
| Doze / 无网 / 限时 | 等待或受控暂停，不假完成、不无限重试 |
| 多次点击恢复 / 前后台同时触发 | 同一 run 只有一个有效执行者 |

本节是本项目架构选择与验收要求；官方限制是约束，不等于已在本机完成兼容性验证。

## 10. 二期业务遗留收尾

不能用本次三项构建改进覆盖或取消原 R6 未结项：

| 工作包 | 当前缺口 | 交付出口 |
|---|---|---|
| 完整 1+2 队伍旅程 | 分项核心回归不能替代同一队伍 App 旅程 | 创建玩家+两同伴 → 探索 → 社交 → 战斗 → 休整 → **成功训练** → 任务奖励 / 知识发现 → 书页同步 |
| 同伴生命周期 | 运行期 UI 与规则贯通待验 | 招募、拒绝理由、指令、分队、通信、重入、物品归属均验证；未知知识不自动广播 |
| disabled fate | 当前 `src/domain/combat/encounter.ts` 中 `DISABLED_FATES` 只是候选枚举，未见完整合同驱动状态机 | captured / rescued / death_risk / ending 的来源合同、触发/退出、UI、权威事件、快照、rewind/save；独立规则审查，不能以一次援救代替 |
| 故障和确定性 | 新 UI、任务系统引入生命周期变化 | Planner/Narrator 失败、杀进程、相同冻结合同与同一 RollRecord 恢复；不重掷、不重复奖励 |
| 三书 / 权限 | 实际模型质量和屏幕可见性待验 | explicit / inferred / rule_mapping / design_fill 可追踪；GM/未来/未发现资料正确过滤；冲突阻止发布 |
| 存档、世界包、迁移 | 当前最终包往返与旧库升级待验 | 新旧包导入、缺依赖提示、干净库恢复、状态 hash 一致、下一合法行动、分支隔离 |
| 两种模型与长程 | 单 GLM 配置不能自动满足双模型要求 | 至少两个实际可用模型，推理开启，含无 JSON 模式路径；≥100 个提交动作、多模式、至少一次分叉，分类统计拒绝/重试/错误 |
| 三题材与独立标注 | 本次只提供一部小说 | 另备自创/获准语料与独立 ≥200 关键事实（含别名/倒叙/传闻），召回目标 ≥90%，explicit 引文定位 100%，语义支持率独立记录 |

若第二模型、独立人工标注或设备不具备，可以交付工程修复版本，但这些项必须留为未通过；不得据此宣布 Beta 全量验收成功。业务待完善部分与外部待验部分分开记录。

## 11. 分阶段施工与交付物

每阶段：**实现 → Review → Fix → 回归 → 记录 → 阶段提交**。只提交本阶段相关文件，遵守当前仓库工作方式；不为了进度跨过失败门禁。

| 阶段 | 任务与主要文件 | 必须交付 / 出口 |
|---|---|---|
| C0 当前版本可构建 | 同步 mobile 依赖，修 UI 相对路径/类型，核验 native 依赖和资源 | core≥156且不删除测试、mobile typecheck PASS、debug build PASS；`C0_BASELINE.md`；实测源码和包对应 |
| C1 数据正确性抢修 | `worldImport.ts`、`txtImport.ts`、`buildWorld.ts`、`extraction.ts`、worldStore | 哈希差异、正确复用、缓存指纹、事件崩溃恢复、原子结果提交测试通过；旧数据修复/隔离策略；先不追并发 |
| C2 流式源与任务底座 | SourceReader/SourceManifest、新 source/run/unit store、迁移、native TXT 模块 | 私有源持久化、一次解析、有界读、自动分章、staging 激活；30 MB 本地预处理可完成；断电/中断可恢复 |
| C3 分组与映射优化 | 自适应 groupPlanner、LlmChunkExtractor 分段协议、可恢复 mapper | 全文覆盖、正确证据、超长章、预算、有限并发、限流、断点、跨批归并、usage 汇总；对照质量不回退 |
| C4 动态进度与任务界面 | build progress projection、Library/BuildStatusCard、重试/暂停入口 | 全阶段真实计量、重进页面恢复、失败任务可定位；四主题、可访问性；不得模拟百分比 |
| C5 Android 后台执行 | BuildForegroundService/Module、Headless runner、Manifest、通知、必要恢复调度 | 前后台/锁屏/回收/timeout/通知动作矩阵；单一执行者、无丢进度、及时释放资源 |
| C6 二期业务与第三期 UI 闭环 | encounter fate、session、projection、Play/Opening/panels、迁移兼容 | 同一 1+2 队伍完整旅程、回退/存档、四主题和原 §29 全部旅程；独立审查新增写路径 |
| C7 真实模型、设备与发布验收 | 测试 harness、性能采集、Release 构建与文档 | 全文构建实测、30 MB 压力、双模型/长程/三题材、旧库升级；报告、签名 Release、已知问题 |

依赖：C0 → C1 → C2 → C3；C4/C5 共用 C2 任务底座；C7 等待 C3–C6。后台技术垂直验证可在 C2 期间提前进行，避免最后才发现 RN 接入不兼容。

建议新增目录（按现有架构调整，禁止留下第二套重复构建引擎）：

```text
src/application/import/               # 流式解析契约、源规范化和章节索引
src/application/ports/sourceReader.ts
src/application/ports/worldBuildStore.ts
src/application/worldBuild/           # coordinator / groupPlanner / progress / recovery
src/infra/sqlite/                     # run、unit、source 存储实现
mobile/src/build/                     # runner、订阅、native bridge
mobile/android/app/src/main/java/com/shineword/app/
  ShineWordTextSourceModule.kt
  WorldBuildForegroundService.kt
  WorldBuildModule.kt
docs/reviews/closeout/                # 分阶段审查、性能、设备、最终报告
```

## 12. 可执行验收矩阵

### 12.1 正确性和恢复测试

| 编号 | 场景 | 通过条件 |
|---|---|---|
| T01 | raw / chapter / chunk 哈希，UTF-8 / GBK / UTF-16 | 与独立参考一致；不同内容不同 hash；mobile 实际适配器纳入测试 |
| T02 | 旧错误哈希世界、缺失源、合法重复段落 | 不错复用、不误判全部重复段污染、不修改旧 published 包；提示可恢复 |
| T03 | emoji/代理对、CRLF跨块、BOM、空行、超长无换行段 | 规范化等价、范围连续、码点引文100%回放一致 |
| T04 | 多章节打组、长章拆组、输出截断后拆组 | 覆盖无遗漏，overlap不重复计数，歧义证据拒绝 |
| T05 | facts已写但job未done、job提交前崩溃、事件归并前崩溃 | 事务回滚或幂等补全；不丢事件、不重复事实/奖励、不假完成 |
| T06 | 映射第N批失败、发布事务前后崩溃 | 已完成映射批复用、结果一致、revision不重复发布 |
| T07 | 双击开始/恢复、旧lease晚回包 | 一个有效owner，旧fencing不能提交 |
| T08 | 401/429/5xx/断网/超时/无JSON/reasoning-only | 错误分类与重试策略正确；配置错误不会无限重试 |
| T09 | 页面退出/回来、App重启、暂停、取消 | snapshot恢复，计数符合DB，取消后不再发布 |
| T10 | 新旧库迁移、旧包/存档、世界源版本变化 | 旧战役继续、引用锁不变、新构建独立版本 |

core 单测补业务规则；mobile 适配器测试必须实际覆盖 fileBase64 路径；native instrumentation / APK 才能证明真实文件桥、SQLite 与生命周期。禁止以全 mocked 的内存测试替代端上故障注入。

### 12.2 性能基准与拟定门槛

先记录目标真机型号/RAM、Android版本、温控/电量、构建模式和网络。下列为**验收目标，不是已达到成绩**；C0 冻结基准后如需调整，必须先说明理由，禁止跑完后降低标准迎合结果。

| 指标 | 建议目标 / 记录要求 |
|---|---|
| 任务交互反馈 | 启动任务后 ≤1s 出现任务状态；阶段提交后 UI/通知 ≤2s 可见 |
| 30 MB 本地预处理 | 参考 6GB RAM 真机 Release，目标 ≤60s 完成复制/解码/分章/索引与任务落盘；网络抽取耗时另计 |
| 内存 | 30 MB 场景较空闲基线新增 PSS 目标 ≤150 MiB；同时报Java/native/JS可用指标；无全文base64、多份全文常驻 |
| 卡顿 | 无 OOM/ANR；重CPU不占UI线程；记录frame stats与长任务；禁止把无崩溃等同流畅 |
| 本地恢复 | 已持久化源恢复不重新导入全文；目标 ≤3s 重建任务视图并开始符合条件的待处理任务 |
| 真实LLM性能 | 每阶段耗时、首响应/完整响应P50/P95、物理请求数、输入输出token、重试与限流数、质量；不承诺整本分钟级完成 |
| 优化比较 | 相同素材/模型/策略，对照请求数、预处理时间、峰值内存与事实质量；先证明完整性，再计吞吐收益 |
| 既有业务P95 | 本地裁定+提交≤100ms（标准最多9参战者）；角色卡/缓存书页≤200ms；沿用二期目标，网络另报 |

样本矩阵：20万字、提供的约96.5万码点小说、精确30,000,000-byte合成文本；另覆盖30 MiB边界、无标题和超长段。全书模型运行使用真实小说；30 MB 至少完成端上预处理、分组计划、真实模型贯穿若干组和真实后台恢复，并用确定性执行器完成全任务压力；若未完成30 MB全量真实模型构建，必须明确标注该项未验，不能用合成执行器宣称全量模型通过。

本地导入基准每样本至少3次分别报告；本地业务交互按足够样本计算P95（建议≥100次）。网络真实长程按实际可收集样本报分布，不能用极少样本伪称稳定P95。

### 12.3 Android 生命周期矩阵

- 设备：API 24、较新模拟器、Android 15/16 的限时/配额行为，以及用户实际真机；合并 Manifest/依赖声明与最低系统实际安装分别检查。
- 抽取、映射、本地解析三个阶段分别按 Home、切应用、锁屏15–30分钟、进程回收、断网恢复、关闭通知权限、点通知恢复。
- 单独验证系统强制停止后用户重开；不要用 force-stop 冒充普通后台切换。
- 模拟超时使用隔离设备并记录还原系统测试配置；验证 `onTimeout` 及时结束，DB记录可恢复。
- 随机提交边界故障注入≥20次，已提交工作无丢失；记录是否重复发送在途请求及原因。
- 每例收集 runId、进度前后、任务计数、脱敏logcat、数据库断言和必要截图；没有设备则标 blocked，不借用历史截图。

### 12.4 第三期产品验收

完整覆盖原方案 §29，不只验新构建卡：首次配置、四主题、世界主题覆盖、书库、三书玩家/编辑模式、审核、世界包、Opening四步；Play首回合、有骰/无骰、Narrator恢复、kill恢复、短/长休、成功训练、同伴生命周期、知识/物品、全部遭遇动作、rewind、存档导出导入、角色与NPC卡、任务/知识面板。

视觉要求：四主题关键屏幕截图，文本对比度≥4.5:1、触控面≥44×44dp、icon-only label、资源条同时给数值、Back先关弹层；键盘不遮输入与提交键，长小说/长历史下滚动正常。Release不出现ThemeGallery入口。

## 13. 测试配置与数据管理

- 本地 agent 可使用本次明确提供的 GLM 配置和小说进行相关验收；先在进程内解析配置，输出仅允许模型名、脱敏端点、是否具备所需字段，绝不打印原文件或API Key。
- 凭据只进临时进程内存或现有Keychain；不得放源码、SQLite任务、AsyncStorage、命令行参数、截图、git、日志或报告。
- 本次只确认文件存在，不确认GLM配置可用、余额、模型窗口或第二模型。施工时先做最小连通性与能力探针，保持已确认的推理开启政策，再小样→章节组→全文逐级执行并记录预算。
- 模型参数使用真实可用配置，不能凭“GLM”猜窗口、JSON能力或输出上限；测试涉及的小说片段只按该构建功能发送给用户配置的模型端点。
- 不把小说全文、私人数据库、原始响应、存档、密钥或APK加入仓库；报告只存聚合指标、脱敏错误和必要证据索引。独立质量标注留本地测试资源区，提交前检查内容授权及隐私。
- 除《白篱梦》外的三题材/独立标注、第二模型、真机等条件施工时重新盘点；旧R6报告说“没有”不代表今天仍没有。

## 14. 最终交付与完成判定

必须提供：

1. 可构建源码、增量迁移、必要的单元/集成/故障注入测试与复现命令。
2. 当前源码对应的debug验证与签名Release APK；记录HEAD及dirty状态、versionCode、bundle/APK hash、签名校验、arm64体积、安装/冷启动证据。版本Code递增，不能只改文案。
3. `docs/reviews/closeout/` 的阶段报告、三项问题前后对照、真实模型质量/成本、设备性能、后台矩阵、旧库兼容与最终结项矩阵。
4. README / DEVELOPMENT_STATUS 更新为当前实证，不覆盖历史报告；第三期最终报告追加本地验收补充链接。
5. 用户操作说明：导入后分章与分组、后台通知、暂停继续、失败重试、系统限制、旧任务修复提示。

最终逐项勾选：

- [ ] mobile TypeScript、核心测试、debug与release门禁通过。
- [ ] 不同块hash正确，旧污染任务受控处理，无漏读假成功。
- [ ] 30 MB流式导入可用，性能数据与真实LLM数据分开。
- [ ] 章节/分组完整覆盖、映射可断点、显式事实引文可验证。
- [ ] 实时进度与DB一致，页面/进程恢复后仍可读。
- [ ] 切应用继续构建，锁屏/回收/系统时限受控，恢复不丢已提交成果。
- [ ] 原二期遗留业务闭环和第三期UI/四主题/兼容性门禁关闭。
- [ ] 双模型、长程、三题材和独立质量评估有真实证据；缺项明确未通过。
- [ ] 最终APK与报告对应同一源码，所有P0/P1关闭或明确阻断发布。

可分别声明“工程修复完成”“第三期验收通过”“二期Beta验收通过”，三者条件不同。任何未满足的外部验收项都必须保留，禁止统一写成“全部建设完成”。

执行提示词见：[Shine-TRPG_CLOSEOUT_AGENT_PROMPT.md](Shine-TRPG_CLOSEOUT_AGENT_PROMPT.md)。
