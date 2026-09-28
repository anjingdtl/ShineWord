# ShineWord 二阶段收尾验收 R6

日期：2026-09-28。验收基线：原方案 [PHASE2_CONSTRUCTION_PLAN.md](../PHASE2_CONSTRUCTION_PLAN.md) §7、§10～§19 与 P2-0～P2-6。本轮只读基线 HEAD：4d07c33036d6d0ac56725adce0952e172ff56b69，分支 feature/ui-revamp；本地 main 为 95f9cbfeb01ba776260d30650a72c91b87f8eb11，origin/main 为 f193d6aa3fd8fcb2115e740be6bd7d9a4ca6556f。feature/ui-revamp 比本地 main 多一个本地 UI 提交。

## 结论

本轮修复并复验了开局同伴和玩家投影中的秘密模板泄漏、直接提交模板 ID 绕过资格、三书章节引用残留隐藏条目，以及同伴支援指令没有说明其实际后续动作依据的问题。核心正式回归 147/147、第一轮原复现 7/7、第二轮原复现 5/5、移动端 TypeScript 检查均通过。

二阶段 P2-0～P2-6 仍未全部达到出口。没有把内存 SQLite 子场景回归包装成完整 App 冒险验收，也没有把历史模型记录、桌面 Node 性能数据或 p2.8 旧包当成本轮新证据。重点缺口包括：完整单人加两名同伴探索—社交—战斗—休整—成功训练 UI 冒险，三种题材真实模型构建和独立人工标注，当前推理开启政策下双模型 100 次提交，API 24 与真机，大文件端上性能，以及失能结局如何由世界/遭遇合同选择的完整运行政策。

## 本轮实现和本地门禁

- CampaignSession.getWorldSetup 只返回当前锚点公开、有效且满足开局招募条件的模板；遭遇候选与三书投影也按可见性、发现状态和时间过滤。公开场景中嵌套的 GM 模板、物品、线索引用会在传给玩家和 Planner 前剔除。
- createCampaign 在服务端重验同伴模板的公开可见性、有效时间、招募资格、关系/开局关系、任务前置、地点/锚点和最多两名同伴约束。直接提交 GM 或未来模板 ID 被拒绝，且不留下 Campaign 半成品。运行期 recruitCompanion 同样要求已存在的在场 NPC 实例，不接受模板 ID 直接生成同伴。
- §11 已有招募、退出、分队、重入、关系、指令、显式通信、按角色知识记录和物品归属/来源变更；状态变更写入事件、完整快照，支持 rewind 和存档往返。A11 覆盖相关非法操作、拒绝无条件广播/越权共享、分队卡片隔离、失能角色动作拒绝及普通治疗不能复活已死亡角色。
- 失能/死亡状态、进入濒危/恢复/死亡事件及快照已有领域实现和回归；但 DISABLED_FATES 的 captured/rescued/death_risk/ending 仍只是候选枚举，没有由世界/遭遇合同配置并由 App 呈现、执行和回退的完整命运状态机。本条按部分实现记录。
- assembleBook 修正了已过滤条目后仍把隐藏 entryId 留在分节元数据的问题。tests/phase2-acceptance.test.cjs A08 覆盖 GM 模板、未来模板、嵌套场景引用、三书章节和 Planner 上下文；A11 覆盖生命周期、知识传播、物品来源、失能/死亡风险与存档。
- 最新本地门禁结果：npm run verify:core = 147/147；node docs/reviews/P2_ACCEPTANCE_REPRO.cjs = 7/7；node docs/reviews/P2_ACCEPTANCE_ROUND2_REPRO.cjs = 5/5；npm run typecheck --prefix mobile = PASS；git diff --check = PASS（Git 对部分文件提示 LF/CRLF 转换）。

## 原方案逐条验收矩阵

