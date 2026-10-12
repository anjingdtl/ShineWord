# 阶段 9.5 最终复验基线

报告日期：2026-10-13（Asia/Shanghai）
结论：阶段 9.5 尚未完全通过；最终 APK 已构建、安装并完成本轮修复复核。

## 身份

- 工作树：F:/sw95
- 分支：codex/phase9-5-final-pass-20261012
- HEAD：affb4dfb5980d84aabbc1c3699278af5396469a0
- 最终生产源码 scope-v3 SHA-256：1c57c7ee1be6ae3811ab47105146b4897939e64e4b03e0a2c68ba5f0cf8fc1de
- Debug APK：dist/apk/debug/ShineWord-V1.0.0-debug.apk
- APK SHA-256：7faa5d3c9884cc8b9e4872fe3f9110d7aba0c04e9e3636785502462e8fa8b86e；110,058,015 字节
- 应用：com.shineword.app，V1.0.0，versionCode 1000000
- 设备：ShineWord_P2_Clean，emulator-5556，Android 17 / API 37
- Node 24.14.1，JDK 17.0.19。设备侧 base.apk 与本地构建 SHA 相同。

该身份包含未提交的源码变更；没有提交、推送、合并或发布。

## 验收边界

原始长测 J1 分支 camp-mv3mw9hk-main 保持 v70，冻结 turn-0071 未被重跑。存档来源分支 camp-mv5f6yt7-bmv5gqfw9 保持 v27。Android 数据未清除。

历史阶段 9 结果不带入本轮严格矩阵。A01–A40 单独列出：A40 本轮通过；A15、A28、A36 仍失败；其余 36 项没有按完整原合同在最终身份上重新验收。G/V95、80 决定合同与阶段 9 A01–A40 分开计数。

## 隐私与证据

- 唯一真实模型预算作用域：shineword-phase9-5-20261011，硬上限 600。
- 配置密钥留在应用安全存储；公开文档不包含密钥、提示词、模型响应或小说正文。
- 设备数据库、截图、存档和逐项审计位于被忽略的 test-logs/phase9-5-final-pass-2026-10-13/。
- 最终核心门禁日志：test-logs/phase9-5-final-pass-2026-10-13/gates/verify-core-repeat-promise.log。
- 最终请求账本：test-logs/phase9-5-longrun-2026-10-11/budget-manifest.json；未新建作用域或重置计数。
