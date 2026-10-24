# 接手文档 · 课程表规划 PWA（course-planner）

> 适用对象：接手本项目后续开发的工程师。
> 最后更新：2025-10（main 分支，已含拖动增强、提醒、复盘偏差、App.bus 收敛、工具链建设等）。

---

## 0. 一句话定位

单文件课程规划 PWA：待办 / 课表 / 番茄钟 / 日记 / 复盘 / 养成树。
**源码是人读的 `src/` + `assets/`，构建产物是内联打包的 `index.html`（约 2 MB，禁止手改）。**

---

## 1. 目录与构建

```
course-planner-deploy/
├── src/index.template.html     # 模板：<script src=...> 会被 build.py 内联
├── assets/
│   ├── css/style.css           # 全部样式（含 .cp- 前缀约定）
│   └── js/
│       ├── app.js              # App 对象与 App.bus（跨视图消息总线）
│       ├── store.js            # 全局状态/持久化/备份/迁移（最大的文件）
│       ├── ui.js               # el()/cn()/toast/moveMenu/escapeHTML 等基础件
│       ├── drag-gesture.js     # 通用拖动引擎 DragGesture
│       ├── remind.js           # 页面内提醒（上课、番茄钟、待办到期）
│       ├── quotes-data.js      # 语料包（惰性加载）
│       ├── views/              # 各视图（agenda/calendar/tasks/pomodoro/stats…）
│       └── …（约 30 个模块）
├── build.py                    # 打包器：把模板引用的本地 CSS/JS 内联成 index.html
├── tests/run.mjs               # 单测（~845 用例），node 直接跑
├── tests/run-e2e.mjs           # e2e 聚合运行器（跑所有 verify_*.mjs）
├── test-utils.mjs              # e2e 共用的静态服务器 + 错误收集
├── verify_*.mjs                # 各功能点的 Playwright e2e 脚本
├── package.json                # 统一脚本入口
├── eslint.config.mjs           # ESLint flat config（已 0 错误）
└── .github/workflows/ci.yml    # push/PR 跑 build + 单测 + lint
```

**构建 / 测试命令**（见 `package.json`）：

```bash
npm install                 # 装 eslint / playwright（首次）
npm run build               # python3 build.py → 生成 index.html
npm test                    # 单测 845 条
npm run lint                # ESLint 全项目
npm run e2e                 # 跑全部 verify_*.mjs（需 Playwright 的 Chromium）
npm run e2e <关键词>         # 按文件名过滤，如 npm run e2e drag
npm run ci                  # build + test + lint 三连
```

> ⚠️ **绝对不要手改 `index.html`**：它是 `build.py` 的产物（内联后约 2 MB）。改代码请改 `src/` 或 `assets/`，再 `npm run build`。单测/构建都只认源码。

---

## 2. 关键架构约定（务必先看，否则会踩坑）

### 2.1 `el()` 自动给 class 加 `cp-` 前缀
`ui.js` 的 `el(tag, attrs)` 会把 `class` / `className` 里**每个 token** 自动加 `cp-` 前缀。
例：`.active` → `.cp-active`，`.on` → `.cp-on`，`.week-label` → `.cp-week-label`，`tray` → `.cp-tray`。
- ✅ 写样式（style.css）和 JS 选择器时**必须带 `cp-`**：`document.querySelector('.cp-task-bulkbar')`。
- ❌ 漏写前缀会导致「样式不生效 / 选择器匹配不到」——这是本项目最高频的隐性 bug。

### 2.2 渲染生命周期
- `Store` 持有全局状态，`Store.subscribe(fn)` 注册渲染回调；任意 `Store.emit()` 会**全量重渲染当前视图**。
- **拖动期间只改 DOM，不要 emit**；落点确定后才提交一次 `Store`（避免拖动中 DOM 重排 + 重渲染打架）。

### 2.3 拖动引擎 `DragGesture`（assets/js/drag-gesture.js）
- `setPointerCapture` + 6px 阈值 + 幽灵块 + `touch-action:none`。
- 拖动监听挂在 **document 捕获阶段**（不是元素上），否则 Chrome 在 DOM 重排后会触发 `lostpointercapture` 导致**半路断拖**。
- 提供：边缘自动滚动（`.cp-view-wrap` 最近可滚动祖先，64px 阈值）、长按 550ms / 右键 / Shift+F10 唤起「移动到…」菜单、`navigator.vibrate(8)`（受 `settings.haptics` 控制）、跨视图接力高亮。

### 2.4 跨视图消息总线 `App.bus`
旧代码用散落的 `window.__cpRelayTaskId / __cpRelayTaskAt`，现已收敛为：

