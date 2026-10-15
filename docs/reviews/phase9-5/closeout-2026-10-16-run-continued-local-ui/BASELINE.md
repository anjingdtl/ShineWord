# 本轮现场基线

记录时间：2026-10-15 23:35 UTC（2026-10-16 07:35 Asia/Shanghai）。

## 仓库与 Git

- 仓库逻辑名：ShineWord；origin fetch/push URL 为 https://github.com/anjingdtl/ShineWord.git。
- 本轮开始前施工分支：codex/phase95-closeout-short，HEAD 28b86157b1a691b9dc38a11b4cb9b3e763404ef2，工作树 clean。
- 最新 fetch 后 origin/main = 599d038efa6a65d7107f276961bc7b66caab37f6；施工分支与 origin/codex/phase95-closeout-short 同为 28b86157b1a691b9dc38a11b4cb9b3e763404ef2；相对 origin/main 为 0 behind / 11 ahead。
- 施工分支最初从 599d038efa6a65d7107f276961bc7b66caab37f6 建立。方案 SHA 仅供定位，没有作为施工输入。
- 主 checkout ShineWord-main-worktree 与 HEAD 599d038 保持不动；另有 ShineWord-phase95-20261015 worktree HEAD 2bbf179，sw95-detached-evidence 保持 detached 08b6452；未清理或覆盖这些现场。
- 本轮改动归属：Android 本地确定性 QA helper、合成 UI 证据和续跑文档。未改生产源码、既有报告或用户存档。
- 续跑复核时间 2026-10-15 23:45 UTC：再次 fetch 后 origin/main 仍为 599d038，origin 施工分支仍为 28b8615；本地相对 origin/main 为 0 behind / 11 ahead，工作树差异均为本轮预期证据文件。

## 工具与 Android 资源

- Node.js v24.14.1；npm 11.14.1；OpenJDK 17.0.19；Android Debug Bridge 37.0.0；Maestro 已安装。
- AVD 逻辑名 ShineWord_Phase95_20261016；在线标识 emulator-5554；API 37、Android 17、x86_64，/proc/meminfo 的 MemTotal 为 3,042,496 kB。屏幕配置 1080×2400、420 dpi。使用前发现原 2 GB AVD 遇到系统低内存；已在不 wipe、不保存 snapshot 的情况下以 3 GB 启动。
- App 包名 com.shineword.app，版本 1.0.0 / versionCode 1000000。
- 本轮使用隔离合成 fixture 存档与仅绑定主机 127.0.0.1 的本地 mock；真实模型端点未启用。
- 用户授权的 GLM 配置和小说素材只按逻辑资源登记；本轮未读取密钥或小说正文，未复制或提交。

## APK 与来源身份

- 本机 Debug APK 已存在并安装到本轮隔离 AVD，110,156,351 bytes，SHA-256 3d74e582f40a6203cb997e682e1d767eccdd9eaf70758b129c4e49c9c429095b；安装包 base.apk SHA 与构建文件一致。
- APK 源码输入仍为前轮生产提交 b4641bd8c27aafaed64eb001865b39088dcd6115，后续生产审计改动提交 36fe25d7459d093541a3691d864d6326fae7c868。本轮没有生产源码变化，因此未重建 APK。
- 最新相符的远端门禁是 PR #13 head 28b8615：Core Verify run 132 与 Android Verify run 97 均成功。见 TEST_REPORT.md。施工续跑提交的 CI 将在推送后更新。

## 证据限制

- Android 证据是当前 Debug APK 在隔离 AVD 上运行合成存档与本地确定性端点的 UI 集成证据。
- 不等同于真实 GLM 调用、授权小说旅程、save-10 精确回放、设备故障矩阵、真实完整旅程或独立试玩。
- 现场绝对路径仅用于本机复核；CHECKPOINT 与资源引用使用逻辑名，便于其他机器接续。
