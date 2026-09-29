# 第四期本地建设与验收报告

日期：2026-09-29（Asia/Shanghai）
主控：`docs/Shine-TRPG_PHASE4_CONSTRUCTION_PLAN.md`
验收基线：HEAD `5a75379570e4de2edfb8c09bb15334355b658b11`；本期代码及报告构成本地施工增量。提交和推送状态以本轮 Git 记录为准；没有上传或发布 APK。

## 玩家如何游玩

玩家在手机故事页阅读叙事，点一条清楚写明意图的文字选择，或在输入框写自己的动作后显式点「行动」。检查人物、物品、线索和目标走只读详情；它不会偷偷提交行动。提交后，Planner 只能提出受限行动结构，本地规则负责合法性、检定、骰点、状态和资源结算，Narrator 只把冻结结果说成故事。符合现有规则的同伴和 NPC 可自动行动到下一个玩家决策点。

玩家仍决定行动对象、攻击目标、撤退、关键物品支出、成长选择和谜题答案。出现多名目标时应先让玩家选；不在当前世界或场景里的地点、技能、角色不能由模型补造。上述文字主屏和路由已在本地代码与模拟器视觉检查中确认；本轮没有提交普通故事行动或合格场景遭遇的真实端到端回合，所以不宣称实际战役完整通过。

## 验收结论

状态仅取 PASS / FAIL / NOT TESTED / BLOCKED；代码回归、界面冒烟、实际游戏行动和发布出口彼此分开。

| 阶段 / 门禁 | 状态 | 本轮证据与缺口 |
|---|---|---|
| Q4-00 基线与用户工作保护 | PASS | 基线与实现后快照见 [Q4_BASELINE.md](Q4_BASELINE.md)；保留用户修改/新增内容，无 reset/clean。 |
| Q4-01 架构、路由与恢复 | PARTIAL | migration 16、遭遇意图协议、scene-qualified begin、StoryEntry 和有界自动行动 journal 已实现，核心测试覆盖。当前没有独立 `UnifiedActionGateway` 类；React `PlayScreen` 仍直接分派选择。真实 SQLite commit 后/checkpoint 前在 Node SQLite failpoint 注入通过；Android 精确进程终止未测。细节见 [Q4_ARCHITECTURE_ADR.md](Q4_ARCHITECTURE_ADR.md)。 |
| Q4-02 文字主屏与四主题 | PASS（界面范围） | 主屏只显示故事/至多三项文字选择/显式输入；默认页无常驻战斗 HUD。四主题截图与对比度门禁通过。主题界面冒烟不等于各题材故事完整通过。 |
| Q4-03 统一行动与正式遭遇入口 | PARTIAL | 结构化选择直接执行；普通行动走 V2，遭遇 intent 走独立受限协议；目标与 scene entry 在本地重新校验。但本轮没有在设备提交普通行动。当前 QA 世界没有明确 scene/template qualification，因此正式界面不展示遭遇选项；不为通过测试伪造敌人。设备普通行动/遭遇均未形成 committed 回合。 |
| Q4-04 同伴/NPC 自动推进 | 代码回归 PASS；设备 NOT TESTED | journal 上限 32 步、每 4 步 yield、10 秒暂停、requestId、fence、恢复及“到玩家决策即停”有核心行为测试。本机 QA 场景未进入合格遭遇，设备正常点击次数不能记作 0 次通过。 |
| Q4-05 开局与多题材 | PARTIAL | 两步开局 UI、规则预算推荐与仅用可见技能的测试存在。调查、关系日常、冲突三种 QA 故事没有全部端到端运行；事实/推测/待解谜底隔离仍需结合真实故事样本验收。 |
| Q4-06 真实 LLM 与《白篱梦》《凡人修仙传》 | BLOCKED / NOT TESTED | 本轮 LLM 请求 0 次、两部小说 SAF 导入 0 次、campaign 首回合 0 次。配置文件元数据早于 R7 密钥字段事故，未读取/使用凭据。详情见 [Q4_LLM_NOVEL_REPORT.md](Q4_LLM_NOVEL_REPORT.md)。 |
| Q4-07 模拟器视觉与行为 | PARTIAL | 已有 API 37 / Android 17 `ShineQA` 上通过尺寸布局、四主题/字体/键盘截图、详情返回、边缘菜单点击和断网 Release 冷启动。TalkBack、设备行动闭环、性能 P95 与 Android 15/16 设备未测。见 [Q4_DEVICE_MATRIX.md](Q4_DEVICE_MATRIX.md)。 |
| Q4-08 签名候选与兼容 | PASS（候选包范围）；兼容矩阵 PARTIAL | Release 构建、v2 单签名者、zipalign、多 ABI、内嵌 bundle、同版本 `install -r` 数据保留和断网启动 PASS。旧 partial 数据自动兼容回归 PASS；私人 Keychain/旧用户存档未逐字段实测。未升级版本号，不是公开发布候选。见 [Q4_COMPATIBILITY_REPORT.md](Q4_COMPATIBILITY_REPORT.md)。 |
| Q4-09 报告与状态入口 | PASS | 已更新本报告、基线/ADR/设备/兼容/小说报告，并补充 README 与 DEVELOPMENT_STATUS 当前入口。 |