| 原方案条款 | 实现入口 | 测试 | 设备/模型证据 | 状态 |
|---|---|---|---|---|
| §7 TXT 自动构建、断点恢复、时间/事实分类、三书编译与发布门禁 | src/application/worldPackage、src/application/world、publish.ts | verify:core 中分块恢复、证据定位、冲突/依赖门禁、三书投影回归 | 历史 R3 只有小规模 GLM 抽取样本；本轮没有运行真实抽取或端上大文件构建 | 部分通过；真实语料和质量门槛待验 |
| §10.1～10.3 Campaign 原子开局、锚点、两类角色、模式与时钟 | createCampaign.ts、session.ts、opening.ts | A08 覆盖原创及原著角色、两个 Campaign 隔离、非法开局；其他规则/时钟测试在 147 项内 | p2.9 只实测离线启动设置页，没有实际角色开局旅程 | 部分通过 |
| §10.4 任务、线索、知识、世界响应及奖励 | session.ts、quest/reward/knowledge 投影、commitTurn.ts | 线索发现、任务推进、知识、奖励、历史回退及存档有分项引擎回归 | 本轮没有用最终 APK 完成一条端到端 UI 任务链 | 部分通过 |
| §11 招募、退出、分队、重入、指令拒绝依据、知识隔离、通信、物品归属与濒危 | session.ts、recruitment.ts、encounterFlow.ts、commitTurn.ts | A08/A11 通过；当前同伴指令拒绝和 fallback 依据有专项断言，生命周期事件及历史/存档恢复有回归 | p2.8 历史设备证据仅覆盖战斗援救与恢复；p2.9 本轮未执行生命周期 UI | 部分通过；世界/遭遇合同驱动的 disabled fate 尚未落地，不能以援救闭项 |
| §12 遭遇、行动成本、距离、效果、失能、恢复与结局 | encounterService.ts、encounterFlow.ts、domain/combat | verify:core 与第二轮原复现 5/5 覆盖事务、行动额度、距离、战斗/快照及既有结局规则 | 历史 p2.8 合成战斗设备证据；p2.9 仅启动验证 | 引擎通过；设备旅程待验 |
| §13 AI 权限、冻结合同、重试、原子结算与请求预算 | v2Compile.ts、commitTurn.ts、sqliteTurnStore.ts | 147 项含非法 Planner 字段、相同骰点恢复、幂等重放与事务失败回归 | 本轮没有执行真实 Provider 长程；离线 Release 启动不等于离线游戏结算 | 部分通过 |
| §14 时间、知识、秘密和版本隔离 | session.ts 的 projectPlayerEntriesAtAnchor/buildWorldContext、knowledge ledger | A08/A11 及知识检索回归验证秘密/未来内容过滤、每角色 discoveries 和显式传播条件 | 未在最终 APK 上逐屏验证发现后回到三书视图 | 引擎通过；设备视图待验 |
| §15 SQLite 迁移、完整快照、回退及旧数据策略 | infra/sqlite migrations、sqliteTurnStore.ts、fork.ts | 核心迁移、原子快照、历史 rewind 与不完整旧历史拒绝回归通过 | 没有在 API 24、真机上执行旧库升级/失败恢复矩阵 | 部分通过 |
| §16 存档、世界包 ZIP、缺失依赖与干净库恢复 | export/saveFile.ts、worldPackage/archive.ts、fork.ts | verify:core/A11 覆盖校验、世界包/存档往返、引用重映射、历史与幂等恢复 | p2.8 历史合成 QA 有设备导入/导出/续玩；p2.9 本轮未重新跑这些页面 | 引擎通过；当前 Release UI 待验 |
| §17 页面和模块的可操作闭环 | mobile/App.tsx、mobile/src/ui | npm run typecheck --prefix mobile 通过 | p2.9 API 37.1 断网冷启动到设置页；未完成导入、键盘、战斗、书页与保存恢复的最终包旅程 | 部分通过 |
| §18 P2-0 基线整改 | 旧缺陷修复及本轮回归 | verify:core 147/147；原复现 7/7、5/5 | 未验证全部旧 Android 数据升级路径 | 部分通过 |
| §18 P2-1 世界包与三书骨架 | package schema、publish.ts、worldPackage/archive.ts | 引用/依赖/冲突及隐藏投影测试通过 | p2.8 历史合成包编辑和 ZIP UI 证据；无三题材质量证据 | 部分通过 |
| §18 P2-2 建卡与真实战役 | createCampaign.ts、session.ts、CharacterFactory | A08 覆盖原著与原创开局及战役隔离 | 没有 p2.9 真实 UI 开局与两种角色旅程 | 部分通过 |
| §18 P2-3 探索→社交→战斗→休整→成功训练 | CampaignSession、EncounterService、quest/reward/growth 服务 | 各段有组件回归，但没有一条同一 1+2 队伍端到端脚本串联任务、线索、知识、奖励、三书发现、成功训练、崩溃、回退和干净库续玩 | p2.8 历史战斗/休整设备证据不覆盖完整旅程；p2.9 未执行 | 未通过出口 |
| §18 P2-4 自动三书和关键冲突门禁 | buildPackageFromCanon、publish validators | 合成事实与 schema/冲突测试；不能用 FixtureExtractor 代表真实召回 | 历史小样不满足三套自创/授权小说及独立标注要求 | 未通过出口；需要授权素材与人工标注 |
| §18 P2-5 编辑、迁移、世界包/存档交付 | worldPackage archive、saveFile、迁移执行器 | 合成包/存档的引擎往返和缺失历史策略回归通过 | 仅历史 p2.8 QA 设备证据；最终 p2.9 页面以及真实旧库迁移待验 | 部分通过 |
| §18 P2-6 Beta | 全部移动端、Provider、性能和发布入口 | 上述核心门禁通过不构成 Beta 出口 | 真实双模型、100 次当前政策动作、API 24、真机、端上性能及完整旅程未通过 | 未通过 |
| §19 三书一致性、引用完整、非法行动和冲突发布门禁 | publish validators、assembleBook、v2Compile.ts | 147 项含 GM 隐私、公开引用、权限、资格及冲突回归 | p2.9 冷启动通过；没有真实三题材发布质量证据 | 局部自动门禁通过；整体待验 |
| §19 三题材冒险与独立 ≥200 关键事实（别名/倒叙/传闻） | 自动构建流水线 | 合成夹具不是独立人工标注集 | 本轮没有三套获准素材、真实模型输出和人工核标 | 未通过；素材/标注条件缺失 |
| §19 召回 ≥90%、explicit 字段引文定位 100%、人工语义支持率 | provenance 与引用定位校验 | 合成定位回归不能作为目标结果 | 没有本轮真实模型评估和人工支持率记录 | 未通过；外部数据与人工评审待补 |
| §19 ≥100 提交、多模式、至少一次分叉、本地重放及结果分类 | CampaignSession、TurnStore、branch/fork | 本地确定性 100 回合/原子恢复类回归在核心中；本轮未做真实模型 100 提交 | 历史 100 步/其他政策记录不等于本轮要求；R5 推理开启小样有 2 次 Error/non_provider | 未通过；需真实运行 |
| §19 至少两种当前已配置模型、推理开启、含无 JSON 模式 | openAICompatible.ts、ApiProfile capabilities | Provider 的 reasoning-only、JSON 支持/不支持及错误路径有模拟测试 | 当前没有第二个已配置服务的本轮真实证据；未请求或读取密钥 | 未通过；第二模型配置和真实调用待补 |
| §19 API 24、较新模拟器、真机导入/键盘/战斗/杀进程恢复 | Android 工程、SQLite、saveFile | 设备外测试不能替代本项 | p2.9 仅 API 37.1 模拟器离线启动；没有 API 24 镜像/SDK Manager 和已连接真机 | 未通过；设备条件缺失 |
| §19 端上 P95 与 20 万/100 万字阶段、峰值内存、卡顿、恢复 | mobile 导入/规则入口 | 桌面 Node 性能不是端上指标；本轮没有端上基准 | 未在 API 24/目标手机测量 | 未通过；需目标设备和获准压力素材 |

