# M4：故障恢复、请求账本与历史存档

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL。真实 Android/GLM action commit 与合法历史 save-10 的依赖恢复、原生导入、冷启动和后续行动均已覆盖；本轮另完成合成 API 37 AVD 的在途 Planner 强停与冷启动不重派验证。outbox/写盘失败、旧 worker 竞态、Narrator 前后中断及 Stage-1/8 资产仍缺。

## 本轮可核证

- 小说 world、三个 campaigns 与映射 branches 的持久应用 GLM ledger 合计 77 次物理 attempt：76 HTTP 200、1 个配置轮换前 `opening_goal` HTTP 401；仅在此账本 scope 内 `outcome_unknown=0`、in-flight=0。401 未重派。成功 token 汇总为 input/output/reasoning `1,117,695 / 258,924 / 40,902`；观测并发峰值 2，最后 8 个真实请求均串行完成。另有两次宿主机 Planner transport attempt 的 identity 未持久化、dispatch unknown，详见 `REAL_NOVEL_AND_LLM.md`；费用账单不可见，CNY 金额未知。
- 单独的本地 mock world `world-src-7f45fe0b11ea30ec-mvdbwylw` 保留一次 HTTP 429 与一次 `network_unknown/outcome_unknown`，后者无 HTTP/provider request ID / tokens，`estimated_usage=1`。设备冻结配置确认这条 run 指向模拟器宿主映射 `10.0.2.2:8765`；仓库 bounded fixture 明确返回合成 429，所以这不是 GLM 响应。两条 attempt 同属一个 logical request，unknown 仍为 `needs_review`；没有确认、清账、重派或从真实 GLM 预算借额。
- 在专用 `ShineWord_M4FaultQA_20261018`（API 37）上，使用有 90 秒安全上限的 localhost hold server 接收 Planner POST，只记录请求路径/字节数，丢弃正文且不记录 Authorization。收到请求后立即 force-stop app；冷启动并重新打开同一 synthetic branch 后，SQLite attempt 从 sent 收敛为 `outcome_unknown`，HTTP/provider ID 均为空，server 未观察到第二次请求。branch stateVersion 仍为 0、rolls=0、branch outbox=0、`integrity_check=ok`；unknown 保留，未确认、清账或重派。脱敏证据见 `evidence/m4-synthetic-avd-force-stop-sanitized.json`。这验证在途 Planner 强停及冷启动不重派，不代表已提交 turn 的 Narrator/outbox 故障矩阵。
- 后续另起的宿主机 `CampaignSession` 配对试跑在两个隔离内存 fixture 中各发生一次 Planner transport attempt；均为 HTTP status=null、`transport_error`、`dispatchState=unknown`、无 provider ID/usage。请求可能到达 GLM，不能据此确认发送或未发送。该 harness 退出时丢失了临时 ledger 的 logical/attempt identity，因此列作未解决测试探针，不计入真实小说应用账本；两次均未重派。证据见 `evidence/host-glm-pilot-transport-unknown-sanitized.json`。
- 为排除当前原著开篇被 GLM 拒绝，新建独立 9,601 code point 样本项目走当前直接 GLM endpoint；`world_extract` 与 `style_analyzer` 连续 HTTP 200，观察到峰值在途 1，单单元构建完成。新请求未引用也未重派 local-mock unknown。脱敏指标见 `evidence/glm-429-attribution-and-retest-sanitized.json`。
- 两局真实 APK QA 的 action turn 均落在 SQLite 原子 commit；第一局 turn v2→v7 有多轮下一行动，第二局 severe failure 的 turn v2→v3 后，replan turn 继续提交到 v5。Roll record、state version 与 ending event 都可读。
- 使用 `adb install -r` 更新 APK，之前的小说、Keychain、campaign、world 与旧故障现场仍保留。没有卸载、清库、模拟器 factory reset 或历史 turn 改写。
- 旧 v12 数据库只读快照与后续稳定快照 `PRAGMA integrity_check=ok`；文件只保存在本机，既不提交也不将响应内容写入报告。某临时副本恰逢 journal 写入时 integrity check 不通过，已排除证据；待 journal 空闲后重取稳定副本通过，不是设备 DB 损坏。
- 2026-10-19 全量 Core 1,361/1,361 覆盖 unknown park、attempt fencing、atomic commit、turn replay/stateVersion、outbox、存档/导入合同及新增的本地 mock 计划作用域回归；这些自动化结果不等于 Android 现场故障注入矩阵完成。
- 从授权的既有 QA 日志只读恢复真实 save-10 和与其绑定的精确世界包；未制作或冒充合成历史存档。世界包依赖先在 Android Library 原生导入，之后通过 Campaigns → Import Save → 系统文件选择器导入 save。身份检查确认 source world、published package r1/content hash 和两个 artifact ID/hash 与 save manifest 完全一致。
- 原生恢复创建新 campaign `camp-mvdsy3v4` / branch `camp-mvdsy3v4-main`，导入后实际 stateVersion 5→6 的 `turn-0006` 成功提交；Narrator HTTP 200，3d6 / difficulty 4 / margin +2。对照显示六条冻结历史 turns 的标识、合同 JSON/hash、状态版本及两条历史 roll 的结果/hash 均与 save 完全一致；导入后计数为 7 turns、3 rolls、7 snapshots。冷停止并重开后 `play-composer`、`play-submit` 仍可见，分支可继续运行。
- 保存设备导入前的只读 SQLite 快照；既有 3 campaigns、9 branches、98 turns 仍在。基线历史行没有删除或改写，只有两条 `llm_resource_buckets` 的 `playingUntil/activities` 随应用活动生命周期变化。Save-10 后续行动与本轮其他 QA 新行动均为 agent-driven，不计真人决定。详细哈希与计数见 `evidence/save10-device-restore-sanitized.json`。
- stage-5 的隔离 QA branch 后续由 v11/r4 完成一次真实 UI action（turn-0014，v13→14，Narrator HTTP 200），并在两个顺序 campaign_plan HTTP 200 后采用 plan r7、进入 stage 6；真实小说 main branch 仍为 v12/r4，历史未改写。详见 `evidence/stage5-live-adoption-and-replay-sanitized.json`。

