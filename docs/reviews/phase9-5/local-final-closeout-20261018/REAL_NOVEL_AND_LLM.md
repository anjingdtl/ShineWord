# M2：真实小说导入与 GLM 开篇样本

日期：2026-10-18（Asia/Shanghai）
状态：PARTIAL；小说 SAF 导入和部分世界包发布已在专用模拟器完成，完整真实模型开局与 L1 资格尚未通过。

## 材料与隔离

- 用户原始 TXT：7,178,905 bytes；SHA-256 `7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4`；本机检测编码 Windows-936/GBK。
- 为建立独立 GLM 测试世界，在私有目录中制作了仅追加 CRLF 的副本：7,178,907 bytes；SHA-256 `2D4AD3AAA7793C0BE690DE6E380DE88F1FAC7E78CD725C3D74E3F92B0BECBFD8`。原文件未修改；小说正文、模型提示词和响应没有加入仓库。
- 通过 Android SAF 导入该副本。设备解析出 1,504 个章节和 3,260 个 source chunks；最初离线标题计数为 1,498，计数定义不同造成的 6 项差异尚未归因，不能把二者当作相同指标。
- 本轮模型只收到开篇 0–9,600 code points 的分段样本；未构建或发送全书。项目页面显示 partial package ready，可进入开局向导。

## 发布与内容门

- 世界包 revision 1–3 均为 published，scope 均为 source 0–9,600 code points、partial；运行状态最终为 completed，segment 状态为 ready，项目 build_status 为 ready。
- 样本汇总：49 条 explicit facts、3 条 inference facts；52 个事实来源引用分布于 4 个章节；公开包包含 8 个技能、4 个场景和 11 个公开角色模板。这里是计数，不代表内容质量或来源完备验收。
- 开局向导成功加载世界起点与身份页；“原创旅人”处于产品默认值、姓名为空，下一步不可提交。没有角色、战役或行动被创建。
- 配置更新后的复核（2026-10-18 14:29 Asia/Shanghai）：用户确认 GLM 配置连接测试成功；进入可游玩世界后，开局页按当前锚点自动取得 goal suggestions。账本新增一条 `opening_goal` HTTP 200（185 input / 39 output / 0 reasoning tokens，6.11 s）。身份页仍显示产品默认“原创旅人”、姓名为空、下一步禁用；没有替玩家选择、命名或创建角色/战役。截图：[身份选择与真实开局请求后的页面](evidence/android-opening-goal-success-and-player-decision.png)。
- 本样本未确认一个同时具备 fixed difficulty、evidence binding 与规则绑定的 published L1 method。现有 package 结构没有显示这些资格字段，因此不把技能/场景数量当作 L1 PASS；真实 L1/L2 行动验证仍未完成。

## 物理请求和耗时

用户在本轮明确授权不受模型额度限制；执行时物理并发维持 1。设备账本记录：

| Request kind | Result | HTTP | Input / output / reasoning tokens | Duration |
|---|---|---:|---:|---:|
| world_extract | succeeded | 200 | 5,011 / 3,033 / 13 | 40.95 s |
| world_extract | succeeded | 200 | 2,898 / 2,758 / 7 | 35.80 s |
| style_analyzer | succeeded | 200 | 1,660 / 410 / 0 | 12.15 s |
| opening_goal | failed, known auth rejection（更新配置前） | 401 | no usage reported | 2.19 s |
| opening_goal | succeeded（更新配置后） | 200 | 185 / 39 / 0 | 6.11 s |

成功请求合计 4 次，输入 9,754、输出 6,240、reasoning 20 tokens；另有 1 次已知 401 失败，无 provider request ID、无 usage，不是 outcome_unknown。配置连接测试是独立于应用物理请求账本的验证，不计入上表。实际人民币费用无法由设备账本确认；用户的不限额度授权替代附件默认 20 次/¥10 上限，不能据此声称费用为零。

实测从测试世界创建 13:16:34.738 到 ready 13:25:19.020，约 8 分 44 秒；两个 extraction 请求耗时合计约 77 秒，style analyzer 约 12 秒，其余等待/本地阶段没有拆分计时，故首次可玩耗时不能归因于模型。完整小说构建成本没有估算，也未启动。

## 隔离故障项目

原文件另有一个仅用于本地故障注入的项目：本地 loopback fixture 返回 1 次合成 HTTP 429；随后一条 network_unknown/outcome_unknown 记录无 HTTP 状态、无 provider request ID、无 tokens。该 frozen config 指向本机代理而不是 GLM。此项目保留 needs_review，未确认、未清账、未重派，也没有产生第三次请求。

## 阻滞

1. 更新前的 opening_goal HTTP 401 失败仍保留原始 ledger 记录；更新配置后的新请求已 HTTP 200，未重派旧失败，也没有 `outcome_unknown`。
2. 当前停在真实玩家身份与姓名决定之前；需要真人继续选择角色、目标/锚点和行动，才可验证 L1/L2、骰点、Narrator、commit 和下一轮剧情。
3. 需要真实 L1 eligible method 与后续行动因果样本；当前已发布 partial package 不足以证明。
4. 小说标题计数 1,498 与设备 parser 1,504 的差异待查；当前没有正文级人工 QA。
