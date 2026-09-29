# 统一世界构建——项目建设进度文档（2026-09-30 终止时点）

本文件为用户指令下的收尾快照：终止测试工作时的完整进度状态。验收细节与证据见
`docs/reviews/UNIFIED_BUILD_FIVE_PHASE_REVIEW.md`（U01–U12 逐项映射）。

## 一、总体状态

**代码实现 100% 完成（P1–P5 全部施工并提交）；真实模型验收部分完成；用户指令终止时
GLM 主测试仍在跑、DeepSeek 因账户余额（HTTP 402）受阻。**

| 阶段 | 状态 | 关键产出 |
|---|---|---|
| P1 统一模型配置/章节组批/限流/重规划 | ✅ 完成 | 冻结 run 配置（migration 17）、章节对齐组批（32 块上限废除）、30%→20%→12% 阶梯重规划、全局 RPM/TPM 调度、跨进程暂停/取消 |
| P2 三宝书与角色-技能-故事信息库贯通 | ✅ 完成 | 证据诚实门（无证据不得标 explicit）、技能 usage 枚举、等级 rule_mapping 溯源、U05/U06/U07 确定性测试 |
| P3 30/30/40 持久阶段推进 | ✅ 完成 | migration 18、确定性阶段边界、触发引擎（邻界/依赖/顺序/去重）、安全边界激活、完整/循序 UI 模式选择 |
| P4 Android 后台运行 | ✅ 完成 | 通知暂停/取消/继续按钮（持久控制标志）、onTimeout 如实停止、waiting_unlock、应用打开自动恢复 |
| P5 双 LLM × 双模式实测 | ⏸ 部分完成（被终止） | smoke ✅×2、校准 ✅×2、DS 引文 201/201 ✅、DS-FULL 两次因 402 受阻、GLM-FULL 运行至 S1 映射阶段被终止、GLM-PROG 未开始 |

## 二、回归证据（终止时全绿）

- `npm run verify:core`：**296 tests / 0 fail**（基线 266 + 新增 30：unified-build-p1 15、p2 4、p3 11）
- `npm --prefix mobile run typecheck`：通过
- debug APK：`ShineWord-V0.3.0-progressive.2-debug.apk`（sha256 `222600b2…585c223b`）
- release APK：`ShineWord-V0.3.0-progressive.2-release.apk`（sha256 `959574bf…8b08c1`，最终含全部修复需 `--rerun-tasks` 重打包——见下"构建坑"）

## 三、真实模型实测结果（终止时点）

### 已通过
- **DeepSeek smoke**（模型 `deepseek-v4-flash`，probe：JSON/usage/前缀缓存/输出上限全绿）
- **GLM smoke**（模型 `GLM-5.3-Flash`，同全绿）
- **双模型校准**：DS off→low 档每章 1.6-1.7k token/6s；GLM low 档 1.7-2.2k token/27-35s（思考仅 8-10 token）
- **DS-FULL 真实数据质量**（受阻前）：S1 完整抽取 18/18 单元、1928 事实、63 实体落库；**引文逐字审计 201/201 = 100%、0 错配**；前缀缓存命中 9.7-12.8k token/请求；校准重规划真实触发（estOutputPerChunk 800→580、批 22→18）
- **思考档位政策**（用户 2026-09-30 指示）：实测 DeepSeek 原生 `thinking.budget_tokens`（网关接受但不严格执行）、GLM `reasoning_effort`；两方言档位参数不同已分治；'off' 一律降级最低档，禁用路径全部删除

### 受阻/未完成（如实）
- **DS-FULL / DS-PROG**：DeepSeek 测试账户余额耗尽（HTTP 402），多次真实推进后全单元失败。**阻碍为外部资金问题，非代码缺陷**（同一密钥配置桌面 harness 前期成功抽取 1900+ 事实）。充值后可一键复跑：`node scripts/unified-build-harness.cjs full <deepseek-config> <workdir> <novel> ds-full`
- **GLM-FULL**：第 4 次运行中 S1 抽取 11/11 完成、进入三宝书映射（16+ 物理请求）后被用户指令终止；**GLM-PROG 未开始**
- **私有标注集（≥60 关键事实）**：未建立（需独立人工标注，不可用被测模型输出充数）
- **设备端 LLM 往返**：未达成（诊断指向 adb 代录密钥的 DEL 序列丢帧导致字段拼接损坏——端点字段实证 `…v4api/coding/paas/v4`；密钥字段掩码不可见但同机制高概率受损。应用本身的 UI/Keychain 流程验证正常）
- **Android 矩阵**：FGS/通知（2 操作按钮+实时计数）/Home/锁屏 45s/取消跨进程/自动恢复 ✅ 实测；断网重连、进程回收冷启动、通知拒绝、加速 timeout、Android 15/16 双版本未验

