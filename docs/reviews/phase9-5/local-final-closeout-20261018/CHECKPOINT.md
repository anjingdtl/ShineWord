# Checkpoint

更新时间：2026-10-18（Asia/Shanghai）

## 当前状态

- M0：PASS-ENGINEERING。重新 fetch 后 origin/main 与开始施工时一致；原 main、其他 worktree 和 ignored 历史账本均保留。
- M1：PASS-DEVICE（限定范围）。本地依赖、Core、版本、mobile typecheck、Debug APK 与专用 API37 AVD 基础旅程通过。
- M2：PARTIAL。真实 GBK 小说 SAF 导入、0–9,600 code-point 有界样本、4 次真实 GLM 成功及 partial world package ready；L1 与完整开局未通过。
- M3：PARTIAL / BLOCKED-PLAYER。开局身份页已打开，更新 GLM 配置后的 opening_goal 自动建议请求 HTTP 200；没有替玩家填写角色或提交任何 action，campaigns=0、turns=0。
- M4：PARTIAL / BLOCKED-ASSET。localhost 429 与 network_unknown 现场保留且未重派；缺少合法 save-10、Stage-1/8 历史资产，live gameplay crash 矩阵未完成。
- M5：PARTIAL。有限的 build latency、设备 PSS/gfx、软键盘与 1.3 字号检查；TalkBack、匹配 10+10 和独立试玩未完成。
- M6：PASS-ENGINEERING；设备回归 PARTIAL。Structured opening evidence recovery RED→GREEN、Core 1,344/1,344、当前 APK 安装复测通过；设备复测未观察到新 extension request。
- M7：PR #15 已承载收束实现和本次模型回归证据；原最终代码 HEAD `f62ae30` 的 Core/Android CI 均通过。本次新增的文档/截图提交须按最新 PR HEAD 查看 [live checks](https://github.com/anjingdtl/ShineWord/pull/15/checks)。

## Git

- 施工前与再次 fetch 后的实际 origin/main：`87eef899281f267a17e02357cc643dd475cabd7c`。
- 施工分支：`fix/phase95-local-final-closeout-20261018-short`。
- 当前 checkout：`F:\sw95local-20261018`；使用专用短路径 worktree 构建 Android，未修改原 checkout。
- 最新节点提交：M7 `df6371b`；报告和矩阵已提交，最终 SHA 以 PR HEAD 为准。
- PR #15：https://github.com/anjingdtl/ShineWord/pull/15；未合并，exact-head checks：https://github.com/anjingdtl/ShineWord/pull/15/checks。

## 实际模型请求

- 用户后来明确授权不限 GLM 请求次数/金额；实际执行并发峰值为 1。
- GLM 成功 3 次：world_extract 2 次、style_analyzer 1 次；累计 input 9,569、output 6,201、reasoning 20 tokens。
- opening_goal 1 次 HTTP 401，usage/provider request ID 均无；此项为明确失败，不是 outcome_unknown。
- 配置更新后新发起 opening_goal 1 次 HTTP 200，185 input / 39 output / 0 reasoning tokens，用时 6.11 s。当前 4 次成功请求累计 input 9,754、output 6,240、reasoning 20 tokens；无新的 unknown。
- 人民币实际费用未知；用户在模拟器安全更新并测通配置。配置更新前的 401 保持历史失败记录，没有重派，也未在聊天中要求或输出密钥。
- 本地 mock 项目的 HTTP 429 和 network_unknown 不属于 GLM；unknown 保留 needs_review，从未重派或清账。

## 最终阻滞

- GLM 凭据已由用户在模拟器测通，真实 opening_goal 已 HTTP 200；配置更新前的 401 保持历史记录。当前仍等待真人身份/姓名/开局意图与行动决定。
- 必须由真人选择角色/目标并完成真实行动；执行者没有代选。当前 0/80 真实决定、0/4 独立试玩。
- L1 method 资格尚未确证；世界仅覆盖 0–9,600 code points 的 partial package。
- save-10、Stage-1/8 合法历史资产缺失；历史因果/迁移验收 BLOCKED-ASSET。
- exact-head PR Core Verify / Android Verify 由 PR #15 checks 跟踪；需核对运行 SHA 与最终 PR HEAD。
