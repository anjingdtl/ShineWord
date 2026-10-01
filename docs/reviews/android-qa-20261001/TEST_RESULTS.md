# Android 验收执行记录

测试日期：2026-10-01（Asia/Shanghai）。基线：`0adadcd`，V0.4.1。

| 模块 | 状态 | 结果与证据 |
| --- | --- | --- |
| M0 | 通过（已修复） | 577/577 核心回归，移动类型与版本门禁通过；独立 debug APK 安装、冷启动与重启通过，v2 签名有效 |
| M1 | 通过（已修复） | 设备 GLM 低/高/最高三档真实连接成功；配置、Keychain 密钥重启复用成功；修复无密钥保存失败却发布配置 |
| M2 | 通过（已修复） | 完整小说导入、第一阶段发布、暂停/重启续建和同文件去重通过；修复冲突审查与续建死路 |
| M3 | 通过（已修复） | 原创两步开局、原著四步开局、首回合生成、重启继续通过；修复游玩页返回入口 |
| M4 | 待执行 | |
| M5 | 待执行 | |
| M6 | 待执行 | |

完整范围与通过条件见 [TEST_PLAN.md](TEST_PLAN.md)。

## M0 构建与启动

- 设备：`emulator-5556`，ShineWord_P2_Clean 临时只读实例，Android 17 / API 37.1，x86_64，1080×2400 / 420dpi。
- 原 debug APK（91.76 MiB）安装后显示 `Unable to load script`。原因：debug 被列为 `debuggableVariants`，Gradle 跳过 JS bundle，无法脱离 Metro 启动。
- 修复：`apk:debug` 指定 `shinewordStandaloneDebug=true`，嵌入 Hermes bundle 并关闭该构建的 Metro 支持；普通 `run-android` 保留开发服务器流程。打包脚本新增 bundle 存在性检查。
- 修复后 APK：`dist/apk/debug/ShineWord-V0.4.1-debug.apk`，97.54 MiB，包名 `com.shineword.app`，versionCode 40100，一名签署者，v2 验签通过。
- 未启动 Metro、无 adb reverse；冷启动实际进入首次模型配置页，再次强停启动也成功。首次 Activity 启动耗时 1,983ms（不等同于全部 JS UI 首帧耗时）。截图：[M0_FIRST_RUN.png](M0_FIRST_RUN.png)。
- 构建环境阻滞：JDK 在默认 Windows 短路径 TEMP 中创建 Unix-domain socket 时失败；指定本次进程 `jdk.net.unixdomain.tmpdir=C:\Temp\shineword-qa` 后 Selector 探针与 Gradle 均成功，操作见构建文档。
- 原始证据：本地目录中的 `build-debug.log`、`build-debug-fixed.log`、`m0-baseline-block.xml`、`m0-cold-restart.xml`。

## M1 模型设置与凭据

- 使用用户文件指定端点，选择内置 `glm-5.3-flash` 预设。设备真实连接探针：Low 5,340ms，High 1,599ms，Max 3,026ms，均返回成功；这证明请求参数被端点接受，不推断模型内部推理深度。
- 缺陷复现：首次只填端点与模型、不填 Key，点保存提示失败；强停重启却进入书库。原因是普通配置在 Keychain 检查前已经持久化。
- 修复：配置验证后先确认/写入 Keychain，成功后才发布普通配置。新增 3 项回归，验证缺少密钥、Keychain 失败、无效配置不会发布新配置或更换密钥，并验证已保存密钥可复用、普通存储只包含 keyRef。
- 设备复测：缺少 Key 保存失败后重启仍显示首次配置；填真实 Key 完成保存后重启进入书库；「我的」Key 输入保持空白，从 Keychain 复用进行连接测试成功（2,148ms）。截图：[M1_CONNECTION.png](M1_CONNECTION.png)。
- `profile-store` 11/11 通过，移动端类型检查与独立 debug 重新构建通过。
- 原始证据：`m1-missing-key-restart.xml`、`m1-missing-key-fixed-restart.xml`、`m1-probe-{low,high,max}-result.xml`、`m1-keychain-reuse.xml`。

## M2 小说导入、阶段构建与审查

