# 因果分支与后果回放

## 实际链路

存档导入从 stateVersion 27 建立新战役 camp-mv5kpgrf。turn-0028 在 v27→28 自然失败后，正式重规划采用修订 11；随后在 stateVersion 30 采用修订 12。修订 1–10 保留，11/12 是新增而非覆盖。

turn-0031 从 v30→31 自然成功，使用修订 12 内容履约承诺。状态增加 plan_ready 10 和关系 2，并安排两项需后续阶段 9 成功才触发的后果。turn-0032、turn-0033 随后自然提交严重失败和成功；到 v33 阶段仍 active。

## 冻结绑定与隔离

- turn-0028 frozen turn context root SHA-256：50708f4f0baec0e8603eedda874b0862df1459398cf7ac5b361a51e5f2d38c9e。
- 该材料绑定 stateVersion 27、基础 content manifest 690e22eabcea732f660c306d3134a3d43bfec882ed43d8b4e077d0ee863f8778，以及当时 revision 1–10 的 campaign content binding。
- turn-0031 frozen context root SHA-256：3f6646348ea12c75d7a68056f21760caf9af519a5fff5ac0a17b6dacaae29233；其内容绑定已包括 revision 11/12。
- 两项延迟后果只记录在导入副本的 branch_events；到 v33 尚未触发。
- 来源分支仍 v27；J1 仍 v70，turn-0071 未提交，未发现跨分支回写。

## 未完成的因果合同

V95-07 要求至少一组三路分支汇合，并证明持久状态、代价/条件、两个有效决策及下游消费。本次只有一个导入副本内的计划更新、承诺履约和两项待触发后果；没有三路 fork/converge，也没有后果触发并被后续方法使用。V95-07 仍 NOT RUN。
