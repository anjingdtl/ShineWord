# Shine-TRPG 第三期最终验收（P3 + P4）

> 方案：`docs/Shine-TRPG_PHASE3_CONSTRUCTION_PLAN.md` §36–§40
> 分支：`feature/phase3-ui-gameplay`（基线 `main @ 08eecb9`）
> 阶段文档：[P3_BASELINE.md](./P3_BASELINE.md) · [P3_REVIEW.md](./P3_REVIEW.md) · [P4_DATA_REVIEW.md](./P4_DATA_REVIEW.md) · [P4_REVIEW.md](./P4_REVIEW.md)
>
> **执行环境约束**：本轮在无 Android SDK / 无模拟器的远端环境完成，任务明确允许把测试留到线下开发机。
> 因此本文中所有「测试 / typecheck / APK / 截图 / 真机」项均为**未执行**，并按要求**不勾选**、不描述为通过。

## 1. 交付范围

### P3（页面精修 · 品牌统一 · UI 架构收口）

| 阶段 | 提交 | 结果 |
|---|---|---|
| P3.0 基线冻结 | `9f46a01` | 基线与未执行验证项记录 |
| P3.1 品牌地基 + 基础组件 | `1f688fc` | 品牌层、App Icon（矢量 + Adaptive + 回退位图）、启动页、5 个新组件、ThemeGallery 仅 Debug |
| P3.2 书库 | `416cc6c` | features/library；revision 与待审核数只读补充 |
| P3.3 战役 | `f16890b` | 战役卡 + 分支树；存档导入入口 |
| P3.4 Profile / First Run | `0d410d3` | 全部输入改 `TextField`；品牌统一；删除 legacyInput |
| P3.5 世界详情 | `abb8b06` | 四 Tab 产品化；`ThemeScope` 使世界主题覆盖生效；导出前缀改 `shine-trpg-` |
| P3.6 Opening | `deb6170` | 四步向导 + 卡片式单选 + 分步门禁 |
| P3.7 P3 收口 | `fe470d8` | 门禁审计、品牌迁移矩阵、版本 `0.3.0-p3` |

### P4（游玩页 / 角色卡 / HUD 重构）

| 阶段 | 提交 | 结果 |
|---|---|---|
| P4.1 只读 Projection | `0b75f46` | 核心投影 + NPC 公开投影 + 桥接；新增投影回归测试（已编写未运行） |
| P4.2 Controller 解耦 | `c74791f` | `usePlayController`；页面业务函数清零 |
| P4.3 叙事流 | `c8731ba` | PlayHeader / TurnCard / RollStrip / NarrativeFeed |
| P4.4 输入与快捷行动 | `c446943` | ActionComposer + 情境快捷行动（本地推导、只填入不发送） |
| P4.5 队伍条 + Sheet 载体 | `33cc548` | PartyStrip + PlayPanel（Modal + Animated） |
| P4.6 玩家/同伴角色卡 | `5ef1243` | 技能（真实练习点）/ 能力槽 / 装备 / 关系 / 同伴指令；训练迁入角色卡 |
| P4.7 NPC 公开角色卡 | `8a3788b` | 仅公开投影；未探明占位 |
| P4.8 遭遇 HUD | `7a97c2d` | 先攻条 / 距离带 / 战斗者卡 / 战斗动作 |
| P4.9 五个信息面板 | `5fe9c3b` | 角色 / 队伍 / 任务 / 物品 / 知识 |
| P4.10 系统动作收纳 | `a4a3894` | Game Menu（休息 / 回退 / 存档 / 战役信息 / 退出） |
| P4.11 四主题适配 | `875c81b` | 主题专属表现 + 文字 Token 与承载面错配清理 |
| P4 收口 | `e33eb39` | `legacyStyles.ts` 删除；Hex 扫描 0 处 |

版本：`mobile/package.json` 与 `build.gradle` = `0.3.0-p4`，`versionCode` 12。

## 2. 冻结边界核对（方案 §35）

