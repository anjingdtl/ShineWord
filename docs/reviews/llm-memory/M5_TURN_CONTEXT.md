# M5 Review — Turn Context 全链路接入

> 阶段：M5
> 基线：`0996945`（M4）

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `context/tokenEstimate.ts` | 共享保守 token 估算（CJK≈1 / 其他≈0.3）+ 句子边界裁剪 |
| `context/relevance.ts` | 0..1 词项重叠相关度（与 episodic 同一 tokenizer） |
| `context/candidateCollector.ts` | 【】label → 六 Board 候选映射（visibility 已在上游过滤，不重复判定）；`buildCandidate` 工厂（mandatory 默认 whole-floor） |
| `context/contextPlanner.ts` | `planTurnContext()`：kernel（M1）解析窗口/输出/思维预算 → 弹性分配 → whole-or-nothing / text-clip → **冻结**；能力未知 → **显式 legacy 回退**（flag + reason，不再静默） |
| `context/contextRenderer.ts` | 【行动协议】【当前局面】【世界与人物】【长期故事状态】【最近的经历】【原著证据】 分节渲染（非巨型 JSON） |
| `context/contextSnapshot.ts` | `FrozenTurnContext`（contextId/profile/budget 指纹/included/dropped/estimated） |
| session.ts | `collectWorldContextParts()` 抽取（buildWorldContext 变壳，零行为差）；`buildTurnContextBundle()`：parts + **Story Memory V2 读门**（clean 且 through≥current-8，plan §99，否则用旧轨摘要）+ **episodic 召回**（storyMemory board「相关往事」）+ 原著证据候选 → planner 全量 / narrator 小集两条冻结上下文；`lastTurnContexts` 调试暴露 |
| v2Turn.ts | `plannerOutputTokens` / `narratorWorldContext` / `narratorOutputTokens` 可选入参（缺省即旧值，向后兼容） |

## 2. 关键行为

1. **Planner/Narrator 分离**（plan §45-§46）：Narrator 只拿 currentState + storyMemory + 最近 3 回合故事，永无 worldKnowledge/sourceEvidence/authority 协议；session 级测试断言 narrator context 严格小于 planner。
2. **预算来自内核**：Planner maxOutputTokens=DEFAULT_OUTPUT_DEMANDS.planner.maximum（受模型/wire/推理预留封顶），不再是硬编码 1200/1500；session 集成测试验证 4000/独立值。
3. **Legacy 回退不破玩**：profile 无 capabilities（stub/旧档）→ legacyFallback=true、固定 1200/1500、上下文不裁剪——与旧行为等价，398 项旧测试零改动通过。
4. **三宝书按需激活**：lore 候选来自既有 anchor+visibility 过滤后的 parts（非全量塞入），由分配器按相关度与预算取舍。
5. **原著证据不再 slice(0,3)**：safeSourceContext 整体作为 sourceEvidence 候选，text-clip 按预算（plan §104）。
6. **Recent history 动态**：planner 侧由分配器决定保留量；narrator 侧最近 3 回合 ×200 字（plan §43：保证连续性）。
7. **冻结**：contextId 绑定 profile+budget 指纹+候选集合；后台世界包/Memory 更新不改变已启动回合的输入。

## 3. 测试（`tests/turn-context.test.cjs` 10 用例 + phase2-campaign 2 集成）

32K 可玩（mandatory 全保、证据被裁、总量<24K）✅ 128K 严格多于 32K（证据完整 vs 裁剪）✅ 1M 不无脑塞满（≤需求总量）✅ mandatory 永不丢 ✅ 确定性（contextId+渲染一致）✅ 不同窗口不同计划 ✅ Planner/Narrator 上下文不同（narrator 无 worldKnowledge/sourceEvidence）✅ whole-item 不截半 ✅ 能力未知→legacy 显式回退 ✅ 渲染分节有序 ✅
session 集成：内核预算生效（Planner=4000）、Narrator 独立 worldContext 且更小、lastTurnContexts 冻结 ✅ / 无 capabilities→legacyFallback+1200 且回合照常玩 ✅

## 4. 门禁

- `npm run verify:core`：**398/398 PASS**（386 + 12 新增）
- `npm run typecheck --prefix mobile`：PASS
- `git diff --check`：PASS

## 5. 遗留（转 M6）

1. FrozenTurnContext 持久化（当前内存 + lastTurnContexts 调试暴露；DB 留待审计 UI 需求明确时）。
2. Context Debug 面板（plan §71）—— M6 Android/trace 阶段接 lastTurnContexts。
3. 世界构建 LLM 调用统一到 capability resolver + ledger（plan §62）—— M6。
