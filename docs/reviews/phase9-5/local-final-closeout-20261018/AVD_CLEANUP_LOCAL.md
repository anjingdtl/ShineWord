# 本机 AVD 盘点与清理

日期：2026-10-18（Asia/Shanghai）

## 结果

- 清理前 `emulator -list-avds` 返回 10 台已注册设备；清理后为 3 台：共享设备 `Medium_Phone`、本轮真实小说验证设备 `ShineWord_Phase95_LocalFinal_20261018`、本轮合成故障回归设备 `ShineWord_M4FaultQA_20261018`。
- `Medium_Phone` 是多个本地项目共用且保留用户数据的设备；未对它执行清理、卸载或重置。
- 两台运行中的 ShineWord AVD 均保留，小说、应用数据库、GLM 配置和 M4 合成故障证据未删除。
- Android SDK `avdmanager delete avd` 删除了 7 台不再参与本轮验收的历史 ShineWord 专项 AVD：

| AVD | 历史用途 | 配置镜像 |
| --- | --- | --- |
| `ShineWord_P2_Clean` | P2/Phase 9.5 专项设备与保存恢复验收 | Android 37.1 |
| `ShineWord_P2_Import` | 名称表明用于 P2 导入；现存验收记录未找到该实例的可核实引用 | Android 37.1 |
| `ShineWord_P8_Reacceptance` | Phase 8 重新验收 | Android 37.1 |
| `ShineWord_Phase95_20261016` | 10 月 16 日阶段 9.5 验收 | Android 37.1 |
| `ShineWord_Progressive_Release` | progressive-opening 发布验收 | Android 37.1 |
| `ShineWord_WorldBuildQA` | 世界构建发布升级链 smoke | Android 37.1 |
| `ShineWord_WorldBuildQA36` | 世界构建恢复故障测试 | 实际配置为 Android 37.1；名称中的 `36` 不代表 API 36 |

- F 盘可用空间从 503.91 GiB 增至 549.44 GiB，观测增加 45.53 GiB。没有删除共享 system image。
- `Pixel_10.avd` 是 20.16 GiB 的未注册目录（无对应 `.ini`，目标镜像为 Android 36.1）；未找到足以确认其项目归属的证据，因此保留。它不计入前述 10 台已注册设备。
- 清理后复核确认 7 个已删除设备的目录和注册文件均不存在；`adb devices` 仍仅显示保留的两个运行中实例。M4 设备上临时开启的 TalkBack 已关闭，并恢复原 `accessibility_enabled=0` 设置。

## 验收边界

本记录只证明本机 AVD 资源清理和保留设备状态，不替代 API 版本兼容性、TalkBack 读屏、真人玩家或独立试玩验收。