```js
App.bus.setRelay(id)              // tasks 视图拖动到日历时设置接力 id
App.bus.peekRelay()               // calendar 视图消费：{id, at}，8s 内有效
App.bus.clearRelay()
```

> 仅此一组跨视图全局变量被收敛。`window.__cpLoadDaily` 是 **quotes 惰性加载入口**（启动时不加载语料包，进入「今日」时才调用），**不是**跨视图消息，请勿误改。

### 2.5 持久化与备份（assets/js/store.js）
- 主状态 IndexedDB `KEY='course-planner:v1'`，回退 localStorage。
- 大图（背景图 / 宠物图）从主状态剥离，单独存 `cp-blob-background` / `cp-blob-pet`，主状态只留引用——**主状态约 4 KB**，IndexedDB 不再被大图撑爆。
- 备份 `cp-backup-*`：手动/覆盖前 5 份（BK_MAX）+ 每日自动 2 份（BK_DAILY_MAX），总量软上限 `BK_TOTAL_BYTES=4MB`（超量丢最旧）。
- 启动时 `migrateSchema()` 幂等迁移（当前 `SCHEMA_VERSION=3`）。

---

## 3. 已落地能力清单

### 3.1 拖动体验（多轮累积）
- 计划/目标排序、日历事件改期、待办手动排序、专注拖入、待办↔日历桥接。
- 拖动撤销 toast、震动反馈、无障碍「移动到…」菜单（长按/右键/Shift+F10）。
- 跨视图接力（拖到 `[data-view]` 导航 → 写 `App.bus` → 切视图高亮 500ms）、拖到月份导航自动翻月、首次拖动引导气泡。

### 3.2 专注 / 待办
- 专注队列（托盘 chips + 队列区，T.queue 持久化，「结算后开始下一个」）。
- 待办多选整组拖动 + 批量删除（整份快照撤销 + 单条删除撤销）。

### 3.3 数据 / 性能
- `save()` 250ms 去抖合并（5 次 emit → 1 次写）；`pagehide`/`visibilitychange` flush。
- 大图外置（见 2.5）。
- 语料 `quotes-data.js` 惰性加载（`#/schedule` 首屏 `window.Daily` 为 undefined，进入「今日」才加载）。
- 每日自动快照（`maybeDailyBackup`，按来源分层）。

### 3.4 提醒与复盘
- **待办到期本地提醒**（`remind.js#checkTaskDue`）：复用 `Store.overdueTasks()/todayTasks()`；只提醒逾期+今日到期、每天每条一次、一次最多 3 条、可开关。沿用文件头既定「页面内零权限」策略，**不碰 Notification**（file:// 非安全上下文会静默失败）。
- **复盘·计划 vs 实际偏差**（`stats.js` 卡片）：基于 `Store.planProgress()` 的 `target/value`，按缺口绝对值从大到小排序，显示 计划/实际/±差（达成%）与合计。

### 3.5 工具链
- `package.json` 统一脚本；ESLint flat config **0 错误**；GitHub Actions CI（lint+单测+build 门禁 + Playwright e2e job）。
- `test-utils.mjs` 抽出 e2e 共用服务器，12 个近期 `verify_*.mjs` 已迁移，`tests/run-e2e.mjs` 聚合运行。

### 3.6 顺手修掉的两个真实 bug（接 ESLint 时发现）
- `store.js`：IDB→localStorage 回退分支调用了**作用域外的 `resolve()`**（回退永不可能成功）→ 已修正。
- `store.js`：`gpaConfig` 把 `Store.defaultGpaRules()` 误写成裸 `defaultGpaRules()` → 已修正。

---

## 4. 核查结论：哪些「看似要做」其实已存在
开工前已核对，**不要重复造轮子**（这几条都曾出现在待办清单里，实际早就有）：
- **课表 ICS 导入**：已实现（`schedule.js#parseIcsCourseTable`，上传框 `accept` 已含 `.ics/.html/.csv`）。
- **打卡热力图**：已实现（`stats.js#heatCard` 周热力条 + `heatLevel` 0–4 分级）。
- **ICS 导出的时区与重复事件**：已实现（`remind.js` 里有 `VTIMEZONE` + `RRULE`，换教室/调课另生成单次事件——因为 RRULE 带不了单次变更）。别去 `schedule-export.js` 找，那个是**课表海报 PNG** 导出。
- **移动端 PWA 基础**：已就绪（模板有 `viewport-fit=cover`、`theme-color`、`mobile-web-app-capable`，CSS 多处已用 `env(safe-area-inset-*)`）。

