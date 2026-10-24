# 从这里开始（START HERE）

> 这个包是「课表 Course Planner」的完整交接包。**照着下面 3 步走，5 分钟内就能继续开发。**

---

## 1. 这个包是什么

一个面向学生的单文件网页应用（PWA），已有安卓壳。功能：课表、日程、四象限待办、日历、番茄钟、记账、成绩、目标、日记、统计复盘、抽卡收集、离线二维码同步、健康联动（睡眠/步数）。

- **真正的源码**在 `course-planner/assets/js/` + `src/index.template.html`
- **`index.html` 是构建产物**（约 2.0 MB，CSS/JS 全内联），**不要手改**
- **`quotes-data.js` 也是产物**（约 800KB 诗词语料），由 `build.py` 从 `assets/js/quotes-data.js` 复制而来。它和 `index.html` 必须放在**同一目录**——少了它诗词只在 24 篇迷你集里转（不报错，但明显变少）。想要「一个 html 走天下」就 `python3 build.py --inline`
- 安卓壳是 Capacitor 8，原生代码在 `android/`

```
这个包/
├── START-HERE.md              ← 你正在看的
├── HANDOFF.md                 ← 完整手册（架构、坑、安卓打包、待办）
├── 交接说明-20261024.md       ← 本轮交接：改了什么、现在什么状态、下一步做什么
├── course-planner/     ← 工程本体
└── README.md                  ← 产品说明（功能清单、用法）
```

---

## 2. 三条命令验证环境

```bash
cd course-planner
npm install          # 首次需要（eslint + playwright）
npm run ci           # build + 891 条单测 + ESLint
npm run e2e          # 75 个 Playwright 端到端（首次需 npx playwright install chromium）
```

期望结果：`891 通过 / 0 失败`、`e2e 81 通过 / 0 失败`、lint 无输出。

> 当前状态：**全部绿**。如果红了，先看 `HANDOFF.md` 第 5 节「已知坑」。

---

## 3. 改代码的正确姿势

```bash
# 改 assets/js/** 或 src/index.template.html 之后：
npm run build        # ← 必须！否则 e2e 跑的还是旧产物
npm test             # 单测
npx eslint .         # 或 npm run lint
npm run e2e activity # 跑相关 e2e（按文件名过滤）
```

打安卓包：

```bash
npm run build && npx cap sync android
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
/opt/gradle-8.14.3/bin/gradle assembleDebug --no-daemon   # 在 android/ 目录下执行
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 4. 现在做到哪了

| 模块 | 状态 |
|---|---|
| 核心功能（课表/待办/专注/记账/成绩/日记/统计） | ✅ 已上线 |
| PWA 离线 + Service Worker 更新提示 | ✅ |
| 安卓 APK（Capacitor 8，minSdk 26） | ✅ debug 包可装 |
| 健康联动：睡眠读取（Health Connect） | ✅ 手动导入 + 自动同步 + 3 小时定时 + 开关 |
| 「我的活动」界面：步数 / 活动消耗 / 距离 | ✅ 今日进度 + 7 天趋势 + 14 天明细 + 手动补录 |
| 签名 release AAB | ❌ 未做 |
| 系统级通知 | ❌ 未做（现在只有页面内 toast） |
| 横屏 / 平板适配 | ❌ 未做 |

完整清单与优先级见 `HANDOFF.md` 第 7 节。

---

## 5. 换新对话时，把这段整段粘过去

> 我在一个叫 `course-planner` 的项目上继续开发，它是个单文件 PWA（约 2100KB 的 index.html + 20 个视图），已有 Capacitor 8 的安卓壳。
>
> **工作目录**：`/workspace/course-planner`
> **先读**：`START-HERE.md`、`HANDOFF.md`（架构约定、已知坑、安卓打包都在里面）
>
> **三条铁律**：
> 1. 改代码只改 `assets/js/**` 或 `src/index.template.html`，**绝不手改 index.html**（它是 `python3 build.py` 的产物）；
> 2. 改完源码**必须 `npm run build`**，否则 e2e 验证的是旧产物；
> 3. `el()` 会自动给 class 加 `cp-` 前缀，写 CSS / 选择器时都要带（`.card` → `.cp-card`）。
>
> **验证命令**：`npm test`（891 条）→ `npm run lint`（0 错误）→ `npm run e2e`（81 个）。
> **安卓构建**：`export ANDROID_HOME=/opt/android-sdk && export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`，在 `android/` 下用 `/opt/gradle-8.14.3/bin/gradle assembleDebug --no-daemon`。
>
> 请先跑一遍 `npm run ci` 确认基线是绿的，再开始改。

---

## 6. 环境备忘（本机已就绪）

| 项 | 路径 / 值 |
|---|---|
| Android SDK | `/opt/android-sdk` |
| JDK 21（Capacitor 8 必需） | `/usr/lib/jvm/java-21-openjdk-amd64` |
| Gradle（跳过 wrapper 慢速下载） | `/opt/gradle-8.14.3/bin/gradle` |
| 应用 id | `com.faust275.courseplanner` |
| 数据键 | IndexedDB `course-planner:v1`（回退 localStorage） |

---

## 7. 一分钟看懂架构

```
src/index.template.html   ← <script src> 列表 = 依赖顺序，改这里加模块
      ↓ python3 build.py 内联
index.html (2.0MB)        ← 主产物，双击可用；e2e 加载的就是它
quotes-data.js (800KB)    ← 诗词语料，默认外置，首屏不加载（迷你集 15KB 顶上）
      ↓ npx cap sync android
android/app/src/main/assets/public/index.html  ← 打进 APK 的网页
```

- `Store` 是唯一状态源，`Store.emit()` → 当前视图全量重渲染。
- `UI.el()` 造 DOM，`UI.modal()/toast()` 是通用交互件。
- 视图都是 `{ id, name, icon, order, nav, mount, onEnter, render, actions }`，用 `VIEWS.push(view)` 注册。
