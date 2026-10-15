# Android 设备证据

## 设备与安装身份

- 隔离 QA AVD：逻辑资源名 phase95-empty-avd-20261016；Pixel 6 硬件配置；Android emulator system image 37.1，运行 API 37，x86_64。
- ADB 当次设备序列号：emulator-5554。它只用于本机本轮复验，跨机器接续请以隔离 AVD 逻辑名和 APK SHA 为准。
- 应用：com.shineword.app，versionName 1.0.0，versionCode 1000000，minSdk 24，targetSdk 36。
- Debug APK：110156351 bytes；SHA-256 3d74e582f40a6203cb997e682e1d767eccdd9eaf70758b129c4e49c9c429095b。
- 安装后从设备拉取的 base.apk SHA-256 与本地 APK 相同。
- 源码身份：生产源码摘要 333b22e1202d11be4177d167b6cf1dfd8e41c8cc4e80e6877eb8f34d0f055d66；构建输入与提交 b4641bd8c27aafaed64eb001865b39088dcd6115 的生产文件一致。

## 实际观察

- 在新建、空数据 AVD 安装并启动应用。首次启动发生一次 Android LOW_MEMORY 进程退出；再次冷启动和 force-stop 后重新启动均成功，MainActivity 为 resumed activity。
- 无 FATAL EXCEPTION。SQLite FTS5 探测出现 no such module: fts5，生产能力探测捕获并回退到非 FTS 模式；本轮未据此修改生产代码。
- 首屏为模型配置引导，无已保存 profile、战役、角色、小说或请求。
- UI hierarchy 有 55 个节点、3 个 EditText、9 个可点击节点、9 个有描述的控制项。profile-name、profile-endpoint、profile-model 有可读标签。
- 聚焦模型输入框后键盘正常显示，输入框处于键盘上沿可视区域；没有输入或保存内容。
- 将系统字体比例调至 1.3 后页面可滚动并恢复到 1.0。截图：screenshots/R5-empty-avd-onboarding.png、screenshots/R5-keyboard-focus.png、screenshots/R8-font-scale-130.png。
- 现有 ShineWord_P2_Clean AVD 内已有应用数据；没有对它执行安装、启动、清理、卸载或数据迁移。另建空 AVD 完成本轮安装，未清理用户数据。

## 验收边界

通过的是 APK 构建身份、隔离 AVD 安装身份、冷启动重试和配置首屏/键盘/字体比例冒烟。没有在 UI 中配置模型、导入小说、创建战役或产生网络请求；没有完成选择、掷骰、Narrator、提交、恢复、Stage-8 或自然结局。TalkBack、小屏、主题对比、实体设备、API 24 和正式恢复路径仍未验证。

因此 R5、G5、V95-05、V95-09、V95-10、A35 等不因本次空首屏冒烟而整体 PASS。
