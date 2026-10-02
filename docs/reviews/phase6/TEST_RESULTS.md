# 第六阶段测试结果

| 阶段 | 命令/场景 | 退出码/结果 | 证据与边界 |
|---|---|---|---|
| P6-0 | git merge-base --is-ancestor 5103397 origin/main | 0 | 基线 HEAD 与方案提交相同 |
| P6-0 | npm ci / npm ci --prefix mobile | 0 | Node 24.19.0，成功安装 |
| P6-0 | npm run verify:core（未修改基线） | 0；620/620 | /workspace/scratch/phase6-baseline-core.log；纯工程，不是真实 API 验收 |

后续按实际命令、退出码、场景和未验范围追加。小说全文、凭据、未脱敏请求和构建产物不入库。

| P6-0 | npm run build:core + node --test tests/phase6-contracts.test.cjs | 0；3/3 | legacy range / source membership / frozen intent 合同 |
| P6-0 | npm run typecheck --prefix mobile | 0 | /workspace/scratch/phase6-baseline-mobile.log |

P6-1/P6-2 基础定向验证（2026-10-02）：`npm run build:core` 退出 0；`node --test tests/phase6-*.test.cjs` 退出 0，76/76 通过。覆盖真实流式 UTF-8/GBK 夹具、持久索引/别名/权限/损坏、并发与持久资源队列、段计划/需求去重、映射范围/fencing、成果 hash/事务采用、风格三模式/用户覆盖/重试。均为可执行协议/故障测试，非真实模型内容或设备性能结论。移动端 `npm run typecheck --prefix mobile` 退出 0。

| P6-3 | npm run verify:core | 0；741/741 | phase6-core.log，含完整旧回归、新协议/事务/故障；没有跳过/删除/降低断言 |
| P6-3 | npm run typecheck --prefix mobile / git diff --check | 0 / 0 | production UI、host、session、存档接线 |
| P6-3 | ledger/provider/Android DB定向 | 0；73/73 | phase6-ledger-races.log，含双host、sent原子、未知结局、真正连接失败、429、删除queued、冷cache事务 |
| P6-3 | M5定向隔离编译 | 0；19/19 | phase6-publication-final.log，fence/source/canon/review后写、通用actor负例、旧delta事务重基 |
| P6-3 | sourceImport + 10%粗读协议 | 0；6/6 | phase6-survey.log；码点含emoji、缓存、错误引用、删除、所在地值；合成不证明真实内容 |
| P6-3 | 原生standalone Debug / API30安装 | 0 / Success | phase6-apk.log；boot_completed=1，首配屏截图在私有scratch；最终改动需重建 |
