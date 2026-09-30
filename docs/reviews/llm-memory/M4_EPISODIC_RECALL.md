# M4 Review — Episodic Recall V2（完全本地）

> 阶段：M4
> 基线：`b38aa31`（M3）

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `episodicIndex.ts` | tokenizer（CJK uni/bi/tri-gram + 英文 word token，tavo-mini 配方）；倒排索引 + 文档频率；`semanticScore()` IDF 加权、长度归一、确定性 |
| `episodicRetriever.ts` | `resolveQueryActors()`（别名→actorId；**歧义别名不 boost 任何人**）；`eligibleEpisodes()` **visibility→time→branch→invalidation 先于 relevance**（plan §89 硬门）；`scoreEpisodes()`（relevance + actor +2.0 / actor-pair +3.0 / item +1.5 / quest +1.5 / keyword +1.0，tie-break 确定性）；`recallEpisodes()` 混合 Top-K（60% 相关 / 20% 人物历史 / 20% 近期；<5 结果保底 1 条近期防断裂）；whole-item 预算打包（选择按相关度、渲染按时间线）；CJK 保守 token 估算 |
| `episodicStore.ts` | `SqliteEpisodicStore`（upsert/list，migration 21 表）；`episodicRecordFromTurn()` 从 committed effects 确定性抽取 actor/item/location/quest 实体（**零 LLM**） |
| migration **21** `episodic_recall_v2` | `episodic_turn_index`（branch+version 复合主键 + 索引） |
| fork.ts | episodic 行 ≤forkVersion 复制到新分支（plan §67） |
| session.ts / mobile | 回合提交后台写 episodic 行（actorIds→角色名进 keywords），return-first |

## 2. 设计要点

1. **零外部依赖**：无 Embedding API、无每回合 LLM；索引与评分全本地确定性。
2. **IDF 缓存于索引对象**：`documentFrequency` 在 build 时一次算好，query 侧 O(terms)；1000 回合构建 ~几十 ms。
3. **身份以 actorId 为准**：名字/别名只是召回入口，歧义别名（两个「老李」）标记 ambiguous、不 boost。
4. **fork 隔离**：episodic 行随 fork 复制 ≤forkVersion；新分支召回永不触及源分支未来（M3 测试 + 本阶段测试双覆盖）。

## 3. 长程与性能实测（桌面 Node v24，2026-09-30）

| 规模 | 关键事件位置 | 召回结果 | 实测耗时 | 目标（plan §82） |
|---|---|---|---|---|
| 30 | t3 | t3 命中 ✅ | 1.24ms | <100ms |
| 100 | t3/t18 | 命中 ✅ | 1.09ms | <300ms |
| 300 | t3/t18/t73 | 命中 ✅ | 2.33ms | <800ms |
| 1000 | t3/t18/t73/t260 | **t3 与 t260 同时命中**（承诺问题查询）✅ | 4.71ms | <2500ms |

1000 回合索引构建 < 100ms；无 O(N²)（评分 O(turns × queryTerms)）。

## 4. 测试（`tests/episodic-recall-v2.test.cjs`，20 用例）

tokenizer ✅ / 30·100·300·1000 长程召回（早期关键事件必中）✅ / Turn-1 承诺问题在 v1000 命中 t3+t260 ✅ / branch+time+invalidation 先过滤 ✅ / 唯一别名 boost、歧义别名不 boost ✅ / 混合选择含近期桥接、渲染按时间线 ✅ / whole-item 预算打包不截断 ✅ / 确定性（乱序输入同结果）✅ / 性能门 ×4 ✅ / store upsert+门控 ✅ / effects 实体抽取 ✅ / fork 复制 ≤fork ✅ / migration 21 ✅

## 5. 门禁

- `npm run verify:core`：**386/386 PASS**（366 + 20 新增）
- `npm run typecheck --prefix mobile`：PASS

## 6. 遗留（转后续阶段）

1. Planner Context 接入 episodic 召回（作为 storyMemory board 的一部分）—— M5。
2. `invalid_at_state_version` 主动作废 API（当前 rewind=fork 天然隔离，无需作废；同分支内作废留待需要时）。
3. 索引按 branch 缓存（当前每次 recall 重建；实测 1000 回合 5ms，暂无必要）。
4. 移动端实测性能（桌面数字远低于目标；Android 实测 M6）。
