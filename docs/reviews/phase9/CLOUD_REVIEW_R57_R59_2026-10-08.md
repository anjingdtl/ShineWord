# Phase 9 云端续作：R57–R59

**当前输入更新（2026-10-09 UTC）**：用户已提供真实小说及 GLM 端点/型号/凭据。小说 SHA 与交接一致，生产导入与完整冷读通过（1504章节记录、3260块、106分片）；模型域名被云代理 CONNECT 403 拒绝，配置草稿已保存但未应用。新增模型请求/有效决定0，预算1210/1500；原final48库/响应/校准反馈与设备仍缺，未知请求未重发。整体验收仍29 PASS / 2 FAIL / 9 NOT RUN。详见[当前资产与访问证据](CLOUD_INPUTS_2026-10-09.md)。下文保留各历史检查点的资产状态和身份。

第九阶段仍未通过，A01–A40 保持 **29 PASS / 2 FAIL / 9 NOT RUN**。本批接续 `1ec4f52` 的源码修复，完整核心 **1167/1167**、移动类型与版本检查、独立 Debug APK 均通过；这些是工程证据，真实旅程、最终质量评分及 Android UI 配额没有增加。

## 复现与共用边界修复

| 缺口 | 生产失败与根因 | 修复和相关验证 |
|---|---|---|
| R57 采用只登记、未兑现 | 开局已满足阶段的奖励被加入 grant keys，却没有应用奖励；重规划纯归约把 pending 后果标为 triggered，没有应用其效果，后续 Session 因已触发而永远跳过；采用传空 history，已提交事件无法满足条件 | 从 Session 抽取 `settleCampaignProgress`，开局、重规划及行动共用；预加载同一有界事件历史；准备状态、人物后果、奖励、因果事件与归档一并原子提交。未实例化 owner 明确拒绝，准备草稿和奖励键不落库，ready 候选仍保留，不重新付费 |
| R58 中间状态选中错误结局 | 正常行动把阶段完成后、人物后果兑现前的状态用于结局；后果改变关系后仍留“平安离开”，与最终快照不一致 | reducer 保持唯一主线权威。结算先执行 progress-only pass，再兑现后果及奖励，最后 ending-only pass；最后一遍不能登记额外未应用奖励或后果。未重新开启历史已结束战役；只在真实最终条件成立时提交一个结局事件 |
| R59 命运和重规划人物不一致 | 资格/AST 已解析同伴，但重规划仅查实际 ID/npc 前缀，漏掉已死亡的自定义同伴；canon fate 解析漏掉模板别名，模板歧义时选择第一张卡片 | 重规划、canon fate 接入共用人物解析：实际 ID 优先、唯一模板/别名映射、歧义和未实例化不猜人；因果状态与 actor fate 共用投影方法，采用和后果结算不再丢弃返回的 actorFates |

正式开局现在保存版本 0 的 `manage-adoption` 管理记录，给采用、初始归约及奖励事件提供持久 turn owner；不推进时间，不新增玩家决定。SQL 人物卡、技能、关系、物品与知识从最终准备快照写入，避免初始局部数组盖回已兑现的奖励。唯一受此影响的旧“两个普通成功决定”回归改为排除明确的管理记录，仍逐一检查两次真实行动的 success、阶段和一次奖励，未放宽断言。

在精确 `1ec4f52fa49a933989f73444cdf4a35104957fad` 源码副本编译，使用当前合法工程夹具经本地编译、正式采用、Session 和 SQLite 提交复现：12 个相关测试 **8 FAIL / 4 PASS**。该副本在忽略目录，不改当前生产树、已采用档案或真实数据库。R57 的四个失败分别证明开局奖励丢失、采用后果效果丢失、历史事件丢失和未实例化奖励错误采用；R58 一项证明错误结局；R59 三项证明同伴/别名/歧义的命运边界。修复后相关回归 **81/81**，最终全量 **1167/1167**。两次后续工程行动验证后果/奖励不重复；这不计为“间隔两次有意义决定”的真实验收。

## 验证与当前身份

