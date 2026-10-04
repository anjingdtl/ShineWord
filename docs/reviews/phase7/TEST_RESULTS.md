# 第七阶段测试结果

日期：2026-10-04。门禁命令与结果（本机 Windows，Node 24.14.1）：

| 门禁 | 结果 |
|---|---|
| `npm run verify:core`（typecheck + 全量 node --test） | **826/826 通过，0 失败**（第六阶段收尾 797 + P7 新增 29） |
| `npm run --prefix mobile typecheck` | 通过，0 错误 |
| `npm run verify:version` | OK version=0.7.0 versionCode=70000 |
| `npm run apk:debug` | 成功，`dist/apk/debug/ShineWord-V0.7.0-debug.apk`（102.3MB） |
| `git diff --check` | 干净 |

## P7 新增测试（29）

| 文件 | 覆盖 |
|---|---|
| `phase7-situations.test.cjs`（7） | 夹具过冻结合同校验（三题材、办法结构互异）；三值条件（缺数据=unknown 非 true）；白名单拒绝（未知 kind/超限树）；转换幂等（processedEventKeys 重放零重复）；状态 tick（dormant→eligible→active、知识门槛、前置伪造→suppressed 审计）；P7-0 出口样例（救下→死亡参考抑制带审计、未救→分支死亡、未到期 pending）；因果序推导（非回合数） |
| `phase7-prepared-turn.test.cjs`（4） | Prepared 单次归约+原样提交+重放不重复（计数器=1）；同起点救援/未救双路线分歧（抑制/适用+actorFate+局面 resolved）；失败路线代价保留（体力、bleeding、零奖励） |
| `phase7-sqlite.test.cjs`（4） | 迁移 32 建表+FK；原子提交携带局面状态往返（投影行+快照行）；引导存储决策点绑定/最新读取/跨分支隔离；跨提交投影精确镜像+逐版本快照历史 |
| `phase7-situation-compile.test.cjs`（5） | 合规提案通过；悬空引用/未知条件/办法不足/同义重复拒绝；参考事件只绑真实 canon 事件、命运需事实佐证；本地开局局面（≥2 办法、GM 目录、玩家目录无局面）；**包裹条件形式+实体 id 解析（设备真实形态回归）** |
| `phase7-guidance.test.cjs`（6） | 真实 session 管线：两业务调用+好正文坏路径单次提交降级（A13/A11）；办法绑定引擎效果（A04/A07）；资格随卡（A08/A18）；命运抑制闭环+未救对照（A01/A02）；已提交回合重放零新请求（A14）；分叉局面独立+引导不跨分支（A15） |
| `phase7-save8.test.cjs`（3） | save-8 全跳往返（引导重绑、局面随快照）；v7 标签携 phase7 内容显式拒绝；干净 v7 继续导入且不追补局面/引导 |

## 既有测试期望更新（2 处，均为新语义）

- `migrations.test.cjs`：最新迁移 31→32。
- `progressive-content.test.cjs` / `progressive-opening.test.cjs`：存档 schema save-7→save-8；渐进开局包含局面包 world-package-3→4。

## 设备轮回归方式

设备端发现的门限缺陷（条件包裹形式、实体 id、actor-canon 引用、未提议 target）均先以**设备真实输出形态**的合成回归用例固化，再修复源码，最后以主机端生产代码回放设备缓存提案验证（2/2 接受，见 DEVICE_RESULTS §3）。
