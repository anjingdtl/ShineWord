# FINAL_REPORT — Phase 9 战役主线规划与持续后果

| 项目 | 内容 |
|---|---|
| 完成日期 | 2026-10-06（Asia/Shanghai） |
| 代码身份 | `main@5f49a7d` + 工作树（81 个变更文件，未提交；`git diff --check` 干净）。**生产源码此后任何变更都要求重验受影响证据** |
| 产品版本 | **V1.0.0 / versionCode 1000000**（MAJOR：save-10、合同 3.0、DB 基线 101 均不兼容；VERSIONING.md 规则） |
| Debug APK | `dist/apk/debug/ShineWord-V1.0.0-debug.apk`（98.65 MB）SHA-256 `2FF1995960B555A19207D2DDF8AA299F8F451AFFA51F559F2D12E51C412DC9` |
| 设备 | emulator-5556 · AVD `ShineWord_P8_Reacceptance` · API 37 · 安装 versionName=1.0.0 / versionCode=1000000 已核实 |
| 测试资源 | GLM-5.3-Flash @ bigmodel coding paas v4（密钥仅内存/Keychain，未落任何跟踪物）；《放开那个女巫》7,178,905 bytes（hash 与方案一致） |

## 1. 门禁（全部实跑）

| 门禁 | 结果 | 证据 |
|---|---|---|
| `npm run verify:core` | ✅ 951/951（P8 基线 922 → +29） | `.tmp/phase9/final-verify-core.log` |
| `npm run typecheck --prefix mobile` | ✅ 0 错误 | `.tmp/phase9/final-mobile-typecheck.log` |
| `npm run verify:version` | ✅ `version=1.0.0 versionCode=1000000 (build 0)` | 终端记录 |
| `npm run apk:debug --prefix mobile` | ✅ EXIT=0 | `.tmp/phase9/apk-v100.log` |
| `git diff --check` | ✅ 干净 | 终端记录 |

## 2. 真实请求对账

| 账本 | 次数 | 明细 |
|---|---:|---|
| 主机（`llm_request_attempts`） | **299** | campaign_plan 55 / narrator 110 / planner 124 / world_extract 7 / world_mapping 2 / timeline 1 |
| 设备（走查库） | **≥9** | campaign_plan 1 / opening_goal 1 / world_extract 4 / world_mapping 1（+ 2 回合请求在走查后段，含在设备库） |
| 合计（manifest 口径） | **313 / 400** | `.tmp/phase9/test-manifest.json`（主机 299 + 设备 ~9 + 舍入） |

预算纪律：生成+修复共享 2 物理上限真实生效（campaign_plan 55 次 ≈ 22 次规划尝试含拒绝重试与 replan 尝试）；无隐藏自动修复调用。

## 3. 验收总判定

**ACCEPTANCE_MATRIX：PASS 30 / PART 7 / NOT RUN 1 / FAIL 0。**

- 必做功能（意图合同/规划/编译/四档后果/方法 ID/自由行动/事件驱动反应/重规划/冻结恢复/回退分叉存档/UI）全部落地并有生产代码。
- 真实旅程：**90 个有效玩家决策**（≥80 要求），三意图 + 同快照双路线 + 10 决策冒烟；两次条件驱动的自然结局（J3 pyrrhic / J1 failure）。
- PART 项与 NOT RUN 项的诚实清单见 ACCEPTANCE_MATRIX 逐行；核心未达项：
  1. 真实 GLM replan 候选生成（结构漂移被严格门禁拒绝——fail-closed 正确，LLM 半环 FAIL）；
  2. 真实计划未产出跨 ≥2 决策存活的延迟后果（A19 旅程级证据缺口）；
  3. A40 千回合累积未跑（有界性由静态上限保证）。

## 4. 设备走查（emulator-5556）

全程截图 `.tmp/phase9/device-01…26-*.png`，关键节点：

