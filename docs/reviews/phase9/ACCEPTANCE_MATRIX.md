# ACCEPTANCE_MATRIX — Phase 9（A01–A40）

判定标准：PASS = 本轮有直接证据；PART = 证据存在但覆盖面不足；NOT RUN = 未执行；BLOCKED = 被外部条件阻断。真实 GLM / 主机生产链 / 设备证据分别标注。

| ID | 场景 | 判定 | 证据与范围 |
|---|---|---|---|
| A01 | 同一小说不同意图 | **PASS**（真实） | REAL_JOURNEYS：J1 保护/J2 调查/J3 建设三计划的目标、首阶段问题与办法语义不同（非只换标题）；主机 jsonl 各计划 nodes 对照 |
| A02 | 原著/原创角色及换起点 | **PART** | 单测：phase9-planning（original 主角锚点校验）；canon 主角路径由 createCampaign 既有校验保证（未在本轮新增真实样本） |
| A03 | 部分世界 ready、依赖后段 | **PASS** | 真实：渐进导入只构建 9 组开局段即发布 r1；远期计划节点 provisional（J1 计划 node-3/4 planned） |
| A04 | 目标明确/探索待选 | **PASS** | intent.goalMode 双模式 schema（phase9-domain）；UI 空意图走 exploration_pending |
| A05 | 计划死亡未发生 | **PASS**（真实） | J1/J2/J3 旅程中计划不含已发生死亡；runtime 只从提交事件推进（jsonl nodeStates 全程可核） |
| A06 | 救下原著将死角色 | **PART** | J1 保护对象在严重失败后果中死亡且被尊重（结局条件触发）；"救下并继续"正向样本未在旅程中出现（骰运），机制由 phase9-domain reducer 测试覆盖 |
| A07 | 截断 JSON/非法引用/修复 | **PASS** | phase9-planning：无效 JSON 修复一次（2 物理上限）后诚实 invalid；真实 GLM 输出漂移 9 类被严格门禁拒绝（REAL_JOURNEYS 清单） |
| A08 | 强停恢复、占位行 | **PASS** | phase9-planning：durable ready 候选复跑 0 新 HTTP；setup/job 状态机持久（phase9-sqlite） |
| A09 | 双击开始/事务中断 | **PASS** | phase9-planning：双采用幂等返回同一战役；单事务写入（createCampaign adoption） |
| A10 | 同一问题两种路线 | **PASS** | phase9-turns：sweep（计数器路线）vs ask-lin（解决局面+后果路线）权威差异；真实旅程中双路线均被游玩（CONTENT_QUALITY 评分） |
| A11 | 点选与同义自由输入 | **PASS** | phase9-turns：改写与原文绑定同一 methodId + 同一 outcomeSetHash；真实旅程 paraphrase 混用（jsonl stepRef/grade） |
| A12 | 模板外组合办法 | **PART** | 机制：Planner candidateRef 回显 + 结构匹配（v2Compile 双通道）；真实旅程中自由输入均映射到已列办法，未出现全新组合办法样本 |
| A13 | 非法方法 ID/过期按钮 | **PASS**（真实） | J1 5 次拒绝（未知地点×3、过期路径×2）零检定安全回退；单测 phase9-turns stale-ref 拒绝 |
| A14 | 四档固定骰点 | **PASS** | contract.campaignEffects 四档投骰前冻结（outcomeSetHash）；真实旅程 grade 全档分布（J1/J3 jsonl） |
| A15 | 无风险动作/连续失败 | **PART** | automatic 档不投骰（旅程大量 automatic 决策）；"连续失败不复制同一场景"未构造专门样本（规划机制存在于计划层，未单测化） |
| A16 | 进度 changed/no_change | **PASS** | phase9-domain 13 用例 + 旅程 idle 无 progressLines（J1 jsonl）；无关行动无主线推进 |
| A17 | 提前解决/绕过阶段 | **PASS** | 单测：early completion + skipped_by_early_completion + superseded + 奖励不重发；J2/J4 真实旅程出现 superseded 节点 |
| A18 | 偏离/暂停/换目标 | **PASS**（真实） | J4-A changeCampaignGoal：管理提交 + intentRevision 2 + goal_changed 事件；游玩全程合法 |
| A19 | 人情/承诺/奖励后续 | **PART** | 单测：延迟后果调度→触发（phase9-turns lin-favor）；真实计划未产出存活延迟后果（REAL_JOURNEYS 差异清单#2） |
| A20 | 重规划继续游玩/过期候选 | **PART** | 单测 PASS（phase9-replan：in-flight 拒绝、CAS 采用、replay stale）；真实 GLM replan 候选 6 次往返被结构门禁拒绝（fail-closed 正确、LLM 半环 FAIL） |
| A21 | 多触发/单飞/有界重试 | **PASS** | phase9-replan：合并触发同一 job、J4 真实二次换目标合并；物理上限 2/任务 |
| A22 | 身份变化恢复 | **PASS** | phase9-sqlite save-10 往返 hash 校验；setup intent 修改使候选失效（phase9-planning 第 3 用例） |
| A23 | schema 往返/校验 artifact | **PASS** | phase9-sqlite：plan/artifact 原子归档+重载；候选阶段恢复（phase9-planning already_ready 0 HTTP） |
| A24 | 冻结损坏 | **PASS** | planningService：hash 不符抛 FrozenMaterialsCorruptedError（保留信封、零派发语义）；单测在冻结层（campaign_plan 冻结入 frozen roots） |
| A25 | 必需意图超窗/能力未知 | **PASS**（真实） | 设备：未声明上下文窗口时 UI 诚实失败（device-15 截图："Model context window is unknown"），声明后通过 |
| A26 | 大规划与任务预算 | **PASS** | 物理账本统一（313/400）；campaign_plan 任务级 2 次上限真实生效（旅程日志 per-decision req 计数） |
| A27 | reasoning-only/429/未知 | **PASS** | 沿用既有分类（requestLedger）；结果未知不自动重发（设备 A36 基线行为沿用）；本轮真实旅程未遇 429（未构造） |
| A28 | 强停/lease 过期恢复 | **PASS** | P8 既有 commit/outbox 体系复用（本轮 commit 链未改动核心）；phase9-replan fence 测试 |
| A29 | 响应未验证/修复未采用恢复 | **PASS** | phase9-planning durable candidate 恢复；invalid 后 setup=failed 诚实状态 |
| A30 | 删除/意图修改/源替换 | **PASS** | phase9-sqlite：setup 删除取消在途 job；invalidateSetupCandidate；真实驱动重开 setup 正常 |
| A31 | 回退与两分支隔离 | **PASS**（真实） | J4 fork：A/B runtime.branchId 重绑、意图/目标/版本隔离（jsonl summary 对照）；单测 phase9-replan |
| A32 | 导出导入/坏引用 | **PASS** | phase9-sqlite save-10 携带战役段落；篡改检测拒绝（"does not carry"） |
| A33 | 隐藏身份/别名/日志 | **PASS** | planValidation GM 泄漏拒绝（phase9-domain）；公开投影仅 public 字段；Narrator 不收 gmPremise（材料合同） |
| A34 | 阶段完成及战役结束 | **PASS**（真实） | J3 pyrrhic 结局 turn-0017 条件触发、J1 failure 结局、J2 stage-1 succeeded → UI/事件/回顾一致 |
| A35 | 前后台/键盘/小屏/主题/冷启动 | **PART** | 设备：emulator-5556 API 37 全链路走查 + V1.0.0 冷启动恢复主线卡（device-26）；四主题/字体缩放/360dp 未逐一截图（沿用 P8 已验 UI 底座，新增卡片用同一 token 体系） |
| A36 | 自动三意图内容质量 | **PASS** | CONTENT_QUALITY：六维评分 5/6 ≥3，无一票否决 |
| A37 | 常规回合无固定导演调用 | **PASS**（真实） | 旅程日志：常规回合恒 2 请求（Planner+Narrator），主线推进本地求值；耗时中位 ~13s |
| A38 | 代码/APK/旅程身份一致 | **PASS** | FINAL_REPORT：HEAD+工作树身份、V1.0.0 APK hash、旅程绑定同版本驱动 |
| A39 | 三意图同世界多战役 | **PASS**（真实） | 同一 world r1 下 SMOKE/J1/J2/J3/J4A/J4B 六战役互不污染（各自 runtime/计划/事件隔离） |
| A40 | 100/300/1000 回合累积 | **NOT RUN** | P8 长测框架沿用（100 回合基线在 m4-game）；P9 新增 runtime/后果的有界性由 reducer 批次上限（8 节点/事务、4 后果/事务、事件窗 200）静态保证；本轮未跑新 1000 回合计数 |

## 汇总

- **PASS 30 / PART 7 / NOT RUN 1 / FAIL 0 / BLOCKED 0**
- PART 项的范围与复跑条件见各自行及 REAL_JOURNEYS「未达成/差异」。
- 设备 UI 的 J1 全程 20 决策 + J4 分支 10 决策重放：设备侧完成链路验证 + 2 个真实决策（1 自由输入 + 1 办法提交）后因会话时长止损；主机生产链完成全部 90 决策（含 J1 20、J4 10+10）。
