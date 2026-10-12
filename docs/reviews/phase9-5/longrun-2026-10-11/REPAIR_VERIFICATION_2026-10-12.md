# 2026-10-12 阻滞修复与离线复验

世恒哥授权的本次修复仅执行离线定向回归、类型检查和构建。没有启动长跑、操作设备、发送真实模型请求、修改预算、提交、推送、合并、发布或更改版本号。原失败记录保留，以下结果不替代端上验收。

## 工作树及身份

- F:/sw95，codex/phase9-5-emulator-longrun，HEAD 6710e3007fc73df16b9f647b62affd7336a0c37b。
- 进入时 36 个跟踪文件已有修改，diff 为 1747 additions / 94 deletions，另有报告、readiness、测试和工具等未跟踪文件。原有改动没有归入本次成果，也没有 reset/clean/checkout/stash。
- 进入时 status、完整已有跟踪补丁、stat、逐文件 SHA-256 留在忽略目录 test-logs/phase9-5-repair-2026-10-12/entry-*。结束身份为 exit-identity.json。
- 本次额外使用可复现指纹：对 src、mobile/src、mobile/scripts、tools、tests 中 TS/TSX/JS/CJS/MJS/Java/JSON 文件，按相对路径排序，构造 path→SHA256 对象，对其 JSON.stringify 计算 SHA-256。进入时 601 文件 / de7a76ec5ec0afe24ef4be59316c49169fbaa44a36187868f1dca53ae8a280dd；结束时 603 文件 / 9990c5fd6564e74d172ce807ff51e0968d1e52755ee70f203e429321a84f0477。这是明确配方的补充身份，不将其冒充 BASELINE 旧 9275fb… 指纹的同算法复算。
- tools/phase9-identity.cjs 的 scope-v3 生产身份：进入 9770a14f3ffa4930bcce9909a9edb9070e918f56b2a242a407099d75e7b8d1b5；结束 30d9ff5c0abbaf0bdd1e851d52d5cfa475b2c6f7b3f34aff658072984c84b7de。v3 包含 native/build inputs，不包含测试和新离线工具。
- 新 Debug APK：dist/apk/debug/ShineWord-V1.0.0-debug.apk，110044959 bytes，SHA-256 ebf2a4aa38c16e6eb9d1ec5a7eea7c82aded733da6a111e5b4eb210e4f2ef4cc。仅构建，未安装；设备仍是旧安装身份，不能引用新 APK 哈希证明端上通过。
- 版本仍为 V1.0.0 / 1000000。mobile/src/version.json 的 buildTime 由构建脚本从进入时 2026-10-12T07:15:23.753Z 更新为 2026-10-12T10:33:31.222Z，单独列为自动生成变化。旧 APK B8CD7B… 已在私有证据目录保留副本。

## BUG-95-009

根因进一步收窄：奖励及最严重档关系效果需要的角色有合法公开 actor_template，并在已采用的当前局面 participantEntryIds 中，但没有列入基础世界 scene.actors。原 prepareAdoptedSceneActors 只读 scene 名单，且要求 segment owner；因此人物没有进入 actors/cards。原结算拒绝未知 owner 是正确行为。

最小修复：

1. 角色准备复用 branch-bound 有效目录，将当前地点的已采用 active 局面参与者纳入载入范围。仅接受公开或玩家已发现且时间有效的模板；未知、隐藏、异地、未来及未绑定参与者仍拒绝。保留已有角色状态，不复活死亡角色，不凭名称猜同一个人。
2. 准备只在新行动边界以原生命周期事务载入。存在未提交 turn 或 running/paused_system operation 时不载入；turnIdOverride 恢复路径不执行。原 J1 turn-0071 没有被调用。
3. 机会投影允许显示有合法准备来源的路线，但不写角色或进度。实际新行动先载入、刷新同一 candidate，随后严格以持久化 actors/cards 再做 readiness，才进入 journal/编译/投骰。
4. actor preflight 覆盖四档 outcome、旧 successEffects、onSuccess/onFailure 中的角色字段及相关收尾奖励。即使未知角色仅出现在 severe_failure，也提前拒绝。__player__ 在效果编译时与结算使用同一玩家解析规则。

精确快照检查：原文件以 SQLite readOnly 打开，quick_check=ok，J1 v70、Resolved turn-0071、success roll、paused_system 原样保留。补齐合法参与者的内存副本中，full_success/success 结算为 succeeded，failure/severe_failure 保持 active；普通成功的原关系奖励仍发放。原 SQLite 文件执行前后 SHA-256 相同。此操作没有恢复原回合，也没有产生新真实存档分支或玩家决定。

定向 SQLite 新战役夹具另外证明：无基础 scene 人物但有已采用参与者时，新选定路线可见；投影不写状态；新行动载入真实 owner 后完成阶段，行动关系 +1 与收尾奖励 +2 合计 +3，原初始快照字节不变。未知 owner 的底层结算仍抛错，未创建 template 名义的幽灵知识 owner。

状态：代码已修、离线工程 PASS；Android 新合法分支同场景 NOT RUN（未安装/操作设备，也没有授权新真实请求）；旧 J1 冻结回合未恢复。未知模板、其它复杂间接结算链和完整生命周期不因这个定向结果获得全局通过。

## BUG-95-001

精确证据校正：只读快照里 cons-crest-truth 无消费者、cons-settlement 延迟不足及无消费者的同一拒绝候选，实际 job 绑定 camp-mv3iwgv7-main v3（J3），不是报告所称 J2。保留旧报告归属作为历史记录；本次按真实候选而非旅程标签修复。没有编辑原候选、付费正文或已采用工件。