## 四、施工中发现的真实缺陷（全部修复+回归测试）

1. 流式导入 chunkIndex 每章重置 → 规划器/coordinator 排序错乱（`orderChunksByChapter` 修复）
2. 统一导入世界已存在时跳过章节镜像 → 事实提交外键失败（显式 `saveImportedSource` 修复，131 请求实测发现）
3. 时间线前向引用 → `event_dependencies` 外键失败（存在性防护修复）
4. 阶段 run 取消后阶段卡死无法重排（`claimStageTrigger` 终态重排修复，实机取消流发现）
5. GLM 空 value 事实共享 '' 键 → 误判 canon 冲突阻断发布（`value.text = quote` 修复）
6. 单值谓词（身份类）叙事演进的真实分歧 → 冲突审查路径（harness 以操作者身份裁定，保留首条、余者 speculation 存档）
7. 注册表 checkpoint `key`/`entityKey` 序列化不匹配（复用修复）
8. runId 毫秒碰撞（随机后缀修复）
9. RN bundle 任务不把仓库根 `src/` 当 gradle 输入 → 仅改核心代码时 APK 不更新（需 `gradlew createBundleReleaseJsAndAssets --rerun-tasks`，构建坑已记录）

## 五、交付物清单

- **代码**：`codex/unified-world-build` 分支 14 个提交（P1-P4 各一 + 政策 + 5 修复 + 3 文档），合并至 main
- **测试**：`tests/unified-build-{p1,p2,p3}.test.cjs` 30 项
- **Harness**：`scripts/unified-build-harness.cjs`（smoke/calibrate/full/progressive，生产路径、脱敏计量、预算上限）
- **文档**：五阶段审查报告（U01–U12）、用户指南新模式章节、本进度文档
- **实测产物**（`.tmp/unified/`，gitignore、不入库）：双模型 smoke/校准汇总、DS-FULL 三次尝试的 metrics.jsonl+DB（attempt1 FK 缺陷证据、v6 引文审计 201/201 数据）、GLM-FULL 四次尝试记录

## 六、复现/续跑命令

```powershell
npm run verify:core          # 296 tests
npm --prefix mobile run apk:debug
# DeepSeek 充值后：
UNIFIED_REASONING_EFFORT=low UNIFIED_REASONING_RESERVE=4096 node scripts/unified-build-harness.cjs full <ds-config> <workdir> <novel> ds-full
UNIFIED_REASONING_EFFORT=low UNIFIED_REASONING_RESERVE=4096 node scripts/unified-build-harness.cjs progressive <ds-config> <workdir> <novel> ds-prog
# GLM（续跑）：
UNIFIED_REASONING_EFFORT=low UNIFIED_REASONING_RESERVE=2048 node scripts/unified-build-harness.cjs full <glm-config> <workdir> <novel> glm-full
UNIFIED_REASONING_EFFORT=low UNIFIED_REASONING_RESERVE=2048 node scripts/unified-build-harness.cjs progressive <glm-config> <workdir> <novel> glm-prog
```

## 七、遗留事项

1. DS 账户充值后复跑 DS-FULL/DS-PROG（预期 DS-FULL ~1.5-2h/run，思考重试致密）
2. GLM-FULL/GLM-PROG 完整跑完并回填审查报告 §5 最终指标
3. 建立 ≥60 条私有标注集（前/中/后+边界各≥20）后计算召回率、两模式差
4. 设备端 LLM 往返复测（建议 debug 签名构建 + run-as 读 DB 定位；密钥录入改剪贴板）
5. Android 矩阵剩余项（断网/回收/通知拒绝/timeout/双版本）
6. 最终 release APK 需 `--rerun-tasks` 重打包以包含最后两个修复（空 value 冲突 + 事实裁定）
