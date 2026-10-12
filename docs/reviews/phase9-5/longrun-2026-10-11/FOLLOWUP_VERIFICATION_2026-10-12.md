# 2026-10-12 定向复验追加

世恒哥询问未通过项及能否直接验证修复后，继续执行了允许的离线定向复验。未重启 80 决定长跑，未发送真实模型请求，未重置预算，未恢复原 J1 turn-0071，也未提交/推送/发布。

## 未通过项的性质

| 项目 | 本轮新增证据 | 保留的验收缺口 |
|---|---|---|
| BUG-95-009 / A28 | 精确 J1 v70 在私有数据库副本中正式分叉，经过原 Session 的选择→参与者载入→冻结/结算→新回合提交。新分支没有继承 turn-0071 或其骰点；原路线的新行动不再因角色问题冻结 | 新 APK Android 同场景 NOT RUN；原 J1 冻结仍保留。前次精确四档纯结算中的普通成功奖励证据继续保留 |
| BUG-95-001 / V95-09 | 原拒绝正文经生产重规划、严格编译、正式新 revision 采用；新路线的准备与独立消费者都实际提交 | 使用固定本地响应桩，不证明真实模型一定会按新指导生成合格内容；Android 使用 NOT RUN |
| A15/A36 | 精确旧候选另一个普通成功仅文字事件的方法被当前 validator 拒绝；新增定点指导，新 revision 以准备事实和独立后续方法闭合这条链 | 通用开局空效果、所有真实模型内容质量、三意图完整旅程及独立玩家审查仍未闭合，A15/A36 保留 FAIL |
| 80 有效决定、两条真实延迟消费链、save-10、10+10、独立玩家等 | 本轮未执行这些完整验收项目 | 继续 NOT RUN/NOT COMPLETE，不因离线 suite 增加计数而变 PASS |

## 新发现与最小修复

精确候选的首次完整服务复验仍被拒绝：其中打听方向方法的 success/full_success 只有 record_event，没有公开目标消费者，也没有权威持久效果。原三项因果错误修正后，这项当前严格合同检查仍成立，不能放宽 validator。

新增 buildStructuralRepairGuidance 的对应诊断处理：指出具体方法、事件及其它方法候选；已达成公开目标的事件应有匹配公开目标消费者，只是信息准备时则提供合法知识或有真实事实单位的 counter，再由另一个方法的 requires.condition 正向消费。要求准备不能假装完成远期目标、不能提前关闭局面、不能凭空补造世界条目或删除既有门槛。

私有副本里的正式新候选按照该合同补一份核实后的路线准备，独立跟踪方法消费它。除此之外，保持 crest 的后续正向知识消费者、settlement 的足够延迟 required-main 触发与正向 ending 消费者。原候选和旧已采用工件均不修改；修正版由本地响应桩供给生产服务创建新候选/新 revision。

## 精确副本复验

工具 tools/phase95-followup-offline.cjs 要求新的目的 SQLite 文件，COPYFILE_EXCL 拒绝覆盖，原只读证据检查前后 SHA-256 相同。复用实际 SqliteWorldStore、SourceCatalogAdapter、SegmentPublicationService、forkBranch、CampaignSession、重规划/采用/回合提交服务；仅 provider 是进程内固定响应，没有 HTTP 或真实模型。

1. BUG-95-001：从真实拒绝 job 的 committed v3 在副本中正式分叉；用完整原拒绝正文作为首个响应，一次受限修复提供新内容。严格编译后新 revision adopted。准备前跟踪办法不能选；打听方向提交准备事实后，stage-3 仍 active；独立后继办法随后可选，提交后 stage-3 succeeded。
2. BUG-95-009：从 J1 committed v70 在同一副本中正式分叉，确认新分支没有原 turn-0071 及其 roll。原路线可选，真实 Session 在新行动边界载入已采用人物，新行动提交，paused_system 数量为 0。
3. J1 新分支固定夹具骰的结果为 **failure**，按原规则提交，没有调骰来强求成功。它证明该新行动的角色准备/四档编译/失败结算/提交边界，不能冒充 Android 普通成功收尾复验。前次精确内存四档回归中的 success 收尾及原奖励证据独立保留。
4. 副本中原有 campaign_plan_candidates、campaign_plan_revisions、campaign_content_artifacts、snapshots、turns、roll_records 每一行按原 rowid 逐值保持。原证据文件及原真实预算文件哈希也保持。

