# M4 Review / Fix 报告

日期：2026-09-27  
Review 分支：`phase/m4-full-game`

## M4 实现范围

按建设方案第 6、7、11、12 节落地完整游戏系统：

### 成长系统（`src/domain/progression/growth.ts`）

- 技能晋阶练习点阈值 5/10/20/40（untrained→novice→trained→expert→master），晋级一次性消费整个阈值，单次投骰不可能直接解锁等级。
- 每独立风险遭遇每技能最多 1 点：以 turn-id 去重（`awardedTurns`），回档重放/双击/重试永远拿不到第二点；master 不再积累。
- 里程碑奖励：只能给已解锁（非 untrained）技能加 1~2 级、封顶 master；LLM 合同效果白名单不含任何成长操作，数值只由本地引擎计算。

### 叙事战斗（`src/domain/combat/encounter.ts`）

- near/mid/far 距离带；场景含掩体点与逃生出口。
- 冻结先攻序列（encounter 创建时固定，NPC 行动次数与生成长度无关）；回合推进跳过 0 HP 角色、整轮环绕时 round+1 并重置本轮行动标记。
- HP/体力资源：伤害模板（原型普通命中 2 / 充分成功 3）减护甲、下限 0；体力扣减非负校验；0 HP 进入 disabled，后续命运（被俘/救援/死亡风险/结局）归属场景合同枚举，不允许模型临场复活。
- 解算状态机 resolved/escaped/wiped；wiped 要求所有玩家侧意识归零。

### 关系 / 知识 / 记忆

- `relationships`（stance + closeness + updated_turn_id，(branch, from, to) 唯一）。
- `knowledge_records`（witnessed/told/public/inferred，M3 建表，M4 接入检索过滤）。
- 检索顺序强制：**可见性（世界可见 或 观察者在 knownToActors）→ 时间窗（validFrom/validTo）→ 状态有效性（explicit/user_supplement/event/summary；conflict/speculation 仅限裁定路径）→ 分支作用域 → 最后才相关度排序**（中文二元组重叠评分）；空查询不返回填充内容。
- 摘要：每 8 回合触发（`shouldSummarize`），Summarizer 载荷校验版本区间必须前进；数字/物品/死亡等权威状态永远从 SQLite 快照读取，不依赖摘要。

### 分支（`src/application/branch/fork.ts`）

- `forkBranch`：从源分支当前头或指定快照版本创建新分支（rewind = 在历史版本 fork），复制 actor_states/inventory/snapshot + 技能 + 关系；源分支不可变。
- 未解决回合的 RollRecord 属于源分支，跨分支永不泄漏；分支间共享的只有世界 Canon。
- 每回合仍保持 M2 语义：committed 回合重放返回旧结果、已持久化骰子不重掷。

### 导出（`src/application/export/saveFile.ts`）

- `.shineword-save.json`（`shineword-save-1`）：manifest（campaign/world 哈希引用/ruleset 版本/branch/stateVersion）+ 状态快照 + 回合（含骰子与叙事）+ 技能 + 关系 + 记忆。
- 导出时递归扫描禁入键（apikey/api_key/key/secret/token/authorization），命中即抛错——**API Key 结构性不可能进入备份**。
- 导入校验：8MB 上限、JSON 结构、schemaVersion、必填 manifest/state、同样的禁键扫描；世界不嵌入（按 SHA-256 引用）。

### 平台层

- migration 004：campaigns / actor_skills / relationships / encounters / encounter_actors / memories / llm_requests。
- `SqliteGameStore`：技能进度（含 awardedTurns JSON）、关系、遭遇（含在场角色与距离带持久化）、记忆、LLM 用量记录，以及 fork 用的复制接口。
- `runLlmTurn` 新增 `usageRecorder`；mobile runtime 把每次 Planner/Narrator 物理请求的 usage 写入 `llm_requests`（模型名、输入/输出 tokens、估算标记）。

## Review 发现的问题与 Fix

1. **P2 回合数计算错误**：环绕先攻后 `round = floor(cursor/len)+1` 回到 1。修复：EncounterState 增加显式 `round` 字段，环绕时 +1。
2. **P2 先攻语义**：advance 先自增导致首个行动者被跳过。修复：先返回当前光标角色再前进。
3. **P3 noUncheckedIndexedAccess**：initiative/nextRank 数组索引访问的 undefined 收窄补齐。
4. 测试侧修正：retrieval 过滤分层计数期望（可见性 6 / 时间 4 / 状态 2）、时钟语义（每回合 timeCost 1 + advanceClock 1 = 200/100 回合）、FK 插入顺序（worlds 先于 campaigns）、replay 断言使用回合同自身的 stateVersion。

## 测试结果

### Core Verify

- tests: 69 / pass: 69 / fail: 0，typecheck pass
- 新增 15 项覆盖：练习点去重（含 replay farming 阻断）、5/10/20/40 阈值与消费、里程碑 1~2 级约束、遭遇冻结/校验、伤害护甲下限与 disabled、体力/距离校验、先攻顺序 + 禁用跳过 + 环绕回合、解算约束（wipe 需全灭）、技能进度持久化与去重、fork 复制与双向隔离、历史快照 rewind、检索五层过滤（秘密/未来/过期/跨分支/冲突全部拦截）、摘要节奏、导出无密钥 + 导入拒绝篡改、**100 回合长程一致性 + fork-50 回退后双分支独立推进 + 已提交回合重放不重掷**。

### Android 构建

- mobile typecheck PASS；`:app:assembleDebug` BUILD SUCCESSFUL（Gradle 9.3.1）。

### 模拟器 Smoke（Medium_Phone / API 37.1）

| # | 场景 | 结果 |
|---|---|---|
| 1 | migration 004 在既有安装上执行 | ✅（campaigns/encounters/memories/relationships 全部建表） |
| 2 | 真实 GLM Planner/Narrator 回合（设备直连） | ⚠️ 模拟器 NAT 下 HTTPS 长时间挂起（ping 通但 TLS 会话不完成）；切换 mock Provider 验证 |
| 3 | mock 回合完整链路 | ✅（turn-0001 · full_success，2d8:[7,3]） |
| 4 | llm_requests 用量落库 | ✅（Planner + Narrator 各 1 条，model/输入/输出 tokens 记录） |
| 5 | dev 警告横幅遮挡行动按钮（开发模式特有） | ✅（关闭横幅后正常；release 变体无此横幅） |

## 已知限制

- 模拟器内直连公网 HTTPS LLM 存在 NAT/TLS 挂起现象（宿主机同 API 正常，设备端 M3 已用 GLM 成功）；M5 用真机复核。
- 遭遇尚未接入 UI 与回合编排（领域引擎 + 持久化完成；剧情页战斗卡随 M5 Alpha UX 完善）。
- 关系变化、遭遇结算尚未挂入回合 effects 白名单（计划由本地结算器在提交后处理，M5 接线）。
- 导入存档的恢复写入（fork-in）未实现 UI 入口，校验逻辑已就绪。
- 摘要生成器（Summarizer LLM 调用）协议与节奏已实现，批量执行器在 M5 与上下文预算一起接入。

## M4 出口结论

建设方案出口条件"100 回合长程测试，回退无污染，选择产生真实差异"已满足：

- 100 回合 scripted 连续游戏：100 个 committed 回合、叙事 100 条、状态与时间单调推进。
- fork-50 回退：源分支头不动、fork 从版本 50 独立推进；分支间技能/关系/事件互不泄漏。
- 选择差异：分支隔离测试 + 骰子不可变 + 重放幂等。
