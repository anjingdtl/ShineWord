# V0.4.4 发版冒烟记录

日期：2026-10-01。执行环境：AVD `ShineWord_WorldBuildQA`（emulator-5556，API 37.1，x86_64）。

## 门禁

| 检查 | 结果 |
|---|---|
| `npm run verify:core`（typecheck + build:core + 606 项测试） | 通过 |
| `npm run typecheck --prefix mobile` | 通过 |
| `npm run verify:version` | 通过（0.4.4 / 40400） |
| `git diff --check` | 通过 |
| `npm run apk:release` | 通过，内置 apksigner/zipalign 校验通过 |

正式包：`dist/apk/release/ShineWord-V0.4.4-release.apk`，SHA-256 `8199a4e38d11600c69ea6e34ea50aff351fd87600e242b5890a55a62cd15dadb`，签名证书 SHA-256 `017b3fbed4001083f2f70a0c51e8e463322df66b095e1c3a476fdd0d86dc2a0a`（与 V0.4.1–V0.4.3 一致）。

## 升级安装冒烟

QA36 AVD 上保留的故障测试数据为 Debug 签名，与正式包签名族不同，未在其上执行升级。在 `ShineWord_WorldBuildQA` 上构造正式包 N-1→N 升级链：

1. 卸载 Debug 包后安装 `ShineWord-V0.4.3-release.apk`（40300），冷启动成功（Status ok，545ms），进程存活，crash 缓冲 0。
2. `adb install -r ShineWord-V0.4.4-release.apk` 覆盖升级成功，dumpsys 确认 versionCode 40400 / versionName 0.4.4。
3. 升级后冷启动：Status ok，进程存活（PID 20511，18 秒后仍在），crash 缓冲 0，fatal 0。
4. UI 渲染正常：首启配置页完整，内置预设 DeepSeek V4.1 Flash（1M）/ GLM-5.3-Flash（1M）与 Keychain 提示可见，见 [release-smoke-v044.png](release-smoke-v044.png)。

说明：执行中一次进程死亡为宿主机内存耗尽触发 lowmemorykiller（同时开启两台模拟器所致），非应用缺陷；释放内存后复测通过。未使用 `ShineWord_WorldBuildQA36` 的测试数据，其上 Debug 安装与数据未受影响。
