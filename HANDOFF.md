# 接手文档 · 课程表规划 PWA（course-planner）

> 最后更新：**2026-10-24**（已含安卓打包、健康联动、我的活动界面）
> 读者：接手后续开发的工程师 / 新对话里的 AI 助手。
> 想最快上手，先看同目录的 **`START-HERE.md`**，本文是完整手册。

---

## 0. 30 秒速览

| 项 | 当前状态 |
|---|---|
| 交付形态 | **单文件 `index.html`**（约 2266 KB，CSS/JS/语料全内联，禁止手改） |
| 源码 | `src/index.template.html` + `assets/css` + `assets/js`（30+ 模块 / 20 个视图） |
| 构建 | `npm run build`（`python3 build.py`，顺带产出 `dist/`） |
| 单测 | `npm test` → **891 条全过**（纯函数，node 直接跑） |
| 样式/e2e | `npm run e2e` → **75 个 `verify_*.mjs` 全过**（Playwright，需 Chromium） |
| Lint | `npm run lint` → **0 错误**（ESLint flat config） |
| CI | `.github/workflows/ci.yml`：lint + 单测 + build + e2e 双 job |
| 安卓 | Capacitor 8，minSdk **26**，debug APK 约 **8.45 MB** |
| 数据版本 | `SCHEMA_VERSION = 3`，IndexedDB `course-planner:v1`（回退 localStorage） |
| 远程 | GitHub `Faust275/course-planner`，Pages 已上线 `https://faust275.github.io/course-planner/` |

---

## 1. 目录与构建

```
course-planner-deploy/
├── START-HERE.md               # 一页纸入口（先看这个）
├── src/index.template.html     # 模板：<script src=...> 会被 build.py 内联
├── assets/
│   ├── css/style.css           # 全部样式（class 带 .cp- 前缀）
│   └── js/
│       ├── app.js              # App 对象、路由、导航、App.bus、安卓返回键
│       ├── store.js            # 全局状态 / 持久化 / 备份 / 迁移（最大文件）
│       ├── ui.js               # el()/cn()/toast/modal/moveMenu/图谱组件/icons
│       ├── drag-gesture.js     # 通用拖动引擎 DragGesture
│       ├── remind.js           # 页面内提醒（上课 / 番茄钟 / 待办到期）+ ICS 导出
│       ├── health-connect.js   # 健康联动 Web 桥（睡眠 + 活动量）
│       ├── qr-sync.js          # 离线二维码同步 + WebDAV（1577 行）
│       ├── quotes-data.js      # 语料包（惰性加载）
│       └── views/              # 20 个视图（today/schedule/quadrant/activity/...）
├── build.py                    # 打包器：内联模板引用的 CSS/JS → index.html + dist/
├── tests/run.mjs               # 单测（891 条）
├── tests/run-e2e.mjs           # e2e 聚合运行器（自动扫描 verify_*.mjs）
├── test-utils.mjs              # e2e 共用静态服务器（绑 127.0.0.1）
├── verify_*.mjs                # 75 个功能点 e2e
├── eslint.config.mjs           # flat config（已 0 错误）
└── android/                    # Capacitor 8 工程（含自写 Kotlin 插件）
```

```bash
npm install                 # 首次：eslint / playwright
npm run build               # 生成 index.html + dist/
npm test                    # 891 条单测
npm run lint                # ESLint 全项目
npm run e2e                 # 75 个 e2e（自动起共享服务器）
npm run e2e activity        # 按文件名过滤
npm run ci                  # build + test + lint 三连
```

> ⚠️ **绝对不要手改 `index.html`**。它是构建产物；e2e 加载的也是它——**改完源码必须先 `npm run build`**，否则测试跑的仍是旧产物（这是最容易浪费时间的一个坑）。

---

## 2. 关键架构约定（先看，否则必踩坑）

### 2.1 `el()` 自动给 class 加 `cp-` 前缀
`ui.js` 的 `el(tag, attrs)` 会把 `class` 里**每个 token** 自动加 `cp-` 前缀。
`.card` → `.cp-card`，`.on` → `.cp-on`，`.more` → `.cp-more`。
- 写 CSS 和 JS 选择器时**必须带 `cp-`**。
- 这是全项目最高频的隐性 bug，e2e 里踩过 5 次以上。

### 2.2 渲染生命周期
- `Store.subscribe(fn)` 注册渲染回调，任意 `Store.emit()` 会**全量重渲染当前视图**。
- **拖动期间只改 DOM，不要 emit**；落点确定后才提交一次 Store。

### 2.3 拖动引擎 `DragGesture`
- `setPointerCapture` + 6px 阈值 + 幽灵块 + `touch-action:none`。
- 监听挂在 **document 捕获阶段**（挂元素上会在 DOM 重排后 `lostpointercapture` 半路断拖）。
- 含边缘自动滚动、长按 550ms / 右键 / Shift+F10 唤起「移动到…」、震动反馈、跨视图接力。