## 未执行 / 阻滞

- 已完成一条合成 Planner 请求在途时 force-stop 与冷启动不重派验证；但没有在已提交 turn 的中间时点 force-stop，未在 Narrator 前后终止 app、触发 outbox/响应写盘故障或制造旧 worker 竞态。已生成的剧情和模型请求不可通过回放/重试补齐这些证据。
- Stage-1/8 与特定历史骰点/Canon fixture 仍不可用；未从个人 AVD 或 ignored long-run ledger 导出、覆盖、重写这些资产。
- 已验证历史 save-10 及其世界包导入、精确历史回读和恢复后行动；尚未完成从当前应用重新导出再 round-trip、fork/rewind 的完整设备对照或旧 schema migration 矩阵。
- 真实行动存在严重失败并结束局面的样本，但不是故障注入；不得把游戏内失败归类成崩溃恢复测试。
- mock 429 和 unknown 都是合成 localhost 现场，不能代替 GLM 真实 timeout/未知扣费对账。当前实际人民币费用未知。

## 保护规则

- 冻结历史 turn、骰点、前两局 campaign endings、原第三局 main 状态和所有真实模型 ledger 按原样保留；恢复过程只新增一个独立 campaign，未覆盖原 campaign。
- 唯一 old `outcome_unknown` 是 mock world；没有 replay。读取 live SQLite 时只在 journal 空闲后对本地副本做查询；一次事务中副本未通过检查的临时快照未作为证据，设备数据库未被写入。

## 2026-10-19 补充

- GLM 429 归因已用隔离的 direct-GLM opening sample 与 matched 10+10 复核：本地应用账本记录的 HTTP 429 指向 `10.0.2.2:8765` fault fixture，真实 GLM HTTP 429=0。旧 mock `outcome_unknown` 和两个 host transport unknown 都没有重派；真实复测使用新的 scope/branch identities。
- 新增 matched live run 的 30 个请求全 HTTP 200、最大并发 1；见 `evidence/matched-live-l1-l2-synthetic-20261019.json`。它验证 Planner/Narrator 路由与提交，未补齐设备端 Narrator 中断、outbox 写盘和旧 worker fencing 故障注入。
- 用户确认真人体验由其自行完成；本报告不将真人游玩列作 agent 阻滞。其余自动化矩阵仍需可用的 Stage-1/8 原始资产，以及安全、可重复的设备注入现场。
- 新的真实设备回归补充：战役进入 completed 时，stage-8 的 pending consequence 若未满足 succeeded trigger 会被显式取消；从同一 v19 通过应用 rewind 创建的成功 sibling 则正常 discharge 并写入下游 knowledge。来源 branch 未变。该测试覆盖 campaign-terminal consequence lifecycle，不等同于 Narrator/outbox 写盘中断、旧 worker 竞态或历史 Stage-1/8 故障矩阵。详细分支与提交见 `evidence/android-terminal-consequence-cleanup-20261019.json`。
- 2026-10-19 在现有 M4 AVD 上新增一条独立的合成 UI 链：本地 mock 规划提案、创建 campaign、Planner、一次骰点、Narrator、turn 原子提交，再由对话行动触发并 discharge 延迟后果；branch stateVersion 1→3、两条玩家 turn 已提交、SQLite integrity=`ok`。与之区分：普通业务 `outbox` 表为 0 行；`frozen_turn_postprocess_outbox` 有 3 条 memory handoff 仍为 pending，但均已 episodic-indexed、memory HTTP=0（含 2 条 has_body），它们不能被记作普通业务 outbox 结果。过程中先保留两次 mock fixture 失败记录：8765 不在 QA metadata allowlist，随后正确标记的 candidate 暴露 `lore-crates` 超出 opening scope。新增测试先 RED 复现 mock 越界 reward，再在测试 helper 中移除该可选 reward 后 GREEN；未改生产验证器或追踪端口 allowlist。设备数据哈希、请求摘要和精确事件列表见 `evidence/m4-synthetic-local-mock-opening-turn-consequence-20261019.json`。
- 该 M4 UI 链只使用合成资料与 localhost mock，不代表 GLM 或真人玩家验收。Narrator 前后强停、响应收到后写盘失败、outbox 写入失败及旧 worker 竞态的 Android 设备注入仍未完成；旧 `outcome_unknown` 与历史数据未重放或修改。
- 本轮额外尝试启动只记录脱敏元数据的临时 HTTP hold server，以补做 Narrator 在途强停；执行环境工具策略拒绝了该 server 启动调用，未运行此项，也未换用其他方式绕过。该缺口继续保留为 NOT RUN。
