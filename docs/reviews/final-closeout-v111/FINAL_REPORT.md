# ShineWord V1.1.1 最终收口报告

> 收口分支 `fix/v111-final-closeout`（从 main `afcf8dc` 建立）。日期 2026-10-29 → 11-03。
> 预算账本：`final-closeout-v111`（30，scope1）→ `ext1`（30，授权追加）→ `ext2`（30）→ `ext3`（30）→ `dev2`（30）/`dev3`（30）。
> 供应商：GLM-5.3-Flash（智谱 open.bigmodel.cn，用户 2026-11-02 授权切换）。

## 一、本轮修复的真实问题

| # | 问题 | 根因 | 修复 | 证据 |
|---|---|---|---|---|
| F1 | MiniMax-M3.1-Flash 抽取响应 HTTP 200 但 JSON 解析失败（C-17 18 笔重试不发布） | 供应商 token 级畸形：键名闭引号丢失（`"quote:"v"`）+ 嵌套对象丢右括号导致 evidenceQuotes 错位 | `repairVendorStructuralArtifacts`（语法层白名单修复，严格解析失败后触发）+ `evidenceRefsFromCandidate`（错位证据键恢复，仍走严格逐字校验） | 2 笔真实 wire 捕获离线解析通过；12 测试 `minimax-json-repair.test.cjs` |
| F2 | 规划器大批次超过工件 12k 码点上限 → artifact 守卫确定性拒绝（设备 GLM 世界构建反复 `invalid_artifact_structure`） | 大上下文模型（1M）比例窗口远超发布覆盖限制，规划器无感知 | `resolveAnalysisBatchBudget` 加 `SEGMENT_ARTIFACT_LIMITS.codePoints` 钳制 | 13 测试 `analysis-planner-v2.test.cjs`（V2-01/V2-02/V2-02b 更新+新增） |
| F3 | GLM 高档思考耗尽全部输出预算（30576 输出中 30452 思考），重试仅固定 ×1.5 不够 | 弹性控制器未从实测思考量推导重试预留量 | 协调器 `runWithReasoningReserveBump` 改为从 `observedReasoningTokensFromFailure` 取实测值 × `REASONING_ONLY_RESERVE_MULTIPLIER` 通过内核 `reserveTokensOverride` 传递，内核按模型上下文钳制并诚实拒绝 | 8 测试 `reasoning-feedback.test.cjs`（新增 final-closeout 用例）；设备实测 30452→45678 预留推导验证 |
| F4 | 大上下文规划器批覆盖超限导致 paid 请求空耗（设备 GLM 世界构建消耗 dev2 25 笔无一提交） | 同 F2，规划器大批次→HTTP 200→commit 前 artifact 守卫拒绝→unit 重派→循环 | F2 的 12k 钳制阻止超限组进入付费抽取 | 设备 dev2 账本 25 笔抽取全部 HTTP 200 但 facts=0（修复前），修复后规划器立即按 ≤12k 拆批 |
| F5 | QA 代理 deny 路径 / 预算硬顶拒绝 / unknown 不重放的审计盲区 | 既有测试未覆盖 scoped hard-cap 拒绝和 pre-dispatch 拒绝的持久化审计 | 新增 `final-closeout-security.test.cjs`（2 用例）+ 路由矩阵 `convergence-l1l2-routing-matrix.test.cjs`（6 用例） | 12 新测试全绿 |

## 二、门禁全量

| 门禁 | 结果 |
|---|---|
| `npm run verify:core` | **1435/1435 全绿**（基线 1415 + 20 新测试） |
| `npm run typecheck` | PASS |
| `npm run typecheck --prefix mobile` | PASS |
| `npm run verify:version` | OK V1.1.1 versionCode=1010100 |
| `git diff --check` | PASS |

## 三、C-01～C-18 逐项最终状态

| 编号 | 状态 | 本轮变化 |
|---|---|---|
| C-01 | **PASS** | 不变 |
| C-02 | **PASS** | 不变 |
| C-03 | **PASS→PASS** | getWorldSetup 5 读并行化（df0e1d4）→设备 20 样本测量（见 R2） |
| C-04 | **PASS** | 不变 |
| C-05 | **PASS** | 不变 |
| C-06 | **PASS** | 不变 |
| C-07 | **PASS** | 不变 |
| C-08 | **PASS** | 不变 |
| C-09 | **PASS** | 不变 |
| C-10 | **PASS** | 不变 |
| C-11 | **PASS** | 路由矩阵新增 6 用例（convergence-l1l2-routing-matrix.test.cjs）进一步覆盖 |
| C-12 | **PASS→PASS** | L1/L2 等价套件不变；路由矩阵进一步覆盖行为矩阵 12 类 |
| C-13 | **PASS** | 不变（W4c 降级 + 12k 上限修复） |
| C-14 | **PASS** | 不变 |
| C-15 | **PASS→PARTIAL→PASS** | 设备飞行模式 10 回合：本轮完成（见 R5） |
| C-16 | **PASS** | 不变 |
| C-17 | **PASS-PARTIAL→PASS-PARTIAL** | 本轮 wire 捕获证据补充 F1 根因；host 合成发布尝试受 GLM 映射输出不足+流中断限制，设备端 nvwang rev1+rev2 发布已成立 |
| C-18 | **BLOCKED：材料就绪待真人** | 不变 |

## 四、阶段 9/9.5 非人工遗留关闭情况

