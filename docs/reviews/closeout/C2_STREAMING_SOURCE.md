# C2 流式源持久化与任务底座

日期：2026-09-28。基于 C1 提交后的工作区。全部命令本机实测。

## 目标与出口（对照总控方案 C2 行）

私有源持久化、一次解析、有界读、自动分章、staging 激活；30 MB 本地预处理可完成；断电/中断可恢复。

## 架构落地

### 1. 流式导入器（核心，Node 与设备共用）

`src/application/import/streamingTxtImport.ts`：

- 输入是 `StreamingTextSource`（有界解码文本窗口 + 原文件 SHA-256 + 编码标签），输出 SourceManifest 数据 + 章/块计划。
- **与批式 `importTxtSource` 语义等价**：行级规范化（CRLF/CR、NBSP、零宽、行首尾空白、空行折叠）、分章策略判定、章/块规划全部走 `txtImport.ts` 新导出的共享函数（`paragraphMetaFrom`/`classifyChapterStrategy`/`buildChapterDraftsFromMeta`/`planChunksForChapter`），两条路径不可能漂移。等价性由回归测试逐字段断言（章 id/标题/偏移/长度/哈希、块全字段）。
- 规范化文本以 ~32k 码点分片落库（`SourceShardStore.saveShard`），**全文从不整串驻留内存**；章/块文本与哈希通过 `readRange` 有界读回。
- 差异（有意设计，manifest 记录版本）：超长无换行段按码点硬切（默认 50k cp 上限，代理对安全）；规范化摘要为版本化 shard-tree hash（`normalize-hash-shard-tree-1`），不是整串 SHA-256。
- 消除双解析：抽取文本一律从持久化分片读，不再 `CodePointOffsetIndex(parsed.text)` 逐块重建（批式路径同步改为全构建共享一个索引）。

### 2. 源存储（SQLite，迁移 12）

`imported_sources`（manifest：raw sha、tree hash、编码、码点数、版本、staging/active/orphaned 状态）、`imported_source_segments`（分片正文）、`imported_source_chapters`/`imported_source_chunks`。`SqliteSourceStore`：

- `beginStaging` → 流式写分片 → `activateSource` 单事务提交 manifest+章+块并置 active；中断留下 staging 记录可清理（`listStagingOlderThan`+`deleteSource`，active 拒删）。
- `findActiveByRawHash`：同一文件重导入直接复用 active 源，不重新解析。
- **构建恢复不再需要重新选文件**：抽取只读 DB 分片；暂存的原文件副本在激活后即删除。

### 3. Run/Unit 底座（SQLite，迁移 13）

`world_build_runs`（phase 独立于 status、units 计数、lease_owner/expires、fencing_token 单调递增、heartbeat、错误码）与 `world_build_units`（kind、source_ranges、input_hash、config_fingerprint、parent_unit_id、status、attempt、retry_at、result_ref、usage）。`SqliteBuildRunStore` 提供 CAS 租约领取/续期/释放、fenced `completeUnit`/`replaceUnitWithChildren`。

### 4. 协调器

`src/application/worldBuild/coordinator.ts`：`createExtractionRun`（每块一个 extract_group unit，input_hash=块内容哈希，config 指纹=pipeline+extractor 版本+模型指纹；世界行+世界侧章/块镜像沿用单一世界内容权威）；`executeRun`（租约 → 逐 unit：领取 → 从分片读文本 → LLM 抽取 → `applyExtraction`（有界证据校验）→ C1 原子 `commitChunkResult` → fenced unit 完成）。错误分类（network/rate_limit/config/truncation）驱动退避或 needs_review；崩溃后重入对已完成块走 world 侧 done 快路径，不重付 LLM；全部 unit 完成后重放事件提案归并（复用 C1 checkpoint）。

### 5. 设备侧（Android）

- `ShineWordTextSourceModule.kt`：`stageUri`（SAF 文档流式拷贝到私有 `files/sources/*.bin`，边拷边算 SHA-256，fsync+原子改名，剩余空间检查）；`detectEncoding`（BOM+UTF-8 探测，与核心标签一致）；`readTextChunk`（CharsetDecoder 带多字节尾部携带的有界解码，窗口 ≤512 KiB）；`deleteStaged`。
- `mobile/src/textSource.ts`：实现核心 `StreamingTextSource` 的桥接。
- `mobile/src/sourceImport.ts`：pick → 暂存 → 流式导入/复用 → 激活 → 建 run → 抽取执行；`fileBridge.pickTextRef` 只取 uri+名字，**整本 base64 过桥被移除**（世界包 ZIP 导入保留全文件读取，属另一路径）。
- `LibraryScreen` 的小说导入切到流式管线。

## 回归证据

| 门禁 | 结果 |
|---|---|
| `npm run verify:core` | **175 tests / 175 pass / 0 fail**（166 + 9 新增） |
| `npm run typecheck --prefix mobile` | PASS |
| debug APK（含新 Kotlin 模块） | BUILD SUCCESSFUL，`dist/apk/debug/ShineWord-V0.3.0-p4-debug.apk` 91.78 MB |

`tests/closeout-c2.test.cjs`（9 项）：

| 用例 | 覆盖 |
|---|---|
| 流式=批式（small / medium 微窗口 128B + 40cp 分片） | 章与块全字段逐一相等，强制触发所有边界路径 |
| 边界等价 | CRLF、BOM、空行折叠、孤立 \r、emoji 代理对、NBSP/零宽、缩进行、无结尾换行 |
| 超长段硬切 | 54k cp 无换行段 → 硬切计数>0、全量回读码点数吻合、分片不以孤立高位代理结尾 |
| 源存储生命周期 | staging→active、raw hash 复用、active 拒删、章/块读回一致 |
| 协调器完整运行 | run 完成、世界 ready、事实>0、重执行被 terminal 拒绝且 0 次抽取调用 |
| 崩溃恢复 | 第 3 块注入崩溃 → 恢复运行只补做未完成块（已完成 0 次重抽取）、世界 ready |
| 租约 fencing | 活租约不可抢、陈旧 token 提交被拒、过期后新 owner token 递增、旧 owner 无法续期/释放 |
| 30MB 合成压力 | 恰好 30,000,000 bytes（中文+emoji+ASCII 混合、7416 章）：**10,808,621 码点 / 14,831 块 / 330 分片，Node 预处理 5,985 ms**；全量回读覆盖一致 |

旧测试适配：`checkEvidence`/`applyExtraction` 签名改为有界 `EvidenceSource`（`tests/world-extraction.test.cjs` 三处调用点同步，断言语义不变）。

## 边界与移交

- 30MB 数值为开发机 Node 预处理参考；**端上（Release/模拟器/真机）计时与内存属于 C7 设备矩阵**，本文不冒充端上成绩。
- 协调器当前每 unit 一个块（1200 cp 请求粒度）；按模型预算自适应分组、分段协议（segments/segmentId 证据）、映射分批持久化是 C3。
- 进度目前通过 `onUnitDone` 回调到 UI；DB 驱动的任务卡/通知贯通与暂停/重试入口是 C4。
- 后台前台服务与 Headless runner 是 C5；本阶段 `runExtraction` 仍由页面 Promise 驱动。
- 流式导入在设备的端到端实测（真实 GBK/UTF-16 文件、SAF 权限、暂存清理）在 C7 设备验收覆盖；Node 侧已验证编码变体哈希区分（C1 T01）与解码携带逻辑（与 TAVO-MINI 参考同型）。
- `importTxtSourceStreaming` 的 `source_ranges_json` 目前单块范围；C3 组化后扩展为 segments。