响应桩调用：重规划 2 次；BUG-95-001 准备/行动各一次 Planner + Narrator；J1 新行动 1 次 Narrator / 0 Planner。这些是离线桩调用，真实请求为 0，不计真实 Planner=0 样本或有效玩家决定。

## 命令与结果

cwd=F:/sw95；私有日志/副本在 test-logs/phase9-5-followup-2026-10-12/，不公开原正文、响应、数据库、密钥或 APK。

| 实际执行 | 结果 |
|---|---|
| node --test tests/phase9-5-followup-adoption.test.cjs | 最终 2/2，纳入以下 33 项；首次 pending 状态断言写成 scheduled 的测试错误已更正，初次日志保留 |
| node tools/phase95-followup-offline.cjs test-logs/phase9-5-longrun-2026-10-11/device-db-after-j1-petition-tap-check-5554.sqlite test-logs/phase9-5-followup-2026-10-12/exact-replan-c.sqlite | PASS，exact-replan-c.log；两个精确来源分支均在副本中新建合法 fork，原对象不变 |
| 第一次精确候选复验（exact-replan-a.sqlite） | FAIL，问路成功事件没有消费者；失败副本与日志保留，后续修订仅创建新副本 |
| npm run build:core | PASS |
| node --test tests/phase9-5-followup-adoption.test.cjs tests/phase9-5-blocker-repair.test.cjs tests/phase9-5-local-compile.test.cjs tests/phase9-plan-contract-guard.test.cjs tests/phase9-causality-validation.test.cjs tests/phase9-inherited-completion.test.cjs | 33/33 PASS，target.log |
| npm run verify:core | 1300/1300 PASS，fail=0、skip=0，core.log |
| npm --prefix mobile run typecheck | PASS，mobile.log |
| npm run verify:version | PASS，1.0.0 / 1000000 |
| npm run apk:debug | BUILD SUCCESSFUL in 42s，apk.log；未安装 |
| git diff --check | PASS |

## 身份与增量

- HEAD/分支仍 6710e3007fc73df16b9f647b62affd7336a0c37b / codex/phase9-5-emulator-longrun。
- 当前 scope-v3 生产指纹：c472f040b0744bae6edec171e6d4c42cae7609820308f88d13a49f1219115dad。
- 同前次明确路径→SHA256 JSON 配方，605 文件补充指纹：f225d765495932e6f999deaafa24089b434fb3634e86fc5b589d4b9493dc6a45。完整清单在私有 identity.json，前次 exit-identity 作为 entry-identity-reference.json 保留。
- 当前 Debug APK：110046827 bytes，SHA-256 18881ec96e97f8e6c6ec5a0eb74cf9ed226c1ca41c4f8d08f30abab5fcf4e907，V1.0.0 / 1000000。未安装；前次 APK 已另存私有副本。
- 本次产品增量只有 src/application/campaignPlan/generationService.ts 的事件无消费者定点修复指导。tests/helpers/phase9CampaignFixture.cjs 增加可选 lengthPreference（原默认 short 不变）；新增 tests/phase9-5-followup-adoption.test.cjs 两项回归及 tools/phase95-followup-offline.cjs。mobile/src/version.json 仅由构建更新 buildTime 到 2026-10-12T10:53:12.423Z。其它前次源码/工具/测试逐文件哈希保持。
- BASELINE、BUGS_AND_FIXES、ACCEPTANCE_MATRIX、FINAL_REPORT、CHECKPOINT 追加本次状态；不覆盖旧身份或失败证据。
- 真实预算文件 SHA-256 5d6b265ca357721bb36200ac3de82207e930e40d61e87f4fcd0c17b00cbe33d3 未变，spent/completed 仍 453/453，scope cap 600。

## Android 限制

adb devices 未发现连接设备；本机保留 Medium_Phone Android 37 AVD。尝试以隐藏、只读、不保存快照的方式启动原 AVD，命令被自动审批拒绝，返回仅为 blocked by policy，未提供更具体原因。没有绕过拒绝，没有实际启动、安装、操作 UI 或改写 Android 数据。端上同场景本轮仍 **NOT RUN**。

完整阶段验收维持 3 FAIL / 37 NOT RUN / 0 PASS；仅上述代码和离线生产链子项新增 PASS。
