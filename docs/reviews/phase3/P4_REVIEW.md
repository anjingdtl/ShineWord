# P4 阶段 Review（P4.2 – P4.11）

> 方案：`docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md` §13–§27
> 分支：`feature/phase3-ui-gameplay`
> 数据层决策与只读投影见 [P4_DATA_REVIEW.md](./P4_DATA_REVIEW.md)（P4.1）
> 本轮不运行测试 / typecheck / APK / 模拟器；所有运行期与构建期验证项均标注为**待线下开发机验证**。

---

## P4.2 Controller 与 UI 解耦

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| Controller（新增） | `features/play/hooks/usePlayController.ts` | 承载 loadState / loadHistory / submit / refresh / rest / rewind / export / train / party action / encounter action / error / notice / busy |
| 页面收缩 | `screens/PlayScreen.tsx` | 不再包含任何业务函数；只保留路由上下文、Controller 与（待后续阶段替换的）展示层 |
| 世界皮肤接入 | `screens/PlayScreen.tsx` | 整页包在 `ThemeScope` 中，世界主题覆盖在游玩页同样生效（P3.5 已实现于世界详情） |
| 数据契约 | `mobile/src/runtime.ts` | `TurnView` 增加结构化 `roll`（diceCount/dieSides/rolls/highest/difficulty/margin/grade）与 `stateVersion`，供 P4.3 的 RollStrip 使用；不再拼接展示字符串 |
| 本地战斗推导 | `usePlayController` 的 `combat` | 攻击目标 / 待援救同伴 / 标准移动 / 疾行 / 可加入同伴 / requestId 全部本地推导，不新增 LLM 调用 |

### 原则核对（方案 §17）

| 原则 | 核对结果 |
|---|---|
| Controller 不画 UI | 满足：文件内无 JSX、无样式 |
| 不保存新的权威状态 | 满足：只保存投影/历史/界面态（busy、notice、intent），分支快照仍是唯一权威 |
| 不重新实现 Session 逻辑 | 满足：每个动作都调用与 P2 相同的 Session 方法，参数与 P2 逐项对齐（含 `requestId` 形状与 `rewind` 的新分支 id 规则） |

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 旧页面在遭遇面板里用 `state.cards` 查找待加入者姓名 | 已改为投影名册（玩家 + 队伍），语义一致 |
| 2 | `rewind` 依赖 `state.stateVersion`，投影化后需重新取数 | 已改用 `projection.stateVersion`；回退目标版本算法不变（`stateVersion - 1`） |
| 3 | 同伴指令按钮原样显示 `follow/protect` 等内部枚举 | 已改中文标签（跟随/支援/保护/节省资源/撤退），并标出当前指令 |
| 4 | 招募与重入列表依赖 `state.cards` 判断是否已在队 | 改为基于投影名册过滤，行为等价 |
| 5 | 提交失败后的重试语义 | 保持：失败时把 intent 写回输入框，且清空「拟定检定…」提示 |
| 6 | 历史数据只有玩家 intent 缺失（方案 §18.1 不允许伪造） | 本阶段未新增 intent 字段；RollStrip 只展示真实存在的骰点字段，intent 留待未来版本 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| 回合 / 短休 / 长休 / 回退 / 导出 / 训练 / 队伍 / 遭遇动作的真机回归 | **未验证** |
| 世界主题覆盖在游玩页生效 | **未验证** |

### P4.2 出口对照（方案 §17）

| 出口条件 | 状态 |
|---|---|
| PlayScreen 代码显著缩减，并保持当前行为回归 | 满足：业务函数 0 行留在页面（全部迁入 Controller）；行为待真机回归 |

---

## P4.3 叙事流 NarrativeFeed

### 实现内容

| 类别 | 文件 | 说明 |
|---|---|---|
| 顶栏（新增） | `features/play/PlayHeader.tsx` | 战役名 + 分支 + 地点 + 世界钟（按皮肤格式：墨=时辰、烛=第 N 日、漫=D#、梭=T+ddd:hh:mm）+ 状态版本；`clockSeconds` 仍是唯一权威值 |
| 回合卡（新增） | `features/play/TurnCard.tsx` | 结构：回合序号 + v 状态版本 → 检定条（若有骰）→ 剧情正文；断点恢复标记 |
| 骰点条（新增） | `features/play/RollStrip.tsx` | `DieBadge` + `NdM 取高` + 每颗骰值（取高者高亮加粗）+ 难度/余量 + 四档结果（大成功/成功/失败/大失败，图形 + 文字，非颜色单通道） |
| 叙事流（新增） | `features/play/NarrativeFeed.tsx` | FlatList；`onScroll` 跟踪是否贴近底部，只有读者在底部时才自动滚到最新；busy 不清空历史，仅在底部追加「正在结算…」 |
| 页面替换 | `screens/PlayScreen.tsx` | 顶栏与叙事流改用新组件；遭遇面板 / 队伍面板 / 输入区仍为待替换的 P2 结构 |

### 静态审查结果（Review / Fix）

| # | 发现 | 处理 |
|---|---|---|
| 1 | 结果等级必须与规则域枚举一致 | 已核对：仅映射 `full_success` / `success` / `failure` / `severe_failure` 四档，未知值原样显示而不猜测 |
| 2 | 历史没有玩家 intent（方案 §18.1 禁止伪造） | 未新增 intent 字段，回合卡也不显示 intent；骰点条只展示 `RollRecord` 中真实存在的字段 |
| 3 | 自动滚动会打断阅读旧内容 | 已实现「仅当贴近底部（48dp 内）才自动滚动」，并加一帧延迟等待新行测量 |
| 4 | `busy` 期间旧实现把提示塞进输入区，且历史列表被整体重渲染 | 改为 feed 底部轻量提示，历史数组不被清空 |
| 5 | 旧实现把骰点拼成字符串（`2d8: [4, 7]`）后由 UI 解析 | 改为结构化 `TurnRollView`（diceCount/dieSides/rolls/highest/difficulty/margin/grade），UI 不再解析字符串 |
| 6 | 时辰换算属展示派生、非规则 | 已核对该逻辑只用于世界钟格式化，未参与任何检定/结算 |

### 未执行的验证项（待线下开发机验证）

| 验证项 | 状态 |
|---|---|
| `npm run typecheck --prefix mobile` | **未运行** |
| `npm run verify:core` | **未运行** |
| `npm run apk:debug --prefix mobile` | **未运行** |
| 叙事流四主题截图 | **未截图** |
| 有骰回合 / 无骰自动成功回合 / Narrator 失败恢复 / App kill 后恢复的展示 | **未验证** |
| 「阅读旧内容时不抢滚动」的真机行为 | **未验证** |
| 世界钟四皮肤格式（墨=戌时三刻 / 梭=timecode 等） | **未验证** |