### 2.4 跨视图消息总线 `App.bus`
```js
App.bus.setRelay(id)     // tasks 拖到日历时设置
App.bus.peekRelay()      // calendar 消费：{ id, at }，8s 有效
App.bus.clearRelay(at)   // 渲染收尾清理（带 at 防止误清新接力）
```
> `window.__cpLoadDaily` 是 **quotes 惰性加载入口**，不是跨视图消息，别误改。

### 2.5 持久化与备份
- 主状态 IndexedDB `KEY='course-planner:v1'`，失败回退 localStorage。
- 大图（背景/宠物）剥离到 `cp-blob-background` / `cp-blob-pet`，主状态只留引用（约 4 KB）。
- 备份 `cp-backup-*`：手动 5 份 + 每日 2 份，总量软上限 `BK_TOTAL_BYTES=4MB`。
- **导出的备份默认剥离 API 密钥**（语音/OCR），设置页可勾选带上。
- 启动时 `migrateSchema()` 幂等迁移；新增状态字段记得在 `Store.ensure()` 里补默认值（老存档没有该字段，否则 `undefined.filter` 直接崩）。

---

## 3. 已落地能力

### 3.1 拖动体验
计划/目标排序、日历改期、待办手动排序、专注拖入、待办↔日历桥接；撤销 toast、震动、无障碍「移动到…」、跨视图接力高亮、拖到月份导航自动翻月、首次拖动引导气泡。

### 3.2 专注 / 待办
专注队列（托盘 chips + 队列区，结算后自动开始下一个）；待办多选整组拖动 + 批量删除（整份快照撤销）。

### 3.3 数据 / 性能
`save()` 250ms 去抖 + `pagehide`/`visibilitychange` flush；大图外置；语料惰性加载；每日自动快照。

### 3.4 提醒与复盘
- 待办到期提醒（`remind.js#checkTaskDue`）：只提醒逾期+今日到期，每天每条一次、最多 3 条、可开关；**刻意不碰 Notification**（`file://` 非安全上下文）。
- 复盘「计划 vs 实际偏差」卡片（`stats.js`）：按缺口绝对值排序，显示 计划/实际/±差与合计。

### 3.5 离线同步
- `qr-sync.js`：纯原生 QR 编码器（V1–20，EC-L）、课表骨架单码、Gzip/Base64 切片轮播、扫码解码，另含 WebDAV。
- 全局名是 **`QrSync`**（不是 `QRSync`），入口在 设置 → 数据 →「手机 ⇄ 电脑同步」。

### 3.6 安卓
- Capacitor 8 + `dist/` + `androidScheme: https`（保证 IndexedDB 等安全上下文 API 可用）。
- 返回键三级递进：有弹窗先关 → 否则后退视图 → 主视图才退出（`app.js#setupAndroidBackButton`）。

---

## 4. 别重复造轮子：已存在的能力

这几条都曾出现在待办清单里，实际早就有：

- **课表 ICS 导入**：`schedule.js#parseIcsCourseTable`（accept 已含 `.ics/.html/.csv`）。
- **打卡热力图**：`stats.js#heatCard`（周热力条 + 0–4 分级）。
- **ICS 导出的时区与重复事件**：在 `remind.js`（`VTIMEZONE` + `RRULE`，换教室/调课另生成单次事件）。**不是** `schedule-export.js`，那个是课表海报 PNG。
- **移动端 PWA 基础**：`viewport-fit=cover`、`theme-color`、`apple-mobile-web-app-capable`、`env(safe-area-inset-*)` 均已就绪。
- **睡眠截图 OCR 导入**：`sleep-model.js#parseSleepShot` + `ocr.js`，象限页「从截图导入」。

---

## 5. 已知坑（踩过的雷）

1. **e2e 跑的是构建产物**：改源码不 build → 测试验证的是旧代码。
2. **选择器漏 `cp-` 前缀**：`.card`/`.active`/`.on`/`.more` 都必须带前缀。
3. **单测沙箱只摘取部分函数**：`SCHEMA_VERSION`、`addEventListener` 不在作用域 → `defaultState()` 里 `version` 用字面量 3，`save()` 里加 `typeof window.addEventListener === 'function'` 守卫。改 store.js 时务必保留。
4. **新手引导遮罩**会拦指针（`.cp-ob-mask`）；测试里点「跳过」而不是按 Esc（Esc 会跳默认视图）。
5. **`modal()` 的 Esc 监听**必须在 `close()` 里统一移除，否则越积越多。
6. **拖动半路断掉** → document 捕获阶段监听。
7. **安卓构建**：`./gradlew` 会慢速下载分发包，用系统 `/opt/gradle-8.14.3/bin/gradle` 跳过；Capacitor 8 需要 **JDK 21**。
8. **Health Connect 1.1.0 的 API 变过**：`AggregationType` 已移除，新聚合工厂 `AggregateMetric` 是 `internal`（`javap` 验证）。只能 `readRecords` 逐条读 + 自己按天累加 + `pageToken` 翻页。别照 1.0.x 的文档写。
9. **`Plugin` 基类方法名冲突**：写 Capacitor 插件时 `checkPermissions` / `requestPermissions` 与基类重名，要换名（本项目用 `requestHealthPermissions`）。
10. **sw.js 的 `CACHE` 版本号**：`verify_gesture_sw.mjs` 曾写死 `cp-app-v1` 做字符串替换，版本号一升测试就空转。已改为正则替换 `const CACHE = '...'`，别再写死。

