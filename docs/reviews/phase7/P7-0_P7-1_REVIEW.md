# P7-0 / P7-1 阶段报告

日期：2026-10-04。基线 `main@8648d4d`（方案核验基线一致，无漂移）。

## P7-0：基线、合同与固定验收夹具

- 基线重核：HEAD/分支/工作区/迁移编号（31→32）/协议（save-7→8 计划，本阶段未切档）见 [BASELINE_AND_CONTRACTS.md](BASELINE_AND_CONTRACTS.md)。
- 冻结：局面状态机（dormant/eligible/active/resolved/suppressed）、条件白名单（12 种叶节点 + all/any/not，≤24 节点深度 ≤6，三值求值）、转换效果白名单（6 种，engine-only）、`SituationDefinitionV1`/`MethodTemplateV1`/`BranchSituationStateV1`/`PublicSituationPacketV1`/`NextStepCandidateV1`/`TurnGuidanceV1`、决策点绑定字段、展示数量政策（normal≤3/major≤4，核心投影统一）、重大变故事件阈值、附属引导身份 `guidance:{branchId}:{decisionPointId}`（P1）。
- 存储修正（相对初稿）：引导持久化在独立 `branch_decision_guidance` 表（按决策点绑定），而非叙述行加列——本地动作/NPC 决策点同样适用。
- 夹具：`tests/fixtures/phase7/situationFixtures.cjs` 三题材（追查救援/交涉关系/探索成长），含原著基线、未来参考（order 30 死亡）、GM 秘密、design_fill 办法、每条路线的持久后果断言。
- 出口样例（§6）：救下同伴 → `actor_condition{bleeding}` 求值为 false → `evt-companion-death` 记 `suppressed(precondition_false)`，canon 不改写；测试 `phase7-situations.test.cjs::P7-0 exit sample` 通过。

## P7-1：战役因果状态与事务结算

### 实现

| 落点 | 内容 |
|---|---|
| `src/domain/situations/types.ts` | 局面/办法/状态/承诺/参考事件投影类型 |
| `src/domain/situations/conditions.ts` | 白名单 AST 校验 + 三值求值 + 快照适配器 |
| `src/domain/situations/transitions.ts` | 幂等转换应用（processedEventKeys 批键）+ 状态 tick（dormant→eligible→active、前置伪造→suppressed、到期 onExpire、deadline 冻结为绝对时刻） |
| `src/domain/situations/referenceEvents.ts` | 参考事件三态决策（suppress/apply/pending）+ 因果进度推导 |
| `src/application/situations/causalProjection.ts` | 回合事务内的运行时投影：新定义初始化 dormant（不追溯）、办法转换、tick、参考事件重评、actorFate |
| `src/application/turns/commitTurn.ts` | 提取共享归约器 `reduceTurnResolution`；新增 `prepareTurnResolution`（骰点后、Narrator 前一次性归约）与 `commitPreparedTurn`（按 Prepared 对象原样提交） |
| `src/application/game/v2Turn.ts` | Prepared 管线接线（prepare→packet→同请求正文+路径→分别校验→Prepared 提交→提交后存引导）；非局面战役走原路径不变 |
| `src/application/game/v2Compile.ts` | 办法结构绑定：actionKind+skill+target/destination 匹配 → `contract.methodRef`（入哈希、planner 禁写）+ successEffects 注入 |
| `src/domain/state/types.ts` | 快照新增 `situations`、`causalWorldTimeOrder`，cloneGameState 深拷贝 |
| 迁移 32 | `branch_situations`（投影+快照双写）+ `branch_decision_guidance` |
| `sqliteTurnStore.ts` | persistState DELETE+重灌、readState 快照/投影水合 |
| `sqliteGuidanceStore.ts` + 端口 | 决策点绑定读写、latestForVersion、跨分支隔离 |
| `session.ts` | 局面定义收集、活跃办法注入 compile、prepare/guidance 回调、`advanceCausalOrder`（锚点+证据事实序+发现+已结算参考事件，非回合数）、`getGuidanceAtVersion` |

### 验证（针对性）

- `phase7-situations.test.cjs` 7 项：夹具过 validateDefinition（三题材办法 ≥3 且结构互异）、三值条件、白名单拒绝（未知 kind/超限树）、转换幂等（重放零重复）、tick 全路径、P7-0 出口样例（救援抑制/未救援适用 actorFate/未到期 pending）、因果序推导。
- `phase7-prepared-turn.test.cjs` 4 项：单次归约+原样提交+重放不重复（计数器保持 1）；同起点双路线分歧（救→suppressed+存活；未救→ref 键落账+dead+局面 resolved'岳轻伤重不治'）；失败路线代价保留（体力-1、bleeding 未被叙述抹去、零奖励）。
- `phase7-sqlite.test.cjs` 4 项：迁移 32 建表+FK 干净；原子提交携带局面状态往返（投影行+快照行都有）；引导存储决策点绑定与最新读取；跨提交投影精确镜像（1 行 resolved）且逐版本快照历史保留（v2 active/v3 resolved，回退可恢复）。
- 全量：`verify:core` 812/812（基线 797 + 新增 15），mobile typecheck 0 错误。

### 未尽与后续

- save-8 / 版本 0.7.0 / world-package-4 切换与旧档兼容验证在 P7-6 统一执行（本阶段未改版本号）。
- 附属引导（本地动作/NPC 决策点）在 P7-4。
- 阶段门禁：A01/A02/A12 的核心证据已落（见上），设备证据随 P7-6/P7-7。
