# M2：真实小说导入与 GLM 开篇 / 游玩样本

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL。真实小说 partial world、已测通的 GLM 配置和 standalone Android APK 均完成 agent-driven 游玩。第三局 campaign-scope 内容提供了显式固定难度、固定空 evidence policy 和规则绑定的 L1 方法，已有 6 个 L1 与 2 个 L2 行动；另有 stage-5 完成行动后真实采用 plan r7 并进入 stage 6。World package 仍无 method entry，非空来源证据 L1、真人决策、独立试玩及 main branch 的 stage-5 内容仍未验收。

## 材料与隔离

- 用户原始 TXT：7,178,905 bytes，SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`，本机检测 Windows-936/GBK。
- SAF 导入的私有副本仅追加 CRLF，7,178,907 bytes，SHA-256 `2D4AD3AAA7793C0BE690DE6E380DE88F1FAC7E78CD725C3D74E3F92B0BECBFD8`；原文件未修改。正文、提示词、原始响应和密钥未加入仓库。
- 设备解析 1,504 个章节、3,260 个 source chunks；本机标题计数 1,498，差异未归因。模型只收到 0–9,600 code points 的 partial scope，未构建/发送全书。
- 发布包汇总 49 explicit facts、3 inference facts、52 个有来源事实引用、8 skills、4 scenes、11 个角色模板。当前 world package 的 `package_entries.kind='method'` 数量仍为 0；第三局由 GLM 生成的 campaign-scope artifact 另含合法 L1 方法，均显式设置 fixed `difficultyPolicy`、`evidencePolicy: {kind: fixed, evidenceIds: []}` 和规则绑定。它证明了 campaign-scope L1 分流，不证明 package method 覆盖或非空来源 evidence L1。

## 真实 GLM 物理请求账本

用户在本轮明确授权本项目调用不限额度；该小说 world 与其 campaign/branch 的观察窗口曾达到物理并发峰值 2，本轮后续调用逐条等待完成。当前小说副本对应世界 `world-src-2d4ad3aaa7793c0b-mvddhkeg`：

| Request kind | 成功次数 | 已知失败 | 成功 input / output / reasoning tokens | 成功耗时 ms（min / avg / max）|
|---|---:|---|---:|---:|
| world_extract | 3 | 0 | 10,855 / 7,750 / 34 | 25,937 / 34,231 / 40,951 |
| style_analyzer | 1 | 0 | 1,660 / 410 / 0 | 12,150 / 12,150 / 12,150 |
| opening_goal | 3 | 1 次旧配置 HTTP 401 | 563 / 104 / 0 | 3,904 / 4,761 / 6,109 |
| campaign_plan | 42 | 0 | 1,017,014 / 237,789 / 40,380 | 31,405 / 97,873 / 193,203 |
| planner | 8 | 0 | 27,522 / 1,828 / 175 | 5,188 / 8,946 / 20,651 |
| narrator | 17 | 0 | 55,395 / 8,144 / 294 | 6,941 / 12,140 / 20,138 |
| memory_checkpoint | 2 | 0 | 4,686 / 2,899 / 19 | 22,071 / 25,640 / 29,208 |

按真实小说 world、其三个 campaigns 及映射 branches 的应用持久账本去重统计，共 77 次请求：76 次 HTTP 200 成功、1 次配置轮换前 HTTP 401；该账本范围内没有 `outcome_unknown` 或在途请求。配置更新后通过真实请求 HTTP 200 验证，旧 401 没有重派。新计划修复及 stage-5 后续采用共增加 6 个顺序 `campaign_plan` attempt 和 2 个串行 Narrator 调用；没有重派未知请求。

76 次成功调用合计 input `1,117,695`、output `258,924`、reasoning `40,902` tokens。App ledger 不记录实际人民币扣费，费用未知；世恒哥对本项目的不限额度授权不代表费用为零。独立 localhost mock world 的 429 / `outcome_unknown` 不计入以上统计。旧证据文件 `evidence/third-campaign-sanitized-summary.json` 保留其较早点时快照；该快照的计数不代表本节最终汇总。

## 2026-10-18：429 归因与独立 GLM 复测

- 复查设备数据库中的那条 `world_extract` HTTP 429 后，读取其冻结构建配置：endpoint host 为 `10.0.2.2`、port `8765`，模型字段为 `glm-5.3-flash`。这是 Android 模拟器宿主映射到的本地注入端口；仓库中的 [mock-429-server.cjs](evidence/mock-429-server.cjs) 明确固定返回 synthetic HTTP 429、丢弃请求正文且不记录 Authorization。因此该 429 来自本地故障注入服务，不是 GLM 内容审核响应，原著用词与该 429 无因果关系。
- 该本地逻辑请求记录 attempt 1 `failed/http_rate_limit/429`，attempt 2 `outcome_unknown/network_unknown`；两条属于同一 logical request。ledger 未保存 HTTP 响应正文且没有 provider request ID，未知状态保持原样，未重派、未清账。
- 为回答原著内容是否触发 GLM 拒绝，另建独立样本项目，从同一本机小说取开篇 9,601 个 code point，走当前 `open.bigmodel.cn` / `glm-5.3-flash` 配置。新 logical request 不是对上述 unknown 的重放：`world_extract` HTTP 200（49,202 ms；input/output/reasoning `5,011/3,133/18`），`style_analyzer` HTTP 200（15,232 ms；`1,660/550/0`）；在途峰值 1。单单元构建完成，SQLite `integrity_check=ok`。原文和响应均未加入仓库。
- 该开篇样本在当前配置下没有 429 或内容拒绝；它不能证明未测试的全书后续段落均可通过。把独立样本的两次成功请求计入后，持久应用 ledger 范围为 79 次真实 GLM 记录（78 HTTP 200、1 次旧配置 HTTP 401），该范围内 429 / unknown / in-flight 均为 0。宿主机配对试跑的两条 transport unknown 另见下节，不在这 79 条中；费用仍无法从 app ledger 确认。

## 后续宿主机配对试跑偏差

- 在 79 次持久应用账本调用之后，另起的合成 `CampaignSession` 配对试跑发生两次面向 GLM endpoint 的 Planner transport attempt；两次均无 HTTP status、provider request ID 或 usage，provider adapter 归类为 `transport_error` / `dispatchState=unknown`。是否已到达 provider 无法确认。
- 这不是 L1/L2 样本：fixture 方法缺少 L1 必需的 evidence/difficulty binding 字段，原本计划走 L1 的输入也正确地落入 Planner。两个独立 fixture 的账本各观察到一条 `outcome_unknown`，但 harness 使用 `:memory:` SQLite，退出前未导出 `logicalRequestId` / `attemptId`；这两个 identity 现已无法恢复。
- 两次均未重派；之后停止了真实模型调用。它们不计入 79 条持久应用账本记录，因此不能继续宣称本轮所有真实 endpoint 尝试结果都已核清。脱敏摘要见 `evidence/host-glm-pilot-transport-unknown-sanitized.json`。这是测试 harness 的工程偏差，不是已确诊的产品代码缺陷。

## 独立本地故障注入世界

- 世界 `world-src-7f45fe0b11ea30ec-mvdbwylw` 绑定原始 TXT hash，是单独的 localhost/mock fixture 项目，不是上述 GLM campaign 世界。
- 账本保留一次合成 HTTP 429（`http_rate_limit`）和一次 `network_unknown/outcome_unknown`（无 HTTP/provider ID/usage）；两条都不确认、不清账、不重派。unknown 仍 `needs_review`，estimated usage 按 1 保留。
- 因故障注入世界与当前小说副本及其 campaigns/branches 分开计数，不把本地代理错误算成真实 GLM 失败。它不属于真实小说 ledger 的 68 次成功 / 1 次旧配置 401 统计。

## Android 上的实际 Runtime 行动（均为代理 QA，不是真人决定）

- 第一局：5 个行动级操作；Planner 5 / Narrator 5；行动/骰点和状态连续提交，测试中出现失败、成功、严重失败。`turn-0005` talk 成功使 testimony counter 从 0 增至 10，后续状态中仍为 10；`turn-0007` severe failure 后 Runtime 为 `failed`、ending ID `ending-case-lost`。行动与剧情均由测试执行者输入/选择。
- 第二局：在同一小说世界新建独立 branch；一次“观察周围环境” QA 行动触发真实 Planner 与 Narrator（本轮前累计 Planner/Narrator 各 6），骰点 `[1]` / d4 / difficulty 4 / margin -3，state version 2→3 原子提交。下一轮本地建议投影可见；后续计划请求完成后 Runtime 经 `manage-replan:4` 到 version 5 并以 `ending-failure` 结束。终局页禁用新行动。
- 第三局 main `camp-mvdjtr22-main`：8 个 agent-driven action turns 中，turn-0002 和 turn-0012 真实走 L2（Planner + Narrator）；turn-0003、0006、0008、0009、0010、0011 真实走 campaign-scope L1（仅 Narrator，无 Planner）。turn-0011 以 `[4,5,6]` / 3d6 / difficulty 3 / margin +3 `full_success` 从 v10 原子提交到 v11；状态继续至 v12。该 main 的 stage 1–4 成功，三项 deferred consequence 已触发并消费；v12 记录中 stage-5 consequence 尚未消费。后续 stage-5 QA action 在独立 branch，未把其结果回写 main。
- 第三局 stage 5 的早期 v10、v11 候选仍按既有 validator 拒绝。M3-06 代码修复后的两个真实新 job 均未产生 action-reference mismatch，因此该特定指导路径没有 live 触发。M3-07 job `replan:camp-mvdjtr22-bmvdq6wys:v11:2026-10-18T11:34:15.046Z:5e606cda282e` 的 2/2 顺序 HTTP 200 候选将 concrete required-main `stage-5` 设为 `activation:null`，但仍因 consequence 延迟、trigger 去重及后续消费者合同不符被既有 validator 拒绝；该 job 本身没有被采用或重派。
- 随后的真实 Android UI QA 在同一隔离 branch `camp-mvdjtr22-bmvdq6wys` 提交可用 stage-5 行动 `turn-0014`，状态 v13→v14，成功、无骰点，Narrator HTTP 200（input 3,755 / output 348 / reasoning 0）；该 turn 没有 Planner attempt。其后新 plan job 的 2/2 顺序 `campaign_plan` attempts 均 HTTP 200，采用 plan revision 7 并准备 stage 7。当前 QA branch 为 stateVersion 15、16 turn rows、5 roll rows、16 snapshots；stage 1–5 succeeded、stage 6 active、stage 7–8 planned。原 main `camp-mvdjtr22-main` 仍保持 v12 / plan r4，未被改变。
- 另在隔离测试 branch `camp-mvdjtr22-bmvdo8467` 从 v9→v10 提交 1 个 method-bound `skill_check` 行动（结果 failure、Narrator HTTP 200、Planner 请求为 0）。截至 stage-5/save-10 补充时共有 17 个 agent-driven QA actions；其后 stage-8 新增两个 action，现在累计 19。save 内的六条历史回合不计入新增行动。它们不代表用户认可剧情质量，也不计入阶段 9 的 80 个真人决定或 4 名独立试玩。stage-5 分支证据见 `evidence/stage5-live-adoption-and-replay-sanitized.json`。

## 未通过/待验

1. L1：已在第三局 campaign-scope artifact 上执行 6 次；方法的 evidenceIds 均为空，world package 仍无 `method` entry，非空来源 evidence L1 与 package method 覆盖未验。
2. 延迟后果：`conseq-town-tension`、`conseq-barov-attention`、`con-tension-peaked` 已在后续消费者中触发并消费；此前列出的 `con-barov-offer` 与 stage 5 相关。stage-5 QA branch 已提交行动并进入 stage 6，但未完成该后果独立的 trigger→discharge→下游消费逐项对照，也没有玩家对后果作出选择。
3. stage 5：候选修复提示本身经 validator 拒绝，之后可用 UI 行动成功完成该节点并使隔离 branch 采用 revision 7、进入 stage 6；原 main 仍 v12/r4，未完成相同路径。没有放宽 validator。M3-06 action-reference mismatch guidance 的特定 live 错误仍未触发。
4. 真实玩家决定 0/80、独立试玩 0/4；第一、二局的 failure ending 不代表自然结局可玩性已验。
5. 实际费用、全书构建成本、章节计数差异、模型与独立玩家的剧情质量评估仍未知/未运行。原文与生成剧情截图只留在本机私有目录。

## 2026-10-19：matched live GLM 与 429 归因复核

- 在 production `CampaignSession` 上使用固定非空 evidence `lore-crates`、固定骰点和同一冻结 root state，完成 10 个 L1 tap 与 10 个 L2 semantic-paraphrase turns。20/20 原子提交成功；L1 每次 1 个 Narrator、Planner=0；L2 每次顺序 1 个 Planner + 1 个 Narrator。30 个真实 GLM 物理请求均 HTTP 200，最大并发 1，cap 40 / spent 30。L1 平均 6,705.2 ms，L2 平均 8,900.5 ms；用量 input/output/reasoning 为 `32,040 / 6,378 / 167`。数据和逐 attempt hash 在 `evidence/matched-live-l1-l2-synthetic-20261019.json`。
- 该 fixture 是 production runtime 的合成 world/campaign，不是小说 world package method 路径；因此证明路由和提交链，不证明原著 package method 覆盖、非空来源 fact 绑定或真实章节语义。
- 另以无模型的 production harness 对同一 frozen state 做 tap vs exact-authored-text parity；normalized state、contract、effects、events、rolls、rewards 完全一致，两个 branch binding/contract hashes 各自通过校验，`evidence/l1-tap-exact-parity-synthetic-20261019.json` 为 PASS。
- 429 复核：现有证据中的 HTTP 429 来自模拟器连到 `10.0.2.2:8765` 的 localhost/mock fault fixture，真实 GLM 账本中 HTTP 429 为 0。原 unknown 没有 HTTP status，按 `outcome_unknown` 不重派；之后用不同隔离 scope 对真实 endpoint 完成 9,601 code-point direct-GLM opening sample 与上述 10+10，均未重放旧逻辑请求。故没有证据支持“GLM 对小说内容涉敏后返回 429”。
- 汇总已知物理记录：111 次，其中 HTTP 200 为 110 次、旧配置 HTTP 401 为 1 次；另有两个身份未持久化的 host transport unknown，保留且未重派。没有观察到真实 GLM 429。累计成功用量 input/output/reasoning `1,152,193 / 265,801 / 41,097`；应用 ledger 无法证明实际 CNY 扣费。

## 2026-10-19：stage-8 双分支真实 Narrator 补充

- 修复后通过现有 Android app 在同一 v19 起点创建 early-exit 与 hold-the-line sibling branches，各执行一次真实 Narrator。两次物理请求均 HTTP 200、attempt 1，串行完成；没有 Planner 请求、unknown、429 或重派。具体终局/因果证据见 `evidence/android-terminal-consequence-cleanup-20261019.json`。
- 加入这两个已核实的 Narrator attempt 后，真实 endpoint 的已知物理请求累计为 113 次：112 次 HTTP 200、1 次旧配置 HTTP 401。另有 2 次 host transport unknown 身份遗失，保留未重派；本地 mock 429/unknown 单独计数，不计作真实 endpoint 响应。真实 GLM 429 仍为 0。
- 小说 world/campaign/mapped branch 的持久 ledger 随这两个新 Narrator attempt 更新为 79 次：78 次 HTTP 200、1 次旧配置 HTTP 401；该 scope 没有 unknown 或 in-flight。matched synthetic run 与其他已知 endpoint 请求另计入上面的 113 次全局已知请求。
- 已汇总 token 数 `1,152,193 / 265,801 / 41,097` 对应前一轮 111 个已知请求；此次两个 Narrator 的逐次 token 指标未纳入该汇总。因此当前完整 token 总量和实际人民币费用仍未能从脱敏账本确认。用户已授权本项目 GLM 测试不受请求额度限制，两个新增调用峰值并发为 1。
