# M0 函数级底座审计与复用边界

审计日期：2026-09-26  
ShineWord 基线：`main@461a2caf9de8a97329da88570be454eae49e7a86`  
tavo-mini 锁定提交：`0a4eabc645eb36b8fde5de1fb8bedb2739dec900`（V3.0.9）

## 1. 审计结论

ShineWord 不从 tavo-mini 复制写作业务状态机，只复用已经在 Android 上验证过的工程形态与低层接口模式。核心原则：

1. **规则、随机、状态与分支由 ShineWord 本地权威内核负责。**
2. **LLM 只负责结构化提议和叙事，不直接写权威状态。**
3. **TXT 原文不可变，世界事实必须保留证据位置。**
4. **Android 工程与安全存储可以参考 tavo-mini，但 package / DB / Key namespace 必须独立。**
5. **任何复用源码在引入前保留 MIT 来源说明；GPL/AGPL 项目只参考设计。**

## 2. 锁定文件与函数级审计

| 模块 | tavo-mini 文件 / blob | 读取重点 | ShineWord 决策 |
|---|---|---|---|
| RN 工程 | `package.json` / `ecf4e58ad7f8e0061639447c9fefddd3f1e68e98` | RN 0.85.3、React 19.2.3、Keychain、SQLite、Documents Picker、Zustand | **复用版本线与依赖选择**，不复制 ShineWriter scripts / 产品依赖 |
| TXT 导入 | `src/services/projectTxtImport.ts` / `f04d9a69df99df3e50a61505bc0d7a47fe52a27a` | `splitTxtChapters`、`collectSmartSplitCandidates`、`parseTxtProjectStreaming`；标准→宽松→fallback；流式窗口 | **复用解析思想**；ShineWord 输出 source_chapters/source_chunks，不创建写作章节 |
| LLM 入口 | `src/services/llm.ts` / `3d62477c1daddf409089ebca15bdd9f30e7db83d` | Provider 入口、usage/流式/错误边界 | **仅复用协议形态**，重建 Planner/Narrator/Extractor 角色调用 |
| OpenAI 兼容 | `src/services/llm/openAICompatibleProvider.ts` / `a957cd5254fcb2df5d56d05a7d0d1fa08c0a52a5` | OpenAI-compatible 请求、流式、响应/错误解析 | **重写轻量 provider**，避免带入写作特有推理参数 |
| 能力探测 | `src/services/llm/providerCapabilities.ts` / `4d2c0fa944d2ec07b006507e762cb9aad51dad57` | JSON/stream/usage/output 限制与能力解析 | **复用能力矩阵思想**；ShineWord 使用 capability object 而非品牌分支 |
| 请求策略 | `src/services/llm/requestPolicy.ts` / `49b67d1d8a5fceacee9f5a5ea44d5a1120da86f9` | 超时、reasoning/output 参数归一化 | **复用参数过滤原则**；游戏请求上限独立实现 |
| 请求调度 | `src/services/llm/requestScheduler.ts` / `7c0502e35c85c2e1bea1863d7ccaa9fc2f13f3e8` | 并发、队列、取消、重试边界 | **复用调度模式**；ShineWord 每 turn 最多 4 个物理请求 |
| 上下文预算 | `src/services/contextAutoAllocator.ts` / `983c405e09290314e473b3d5ff399c70dae3dc29` | 先保留输出预算再分配输入、弹性裁剪 | **复用预算原则**；上下文来源改为 rules/state/canon/knowledge/memory |
| 安全存储 | `src/services/secureStorage.ts` / `511a1b62ac49d55dfde06acdf59b962466a6c94a` | Keychain 优先、迁移与失败处理 | **复用 Keychain 模式**；service/account namespace 改为 ShineWord |
| Android 壳 | `android/*` | RN Gradle、Hermes、16 KB page-size、x86_64/arm64、MainActivity/Application | **复用工程骨架**；删除 TTS/更新/写作 Pipeline 等无关 Native Package |
| SQLite | `react-native-sqlite-storage@^6.0.1` | Android 已验证数据库驱动 | **复用驱动**；schema、迁移、事务全部由 ShineWord 自己定义 |

## 3. 明确不复用

以下能力不得直接进入 ShineWord：

- outline / continuation 两类写作项目模型。
- 章节正文编辑、续写章 Canon 编号与写作记忆。
- 五稿或多稿生成管线。
- ShineWriter 的 PipelineForegroundService、TTS、PNG 元数据、AppUpdate。
- ShineWriter 数据库表、备份格式、安全存储 service/account 名称。
- 写作专用 prompt、reasoning 策略和章节上下文分配。
- 任何把模型自然语言直接视作权威状态的路径。

## 4. ShineWord 对应接口

### 4.1 Provider

Provider 只暴露统一能力：

- endpoint / model / API key reference
- supportsJson / supportsStreaming / reportsUsage
- contextWindow / maxOutputTokens
- timeout / cancellation
- normalized usage & cost metadata

角色调用固定为 Extractor、WorldMapper、Planner、Narrator、Checker、Summarizer。Provider 不知道角色业务规则。

### 4.2 Scheduler

单回合标准链：

`Planner -> local validate -> Roll(optional) -> Narrator -> local/checker -> Commit`

- 正常请求最多 2 次。
- 协议/语义 repair 最多追加 2 次。
- 单回合物理请求上限 4。
- RollRecord 一旦产生必须持久化；重试 Narrator 不得重掷。

### 4.3 TXT Streaming

ShineWord 导入目标不是“章节项目”，而是：

`immutable source -> source_chapters -> source_chunks -> extracted facts -> merged entities -> timeline/conflicts -> rule mapping`

保留：

- decode/normalize 的流式思想。
- 标题标准识别、宽松识别、fallback。
- 大文本不整篇长期驻留内存。
- 进度可恢复。

新增：

- 源文件 SHA-256。
- UTF-16/字符偏移与 chapter/chunk 证据定位。
- chunk 内容哈希。
- world build job checkpoint。

### 4.4 SQLite

React Native 驱动只实现平台端口。权威语义继续由现有 `SqliteTurnStore`、migration runner、stateVersion 和事务边界定义，避免 UI/Native 层自行拼 SQL 改规则。

### 4.5 Android Random

Kotlin 只提供来自 `java.security.SecureRandom` 的原始随机字节；映射骰面仍由 TypeScript 的 rejection sampling 完成，使单元测试可注入固定 byte source。

## 5. M0 Review / Fix

Review 发现并已冻结的风险：

1. tavo-mini 文档旧基线中记录的 `contextAutoAllocator.ts` blob 已变化，必须以锁定提交为准，不再使用旧 blob 作为“提交号”。
2. ShineWriter `MainApplication` 注册大量产品专用 Native Package，不能整体复制。
3. `projectTxtImport.ts` 的 fallback LLM 分章可借鉴，但 ShineWord 世界构建不能让 LLM 重写原文或丢失 offset。
4. Provider 能力探测复杂度较高；M2 首版只实现 ShineWord 需要的能力子集，并用本地协议夹具覆盖。
5. SQLite 与 Keychain namespace 必须从第一天隔离，防止与 ShineWriter 安装共存时串数据。

M0 出口条件已满足：目标函数、依赖、复用清单与禁用清单均已固定，可进入实现阶段。
