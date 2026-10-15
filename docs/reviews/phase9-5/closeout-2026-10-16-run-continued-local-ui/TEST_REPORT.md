# 测试与构建报告

## 本轮定向验证（2026-10-16 Asia/Shanghai）

| 命令/场景 | 结果 | 边界 |
|---|---|---|
| node --test tests/game-opening-chain.test.cjs | 13/13 PASS，0 failed/skipped；包含角色候选去重、同名不同人、冲突别名、未来证据过滤。 | R0当前代码聚焦回归；不等于真实开局旅程。 |
| node --check tests/helpers/phase95LocalMockServer.cjs | PASS。 | 仅语法检查。 |
| node --check tests/helpers/phase95SyntheticArchiveGenerator.cjs | PASS。 | 仅语法检查。 |
| phase95SyntheticArchiveGenerator 正常导出 + 已存在输出拒绝 | PASS；生成save/world hash与导入用fixture一致；冲突目标保持原SHA不变。 | 本地临时文件；仅验证测试工具不覆盖既有输出。 |
| Maestro synthetic action flow | Planner与Narrator由本地mock响应；当前APK显示skill-check成功、耗时10分钟和3d6结果1/2/4；分支显示v2。 | 合成端点/存档，不计有效决定。 |
| 冷启动回放 Maestro assertions | PASS：相同意图、行动结果、耗时、骰型、骰值、成功标签和叙事均可见。 | force-stop/relaunch发生在已commit后；没有覆盖in-flight kill/unknown/outbox中断。 |
| save/world导入依赖路径 | world缺失时明确拒绝；导入world后合成save成功。 | 不是历史save-10，不代表完整坏输入矩阵。 |
| API37小屏与TalkBack冒烟 | 360×800dp视口的合成结果卡主要字段完整显示；TalkBack焦点/节点语义可见，随后恢复原显示与无障碍设置。 | 不代表完整焦点遍历/语音播报、主题、API24或实体机通过。 |
| git diff --check | 初次helper检查PASS；最终提交前复跑。 | 以最终提交前结果为准。 |

本轮本地HTTP log共有11条loopback请求：7 campaign_plan、2 Planner、2 Narrator；没有真实provider请求。campaign_plan HTTP 200但业务合同不通过，另列为mock限制。

## 当前分支最近匹配生产代码的完整门禁

施工分支28b86157b1a691b9dc38a11b4cb9b3e763404ef2对应的公开PR CI：
- Core Verify run 132（38772199551）：success；npm run verify:core报告1334/1334。
- Android Verify run 97（38772199757）：success；mobile typecheck、version一致性和Debug APK构建通过。
- CI页面存在非阻断runner/action deprecation notices；workflow状态为成功。
- 同一APK安装在隔离API37 AVD；APK与installed base.apk SHA一致。

本轮新增仅为测试helper和文档/截图，不改变production source、mobile package或APK输入。当前分支最终PR同步后的CI需在推送后另行记录；如果Android workflow因路径过滤不运行，应按R9记为NOT RUN并绑定最近可匹配APK SHA。

## 之前节点的定向证据（引用既有closeout，不将其冒充本轮重跑）

- R1稳定引用/完成条件：见前轮 TEST_REPORT.md、最终Core 1334/1334。
- R2 Session生命周期：34/34。
- R3预算authority/并发/fence/timeout/unknown：53/53。
- R4 journey audit：11/11。
- R5故障/恢复合同：49/49。
- R6隐私/save/fork/migration/replan：58/58。
- A40生产Session本地确定性100/300/1000：结果副本在 A40_LOCAL_PERFORMANCE.json；不是玩家决定。

定向结果与Core总套件有重叠，不能求和。

## 本轮未运行

真实GLM请求、历史账本和SQLite复核、授权小说正文旅程、save-10精确回放、真实完整旅程/80个决定、实时自然结局、两条后果消费者因果链、Stage-1/8正式场景、in-flight fault injection、API24/实体机、完整TalkBack、主题、10+10配对性能、四名独立试玩均NOT RUN或BLOCKED。小屏与TalkBack仅完成单视口/语义冒烟。没有通过调整测试预期获得PASS。