## 3.6 离线二维码同步（后加的大模块）
- `assets/js/qr-sync.js`（1577 行）：纯原生 QR 编码器（ISO/IEC 18004，V1–20，EC-L）、课表骨架单码、Gzip/Base64 动态切片轮播码、扫码解码，另含 WebDAV 云同步。
- 全局是 **`QrSync`**（注意大小写，不是 `QRSync`），入口在 设置 → 数据 →「手机 ⇄ 电脑同步」四个按钮。
- 已接入 `src/index.template.html`，有对应单测（含「QR 矩阵无损解码还原 CPQR1」）。

---

## 5. 已知坑（踩过的雷，照着避）
1. `clearDropHints is not defined` → 已提升为 drag-gesture.js 模块级函数。
2. 新手引导 `.cp-ob-mask`、成就弹窗 `.cp-modal-wrap` 会拦截指针/遮挡 → 自动化测试里需临时移除，**不要按 Esc**（引导监听会跳默认视图）。
3. 选择器漏 `cp-` 前缀（`.goal-active-list`、`.filter-tab`、`.week-label`、`.active`、`.on`）→ 逐个修正。
4. 拖动「半路断掉」→ document 捕获阶段监听（见 2.3）。
5. click 拦截器滞留吞掉「撤销」点击 → 120ms 自动摘除。
6. `modal()` 的 Esc 监听泄漏 → `close()` 内统一移除。
7. **单测沙箱只摘取部分函数**：常量/`SCHEMA_VERSION`/`addEventListener` 不在作用域 → `defaultState()` 里 `version` 用**字面量 3**，`save()` 里事件监听加 `typeof window.addEventListener === 'function'` 守卫。改 store.js 单测相关代码时务必保留这些守卫。
8. **惰性加载验证失真**：`App.goto(hash)` 只改 hash 不重建文档 → 验证语料惰性加载时要用 `?fresh=1#/schedule` 整页重载，先 `Store.updateSettings({guided:true})` + `flushSave()` 再刷新。
9. 截图类名不匹配：内部 class 统一 `cp-` 前缀，e2e 选择器要写成 `.cp-pomo-tray` 等。

---

## 6. 待办 / 下一步建议（未做，按价值排序）
1. **真·系统级通知**：目前提醒是页面内 toast（`remind.js` 刻意不用 Notification，因为 `file://` 非安全上下文）。装成 App 后可以走 Notification / 通知插件。
2. **安卓硬件返回键**：WebView 里默认直接退出，需要按当前是否有弹窗/二级页做拦截，否则体验很差。
3. **横屏 / 平板布局**：窄屏（390px）已验证无横向溢出，但横屏与平板尺寸下的课表矩阵未专门适配。
4. 复盘可加：计划 vs 实际偏差的**趋势图**、打卡热力图与计划的联动。
5. 代码层面：仍有少量 `window.__cp*` 之外的跨文件全局；可继续收敛（风险低，优先级靠后）。

> 注：早期清单里的「移动端 / 安卓壳」已拆开处理——PWA/离线/安装基础已具备，剩下就是打包与返回键（见第 8 节）。

---

## 8. 安卓打包（Capacitor）
产物是一个把 `index.html` 装进 WebView 的 APK。**先构建再打包**：

```bash
npm run build                 # 生成根目录 index.html（单文件，已内联全部 CSS/JS）
npm run e2e                   # 建议打包前跑一遍，56 条应全绿
npx cap sync android          # 把 webDir(dist) 同步进 android/app/src/main/assets/public
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

要点：
- `capacitor.config.json` 的 `webDir` 指向 **`dist/`**（由 `build.py` 顺带产出，只含 index.html + manifest + sw.js + 图标，避免把 node_modules 打进去）。
- 应用 id / 名称见 `capacitor.config.json`；改图标走 `npx capacitor-assets generate`（或手放 `android/app/src/main/res/mipmap-*`）。
- 签名发布包需要自己生成 keystore 并在 `android/app/build.gradle` 配 `signingConfigs`；debug 包可直接装。
- 调试：`adb install -r app-debug.apk`；看 WebView 日志用 `chrome://inspect`。

---

## 7. 给接手者的 5 条建议
- 改完任何 JS → 必跑 `npm run lint`（ESLint 能抓出作用域/未定义类真实 bug）。
- 改完视图 → 跑一遍对应 `verify_*.mjs`，再 `npm test` 全量回归。
- 涉及拖动/接力 → 重点看 2.2 / 2.3 / 2.4，别在拖动中 emit。
- 别手改 `index.html`；产物很大但它是构建输出。
- 新增视图或功能，记得在 `verify_*.mjs` 补一条 e2e，并确认 CI 仍绿。
