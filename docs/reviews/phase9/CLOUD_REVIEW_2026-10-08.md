# Phase 9 云端接手：R54–R56

第九阶段仍未通过，矩阵保持 **29 PASS / 2 FAIL / 9 NOT RUN**。本批完成源码缺口修复与工程回归；新增真实模型请求、ready 候选、采用和有效玩家决定均为 **0**。没有用工程夹具提高内容评分或补齐旅程配额。

## 接手、资产及预算审计

完整阅读用户指定的交接、施工方案、流程审查、协议、进度、矩阵、旅程、质量和最终报告，接手检出为 `46628ba6168b230651107be55a19bf4f5d352c7d`。修改开始前工作区干净；本批在云端工作分支 `work` 提交，不推送或发布。

云端核实不到小说、原始 `test-manifest.json`、final48 三份数据库/原始响应、私有驱动、设备快照及旧 APK。配置服务报告无 secrets / runtime_variables / outbound_identities，无 VPN 或 TCP 授权目标。本机 AVD 和 QA 代理未迁移。ADB 枚举在创建只读 `/home/agent/.android` 时失败，没有完成设备可用性核验。这些依赖继续阻断真实规划、完整旅程和 Android UI 验收。

| final48 任务 | 交接记录 | 本批云端审计结论 |
|---|---|---|
| J1 `job-setup-world-src-7f45fe0b11ea30ec-muwccd51-muzgdf8h` | cancelled；outcome_unknown / network_unknown | 原库缺失，无法进一步确认响应；未恢复或重发 |
| J2 `job-setup-final48-j2-muzg4v7a` | worker 停止；持久 running/sent | 原库缺失，不能把 sent 当作失败或可重试；未重发 |
| J3 `job-setup-final48-j3-muzgg5xk` | 同 J2 | 同上 |

上述状态来自交接，**不是本批读取数据库得到的新事实**。未知结果不能凭 elapsed time 或迁移环境变成已知失败。原库到位后先只读校验身份、冻结根、attempt 和完整原文；有完整持久响应才尝试本地恢复，无响应的 sent/unknown 不自动派发。

本地忽略目录 `.tmp/phase9/test-manifest.json` 已承接 **spent=1210 / totalPhysicalRequests=1500**，余 **290**。它明确标记为交接计数检查点，未取得历史明细、未完成数据库对账；不伪造 1210 条物理账本，不初始化为 0。本批模型物理请求 0；工程受控 transport 夹具不接真实上游。

初始云端 scope v3 实算源码 hash 为 `2b626890b7ef683e0b7c764554b5492d8267b2794c59aa2e7be8c1ff21432df1`，交接 final48 为 `2ebb79fa93b21f6d07edc1d9993dbdd1043881dc60d1846e37095b3b31a0f8d7`。Git 检出相符、身份输入均为已跟踪文件，但缺少旧逐文件 manifest，尚不能解释字节身份差异。旧 APK/截图/旅程不绑定为云端当前身份，历史 hash 不改写。

## 总体架构与审查边界