- 完整用户 TXT 3,065,535 bytes，SHA-256 `6faa89e68bba97a96e1dacc0cc969de2b3217dc9c59167e9bfdb2b9e27971c81`，模拟器文件与本机文件相同。系统文件选择器导入成功：300 章、944 块、965,462 code points，UTF-8。
- 循序构建第一阶段覆盖前 106 章、295 块、3 个并行批次。真实 GLM 抽取分别耗时 80,162 / 109,393 / 98,247ms；时间线 34,575ms；映射 55,130ms。账本合计 5 个成功请求。
- 抽取期间点暂停并回到桌面，前台服务保持运行；批次完成后进入 `paused_user` 3/3。强停重启仍保留 3/3，继续构建复用抽取和时间线，没有重复已完成请求。
- 阻滞：不同 JSON 描述被视为冲突，发布只显示笼统错误；旧「按事实解决」只改审查提示，不改冲突事实；新增明确分类后，待审查状态又阻止显式续建。
- 修复：按人物显示已有/待核对描述及逐字证据，提供「补充事实保留」或「待核实」决定；事务保存事实状态、保留证据与审查记录；剩余冲突持续阻塞，全部处理后才允许续建。普通续建仍不能重放计费结果不明的请求。
- 设备通过 UI 核对：周景云身世作为补充保留；庄篱地点记录引用仅支持姓名，转为待核实，未强行纳入世界映射。最终 64 explicit / 4 inference / 2 speculation，冲突清零，三个审查记录已解决。
- r1 已发布，包范围 `[0, 290271)`，`incremental / partial`；界面出现可游玩入口，玩家手册、城主指南、怪物图鉴及世界包页能打开。图鉴无可见条目时显示空态。后续两阶段尚未触发，不能据此声称全文已精编；修正项目页的阶段完成提示。
- 同一完整 TXT 再导入后自动回到原项目；仍为 1 世界 / 1 active 源 / 1 run / 5 请求，未重复计费。导入提示显示小说名称。
- 核心回归 582/582、移动类型检查通过；新增审查/续建回归验证证据保存、不能空豁免、无证据不能确认、待核实不映射、跨世界/重复决定拒绝与保留已完成批次。
- 原始证据：`m2-review-blocked.xml`、`m2-reviewed-detail.xml`、`m2-second-conflict.xml`、`m2-three-books.xml`、`m2-mapping-status.xml`、`m2-reimport-final.xml`；截图：[M2_REVIEW.png](M2_REVIEW.png)、[M2_PUBLISHED.png](M2_PUBLISHED.png)。

## M3 两种身份开局与重入

- 原创两步流程：空姓名时下一步禁用；填写 Shiheng、短描述与目标，确认推荐属性/技能、原著事件锚点与定安伯府地点后成功创建。无可招募同伴时展示独自开局空态。
- 原著四步流程：世界起点 → 原著角色（定安伯）→ 同伴 → 确认，通过证据派生属性/技能，世界包 r1 与规则 0.2.0 锁定。两个独立战役各完成首个真实观察回合，Planner 与 Narrator 均成功，状态版本各为 v1。
- 开局初始页明确要求第一个行动；首回合才生成故事。原创首回合 Planner 3,522ms、Narrator 3,194ms，角色卡显示气血/体力 10/10、六属性和初始技能。
- 重装保留数据并强停重启，在战役列表看到两场战役，继续原创战役时保留原叙事与 v1，无额外模型请求。
- 缺陷：从项目开局后「‹ 战役」实际返回项目页。修复为显式返回战役列表，设备复测入口与标签一致；移动类型检查和独立 APK 构建通过。
- 连续游玩模块继续核查已发现的夜间时钟与清晨叙事不一致；不将 M3 首回合证明扩大为全部叙事质量保证。
- 证据：`m3-quick-identity.xml`、`m3-quick-confirm.xml`、`m3-advanced-world.xml`、`m3-advanced-companions.xml`、`m3-advanced-confirm.xml`、`m3-canon-first-turn.xml`、`m3-restart-campaigns.xml`、`m3-original-reentered.xml`、`m3-back-fixed.xml`；截图：[M3_FIRST_TURN.png](M3_FIRST_TURN.png)、[M3_CANON_START.png](M3_CANON_START.png)。
