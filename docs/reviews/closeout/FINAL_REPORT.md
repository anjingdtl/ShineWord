# 二期收尾建设最终报告（C0–C7）

日期：2026-09-28。施工范围：`fe2ff3abaf001fd76071fe2d7b507a533da4dd4f`（与审查基线一致）→ 本轮系列提交。分阶段报告：[C0](C0_BASELINE.md) · [C1](C1_HASH_FIX.md) · [C2](C2_STREAMING_SOURCE.md) · [C3](C3_GROUPING.md) · [C4](C4_PROGRESS.md) · [C5/C6](C5_C6_SERVICE_FATE.md)。

## 三项结论（先答问题）

### 1. 工程修复是否完成 —— **完成（附边界）**

- **mobile TypeScript 门禁**：EXIT=0（修复 6 个缺失依赖安装 + 24 个文件的真实相对导入层级错误 + TurnCard StyleSheet；未用 any/未关 strict/未删测试）。
- **核心回归**：**188/188**（原 156 + 新增 32 项 C1/C2/C3/C6 回归；原 156 全部保留通过）。
- **P0 哈希缺陷**：`makeBytesSha(fileBase64)` 忽略入参导致全部章/块摘要=整本摘要、错误复用与漏读假成功——已修（共享 `makeBase64NativeByteSha` 对任意 bytes 正确散列）；INSERT OR IGNORE 残留改为 hash 变化即重置的 upsert（污染库重导入自愈）；复用补齐 extractor 版本+模型指纹；事件提案随块原子 checkpoint、归并从 DB 重放；failedChunks 不再标 ready。旧 published 包/战役/存档零改动（测试断言）。
- **构建慢/无进度/切后台**三项的工程修复落地：私有源流式暂存+分片持久化（整本 base64 过桥移除）、批/流式解析语义等价（共享规划器）、按模型预算分组+分段协议、DB 驱动任务卡（真实计数、暂停/继续/失败明细、重进恢复）、dataSync 前台服务+Headless runner+租约单执行者。

边界：Android 15/16 真机 dataSync 限时/Doze/锁屏 Keychain 未实测（模拟器 API 37 不代表）；组模式真实模型只做了小样（见结论 3）。

### 2. 第三期验收是否通过 —— **未通过（门禁大部分恢复，设备/视觉验收缺口仍在）**

已恢复：mobile typecheck、debug APK、release APK 构建门禁；核心投影 156 项继续通过。
仍缺：四主题关键屏幕截图、对比度/触控面逐屏检查、完整 Opening→Play 旅程的最终包 UI 实测、NPC 秘密隔离逐屏验证、长历史/键盘/安全区实测——原 §29 旅程验收未在最终包执行。

### 3. 二期 Beta 是否通过 —— **未通过（工程与规则侧显著推进，外部验收项未具备）**

已推进：disabled fate 合同状态机（规则引擎+快照语义，7 项回归）；构建管线的原子提交/断点/幂等恢复（32 项新增回归）；GLM 配置最小探针 **200/7063ms，模型 GLM-5.3-Flash，reasoning 字段存在（推理开启政策满足）**；真实模型 C3 分段协议小样 **7 事实 0 拒收、全部引文在声称段内命中**（1 次请求，prompt 426/completion 2000/reasoning 1176 tokens，30.7s）。
未通过项：全文真实模型构建未执行；双模型（仅一个可用配置）；≥100 提交长程、三题材+独立 ≥200 事实标注、召回 ≥90% 质量评估、API 24 与真机矩阵、1+2 队伍完整 App 旅程——条件未具备，如实留为未通过。

## Release APK 证据（与当前源码对应）

| 项 | 值 |
|---|---|
| 文件 | `dist/apk/release/ShineWord-V0.3.0-closeout-release.apk` |
| 大小 / SHA-256 | 46,776,314 bytes / `fce3c13761b38af6d3dacb991612d57728cff9713ec524561bc23cf79be95948` |
| versionCode / Name | 13（自 12 递增）/ 0.3.0-closeout |
| minSdk / targetSdk | 24 / 36 |
| 签名 | V2，单签名者，证书 SHA-256 `017b3fbed4001083f2f70a0c51e8e463322df66b095e1c3a476fdd0d86dc2a0a`（与 p2.8/p2.9 及要求一致）；构建脚本内置校验+zipalign 通过；apksigner 复核通过 |
| 安装/冷启动 | 干净安装到 emulator-5554（API 37），COLD 启动 `Running "ShineWord"`，0 fatal；首屏品牌/表单渲染正确（UI 树核验） |

## 设备验证记录（emulator-5554，API 37 / Android 17 镜像，release v13）

| 场景 | 结果 |
|---|---|
| 冷启动（干净安装） | 通过，无崩溃 |
| 首次配置→保存→书库 | 通过（含 API Key 空值校验拦截） |
| SAF 选 TXT→流式导入 | 通过：staging→解析→建 run（此前被 `globalThis` 取原生模块的 bridgeless 缺陷阻断，已修为 `NativeModules` 并复测） |
| **前台服务** | `WorldBuildForegroundService` 运行，`startForegroundCount=1`，前台启动时应用处 TOP（合法 FGS 启动） |
| **通知** | 渠道 `world_build`（LOW/无角标）创建；通知 id=42001 `ONGOING_EVENT|ONLY_ALERT_ONCE|NO_CLEAR|FOREGROUND_SERVICE`，category=progress；**通知权限拒绝时 FGS 仍运行**（仅不可见） |
| **任务卡（C4）** | 真实 DB 计数渲染：「test-novel · 抽取事实 0/1 组 · 1 待重试」+ 开始构建/失败明细 |
| 失败语义 | dummy 端点不可达→network 分类→failed_retryable+退避，run 持久可恢复，续建入口工作 |
| 强停 | 进程停止后服务随之消失（无假存活） |

说明：为获得可复现实验环境，`pm clear` 清除的是本开发模拟器上 com.shineword.app 的**历史自动化测试残留**（mock 战役数据），模拟器其余应用与数据未动。真实密钥全程未进入命令行/日志/git——设备验证使用伪造 dummy 凭据。

## 性能参考（开发机 Node，非端上成绩）

- 30MB 精确合成样本（中英+emoji 混合）：**10,808,621 码点 / 7,416 章 / 14,831 块 / 330 分片，预处理 5,985 ms**，全量回读覆盖一致。
- 《白篱梦》桌面解析基线沿用审查记录（~3.07MB/965,458 码点）；端上计时与 PSS 属后续真机矩阵。
- 真实模型小样：单组请求 30.7s（推理 1176 tokens 占用），质量引文 7/7 命中。

## 未完成清单（不捏造、不静默）

1. 全文（96.5 万码点）真实模型构建实测、请求/费用/时长统计。
2. 第二模型配置；双模型 100+ 提交长程分类统计。
3. 三题材授权语料与独立 ≥200 事实标注、召回 ≥90%/explicit 定位 100%/人工支持率评估。
4. Android 15/16 真机 dataSync 限时、Doze、锁屏 Keychain 行为矩阵；API 24 镜像。
5. 四主题截图/对比度/触控面逐屏验收；完整 1+2 队伍最终包旅程。
6. disabled fate 引擎接入 encounterService 逐回合调用点与世界包合同装配 + HUD 展示。
7. 映射阶段并入 run/unit 底座（当前用 world_jobs checkpoint 断点）。
8. 30MB 端上预处理计时（当前仅 Node 参考）。
