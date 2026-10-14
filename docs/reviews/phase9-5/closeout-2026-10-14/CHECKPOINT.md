# 复现检查点 — closeout 2026-10-14

## 代码与 APK 身份

- 工作树：`E:\AiWorkSpace\ShineWord`；分支 main；HEAD `08b64522939b2fd84b5cb2762296538ad70b5ef3`。
- 修复**未提交**，在工作树中：`src/domain/campaignPlan/consequenceLifecycle.ts`（新增）、`src/domain/campaignPlan/types.ts`、`src/application/campaignPlan/settlement.ts`、`tests/phase9-5-consequence-lifecycle.test.cjs`（新增）＋ 6 处 stale 断言修正。
- productionSourcesHash `2f5466b929111b31ee4b84c37ee4b9935619893f9144b0888f40d92fa59cb6a7`。
- Debug APK `5c17b33106c70a290fb60603ea4af5d44f63fc0486705400fb0f680a4b192d9a`，109,969,071 字节；设备 base.apk 哈希一致。
- 包 com.shineword.app；V1.0.0 / 1000000；emulator-5556 / API37 / ShineQA；`install -r` 保留数据。

## QA 数据现状

- 设备为**全新安装**（经用户授权卸载了早于战役系统的 v0.4.1）。无任何战役、无任何历史回合。
- 已配置 GLM profile（端点/模型/思考强度高/Keychain 密钥），冷启动保留。模型凭据上游 401，真实请求未发。
- 候选 QA 存档：`.tmp/phase9/local-20261009/journey-J4AR68C.shineword-save.json`、`journey-J4BR68C.shineword-save.json`，**均通过生产 save-10 校验**（`validateSaveJson(json, sha256Hex)`，异步）。已推送至 `/sdcard/Download/`。
- 导入后建议立即导出 save-10，作为可复现恢复点。

## 预算账本

- 合同账本 `.tmp/phase9/test-manifest.json`：1291/1500，审计行 0。
- `tools/phase9-budget.cjs` 的 `HARD_STOP=1450` 为真实上限 → 余 159 次（非 1500 的名义余 209）。
- 该工具默认账本路径 `.tmp/phase9/local-20261009/test-manifest.json` **不存在**，须显式传 `filePath: '.tmp/phase9/test-manifest.json'`。
- 本轮真实物理请求数：**0**。

## 冻结与禁区清单

- J1 `camp-mv3mw9hk-main` v70 / `turn-0071`：冻结，永不回放。
- R62 首条抽取 unknown 与设备超时请求：永久禁区，禁止重放。
- 旧 v33 来源分支的重复领奖历史：不得回放或修改。
- 任何 `outcome_unknown`：只能经正式 API acknowledge，禁止自动重发。

## 门禁状态（本轮实跑）

- `npm run verify:core`：1311/1311 PASS。
- `npm run verify:version`：OK。
- `npm --prefix mobile run typecheck`：通过。
- `git diff --check`：干净。
- `npm run apk:debug`：BUILD SUCCESSFUL；`adb install -r` + 冷启动成功。

## 续跑门槛

1. 解决测试模型凭据后，从 save-10 导入建立 QA 主分支，再做真实旅程（供给恢复、A15、A28、三路汇合、20 动作窗口、80 决定、匹配性能、第二题材）。
2. 修复 `tools/phase9-android-secret-input` 的保存按钮匹配，使首启页凭据配置可自动化。
3. V95-12/A36 需独立真人试玩；CI 读取需外部权限。
4. 每个新生产修复仍走 RED→fix→全量门禁 + `install -r` + 同场景复验。

## 证据位置

- 公开报告：`docs/reviews/phase9-5/closeout-2026-10-14/`。
- 私有证据（被 gitignore）：`test-logs/phase9-5-closeout-2026-10-14/private/`。

本轮无 commit、push、PR 或发布。