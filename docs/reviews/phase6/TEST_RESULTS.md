# 第六阶段测试结果

| 阶段 | 命令/场景 | 退出码/结果 | 证据与边界 |
|---|---|---|---|
| P6-0 | git merge-base --is-ancestor 5103397 origin/main | 0 | 基线 HEAD 与方案提交相同 |
| P6-0 | npm ci / npm ci --prefix mobile | 0 | Node 24.19.0，成功安装 |
| P6-0 | npm run verify:core（未修改基线） | 0；620/620 | /workspace/scratch/phase6-baseline-core.log；纯工程，不是真实 API 验收 |

后续按实际命令、退出码、场景和未验范围追加。小说全文、凭据、未脱敏请求和构建产物不入库。

| P6-0 | npm run build:core + node --test tests/phase6-contracts.test.cjs | 0；3/3 | legacy range / source membership / frozen intent 合同 |
| P6-0 | npm run typecheck --prefix mobile | 0 | /workspace/scratch/phase6-baseline-mobile.log |
