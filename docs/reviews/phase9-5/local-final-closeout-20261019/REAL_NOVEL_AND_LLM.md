# 真实小说与 GLM 验证摘要

日期：2026-10-19。逐请求脱敏证据与旧 scope 细节见 [2026-10-18/19 主报告](../local-final-closeout-20261018/REAL_NOVEL_AND_LLM.md)。

## 真实小说与内容审查

- 本地小说文件 7,178,905 bytes，SHA-256 7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4；实际 Android SAF 导入使用 GBK 编码。
- 一个隔离开篇样本仅取 9,601 code points，走生产 timeline、world_extract、world_mapping 共 3 个真实 GLM 请求，串行完成，均 HTTP 200；该 sample 429=0、unknown=0。
- 新世界包被既有审查门正确拦住：1 个 blocking mapping_constraint、3 个 major invalid_proposal。没有自动选案、放宽 validator 或发布未通过审查的包。该包无 method entry，因此真实小说包的非空来源 evidence L1 仍未覆盖。
- 先前真实 Android QA 已在小说衍生内容上完成 19 个 agent-driven actions。它们不是用户玩家决定。真人体验由世恒哥后续进行。

## GLM 路由、因果与预算

- 真实 endpoint 已知记录合计 113 次：112 HTTP 200、1 次密钥轮换前旧 profile HTTP 401；旧 401 未重派。另有两次宿主机 transport unknown 且 attempt identity 未持久化，均未重派。真实 endpoint 429=0。
- GLM 429 复核证明设备那条 429 请求冻结指向本地 10.0.2.2:8765 合成 fault fixture，并非 GLM 的审核响应。之后独立 9,601 code-point 样本、matched 10+10 与两个终局 Narrator request 都没有真实 429。
- 同一 production CampaignSession synthetic fixture 上 10 次 L1 与 10 次 L2 均提交成功：L1 每次仅 Narrator，L2 每次顺序 Planner+Narrator；30 次 HTTP 200，最大并发 1。L1 平均 6,705 ms，L2 平均 8,901 ms。此结果不代表真实小说包的 evidence/method 覆盖或人民币账单。
- 已记录成功 token 用量 input/output/reasoning 1,152,193 / 265,801 / 41,097；应用 ledger 不含实际人民币账单，所以金额未知。用户已明确授权项目测试不受额度上限，执行继续保持单请求串行；最终 M4 本地 mock test 没有调用 GLM。

## 结论

本地样本支持真实模型的所测 opening/route，而不能证明整本小说全部内容均能通过审查。发布阻滞是未通过的内容审查与缺少真实包 method/L1 样本，不是 429。所有 unknown 继续按原身份保留。
