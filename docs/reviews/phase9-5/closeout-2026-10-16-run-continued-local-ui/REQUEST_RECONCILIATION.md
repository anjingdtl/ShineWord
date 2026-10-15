# 请求账本与 unknown 对账

## 本轮可核验范围

- 本机没有此前 closeout 使用的私有物理请求账本、原始 attempt 响应或对应用户 SQLite；本轮未读取历史请求记录，旧报告额度和 unknown 不作为当前账目。
- 新增 ANDROID_LOCAL_MOCK_REQUESTS.jsonl 是测试服务器白名单字段记录，不是物理 provider 账本：共11个已响应本地mock调用，其中campaign_plan 7、Planner 2、Narrator 2。所有响应都由本机 loopback 服务返回。
- 当前 sweep turn 只有一对合成请求：Planner planner:camp-mva64y1h-main:turn-0002#a1 与 Narrator narrator:camp-mva64y1h-main:turn-0002#a1。冷启动后没有新增 Planner/Narrator attempt，也没有提交新行动。
- 真实 provider/GLM 物理请求为0；本轮 budgetScope、physicalRequestCap、feeBoundary均为null。测试端点没有访问外部provider。
- 测试台账只含角色、逻辑请求/attempt ID、branch/version、时间、状态等元数据，没有原始提示词、故事正文、Authorization或模型响应正文。

## HTTP状态与业务结果

mock中的HTTP 200只表示本地HTTP响应收到。7个campaign_plan响应没有形成可验收的计划候选；应用退到本地建议。不能据此计为候选有效/采用成功。两个Planner/Narrator合成对则由当前APK接受并形成UI可见的检定结果和已提交turn；它仍不是真实玩家决定或provider验收。

## 历史差异、unknown和恢复条件

- 本轮新建 outcome_unknown：0；本地mock attempt全数收到响应，没有待恢复attempt。
- 历史unknown和物理账差：NOT VERIFIED；未改账、未猜测对平、未自动重放，也未借用或重置旧预算。
- 恢复责任：账本持有人/维护者提供同一scope的只读provider逐attempt账本、应用SQLite及原始响应/传输关联；必须核对scope、profile、logicalRequestId、attemptId/attemptNo、request kind、branch、时间线、HTTP状态、响应hash和应用候选状态。
- 真实调用恢复条件：本轮适用的budget scope、物理请求cap、费用/用量边界与授权模型配置；未同时满足前继续使用本地mock。

## 状态

- 本地预算 authority/unknown合同：历史报告为53/53 PASS（自动化合同）。
- 本轮本地mock调用：11次，全部有响应；真实物理请求：0。
- 私有历史账本/差异：NOT VERIFIED / PARTIAL。
