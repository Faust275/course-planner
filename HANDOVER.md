# 交接文档 HANDOVER

写给接手这个项目的人。`README.md` 讲「这个应用怎么用、怎么构建」，`ROADMAP.md` 讲「做过什么决策、接下来想做什么」，本文讲「**你接手后第一周该干什么、坑在哪里**」。三者配合阅读。

## 一、这是个什么项目

面向学生的单文件网页应用（PWA）：课表、日程、四象限待办、日历、专注计时（番茄钟）、记账、成绩、目标/关键结果、日记与心情、统计复盘、抽卡收集、每日一句等。

**核心交付物只有一个 `index.html`**（约 2MB，CSS/JS/语料全部内联）。双击即用、可直接转发；配合 `manifest.webmanifest` + `sw.js` + 图标可装到桌面并离线使用。开发期源码在 `src/` 和 `assets/`，用 `build.py` 打包回单文件。

## 二、当前状态快照（2026-10-23 更新）

| 项 | 状态 |
|---|---|
| 最后提交 | ① 窄屏隐藏周末时表格不再撑 640px 最小宽度，周一到周五按屏宽平分、一屏放下（`verify_tt_narrow.mjs` 13 项）；② 新增截图转待办（`views/task-shot.js` + `Ocr.recognizeCloudTasks`，本地/云端双通道，先候选清单再写入）；③ 顺带修 `TaskNLP` 把 `24:00` 夹成 `23:00` 的问题（现记 23:59）。单测 779→804 |
| 单元测试 | `node tests/run.mjs` **804 条全过**（含重复任务三档：动态摘要、锚点引擎、多选星期 + 月位置规则；TaskNLP 自然语言待办解析；TaskShot 截图切行/噪声过滤/逐行解析） |
| UI 回归 | 36 个 `verify_*.mjs` 全部通过（新增 `verify_repeat_custom.mjs` 覆盖第三档多选星期 / 月位置 / 月末；`verify_repeat_ui.mjs` 为第一档文案回归；需 Playwright，全部用 `URL` 环境变量指定地址）；`verify_theme.mjs`（23 项）覆盖机制皮肤与深色；`verify_timeplan.mjs` 已固定时钟消除时段 flaky |
| 样式等价 | `eq_check.mjs` 12 视图 1714 项计算样式 0 差异 |
| 窄屏 | 390px 宽度无横向溢出 |
| 远程 | **已推送至 GitHub `Faust275/course-planner` 的 `main`**，并经 GitHub Pages 上线 `https://faust275.github.io/course-planner/`；重复任务三档、周末展示开关、象限睡眠计时均已发布 |

## 三、第一小时上手路径

1. `git log --oneline` 过一遍提交历史——每个提交是一个完整功能，信息即变更说明。
2. 双击打开 `index.html` 把玩一遍，对照 `README.md` 的功能清单。
3. 读 `src/index.template.html`（只有几十行）：它是整个应用的**装载顺序清单**，所有 JS 的依赖关系都体现在 `<script>` 的先后上。
4. 跑一次测试确认环境 OK：

```bash
cd course-planner-web
python3 build.py                # 构建（不联网，无需装依赖）
node tests/run.mjs              # 779 条纯函数单测
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
- **`assets/js/save-file.js`** —— 统一保存通道 `window.SaveFile.save(name, content, opts)`：能力探测 `showSaveFilePicker → navigator.share → a[download] → 复制兜底面板`，诚实反馈（取消不谎报、WebView 不假成功）；`el` 经 ui.js 封装仅以 `UI.el` 暴露，本模块取别名使用。新增下载需求一律走它，不要自造 `a[download]`。
- **`assets/js/router.js` / `app.js`** —— hash 深链接（`#/today`、`#/diary` 等）、启动 boot、SW 注册、安装提示。
- **`assets/js/views/task-shot.js`** —— 截图转待办：`TaskShot.open()` 弹窗，本地走 `Ocr.recognizeLocal` + `linesFromWords/keepLine/toTasks`，云端走 `Ocr.recognizeCloudTasks`；识别结果只进候选清单，勾选后才 `Store.addTask`。纯函数四个（`normalizeLine/linesFromWords/keepLine/toTasks`）已导出，可脱离 DOM 单测。
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
9. **分发源码时务必带上模板引用的全部本地文件**：`src/index.template.html` 里每个 `<script src>` / `<link href>` 都必须在场。曾因 `assets/js/task-nlp.js` / `white-noise.js` / `white-paper.js` 三个文件没随包分发，导致 `build.py` 中断、排查多轮（这三个文件从未进过 git 历史，最终靠从产物 `index.html` 按位置还原才补齐）；现在 `build.py` 会**一次性列出全部缺失文件**再中止，不再只报第一个。
10. **重复任务的旧实例会自动归档进 `state.taskArchive`**：完成超过 60 天、且**没有活动记录、没有子任务**的重复实例，每天首次启动时搬走一次。主列表只读 `state.tasks`，所以待办 / 已完成列表自然变短；但**历史统计（目标 KR 完成率）必须把 `tasks + taskArchive` 一起算**——`goalPct` 与 `goalCtx` 两处 ctx 已这么处理，改动时别退回只算 `tasks`，否则归档会把目标周期内的分母与分子一起变小，进度会莫名其妙地变化。**绝对不要归档挂了 `activities.taskId` 或有子任务的实例**，那会让「已投入 X」和子任务计数找不到主人。归档区不进同步码（省体积），完整备份会带走；导入时备份带了就用备份的，没带则保留本机归档。

