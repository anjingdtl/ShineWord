# 本机 AVD 项目归属复核

日期：2026-10-19（Asia/Shanghai）

## 当前登记设备

本机 `ANDROID_AVD_HOME` 指向 `F:\avd`。Android Emulator 重新枚举后仍登记 3 台：

| AVD | 项目归属与用途 | 本轮状态 |
|---|---|---|
| `Medium_Phone` | TAVO-MINI、ShineFS、ShineWord 共用的长期设备 | 离线；保留原数据 |
| `ShineWord_M4FaultQA_20261018` | ShineWord 阶段 9.5 合成数据与设备故障注入 | 在线设备 `emulator-5560`；保留测试数据库 |
| `ShineWord_Phase95_LocalFinal_20261018` | ShineWord 主流程与真实小说验证 | 在线设备 `emulator-5556`；本次未改动 |

## 未登记目录

`F:\avd\Pixel_10.avd` 没有对应 AVD 注册文件，不会出现在 `emulator -list-avds` 中。目录配置显示 Android 36.1 / Google Play 镜像；交叉核对本机 TAVO-MINI 文档后，确认它是 TAVO-MINI 的 Android 16 验证数据，目录文件逻辑合计约 20.16 GiB。本次保留，避免删除其他项目数据。

## 清理结论

此前按 ShineWord 的 3 台上限，已经删除 7 台不再使用的历史 ShineWord AVD，实测腾出约 45.53 GiB；详见 [2026-10-18 清理记录](../local-final-closeout-20261018/AVD_CLEANUP_LOCAL.md)。本次复核仍只有 3 台已登记设备，没有超额的 ShineWord AVD 可继续删除。未删除共享 `Medium_Phone`、TAVO-MINI 的 `Pixel_10` 数据、系统镜像或任何应用存档；本轮没有新增 AVD，也没有执行 `wipe-data`。
