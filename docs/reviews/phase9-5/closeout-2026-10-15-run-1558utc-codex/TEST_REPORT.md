# 测试与构建报告

## 当前生产代码回归

| 命令 | 结果 | 说明 |
|---|---|---|
| npm run verify:core | 1334/1334 PASS，0 failed/skipped/todo | 源码 HEAD 为 b4641bd；在包含本轮 R4 审计工具与回归工作树改动的环境执行，包含 typecheck、core build 和全部 Node 测试。 |
| npm --prefix mobile run typecheck | PASS | Android TypeScript typecheck。 |
| npm run verify:version | PASS | package/version metadata 检查；versionName 1.0.0，versionCode 1000000。 |
| npm --prefix mobile run apk:debug | PASS | Debug APK 110156351 bytes，SHA-256 3d74e582f40a6203cb997e682e1d767eccdd9eaf70758b129c4e49c9c429095b。 |
| git diff --check | PASS | 无空白错误；Git 曾提示既有 LF/CRLF 自动转换信息。 |

APK build 生成的 mobile/src/version.json 已纳入生产元数据提交 b4641bd；未在该提交后再次构建，以免重新生成时间戳并使输入身份漂移。最终 APK SHA 与隔离 AVD 安装包 hash 相同。

## 节点定向验证

| 命令/场景 | 结果 |
|---|---|
| R0 node --test tests/game-opening-chain.test.cjs 基线 | 9/10；复现同名 canon 角色重复候选缺陷。 |
| R0 修复定向回归 | 13/13；覆盖证据签名去重与冲突/别名边界。 |
| R1 当时完整 Core | 1328/1328；其后最终 Core 为 1334/1334。 |
| R2 npm run build:core + 定向生命周期/settlement/module tests | 34/34。 |
| R3 预算 authority/reserve、timeout/unknown、preview/approval/recovery、并发/fence | 53/53。 |
| R4 node --test tests/phase9-journey-audit.test.cjs | 11/11；包含生产 Session → 临时 SQLite；源 DB hash 前后相同。 |
| R5/fault/recovery 定向集合 | 49/49。 |
| R6/privacy/save/fork/migration/replan 定向集合 | 58/58。 |
| 先前移动端 transport/save/recovery 集合 | 38/38。 |
| A40 production-session-local-deterministic | 100/300/1000 合成累积样本均完成，见 A40_LOCAL_PERFORMANCE.json。 |

定向命令的文件清单：

- R3：node --test tests/phase9-budget-authority.test.cjs tests/phase9-planning-budget.test.cjs tests/phase9-proxy.test.cjs tests/phase9-preparation-restore.test.cjs tests/phase9-request-deadline.test.cjs
- R4：node --test tests/phase9-journey-audit.test.cjs
- R5/recovery：node --test tests/phase9-5-baseline.test.cjs tests/phase9-5-blocker-repair.test.cjs tests/phase9-5-followup-adoption.test.cjs tests/phase9-5-opportunity-projection.test.cjs tests/phase9-turns.test.cjs tests/play-recovery.test.cjs tests/phase7-prepared-turn.test.cjs tests/phase9-preparation-restore.test.cjs tests/phase9-adoption-settlement.test.cjs
- R6：node --test tests/m4-game.test.cjs tests/phase9-sqlite.test.cjs tests/phase9-domain.test.cjs tests/phase9-clues.test.cjs tests/phase9-fork-save-history.test.cjs tests/phase8-save9.test.cjs tests/migrations.test.cjs tests/phase6-save-compatibility.test.cjs tests/phase9-replan.test.cjs

部分定向集合与完整 Core 套件重叠，结果不相加。

## 设备结果与异常

- Debug APK 安装到本轮新建的隔离 API 37 AVD，base.apk SHA 与构建 APK 相同。
- 首次 app 进程有一次 LOW_MEMORY 退出；随后冷启动与 force-stop 后启动成功，未见 FATAL EXCEPTION。
- FTS5 探测的 no such module: fts5 被能力检测处理并回退。未出现需要修改的失败路径。
- 空配置页有 3 个已命名 EditText；键盘焦点和 1.3 字体比例冒烟通过。
- 未执行真实模型、真实完整玩法、骰点/后果/结局 UI 或外部试玩。

## 未运行与外部依赖

- PR/CI：Draft PR #13 open；head 620b268bee66a30559c8b10a47fecca05c3b4710 的 Core Verify run 131（38770974932）和 Android Verify run 96（38770974975）均 PASS。
- 当前设备正式恢复矩阵、Stage-1/8、API 24、实体机、完整 TalkBack/小屏/主题矩阵：NOT RUN。
- 当前真实完整旅程、80 有效决定、真实模型请求、三意图隐私与四人外部试玩：NOT RUN。
- 私有历史预算账本和原始 attempt 响应：NOT VERIFIED。