## 六、日常开发循环

```
改 assets/ 或 src/ → python3 build.py → node tests/run.mjs
→ 起服务跑相关 verify_*.mjs → git commit（信息写清功能与理由）
```

提交粒度：一个提交 = 一个完整功能 + 对应测试。历史上每个 `verify_*.mjs` 都是随功能同提交加入的，请保持这个习惯。

## 七、接下来做什么

看 `ROADMAP.md`。当前明确的候选（按上一轮讨论结论）：

- **（已修）旧档 `pity6` / `makeUp` 搬运失效**：`ensure()` 里「单池 pity6 → 分池」「makeUp → 摸鱼券」两处旧值搬运，会被 `validateSchema()` 抢先创建的默认值挡住——它先把 `pools.standard.pity6`、`tickets.fish` 初始化成 `0`，等迁移代码判断 `== null` 时已不成立，于是**老用户升级后保底计数与补签卡归零**。已用「重构前 vs 重构后」对照实验确认**行为一致，非本次重构引入**。修法（已落地）：① 新增 `hoistLegacy()`，在 `ensure()` 最开头（**早于 `validateSchema`**）把旧 `pity6` 搬进 `pools.standard`；② `makeUp → 摸鱼券` 的抢救放进 `mergeShop()`——它是 shop 的唯一规范化入口，`validateSchema` 与 `importJSON` 两条路径都覆盖得到。两处都是「搬完即删旧字段」保证幂等。对照实验：修复前 `pity6=0 / fish=0 / log=[]` → 修复后 `42 / 3 / ["2026-01-01"]`；`verify_breath.mjs` 22 项、`verify_pools.mjs` 25 项、`verify_shop.mjs` 33 项全过。

- **新抽卡体系（多卡池/UP）**：**已实施**（见 `ROADMAP.md` §十一，`verify_pools.mjs`）。当时的决策记录：
  - **三个池**：标准池（轮换 UP）/ 中坚池 / 限定只出不进（不参与轮换，靠歪或定向券，UI 明示「定向券专供」）；4★/3★ 两池共用，仅 6★/5★ 分池。
  - **中坚名单**：36 人，来源 = Wiki「寻访池一览」classic_/fesclassic_ 历史 UP 去重（已验证可脚本自动抓取维护）；本地数据漏「琦良」（5★）需补。
  - **节奏**：两池均 **每 3 天 UP 2 名 6★**；标准池 73 人 ≈111 天一轮（平均等到指定 UP ≈55 天）；**A+B+井120**，井计数**跨期不清零**，攒够后可兑换**含当期在内的历史 5 期以内的所有 UP 5★/6★**。
  - **配套**：加 3 期 UP 预告 + 心愿单到货提醒（3 天轮换成立的关键）；定向券发放节奏待定（建议 1~2 月 1 张）。
  - 落地形态：`GACHA_POOLS` 配置驱动（成员规则/UP 数/轮换天数/井深/独立计数），轮换按**绝对日期**算 `floor(daysSince(epoch)/rotDays)` 保证跨设备一致；状态迁移：老 `gacha.pity6` → `pools.standard`。
- 机制主题皮肤**浅色 + 深色**均已上线（森林/抽卡 × 明暗 4 套，可在设置·外观切换），无需再做。
- **有效动作 / 全勤 / 摸鱼券**：**已实施**（见 `ROADMAP.md` §十二，`verify_breath.mjs`）；「计划休息令牌」最终以「摸鱼券·休整」的形式并入本机制，不再单列。
- 竞品调研产出过两批候选清单，其中「待办↔时间投入」「年度视角」「时间块补录」**均已实施**，剩余候选在 ROADMAP 的「竞品横向对比」章节。

设计原则一句话：**这个应用宁可少做，也不做会误导用户的数据**（不给 KR 加权重、不惩罚未达成目标、分钟数不重复算——理由都写在 README 和 ROADMAP 里，动手前先读）。
