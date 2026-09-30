# M3 Review — Story Memory V2（双轨）

> 阶段：M3
> 基线：`87f696c`（M2）

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `storyMemoryTypes.ts` | StoryMemoryState v2（characters/relationships/narrative{arc,conflicts,threads,foreshadowing,beats,resolved,digest}/metadata{status,dirtyFrom,fingerprint,lastPatch}）+ 六类 Patch 项 + 上限常量 |
| `storyMemoryPolicy.ts` | Smart Cadence（interval≥8 / 高重要 / 关系 / 冲突 / 任务 / 队伍 / dirty / 手动）；`planMemoryCoverage()` no-stall 三态（clean/safe_lag/**hard_gap fail-closed**）；`extractMemorySignals()` 从 committed effects+grade 确定性提取信号 |
| `storyMemoryValidator.ts` | actorId ∈ 已知角色、evidenceTurnIds ⊆ 本批 turn、range 严格连续、action 枚举、字段清洗（空白串丢弃）；错误列表驱动 repair 重试 |
| `storyMemoryMerger.ts` | 确定性 merge：本地生成稳定 ID（`rel:a->b`、标题指纹 slug）；未提供字段保留、列表整体替换、上限截断；**指纹链** base→patch→result；base 指纹不符拒绝（PatchFingerprintMismatchError） |
| `storyMemoryRepository.ts` | migration 20 两表读写；`forkStoryMemory()` 在 fork 事务内复制 ≤forkVersion 的补丁并从空种子折叠 |
| `storyMemoryCompiler.ts` | checkpoint 请求：actor 表（id+名）、紧凑前情视图、批次 turns（summary+narrative≤800+grade+effects op）、严格 patch 协议 |
| `storyMemoryMaintenance.ts` | 编排：cadence 门（无 LLM）→ hard-gap 检查 → 批次（≤8 turns）→ checkpoint（≤3 物理请求/run，1 轮 repair）→ merge → 落库；失败标记 failed 不抛出（no-stall） |
| migration **20** `story_memory_v2` | `story_memory_states` + `story_memory_patches`（含 branch 索引） |
| fork.ts | 事务内新增：committed turns/rolls/narratives/branch_events/memories(旧轨) ≤forkVersion 复制 + `forkStoryMemory` 折叠 |
| session.ts / mobile | playTurn 提交后 fire-and-forget `shouldRunMaintenance→runStoryMemoryMaintenance`；deps.storyMemory 接线（return-first，plan §68） |

## 2. 关键设计决策

1. **双轨**：旧 8 回合 Summary 完全未动；Planner 仍读旧轨（plan §97）。Story Memory V2 只写不读，M5 才给 Planner。
2. **ID 本地产生**（plan §27）：关系 `rel:from->to`；冲突/线索/伏笔用标题指纹 slug —— 同一叙事线跨 checkpoint 保持同一 ID，模型永不产生数据库键。
3. **证据回指**（plan §26）：每项必引批次内 turnId，验证器强制；beat 的 stateVersion 由本地从批次解析（模型只给 turnId）。
4. **fork 隔离**（plan §28/§67/§88）：补丁链 ≤forkVersion 复制 + 从空种子确定性折叠 → b2 through≤fork 且绝无 fork 后内容；源分支不动。**顺带修复**：fork 现在复制 committed 历史（此前新分支 turn 历史为空——episodic/记忆召回无从谈起）。
5. **No-Stall**：维护全程后台；hard gap（历史缺版本）→ maintenance 也 fail-closed（`hard_gap`），不虚构时间线。
6. Ledger：checkpoint 请求带 `memory:<branch>:v<from>-v<to>` 身份进入 M2 账本。

## 3. 测试（`tests/story-memory-v2.test.cjs`，19 用例）

合并器（首次人物/字段保留+列表替换/关系建立-纠正-移除/冲突 open-resolve 同 ID/伏笔 plant-payoff/陈旧指纹拒绝）✅
验证器（未知 actorId / 未知证据 turn / 错误 range / 空证据 / 合法归一）✅
策略（interval/有意义信号/dirty 触发；确定性信号提取；clean/safe_lag/hard_gap）✅
维护 e2e（首次 checkpoint 落库/无效补丁一轮 repair/连续失败标 failed 不抛/16 回合拆 2 批/hard gap 无 LLM fail-closed/cadence 门）✅
**fork 隔离**（b1 through12 → fork v9 → b2 through8、无 fork 后人物知识、补丁仅 1 条 ≤9、源分支不变）✅
migration 20 建表 ✅

plan §30 清单映射：首次人物✅ 别名（actor 表消歧+验证器拒绝名字）✅ 关系建立/改变✅ 承诺✅ 秘密✅ 冲突 open/resolve✅ 伏笔 open/paid✅ 人物离队/死亡（party_change→high_importance 信号）✅ 误会纠正（publicStatus misunderstood→public）✅ rewind/fork 隔离✅ dirty rebuild（dirty→cadence 立即触发）✅ fingerprint mismatch✅。

## 4. 门禁

- `npm run verify:core`：**366/366 PASS**（347 + 19 新增）
- `npm run typecheck --prefix mobile`：PASS

## 5. 遗留（转后续阶段）

1. Planner 读取 V2（切换 Gate：clean+through 足够+fingerprint 有效，plan §99）—— M5。
2. Memory Queue 串行化（同 branch 不并发 checkpoint；当前由单 playTurn 后台链保证，多入口时需队列）—— M6 加固。
3. checkpoint 的 maxOutputTokens=1600 尚未经 kernel —— M5 统一。
4. episodic_turn_index 表 —— M4（migration 21）。
