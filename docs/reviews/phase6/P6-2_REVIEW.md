# P6-2 小段、映射、发布与采用

M3 的需求去重包含来源局部哈希与冻结执行配置，排除追加新部导致的整体 sourceSetHash 变化。bootstrap 默认首章最多 3200 码点；近期候选上限 1～2，优先动作依赖。状态由既有 run/unit 与不可变成果投影，部分覆盖不能标为 ready。

M4 先裁剪逻辑范围内的存储块，再依据输入/输出/推理预算形成 AnalysisBatch。部分存储块的完整状态保持 pending，范围抽取检查点可复用。Canon 写事务复核项目、active 来源、unit inputHash、run fence 和租约。映射选择有证据的人物/地点/事件及引用闭包，保留现有 20 条事实门禁；后续只处理新范围变化，旧映射不重发。provenance 区分保留。

M5 使用版本化多来源 SegmentArtifact；旧 delta 范围/字数/条目门禁未放宽。成果严格 hash、证据与依赖验证，不变 base 定义可被引用，改写拒绝。world ready 与 branch adopted 分开：stateVersion、manifest hash 与 interaction_operations 安全边界事务采用，后台不能改骰点、角色状态或历史。

审查修复：重复 completeUnit 对同 fence 不再重复累计；暂停/恢复测试符合 schema 28 单来源归属；旧提前发布的异常持久记录为可见审查项；小段不跑全书 registry/timeline，改用既有本地实体与事件解析；bootstrap 扩展只使用已完成范围并持久诊断，冲突/未知结果仍停留审查；新段同名条目使用新 ID，保留已发布定义与分支历史。

验证：76 项 phase6 协议测试通过；20 项暂停/停止相关回归通过。完整核心回归正在复测。移动端装配在 P6-3 继续验收。真实 API、真机性能不由合成结果证明。