## Release APK 与源码对应关系

R5 曾记载“无本轮 Release 签名证据”。这是 R5 当时的快照结论；本轮已重新检查旧 p2.8 文件并构建 p2.9，不能继续沿用“没有签名包”的现状描述。

| 项目 | 已验证结果 |
|---|---|
| 旧 p2.8 | dist/apk/release/ShineWord-V0.2.0-p2.8-release.apk；34,528,029 bytes；versionCode 9 / versionName 0.2.0-p2.8；minSdk 24 / targetSdk 36；SHA-256 5E17DC897356A711EC73970C7E61A0E613BB2BC6A325393CD0D866C0B2714562；apksigner v2 通过，单一签名者，证书 SHA-256 017b3fbed4001083f2f70a0c51e8e463322df66b095e1c3a476fdd0d86dc2a0a。解包 bundle SHA-256 986d47243b014019622f9edf49c908df7b431e3a5957c771fd1483519c77c6a1；不包含本轮新投影标记，故不是本轮源码包。 |
| 本轮最终 p2.9 | dist/apk/release/ShineWord-V0.2.0-p2.9-release.apk；46,504,038 bytes；versionCode 10 / versionName 0.2.0-p2.9；minSdk 24 / targetSdk 36；SHA-256 46B6E47B22577B2EB19E26279B54558DDA56B70B284BFF2151B70461D4AE4446；apksigner v2 通过、单签名者，证书 SHA-256 与 p2.8 相同；zipalign -c 4 成功。 |
| Bundle 对应 | APK 的 assets/index.android.bundle 为 3,825,580 bytes，SHA-256 412434d32561f519e87f32661b08029586c75c5086b022968142570b94720a71，与 mobile/android/app/build/generated/assets/react/release/index.android.bundle 完全一致。bundle 含 projectPlayerEntriesAtAnchor、worldTimeOrder、critical_state、captured、death_risk、ThemeProvider 和 ThemeGalleryScreen 标记。Gradle Release bundle 时间 2026-09-28 14:47:32，APK 时间 14:47:48；本次在本地 HEAD 4d07c33 与其当前工作区代码上重建。 |
| 最终包冷启动 | 隔离 emulator-5556，API 37 / Android 17，安装最终 p2.9 后 force-stop 并重新启动；Wi-Fi 和移动数据均关闭，pidof 返回 5245，前台为 com.shineword.app/.MainActivity，UI hierarchy 展示 ShineWord 模型设置页，ReactNativeJS 记录 Running "ShineWord"，未见 JS 或 AndroidRuntime 崩溃。证明 APK 不依赖 Metro 启动，不代表完整离线战役、导入或游戏功能已验。原 emulator-5554 未安装/清除数据。 |

