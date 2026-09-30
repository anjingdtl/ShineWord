# V0.4.1 Final Governance Hotfix

日期：2026-09-30。最新 `origin/main` / HEAD 施工基线：`7d23bb9f2ad7057699fe1b45675db1115c12b0f3`。分支：`fix/v0.4.1-final-governance-hotfix`。

保持 V0.4.1 / versionCode 40100。本轮是该版本的源码修正，不创建 tag 或 GitHub Release；现有版本规范没有要求每个源码 commit 自动升版本。已有用户改动与未跟踪资料保留，未纳入提交。

[PR #8](https://github.com/anjingdtl/ShineWord/pull/8) 经两项 CI 通过后合并 main，合并 commit 为 `72e6fd1726d2cf23a1b751a80e2002fea5369e49`。通过 PR CI 的 HEAD 为 `2f0581e7741bdfb55284e2185008c808e1c0e0e8`，与合并 commit 文件树一致；后续验收记录提交只修改本文。

## 三项修正

1. **DeepSeek 预设：UNIT VERIFIED / LIVE NOT TESTED。** 展示名保持 `DeepSeek V4.1 Flash（1M）`，wire model 改为 `deepseek-flash`，contextWindow 为 1,048,576，maxOutputTokens 为 393,216，reasoningDialect 显式为 `deepseek`，默认产品 tier 为 `low`。2026-09-30 核对的依据：[官方模型列表](https://api-docs.deepseek.com/api/list-models/)、[官方模型规格](https://api-docs.deepseek.com/quick_start/pricing/)、[官方 Chat Completions 协议](https://api-docs.deepseek.com/api/create-chat-completion/)。Low / High / Max 继续发送 `thinking.type=enabled` 与相同 `reasoning_effort`；`max_tokens` 直接使用 Kernel wire budget。
2. **预算预览：PASS。** `ProfileFormCard` 调用共享 `previewLlmRequestBudget()`，由 Capability Resolver → `planLlmRequest()` → Reasoning Policy 生成结果。UI 只解析输入、格式化与展示，不再复制 reserve/output/safety/input 公式；选中预设时能力与保存后的 Profile 一致。`PREVIEW_MANDATORY_INPUT_ESTIMATE=0` 明确表示设置页估算，不代表某个真实回合。Unknown context/output 不生成精确预算；32K context / 4K output / Max 明确不可行；unsupported dialect 明确失败。
3. **凭证证据：PASS。** R6 JSON 与生成 Harness 只保存 `credential: { loaded: true|false }`。移除凭证文件名、SHA256 和大小，不保存密钥、绝对路径、长度或片段。两部小说的 SHA/大小和其余真实 GLM 档位、reserve、wire tokens、HTTP、usage、duration、context IDs 均与基线逐字段一致。Harness 提供 fake-file fixture 入口，作为模块导入不会启动 live gates。

仓库已有 `deepseek-v4-flash` 网关 smoke 记录（`UNIFIED_BUILD_FIVE_PHASE_REVIEW.md`），并非本轮修正后官方 ID / 三档协议的真实验收。本轮未读取实际凭证、未调用真实 GLM/DeepSeek，未重跑两部小说。旧已保存的自定义 endpoint/model 不自动改写；使用旧错误预设字符串的 Profile 需重新选择预设或自行填写 Model。

## 验证与 Review

| Gate | 结果 |
|---|---|
| DeepSeek preset + serialized Low/High/Max requests | UNIT VERIFIED；fake transport，无网络 |
| Planner preview vs production Kernel | PASS：32K / 64K / 128K / 200K / 1M × Low / High / Max；每组覆盖 DeepSeek/GLM/generic 及 mandatory 0/600，共 90 个比较 |
| Unknown、能力不足、clamp、unsupported、maximum vs target | PASS |
| Credential fake-file artifact + failure fixture + historical corpus preservation | PASS |
| `npm run verify:core` | PASS：469/469，0 skipped |
| `npm run typecheck` | PASS |
| `npm run typecheck --prefix mobile` | PASS |
| `npm run verify:version` | PASS：0.4.1 / 40100 |
| `git diff --check` | PASS |
| `npm run apk:debug --prefix mobile` | PASS：`dist/apk/debug/ShineWord-V0.4.1-debug.apk`；只构建，未安装 |
| CI Core Verify | PASS：[PR run 36694170632](https://github.com/anjingdtl/ShineWord/actions/runs/36694170632) |
| CI Android Verify | PASS：[PR run 36694170733](https://github.com/anjingdtl/ShineWord/actions/runs/36694170733)，含 mobile typecheck 与 Debug APK |
| Self Review | PASS：无 P0/P1 |

只读复查 `reasoningPolicy.ts`、`requestBudgetKernel.ts`、`openAICompatible.ts`、`worldBuild/llmRequest.ts`：本轮未修改这些生产决策入口；没有新增 off、档位降级、thinking disable、重复计算 reasoning 或虚构能力默认值。Planner 与预览使用相同 output demand，实际回合仍由 Kernel 纳入自己的 mandatory input。

全仓跟踪源码搜索并逐类复查：`GLM-TEST-KEY`、`credentialFile`、`reasoningEffort`、`thinkingDisabled`、`128000` / `128_000`、`maxOutputTokens: 1600`、`indexOf('{')` / `lastIndexOf('}')`、DeepSeek / `reasoning_effort` / `thinking`。保留合法旧字段迁移、仅测试/低层接口使用的旧预算常量、历史文档、JSON wrapper 处理与 redacted wire 参数证据；其他 real-glm Harness 不计算凭证文件指纹。旧文档中的网关参数结论不作为本轮官方预设依据。

## 边界

DeepSeek live API、Android 设备 UI / 实际回合均为 **NOT TESTED**。本轮启动模拟器 / 使用 ADB：**NO**。未安装 APK、未做 force-stop、Release signing 或真实小说游戏。设备端由用户后续验证；P95 runtime feedback、玩法、Memory 和 Context 算法未扩展。
