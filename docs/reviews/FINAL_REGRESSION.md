# 最终全量回归报告（Alpha 收口）

日期：2026-09-27  
分支：`phase/final-regression`（基于 main @ `1a6aa0d`，即 M5 合入后的 main 头）  
范围：M0～M5 全部交付物的 20 项回归 + 人工审查清单。

## 一、20 项回归结果

| # | 回归项 | 证据 | 结果 |
|---|--------|------|------|
| 1 | 核心 TypeScript typecheck | `tsc -p tsconfig.json --noEmit` 0 错误 | ✅ |
| 2 | 核心全量单测 | 82/82 通过（node --test） | ✅ |
| 3 | SQLite/迁移语义 | migrations.test.cjs 3/3（幂等、失败回滚、乱序拒绝） | ✅ |
| 4 | 确定性概率 | probability/roll/random 测试；固定种子下 RollRecord 可复算 | ✅ |
| 5 | 恢复策略 | recovery.test.cjs：Narrator 失败/重启复用已持久化骰点，不重掷 | ✅ |
| 6 | 分支隔离 | fork 双分支互不泄漏、rewind 源分支不可变（m4-game） | ✅ |
| 7 | 时间泄漏 | 检索强制顺序：validFrom/validTo 之前不返回未来事实 | ✅ |
| 8 | NPC 知识泄漏 | knownToActors 可见性过滤先于相关度排序 | ✅ |
| 9 | 30/100 回合长程 | 本地脚本 100 回合 + fork-50；真实 GLM 100 回合 93 committed / 7 干净拒绝 / 0 崩溃 / stateVersion 严格一致 | ✅ |
| 10 | TXT 导入 | txt-import.test.cjs + 真实《白篱梦》965,458 码点/300 章/114ms | ✅ |
| 11 | 证据原文定位 | world-extraction：引文逐字校验，source location 100% | ✅ |
| 12 | Canon 测试集 | 286 条标注 fixture 召回 ≥90% 测试 | ✅ |
| 13 | 存档导出/导入 | schemaVersion/manifest 校验、篡改拒绝（m4-game） | ✅ |
| 14 | API Key 不可入备份 | 导出递归禁键扫描 + 设备 DB `smoke-key` 扫描 0 命中 | ✅ |
| 15 | 仓库秘密扫描 | 无 sk-/Bearer 字面量、无硬编码 key、keystore 不入库 | ✅ |
| 16 | 大书导入 | 100 万字压测：944 块/导入 108ms/全流水线 3.7s | ✅ |
| 17 | Android debug 构建 | Gradle 9.3.1 `:app:assembleDebug` BUILD SUCCESSFUL | ✅ |
| 18 | 模拟器冒烟 | Release：离线启动→配置→turn-0001 full_success `2d8:[8,1]`→世界书架；Debug：Metro 加载→turn-0001 `2d8:[7,5]`→run-as 校验 turns/roll_records/llm_requests 全部落库 | ✅ |
| 19 | Release 配置核查 | release 不可调试（run-as 拒绝）、独立 keystore 证书 SHA-256 `bac72640…141c34` 与交付 APK 签名一致、口令仅经环境变量 | ✅ |
| 20 | CI 绿 | main @ `1a6aa0d`：deterministic-core ✅ + android-debug ✅（api.github.com check-runs） | ✅ |

## 二、人工审查清单

| 审查项 | 方法与结论 |
|--------|-----------|
| TODO 冒充完成 | `git grep TODO\|FIXME\|XXX\|HACK` 于 src/mobile：0 命中 |
| Mock 进入生产路径 | src/mobile/src 无 mock 引用；FaultInjectionTransport 仅测试调用 |
| 未处理 Promise | 生产代码无裸 floating promise；唯一 fire-and-forget（usageRecorder）显式 `.catch(()=>{})`；async 事务统一 promise 链串行 |
| 双重提交/重掷 | committed 唯一索引 + 幂等重放测试（replay 返回原结果）；insertRoll 拒绝对 committed 回合追加 |
| UI 独立状态成为权威 | React state 仅渲染镜像；权威状态只有 SQLite 快照（M2 评审确认，未回归） |
| LLM 权威写入 | 合同门硬化后畸形字段全部显式拒绝；效果白名单不含成长/等级；骰点/结算全本地 |
| 跨分支泄漏 | 检索按 branch 作用域过滤；fork 只复制显式白名单表 |
| NPC 全知视角 | knowledge_records knownToActors 过滤测试通过 |
| Key 入备份 | 禁键递归扫描为导出必经路径（测试覆盖） |
| 小说文本进日志 | 生产代码无 console.log/info/debug；narrative/world 文本不落日志 |
| GPL/AGPL 复制 | 全部实现为本仓库原创；依赖为标准 MIT/Apache RN 生态 |
| 构建产物入库 | `git ls-files dist` = 0；dist、.tmp、keystore 均被 ignore |

## 三、过程中的修复（本回归期间）

- 模拟器冒烟中发现并修复 6 项真实缺陷（详见 `docs/reviews/M5_REVIEW.md`）：GLM 空 completion 的 Profile 级 thinkingDisabled、合同校验器对缺失 `op` 静默穿透、GLM 方言归一化、故事名 actorId 重映射、Narrator 字段类型检查、Planner 提示词 schema 化。全部带回归测试（82 项中的 4 项新增）。

## 四、已知问题清单（建设方案第 14 节 M5 出口要求）

1. **真机未测**：验收均基于 API 37.1 模拟器（Medium_Phone）；minSdk 24 真机/低版本模拟器兼容性未验证（无真机环境）。
2. **真实 LLM 回合失败率**：约 5~7% 回合产生畸形合同/叙事，被本地校验干净拒绝并跳过（游戏继续、计数诚实）；预算内重试覆盖多数情况，但连续失败时叙事有跳跃感。
3. **MiniMax JSON 模式**：探测如实报告不支持；`jsonMode=false` 路径未在完整游戏回路中实测。
4. **端上性能剖析未做**：20 万/100 万字基线为 Node 桌面端数据；方案第 13 节要求的设备端 P50/P95 延迟记录留待 Beta。
5. **许可证待定**：README 如实声明「待维护者正式确定」（方案建议 MIT，须维护者确认后添加）。
6. **Gradle wrapper 未入库**：本地构建使用 Gradle 9.3.1（wrapper 缓存分发），CI 侧 setup-gradle 已验证通过。

## 五、结论

20/20 回归项通过，12/12 人工审查项无异常。Alpha（M0～M5）建设收口通过，可交付 `dist/apk/` 双 APK 与本仓库 main 分支。
