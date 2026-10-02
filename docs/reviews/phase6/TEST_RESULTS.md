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

| P6-4 | 首轮 npm run verify:core | 1；748/751 | 3 个 runtime 夹具缺新增端口，修复后不跳过断言 |
| P6-4 | npm run verify:core（修复后） | 0；752/752 | phase6-p4-final-core.log；迁移、恢复、旧回归、新开局合同 |
| P6-4 | build:core + segments/runtime/incremental/campaign/migrations | 0；39/39 | phase6-p4-retest.log；API更换新冻结intent/unknown阻断/旧操作FK |
| P6-4 | NPC物品与发现投影修复后的 campaign/segments/runtime | 0；23/23 | phase6-p4-final-targets.log；本地commit，不在后台写人物 |
| P6-4 | npm run typecheck --prefix mobile / git diff --check | 0 / 0 | phase6-p4-mobile.log |

P6-5 探索中的真实样本（非性能完整验收）：用户授权小说 UTF-8，7,178,905 字节，3,460,333 规范化码点、1504 章；GLM-5.3-Flash、low、同一 Linux 主机。全新本地项目一次定向抽取，导入 9.142 秒、抽取及发布 42.859 秒、TTFP 52.046 秒，29 facts / 6 events / 1 artifact；1 次真实 HTTP200，provider usage 5064 input / 2995 output / 8059 total，cached input 5056。服务端缓存为热，不能称全冷样本或真机数据。负例以及已有响应本地修复后的成功分别记录，不能合并为稳定成功率。

| P6-5 | npm run verify:core（最终内容接线后） | 0；761/761 | phase6-p5-complete-core.log；包括证据确认→段知识→下一动作NPC载入、旧全量回归，无 skipped/todo |
| P6-5 | npm run typecheck --prefix mobile / git diff --check | 0 / 0 | phase6-p5-complete-mobile.log；定向 knowledge 集成 9/9 |
| P6-5 | 真实第一后段补建与采用 | 完成，74.368 秒 | MEASUREMENTS.json；抽取1次+映射2次；第二次仅抽取，映射请求上限阻断，未算通过 |
| P6-5 | 真实风格独立分析 | ready，13.507 秒 | 之前 prohibitions 字符串失败保留；仅提示词闭合说明修复，解析门禁不变 |
