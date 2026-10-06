# ShineWord / Shine-TRPG 项目长期约定（Workspace Memory）

- 项目：Android 轻量文字 TRPG（作者 ShineHe），根 `F:\ClaudeWorkSpace\projects\ShineWord`。核心 TS 在 `src/`，RN 桥接/UI 在 `mobile/`，测试在 `tests/*.test.cjs`（node:test，require `dist/`）。
- 门禁命令：`npm run verify:core`（=typecheck + build + 全量测试）、`npm run verify:version`、`npm run typecheck --prefix mobile`、`git diff --check`（必须为 0）、`npm run apk:debug --prefix mobile`。
- 交付：源码变化后跑全量门禁 + Debug 构建；提交用显式路径、保留历史、**不 reset/force/tag/Release**；未经授权不合并 main。用户会在明确指示时授权推送 main。
- 文档纪律：**不冒充完成**——每项结论要有证据位置；NOT RUN 不计入通过；真实/合成证据严格分开；证据索引在 `docs/reviews/phase8/`。
- 单协议政策（第八阶段）：`shineword-core@0.3.0`、ActionContract 2.0、save-9、迁移单基线 version 100；旧输入逐版本拒绝，无转换器。
- 私密资产放 `.tmp/`（gitignore）：真实旅程驱动、密钥、设备 dump、sqlite 快照。密钥文件 `C:\Users\Administrator\Desktop\AIstudio\Test-key\GLM-TEST.txt`（不入库、不打印）。
- 真实小说：`C:\Users\Administrator\Desktop\AIstudio\放开那个女巫.txt`。
- 网络坑：到 GitHub 的 git 走本机代理易瞬时 502；重试 push 即可。`gh` token 可能失效，git credential helper 仍可用。
