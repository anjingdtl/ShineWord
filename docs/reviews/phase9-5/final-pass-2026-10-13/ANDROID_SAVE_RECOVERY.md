# Android save-10 导出、导入与恢复

## 设备流程

设备：emulator-5556 / ShineWord_P2_Clean / API 37；应用 com.shineword.app。

1. 在 Android UI 通过系统创建文档选择器导出。
2. 存档格式 shineword-save-10；私有文件 SHA-256 033e847348c3c18a3eac8941ee9cfd08b5dd2b1e90951b6c963c684042cd69b，1,933,855 字节。
3. 在战役页用系统文档选择器导入。校验成功后创建新战役 camp-mv5kpgrf / camp-mv5kpgrf-main，stateVersion 27；没有覆盖来源战役。
4. 强制停止并冷启动，再从战役页进入导入副本，随后完成真实新行动和重规划。

私有 UI 证据：ui-27-export-picker.xml、ui-28-after-export.xml、ui-31-import-picker.xml、ui-32-after-import.xml、ui-34-after-cold-start.xml、ui-36-imported-play.xml。保存文件在 campaign-save-export-private.json。

## 数据核查

- 来源分支 camp-mv5f6yt7-bmv5gqfw9 是 v27，有 28 条已提交历史；导入副本也从 v27 开始。
- 导入恢复 plan revisions 1–10。turn-0028 在 v27 冻结时使用这些旧绑定；重规划后新增 revision 11、12。
- 导入副本基础 branch content manifest 为 690e22eabcea732f660c306d3134a3d43bfec882ed43d8b4e077d0ee863f8778；后续冷启动和行动后仍可读。
- turn-0031 的两项后果属于新战役分支，截至 v33 未触发；来源分支仍 v27。
- 冻结 J1 camp-mv3mw9hk-main 仍 v70；turn-0071 未提交。

V95-10 的 save-10 UI 导出、系统选择器导入、新战役创建、冷启动、继续行动和分支隔离通过。该结论只覆盖实际副本；不代表坏存档、进程中断、unknown outcome 或完整 A32 通过。
