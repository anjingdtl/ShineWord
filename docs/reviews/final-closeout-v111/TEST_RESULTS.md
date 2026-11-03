# TEST_RESULTS — V1.1.1 Final Closeout

## 门禁命令与结果

```
npm run verify:core     → 1435/1435 全绿（含 20 新测试）
npm run typecheck       → PASS
npm run typecheck --prefix mobile → PASS
npm run verify:version  → OK V1.1.1 versionCode=1010100
git diff --check        → PASS
npm run apk:debug       → PASS（110,261,375 bytes）
```

## 新增测试明细

### tests/minimax-json-repair.test.cjs（12 用例）

| 用例 | 验证 |
|---|---|
| form-A repair restores only whitelisted schema keys | 白名单限定：非词表键不被修改 |
| form-B repair inserts brace at element boundary comma | form-B 元素边界逗号前插入 |
| repair composes with parseStructuredOutput and is opt-in per caller | 无 structuralRepair 的调用方不受影响 |
| well-formed responses are byte-identical (repair never fires) | 合法 JSON 零修改 |
| truncated output is never "repaired" into a fake completion | json_truncated 分类保留 |
| unknown artifact classes abort the repair instead of guessing | 无法确定性修复时返回 null |
| extractor recovers misnested evidence key + strict verification applies | evidenceQuotes 恢复仍走严格逐字校验 |
| evidenceRefsFromCandidate prefers direct refs / never invents | 直接引用优先，非字符串过滤 |
| repaired extraction passes verbatim evidence gate only for real quotes | 修复后非逐字引用仍被拒 |
| parseExtractorJson repairs captured artifact classes end to end | 端到端（两种 artifact 类共存） |

### tests/final-closeout-security.test.cjs（2 用例）

| 用例 | 验证 |
|---|---|
| scoped hard-cap denial: zero upstream HTTP, zero charge, zero leak | 无上游 HTTP、零扣费、审计无请求体/凭据 |
| pre-dispatch rejections keep bodies out of audit and logs | 模型漂移+流未配置拒绝：审计与日志不含请求标记 |

### tests/convergence-l1l2-routing-matrix.test.cjs（6 用例）

| 用例 | 验证 |
|---|---|
| dialogue + investigation commit on L1, zero Planner | 对话/调查本地表达零 Planner |
| exploration route reaches same L1 settlement as tap | 自由文本 vs 按键结算一致 |
| planner_required keeps L2 route for exact wording | 精确措辞仍走 L2 |
| unbound paraphrase never force-binds; ambiguity refuses | 语义改写不绑定；歧义拒绝 |
| task progress advances + delayed consequence discharges once | 任务推进 + 延迟后果单次消费 |
| L1 and L2 agree on frozen contract | L1/L2 结算形状路由无关 |

### tests/analysis-planner-v2.test.cjs 新增/修改（3 处）

| 变更 | 验证 |
|---|---|
| V2-01 更新 | 大书在 12k 覆盖上限下拆批 |
| V2-02 更新 | sourceTargetTokens 被 SEGMENT_ARTIFACT_LIMITS.codePoints 钳制 |
| V2-02b 新增 | 每批 coverage ≤ 12k 且 chunk 全覆盖 |

### tests/reasoning-feedback.test.cjs 新增（1 用例）

| 用例 | 验证 |
|---|---|
| measured reasoning drives context-elastic reserve | 实测思考量 ×1.5 作为 override 在 1M 模型上保持完整；小输出模型诚实拒绝 |
