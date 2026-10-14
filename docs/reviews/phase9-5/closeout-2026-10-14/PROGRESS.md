# 进度文档 — 阶段 9.5 收尾 2026-10-14

## 一句话状态

**代码与确定性合同 PASS；真实旅程与外部项待办。** 本轮关闭了 G2/V95-07 的根因（延迟后果生命周期），全部工程硬门实跑通过；真实模型旅程因预算代理指纹绑定未完成而未执行。

## 任务书四个阶段的实际完成度

| 阶段 | 出口条件 | 状态 |
|---|---|---|
| A 重建验证环境 | APK 装好、QA 分支可用、账本对清 | **完成**（QA 分支待真实请求前才创建） |
| B 语义收尾 | 两条真实后果触发并被下游消费 | **部分**：代码缺口已修，真实旅程未跑 |
| C 真实旅程 | 本地可执行项全部闭环或登记 | **未执行**：预算代理绑定未完成，已如实登记 |
| D 分箱收口与终态报告 | 终态报告落盘 | **完成** |

## 已完成

1. **环境重建**：上一轮"安全恢复点"确已丢失（`F:\sw95` 不存在；本机 AVD 底包 2026-09-29，无 v31 分支）。从 HEAD 完整重建：构建 APK、核对设备端哈希一致、安装、冷启动。
2. **根因 #2 修复**（G2/V95-07 根因）：新增 `consequenceLifecycle.ts`，补齐 `discharged`/`cancelled` 两条从未被赋值的生命周期路径，并接入结算层。
3. **门禁全绿**：`verify:core` 1311/1311、`verify:version` OK、mobile typecheck 通过、`apk:debug` SUCCESS、`git diff --check` 干净、`install -r` 保留数据后冷启动成功。
4. **账本对清**：全新安装，`llm_requests` / `llm_request_attempts` 均 0 行，无 `outcome_unknown`。合同账本 1291/1500 未动；新建 scoped 账本从 0 起记。
5. **连通性恢复**：测试凭据已可用（`✓ 连接成功，4094 ms`）。
6. **终态报告**：本目录下 ACCEPTANCE_MATRIX / FINAL_REPORT / CHECKPOINT / TEST_REPORT 四份。

## 当前卡点（一处，且已定位到具体下一步）

**预算代理的 profile 指纹绑定。** scoped 账本钉住的 `profileFingerprint` 与 app 实际发送值不一致，代理以 `qa_dispatch_denied` 在**派发前**拒绝，因此**未消耗任何预算**（spent 仍为 0）。

已定位的事实：
- app 仅在端点端口为 18591/18691 时才附加 `x-phase9-*` 头（`mobile/src/fetchTransport.ts:89`）；连接预检走独立链路，故不带这些头——这解释了为何预检无法用于抓取指纹。
- 指纹依赖 profile 的 id/endpoint/model/capabilities/derived dialect；本轮 profile 端点由真实 URL 改为代理 URL，指纹随之改变。

下一步：正式 UI 触发一次真实战役请求（导入 save-10 存档 → 推进回合），读取实际 `x-phase9-profile-fingerprint`，据此重建 scoped 账本并重启代理。预留失败不计费，可安全试探。

## 剩余未 PASS 项归属

- **[BLOCKED-LOCAL]**：两条悬空后果真实触发/消费、stage-8 收尾回放、供给恢复、A15、A28、20 动作窗口、80 有效决定、三路汇合、匹配性能、第二题材；测试工具保存按钮匹配缺陷。
- **[BLOCKED-EXTERNAL-HUMAN]**：V95-12 / A36 独立真人四问六维。
- **[BLOCKED-EXTERNAL-INFRA]**：候选 CI 401；预算代理指纹绑定未完成。

## 预算现实

真实上限 `HARD_STOP = 1450`，剩余 **159 次**（非名义 209）。80 个有效决定本身可能需要 80–160 次物理请求，取决于 L1 快路径命中率。预算不足时按既定顺序执行并如实登记"预算耗尽于第 N 项"，不压缩流程凑数。

## 禁区（不变）

J1 `camp-mv3mw9hk-main` v70 / `turn-0071` 冻结，永不回放；R62 首条抽取 unknown 与设备超时请求为永久禁区；任何 `outcome_unknown` 只能经正式 API acknowledge，禁止自动重发；不篡改冻结历史、不补假成功、不删除正向效果。

## 身份

- HEAD `08b64522939b2fd84b5cb2762296538ad70b5ef3`（本次提交前）
- productionSourcesHash `2f5466b929111b31ee4b84c37ee4b9935619893f9144b0888f40d92fa59cb6a7`
- Debug APK `5c17b33106c70a290fb60603ea4af5d44f63fc0486705400fb0f680a4b192d9a`