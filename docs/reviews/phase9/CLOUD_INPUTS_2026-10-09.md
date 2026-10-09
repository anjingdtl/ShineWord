# Phase 9 云端真实输入接入与验证

2026-10-09 UTC，接续生产提交 `3c79bad72bfe0fa261d315bb793823c60d6a9694`。用户补交了《放开那个女巫》TXT 和智谱 GLM 配置及凭据。本批已完成真实小说的生产导入、持久化和完整冷读验证；云网络代理拒绝模型域名连接，未调用模型。第九阶段仍 **29 PASS / 2 FAIL / 9 NOT RUN**，没有新增 ready、采用或有效决定。

## 实际输入与生产导入

| 项目 | 本批实际证据 |
|---|---|
| 原文 | 用户上传 TXT，7,178,905 bytes，严格 GB18030 解码 |
| 原文 SHA-256 | `7f45fe0b11ea30eca95f5a736232dd4c466a57c0f2cc9f67530e432015ecc6f4`，与原交接完全一致 |
| 实际接线 | `tools/phase9-cloud-source.cjs` → `importTxtSourceStreaming` → `SqliteSourceStore` → Node SQLite；SQL adapter 复用工程工具，未创建受控 provider 或 RNG |
| 数据库 | 独立 `.tmp/phase9/cloud-source/source.sqlite`；不是 final48 数据库的迁移或替代，未清库、覆盖旧档案 |
| source | `src-cloud-7f45fe0b11ea30ec`，active，standard 分章 |
| 规范化结果 | 3,460,333 code points；1504 条章节记录、3260 个块、106 个文本分片 |
| 树哈希 | `0da219dd69f381ea32f18a669cfee93ef2c3fc63e0f4ed8a7d71f4cb28740ec1`，冷读重算一致 |
| 全文 SHA-256 | 规范化 UTF-8 `77e83daf578cecd2a11dea38ae8068c24a542f9385693488af9a310ef07431be`；拼接实际数据库分片与独立完整解码后的生产批量 normalizeText 一致 |
| 持久完整性 | PRAGMA quick_check=ok；连续 code-point 范围完整；全部4764条章节/块 readRange 内容 hash 一致 |
| 重入 | 首次真实导入和两次独立冷读复用成功；复用 active 原文，不重新导入或清理 staging；不完整 source 明确停止审计 |
| 付费/内容 | 本库 llm_request_attempts=0、world_packages=0、canon_facts=0；没有伪造事实、世界或候选 |

首次证据 `.tmp/phase9/cloud-source/source-evidence-initial.json` 保留，后续 `source-evidence.json` 增加树哈希与 QA 驱动哈希。日志为 `cloud-novel-import.log`、`cloud-novel-cold-reuse.log`、`cloud-novel-verified.log`。验证完整全文时使用批量内存比对，不把它当作移动端内存或性能基准。

复用方法（Node≥24.3，先编译当前核心）：

```bash
npm run build:core
node tools/phase9-cloud-source.cjs /absolute/path/to/real-novel.txt
```

工具仅导入真实 TXT，不会抽取、规划、采用、投骰或请求模型。原文和 SQLite 保存在忽略目录；不完整导入不自动删除重建。它新增了可复用的源码/SQL 验证入口，没有新增世界资料建设或旅程验收信用。

## GLM 配置和实际访问结果

用户指定 OpenAI 兼容端点 `https://open.bigmodel.cn/api/coding/paas/v4`、模型 `GLM-5.3-Flash`，另给 `https://open.bigmodel.cn/api/anthropic`。生产 GLM adapter 的 chat/completions 接线使用前者；不自动切换到不同协议。

准备配置保留交接的 **high** 档位和显式能力声明：contextWindow=1048576、maxOutputTokens=65536、contentOutputTokens=16384，JSON/streaming/usage/prompt-cache 均声明支持，concurrency=1。声明来自交接而非型号推断；尚未远程验证。配置和来源说明在忽略目录 `cloud-source/llm-inputs.json`，只保存 keyRef，密钥值没有写入文件、Git、环境草稿或日志。

原 final48 的 wire=60921 / reserve=48633 只是历史观测；没有将这两个数字伪造为本库可信 reasoning usage 或冻结预算。历史 profile ID、指纹、原始 usage 和 attempts 未迁移，不能以相同型号/档位声称恢复了校准历史。

在继承的云代理下进行一次**无认证、无生成**的 `/models` 元数据访问，实际结果为 `curl: (56) CONNECT tunnel failed, response 403`，响应来自 envoy。请求没有到达模型服务，不能据此判断 API key、模型权限或服务端能力。证据 `.tmp/phase9/cloud-glm-access.headers`。没有绕过代理、关闭 TLS 或改用备用端点重试。