| 验证 | 证据 |
|---|---|
| 精确上批源码失败复现 | `.tmp/phase9/cloud-adoption-baseline-red.log`：12 项，8 失败；源码基线 `1ec4f52` |
| 初次采用/结局/人物失败 | `cloud-adoption-red.log`：3 失败；`cloud-ending-order-red.log`：错误结局；`cloud-fate-owner-red.log`：3 失败 |
| 采用与人物相关回归 | `cloud-adoption-fate-related.log`：81/81，0 跳过 |
| 最终完整核心 | `cloud-core-adoption-final.log`：1167/1167，0 失败/0 跳过，103.441 秒 |
| 移动类型与版本 | `cloud-mobile-adoption-final.log` / `cloud-version-adoption-final.log`：通过，1.0.0 / 1000000，build 0 |
| 独立 Debug APK | `cloud-adoption-apk.log`：BUILD SUCCESSFUL，1分59秒；实际重新执行 JS/Hermes bundle；aapt 包名/版本及 apksigner v2 通过 |
| 生产源码 | scope v3：`923400d6c4105196badab0c3aa7a2c5e7a2999641b64106c68346bf4f7bcf64c` |
| APK | `97dd794d2935f486aff762bc62344de18ebecab6ba1bfc7df2df2d80c8c3a098`，109783035 bytes；`dist/apk/debug/ShineWord-V1.0.0-debug.apk` |

`cloud-adoption-identity-before-apk.json` / `cloud-adoption-identity-verified.json` / `cloud-adoption-apk-proof.json` 保存逐文件 hash、APK 与 bundle 身份；构建前后生产源码一致。离线 bundle 为 6113488 bytes，ZIP 无重复条目。上批 R56 APK 另存 `cloud-R56-debug.apk`，没有把旧旅程/截图或该 APK 配额移到新身份。版本、协议和硬验收门槛不变，旧账本、冻结档案和已采用修订未改写。

本批提交在工作分支 `work`，未推送或发布。完整源码和测试是可审查产物；私有资产、构建产物及原始 manifest 留在忽略目录。耗时受云端并发构建影响，不作为10+10性能对照或性能提升结论。

## 资产与真实验收边界

按 Android Emulator QA 技能复核：权限更新后 adb daemon 已成功启动，`adb devices -l` 完成但列出 **0 个设备**；没有 AVD、system image、emulator 或 `/dev/kvm`。此前“adb 无法创建只读目录”的结论属于旧环境状态，不再作为当前阻断原因。APK 尚未安装，端上方法、采用和冷恢复复验尚未完成，Android J1 UI20 / J4 一分支 UI10 仍为 0。

配置服务当前观测 running / connected，无 secrets、runtime_variables、outbound_identities 或可用 VPN/TCP 目标。原小说、final48 SQLite、原始响应/身份 manifest、私有驱动和原机设备快照仍缺失。因此未真实执行自动规划、采用或旅程；工程受控 provider/RNG 夹具不接上游，不当作真实模型或玩法通过。

共享预算继续 **1210/1500，余290**，新增真实物理请求 **0**。本地 carry-forward manifest 只是交接计数，历史 attempts 缺失，尚未完成数据库对账。J1 cancelled/outcome_unknown；J2/J3 原库 running/sent 状态仅来自原交接，未自动重发、未据进程停止改成可重试。

最终同身份 J1/J2/J3 各 **0/20**；J4 同稳定快照 A/B 各 **0/10**；A15/A36 仍 FAIL，其余9项 NOT RUN。两个隔至少两次有效决定的持久后果、三份自动计划及对应旅程六维各≥3、原著角色/换起点、后段按需建设采用、救援后持续存活、模板外能力组合、同模型/档位/设备/资料范围10+10性能对照仍待真实证据，未提高任何分数。

下一步：原资产和真实访问到位后，先只读审计旧未知 attempts、冻结根/完整响应和1210消耗，再在本批稳定源码/APK身份上继续正式规划、采用、正常检定和实际新事实计数。已有完整持久响应仅做本地恢复；未知已发送请求不得自动派发。完成上述旅程、质量和设备验证前，第九阶段不能宣布完成。

云环境安装/start_skill 草稿已保存；本批刷新已验证结果与 adb 当前状态。保存草稿不等于应用或发布，复用需在环境设置审阅保存并 Publish；新任务恢复及未推送本地提交的恢复尚未验证。
