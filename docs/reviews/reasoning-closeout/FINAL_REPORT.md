# V0.4.1 Reasoning & LLM Governance Closeout — Final Acceptance

日期：2026-09-30
基线：`origin/main` / `77cdc9dd42b84dc23b3b8047b90b41590487f3ca`
工作分支：`feature/reasoning-governance-closeout`
版本：V0.4.1 / versionCode 40100
PR：[#7](https://github.com/anjingdtl/ShineWord/pull/7)，已于 2026-09-30T08:26:56Z 随 `main` 快进推送自动合并

## 结论

Reasoning tier 已成为 Profile、冻结请求、Provider 参数、Reasoning Reserve、输出预算、弹性 Context、Play、Memory、World Build 和 Request Ledger 的共享输入。按 request kind 使用独立 Reserve；对同一请求，未触发能力 clamp 时 Low < High < Max，Hard Input 反向递减。Provider 与预算使用同一份冻结策略。Reasoning-only 有界恢复保留原档位，不关闭 Thinking。

本轮交付达到 V0.4.1 工程收尾目标。真实 GLM 三档及短篇回合链路已验证。DeepSeek 真实 API 和 Android 设备端真实 LLM 因没有相应安全测试条件，分别标为 NOT TESTED / BLOCKED，不作通过声明。自动 P95 Reserve 回灌仍是后续可选增强；当前已记录 usage、保留缺失值为 Unknown，并提供分组统计和策略校准接口。

## 验收矩阵

| 项目 | 状态 | 证据与边界 |
|---|---|---|
| Reasoning UI | PASS | Profile / 首次配置提供 Low / High / Max；Planner Reserve 预览；44dp 分段控件；深浅主题检查。 |
| Low tier | PASS | Profile 到冻结请求、GLM 参数、预算、Provider 请求的确定性与真实 GLM 验证。 |
| High tier | PASS | Profile 到冻结请求、GLM 参数、预算、Provider 请求的确定性与真实 GLM 验证。 |
| Max tier | PASS | Profile 到冻结请求、GLM 参数、预算、Provider 请求的确定性与真实 GLM 验证；无自动降档。 |
| GLM mapping | PASS | Low / High / Max 发出对应 `reasoning_effort`；保持 `thinking.clear_thinking=false`。 |
| DeepSeek mapping | PARTIAL | 官方 Chat Completions 参数形状与三档单测通过；真实 DeepSeek API NOT TESTED。 |
| Generic mapping | PASS | Generic 三档映射、明确 `unsupported` 和 HTTP 400 参数拒绝错误分类均有单测。 |
| Elastic tier coupling | PASS | 32K / 64K / 128K / 200K / 1M 窗口矩阵、clamp、不可行错误、Hard Input 单次扣 reserve 均有单测。 |
| Planner | PASS | 冻结 tier、reserve、wire output、context ID 与 Provider tier 对齐；真实 GLM 三档调用成功。 |
| Narrator | PASS | 同一冻结 tier 独立 Narrator reserve / business output；真实短篇回合参数验证通过。 |
| Story Memory | PASS | checkpoint / repair 共用 Kernel、structured JSON、tier 与 Ledger；Max batch shrink；1600-token 固定主路径已删除。 |
| World Build | PASS | FrozenRunConfig、per-kind Reserve、Provider、拆分恢复、结构化解析及抽取/映射/Registry/Timeline Ledger 均有覆盖。 |
| JSON Resilience global | PASS | Extract / Group / Registry / Timeline / mapping 使用共享结构化解析；本地引文和章节证据验证仍执行。 |
| Request Ledger global | PASS | Play、Memory、World Build、progressive opening 请求记录冻结 tier、Reserve 和 usage；稳定逻辑 ID 下有界重试递增 attempt。 |
| Custom capability unknown | PASS | 自定义档案空能力保持 Unknown；Play 使用显式 legacy context fallback，要求精确能力的 World Build fail closed。 |
| Legacy `off` migration | PASS | Profile 与历史 run config 读取时归一为 Low，保留 endpoint / model / keyRef / 已声明能力；新 Profile / Run 不写 `off`。 |
| GLM real Low | PASS | Planner 实际请求 `reasoning_effort=low` 且 HTTP 200。 |
| GLM real High | PASS | Planner 实际请求 `reasoning_effort=high` 且 HTTP 200。 |
| GLM real Max | PASS | Planner 实际请求 `reasoning_effort=max` 且 HTTP 200。 |
| Android settings | PASS | Debug AVD 设置页 Low / High / Max、预算预览、触控与主题已实测；Release 候选设置亦已检查。 |
| Android persistence | PASS | Debug QA 包选择 Max 后 force-stop / cold launch，Max 预览仍为 24K；V0.4.1 Release 以 `install -r` 更新并冷启。 |
| Android real LLM | BLOCKED | 为避免 ADB 明文键输入，本轮未把 GLM key 导入设备，也未从 Android 发真实 LLM 请求。 |
| Release | PASS | V0.4.1 APK 单一预期证书、V2 签名、4 字节对齐、包名/版本码检查；ShineQA 安装和冷启动通过。未创建 tag / GitHub Release。 |
| CI Core | PASS | 代码/版本 commit `9da1959`：run `36687226389`。 |
| CI Android | PASS | 代码/版本 commit `9da1959`：run `36687226621`，包含 mobile typecheck 和 Debug APK。 |

## 必答问题

1. **用户是否可以选择 Low / High / Max？** 可以。设置页和首次配置使用同一产品类型及分段控件。
2. **Profile 是否还会产生 `off`？** 不会。`off` 仅作为历史兼容输入，不可作为新保存值。
3. **Legacy `off` 如何迁移？** Profile migration 与旧 Frozen Run Config 读取边界将其归一为 Low，并保留 endpoint、model、keyRef 与有效能力数据；Keychain key 不迁移、不重输。
4. **Planner 是否真正把 tier 发给 Provider？** 是。Context build 冻结 tier/reserve；同一请求计划给 Planner Provider 参数。真实 GLM Low / High / Max 捕获值吻合。
5. **Narrator 是否真正发？** 是。显式发送同一冻结 tier；使用 Narrator 自己的 request kind、Reserve 和正文输出预算。
6. **Story Memory 是否真正发？** 是。Checkpoint、repair 和 summarizer 显式发送冻结 tier，并经过 Budget Kernel、结构化输出和 Ledger。
7. **World Build 是否冻结 tier？** 是。`run-config-2` 冻结 `reasoningTier` 与版本化 Reserve map；Profile 后续改变只影响新 Run。
8. **Low / High / Max 是否产生不同 Reserve？** 是。冷启动值按 request kind 分别定义，且同模型同 request kind 下保持 Low < High < Max，能力 clamp 另记 effective reserve / tier。
9. **Context Hard Limit 是否因此变化？** 是。`Hard Input = Context Window - Business Output - Reasoning Reserve - Safety`；reserve 计入 wire output 后仅扣一次。
10. **是否有 reasoning reserve double-count？** 已覆盖单扣公式与 wire ceiling 单测，当前计划路径不重复扣减。
11. **reasoning_only 后是否保持用户 tier？** 是。应用层有界恢复保持原 tier，增加 reserve 并缩小 optional context；World Build 可按既有规则拆分。能力不足时停止，不降档、不关闭 Thinking。
12. **Memory 是否还固定 1600？** 不再有 `maxOutputTokens: 1600` 主路径。每次 Memory 输出受统一 Kernel 管理，批次不适配时缩小完整 turn batch。
13. **World Extract 是否还使用 indexOf/lastIndexOf JSON？** 不使用。Extract 与 Group 共用 `parseStructuredOutput()`；evidence quote 仍在本地验证。
14. **World Build 是否进入 Ledger？** 是。抽取、Group、mapping、registry、timeline 和渐进式开篇均经过 LedgeredProvider；retry 使用稳定 logicalRequestId 与递增 attempt。
15. **Custom 模型是否还静默假设 128K？** 不会。旧自定义 Default 的合成 128K / 8192 哨兵仅在 migration 清除；用户可留空或明确填写。
16. **Unknown capability 是否诚实保持 Unknown？** 是。存储不补默认值；精确弹性预算请求在缺少 Context 能力时使用清楚标注的 Play legacy fallback 或由 World Build fail closed。
17. **GLM Low / High / Max 是否真实验证？** 是。三档独立 Planner 请求都 HTTP 200；脱敏 transport capture 记录真实参数、reserve、max_tokens 与 usage。真实 usage 不要求单调。
18. **DeepSeek 是否真实验证？** 未验证。单测通过，真实 API 标记 **NOT TESTED**，因为本轮没有 DeepSeek key。
19. **设置改变是否只作用于新请求？** 是。Play Turn 和 World Build Run 各自冻结配置；Profile 修改用于之后发起的新请求 / 新 Run。
20. **正在运行的 World Build 是否会中途改变？** 不会。Coordinator 使用已持久化 FrozenRunConfig；Run 启动后的 Profile 变化不改当前 tier。

## 预算、usage 与恢复策略

Planner / Narrator / Memory / World Extract / World Mapping / World Adjudication / Summarizer 使用同一 policy 的不同冷启动 Reserve。典型 Planner Reserve 为 2,048 / 8,192 / 24,576；GLM 1M Context 实测对应 Hard Input 为 1,034,336 / 1,028,192 / 1,011,808。该表是初始预算策略，不是模型能力声明。

Ledger 按 profile fingerprint、tier、request kind 存储 provider-reported reasoning token count。未提供 usage 的物理尝试存为 NULL，不写成 0。滚动样本统计计算 P50 / P90 / P95 / max；至少 8 个已知样本后，policy 接受 `max(coldStartMinimum, ceil(P95 × 1.25))` 建议值。当前调用方尚未自动从历史 Ledger 样本读取并回灌 policy，因此 **usage 采集与校准接口已交付，运行时动态 Reserve 自动校准为 PARTIAL / 后续增强**；当前 Reserve 仍用冷启动表。

## 本地与远端门禁

| 检查 | 结果 |
|---|---|
| `npm run verify:core` | PASS，441/441 |
| `npm run typecheck` | PASS |
| `npm run typecheck --prefix mobile` | PASS |
| `npm run verify:version` | PASS，0.4.1 / 40100 |
| `git diff --check` | PASS（仅 Windows LF/CRLF 工作副本提示） |
| `npm run apk:debug --prefix mobile` | PASS，V0.4.1 Debug APK 构建成功，91.76 MB |
| Release JS bundle / Release APK | PASS；`createBundleReleaseJsAndAssets --rerun-tasks` 后 `assembleRelease` 与仓库校验脚本通过 |
| GitHub Core Verify | PASS，`main` 提交 `08e2428` run `36689762279` |
| GitHub Android Verify | PASS，`main` 提交 `08e2428` run `36689762299` |

CI 的既有工具链弃用提示不是失败：GitHub runner 提醒 Actions Node 20 迁移和 `setup-java@v4` 弃用。

## 最终 Release APK 与单模拟器验收

- 文件：`dist/apk/release/ShineWord-V0.4.1-release.apk`
- Package：`com.shineword.app`；versionName `0.4.1`；versionCode `40100`。
- 大小：47,328,370 bytes；SHA-256：`6E463DE8CCC89C4DF52C79E43BEB888CD7E1BB66C781DDC1030F4EBF38D5E828`。
- 签名验证：预期公开证书 SHA-256 `017b3fbed4001083f2f70a0c51e8e463322df66b095e1c3a476fdd0d86dc2a0a`，单 signer，APK Signature Scheme v2，4 字节对齐。
- AVD：Release 验证只运行 `ShineQA`。`adb install -r` 成功；`am start -W` 返回 `LaunchState: COLD`；主 Activity resumed；干净启动日志没有应用 crash marker。验证后 AVD 已关闭，设备列表为空。
- Debug 与 Release AVD 按顺序使用，未并行运行；设备测试没有导入或输入任何 API key。

## 源码搜索命中分类

- `reasoningEffort` / `'off'`：保留在 legacy parser、Profile / run config 迁移边界、`timelinePass` / `bookRegistry` / Group Extractor 兼容输入、Provider 历史字段桥接及历史 fixture。World Build govern 边界将旧输入归一成 ReasoningTier 并移除 deprecated 字段；正常新 Profile / 新 Run / Provider 请求不会输出 `off`。`reasoningReserveTokens` 是冻结预算与 Ledger 的必要字段，不是遗留档位。
- `thinkingDisabled`：只在 `types.ts` 的 obsolete 可选兼容类型字段和相关测试 / 历史说明中出现；Provider 不发送关闭 Thinking 参数，reasoning-only / length / JSON 失败也不会关闭 Thinking。
- `maxOutputTokens: 1600`：活动源码无命中；R0 基线文档保留此值仅为记录旧缺口。当前 Memory checkpoint / repair / summarizer 均规划业务输出预算。
- `indexOf('{')` / `lastIndexOf('}')`：World Extract、Group、Registry、Timeline、mapping 活动解析路径无命中；统一走结构化输出 parser。
- `128_000` / `128000`：活动源码只保留自定义旧 Default 哨兵迁移检测，以及 legacy direct World Build coordinator 的具名 `DEFAULT_MODEL_BUDGET` / 测试 fixture。新自定义 Profile 不会在未知时写入 128K。预设或测试里的显式能力值是具名已知输入。
- `8192`：冷启动 High Reserve 和 Safety margin cap 属于明确预算策略；TXT 码点 / SHA 字节 chunk 大小属于分块参数。旧 generic probe / named test fixture 的固定输出限制不是 Profile 默认能力；没有通用自定义 `maxOutputTokens=8192` 假设。

## 缺项与风险边界

- DeepSeek live API：NOT TESTED；仅官方 dialect 映射和确定性请求单测通过。
- Android real LLM：BLOCKED / NOT TESTED；设备真实 Key 注入没有安全实现，本轮不通过 ADB 明文输入 Key。
- Runtime P95 feedback：PARTIAL；Ledger 记录与 stats / policy 接口可用，运行时自动读取并调整 Reserve 尚未接线。
- Release artifact 已本地签名校验并在 `ShineQA` 验证安装冷启；本轮没有创建 Git tag / GitHub Release，也没有合并 PR。
- 本轮未发现待修复 P0/P1。行为质量结论限于自动化门禁、参数路由和内容证据校验；《白篱梦》测试意图的动作等级记录为 failure，不据此宣称玩法结果质量通过。

## 交付文档

- [R0 基线](R0_BASELINE.md)
- [R1 Reasoning Domain Model](R1_REASONING_MODEL.md)
- [R2 Profile UI](R2_PROFILE_UI.md)
- [R3 Budget Coupling](R3_BUDGET_COUPLING.md)
- [R4 Play / Memory](R4_PLAY_MEMORY.md)
- [R5 World Build](R5_WORLD_BUILD.md)
- [R6 Real Regression](R6_REAL_REGRESSION.md)
- [脱敏 GLM metrics](R6_REAL_GLM_METRICS.json)