## 本轮命令与构建

| 命令/操作 | 状态 | 日志或证据 |
|---|---|---|
| `npm run verify:core` | PASS，237/237、0 fail/skip，exit 0 | `%TEMP%\shineword-phase4-verify-core-final.log` |
| `npm --prefix mobile run typecheck` | PASS，exit 0 | `%TEMP%\shineword-phase4-mobile-typecheck-final.log` |
| `node docs/reviews/final-closeout/contrast-check.cjs` | PASS，96 项、0 项低于门槛、组件断言全通过，exit 0 | `%TEMP%\shineword-phase4-contrast-final.log` |
| `npm --prefix mobile run apk:debug` | PASS，exit 0；开发 Debug 构建，不作为离线候选 | `%TEMP%\shineword-phase4-debug-final.log` |
| `pwsh -File mobile/scripts/build-release-apk.ps1` | PASS，exit 0 | `%TEMP%\shineword-phase4-release-final.log` |
| `git diff --check` | PASS，exit 0（只有 Windows 换行规范提示） | 本机命令输出未另存；没有 whitespace error |
| `adb -s emulator-5554 install -r <Release>` | PASS，返回 `Success`；第一安装时间保持不变 | pre/post install PNG/XML 位于 `%TEMP%\shineword-phase4-preinstall.*`、`postinstall.*` |
| Release 断网冷启动 | PASS，airplane mode 已生效、CONNECTED 网络为 none、强停后重启到书库 | `%TEMP%\shineword-phase4-offline-coldstart.png` |

Release 候选 SHA-256：`E8450CB37FB8EC556CD1B087A567BB3C60497995A6578613EE92233C8989FAF1`；证书 SHA-256：`017b3fbed4001083f2f70a0c51e8e463322df66b095e1c3a476fdd0d86dc2a0a`；大小 47,059,294 B；ABI 为 `arm64-v8a` + `x86_64`。候选与工作树对应，但 versionCode 仍为 16 / versionName `0.3.0-progressive.2`。本期硬门禁未关闭，不升级 Alpha/Beta，也不上传或发布 APK。

## 六个产品出口问题

1. **文字优先方向：界面实现通过，完整可玩行动未通过。** 默认页已是读故事、选文字行动或显式输入；行动提交与真实叙事还没有端到端证据。
2. **规则编排：代码层大部分通过，设备闭环未通过。** 确定性服务、目标限制、自动行动协调和恢复有行为回归；场景遭遇入口和设备行动未完成，集中式 `UnifiedActionGateway` 也尚未实现。
3. **两部真实小说：未通过。** 没有 SAF 接收、Dossier、Publish、Opening、Campaign 或十次玩家决策证据。
4. **设备兼容：部分通过。** API37 AVD 上 Release 与布局证据通过；API24、真机及 Android 15/16 未测。
5. **性能统计：未测试。** 没有端上 P95 样本，也没有足够 TTFP 样本。
6. **可发布性：未通过。** 有本地签名、多 ABI、内嵌 bundle Release 候选，但玩法/真实模型/设备矩阵硬门禁未关，版本号未递增，未发布。

## 交付边界

本期私人小说、密钥、个人存档、APK 和构建目录不写入报告或 Git。全部模拟器截图和构建日志留在 `%TEMP%`；报告中只引用脱敏的本机证据路径。源码提交与远端同步见本轮 Git 提交记录；没有公开发布或上传 APK。
