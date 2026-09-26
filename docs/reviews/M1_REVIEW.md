# M1 Review / Fix 报告

日期：2026-09-26  
Review 分支：`phase/m1-finalize`

## Review 范围

- 骰子、概率、资格判定与四档后果。
- Action Contract、稳定序列化与合同哈希。
- RollRecord 先于 Narrator 持久化及重启复用。
- stateVersion、幂等提交、分支隔离、SQLite 原子事务。
- schema migration。
- Android SecureRandom 平台端口。
- React Native SQLite 平台端口。
- Turn 恢复策略。
- 无 LLM 单回合及三回合固定世界。

## 发现问题

首次 review CI 发现：

`recovery.ts TS2678: Type "Committed" is not comparable...`

原因是函数入口已经提前处理 `Committed`，TypeScript 正确将后续 switch 窄化，switch 内重复的 `Committed` case 成为不可达分支。

## Fix

删除不可达 case，保留入口的 committed 优先处理。该修复同时强化了恢复规则：只要数据库已有 committed result，UI 回执丢失也必须读取既有结果，不可重新结算。

## 回归结果

GitHub Actions `Core Verify`：

- tests: 32
- pass: 32
- fail: 0
- typecheck: pass

M1 出口条件满足：完全不依赖 LLM 可模拟连续行动；概率、幂等、持久化、恢复与分支隔离均有自动测试。
