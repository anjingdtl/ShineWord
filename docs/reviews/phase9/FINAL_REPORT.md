# Phase 9 收尾复验报告

2026-10-07，Asia/Shanghai。工程修复通过核心与构建门禁，整体第九阶段尚未通过。旧“90有效决定、技术验收完成”撤销；未提交、结束后探索和机械重复不计最低80，主机不替代必需设备决定。

| 身份/门禁 | 结果 |
|---|---|
| 起始HEAD | fab6f171fba075c69fbe0bb1ecec4058fd9e0cae，起始干净 |
| 最终生产源码SHA-256 | c12623bd95252b9f774231b68e1c4590913865e073a8f56f9ff6474386d6bc18，identity scope v2（含Android原生/构建输入；final17为980cb370…，final18仅candidateModel/generationService两文件变化，移动/原生显示源码与final14逐文件相同） |
| Debug APK | dist/apk/debug/ShineWord-V1.0.0-debug.apk，109,436,143 bytes / 104.37MB |
| APK SHA-256 | 7b7ebd3411bd882a697c54a047ce5d78de36b52900af1056b919c70474af53ca |
| Android | emulator-5556 / API37，保留数据安装，V1.0.0 / 1000000 |
| 核心全量 | verify:core 1005/1005，失败0跳过0（final18，reaccept-core-final18.log）；16项跨模块flow集成；解析/规划/flow组56项 |
| 移动类型检查 | typecheck通过（reaccept-mobile-final18.log） |
| APK构建 | debug通过（reaccept-apk-final18.log） |
| 版本/diff | verify:version与git diff --check通过 |
| 共享预算 | 1100上限，接手时959，最终1045（余55）；含接手轮复现回合2、final18 J1全程与J4分支10 |
| 设备UI旅程 | **J1 UI 23决定（≥20）+ J4 UI分支10决定，同final18身份完成**；真实阶段失败×3→自动重规划→second-chance→再推进全程发生；重规划内容full_success门致停滞4次（A36证据） |
| 私有身份/日志 | .tmp/phase9/reaccept-identity-final18b.json、reaccept-device/identity.json（final18）、journey-ui-j1-final18.jsonl、journey-ui-j4-final18.jsonl |

先梳理M0–M9全流程权威与交接，再按模块修复并做生产Session/SQLite交叉回归。修复覆盖冻结/响应恢复、候选hash/fence、原子管理提交、事件/本地动作/战斗同提交结算、技能/关系/资源投影、重规划有效原文与旧承诺、失败清primary后排队、期限与部分成功的区分、存档重绑、生成示例/事件名合同、当前主线指引及Android字体/键盘/阅读布局。零资源原回合按原输入恢复成功，仅增1次Narrator，保留严格正数验证。具体见FLOW_REVIEW和IMPLEMENTATION_PROGRESS；工程通过不能代替内容门。

final14 Android显示复验通过：360/411dp×1.3/2字号四组完整冷启动、行动与目标键盘、主线滚动底部、关闭及前后台；三次前台动态字号变化；未提交目标草稿和个人页路由保留；四主题主线卡/展开面板八张实际截图可读可操作。显示测试无HTTP、旧分支v24未变。final17逐文件确认全部移动/原生显示源码与final14相同，证据身份保留；final15 APK实际恢复原奖励缺字段响应，将误分类的retryable_failed纠正为invalid，该任务仍为原两次HTTP，恢复没有重发。重新进入开局另有一次opening_goal请求，分开记账。final10/12/13失败证据保留，未用最终成功覆盖历史失败。A01–A40目前28 PASS、2 FAIL、10 NOT RUN。

100/300/1000生产Session本地累积实际通过：快照5128/5129/5133 bytes，runtime1414/1414/1415 bytes，结构1412恒定，jobs=1，查询约1.21/2.77/5.33ms。边界使用模拟LLM/RNG，生产Session和SQLite真实运行；范围为已准备局面，不外推无限重规划归档。证据 reaccept-longrun.json。

J2九决定自然completed停止；J3原回合恢复，另有新长篇3决定失败诊断和8决定节奏停滞诊断。设备J1跨身份不计完整最终20；J4同v12分叉有，但10+10未齐。质量各维独立评分，仍有低于3。A01–A40见ACCEPTANCE_MATRIX，不使用PART。

剩余合同范围：

- 最终同身份host J1/J2/J3各20、J4各10（设备必需UI20+10已于final18完成；J1实际23、J4分支10）。
- 两个持续后果隔两次决定影响人物/办法：final18 J1战役模型未生成持续后果；完整三意图六维均达到3仍未满足（full_success门控停滞复现）。
- 原著角色换起点、后段按需补建、救援成功后存活、模板外组合完整真实场景。
- 设备自然结束一致性（final18 J1停在verdict-day开放，未到自然结局）；匹配设备/模型/范围的10基线+10新回合性能。

接手轮（2026-10-07下午）补充：codex额度中断后接手，final18门禁复核全绿（1005/1005），旅程5/20停止原因定谳为驱动器把过期提交安全拒绝误判硬失败（产品无缺陷，驱动器已改有界重试）；环境恢复后以final18身份新开camp-muxpraio完成J1 UI 23决定与J4 UI分支10决定。预算1045/1100。QA代理进程（18691）与设备LLM配置（P9GLM→10.0.2.2:18691）保持原状，ADBKeyBoard临时IME已卸载、系统IME已恢复，旅程JSONL/截图与DB快照存.tmp/phase9/reaccept-device/。仍未提交、推送或发布。

共享测试上限1100，当前已预留934，余166。历史起始313含估计，不称全历史精确账。新派发持久预留，未知不自动重放，每任务生成加修复最多两物理请求。误启动父目录导入的2个sent未知请求已停止并单列，未重放。正确invalid只证明安全门有效。

未卸载、清数据或覆盖设备SQLite；旧库/分支保留。临时代理及字体/分辨率在设备复验结束后恢复并记录。未提交、推送或发布。独立玩家体验未验。
