# P6-4 迁移、故障、恢复与兼容审查

基于 P6-3 a71beb4，集中审查下述故障路径，在同一数据所有者/执行链内修复。

| 发现 | 修复 | 证据 |
|---|---|---|
| 普通回合 Planner 发送期间可能被采用同版本内容 | 既有 interaction journal 的 play_turn guard；冷启动对已提交 turn 的遗留 running journal 先对账 | phase6-campaign-style：发送内采用 pending，提交后恢复不重复历史 |
| 后续已采用人物模板未形成实际 NPC | 新玩家动作边界通过既有本地提交协议创建卡与状态；后台发布和采用不改人物 | 采用后无 NPC，下一动作只创建一次；stateVersion/fence 保留 |
| 前部地点值的字符串或单层谓词包装被当成空值 | 闭合字段适配，保留 quote；空值绝不从整句猜地点；旧完成响应只在 bootstrap 范围、hash、精确 quote 和事务 fence 下本地重放 | opening-policy/incremental：scalar/nested、零 provider、本地修复幂等与 fencing rollback |
| 当前人物身份可能被投影到更早开局时点 | 本地开局冻结该批最新已验证事件下限，UI/createCampaign 拒绝更早锚点，归档保留并校验有限数值 | createCampaign/session/archive runtime guard |
| 后台已采用内容可能泄露未发现原著知识 | 新增量原著内容设 discoverable，按已有发现/时间投影；证据与规则 provenance 分开 | 权限投影/负例回归；后续发现入口继续审查 |
| 回退或推进后旧需求持续占据缓冲 | M3 释放过期分支引用；其他分支和已发布成果保留；实际取消交既有 host/fencing | segments：共享 sent 需求、回退、全引用释放 |
| 切 API 改写 frozen run 而 intent 指纹仍旧 | 新段任务切 API 创建新 config/intent/run，旧运行保留；活跃或 unknown 拒绝；旧阶段任务保留兼容入口 | segments、world-build-recovery：双分支、unknown、冻结指纹 |
| 显式全书按钮未适配新段计划 | 可玩成果存在后最多规划两段 P3，完成后补下一窗口，暂停/预算继续生效 | bounded planning 与生产入口复测 |
| schema28～30 到31 重建 journal 可能丢旧步骤 | 迁移携带原操作/步骤/FK，running 唯一约束保留 | migrations：旧版本矩阵/FK |

开局探索遵照用户最新约束：目标 90 秒，模型上下文 10% 是输入上限。单请求抽取真实事实，本地编译基本规则（明确 rule_mapping），不开局深度 LLM 数值设计，不伪造剧情、不降低计数、不放宽冲突。风格 P3 分析异步，不计为开局前置。

首轮全量失败 3 个：新增 releaseStaleBranchDemands 端口未接测试夹具。已补夹具并增加调用断言，不添加可选跳过、不删除测试。最新验证详见 TEST_RESULTS。

真实负例保留在私有数据：极短书头事实不足；地点形状错误；身份/角色冲突；引用实体缺证据。工程修复不等于内容验收通过。
