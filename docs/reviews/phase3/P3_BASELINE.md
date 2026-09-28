# P3.0 基线冻结（Phase 3 Baseline）

> 阶段：P3.0 基线冻结
> 日期：2026-09-28
> 方案：`docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md`
> 仓库：`anjingdtl/ShineWord`

## 1. 分支与提交基线

| 项 | 值 |
|---|---|
| 远端仓库 | `https://github.com/anjingdtl/ShineWord.git` |
| 同步后 `origin/main` HEAD | `08eecb934472dacbf1d43c47404f1f2d35f94f28` |
| 方案标注代码基线 | `c6c6c7a1f003275e8d8e713aa41fd2c543ec2f51` |
| `08eecb9` 相对 `c6c6c7a` 的差异 | 仅新增 `docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md`（文档提交，无代码变更） |
| 第三期工作分支 | `feature/phase3-ui-gameplay`（自 `origin/main` 新建，创建时远程不存在同名分支） |
| 分支 HEAD（建分支时） | `08eecb934472dacbf1d43c47404f1f2d35f94f28` |
| `git status` | `working tree clean`（无未提交杂项） |

命令记录：

```bash
git fetch origin --prune
git log --oneline -3 origin/main     # 08eecb9 docs: add Shine-TRPG phase 3 construction plan
git ls-remote --heads origin         # 无 feature/phase3-ui-gameplay，只有 main 与 phase/m*
git checkout -b feature/phase3-ui-gameplay origin/main
```

## 2. 版本与包体基线

| 项 | 值 |
|---|---|
| `mobile/package.json` version | `0.2.0-p2.9` |
| `mobile/android/app/build.gradle` versionName | `0.2.0-p2.9` |
| versionCode | `10` |
| applicationId / namespace | `com.shineword.app`（第三期冻结，不修改） |
| debug APK 体积 | **未测量**（本轮无构建环境，待线下开发机） |
| release arm64 APK 体积 | **未测量**（同上；release 需签名环境变量） |

## 3. 现状基线（P2 成果）

- P1：四主题（墨 `ink` / 烛 `fantasy` / 漫 `manga` / 梭 `scifi`）+ Token 体系 + 主题装饰组件。
- P2：React Navigation（Bottom Tabs：书库 / 战役 / 我的；Native Stack：WorldDetail / Opening / Play / ThemeGallery）。
- 页面已迁移至 `mobile/src/ui/screens/`；`mobile/App.tsx` 已缩减。
- 核心回归基线：152/152（方案 `§1.1` 所载；本轮未复跑）。
- P2 页面截图（沿用既有存档，本轮未重拍）：

```text
docs/reviews/ui/P2-tab-library.png          书库（默认主题）
docs/reviews/ui/P2-tab-library-ink.png      书库（墨）
docs/reviews/ui/P2-tab-library-manga.png    书库（漫）
docs/reviews/ui/P2-tab-campaigns.png        战役（默认主题）
docs/reviews/ui/P2-tab-campaigns-ink.png    战役（墨）
docs/reviews/ui/P2-tab-campaigns-real.png   战役（真实数据）
docs/reviews/ui/P2-tab-profile.png          我的（默认主题）
docs/reviews/ui/P2-tab-profile-ink.png      我的（墨）
docs/reviews/ui/P2-tab-profile-manga.png    我的（漫）
docs/reviews/ui/P2-theme-gallery-entry.png  主题画廊入口
docs/reviews/ui/P2-worlddetail-overview.png 世界详情-资料
docs/reviews/ui/P2-worlddetail-books.png    世界详情-三宝书
docs/reviews/ui/P2-worlddetail-review.png   世界详情-审查
docs/reviews/ui/P2-play-composer.png        Play 输入区
docs/reviews/ui/P2-play-turn-success.png    Play 回合成功态
```

## 4. 基线验证命令（本轮执行状态）

方案 P3.0 要求的验证命令：

```bash
npm run verify:core
npm run typecheck --prefix mobile
npm run apk:debug --prefix mobile
```

**本轮任务约束**：本任务明确允许把测试留到后续线下开发机执行，因此以上命令
**均未在本轮运行**，不得视为通过。执行状态如下：

| 验证项 | 本轮状态 |
|---|---|
| `npm run verify:core`（core tests） | **未运行**，待线下开发机验证 |
| `npm run typecheck --prefix mobile` | **未运行**，待线下开发机验证 |
| `npm run apk:debug --prefix mobile` | **未运行**，待线下开发机验证 |
| 关键页面截图（本轮基线快照） | **未重拍**，沿用 P2 既有截图，待线下补拍 |

## 5. P3.0 出口状态

| 出口条件 | 状态 |
|---|---|
| 核心测试不得低于当前 152/152 | 待验证（未运行） |
| mobile TypeScript clean | 待验证（未运行） |
| Android debug 可构建 | 待验证（未运行） |
| 无未提交杂项 | 满足（建分支时 working tree clean） |
| 保存当前关键页面截图 | 待验证（未重拍，沿用 P2 归档截图） |

> 说明：本阶段为纯记录阶段，不修改任何产品代码；未执行项均按任务约束如实标注。