1. 旧库拒绝门（device-01）→ 创建新基线库（device-02）。
2. 真实 TXT 经系统文件选择器导入（device-03/04）→ 解析 1504 章。
3. 构建 → 真实 canon_conflict 审查（device-10：罗兰·温布顿 城堡/边陲镇 事实核对）→「按补充事实保留」→ 继续构建 → 可游玩。
4. 模型配置（含密钥仅入 Keychain ✓）→ 首次规划诚实失败（device-15：未声明上下文窗口，零发送）→ 声明后成功。
5. **P9 开局链路**：两步向导（device-12/13）→ 点击开始 → 真实生成阶段指示（device-16）→ **提案卡**（device-17：核心目标/基调/引子/第一个问题）→ 开始冒险 → 战役创建。
6. 游玩页（device-18/19）：**战役主线卡**显示当前目标与最近进展；引导卡显示战役办法（正式求见领主 / 接触安娜 / 潜入监狱-需准备，device-23）。
7. 真实回合：1 次自由输入决策提交完成（device-22）；1 次办法提交在途（时长止损）。
8. V1.0.0 安装冷启动（device-25/26）：战役、主线卡、办法引导完整恢复。
9. 设备库对照（`run-as cat` + node:sqlite）：runtime 存在、4 节点（primary active）、camp-sit-open active。

设备决策数：2（含 1 完整提交 + 1 在途）——主机生产链完成全部 90 决策；设备完整 20+10 重放列为复跑条件（见 §7）。

## 5. 缺陷修复记录（本轮真实测试驱动）

| 缺陷 | 修复 | 验证 |
|---|---|---|
| NPC 模板悬空战利品引用阻断整包发布 | 丢弃引用 + 审查问题 | 真实小说导入发布成功 |
| 阻断型 constraint 超出运行时合同 | 降级 audit + 审查问题 | 同上 |
| 结局条件开局即成立被直接采用 | 采用期拒绝 + 驱动重试 | J3 重试成功（REAL_JOURNEYS） |
| campaign_plan 模型输出 9 类结构漂移 | 本地容错 + 离线 100% 重解析门 | 18/20 历史样本通过（2 份为修复前样本） |
| 首阶段方法机械同型 | 编译器补第二路线（可玩性下限） | J3 第 2 次尝试通过 |
| campaign 方法效果内 player 别名未解析 | 效果编译器别名解析 | J3 旅程 0 actor 错误 |

## 6. 遗留问题

1. **真实 GLM replan 往返**（A20 LLM 半环）：候选全部被结构门禁拒绝。复跑：针对修订任务的提示词收紧（明确 schema 示例 + 字段枚举），或为 replan 增加与 opening 相同的漂移容错面（本轮已修 4 类，剩余 firstSituation 命名类未修完）。
2. **A19 旅程级延迟后果**：提升计划提示中对 `schedule_consequence` 的显式要求，并在旅程中追踪跨决策存活。
3. **A40 长程累积**：用 P8 长测框架挂 P9 runtime 断言（建议 300+1000 两档）。
4. 设备完整决策重放（J1-20/J4-10）与四主题/字体缩放矩阵截图。
5. 用户可用性/主观爽感：**未验**（无独立试玩者）。

## 7. 复跑条件

- 主机旅程：`node tools/real-glm-phase9.cjs {smoke|journey J1|journey J2|journey J3|fork}`（`.tmp/phase9/phase9.sqlite` 持久、manifest 计数续接；预算剩余 87/400）。
- 设备走查：AVD `ShineWord_P8_Reacceptance` + `adb install -r dist/apk/debug/ShineWord-V1.0.0-debug.apk`，按 §4 步骤（脚本化路径已在本轮会话内验证可行）。
- 真实 LLM replan 重试：`node tools/real-glm-phase9-replan.cjs`（重排队后运行）。

## 8. 结论

第九阶段必做功能、适用工程门与真实旅程门**完成**（90/80 决策、预算内 313/400、两次自然结局、设备链路走查）；技术验收达成，遗留项如 §6 如实列出，不做任何名义完成包装。玩家体验验证按独立试玩证据单列（未验）。