| 禁止项 | 核对结果 |
|---|---|
| 重写游戏规则 / 骰点算法 / 成长阈值 | 未触碰：`src/domain/**`、`src/application/**` 仅在 **P4.1 新增只读投影文件**（见 P4_DATA_REVIEW.md） |
| 修改存档 schema / 迁移 / 旧存档兼容 | 未触碰：`migrations/**`、`saveFile.ts`、`.shineword-*` 扩展名与旧格式读取路径保持原样 |
| 修改 applicationId / 数据库名 | 未触碰：`com.shineword.app`、`shineword.db` |
| NPC UI 读取 GM-only 卡 | 公开投影强制剥离（属性/能力/预备槽/资源上限/隐藏技能 id/模板 id），并有回归用例断言 |
| 为快捷行动新增 LLM 调用 / 自动发送 | 未新增：快捷行动纯本地推导，只有 `onChangeText` 路径 |
| 新增大型 UI 框架 | 未新增任何依赖（弹层用 `Modal` + `Animated`；图形用既有 `react-native-svg`） |
| 修改 P2 已验证写路径 | 未触碰：`commitTurn` / `createCampaign` / `rewind` / `saveFile` / `publish` / 队伍动作等调用点参数与 P2 一致 |
| UI 复制业务规则 | 未发现：可用性判断均来自视图字段或 Session 返回值 |
| 把 Debug ThemeGallery 暴露为 Release 功能 | 保持 `__DEV__` 双向门禁 |
| 未 Review/Fix 就进入下一阶段 | 每阶段均有 Review 记录与修复项（见各阶段文档） |

## 3. 产品 / 架构 / 业务 / 工程 验收（方案 §38）

### 产品

| 项 | 状态 |
|---|---|
| Shine-TRPG 品牌一致 | ✅ 静态：用户界面旧品牌字面量 0；README / About / 启动页 / 桌面名统一 |
| 非开发用户界面不再出现 ShineWord 品牌 | ✅ 静态（内部兼容标识按 §3.6 保留并已在 P3_REVIEW 品牌矩阵逐条列明） |
| 四主题统一 | ⬜ **待截图验证** |
| 开局流程完整 | ⬜ 源码就绪，**待真机验证** |
| Play 主流程自然 | ⬜ 源码就绪，**待真机验证** |

### 架构

| 项 | 状态 |
|---|---|
| Screen 精简 | ✅ PlayScreen 642 → 约 190 行；其余屏幕只做数据装配与路由 |
| Feature Component 成型 | ✅ `features/{library,campaigns,profile,world-detail,opening,play}` |
| `legacyStyles.ts` 删除 | ✅ 已删除，无引用 |
| UI 不复制规则 | ✅ 静态核对 |
| Play Projection 只读 | ✅ 核心投影无写操作；桥接只读 `getSummary` + 世界包条目 + `actor_cards` |
| NPC Projection 安全 | ✅ 策略层剥离 + 回归用例（已编写未运行） |

### 业务（全部**待真机回归**）

创建战役 / 回合 / 骰点 / 训练 / 队伍 / 战斗 / 任务 / 知识 / 存档 / rewind / 恢复 / 分支 —— 均保持原有实现与调用参数，
本轮**未执行**任何真机或模拟器验证。

### 工程

| 项 | 状态 |
|---|---|
| Core tests PASS | ⬜ **未运行**（方案基线 152/152） |
| Mobile typecheck PASS | ⬜ **未运行** |
| Debug APK PASS | ⬜ **未运行** |
| Release APK PASS | ⬜ **未运行**（需签名环境变量） |
| Release arm64 包体记录 | ⬜ **未测量** |
| Git diff clean | ✅ 每阶段提交后工作区干净 |
| 无密钥 / 私人小说 / 存档进入 Git | ✅ 本轮未新增任何此类文件 |

## 4. 测试与验证待办（线下开发机）

```bash
# 1. 核心回归（含 P4.1 新增投影用例）
npm install
npm run verify:core            # 期望包含 tests/phase3-play-projection.test.cjs

# 2. 移动端类型检查（本轮改动全部为 TS/TSX，必须补跑）
npm install --prefix mobile
npm run typecheck --prefix mobile

# 3. APK
npm run apk:debug --prefix mobile

# 4. 真机 / 模拟器矩阵
#    P3：首次启动 / Profile 保存 / 四主题切换 / 导入 TXT / Library / WorldDetail /
#        三宝书 / Review Queue / 世界主题覆盖 / Opening 4 步 / 创建战役
#    P4：进入已有战役 / 首回合 / 有骰回合 / 无骰自动成功 / Narrator 失败恢复 /
#        App kill 恢复 / 短休 / 长休 / 技能训练 / 队伍指令 / 分队 / 重入 /
#        知识分享 / 物品转移 / encounter / attack / rescue / move / dash /
#        NPC turn / retreat / rewind / 导出存档 / 导入存档 / 角色卡 /
#        NPC 公开投影 / Quest / Knowledge / 四主题
```

