# 交接文档 HANDOVER

写给接手这个项目的人。`README.md` 讲「这个应用怎么用、怎么构建」，`ROADMAP.md` 讲「做过什么决策、接下来想做什么」，本文讲「**你接手后第一周该干什么、坑在哪里**」。三者配合阅读。

## 一、这是个什么项目

面向学生的单文件网页应用（PWA）：课表、日程、四象限待办、日历、专注计时（番茄钟）、记账、成绩、目标/关键结果、日记与心情、统计复盘、抽卡收集、每日一句等。

**核心交付物只有一个 `index.html`**（约 2MB，CSS/JS/语料全部内联）。双击即用、可直接转发；配合 `manifest.webmanifest` + `sw.js` + 图标可装到桌面并离线使用。开发期源码在 `src/` 和 `assets/`，用 `build.py` 打包回单文件。

## 二、当前状态快照（2026-10-21 交接时）

| 项 | 状态 |
|---|---|
| 最后提交 | 工作区含未提交改动：**商城 + 侧栏折叠 + 合成玉/应用图标**（详见 ROADMAP 末节）；上一提交 `e5e8386` |
| 单元测试 | `node tests/run.mjs` **597 条全过**（Palette / CourseException 直读源文件） |
| UI 回归 | 28 个 `verify_*.mjs` 全部通过（需 Playwright；多数用 `URL` 环境变量指定地址，部分脚本自带/占位端口） |
| 样式等价 | `eq_check.mjs` 12 视图 1714 项计算样式 0 差异 |
| 窄屏 | 390px 宽度无横向溢出 |
| 远程 | 已同步到 `github.com/Faust275/course-planner`（2026-10-21） |

## 三、第一小时上手路径

1. `git log --oneline` 过一遍提交历史——每个提交是一个完整功能，信息即变更说明。
2. 双击打开 `index.html` 把玩一遍，对照 `README.md` 的功能清单。
3. 读 `src/index.template.html`（只有几十行）：它是整个应用的**装载顺序清单**，所有 JS 的依赖关系都体现在 `<script>` 的先后上。
4. 跑一次测试确认环境 OK：

```bash
cd course-planner-web
python3 build.py                # 构建（不联网，无需装依赖）
node tests/run.mjs              # 597 条纯函数单测
python3 -m http.server 8137 &   # UI 回归需要 http 服务
URL=http://localhost:8137/index.html node verify_build.mjs
```

UI 回归需要 Playwright：`npm i playwright && npx playwright install chromium`。
所有 `verify_*.mjs` 用 `URL` 环境变量指定地址，不写死端口。

## 四、架构导览（十分钟版）

```
用户操作 → views/*.js（页面） → Store（数据层） → IndexedDB（localStorage 兜底） → emit 通知视图重绘
```

- **`assets/js/store.js`** —— 唯一的数据模型与持久化层。所有页面都通过它读写，不直接碰 localStorage/IndexedDB。含版本迁移、自动备份、同步码导出。改数据结构先改这里，并写迁移逻辑。
- **`assets/js/stats-calc.js`** —— 统计与区间计算的纯函数层：区间展开/合并、`rangeDates`/`compareRange`、单日 5 段汇总（`sumDaySegments`）、区间汇总（`rangeSummary`）、积分/账本/课程聚合。日期工具按参数注入，可脱离 Store 单测；`store.js` 只留同名薄封装。
- **`assets/js/ui.js`** —— `el()` 元素工厂、`V.modal/confirm/segment/select` 弹窗组件、Toast。
- **`assets/js/router.js` / `app.js`** —— hash 深链接（`#/today`、`#/diary` 等）、启动 boot、SW 注册、安装提示。
- **`assets/js/views/*.js`** —— 每个页面一个文件（课表、今日、日历、待办、计划、目标、日记、记账、专注、设置……），互不 import。注意：**日程 / 象限 / 统计已由独立视图改为宿主页分页**（`calendar.js` 承载 `AgendaPane`，`tasks.js` 承载 `QuadrantPane` / `StatsPane`），地址是 `#/calendar/agenda`、`#/tasks/quadrant`、`#/tasks/stats`。
- **`tests/run.mjs`** —— 纯函数单测，不依赖浏览器；`verify_*.mjs` 是 Playwright 端到端回归。
- **一次性脚本**：`namespace_cp.py`（批量加类名前缀）、`sync_from_index.py`（从历史单文件反抽模块）已在迁移期发挥作用，新功能用不到。

**没有打包器、没有框架、没有 npm 依赖（除测试用的 playwright）。** 每个模块是全局 IIFE，构建就是把文件按模板顺序内联进 HTML。

## 五、必知的约定与坑（血泪史）

1. **`cp-` 类名前缀**：`el()` 的 `class` 参数会按空格逐 token 自动补 `cp-` 前缀，所以 **CSS 里必须写 `cp-xxx`，JS 里写裸名 `xxx`**。这条坑最隐蔽——类名对不上不报错，只是样式静默失效（热力格曾整片透明）。直接 `className =` 或 `classList.add()` 不走 `el()`、不会补前缀，少量历史代码（桌宠）依赖此行为，新代码不要学。
2. **新页面**放 `assets/js/views/`，并在 `src/index.template.html` 按依赖顺序加 `<script>`；通用能力放 `assets/js/`。
3. **改完源码必须跑 `build.py`**，`index.html` 是产物，不手改。
4. **番茄与活动记录是同一份专注的两张存根**：分钟数只从 `activities` 算，`sessions` 只用来数番茄个数，两边都加就是重复计算（已踩过）。
5. **时间块补录只动 `from:'block'` 那层**：睡眠/用餐/课程/手动活动只读，防止冲掉用户认真填过的数据。
6. **数据口径用自然日历**：统计跨午夜睡眠归属、目标周期冻结等口径都有单测钉死，改动先跑 `node tests/run.mjs`。
7. **弹窗子项过滤**：`ui.js` 的 `arrayify` 会滤掉 `null/false`，往弹窗塞条件渲染的节点时依赖它，别绕过。
8. **设置页是三级状态**：`CAT`（当前分类）+ `SUB`（当前具体页），两者都在 `settings.js` 的 IIFE 里。外部跳转只走 `SettingsView.go(key)` 或 `App.go('settings', {tab:key})`，不要直接改 `SUB`——`onEnter` 会先清空状态，直接改会被覆盖。新增条目时必须给 `SUBS[]` 补 `group`，否则分类页筛不出来。

## 六、日常开发循环

```
改 assets/ 或 src/ → python3 build.py → node tests/run.mjs
→ 起服务跑相关 verify_*.mjs → git commit（信息写清功能与理由）
```

提交粒度：一个提交 = 一个完整功能 + 对应测试。历史上每个 `verify_*.mjs` 都是随功能同提交加入的，请保持这个习惯。

## 七、接下来做什么

看 `ROADMAP.md`。当前明确的候选（按上一轮讨论结论）：

- **计划休息令牌**：已讨论、未决策，先想清楚再做；
- 竞品调研产出过两批候选清单，其中「待办↔时间投入」「年度视角」「时间块补录」**均已实施**，剩余候选在 ROADMAP 的「竞品横向对比」章节。

设计原则一句话：**这个应用宁可少做，也不做会误导用户的数据**（不给 KR 加权重、不惩罚未达成目标、分钟数不重复算——理由都写在 README 和 ROADMAP 里，动手前先读）。
