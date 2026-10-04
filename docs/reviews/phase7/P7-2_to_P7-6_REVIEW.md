# P7-2 ～ P7-6 阶段报告

日期：2026-10-04。前置：P7-0/P7-1（commit c700aa5）。

## P7-2：三宝书可玩内容编译（commit 4ee789d）

| 落点 | 内容 |
|---|---|
| Mapper 协议 v2 | `MAPPER_SYSTEM` 增加 `situations` 提案（局面/办法/参考事件/来源规则 4 条）；`cleanSituation` 强校验（白名单条件树、≥2 条结构互异办法、引用闭包、参考事件绑定真实 canon 事件、actorFate 需事实佐证；伪造事件键只丢弃该投影不否决局面） |
| 门限修复（设备实证驱动） | ①条件包裹形式 `{all:{of:…}}` 规范化（真实模型实际输出形态，测试 `phase7-situation-compile.test.cjs::wrapped condition forms`）；②实体 id → npc 模板 id 解析（按实体名/别名，含前批 previousEntries）；③未提议的 target 引用降级为"去引用保留办法"；④装配期 `actor-canon-{entityId}` 解析重写 |
| 本地开局局面 | `compileOpeningSituation`：startup_local 与渐进开局共用，零模型调用产出一个局面（查看现场/向在场者打听/着手处理） |
| 目录与 schema | 城主指南新增"局面与动向"；含局面包发布为 **world-package-4**（加载器/归档/分段工件白名单同步）；依赖规则 situation → 8 类 |
| 迁移 32 扩展 | `package_entries` 重建，kind CHECK 增 `situation` |
| 玩法门禁 | 悬空引用的局面降级为 major 审查项随新版本进入，不阻塞旧玩法（设备上实际发生并验证） |

## P7-3/P7-4：安全局势上下文、候选资格与 LLM 引导（commit 1a64229）

- Planner 上下文增【当前局面】（活跃局面的玩家安全摘要+办法首步；gmBrief 与隐藏条件不进任何模型上下文）。
- **因果下限**：分支有效故事序 = max(锚点, 已提交因果进度, 已采用目录下限)——采用后段内容即抵达该故事区域；叙述文本不能跳时。
- **介入窗口**：参考事件不在激活局面当回合生效，玩家先看到局面与路径。
- 附属引导：本地动作/NPC 边界决策点同步本地引导 + 异步 LLM 升级（`narrator_guidance`，P1，账本身份 `guidance:{branch}:{decisionPointId}`，去重、过期即弃、绝不阻塞）。
- 办法绑定放宽：无目标合同（非社交 skill_check）可与带目标办法结构匹配。
- 集成测试（真实 session 管线，`phase7-guidance.test.cjs` 6 项）：A01/A02 命运抑制+未救对照、A04/A07 办法绑定与引擎效果、A08 资格差异+干净拒绝、A09 秘密过滤、A11 好正文坏路径单次提交+本地降级、A13 恰两次业务调用、A14 已提交回合重放零新请求、A15 分叉隔离。

## P7-5：移动体验（commit c6dc478）

- `GuidanceCard`：这次变化/眼下局势/下一步路径；重大变故展开取舍；可尝试/需准备标记、本地建议标记、a11y 标签与稳定 testID；可用步骤"提交这一步"走正常管线，需准备步骤"填入输入框"并显示阻碍。
- `submitGuidanceStep` 提交前重验决策点（分支+stateVersion；过期路径绝不自动执行）；`attachNpcBoundaryGuidance` 于 NPC 边界补 §8.3 引导。
- TurnView 增只读 guidance；loadHistory 按源回合挂载已提交引导；runtime 接入引导存储。
- 数量政策收口核心投影：移除两处 UI `slice(0,3)`。

## P7-6：兼容、故障与资源（commit c1ba09f + 后续修复）

- 版本 **V0.7.0 / versionCode 70000**（verify:version 绿）。
- **shineword-save-8**：引导随档（入哈希）；局面状态随完整快照往返；导入重绑分支身份（旧决策点不可在新分支提交）；save-7 继续可导入；v7 档携带 phase7 键显式拒绝；v7 导入不追补局面/引导（`phase7-save8.test.cjs` 3 项）。
- 事故级联修复（真机发现→修复→回归）：mapper-1→2→3（提示与检查点失效）、`OpeningPreparationError` 附带底层原因、schema-4 容忍无 scope 旧形包、`'{}'` scope 行视为缺省。
- 门禁：`verify:core` 826/826（基线 797+新增 29），root/mobile 类型检查、verify:version 全绿；独立 Debug APK 构建成功（102.3MB）。
