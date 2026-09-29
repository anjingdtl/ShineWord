# Q4-08 兼容与存档保留复验

日期：2026-09-29。所有设备命令只针对已有隔离 AVD `emulator-5554`。本报告不覆盖真实用户的其他设备或私人存档。

## 结果

| 兼容面 | 状态 | 证据与范围 |
|---|---|---|
| 已安装数据库升级到本地 Phase 4 Release | PASS（有限） | 同签名候选在已有安装上 `adb -s emulator-5554 install -r ...apk` 成功；没有清数据。启动书库、战役入口和旧 QA 战役后，SQLite runtime 正常加载新 migration 16；首次安装时间未变。 |
| 导入世界保留 | PASS（有限） | 更新前后均显示两部合成 QA 世界，均可见「继续冒险」和「世界详情」。图像证据：`%TEMP%\shineword-phase4-preinstall.png` 与 `postinstall.png`。没有导入或覆盖私人小说。 |
| 旧 partial 世界、无锚点与 `revealAt='1'` | 自动回归 PASS；本机已导入数据库 NOT TESTED | `tests/progressive-opening.test.cjs` 的 `anchor-less world setup still exposes the compiled opening location and lore (r7 D3)` 将旧 opening facts 恢复为字面 `'1'`，确认读取投影可见、建战役成功且数据库原值保持 `'1'`。没有要求用户删库重来。 |
| 历史 save/world package | 自动回归 PASS；本机旧包往返 NOT TESTED | `tests/phase2-acceptance.test.cjs` 覆盖 save/archive 导入、回退、活动遭遇保存恢复和 portable package identity remap；本轮没有覆盖用户私有存档或从当前设备导出并往返。 |
| 分支 / 角色 / 物品 / 知识状态 | 自动回归 PASS；更新前后真实值逐字段对比 NOT TESTED | 本轮截图只公开合成世界数量与入口，没有读取私有数据库或宣称所有记录逐字段相同。自动回归保持既有 state、branch 和 save contracts。 |
| 主题与 Keychain | 主题 UI 冒烟 PASS；Keychain 配置/密钥引用保留 NOT TESTED | 四主题截图有证据；本轮没有读取/导出密钥，也没有对密钥进行输入、迁移或调用。主题持久化键在本地回归/既有实现中保留，但未在本次 `install -r` 前后逐字段核对。 |
| 旧 `loadHistory` 与机械结果可读 | 自动回归 PASS | `StoryEntry` 投影加入已提交无 narrative 的安全机械说明；不通过 `publicSummary`、effects 或 decisionBasis 直接建正文。历史与当前故事投影有 Node 回归，未在设备上构造新的机械-only commit。 |
| 用户工作文件 | PASS（保留） | `.workbuddy/memory/2026-09-28.md` 的已有修改、`.zcodeignore`、用户新提供的提示/方案和其他新增文件均未 reset、clean、覆盖或暂存。 |

## 兼容性结论

本轮证明同签名 `install -r` 后已有 QA 数据库可打开，两个已导入合成世界仍可使用，Release 能断网启动。旧 partial 世界的字面 `revealAt='1'` 由自动化兼容读取，不改写历史事实。私人数据库、密钥引用和旧存档没有在本轮逐字段安装前后对比，因此这些设备兼容项仍为 NOT TESTED；不能将有限 QA 数据保留写成所有旧库完整兼容通过。

设备数据保留证据仅来自 `ShineQA`。没有操作 `Medium_Phone`，没有运行 `pm clear`、卸载、wipe-data 或覆盖用户存档。
