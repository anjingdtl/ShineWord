# ShineWord 开发状态

更新日期：2026-09-26

## 当前阶段

### M0 方案与抽取审计 — 进行中

已完成：

- [x] 锁定 `tavo-mini` 第一轮参考提交。
- [x] 核查 React Native / React / TypeScript / SQLite / Keychain 技术基线。
- [x] 检查 TXT 导入、LLM 入口、安全存储、上下文预算四个核心模块。
- [x] 明确第一轮复用与不复用边界。
- [ ] 进入对应功能开发前，对 Provider、Scheduler、TXT Streaming、Parser、数据库迁移做函数级审计。

### M1 确定性内核 — 进行中

已落地：

- [x] ShineWord Ruleset V0.1 常量与 JSON 规则包。
- [x] 六属性基础约束（1～3）。
- [x] 未训练 d4 / 入门 d6 / 熟练 d8 / 精通 d10 / 大师 d12。
- [x] `clamp(属性 + 情境修正, 1, 4)` 骰池。
- [x] 多骰取最高与精确成功率公式。
- [x] 四档结果等级。
- [x] 行动资格预判：阻断 / 自动成功 / 需要检定。
- [x] Action Contract TypeScript 模型与 JSON Schema。
- [x] 禁止 Planner 注入骰点、骰池、结果等级等本地权威字段。
- [x] 回合状态机及非法跳转阻断。
- [x] 可注入随机源与不可变 RollRecord 基础结构。
- [x] 11 项自动测试通过。
- [x] GitHub Actions 核心验证工作流，不上传构建产物。

尚未完成：

- [ ] Android 原生安全随机源（拒绝采样）。
- [ ] Action Contract 稳定序列化与哈希。
- [ ] SQLite schema、事务、stateVersion、幂等提交。
- [ ] branch event / snapshot / RollRecord 持久化。
- [ ] 断电/杀进程恢复夹具。
- [ ] 固定小世界的无 LLM 完整回合模拟器。

## 本地验证命令

```bash
npm install
npm run verify:core
```

当前测试覆盖建设方案中的首个骰点样例及关键边界，但不代表 M1 已验收完成。