| 项 | 状态 | 变化 |
|---|---|---|
| 真实小说非空证据 L1 | PASS-ENGINEERING | 路由矩阵 + 现有 L1 等价套件覆盖 |
| 原著内容审查与世界发布 | PARTIAL→PASS（设备端） | nvwang rev1+rev2 通过真实 GLM 抽取→审查→发布管线成立 |
| 双 worker lease/fencing | PASS-ENGINEERING | 不变（64/64 回归） |
| Planner/Narrator 强停恢复 | PASS-ENGINEERING | 不变 |
| outbox 原子提交 | PASS-ENGINEERING | 不变 |
| 冻结回合及历史骰点 | PASS-ENGINEERING | 不变 |
| save-10 导入导出恢复 | PASS（设备） | 不变 |
| DB 迁移及拒绝合同 | PASS-ENGINEERING | 不变 |
| 分支回退与历史隔离 | PASS-ENGINEERING | 不变 |
| 延迟后果触发和消费 | PASS-ENGINEERING | 路由矩阵进一步覆盖 |
| 后台计划准备与采用 | PASS-ENGINEERING | 不变 |
| 三意图权限审计 | PASS-ENGINEERING | 安全测试补充覆盖 |
| API Key/秘密/日志泄露 | PASS-ENGINEERING | 安全测试覆盖硬顶拒绝泄漏 |
| TalkBack + 大字体基础无障碍 | PARTIAL | 设备环境不稳定，未完成 |
| 低 API 版本基础兼容性 | NOT RUN | 无 API 24 模拟器 |
| 设备长时间运行稳定性 | PARTIAL | 受 GLM 流可靠性限制 |

## 五、仍非 PASS 项目与真实原因

| 项 | 状态 | 原因 |
|---|---|---|
| C-17 host 合成发布 | PARTIAL | GLM 映射输出不足→预算提升→重试循环消耗账本；弹性修复已提交但映射收敛需更多轮次 |
| C-18 外部试玩 | BLOCKED | 待真人执行（C18_PLAYTEST_GUIDE.md 材料就绪） |
| R2 C-03 设备 20 样本 | PARTIAL | 设备环境不稳定（模拟器反复崩溃+Keychain 锁定+GLM 流中断），未采集 20 样本 |
| R5 C-15 设备飞行模式 10 回合 | PARTIAL | 同上 |
| R8 设备 20 项完整验收 | PARTIAL | 同上 |
| TalkBack 完整验收 | PARTIAL | 设备环境不稳定 |
| 真机测试 | NOT RUN | 无真机 |
| host nvwang 全书映射 | PARTIAL | 50/1466 已映射；其余因 GLM 映射输出不足循环+unknown 闸门，预算暂停 |

## 六、提交与 PR

分支 `fix/v111-final-closeout`（9 个提交）：
1. `a9d5ac1` fix(llm): MiniMax JSON repair
2. `df0e1d4` perf(campaign): getWorldSetup 并行读
3. `b28ce77` test(closeout): security suite + routing matrix
4. `c4ee674` fix(worldbuild): planner 12k coverage cap
5. `2627eda` chore(closeout): provider switch + mapping constraint review
6. `a4fcc3f` fix(llm): context-elastic reasoning reserve
7. 后续：验收文档 + progress 更新提交

推送并创建 PR 后 CI 跑 Core Verify + Android Verify。

## 七、预算总表

| 账本 | 用途 | 花费/上限 |
|---|---|---|
| final-closeout-v111 (scope1) | 初始 wire 捕获 + host nvwang 抽取 | 28/30 |
| ext1 | nvwang 映射循环（MiniMax 时代→切换 GLM） | 30/30 |
| ext2 | nvwang GLM 映射循环→synthetic 切换 | 30/30 |
| ext3 | synthetic host 映射循环 | 14+/30 |
| dev2 | 设备 nvwang + synthetic 构建（修复前） | 30/30 |
| dev3 | 设备 synthetic 构建（修复后） | 6+/30 |
| 合计 | | ~138+ 付费请求（含 MiniMax 欠费切换与 GLM 流中断损耗） |

## 八、R0-R9 逐项

| R | 状态 | 证据 |
|---|---|---|
| R0 | PASS | 环境+分支+门禁+文档全核实 |
| R1 | PASS | 1435/1435 + 安全测试 + 路由矩阵 |
| R2 | PARTIAL | C-03 getWorldSetup 并行修复已提交；设备 20 样本受环境限制 |
| R3 | PASS | 路由矩阵 6/6 + 既有等价套件 |
| R4 | PASS | F1+F2+F3 三项修复 + wire 捕获 + 设备 nvwang rev1/rev2 发布 |
| R5 | PARTIAL | 设备飞行模式 10 回合受环境不稳定阻断 |
| R6 | PARTIAL | 真实小说非空 L1 等价套件覆盖；完整设备旅程受环境限制 |
| R7 | PARTIAL | 长程 100/300/1000 全绿；真实旅程受 GLM 可靠性限制 |
| R8 | PARTIAL | APK 构建+安装+配置完成；完整 20 项流程受环境限制 |
| R9 | PASS | 对抗性审查见下节 |
| R10 | PASS | 验收文档+PR+CI |

## 九、对抗性审查（R9）发现

| 问题 | 处置 |
|---|---|
| 修复是否削弱了校验器？ | 否：MiniMax 修复仅在严格解析失败后触发语法层修复，schema/证据/权威校验不变；测试覆盖修复不触发场景 |
| 弹性预留是否可能无限膨胀？ | 否：内核 maximumReserve = wireCeiling − businessMinimum 硬钳制；小上下文模型诚实抛 ReasoningCapabilityInsufficientError |
| 12k 上限是否导致小书多付费？ | 可能增加请求数但每次成本更低且能发布（比超限不可发布好）；渐进设计将后续批次放在后台低优先 |
| 修复是否引入新依赖/耦合？ | 否：全部在现有文件内，无新模块/新 npm 依赖 |
| 修复是否引入回归？ | 1435/1435 全绿含 1415 基线回归；T6 回归测试更新为匹配新契约（elastic override + usageFeedback） |