---

## 6. 安卓打包（Capacitor）

```bash
npm run build                 # 1. 生成 index.html + dist/
npm run e2e                   # 2. 建议全绿再打
npx cap sync android          # 3. dist/ → android/app/src/main/assets/public
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export GRADLE_USER_HOME=/root/.gradle
/opt/gradle-8.14.3/bin/gradle assembleDebug --no-daemon
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

- `capacitor.config.json`：`appId=com.faust275.courseplanner`，`webDir=dist`，`androidScheme=https`。
- 应用显示名在 `android/app/src/main/res/values/strings.xml`。
- 换图标：`npx capacitor-assets generate` 或替换 `mipmap-*`。
- 签名发布包：自建 keystore + `android/app/build.gradle` 的 `signingConfigs`；debug 包可直接 `adb install`。
- 调试 WebView：`chrome://inspect`。

### 6.1 健康联动（Health Connect）

- **不是手环直连**，走系统级 Health Connect。前提：手机装了 Health Connect，且「小米运动健康 / Zepp Life」开启了「同步到 Health Connect」。
- 原生插件 `android/.../plugin/HealthConnectPlugin.kt`（**Kotlin**，因为 connect-client 1.1.0 的 API 是协程式）：
  - `isAvailable` / `requestHealthPermissions`（一次申请睡眠+步数+卡路里+距离四项，只弹一次）/ `readSleep(days)` / `readMetrics(days)`
- Web 桥 `assets/js/health-connect.js`：`available/request/read/readMetrics/autoSync/getCached/getCachedMetrics/getMetricForDate`，缓存 6 小时。
- 自动同步三档，受 `Store.settings.healthAutoSync`（默认开）控制：
  1. 启动静默拉一次；
  2. 每 3 小时（仅页面可见）+ 切回前台补一次，新数据自动落盘（`persistHealthSleep` / `persistHealthMetrics`）；
  3. 打开「记录睡眠」弹窗自动回填（仅新建，不覆盖）。
- 未授权/未安装时全程静默跳过，**绝不弹权限框**；手动按钮才会触发系统授权。
- 限制：HC 的睡眠只细分「清醒/离床」，深睡/浅睡/REM 拿不到，所以联动只回填 入睡/醒来/时长/清醒分钟。

### 6.2 「我的活动」界面

- 入口：底部导航 **「活动」**（`assets/js/views/activity.js`，view id `activity`，order 16）；象限页「今日活动」卡片右上角「详情 →」直跳。
- 内容：今日步数 + 目标进度（`Store.settings.stepGoal`，默认 8000）、三指标（步数/千卡/公里）、近 7 天柱状图、近 7 天汇总（含连续达标天数）、近 14 天明细（点行可手动补录）。
- 存储：`Store.state.metrics`，`addMetric`（单条）/ `addMetrics`（批量，只 emit 一次）。**手动记录优先**：`hc` 不覆盖 `source='manual'`。
- e2e：`verify_activity_view.mjs`。

---

## 7. 待办 / 下一步（按价值排序）

1. **签名发布包**：keystore + release AAB，才能上架/正式分发（现在只有 debug）。
2. **系统级通知**：现提醒是页面内 toast。装成 App 后可走 Notification 通道。
3. **横屏 / 平板适配**：窄屏 390px 已验证无溢出，但横屏课表矩阵未专门适配。
4. **真·后台同步**：若要 App 完全退出后仍拉健康数据，需 `WorkManager` + `READ_HEALTH_DATA_IN_BACKGROUND` + 原生→Web 回写桥。**性价比低**：每次启动的 `autoSync` 已覆盖多数场景，且国产 ROM 后台保活不可靠。
5. 复盘加趋势图、热力图与计划联动。
6. 少量跨文件全局继续收敛（低优先级）。
7. **安全**：历史 token 曾出现在命令与日志中，建议到 GitHub 吊销重发。

---

## 8. 给接手者的 6 条建议

1. 改完 JS → `npm run lint`（能抓出未定义变量这类真 bug）。
2. 改完视图 → 先 `npm run build`，再跑对应 `verify_*.mjs`，最后 `npm test`。
3. 涉及拖动/接力 → 看 2.2 / 2.3 / 2.4，别在拖动中 emit。
4. 新增状态字段 → 同步改 `Store.ensure()` 的补齐逻辑。
5. 新增视图/功能 → 补一条 `verify_*.mjs`，确认 CI 仍绿。
6. 别手改 `index.html`、别手改 `dist/`。