| 模块 | 数据所有者及交接 | 本批审查/验证 |
|---|---|---|
| M0 资料建设 | source/canon、付费检查点及 M5 发布档案；模型提案不直接成为事实 | 复核历史 R44/R49/R50/R52 的引用闭合与审查合同，完整源导入/发布回归；真实小说依赖缺失 |
| M1 内容目录/起点 | 发布包、快照绑定的增量/segment、不可变 campaign artifact 合成目录 | 阅读共用 `loadCampaignContentCatalog`；全量目录/权限回归；R56 修复同伴与场景重复实体 |
| M2 意图/请求 | setup/job 持有冻结材料；物理 attempt 持有派发与用量事实 | R54、R55；原档位、可信历史和硬上限保留，unknown 禁重放、两 HTTP 总额回归 |
| M3 候选编译 | 本地四档合同、条件 AST、来源/作用域门；candidate 不证明游戏事件发生 | 完整规划、普通成功必要门及结局顺序回归；不把结构门当六维质量通过 |
| M4 采用 | opening/replan 事务与 CAS；plan/artifact 按修订归档 | 阅读采用与重规划服务；原子采用、幂等、fence、取消和旧归档完整性回归 |
| M5 方法资格/检定 | 当前实际人物、资源、知识和局面；选项与同义输入绑定同一合同 | R56 共用人物解析用于资格、AST、四档效果及运行时结算，保留未知/歧义拒绝 |
| M6 持久提交/归约 | SQLite 原子提交、GameStateSnapshot 与唯一主线 reducer | R56 奖励归属、卡片冷读和后续提交；全量后果、奖励、防重复、期限与归约回归 |
| M7 重规划 | 已提交状态/当前意图冻结，采用时 revalidate/CAS | full-success-only、未知请求、预算恢复、退休阶段和原结果保护回归 |
| M8 UI/存档投影 | UI、guidance、StoryMemory 读取快照/目录；存档承载不可变归档 | 全量 UI 纯投影/目录/存档回归及移动类型检查；实际 Android UI 未复验 |

## 失败复现、根因与修复

**R54 请求身份与成功账本。** 成功响应的 metrics 已有 HTTP 状态，但 `LedgeredProvider` 没有写入 `http_status`；缺少 usage 的响应还被写为 `estimated_usage=0`。Planner/Narrator 复用指纹遗漏实际发送的 `followUpUserMessages`，同一逻辑请求的 route A / route B 或追加消息顺序不同会错误复用旧响应。本地 SQLite/生产 adapter 6 项回归中修复前 4 FAIL / 2 PASS。修复保存实际状态（受控 201 保留为 201），无观测仍为 null；仅明确非估算 usage 标可信；完整、有序追加消息参与指纹。无追加/空列表保持原指纹兼容，重启后完全相同请求零派发，unknown 优先禁重放。提交 `967e101`。

**R55 规划修复的真实发送硬门。** 结构修复追加完整候选后，旧逻辑调用 kernel 计算一个可容纳较小输出的新计划，却忽略其结果，继续发送原较大 `max_tokens`。32K 窗口、含 10000 字完整候选的修复在修复前错误派发第二次并变 ready；另一个回归发现 scheduler 估计遗漏真实追加材料/消息开销。两项失败均有 red 日志。修复复用共用 `estimateFinalWireInput` / `verifyFinalWireRequest`，按实际 wire 额度及冻结 envelope 校验；过量修复在下一次派发前 `final_wire_exceeded`，原文和冻结根保留，再恢复仍零派发。可容纳的完整结构修复保持相同 wire，并准确进入 scheduler 估计。已知 length/reasoning_only 仍必须增长预算，不能增长时零派发。与 R54 同一请求边界批次。

**R56 实际人物归属。** 已选同伴同时出现在起点场景时，`createCampaign` 又创建一个相同模板的 NPC，资格/条件因此变歧义；知识、物品、技能及资源上限奖励使用模板 ID 作为实际 owner，而关系/延迟后果各自另有解析。使用接手提交的独立源码副本、当前合法测试资料及正式采用/Session 路径，两个回归均失败：场景 NPC 收不到自己的知识；同伴产生两个实际人物。没有改写已采用档案或真实数据库。

修复在人物域提供统一解析，显式实际 ID 优先，唯一已实例化模板及其别名映射到同一 owner，歧义/缺失仍不选择任意人物。资格、AST、四档编译、方法 transition、延迟后果及奖励共用边界；开局已选同伴不再次实例化为 NPC。2 项生产 SQLite 回归验证知识/关系/资源上限、人物唯一性、持久卡片及随后本地提交；4 项身份回归验证同伴别名、歧义/未知的三值 NOT、旧 owner 和 `npc-` 开头的完整模板 ID。首次全量回归检出两个旧模板兼容性失败，保留日志，修复完整 ID 优先匹配后完整重跑通过，未删断言。收尾另复现了目录模板未实例化仍能获得知识奖励的问题（`cloud-unbound-owner-red.log`）；现在提交边界要求后果/奖励的实际人物存在，否则明确拒绝并整笔回滚快照和奖励 grant keys，不创建幽灵知识 owner。新增回归首版没有触发阶段奖励，未证明目标边界；补齐明确的奖励触发后，在精确 `46628ba` 源码副本重新取得3项失败，并在最终1159项完整回归确认拒绝及原子回滚。早期失败日志保留。

