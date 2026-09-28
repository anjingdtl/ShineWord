# 收尾追加验证（第二轮推进）

日期：2026-09-28（第二轮）。针对用户要求对未通过项的自主推进记录。最终矩阵更新见 [FINAL_REPORT.md](FINAL_REPORT.md)。

## 本轮新完成

| 项 | 结果 | 证据 |
|---|---|---|
| 第二模型 | **glm-5.3 真实可用**：200/2789ms，JSON mode 正常，推理开启（reasoning tokens=77），逐字引文正确 | 端点 `/models` 列出 11 模型；双模型小样探针 |
| disabled fate 完整接入 | 合同经 `beginEncounter(fateContract)` 进入场景 → `startEncounter`/`cloneEncounter`/快照信封全程携带 → 每回合边界 `applyFateTransitions` 指派/升级/了结命运并落 `fate_*` 权威事件 → `EncounterView.fates/endingTriggered` 投影 | 核心回归 **190/190**（新增：敌对倒下→death_risk 指派+重载保持；无合同→不发明命运） |
| 端上 30MB 预处理 | emulator（x86_64/2GB/release）实测：读取阶段 ~35s 内到 100%，**选文件→run 建立（232 组）≤ ~165s**；任务卡显示真实计数并带暂停/失败明细 | `screens/c7-30mb-*.png` |
| 四主题截图 | 每主题 书库+我的 两屏共 8 张 | `screens/theme-{ink,fantasy,manga,scifi}-{library,profile}.png` |
| 四主题对比度 | 由 tokens 计算 WCAG：primary ≥ **15.29:1**，secondary ≥ **6.37:1**，manga 卡内文字 18.88:1（要求 ≥4.5:1） | tokens.ts 值计算 |
| 真实模型窗口探测 | 240k 字符载荷 200 接受 → 保守取 120k tokens（不猜窗口） | full-build metrics |
| 全文真实模型构建 | **运行中**：白篱梦 3,065,535 bytes / 965,458 码点 / 300 章 / 944 块 → 30 分片（916ms）→ **15 组**；已完成组零失败 | `.tmp/full-build/`（完成后归档指标入 docs） |
| 双模型长程 | **已排队**：全文包发布后自动执行 2×60 回合（探索/社交/战斗/休整/训练轮换 + 中途分叉） | `scripts/dual-model-longrun.cjs` |
| Release v14 | 含 fate 集成重建（versionCode 14） | 构建后台任务 |

## 修正的缺陷（第二轮发现）

- `startEncounter` 逐字段重建 scene 时丢弃 `fateContract`（服务级集成测试暴露）；`replaceEncounterSnapshots`（回合提交的活跃写入方）信封未携带 `fates`——两者均已修复并有回归覆盖。

## 仍需外部条件（无法自主补齐）

- Android 15/16 **真机** dataSync 限时/Doze/锁屏 Keychain 行为；API 24 镜像未安装。
- 三题材**授权语料**与**独立人工标注**（标注本质需要人）。
- 真机 P95/内存指标（模拟器数据不冒充真机）。
