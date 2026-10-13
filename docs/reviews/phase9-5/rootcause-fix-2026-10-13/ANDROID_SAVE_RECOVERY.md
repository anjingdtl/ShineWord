# Android 安装、输入与 save-10 恢复

## 最终安装身份

- `npm run apk:debug` exit 0。
- `adb -s emulator-5556 install -r dist/apk/debug/ShineWord-V1.0.0-debug.apk` 成功；未卸载、未 `pm clear`。
- 设备 package `com.shineword.app` versionCode 1000000 / versionName 1.0.0；最终 `base.apk` SHA 与构建 APK 相同：`51065228fa9fbc6c5421b288a396b5a7a6ca06414fb8f6332e6c9a977c5cf7cb`。
- 最终安装后显式 force-stop，再 cold launch：`LaunchState=COLD`，启动测得 2301 ms。之后从战役列表重新打开导入分支。

## 中文输入

Maestro `inputText` 因 `Maestro IME is not active` 失败，未插入或提交。使用已安装的 QA-only Android instrumentation helper 对真实 `com.shineword.app` 的 `play-composer` EditText 执行 `AccessibilityNodeInfo.ACTION_SET_TEXT`，层级复查与字符串长度/hash 验证通过，随后清空。此操作没有触及数据库，不等于自由文本提交。最终 UI hierarchy 显示 `play-composer` enabled、空输入时 `play-submit` disabled；没有调用 `playTurn`。

ADB 与 Maestro 的设备列表曾不一致：ADB 看到 API37 `emulator-5556`，Maestro 列表显示 API33 `pixel_6`。此前显式指定同一序列号的 Maestro 导航可用但驱动启动间歇超时；最终层级通过该设备的 `uiautomator dump` 读取。

## save-10 导入与冷恢复

1. 产品菜单 `menu-export-save` → Android `ACTION_CREATE_DOCUMENT` 系统选择器保存 v31 QA 分支。
2. 战役页产品 `campaign-import-save` → Android 系统打开选择器，选中刚导出的 `.shineword-save.json`。应用显示导入为新战役 `camp-mv66t99t`。
3. 导入 branch head/stateVersion=31，32 snapshots；其 12 个 `campaignContentBinding` artifact refs 均解析。计划 binding row/body hash、计划内容 hash、campaign artifact binding hash均匹配；6 条 deferred consequences 与来源 v31 快照一致。
4. 最终 APK 冷启动回到库页，重新打开导入分支成功进入 Play 屏。冷启动后新行动没有提交，因此 V95-10/A23/A32 按完整合同只记部分通过。

save import 会在新战役身份下重绑 plan/artifact archive IDs 和相应 hash；源/导入快照语义差异仅落在 12 个 artifact IDs、campaign content hash 和 plan ID/hash。每个重绑后的引用和哈希均经生产数据库复算通过。

## 数据保护

最终 APK 安装、save 导入和冷恢复前后，J1 `camp-mv3mw9hk-main` 保持 1 branch / 71 snapshots / 72 turns / 42 roll records / 151 branch events，所选表哈希一致；v33 来源主分支保持 1 / 34 / 34 / 14 / 88，哈希一致。新 campaign 是用户授权的独立导入副本。设备数据库原件在私有忽略目录。