## 工程证据与当前身份

| 验证 | 结果 / 证据 |
|---|---|
| R54 失败→修复及相关恢复 | `.tmp/phase9/cloud-ledger-red.log`：4 FAIL；`cloud-ledger-green.log`：76/76 |
| R55 失败→修复及规划/重规划 | `cloud-plan-wire-red.log`：2 FAIL；`cloud-plan-wire-green.log`：79/79 |
| R56 接手源码失败复现 | `cloud-owner-baseline-final-red.log`：3/3 失败，独立 baseline 源码编译，不改当前生产文件 |
| R56 跨模块回归 | `cloud-owner-green.log`：82/82 |
| 最终完整核心 | `cloud-core-verified.log`：**1159/1159**，0 失败、0 跳过，71.772 秒 |
| 移动类型/版本 | `cloud-mobile-boundary-final.log`、`cloud-version.log`：通过；版本仍 1.0.0 / 1000000 |
| 本批生产源码 | scope v3：`f944401b654dd5f67ec4dc4ec36442c575dec03e5aada3d383bbe6190c4b638d` |
| Debug APK | `cloud-boundary-apk.log`：BUILD SUCCESSFUL，2分6秒；SHA-256 `2d766055e684fd8d3aab7eda4981e54a08b1ee3b275e2344f483a08634fd2f0f`，109780223 bytes；`cloud-apk-badging.log` / `cloud-apk-signature.log`：包名 com.shineword.app、1.0.0/1000000、v2签名通过 |

耗时受云端并行构建/CPU 影响，不与原机耗时拼接，不宣称性能提升。源/账本/合同/存档协议版本未变；新增解析函数和账本元数据不修改历史记录。原始小说、凭据、数据库、APK、截图及完整身份 manifest 继续放忽略目录。当前 APK 在 `dist/apk/debug/ShineWord-V1.0.0-debug.apk`，包含6110676 bytes的离线 JS bundle，无重复ZIP路径；`.tmp/phase9/cloud-identity-verified.json` 与 `cloud-apk-proof.json`记录逐文件及APK身份，构建前后生产源码hash一致。该APK未安装到实际目标，端上复验依旧未完成。

环境复用：已通过安装工具链、完整核心/移动检查、实际 Metro Android bundle 及 Debug 组装；早期 React Native AAR 地址403在本批重新核实为200并完成构建。安装脚本已有保存，本批更新完整 `start_skill` 草稿，保存确认 `requires_publish=true`。草稿保存不等于应用/发布；跨任务复用需在环境设置审阅保存并发布，新任务恢复及本地未推送提交的恢复尚未验证。

## 未完成与下一步

最终同身份 J1/J2/J3 仍各 **0/20**；J4 两路线各 **0/10**；Android J1 **0/20**、J4 一路线 **0/10**。A15、A36 保持 FAIL；A02/A03/A06/A10/A12/A19/A26/A37/A38 保持 NOT RUN，当前执行外部依赖另列，不能把历史 FAIL 隐藏为环境阻断。三份自动计划及各自旅程的最终六维评分没有新增样本，旧诊断分数不提升。

仍需恢复可读原资产和原设备/真实模型访问，先对账 1210 检查点、原始 manifests、未知 attempts、冻结档位和 API 结果；禁止自动重发已发送的未知请求。然后以本批稳定源码/对应 APK 重新绑定证据，通过正式规划、采用与正常随机检定推进三意图，按实际新事实审查有效决定；完成同快照双路线、两个间隔至少两次有效决定的持续后果、原著角色/换起点、后段按需建设采用、成功救援后持续存活和模板外能力组合，最后补同模型/档位/设备/资料范围 10+10 性能对照及端上复验。
