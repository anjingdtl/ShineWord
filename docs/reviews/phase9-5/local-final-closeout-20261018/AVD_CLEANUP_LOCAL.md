# 本机 AVD 盘点与清理

日期：2026-10-19（Asia/Shanghai）

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
- 2026-10-19 复核 `emulator -list-avds` 仍只有以上 3 台，`adb devices` 只有 `emulator-5556` 与 `emulator-5560` 两台在线。项目自动化继续复用这两台现有实例，不新建 AVD；`Medium_Phone` 保持离线和不触碰。
- `F:\avd\Pixel_10.avd` 仍是约 20.16 GiB 的未注册目录，不属于 3 台已注册设备。其项目归属依旧无法核实；对递归删除的请求被自动安全审查拦截，本轮没有通过其他命令、UI 或路径尝试绕过，也没有改动该目录。它是本机剩余磁盘占用项，不代表 ShineWord 需要第 4 台模拟器。
- 2026-10-19 再次核实唯一 Android SDK 的 `avdmanager list avd` 与 `emulator -list-avds`，结果仍只有上述 3 个注册项；其中 `Medium_Phone` 共用，`ShineWord_M4FaultQA_20261018` 用于 M4 故障回归，`ShineWord_Phase95_LocalFinal_20261018` 用于主流程与小说验证。两台 ShineWord 专用设备（`emulator-5560`、`emulator-5556`）在线并供后续自动化复用。`F:\avd` 根下的截图、XML、SQLite/DB、APK 和日志是证据/数据文件，不是额外注册 AVD。未新增 AVD。
- 自动安全审查拒绝删除归属未明的未注册 `Pixel_10.avd`；本记录保留该结果，不尝试换命令、UI 或路径绕过。当前可确认的 ShineWord AVD 已是用户设定的最多 3 台，不存在更多注册模拟器可继续删除。

## 验收边界

本记录只证明本机 AVD 资源清理和保留设备状态，不替代 API 版本兼容性、TalkBack 读屏、真人玩家或独立试玩验收。
