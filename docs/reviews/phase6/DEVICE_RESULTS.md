# Android 实际设备验证与阻断

记录 2026-10-03。云主机2 vCPU配额、8GiB cgroup内存，无`/dev/kvm`。安装JDK17/SDK36/NDK27/Gradle9.3.1以及模拟器system images后执行实际构建/安装；没有真机。

| 场景 | 实际结果 | 证据/限制 |
|---|---|---|
| 最终standalone Debug构建 | exit0，V0.6.0/60000，minSdk24/compileSdk36，含index.android.bundle | phase6-final-style-apk.log，102.02MiB，SHA256 25c6a35b2937c81e1a652ea4a68e3bc0ed393da054038b8d6b98db9b08b36892 |
| API36软件模拟器 | 启动失败，约15分钟后仍不稳定并退出 | 无KVM，不能作为Android16设备通过 |
| API30 TCG fallback | 启动完成，最终重启267.388秒 | guest1536MiB/2cores/480×800，SwiftShader；启动慢与性能数据均不能类比真机 |
| 旧Debug安装与早期首配/书库 | install-r Success，实际配置dummy-ui-only无付费凭据；首配/配置/书库曾可操作 | phase6-android-qa旧阶段私有树/截图，只代表当时版本 |
| 7.18MB授权小说实际SAF导入（旧包） | 读取进度到99%，source staging且全部分片保存；尚未完成chapter/chunk hash/active | 私有import-snapshot.sqlite与UI树；不能算导入成功。已据此实现65536CP有界读缓存和16条/1MiB原生hash批次 |
| 最终包升级安装 | `adb install -r` Success，dumpsys确认60000/0.6.0，保留userdata未清库 | final-style-install.log；启动初期第一次包服务尚不可用，服务就绪后重试成功 |
| 最终冷启动 | am start成功，MainActivity可观察，UI操作被系统无响应对话框阻挡 | 事件日志为system与com.android.systemui ANR（还有dialer启动broadcast ANR），非已取证的ShineWord应用异常；不能据此证明App无问题 |
| 恢复尝试 | 停止Gradle/回归负载、保留userdata、Wait、冷重启App、重启自己模拟器SystemUI，仍有系统ANR | 截图/事件日志/ui timeout在私有scratch；继续有界尝试，结果如变化追加，不伪造通过 |
| 开局/连续游玩/补建/暂停恢复/风格/存档最终设备闭环 | 未完成 | 已将合法真实构建世界归档准备并推入Download；系统阻挡尚未完成实际导入或UI步骤，不能把Node harness结果算设备通过 |

没有将真实付费Key复制进模拟器。模型内容小样在Linux production adapter harness执行，设备仅使用dummy端点；准备的世界包为真实GLM构建成果，通过正常归档校验导出，未伪造内容。上述世界归档、小说、原始DB、截图、APK不入库。

复测：在可用加速模拟器/真机安装同签名候选APK（install-r保留数据），通过正常SAF选择授权TXT验证batch hash及active source、开局、连续行动+两次补建/采用、锁屏/通知暂停/系统限制/双runner、三风格与用户编辑、save导出/导入以及待动作重启恢复。API30软件实例若恢复，仅补记实际完成流程；仍不能替代API24、Android15/16和中档真机矩阵。A01～A18限制保留。
