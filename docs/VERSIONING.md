# Shine-TRPG 版本管理规范

> 参考：`tavo-mini` 版本管理规范（CHANGELOG / 语义化版本 / versionCode 编码 / 一致性门禁），按 Shine-TRPG 双包结构适配。
> 作者：ShineHe
> 生效版本：`0.4.0`（versionCode 40000）

## 1. 统一版本号规则

全仓库只有**一个**产品版本号，语义化格式 `MAJOR.MINOR.PATCH`（如 `0.4.0`）。以下位置必须完全一致（由 `npm run verify:version` 门禁强制）：

| 位置 | 字段 | 示例 |
|---|---|---|
| `package.json`（根，核心域） | `version` | `0.4.0` |
| `mobile/package.json` | `version` | `0.4.0` |
| `mobile/package-lock.json` | `version` 与 `packages[""].version` | `0.4.0` |
| `mobile/android/app/build.gradle` | `versionName` | `"0.4.0"` |
| `CHANGELOG.md` | 最新发布条目 `## [0.4.0] - 日期` | — |
| `README.md` | 「当前版本」与徽章 | `V0.4.0` |

对外展示统一使用 `V` 前缀（`V0.4.0`）；APK 文件名由构建脚本生成 `ShineWord-V0.4.0-<variant>.apk`。

## 2. versionCode 编码公式

```
versionCode = MAJOR × 1,000,000 + MINOR × 10,000 + PATCH × 100 + BUILD
```

- `BUILD` 为同版本重跑序号，取值 `0–99`，默认 `0`（由 `mobile/scripts/generate-version-json.js` 按环境变量 `SHINE_WRITER_BUILD_NUMBER` 维护，不存在时固定 0）。
- 例：`0.4.0` → `40000`；`0.4.1` → `40100`；`1.0.0` → `1000000`。
- versionCode 必须**严格单调递增**。本仓库历史版本 `0.3.0-progressive.2 / versionCode 16` 为旧编号，自 `0.4.0 / 40000` 起执行本公式。

## 3. 版本迭代规则（何时升哪一位）

遵循语义化版本，结合本项目里程碑节奏：

| 变更类型 | 升位 | 示例 |
|---|---|---|
| 破坏性变更：存档/DB 不兼容、ActionContract 协议主版本、需用户迁移 | **MAJOR** | 0.x → 1.0 |
| 新能力发版：新增子系统/界面/LLM 基础设施里程碑（M 阶段）、一批特性落地 | **MINOR** | 0.3 → 0.4 |
| 修复与打磨：bug 修复、性能优化、文案、回归补齐（不含新能力） | **PATCH** | 0.4.0 → 0.4.1 |

附加规则：

1. **预发布标识只允许出现在正式发布前**（如 `0.5.0-rc.1`），一旦发布必须去除；历史 `0.3.0-progressive.2` 风格不再使用。
2. **DB schema 迁移不要求升 MAJOR**：迁移必须向后兼容（只增表/列），不可兼容的破坏性迁移才触发 MAJOR。
3. **每次升版本必须同步更新** `CHANGELOG.md`（新条目 + 「升级版本至」记录）与 `README.md`（当前版本/徽章），并跑 `npm run verify:version`。
4. **发版（GitHub Release）以 git tag `v<版本>` 为准**，tag、Release 标题、APK 文件名、versionName 四者同版本。

## 4. 发版流程（Release Checklist）

详细命令见根 `package.json` 与 `mobile/scripts/build-apk.js`。每次发版逐项确认：

- [ ] 全部门禁绿：`npm run verify:core`、`npm run typecheck`、`npm run typecheck --prefix mobile`、`npm run verify:version`、`git diff --check`。
- [ ] `npm run apk:debug --prefix mobile` 成功（Debug 通道回归）。
- [ ] 四项 `SHINE_WRITER_RELEASE_*` 签名环境变量齐备；keystore 文件存在；密码不落脚本/日志。
- [ ] `npm run apk:release --prefix mobile` 成功，产物 `dist/apk/release/ShineWord-V<版本>-release.apk`；脚本内置 apksigner/zipalign/包名/版本校验通过。
- [ ] `adb install -r` 正式包成功、冷启动无崩溃（ShineQA AVD）；不执行卸载或清数据。
- [ ] CHANGELOG / README 当前版本已更新；`CHANGELOG.md` 顶部条目与 tag 一致。
- [ ] commit → push `main` → `git tag v<版本>` → push tag → GitHub Release 附正式 APK。

## 5. 一致性门禁

```bash
npm run verify:version
```

脚本 `scripts/check-version-consistency.cjs` 校验第 1 节全部位置 + versionCode 公式 + CHANGELOG/README 版本出现，任一不符即失败（exit 1）。该门禁应在每次升版本与发版前运行。
