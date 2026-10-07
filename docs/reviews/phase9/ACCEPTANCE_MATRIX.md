# Phase 9 验收矩阵 A01–A40

2026-10-07收尾复验。整体尚未通过。PASS=完整项有直接证据；FAIL=实际不符合合同；NOT RUN=完整场景或必需证据未齐；BLOCKED=外部阻断。本轮无BLOCKED。不使用PART。

工程证据：tests/phase9-closeout.test.cjs、phase9-flow/turns/planning/replan/sqlite.test.cjs、phase6-mobile-runtime.test.cjs；日志 .tmp/phase9/reaccept-core-final17.log（1004/1004）。私有实际样本/身份见REAL_JOURNEYS。工程安全拒绝不等于内容质量通过。

| ID | 场景 | 状态 | 证据/缺口 |
|---|---|---|---|
| A01 | 同小说同起点不同意图 | PASS | 同一序7边陲镇世界，自动保护探视/调查矿区/合作救援目标与办法不同；质量另见A36 |
| A02 | 原著/原创及换起点 | NOT RUN | canon真实资格/未来技能拒绝本地通过，完整真实换起点未齐 |
| A03 | 部分ready与后段依赖 | NOT RUN | 全TXT生产导入，已采用原文进入重规划/源变化stale回归；真实按需后段建设到采用未齐 |
| A04 | 明确目标/探索待选 | PASS | 双goalMode与完整intent，开局/管理无叙事卡仍有当前办法 |
| A05 | 计划死亡尚未行动 | PASS | 未来计划不改生死/经历；已提交事实和原子归约是实际进度权威 |
| A06 | 救下原著将死角色 | NOT RUN | 终态保护工程通过；真实成功救援后持续存活未齐 |
| A07 | JSON截断/非法引用/修复 | PASS | 完整冻结约束一次修复；非法条件/效果/奖励/null集合不ready；等级白名单明确反馈；R19真实缺targetId响应恢复invalid，该任务原2HTTP未重发；R20真实两请求ready；R21原文重新编译同hash，畸形前置条件invalid/零发送重入 |
| A08 | ready前强停/占位恢复 | PASS | 原响应/ready完整恢复0HTTP；设备提案冷启动恢复采用；损坏与占位拒绝 |
| A09 | 双击开始/事务中断 | PASS | setup/job fence、幂等采用、原子完整创建、候选主体hash门禁 |
| A10 | 两路线与后续回响 | NOT RUN | 机制权威差异工程通过；真实相同快照各10与后续机会未齐 |
| A11 | 点选/同义自由输入 | PASS | 同methodId/outcomeSetHash；可选技能字段不丢后果；设备真实绑定有效 |
| A12 | 模板外能力允许组合 | NOT RUN | 样本均已列办法/改写，不冒充新组合支持 |
| A13 | 非法ID/跨场景/过期 | PASS | offsite真实候选拒绝；伪造/过期选择及改意图工程拒绝 |
| A14 | 固定四档骰点 | PASS | 四档投骰前冻结同事务提交、原骰恢复、资源上下限与零余额回归 |
| A15 | 无风险/日常/连续失败 | FAIL | automatic工程通过；final18 J1真实连续失败旅程已发生（3次阶段失败→自动重规划→second-chance→再推进），但重规划内容full_success门控致局面停滞，停滞守卫4次触发，节奏缺陷未消 |
| A16 | changed/no_change | PASS | 无关动作不改进度；完成证据推进；更晚期限不覆盖先前完成理由 |
| A17 | 提前解决/绕过/奖励 | PASS | 早完成/跳过/终态保护与分叉奖励去重生产回归 |
| A18 | 偏离/暂停/换目标 | PASS | 生产pause/explore/resume与goal_changed回归；设备暂停/恢复入口实测 |
| A19 | 隔两决定后人情/承诺用途 | NOT RUN | 本地延迟一次触发与旧承诺兑现通过；旧camp-muxn9k9t有1个后果v4创建v6触发（final17诊断），final18最终J1战役模型未生成持续后果，两个持续后果的真实旅程仍未齐 |
| A20 | 重规划在途/事实变化 | PASS | 稳定边界双CAS、pending拒绝、源绑定同版本stale；真实有效采用已有 |
| A21 | 触发合并/后台竞争/失败 | PASS | durable单飞/租约fence/两HTTP共享；invalid不自动重发，显式新任务恢复 |
| A22 | 目标/顺序/规则/风格身份 | PASS | 完整意图/选项/材料/角色/规则冻结，live不替代旧池；ready主体hash |
| A23 | schema/校验工件/阶段恢复 | PASS | 不可变归档完整往返；原响应先落盘，成功阶段0HTTP恢复 |
| A24 | 损坏冻结 | PASS | 坏JSON/hash保留证据零HTTP；无live fallback；ready篡改拒绝 |
| A25 | 材料超窗/未知能力 | PASS | 预派发拒绝不裁意图；显式能力声明，设备未知能力失败已观察 |
| A26 | 单请求/任务/总预算全账 | NOT RUN | 新派发持久原子计数、任务2次已验；历史313含估计不能称全历史100% |
| A27 | reasoning-only/429/网络/未知 | PASS | 受控分类与有界修复；未知保留且不自动重发，真实后续错误分类另记录 |
| A28 | 检定/采用/提交/lease强停 | PASS | 原骰复用、同事务管理、outbox/fence回归及设备冷启动接线 |
| A29 | 响应未验证/修复未采用 | PASS | ready-write崩溃复用响应0HTTP；校验未完成不补造成功 |
| A30 | 删除/意图变化/源替换 | PASS | HTTP中取消/修改fence；旧worker不复活候选，绑定变化stale |
| A31 | 回退/双分支隔离 | PASS | 完整runtime/知识/后果/归档重绑回归；UI实际v12回退分支，主机相同基点 |
| A32 | 导出导入继续/坏引用旧版 | PASS | 生产重规划→save-10重复同库导入→继续；碰撞重绑、hash篡改和旧版拒绝 |
| A33 | 隐藏身份/别名/日志 | PASS | 公开投影/Narrator最小材料门；旧报告凭据元数据删除，不输出认证请求 |
| A34 | 阶段/自然结束UI一致 | NOT RUN | 设备首阶段已完成；主机9决定自然completed停止；设备结束一致性未齐 |
| A35 | 前后台/键盘/小屏/主题/字体 | PASS | final14实际截图：360/411dp×1.3/2四组冷启动/键盘/主线底部/目标键盘/前后台；动态字号三次；草稿及个人页路由保留；四主题主线/展开面板各一组。关闭后无Modal/IME，v24未变；旧到期成果显示待复核；final17显示源码与final14逐文件相同 |
| A36 | 三意图六维质量 | FAIL | final18 J1：机械重复/节奏停滞复现（full_success门控重规划阶段，success档仅推计数不入completion）；本战役无持续后果；每维至少3未满足 |
| A37 | 回合/规划调用耗时 | NOT RUN | 通常Planner+Narrator两次、无固定导演；匹配10基线+10新回合对照未齐 |
| A38 | 最终源码/APK/真实证据 | NOT RUN | **必需设备UI20+10已在final18同身份完成**（J1 23决定、J4分支10决定，见REAL_JOURNEYS）；最终80（host J1/J2/J3各20+J4各10）仍未齐 |
| A39 | 同世界三战役隔离 | PASS | 同world独立campaign/branch/intent/content/事件；分叉与存档继续回归 |
| A40 | 100/300/1000本地累积 | PASS | 实际生产Session/SQLite全量回归，snapshot5128/5129/5133、runtime1414/1414/1415 bytes、结构1412恒定、jobs1；范围为已准备局面，不外推无限归档 |

汇总：PASS 28 / FAIL 2 / NOT RUN 10 / BLOCKED 0，合计40。状态必须随完整受影响复验更新，不删除失败或放宽合同。接手轮（2026-10-07下午）新增final18同身份设备UI20+10证据，A15/A19/A36/A38证据行已更新，A15/A36保持FAIL、A19保持NOT RUN。
