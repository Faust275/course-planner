# v1.4.1 修复说明（2026-10-30）

本版只做修复与加固，不加新功能。核心目标：**让「周一 7:45 会不会响」这件事从概率变成确定。**

## P0：提醒链路

### 1. Android 13+ 新装用户收不到任何提醒

- `NotifyPlugin.kt` 增加 `POST_NOTIFICATIONS` 权限注解与 `requestPermission` 实现，授权后自动补排一次闹钟。
- 补齐设置页一直在调用、但原生端从未实现的方法：`available` / `openSettings`（`requestPermission` 同时补齐）。
- `schedule()` 权限关闭时返回 `scheduled: 0, skipped: true`，`remind.js` 不再把它当成功；点「重排」会明确提示失败原因。
- 设置页「系统通知（App 内）」卡片改为：主按钮「申请通知权限」、状态实时显示、失败有明确指引。
- App 启动时若通知未授权，弹一次带「去开启」按钮的提示（每版一次，`settings.notifyHintVersion`）。

### 2. 重启 / 覆盖安装后提醒全部消失

- 新增 `BootReceiver`，接收 `BOOT_COMPLETED`、`MY_PACKAGE_REPLACED`、`QUICKBOOT_POWERON`。
- 排程清单缓存在 `SharedPreferences`，开机后自动重排，不再依赖用户打开 App。
- Manifest 增加 `RECEIVE_BOOT_COMPLETED` 权限与 receiver 声明。

### 3. 提醒窗口与上限

- 未来 7 天 → **14 天**，条数上限 60 → 300，原生 ID 区间 1000..1400。

### 4. 通知可点击

- `NotifyReceiver` 增加 `contentIntent`，点通知直接回到 App（之前点了没反应）。
- 通知渠道重要性改为 `IMPORTANCE_HIGH`，并开启震动。

## P1：正确性与数据安全

### 5. 法定假日「课表停课、今日页和提醒照常上课」

- 停课规则从视图层（`schedule.js`）下沉到数据层：`Store.coursesOnDate()` 统一过滤法定假日。
- `remind.js#todayLessons()` 同步跳过假日；调进来的单次课（moveIns）仍保留。
- 今日页在假日显示「今天是 XX · 放假，课表与提醒已自动停课」。
- 新增设置项「法定假日自动停课」（`settings.pauseOnHoliday`，默认开），学校自行补课时可关。
- 新增单测覆盖：假日 0 节、普通日 1 节、关闭开关后恢复、`holidayOf` 取名。

### 6. 本地数据损坏会被空数据静默覆盖

- 解析失败时先把原始字符串另存为 `cp-corrupt-<时间戳>`。
- `Store.loadIssue` 置位期间禁止任何落盘（`_saveNow` 直接返回），首页的签到/活跃度也不会冲掉现场。
- 启动后弹窗三选一：导出损坏副本 / 去恢复备份 / 用空数据继续（需二次确认）。

### 7. IDB 超时会退回更旧的 localStorage 快照

- 新增 `Persist.loadBoth()` 同时读 IDB 与 localStorage，按 `savedAt` 取更新的一份。
- 每次落盘写入 `state.savedAt`。

### 8. 备份配额裁剪可能删光所有备份

- 最新一份永远保留；单份超 4MB 只影响它自己，不再连坐。
- `bytes` 改用 UTF-8 字节数（`TextEncoder`），不再按字符数低估约 3 倍。

### 9. 签名私钥随工程分发

- `happy-course.keystore` 移出工程；`.gitignore` 增加 `*.keystore`、`android/keystore.properties`。
- `build.gradle` 不再有 `happyday` 明文密码；改为环境变量或 `android/keystore.properties`。
- 缺签名时 `assembleRelease` **直接失败并提示配置方法**（debug 仍用系统调试证书）。
- 新增 `android/keystore.properties.example`。

### 10. `allowBackup="true"` 与「数据只存本机」冲突

- 关闭 `allowBackup` 与 `fullBackupContent`，迁移统一走 App 内导出/导入。

### 11. 隐私文案与实现不一致

- 引导页、设置页的三处「不会上传到任何服务器」改为「默认只存本机；只有你主动开启同步 / 云端识别 / 语音识别时才发送到指定服务器」。
- 顺带修正「保存在 localStorage」的说法（主存是 IndexedDB）。

### 12. 桌面小组件跨午夜显示昨天的课

- 渲染前比对 `snap.today` 与 `LocalDate.now()`；过期时标题显示「打开 App 同步今日课程」，日期行显示「数据停在 X · 打开 App 同步」。

## P2：工程卫生

### 13. 启动失败永远停在「正在加载」

- `bootSafe()` 统一兜底；失败时把骨架屏替换为「启动失败 + 重试 + 导出诊断」，不再白屏无出路。

### 14. 缺 terser 时静默产出 2.9MB 包

- `build.py` 找不到 terser 时直接 `sys.exit`，要求先 `npm install` 或显式 `--no-minify`。

### 15. 原生插件与 JS 的契约零测试

- `tests/run.mjs` 新增静态契约测试：抽取 `@PluginMethod fun xxx` 与 JS 的 `Plugins.Notify.xxx(` / `natP.xxx(` 做集合比对。
- 同时加守卫：Manifest 必须有 BootReceiver / RECEIVE_BOOT_COMPLETED、allowBackup 必须是 false、工程内不得出现 keystore、build.gradle 不得出现明文密码。

### 16. 版本号统一

- `package.json` / `build.gradle` / `App.version` 统一到 **1.4.1**，`versionCode` 4 → 5（保证可覆盖升级）。

## 验证结果

| 项目 | 结果 |
|---|---|
| 单元测试 | **1209 通过 / 0 失败** |
| ESLint | 0 错误 |
| `assembleDebug` | BUILD SUCCESSFUL，APK 7.57 MB |
| `assembleRelease`（带签名） | BUILD SUCCESSFUL，APK 6.07 MB，证书指纹与原版一致 |
| `assembleRelease`（无签名） | 按预期失败并给出配置提示 |
| APK 元信息 | `versionCode=5` / `versionName=1.4.1` / targetSdk 36 |
| 运行时 | 浏览器实测首页与提醒设置页无控制台报错 |

> e2e（Playwright）在当前沙箱里无法启动浏览器进程（spawn EPERM），未执行；改动集中在原生层与数据层，前端交互已用真机同源浏览器手工走查。
