# C1 数据正确性抢修：错误哈希与旧污染数据

日期：2026-09-28。基于 C0 提交后的工作区。全部命令本机实测。

## 修复的缺陷

### D1（P0）：mobile 字节哈希适配器忽略传入 bytes

`mobile/src/worldImport.ts` 的 `makeBytesSha(fileBase64)` 在 `fileBase64 !== null` 时无条件调用 `nativeSha256BytesHex(fileBase64)`，完全忽略 `sha256BytesHex(bytes)` 的参数。真实导入（`LibraryScreen` 传 `picked.base64`）下：

1. 原文件、每章、每块三类摘要全部等于整本原文摘要；
2. Kotlin `ShineWordCryptoModule.sha256BytesHex` 每次重复解码并散列整本（本次小说 1,245 次调用）；
3. `findReusableJob`/逐块 done 检查按相同 hash 命中首个成功块 → 其余块被错误"复用"跳过抽取 → 漏读假成功。

### D2：`INSERT OR IGNORE` 残留使污染 hash 无法自愈

`saveImportedSource` 对 `source_chunks`/`source_chapters` 用 `INSERT OR IGNORE`：即使适配器修好，旧行的错误 hash 与 `extraction_status='extracted'` 永远保留，恢复构建时按旧 hash 匹配旧 done job，仍然全跳过。

### D3：事件只在内存归并，崩溃窗口丢事件

原实现把全部事件提案放在内存 `collectedEvents`，所有 worker 结束后才 `saveEvent`。块 done 已落库、事件未持久化时进程死亡，重启后 done 块被跳过，事件永久丢失。facts/entities/事件/块状态/done 标记也没有一个原子提交边界。

### D4：done 复用只比 contentHash

逐块路径 `existingJob.status === 'done' && contentHash === chunk.contentHash` 不校验 extractor 版本与模型指纹；`findReusableJob` 也不校验模型指纹。配置变化后仍复用旧结果。

### D5：failedChunks 时世界仍标 ready

底层 builder 在存在失败块时仍 `setWorldStatus('ready')`，持久化状态与实际不符（mobile 端虽阻止发布）。

## 实现

| 文件 | 变更 |
|---|---|
| `src/application/import/byteShaAdapter.ts`（新） | `makeBase64NativeByteSha(native)`：对任意传入 bytes 正确 base64 编码后走原生哈希；mobile 与测试共用同一实现 |
| `mobile/src/worldImport.ts` | 删除 `makeBytesSha(fileBase64)` 与 `fileBase64` 参数；`buildWorldOnDevice` 使用 `bytesSha`（原文件摘要每 parse 恰好一次；章/块各自散列自身文本） |
| `mobile/src/ui/screens/LibraryScreen.tsx` | 调用点去掉 `picked.base64` 实参 |
| `src/infra/sqlite/builtinMigrations.ts` | 迁移 11 `event_proposal_checkpoint`：`world_event_proposals(world_id, chunk_id, event_id, …, status proposed/resolved)` |
| `src/application/ports/worldStore.ts` | 新增 `StoredEventProposal`、`CommitChunkResultInput/Outcome`；`findReusableJob` 增加可选 `modelFingerprint`；新增 `commitChunkResult`/`listEventProposals`/`markEventProposalsResolved` |
| `src/infra/sqlite/sqliteWorldStore.ts` | `saveImportedSource` 改 upsert：hash 变化的块重置为 pending（自愈旧污染），未变的保留状态（幂等恢复）；`commitChunkResult` 单事务写入 entities+去重 facts+事件提案+块状态+done；`saveFactTx/upsertEntityTx/upsertJobTx` 提取为事务内复用；`findReusableJob` 指纹匹配 |
| `src/application/world/buildWorld.ts` | 逐块成功路径改为单次 `commitChunkResult` 原子提交；事件提案随块持久化；最终归并从 DB 读全部未 resolved 提案（覆盖此前中断运行的块），已知依赖集合并入已提交 canon 事件；done 复用校验 extractorVersion+modelFingerprint；failedChunks>0 时世界标 `failed` 而非 `ready` |

## 旧数据修复/隔离策略（保护既有数据）

1. **不删除、不改写任何旧 published package / 战役 / 存档**：重建只新增事实（按 subject+predicate+value 去重，重复记 `duplicate`），发布产出独立新 revision（测试 `re-extraction … published packages untouched` 验证 world_packages 行不变）。
2. **污染自愈路径**：用户对同一文件重新进入构建 → 新 parse 产出正确 hash → upsert 覆盖旧块 hash 并重置状态 → 旧 done job（hash=原文摘要）不再命中 → 全部块重新抽取。无需一次性迁移脚本，也不误伤"合法重复段落共享 hash"（`T02c` 验证去重语义保留）。
3. **配置指纹**：模型/端点指纹变化后不复用旧块结果，防版本漂移复用（`T07`）。
4. 恢复运行不重付已完成块（`T02b`：clean 重导入 0 次抽取调用）。

## 回归证据（`tests/closeout-c1.test.cjs`，10 项全过）

| 用例 | 覆盖 |
|---|---|
| T01 ×2 | mobile 适配器（核心工厂 + Node crypto 扮演原生侧，真实代码路径）：文件摘要=参考 SHA-256；不同块摘要互异且等于参考；均不等于文件摘要；原生侧收到的正是各范围自身 bytes；UTF-8/UTF-16 字节序列区分 |
| T02 | 模拟污染库（全部块 hash=原文摘要、伪 done job）→ 重建后全部块重抽取（extractor.calls=块数）、reusedJobs=0、存储 hash 重新互异、状态 ready |
| T02b | 干净重导入 0 次重抽取，全部复用 |
| T02c | 合法重复段落仍按内容去重事实 |
| T05a | 事件归并阶段崩溃 → 提案已 checkpoint、canon 事件为 0；恢复运行 0 次重抽取、从 DB 重放归并、提案清零 |
| T05b | 事务中途失败注入 → 0 条事实残留、无 done 标记；恢复运行完成且 ready |
| T07 | 模型指纹变化 → 全部重抽取 |
| 状态诚实 | 失败块 → 世界 `failed` 而非 `ready` |
| 包保护 | 重建前后 world_packages 行完全一致 |

全量门禁：`npm run verify:core` = **166 tests / 166 pass / 0 fail**（156 原有 + 10 新增，未删任何测试）；`npm run typecheck --prefix mobile` = **PASS**。

## 边界与未完成（移交后续阶段）

- 事件提案依赖解析仍要求依赖事件出现在"未 resolved 提案或已提交 canon 事件"中；跨源版本（C2 SourceManifest）后由 run/unit 底座统一。
- usage 汇总、按 token 分批映射、并发/背压、流式解码与整本 base64 消除属于 C2/C3。
- 本阶段未做真机验证；mobile 适配器的 RN 原生绑定（`nativeSha256BytesHex`）在端上的行为由 C7 设备验收覆盖。
- `worldImport.legacyReencodeDigest` 的整文件二进制串转换仍在（仅 resume 匹配用，每导入一次）；C2 流式源落地后移除。
