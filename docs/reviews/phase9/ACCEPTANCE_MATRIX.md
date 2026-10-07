# Phase 9 验收矩阵 A01–A40

2026-10-07 final29收尾复验。整体尚未通过。PASS=对应合同有直接证据；FAIL=已有实际不符且未经完整复验转绿；NOT RUN=完整场景或必需证据未齐；BLOCKED=外部阻断。本轮无BLOCKED。不使用PART。

工程证据：tests/phase9-closeout.test.cjs、phase9-flow/turns/planning/replan/sqlite.test.cjs、phase6-mobile-runtime.test.cjs；日志 .tmp/phase9/reaccept-core-final29.log（1042/1042，0失败0跳过），新增preparation/actor-references/proposal-fields/inherited-completion/ending-order/preparation-restore生产回归。私有实际样本/身份见REAL_JOURNEYS。工程安全拒绝不等于内容质量通过。

| ID | 场景 | 状态 | 证据/缺口 |
|---|---|---|---|
| A01 | 同小说同起点不同意图 | PASS | 同一序7边陲镇世界，自动保护探视/调查矿区/合作救援目标与办法不同；质量另见A36 |
| A02 | 原著/原创及换起点 | NOT RUN | canon真实资格/未来技能拒绝本地通过，完整真实换起点未齐 |
| A03 | 部分ready与后段依赖 | NOT RUN | 全TXT生产导入，已采用原文进入重规划/源变化stale回归；真实按需后段建设到采用未齐 |
| A04 | 明确目标/探索待选 | PASS | 双goalMode与完整intent，开局/管理无叙事卡仍有当前办法 |
| A05 | 计划死亡尚未行动 | PASS | 未来计划不改生死/经历；已提交事实和原子归约是实际进度权威 |
| A06 | 救下原著将死角色 | NOT RUN | 终态保护工程通过；真实成功救援后持续存活未齐 |
| A07 | JSON截断/非法引用/修复 | PASS | 冻结约束、一次修复/两请求、原文恢复和坏形状拒绝；R28–R35贯通准备AST、人物别名、字段上限、跨阶段普通完成与结局顺序。真实失败原响应离线复现，生产两请求修复/ready及重入0HTTP通过；必要门不等于内容质量 |
| A08 | ready前强停/占位恢复 | PASS | 完整ready与损坏/占位拒绝工程通过，历史设备提案冷启动恢复采用。R36生产移动/SQLite覆盖unknown、invalid、ready恢复；final29同一真实未知任务冷/手动恢复保持分类、意图和一次规划请求，无规划重发；冷入口独立目标建议1请求另记 |
| A09 | 双击开始/事务中断 | PASS | setup/job fence、幂等采用、原子完整创建、候选主体hash门禁 |
| A10 | 两路线与后续回响 | NOT RUN | 机制权威差异工程通过；真实相同快照各10与后续机会未齐 |
| A11 | 点选/同义自由输入 | PASS | 同methodId/outcomeSetHash；可选技能字段不丢后果；设备真实绑定有效 |
| A12 | 模板外能力允许组合 | NOT RUN | 样本均已列办法/改写，不冒充新组合支持 |
| A13 | 非法ID/跨场景/过期 | PASS | offsite真实候选拒绝；伪造/过期选择及改意图工程拒绝 |
| A14 | 固定四档骰点 | PASS | 四档投骰前冻结同事务提交、原骰恢复、资源上下限与零余额回归 |
| A15 | 无风险/日常/连续失败 | FAIL | automatic与失败恢复工程通过；真实final18大成功门控停滞、final27合作旧承诺大成功专属导致门槛后重复，6次数字变化排除。R34必要门已捕获原档并经普通履约回归，仍未齐最终真实连续失败后的完整玩法复验 |
| A16 | changed/no_change | PASS | 无关动作不改进度；完成证据推进；更晚期限不覆盖先前完成理由 |
| A17 | 提前解决/绕过/奖励 | PASS | 早完成/跳过/终态保护与分叉奖励去重生产回归 |
| A18 | 偏离/暂停/换目标 | PASS | 生产pause/explore/resume与goal_changed回归；设备暂停/恢复入口实测 |
| A19 | 隔两决定后人情/承诺用途 | NOT RUN | 旧承诺真实兑现及本地延迟只触发一次通过；final20 v31、final27调查v12的新后果创建/触发同版本，不计隔两决定。旧final17仅1个诊断后果，两个实际持续后果及最终完整旅程仍未齐 |
| A20 | 重规划在途/事实变化 | PASS | 稳定边界双CAS、pending拒绝、源绑定同版本stale；真实有效采用已有 |
| A21 | 触发合并/后台竞争/失败 | PASS | durable单飞/租约fence/两HTTP共享；invalid不自动重发，显式新任务恢复 |
| A22 | 目标/顺序/规则/风格身份 | PASS | 完整意图/选项/材料/角色/规则冻结，live不替代旧池；ready主体hash |
| A23 | schema/校验工件/阶段恢复 | PASS | 不可变归档完整往返；原响应先落盘，成功阶段0HTTP恢复 |
| A24 | 损坏冻结 | PASS | 坏JSON/hash保留证据零HTTP；无live fallback；ready篡改拒绝 |
| A25 | 材料超窗/未知能力 | PASS | 预派发拒绝不裁意图；显式能力声明，设备未知能力失败已观察 |
| A26 | 单请求/任务/总预算全账 | NOT RUN | 新派发持久原子计数、任务2次已验；历史313含估计不能称全历史100% |
| A27 | reasoning-only/429/网络/未知 | PASS | 受控分类及有界修复回归；final28 high三意图真实300秒超时各1次后outcome_unknown，无自动重发。final29同一设备任务冷/手动恢复仍未知、规划次数不增；独立opening_goal按实际派发另计 |
| A28 | 检定/采用/提交/lease强停 | PASS | 原骰复用、同事务管理、outbox/fence回归及设备冷启动接线 |
| A29 | 响应未验证/修复未采用 | PASS | ready-write崩溃复用响应0HTTP；校验未完成不补造成功 |
| A30 | 删除/意图变化/源替换 | PASS | HTTP中取消/修改fence；旧worker不复活候选，绑定变化stale |
| A31 | 回退/双分支隔离 | PASS | 完整runtime/知识/后果/归档重绑回归；UI实际v12回退分支，主机相同基点 |
| A32 | 导出导入继续/坏引用旧版 | PASS | 生产重规划→save-10重复同库导入→继续；碰撞重绑、hash篡改和旧版拒绝 |
| A33 | 隐藏身份/别名/日志 | PASS | 公开投影/Narrator最小材料门；旧报告凭据元数据删除，不输出认证请求 |
| A34 | 阶段/自然结束UI一致 | PASS | final29在原camp-muxpraio-main v33实际复验主线已结束、完成阶段、最终叙事及campaign_ending，旧战役办法退出。snapshot/runtime/全部归档hash、fulfilled旧承诺与v37分叉不变；新增0决定/0HTTP，final29-ending-reacceptance.json。不证明安娜获救或A38完整旅程 |
| A35 | 前后台/键盘/小屏/主题/字体 | PASS | final14完整360/411dp×1.3/2字号、键盘/前后台、动态字号、草稿及四主题证据保留原身份；其它显示源码等价证明另存。R36涉及开局恢复显示，final29实际补验360/411dp fontScale2：完整未知提示可读、恢复/取消滚动可达，状态/意图不变。未声称重跑全部历史主题矩阵 |
| A36 | 三意图六维质量 | FAIL | CONTENT_QUALITY分开评价计划/旅程：final23救援早结局、final25调查短于配额、final27调查7项后invalid/合作重复及旧承诺门控，均至少一维低于3。final28 high三份未知结果没有可评分计划；必要门修复不自动提高历史评分，独立试玩未验 |
| A37 | 回合/规划调用耗时 | NOT RUN | 通常Planner+Narrator两次、无固定导演；匹配10基线+10新回合对照未齐 |
| A38 | 最终源码/APK/真实证据 | NOT RUN | final29 scope v3源码53629ccf…与实际安装APK1b8eb52f…一致，工程1042/1042；最终身份新增有效旅程配额0。旧final18 UI20+10声明已撤销，final23/25/27诊断不跨身份拼数；最终80及必需UI20+10仍未齐 |
| A39 | 同世界三战役隔离 | PASS | 同world独立campaign/branch/intent/content/事件；分叉与存档继续回归 |
| A40 | 100/300/1000本地累积 | PASS | 实际生产Session/SQLite全量回归，snapshot5128/5129/5133、runtime1414/1414/1415 bytes、结构1412恒定、jobs1；范围为已准备局面，不外推无限归档 |

汇总：PASS 29 / FAIL 2 / NOT RUN 9 / BLOCKED 0，合计40。A34在final29原档复验保持PASS；A15/A36保持FAIL、A19/A38保持NOT RUN。修复共用边界与必要作者门不能直接替代真实内容、配额、持续后果和性能验收。