已通过云环境配置工具保存 network 草稿，custom domains 为 `repo.reactnative.dev` 和 `open.bigmodel.cn`，保留已有 React Native 域名。配置服务确认 saved / requires_publish=true；实际 runtime 仍未包含模型域名，草稿不等于已应用。需在环境设置审阅保存后 Publish；没有要求用户重复授权模型测试或重复提供凭据。

环境运行技能 [cloud-environment-runtime/SKILL.md](skill://plugin_connector_1p_c5b7d5df5d7081918f2c4be5a633ed5d/cloud-environment-runtime/SKILL.md) 明确规定：“Configuration changes require the environment configuration workflow and its user review.” 因此通过配置草稿承接实际403，继续独立验证，不绕过目的地限制。新任务恢复和未推送提交的自动恢复尚未验证。

## 驱动审查与付费边界

现有 `real-glm-phase9.cjs` / `real-glm-phase9-replan.cjs` 不作为本批最终验收驱动运行：

- 两个入口仍固定 low / 32768 / 非流式，并引用原 Windows 资产路径，与 final48 的 high / 65536 / streaming 不同。
- 主驱动自动把 canon 冲突标成 complementary、循环请求资料建设/规划；不能取代正式事实审查，也不能自动重放未知结果。
- replan 入口没有接 `reservePhysicalRequest`，不能承接全局1210/1500预算。仅有 SQL ledger 不足以替代共享物理上限。
- 旧主机接线不含当前 segment runtime；J4 旧计数不能直接代表有意义决定。需要按生产当前目录/segment/采用/检定/提交链路接线并逐项审核实际新后果。
- 当前 Node 云传输需使用继承的代理及 CA，核对整个请求的 deadline、SSE 完结、实际物理账本与未知结果分类；不能以旧300秒 fetch 配置替代生产 high 规划的有界时限。

本批只做只读审查和零模型调用的资料导入，没有执行这些旧入口。真实驱动在正式派发前需接统一预算/账本、当前生产 segment 服务、完整冻结材料和自然 RNG，且使用明确 high 声明；不能通过静默降档、截意图、固定旧 wire 或连续同预算重试来获得候选。

共享 QA manifest 继续承接 **1210/1500，余290**，新增云模型物理请求 **0**。现有 carry-forward checkpoint 不是原历史 manifest 的完整对账。J1 cancelled/outcome_unknown、J2/J3 原 running/sent 的状态仍只来自原交接；原库和完整响应不在云端，未自动重发、未改写为 retryable。

## 当前身份、验收与下一步

本批仅修改 QA 工具和文档；生产源码和现有 APK 没有变化：

| 身份/门禁 | 状态 |
|---|---|
| productionSourcesHash，scope v3 | `923400d6c4105196badab0c3aa7a2c5e7a2999641b64106c68346bf4f7bcf64c` |
| Debug APK SHA-256 | `97dd794d2935f486aff762bc62344de18ebecab6ba1bfc7df2df2d80c8c3a098` |
| 上批工程门禁 | 1167/1167、移动类型/版本、Debug APK 通过，详见 [R57–R59](CLOUD_REVIEW_R57_R59_2026-10-08.md)；本批未声称再次跑完整工程或端上复验 |
| 本批适用验证 | CLI node --check；真实首次导入、重复冷读、全范围及4764条hash、全文及树哈希比对 |
| 最终同身份配额 | J1/J2/J3 各0/20，J4 A/B各0/10；Android J1 UI0/20、J4一路UI0/10 |
| 第九阶段 | 29 PASS / 2 FAIL / 9 NOT RUN，A15/A36仍FAIL；质量评分未上调 |

**已解除的依赖**：小说缺失；用户未提供模型端点、型号和 API 凭据。**当前实际依赖**：模型域名配置未应用/认证未验证；原 final48 数据库、完整响应、历史 attempts/预算校准/identity manifest 与私有驱动未迁移；adb设备0且无 emulator/KVM。现在不能再把“没有小说/用户未提供凭据”写成当前阻断。

模型域名可访问后，先验证真实认证与显式配置；旧任务仍须只读审计完整响应、冻结根和历史账本，未知 sent 不重放。恢复原已发布资料比重新付费建设更适合有限余量；不得把本库 source-only 状态当成原世界r1/已发布segment已经迁移。完成受控驱动接线后，在同源码/APK身份上开展三意图真实规划与旅程。后果持续、六维每维≥3、角色/起点、后段建设采用、救援持续存活、模板外组合和同模型/档位/设备/资料10+10性能对照均尚未完成，不能宣布第九阶段通过。
