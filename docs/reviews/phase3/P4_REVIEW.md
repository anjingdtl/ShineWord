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