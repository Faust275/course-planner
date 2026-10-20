# 课表 Course Planner

一个面向学生的单文件网页应用（PWA）：课表、日程、四象限待办、日历、专注计时、记账、成绩、抽卡收集、每日一句等。

**交付形态是一个 `index.html`**：CSS、JS、诗词/词库语料全部内联，双击即可使用，也可直接转发。开发期源码拆成多文件，构建时打包回单文件。

## 快速使用

- **直接用**：双击 `index.html`，或把它发到任意设备用浏览器打开。
- **托管**：放到任意静态服务器根目录即可；此时可额外放 `sw.js` 启用离线缓存。

数据保存在**各自设备的浏览器**里（优先 IndexedDB，`file://` 或隐私模式自动回退 `localStorage`），不随文件复制。跨设备迁移用应用内的「同步码」。

## 源码结构

```
course-planner-web/
├── src/index.template.html   页面骨架（head + body 壳 + <link>/<script src> 占位）
├── assets/css/style.css      全部样式
├── assets/js/
│   ├── store.js              数据模型 + 持久化（IndexedDB / localStorage）+ 迁移
│   ├── ui.js                 元素创建 el() / 弹窗 / Toast（含 cp- 运行时前缀钩子）
│   ├── app.js                启动 boot、导航、Service Worker 注册
│   ├── pet.js                桌宠（独立模块，可整块删除）
│   ├── ak_ops.js             干员数据
│   ├── quotes-data.js        诗词 / 词库语料
│   ├── quotes.js             每日一句 / 每日一词 UI
│   ├── remind.js              上课提醒：.ics 生成（纯函数）+ 页面内轮询提醒
│   ├── foods.js / speech.js / ocr.js / theme.js / onboard.js
│   └── views/*.js            各页面（课表、今日、日历、日程、象限、待办、计划、
│                             笔记、记账、抽卡、专注、收集、成绩、设置、ocr-dialog）
├── build.py                  构建：内联 CSS/JS → 单文件 index.html
├── sync_from_index.py        从任意历史单文件反向抽取模块
├── namespace_cp.py           批量加 cp- 类名前缀（一次性迁移脚本）
├── verify_build.mjs          Playwright 冒烟回归
├── verify_sync_scope.mjs     同步码三档导出验证
├── verify_sync_ui.mjs        同步码弹窗交互验证
├── verify_backup.mjs         自动备份 / 恢复 / 裁剪验证
├── verify_parts.mjs          同步码分片切分验证
├── verify_parts2.mjs         分片乱序 / 噪音 / 缺片拼回验证
├── verify_batch.mjs          课表批量导入端到端验证
├── verify_conflict.mjs       课表时间冲突检测验证
├── verify_ics.mjs            上课提醒：.ics 导出内容 + 页面内提醒触发
├── verify_search.mjs         全局搜索：结果分组、关键词高亮、跳转定位
├── verify_repeat.mjs         重复任务：展开生成、过期锚定、until 截止
├── verify_anniv.mjs          倒数纪念日：公历/农历顺延、今日卡片、弹窗
├── verify_export.mjs         课表导出图片：布局复用、单双周、撞课堆叠、预览下载
├── verify_subtask.mjs        子任务：只一层、四条联动开关、删除去向、角标口径
├── verify_stats.mjs          统计复盘：自然口径、日均对比、热力条刻度、区间缓存失效
├── eq_check.mjs              Playwright 跨视图计算样式等价对比
└── tests/run.mjs             纯函数单测（401 条）
```

## 构建

```bash
cd course-planner-web
python3 build.py          # 生成 index.html
```

各模块均为全局 IIFE、无 `import`，因此按模板里的 `<script>` 顺序直接内联即可，**不需要打包器**。

若手上只有旧的单文件、想回到模块化源码：

```bash
python3 sync_from_index.py   # 需要先把 SRC 指向目标 html
python3 build.py
```

## 测试

```bash
node tests/run.mjs           # 纯函数单测（区间合并、周次解析、同步码分片、课表文本解析、
                             #             时间冲突、.ics 生成与折行、全局搜索、
                             #             重复任务顺延、农历换算、纪念日届数、
                             #             统计口径与跨午夜睡眠归属）

# UI 回归（需 playwright；先起本地静态服务）
python3 -m http.server 8137 &
node verify_build.mjs        # 启动、路由、桌宠、IndexedDB、控制台报错
node eq_check.mjs            # 12 个视图全量类名计算样式对比
node verify_backup.mjs       # 自动备份
node verify_sync_scope.mjs   # 同步码分档
node verify_parts2.mjs       # 同步码分片
node verify_batch.mjs        # 课表批量导入
node verify_conflict.mjs     # 课表时间冲突
node verify_ics.mjs          # .ics 导出内容 + 页面内提醒
node verify_search.mjs       # 全局搜索 + 高亮 + 跳转定位
node verify_repeat.mjs       # 重复任务展开生成
node verify_anniv.mjs        # 倒数纪念日（含农历）
node verify_export.mjs       # 课表导出图片
node verify_subtask.mjs      # 子任务（含设置页联动开关）
node verify_stats.mjs       # 统计与复盘（自然口径、对比、热力条、缓存）
```

各 `verify_*.mjs` 用 `URL` 环境变量指定地址，不写死端口。

## 工程约定

- **CSS 类名统一 `cp-` 前缀**，避免全局冲突。`pet-` 用于桌宠，打印文档（成绩单窗口）自带独立样式，不加前缀。
- 新增页面放 `assets/js/views/`，通用能力放 `assets/js/`，并在 `src/index.template.html` 里按依赖顺序引用。
- 新功能的动态类名无需手动加前缀 —— `ui.js` 的 `el()` 会在运行时代为添加。
- 改完源码务必跑一次 `build.py`，并确认 `index.html` 同步更新。

## 联网依赖（可选功能）

| 功能 | 依赖 | 离线表现 |
|---|---|---|
| 抽卡 / 图鉴头像 | `media.prts.wiki` | 首次无网不显示，加载过会缓存 |
| OCR 图片识别 | `cdn.jsdelivr.net` 的 tesseract.js | 该功能不可用，其余正常 |
| 云端 OCR / OpenAI | `api.openai.com` | 仅在自行填写 Key 后使用 |

页面启动本身不发任何网络请求，主体功能完全离线可用。

## 素材与版权

桌宠采用「开发者开关 + 本地素材注入」：源码内**不内嵌**任何商业作品素材，默认关闭；使用者自行导入本地精灵图后才会显示。行为逻辑为通用实现。

## License

未声明许可证。如需开源请补充 LICENSE。
