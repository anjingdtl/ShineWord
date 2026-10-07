# Phase 9 收尾复验基线

复验日期：2026-10-07，Asia/Shanghai。合同为 docs/Shine-TRPG_PHASE9_CONSTRUCTION_PLAN.md。本轮从已提交 Phase 9 实现检查，不能把历史施工起点当成本轮基线。

| 项目 | 事实 |
|---|---|
| 开始 HEAD | fab6f171fba075c69fbe0bb1ecec4058fd9e0cae，起始工作树干净 |
| 历史施工 HEAD | 5f49a7d653bdc98a910d7b0c0b33ec3ac483b1e0；922项为当时历史数 |
| 版本 | V1.0.0 / versionCode 1000000；本轮未提交或发布 |
| 环境 | Windows / PowerShell，Node v24.14.1，JDK17.0.19，Android API37 |
| 设备 | emulator-5556，AVD ShineWord_P8_Reacceptance |
| 小说 | C:/Users/Administrator/Desktop/AIstudio/放开那个女巫.txt，7,178,905 bytes |
| 小说 SHA-256 | 7F45FE0B11EA30ECA95F5A736232DD4C466A57C0F2CC9F67530E432015ECC6F4 |
| 模型 | GLM-5.3-Flash，https://open.bigmodel.cn/api/coding/paas/v4 |
| 凭据 | 从指定本机文件读取，仅在内存/系统安全存储使用；不记录内容、长度或片段 |
| 显式测试能力 | contextWindow1048576、maxOutputTokens32768、contentMaxOutputTokens16384、reasoning low，不从型号推测 |

报告审计发现：使用合同不允许的PART；自然结局后继续刷数；设备在途动作算决定；六维未全部达到3却称通过；千回合未运行。旧“90有效决定、技术验收完成”撤销。

保留旧开发库、分支、冻结材料与私有日志；未卸载、清数据或覆盖设备数据库。通过正式入口建立的专用库为 shineword-baseline-1791270204765.db。主机诊断库与只读设备快照放 .tmp/phase9/，不反向写回设备。

共享物理计数重启不清零。历史起始313包含估计，不能称全历史HTTP精确对账。本轮新请求传输前原子预留，生成加修复另共享每任务两次上限。总额调整400→600→650→750→950→1100，均在派发前说明并记录manifest。最终消耗见FINAL_REPORT。

最终代码/APK身份记录 .tmp/phase9/reaccept-identity-final17.json；每段旅程有独立identity。此次修改原生manifest后，identity scope升为v2：包含src、mobile/src、原生Android文件/资源及显式构建输入，排除生成bundle、SDK/签名本机配置与凭据。旧v1哈希只覆盖TS/JS和APK脚本，旧样本身份保留，不改写或包装为最终通过样本。final15/16/17只修改核心解析/校验/提示，移动与原生文件逐一与final14相同，完整显示测试保留final14身份。
