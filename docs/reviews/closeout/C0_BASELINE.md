# C0 基线：当前版本可构建

日期：2026-09-28。施工基线 HEAD：`fe2ff3abaf001fd76071fe2d7b507a533da4dd4f`（与审查基线一致，工作区除两份未跟踪计划文档外干净）。

## 目标与出口

恢复 mobile TypeScript 门禁与 Android debug 构建门禁：不删除测试、不引入 `any`、不关闭 strict、不忽略文件。

## 实测问题与修复

### 1. 依赖未安装（真实缺失，非声明问题）

`mobile/package.json` 已声明但 `mobile/node_modules` 实际缺失 6 个包：
`@react-navigation/bottom-tabs`、`@react-navigation/native`、`@react-navigation/native-stack`、`lucide-react-native`、`react-native-screens`、`react-native-svg`。

修复：`npm install --no-audit --no-fund`（mobile 目录，package.json 版本范围不变，仅同步 lock 与安装状态）。安装后错误数从 200+ 降至 99。

### 2. 真实相对导入路径错误（依赖装好后仍然存在）

- `features/opening/*`：`'../../../../src/domain/characters/card'` 少一层（4 层只到 `mobile/src`），修正为 5 层。
- `features/play/{character,encounter,hooks,panels}/*`：核心投影/卡片导入少一层（5 层只到 `mobile`），修正为 6 层；`'../../components/*'`、`'../../theme/*'` 应为 3 层（到 `mobile/src/ui`），修正。
- `features/play/TurnCard.tsx`：`react-native` 导入缺 `StyleSheet`，补齐。

`features/play/` 根目录文件原有 2 层路径正确，未改动（PartyStrip 等净变更为 0）。全部 24 个改动文件仅 import 行变化，91 行增 / 91 行删，无逻辑改动。`ui/state/AppSessionContext.tsx` 的 4 层直达核心惯例保持不变。

## 门禁结果（全部本机本轮实测）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 核心回归 | `npm run verify:core` | **156 tests / 156 pass / 0 fail**（含核心 TS 编译） |
| mobile TypeScript | `npm run typecheck --prefix mobile` | **PASS（0 错误）** |
| debug APK | `node scripts/build-apk.js debug`（mobile） | **BUILD SUCCESSFUL**，产物 `dist/apk/debug/ShineWord-V0.3.0-p4-debug.apk`，96,217,931 bytes，SHA-256 `c545976913f1ce17803dcca0fb512fe1453160e73eb72358f4f4f285fe66b981` |

typecheck 中出现的 TS7006 implicit-any 全部为模块解析失败的级联效应，路径修正后消失，未逐个加 `any`。

## 边界

- 本阶段只恢复编译与构建门禁；四主题截图、真机安装与完整旅程属于 C6/C7 验收，不在本阶段声称。
- debug APK 未在设备安装验证（留给后续阶段的隔离安装验证，避免动既有模拟器数据）。
