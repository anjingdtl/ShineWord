# 缺陷登记与 M6 修复证据

日期：2026-10-18（Asia/Shanghai）

## SW95-M6-01：开局证据错误码未触发有界补建

- 严重度：P1（会让缺少开局证据的首次构建停在可恢复失败状态）。
- 现象：真实小说 6,400–9,600 code-point 段发布时出现结构化 `opening_entity_unproven:<entity>`；原恢复分支只查中文错误消息，未识别结构化 `errorCodes`，因此没有排入下一段有界开篇样本。
- 根因：`mobile/src/sourceImport.ts` 的 opening bootstrap 恢复条件只对 `Error.message` 做有限中文正则；发布校验以 `errorCodes` 提供更准确的机器码。
- RED：在 `shouldExtendOpeningBootstrap` 尚未识别结构化错误码时运行 `npm run build:core; node --test tests/opening-evidence-recovery.test.cjs`。结构化 unproven case 预期 true、实际 false；legacy 中文错误信号 case 通过。
- 最小修复：抽出 `src/application/worldBuild/openingEvidenceRecovery.ts`，仅当 `errorCodes` 有 `opening_entity_unproven` 前缀时触发有界补建；保留已有中文信号。provider/config 错误与 `outcome_unknown` 明确不触发。发布 validator、Canon、scope 上限和 ledger 均未放宽或改写。
- GREEN：定向测试 2/2；mobile typecheck 成功；全量 `npm run verify:core` 为 1,344/1,344；M6 Debug APK 构建成功。
- Android：在既有专用 AVD 对 APK 使用 install -r，未清数据。installed base.apk 与本地 Debug APK SHA-256 均为 `B42AAE7C176D80A49B9C7605375F6B93332FB53405F522291798290B1F1F5843`。重启后项目页无 fatal crash，先前 finalization task 显示 4/4 completed，world/package ready。此前成功 extraction 响应被复用，没有新 world_extract 物理请求，published scope 保持 0–9,600。
- 设备边界：这次重启后 finalizer 从已完成 extraction artifacts 恢复成功；没有观察到新的 9,600–12,000 延伸请求，所以这是同项目当前 APK/完成态回归，不声称设备实际走过有界延伸分支。该结构化分支由 RED/GREEN 定向测试覆盖。
- 复审：差异只含 source import 恢复条件、一个纯判定 helper、对应测试和证据；未新增 Runtime、状态 authority、reducer、store、schema、request ledger 或 LLM bypass。实现者完成了一次不变量复核；独立作者审查尚未发生。

## 外部配置阻滞（非代码缺陷）

- 模拟器 opening_goal 物理请求返回已知 HTTP 401，usage 与 provider request ID 缺失；没有 unknown outcome。当前 GLM 配置不能证明可认证，新增真实模型请求暂停。
- 本地原小说章节计数 1,498 与移动导入器 1,504 不一致；没有足够证据将其定性为代码缺陷，暂列观察项 P2，不通过修改 parser 或验收标准消除差异。