根因：compile/replan 把三项错误用分号聚合成一个字符串。buildStructuralRepairGuidance 的完整单条正则无法匹配，具体 trigger/consumer 指引为空。修复先按诊断边界拆分，再逐项给出排程后至少两段的 stage-5/stage-6、匹配的 knowledge/event/relationship 条件以及后续硬依赖消费者。修改 trigger 后明确要求重新选择消费者位置，禁止沿用更早阶段。

固定反例仍被同一个 strict causal validator 拒绝三项；新的隔离结构将 settlement trigger 改为后继 required-main 节点成功，后续阶段以正向知识叶消费 crest 效果，ending 同时要求 trigger 节点成功及 settlement 事件，三项检查为零。删除硬依赖、把知识消费者放入 not 后再次正确拒绝。validator 没有改动。

状态：具体修复指引代码已修，精确拒绝输入指引及严格因果结构回归 PASS；原场景正式新 revision 的真实生成→采用→UI 使用 NOT RUN。离线新结构不是已正式采用的真实候选，不能关闭端上内容供给故障。

## A15/A36

已存在的 ordinary-success 生产者及关闭前可达性 validator 保留。新增定点修复指导，把它们的具体诊断映射到方法名、独立准备、requires.condition 正向消费、普通成功兑现及失败后的可消费线索/真实代价，禁止加大 counter、删除门槛或复制大成功额外奖励。

固定内容通过生产 SQLite Session：普通 success 取得准备 counter，另一方法消费它并完成阶段；固定 failure 造成 hp -1 并取得线索，另一方法消费已持久化知识后完成阶段。使用独立夹具的固定 RNG，未更改任何真实骰点。一次性 no-op 失败仍只是 OBS-95-010。

状态：合同修复指引与固定玩法夹具 PASS；旧通用开局空效果没有被编造成新效果，历史三意图旅程及独立玩家质量仍 NOT RUN，A15/A36 保留 FAIL。这不证明所有模型生产内容已具备失败恢复和长期用途。

## 本次改动文件

| 文件 | 本次增量 |
|---|---|
| src/application/campaignPlan/routeReadiness.ts | 合法参与者准备来源；四档/旧式效果角色预检 |
| src/application/campaign/session.ts | 新行动边界按已采用参与者载入；统一角色预检拒绝 |
| src/application/campaignPlan/opportunityProjection.ts | 只读展示可由合法参与者准备的路线 |
| src/application/game/localCompileReadiness.ts | 明确四档方法角色不足拒绝码 |
| src/application/game/v2Compile.ts | __player__ 角色解析一致性 |
| src/application/campaignPlan/generationService.ts | 聚合诊断拆分；延迟消费者重定位；普通成功定点修复 |
| tests/phase9-5-blocker-repair.test.cjs | 新增 5 项阻滞/角色边界/因果闭合/失败恢复回归 |
| tests/phase9-closeout.test.cjs | 分开验证底层未知 owner 拒绝和新行动合法 owner 载入 |
| tools/phase95-blocker-offline.cjs | 精确快照只读四档结算与原候选指引复验，输出仅计数/布尔 |
| mobile/src/version.json | 构建生成 buildTime；版本号未变 |
| BASELINE、BUGS_AND_FIXES、ACCEPTANCE_MATRIX、FINAL_REPORT、CHECKPOINT、本文件 | 追加本次身份、证据及未验证边界 |

## 实际执行命令与结果

所有命令 cwd=F:/sw95，日志在 test-logs/phase9-5-repair-2026-10-12/，不公开数据库、原响应、APK 或截图。

| 命令 | 结果 |
|---|---|
| node --test tests/phase9-5-blocker-repair.test.cjs（首次、重编译前旧 dist） | RED 0/4；精确源码另外核对，旧 dist RED 不冒充当前源码完整回归 |
| npm run build:core | 最终 PASS；首次类型检查发现 optional artifacts，已修正并重跑 |
| node --test tests/phase9-5-blocker-repair.test.cjs tests/phase9-5-local-compile.test.cjs tests/phase9-plan-contract-guard.test.cjs tests/phase9-causality-validation.test.cjs tests/phase9-inherited-completion.test.cjs | 31/31 PASS，target-c.log |
| node --test tests/phase6-campaign-style.test.cjs tests/phase9-closeout.test.cjs tests/phase9-5-blocker-repair.test.cjs | 62/62 PASS，target-d.log，包含已发现人物及底层 fail-closed 结算 |
| node tools/phase95-blocker-offline.cjs test-logs/phase9-5-longrun-2026-10-11/device-db-after-j1-petition-tap-check-5554.sqlite | PASS，exact-final.log；零 provider，原文件哈希不变 |
| npm run verify:core | 首轮 1296/1298，两项边界失败保留；修复后最终 1298/1298，fail=0、skip=0，core-final.log |
| npm --prefix mobile run typecheck | PASS，mobile-typecheck-final.log |
| npm run verify:version | PASS，1.0.0 / 1000000 |
| npm run apk:debug | 最终 BUILD SUCCESSFUL in 43s，apk-debug-final.log；仅构建 |
| git diff --check | PASS；既有 version/budget 文件 CRLF 提示不是校验错误 |

长跑/真实模型/Android 安装/恢复 J1/原场景新 revision UI：NOT RUN。预算仍是原 shineword-phase9-5-20261011：600 上限、453 spent、453 completed、0 unknown/in-flight，不增额、不重置、不把余额当授权。完整 A01–A40 仍 3 FAIL / 37 NOT RUN / 0 PASS。
