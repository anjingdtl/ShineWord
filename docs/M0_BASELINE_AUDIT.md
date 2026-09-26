# M0 底座审计记录

更新日期：2026-09-26  
状态：第一轮审计完成，后续在接入具体模块前继续做函数级审计。

## 1. tavo-mini 冻结参考点

本轮读取 `anjingdtl/tavo-mini` 的 `main` 分支，参考提交：

`0a4eabc645eb36b8fde5de1fb8bedb2739dec900`（release: V3.0.9 targeted revision scrollbar）

当前技术基线：

- React Native `0.85.3`
- React `19.2.3`
- TypeScript `^5.8.3`
- Zustand `^5.0.13`
- `react-native-sqlite-storage` `^6.0.1`
- `react-native-keychain` `^10.0.0`
- Node `>=24.3.0`

ShineWord 初始化阶段不同时升级 React Native、React 或 TypeScript 主版本，先降低迁移变量。

## 2. 已检查模块

| 模块 | 本轮 Blob SHA | 结论 |
|---|---|---|
| `src/services/projectTxtImport.ts` | `f04d9a69df99df3e50a61505bc0d7a47fe52a27a` | 可借鉴流式解码、归一化、标准/宽松分章与预览思路；不能直接复用 outline 项目写库语义。 |
| `src/services/llm.ts` | `3d62477c1daddf409089ebca15bdd9f30e7db83d` | Provider、能力探测、请求调座值得后续抽取；当前入口直接依赖原项目数据库，不能原样搬入。 |
| `src/services/secureStorage.ts` | `511a1b62ac49d55dfde06acdf59b962466a6c94a` | Keychain 使用模式可复用；ShineWord 必须使用独立 service namespace，禁止沿用 `com.shinewriter.*`。 |
| `src/services/contextAutoAllocator.ts` | `983c405e09290314e473b3d5ff399c70dae3dc29` | 可复用“先冻结模型能力，再分配输入/输出预算”的思想；游戏回合需要重新定义上下文类别。 |

> 建设方案中记录的部分 blob 是方案编制时快照。霰程实施以本文件冻结的实际提交与 blob 为准，后续若底座升级需重新审计差异。

## 3. 第一轮复用边界

### 可复用思想 / 后续候选代码

- TXT 文件流式读取、编码识别、归一化、分章与预览。
- OpenAI-compatible provider 抽象、模型能力探测、请求调度、usage 记录。
- Android Keychain 安全存储模式。
- 上下文预算与模型输出预留方法。

### 当前明确不直接复用

- ShineWriter 的项目/章节数据库模型。
- 写作流水线的多稿生成语义。
- continuation 模式的 Canon 边界定义。
- 原应用的 Keychain service 名称、备份格式、更新清单与版本号。

## 4. ShineWord 独立边界

- 应用包名目标：`com.shineword.app`。
- 安全存储目标 namespace：`com.shineword.*`。
- SQLite 将成为游戏事务权威数据，Zustand 只做 UI 与快照缓存。
- 领域规则保持纯 TypeScript，不依赖 React、React Native、网络或数据库。
- LLM 不直接产生随机值，不直接写角色数值或数据库补丁。

## 5. 下一轮审计项

在进入 M2/M3 前继续读取并锁定：

- `src/services/llm/providerRegistry.ts`
- `src/services/llm/requestScheduler.ts`
- `src/services/llm/openAICompatibleProvider.ts`
- `src/services/txtStreaming.ts`
- `src/services/continuation/continuationNormalizer.ts`
- `src/services/continuation/continuationParser.ts`
- 数据库迁移、备份与恢复相关实现

任何代码级迁移均在读取完整实现、测试与许可证边界后进行。