本轮对应源码的文件 SHA-256：

| 文件 | SHA-256 |
|---|---|
| mobile/App.tsx | 1691ED8FD284BF84463F58B3B9502B511ED7C4CF61E9BFDD3896546EE0326C5E |
| mobile/src/ui/theme/ThemeContext.tsx | 84AB92A7A62CD334016F31E36B0320BD93B39D081287186F24FF4BAECCD70363 |
| src/application/campaign/session.ts | DF10EC1B882A231E8EFBA20642D9CA085ECF9F1D26164BDD1634B1D9770988A5 |
| src/application/campaign/recruitment.ts | 482A187A12BA1400CAF3E9AACC3E64B7093AC0942B8531FCB65EBA2F9BCEE347 |
| src/application/campaign/encounterFlow.ts | 3E8EF02BFDDFFC7B83CBC688D6B8EDAD16FCCB0C2C2D6E1E220B58530B464C8B |
| src/application/worldPackage/publish.ts | D99CACD0181E56B4B0B1AE06BB12A1437C2973E61EFBD8BED9B7B75C454E8D04 |
| tests/phase2-acceptance.test.cjs | 705B6EB09FBB182BEF7F46C41DD623281D97027C2A6D4C7DCBF18C164B44BC86 |
| mobile/android/app/build.gradle | 718B73CED322280631B9DD9D2B7CFB2E9E797CD188A47371CBE853996036F45E |
| mobile/package.json | BC64B9316D33E90B6568AE89C59A34587A67AC50C9503842CBC67106E361F55F |

