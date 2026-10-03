# 第六阶段持续建设状态

记录日期：2026-10-03（证据日志使用各自明确的时区）。唯一集成负责人 root。M0～M9 已接入生产路径；P6-0～P6-6 均有实现、审查、修复、验证和独立提交。

## 当前交付状态

- 仓库 `/workspace/ShineWord`，任务分支 `feat/phase6-progressive-build-and-writer-style`。基线方案提交 `51033973445825f01b730b7e62eec0a3352414e1` 已包含；未回退后续代码或破坏用户修改。
- 用户最新明确要求“commit和gitpush主分支吧”。已核对远端基线、祖先关系及两项实际 CI，使用 `force:false` 将 main 从5103397安全快进到生产源码提交 `37149b45d948422ac99ce3e6c097f933fb929fb9`。PR [#10](https://github.com/anjingdtl/ShineWord/pull/10) 自动显示 closed/merged，保留完整审查历史。没有 force push、reset、clean、tag 或 Release。
- main 源码 Core CI [37129047811](https://github.com/anjingdtl/ShineWord/actions/runs/37129047811) success，790/790、30663.543ms；Android CI [37129047814](https://github.com/anjingdtl/ShineWord/actions/runs/37129047814) success，移动严格类型通过，Gradle5m20s。最终证据仅改文档，按实际 workflow 路径规则只触发 Core；提交后核对其真实结果，不冒称文档 head 重跑了 Android。
- 本地最终门禁：verify:core 790/790 exit0，146327.166ms；独立 root/mobile typecheck、version、diff 全部0；完整 standalone Debug exit0，3m51s。最终 APK107011415bytes，SHA256 `15469a83d8e210b4333cbf9abf0fd9e92306f76903d0a8daf0762b82ae5cd272`，保留数据 install-r Success，真实重建 root bundle。
- 版本 V0.6.0/60000，SQLite schema31、save7；各域单所有者/端口装配，无第二事实库、账本、租约或产品中心服务器。兼容合同见 COMPATIBILITY.md，逐阶段证据见各 REVIEW 与 TEST_RESULTS.md。

## 完成的建设与修复

阶段提交：P6-0 `fdf4612`、P6-1 `a60093a`、P6-2 `6614585`、P6-3 `a71beb4`、P6-4 `16231fe`、P6-5 `f053c1b`、P6-6 `717fd68`。追加修复：键盘 `fc6c475`；来源范围身份/准备恢复 `4cdaace`；精确账本恢复/租约CAS/缓存/root bundle输入 `bb7065a`；逐事实审查/投影 `ee09cb4`；开局建议统一预算账本/跨API unknown `98fe882`；新草稿权威provenance/缓存恢复 `c867284`；有效拆批集合/规范化定义比较 `37149b4`。

独立只读复审确认最后修复未发现剩余阻断：既有 raw done 检查点、事实状态、prompt/version/hash、旧不可变成果保持；M5事务内来源/canon/review核验保留。新增真实 SQLite split/replan 测试保证 canceled父审计行不阻断已完成有效子单元；JSON键序不产生伪冲突，真正异定义仍进入审查。初轮夹具唯一约束失败、既有短TTL心跳在TCG争用下失败、中间主动停止的APK及修复复测记录全部保留。

## 真实资源和 Android 已取证范围

- 授权GBK长篇全量导入；同书UTF-8前部80k rawCP样本active，76178规范化CP、35章/74chunks；原生批1unit/8ranges、0..6400CP。没有使用历史Windows路径或未授权资源。
- host新本地项目合格成果52.046秒，provider热缓存、n=1；20事实与人物/地点/事件/行动/引用闭包门禁未降低。host两个后段已分别发布/采用，3成果/53事实；独立风格ready。不是稳定90秒、Android TTFP或同质量统计提速。
- 最终API30原生TXT旅程：QA6真实抽取39.881秒，真实引用不足先阻断；正常逐事实转待核实后0重复抽取/映射发布。新campaign两个真实回合完成；两个P2抽取期间保持历史与已提交状态。正式互补事实审查后第一后段QA15映射完成、用户暂停、空闲冷停、冷启动仍暂停、明确继续复用缓存发布；第一次采用binding1→2后短休到v3。
- 第二后段QA16映射完成后M5正确阻断错误explicit标记；源码修复并保留数据升级，正常冷启动M7从done缓存完成发布，0重复付费抽取/映射，旧两artifact和两mapping整行保持；第二次采用v3 binding2→3，v0/v1/v2、正文、冻结风格、角色历史保持；正常短休到v4。
- 开局建议QA17真实请求只入唯一M6账本，返回再重开0新HTTP；旧QA8历史未治理调用如实记录，不补造账本。总QA19attempt/18已知HTTP200/1已审查unknown，上限20；保存unknown/null usage和精确审批，不自动重发。
- 其后两个未来缓冲QA18/19抽取HTTP200但新canon冲突阻断；正常停止为stopped_user，租约释放、diagnostic与checkpoint保留，已有3成果/当前游玩不受影响。不能计这两段已发布或整部小说内容通过。
- 三风格、用户自定义、正常回退分叉、旧0binding save7导入冷恢复已取证；当前3artifact/v4 save7正常导出/导入创建独立camp-musi82oj，空闲冷DB integrity ok/FK0，5历史snapshot/4turns、2正文/2冻结行动风格、3artifact和两mapping整行保留，只重绑定独立branch身份；0新增模型调用。

## 收尾操作与未验范围

当前P6-6：最终3artifact存档冷核验和报告已完成。按用户新增要求，根目录progress.md记录进度并交接本地开发机；本次证据commit非force推送main后核对实际Core CI。Android生产源码未再变化，沿用已通过main源码CI。无在途后关闭私有QA转发并移除ADB reverse。生产源码门禁已通过，无需为仅文档变化重复付费模型构建或APK构建。

未验：稳定90秒冷/热独立样本，完整主线/停留/支线，设备多部追加（仅同一授权小说可转码分段，未执行原生追加闭环）、真实低额度并发1/4、供应商完整故障矩阵、sent强杀计费结局、中档真机/API24/Android15/16资源与后台限制、独立三题材人工标注/风格评分、同质量统计性能对照。后续两段未来内容冲突仍需按原文逐事实审查再明确继续。工程通过不能写成A01～A18全部验收通过，复测步骤见 FINAL_REPORT。

检查命令：`npm run verify:core`、`npm run typecheck`、`npm run typecheck --prefix mobile`、`npm run verify:version`、`git diff --check`、`npm run apk:debug --prefix mobile`。JDK17/SDK36/GRADLE_USER_HOME=/workspace/toolchains/gradle。原文、凭据、未脱敏请求、SQLite、截图、APK仅在私有scratch，不入仓库。

收尾清理：最终空闲冷核验后，私有QA转发已停止，ADB reverse18765已移除；19次计数与unknown证据、模拟器userdata保留，0在途请求。没有删除项目或清空用户数据。

## 本地接续轮状态（2026-10-03，本地开发机）

分支 `feat/phase6-local-remaining-acceptance`（基于 main@5c14633）。本地环境 Windows + emulator-5554（API37.1 WHPX），本地基线与云端交付一致（790/790）。

- 修复三笔并独立复审后提交：L1 预设脱离陷阱 `529497e`、L2 故事面板刷新 `f9d6a72`、L3 映射暂停丢弃已结算响应 `ccfe68e`（含两条回归测试，旧代码失败/新代码通过）。最终本地门禁 verify:core 792/792、root/mobile 严格类型、version、diff、独立 Debug 构建全部通过。
- 设备旅程（API37.1，正常 UI）：全量 GBK 导入→开局（冷抽取 60.6s）→两轮正式逐事实审查→8 真实回合（含检定失败）→支线/停留（0 新段）→两次补建/安全边界采用（3 artifacts）→风格三模式往返→存档导出/分叉/导入独立战役→追加第二部闭环（第 4 段发布）。
- 故障：合成 429 无重试风暴草稿保留；发送后断连→outcome_unknown 精确审批（证据核对后显式批准、同逻辑 ID 重试、unknown 行保留）。
- 90 秒开局：新增独立冷样本 B（UTF-8 前 80k 新项目，导入点击→可玩 74.5s，零人工干预）；连同样本 A 共 n=2 冷样本，均为单设备非统计。
- QA 转发器 35 attempt（33 HTTP200 + 合成 429 + 发送后断连），input 276,411 / output 43,372（cached 37,376）；与 App 唯一 M6 账本逐条一致。
- L4 代码级修复完成（2026-10-04）：根因确认为 CJK 实体键进入 canon id 违反段工件 TOKEN 字符集；`slug` 改为对历史算法输出整体转义（非 CJK 键 id 逐字节不变），新增 `normalizeNonconformingCanonIds()` 存量修复通道并在 watchdog 与 headless runner 双入口构建前调用。独立复审 approve-with-nits、应修项全部吸收；门禁 verify:core 796/796（+4 新回归）、root/mobile 类型/version/diff 全 0。设备端 part3 原始路径回归待做，完成前不宣称关闭。
- 未关闭：part3 恢复时一次 batchHash 1 字符漂移导致的映射重发（成因未定谳）；以及下条未验清单。
- 未验：真机/API24/Android15-16、锁屏、双 runner、构建中删除/切 API 设备路径、三题材人工评分、L4 根因。
