# Phase 9 基线核查（P9-0）

| 项目 | 内容 |
|---|---|
| 核查日期 | 2026-10-06（Asia/Shanghai） |
| 方案 | `docs/Shine-TRPG_PHASE9_CONSTRUCTION_PLAN.md` v1.0 |
| 施工 HEAD | `main@5f49a7d653bdc98a910d7b0c0b33ec3ac483b1e0`（与方案复核基线一致） |
| 工作区状态 | 干净；未跟踪文件 4 个，全部保留、不属本轮交付：`.workbuddy/memory/2026-10-05.md`、`.workbuddy/memory/MEMORY.md`、`docs/Shine-TRPG_PHASE9_AGENT_PROMPT.md`、`docs/Shine-TRPG_PHASE9_CONSTRUCTION_PLAN.md` |

## 1. 基线命令与结果

| 命令 | 结果 | 证据 |
|---|---|---|
| `git rev-parse HEAD` | `5f49a7d653bdc98a910d7b0c0b33ec3ac483b1e0` | 本文档编写时实跑 |
| `npm run verify:core` | EXIT=0；`tests 922 / pass 922 / fail 0 / skipped 0` | `.tmp/phase9/baseline-verify-core.log` |
| `node --version` | v24.14.1（要求 ≥24.3.0） | 实跑 |
| `adb devices` | 启动时无连接设备（模拟器未开）；P9-6/P9-7 前再枚举 | 实跑 |

Phase 8 收尾状态（`docs/reviews/phase8/CLOSEOUT_ROUND2_2026-10-05.md`）：36 PASS / 0 NOT RUN / 0 FAIL。

## 2. 真实测试输入身份

| 输入 | 身份 |
|---|---|
| 小说 `放开那个女巫.txt` | 7,178,905 bytes；SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`（与方案一致，未变化） |
| LLM 配置 `GLM-TEST.txt` | 4 行；endpoint `https://open.bigmodel.cn/api/coding/paas/v4`；model `GLM-5.3-Flash`；key 存在（长度 47，形态 `xxxx…​.GYP`，正文不落任何跟踪物）。密钥仅进入内存/系统安全存储 |

模型能力（context window 等）不在配置文件中声明，按既有 capabilityResolver 治理确认；不从文件名或型号猜窗口。

## 3. 源码现状核对（相对方案 §2 B01–B11）

- B01 属实：`CreateCampaignInput.goal` 为 string（`src/application/campaign/createCampaign.ts:53`）；`createCampaign` 已是单事务（`db.transaction`，`createCampaign.ts:464`）。
- B02 属实：快速开局兜底 `compileOpeningSituation` 生成 `situation-opening`（design_fill），`transitions: {}` 为空（`src/application/worldPackage/compileOpeningSituation.ts:82`）。
- B03 属实：方法绑定依赖标准化文本匹配（`src/application/game/v2Compile.ts:151,215` — `normalize(method.firstStep.intent) === normalize(requestedIntent)`）。
- B04 属实：`MethodTemplateV1` 只有 `onSuccess/onFailure` 两档 transitions、`successEffects` 只注入成功档（`src/domain/situations/types.ts:71-75`、`v2Compile.ts:238-251`）。
- B05/B06/B07/B08 基线阅读与方案一致；详细映射见下文各施工包记录。
- B10 属实：SQLite 单基线 `BUILTIN_MIGRATIONS` version 100 `phase8_current_baseline`（`src/infra/sqlite/builtinMigrations.ts:4`）；存档协议 `shineword-save-9`。
- B11 沿用 Phase 8 收尾结论。

## 4. 工作区保护承诺

- 不重置、不改写用户未跟踪文件；不动 `platform-tools-2`；不卸载/不清空用户 App 数据。
- 旧开发数据库（baseline 100）保留；新协议使用新隔离测试库（baseline 101 起新库）。
- 私有测试资产进 `.tmp/phase9/`、`test-logs/phase9/`（gitignore 已覆盖 `.tmp/`；`test-logs/` 见现有约定）。

## 5. 测试矩阵与预算冻结

- 真实物理请求预算上限：**400 次**（构建+规划+回合+记忆+修复共用；manifest 见 `.tmp/phase9/test-manifest.json`，冷启动不清零）。
- 旅程矩阵 J1/J2/J3 各 ≥20 决策 + J4 双路线各 ≥10 决策 = ≥80 有效玩家决策；J1 与 J4 之一须 Android UI 完成。
- 本基线冻结人工金样本：`tests/phase9-goldens/`（由本地确定性数据构成，用于分离"引擎不支持"与"自动生成质量"）。