### 已编写、未运行的测试

| 文件 | 覆盖 | 状态 |
|---|---|---|
| `tests/phase3-play-projection.test.cjs` | 玩家全量 / 主队同伴全量 / 离队不泄漏 / GM-only 不泄漏 / 未观察角色无运行期状态 / stateVersion 一致 | **已编写、未运行**（需 `npm run build:core` 产出 dist 后由 `npm test` 执行） |

## 5. 已知阻塞与风险（需线下确认）

1. **类型与构建未验证**：本轮所有改动未经过 `tsc`；虽然逐文件静态复核过导入/类型/括号，仍需以 `typecheck` 结果为最终判定。
2. **对比度未实测**：四主题文字对比度依据 Token 值静态估算（已在 P4.11 修正白卡文字 Token 错配）；需真机截图复测。
3. **`Eye` / `EyeOff` 图标**：`TextField` 的明文切换使用 lucide 的 Eye/EyeOff（未在本环境解析 dependency 版本），若该版本缺失需替换为文字开关。
4. **世界钟格式**：时辰/刻的换算为展示派生，若产品口径不同（如时辰起点）需调整单点函数。
5. **NPC「已观察技能」口径**：当前为「模板 `visibility: public` 的技能子集」，与「遭遇中被使用过的技能」是两种口径，方案 §14.1 选择前者。
6. **未探明占位的可玩性验证**：需要真实世界包 + 遭遇才能看到实际效果。
7. **Release 包体**：方案要求用 Release arm64 口径评估，本轮未构建。

## 6. P4 Definition of Done 对照（方案 §37）

| DoD 项 | 状态 |
|---|---|
| Agent 开工前已阅读 `data-availability.md` | ✅ 已完整阅读（另含 UI_REDESIGN_PLAN、原型 HTML、runtime、PlayScreen、session、card、state types） |
| 新增一致 stateVersion 的 Play UI Projection | ✅ |
| NPC Public Projection 不泄漏 | ✅ 静态 + 用例（用例未运行） |
| PlayScreen Controller 与 UI 分离 | ✅ |
| NarrativeFeed 上线 | ✅ |
| RollStrip 上线 | ✅ |
| 常驻 Composer 上线 | ✅ |
| Contextual Quick Actions 上线 | ✅ |
| 无新增快捷建议 LLM 请求 | ✅ 静态 |
| Party Strip 上线 | ✅ |
| 玩家角色卡上线 | ✅ |
| 同伴角色卡上线 | ✅ |
| NPC 公开角色卡上线 | ✅ |
| practicePoints 正确显示 | ✅ 取自核心投影阈值（真机待验） |
| ability cooldown 正确显示 | ✅ 按状态版本判定（真机待验） |
| HP / stamina / condition / lifeStatus 正确 | ✅ 来自快照（真机待验） |
| Encounter HUD 上线 | ✅ |
| 角色 / 队伍 / 任务 / 物品 / 知识面板上线 | ✅ |
| 短休 / 长休 / rewind / 存档从主页面移入合理入口 | ✅ |
| 技能训练迁入角色卡 | ✅ |
| 四主题 Play 完整适配 | ⬜ **未截图，待验证** |
| `legacyStyles.ts` 删除 | ✅ |
| typecheck PASS | ⬜ **未运行** |
| core regression PASS | ⬜ **未运行** |
| Android APK PASS | ⬜ **未运行** |
| 关键真机/模拟器旅程通过 | ⬜ **未执行** |
| P4 Review/Fix 关闭 | ✅ 各阶段 Review/Fix 已逐项关闭（运行期验证项除外） |

## 7. 结论

**源码实现、阶段拆分、静态审查与修复全部完成**；第三期最终出口判定**尚未成立**，
必须在具备 Android 环境的线下开发机补齐第 4 节的全部验证项后，才能宣布 P3+P4 通过并进入 `0.3.0-alpha`。