## 未结项类型

- 实现缺口：captured/rescued/death_risk/ending 尚未成为由发布世界或遭遇合同驱动的权威状态机；完整 1+2 队伍冒险在 App 中的跨模块编排及一次性奖励/知识/发现 UI 闭环也尚未以同一个端到端样例完成验收。
- 待验收：p2.9 Release 的导入、键盘、完整战斗、休整、训练、发现书页、杀进程恢复、回退与干净库续玩；真实旧库升级、缺依赖提示和存档下一步行动；多题材编译后的发布门禁实际负例。
- 外部条件：至少第二个当前可用模型配置及安全调用条件；三套自创或获准小说及 ≥200 条独立人工关键事实标注；API 24 设备镜像、真机和目标性能设备；可用于 20 万/100 万字端上压测的获准素材。

## 外部依赖、历史失败调查与保护范围

- API 24 系统镜像当前未安装，本机 Android SDK 也没有 sdkmanager；没有连接的真机。新模拟器 p2.9 启动是 API 37 的部分证据，不能替代两者。
- 现有历史模型报告的推理关闭记录不符合已确认政策。本轮没有第二个真实模型配置或可安全调用的凭据，因此没有冒用历史 100 步记录，也没有扩跑真实模型。
- R5 两次小样中 Error/non_provider 是执行器的泛化分类。代码审查确认 OpenAICompatibleProvider 将非超时传输异常原样抛出，HTTP/响应协议失败才包装为普通 Error；目前没有稳定的分类码和保存的脱敏诊断上下文。历史报告未保留原始安全错误类别、请求阶段和响应状态，因此不能从 non_provider 恢复具体根因。后续采集只需保留 Provider 阶段、脱敏错误类、HTTP 状态、attempt 和 requestId，禁止保存 Key、小说正文或原始敏感日志。
- 历史报告 R3/R4/R5 与两轮复现均保留。R5 关于缺少 Release 的描述现由上述 p2.8/p2.9 实测纠正；其它历史成绩仍只属于其各自报告时点。
- dist 下 APK 为本地构建产物，不纳入仓库。没有把密钥、私人小说、存档、签名文件、数据库备份或原始敏感日志加入本轮文档或仓库。
- 提交前工作区快照：已修改跟踪文件包括 README.md、docs/DEVELOPMENT_STATUS.md、mobile/App.tsx、mobile/android/app/build.gradle、mobile/src/ui/components/Header.tsx、mobile/src/ui/screens/ThemeGalleryScreen.tsx、src/application/campaign/encounterFlow.ts、src/application/campaign/session.ts、src/application/worldPackage/publish.ts、tests/phase2-acceptance.test.cjs。未跟踪文件包括本报告、docs/reviews/ui/_p2-probe.png、mobile/src/ui 下的导航、组件、状态和页面文件。既有 Android 构建/签名/脚本及 UI 工作区改动不纳入交付提交；本轮仅提交 README、状态/验收文档、应用层修复与针对性回归。未执行清理或覆盖。dist APK 被 Git ignore。
- 未执行 Git clean、reset、checkout 或覆盖私人数据。本轮经用户授权仅提交上述自有修订，不推送。
