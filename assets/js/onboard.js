/* ==========================================================
 * 新手教程：首次打开自动走一遍，之后可在「设置 → 新手教程」再看
 *  - 核心步骤（core 不写或 true）：走完整个流程
 *  - 非核心步骤（core: false）：介绍进阶功能，卡片上直接给「关闭」按钮，
 *    第一次出现非核心步骤时高亮提醒「之后在设置也能打开」
 *  - 合成玉 / 抽卡相关内容不放在主流程，改为开发者选项开启后单独弹出的引导
 *    （见 GACHA_STEPS + startGacha），默认只种树的用户不会看到
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;
  var I = V.icons;

  /* =====================================================================
   * 5 步核心引导：第一次打开只讲「今天就能用起来」的五件事，
   * 完整功能导览（24 步）放在最后一步的「更多功能」里，按需再看。
   * ===================================================================== */
  var STEPS = [
    {
      view: 'today', icon: I.today, title: '欢迎使用课表',
      desc: '课程、日程、待办、专注、健康、记账都在一个 App 里。数据默认只保存在这台设备，不会自动上传。',
      tips: [
        '换设备靠「设置 → 数据管理」里的导出/导入或同步码，几分钟就能搬完',
        '手机上「添加到主屏幕」可以当 App 用；安卓安装包装好后，上课提醒锁屏也能响',
        '不想看可以点「跳过」，之后在「设置 → 新手教程」里随时再看'
      ]
    },
    {
      view: 'schedule', icon: I.calendar, title: '先排课，再看今日',
      desc: '课程表按「星期几 × 第几节」排；排好后每天只看「今日」这一页就够了。',
      tips: [
        '添加课程时在网格里点格子，可一次选多个时段；也支持拍照识别和 .ics 导入',
        '某一节临时停课、换教室或调课，只改那一天，整学期课表不受影响',
        '今日页是一条时间线：下一节课倒计时、今天要交的作业、昨晚睡眠都在里面'
      ]
    },
    {
      view: 'tasks', icon: I.check, title: '作业和安排都丢进待办',
      desc: '待办支持精确到分钟，日程负责会议、约饭这类一次性安排，两边可以互相拖。',
      tips: [
        '速记框直接写「明天14:00交高数作业」，时间和标题会自动拆好',
        '大事拆子任务，父任务显示 2/4 进度；重复任务完成后自动生成下一期',
        '在日历里点一条待办，会自动在当天空档划出一段计划时间块'
      ]
    },
    {
      view: 'pomodoro', icon: I.tomato, title: '专注与长期计划',
      desc: '番茄钟负责「现在专心做」，计划和目标负责「这学期要坚持什么」。',
      tips: [
        '专注可以关联待办或课程，结束后时长自动计入对应计划',
        '计划支持打卡、进度、时长三种方式；目标下面挂关键结果，进度自动算',
        '完成待办和专注都会攒积分，可以在「收集」里换奖励'
      ]
    },
    {
      view: 'settings', icon: I.settings, title: '最后一件事：把数据保住',
      desc: '功能都可以慢慢摸，但备份建议今天就做一次。',
      tips: [
        '「设置 → 数据管理」可以导出完整备份、生成同步码，或接自己的 WebDAV',
        '建议每周导一次备份；换手机、刷机、卸载前一定先导出',
        '安卓用户顺手把通知权限和后台白名单开一下，课前 15 分钟锁屏才有提醒'
      ],
      cta: {
        text: '开启通知与后台权限',
        nativeOnly: true,
        onClick: function () {
          var cap = global.Capacitor;
          var p = cap && cap.Plugins && cap.Plugins.Notify;
          if (!p) return;
          Promise.resolve(p.requestPermission ? p.requestPermission() : null).then(function (r) {
            if (p.openBatterySettings) p.openBatterySettings();
            if (global.Remind && Remind.syncNative) Remind.syncNative(true);
            V.toast(r && r.granted ? '通知已开启，顺手把本应用设为「不限制后台」更稳'
                                   : '未获得通知权限，可稍后在设置里再开', r && r.granted ? 'ok' : 'err');
          }).catch(function () {
            if (p.openBatterySettings) p.openBatterySettings();
          });
        }
      }
    }
  ];

  /* 完整功能导览：从设置或核心引导最后一步的「更多功能」进入 */
  var FULL_STEPS = [
    {
      view: 'today', icon: I.today, title: '欢迎使用课表',
      desc: '课程、日程、待办、专注、健康、记账都放在这一个 App 里。数据默认只保存在这台设备（IndexedDB / localStorage），不会自动上传；只有你主动开启 WebDAV 同步、云端识别或语音识别时，对应数据才会发送到你指定的服务器。',
      tips: [
        '第一次打开会带你走一遍，大概 1 分钟',
        '不想看可以点「跳过」，之后在「设置 → 新手教程」里随时再看',
        '手机上可以「添加到主屏幕」当 App 用；装好后长按图标，能直接进「今日课表」「写日记」，不用每次都从首页找'
      ]
    },
    {
      view: 'today', icon: I.today, title: '今日',
      desc: '每天早上打开这一页就够了：今天要上的课、到期的待办，按时间先后排成一条线。',
      tips: [
        '顶部的「今日要点」速览条一眼能看到下一节课倒计时和昨晚的睡眠状态；体育课还会直接出现「🏃 记入锻炼」一键按钮',
        '距离考试 ≤7 天时，顶部会自动点亮「🔥 考前冲刺」横幅，结合平时分计算及格线并支持一键开启番茄钟专注',
        '往下滑是「每日一句」（收藏后可一键写进日记并在专注时伴读）和「每日一词」（拼写小测验支持自定义目标词数并自动打卡英语计划）'
      ]
    },
    {
      view: 'schedule', icon: I.calendar, title: '课程表',
      desc: '按「星期几 + 第几节」排课，顶部可一键切换「📅 常规周课表 | 🗓️ 月历 | 🎯 考试周备考看板 | 📋 日程」。',
      tips: [
        '添加课程时在「星期 × 节次」网格里点格子，可一次选任意组合，或切到「自定义时间」直接填起止时间，实验课还支持按周轮转教室',
        '右上角「导入课表」支持拍照/截图先切格识别导入与 .ics 日历文件导入；点击任意课程可记录并查看「📝 随堂笔记」',
        '周切换栏提供「📋 导出空档」（一键生成本周/今日空闲时段文本）与「🎓 新学期向导」（开启新学期并归档旧课表与已完成待办）'
      ]
    },
    {
      view: 'calendar', tab: 'agenda', icon: I.agenda, title: '日程与日历',
      desc: '「日程」把未来 7 天的课程、考试和一次性安排放在一起，按天排列；「日历」支持月视图与每日长条时间轴切换。',
      tips: [
        '会议、约饭、纪念日这类安排直接加到日程里；纪念日倒计时 ≤7 天时可一键生成准备待办',
        '切到「日历」可在「📅 经典月历」与「📊 每日长条时间轴」间切换，直观回看过去实心真实记录、未来虚线计划与红色 🚩 截止线'
      ]
    },
    {
      view: 'tasks', icon: I.check, title: '待办（支持精确到小时）',
      desc: '作业、杂事都记在这里，支持将截止时间精确到具体小时与分钟（00–23时独立直选、+1h/+2h/+4h 相对步进与整点胶囊）。',
      tips: [
        '顶部速记框与弹窗支持输入「3小时后交报告」「明天14:00交高数作业」，列表实时显示「剩 Xh」或「已超 Xh」精确倒计时',
        '新建或编辑待办时点「⚡ 一键智能分配时间」，设定总时长与连续/不连续模式，会自动结合睡眠精力曲线、DDL 与课表空档排入日程',
        '支持两级标签（如「学习/英语」）、消费类待办完成时提示一键记账，以及逾期任务「⏩ 一键顺延到今天」'
      ]
    },
    {
      view: 'tasks', icon: I.flag, title: '一件事拆成几步',
      desc: '像「期末复习」这样的事，展开后点「添加子任务」，就能拆成几个小步骤，父任务上会显示 2/4 这样的进度。',
      tips: [
        '子任务默认折叠，点父任务右边的箭头才展开，所以列表不会一下子变很长',
        '只做一层：子任务下面不能再挂子任务',
        '默认是「各算各的」——子任务全部做完，父任务不会自己变成完成，只显示进度；勾了父任务也不会把子任务一起勾掉',
        '这些都能改：在「设置 → 子任务」里逐项开关，页面会实时告诉你当前组合会有什么效果'
      ]
    },
    {
      view: 'tasks', icon: I.idea, title: '灵感（在待办里）',
      desc: '待办页顶上切到「灵感」，想到什么先随手记下来，不用想放在哪。',
      tips: [
        '一句话、一段话都行，也支持打标签或关联课程作为随堂笔记',
        '想变成待办时点一下「转待办」，或点「写进日记」一键搬过去'
      ]
    },
    {
      view: 'tasks', icon: I.search, title: '搜索与重复任务',
      desc: '顶部的搜索框能跨所有模块找内容：课程、待办、目标、账目、日记都能搜。待办设了重复规则（每天 / 每周 / 自定义）后，完成后会自动生成下一次。',
      tips: [
        '农历生日、纪念日也能设成每年重复的提醒',
        '设置里能开启全局快捷键，电脑上更顺手'
      ]
    },
    {
      view: 'tasks', icon: I.chart, title: '待办与时间投入',
      desc: '一条待办可以和时间记录双向关联：专注或补录时选它，待办里就会显示「已投入」总时长和最近记录；月历计划块则显示「今日计划 vs 实际」。',
      tips: [
        '计划块不算「已投入」——计划是打算做，实际专注才计入',
        '点「已投入」里的记录，可直接跳到那天的象限查看'
      ]
    },
    {
      view: 'tasks', tab: 'quadrant', icon: I.quadrant, title: '象限',
      desc: '用 24 小时的环形图看时间都花在哪，月视图下还可切换「📏 每日长条时间轴（横条/竖条）」全景纵览整月。',
      tips: [
        '睡眠卡上点「开始睡眠」，醒来再点「结束睡眠」，或用自然语言一句话速记睡眠，时长自动记入当天并推算全天精力曲线',
        '切到「一月」档可一键切换「📊 环形统计」与「📏 每日长条时间轴」，同屏回看过去的真实时间轨迹与未来的计划时间块、截止线',
        '饮食、睡眠与手环锻炼数据都会自动汇入 24h 时间环，支持今天 / 一周 / 一月 / 一季 / 今年切换'
      ]
    },
    {
      view: 'pomodoro', icon: I.tomato, title: '番茄钟',
      desc: '专心做一件事的计时器，时长可以自己定，也能关联一条待办。',
      tips: [
        '专注和完成待办都能拿积分，还会自动勾选绑定课程的复习打卡计划、累加同名或同标签的「时长型/进度型计划」',
        '专注期间底部自动展示你收藏的诗词佳句伴读；满 40 分钟且运动环未满时，结束提示支持一键记录 10 分钟课间拉伸/散步',
        '支持开启「🔒 强制前台锁屏模式」与自定义时段的「🌙 夜间自律模式」，在「设置 → 奖励机制」中还可随时切换奖励玩法'
      ]
    },
    {
      view: 'plans', icon: I.flag, title: '计划',
      desc: '想长期坚持的事放这里，支持「打卡」「进度条」和「时长累计」三种方式。',
      tips: [
        '睡眠达标自动打卡作息计划、记早餐自动打卡饮食计划、单词测验达标自动打卡英语计划、锻炼记录自动打卡运动计划',
        '昨晚缺觉或日记连续 2 天记录疲惫/低落时，会自动推荐「今天缓一缓」，连续天数不断签（最多连缓 2 天）',
        '页面顶部还能切到「目标」——计划是「每天都做」，目标是「这段时间要做到什么程度」'
      ]
    },
    {
      view: 'plans', tab: 'goals', icon: I.target, title: '目标',
      desc: '目标是给这个学期定个方向：按「📚 学业 / 🏃 健康 / 🌱 习惯 / 🎨 兴趣」分组管理，下面挂 2–4 条关键结果（KR）与每日微行动。',
      tips: [
        '顶部配备「⏱️ 10 天复利微周期」冲刺横幅，关键结果采用双列水位线卡片，支持挂计划、挂待办、挂成绩/健康达标或自己填数（带 + 号快捷步进）',
        '总进度是几条关键结果的等权平均；每个目标下可拆解「第 4 级：今日微行动」，一键完成或开启专注并实时反馈复利贡献百分比',
        '同时在办最多 5 个；到期不会删除也不扣分，只是进「已归档」；每月最后三天会出现复盘卡，点一下就能把进度写进当天日记'
      ]
    },
    {
      view: 'ledger', icon: I.wallet, title: '记账',
      desc: '记一笔收入和支出，带上分类和标签，支持微信/支付宝账单 CSV 导入。',
      tips: [
        '饮食里填了价格，或完成带金额的消费类待办，都可自动生成账目，不用记两遍',
        '可以按分类或标签看这段时间的花销，支持月度总预算、分类限额预警与今日剩余日均额度提示'
      ]
    },
    {
      view: 'grades', icon: I.chart, title: '成绩与构成校验',
      desc: '课程表里的课程会自动同步到这里（未设学分的课也可直接点击设置学分与成绩构成），也能手动添加选修或重修课程。',
      tips: [
        '支持先保存成绩构成（如平时 40% + 期末 60%，分数留空待出分补录），并提供 5 套常用构成模板一键套用',
        '编辑多层分项时，系统会实时自动检索各层子成绩占比之和是否等于母值（100% 或父项占比），并提供「⚡ 一键配平」按钮',
        '录入成绩后实时联动更新「目标」里的 GPA 关键结果，支持目标绩点模拟（What-if）与导出 CSV / PDF 成绩单'
      ]
    },
    {
      view: 'diary', icon: I.moon, title: '日记与心情',
      desc: '底部「日记」可以记每天的心情和随笔，心情用颜色标记，月末能回看自己的情绪走势。',
      tips: [
        '写日记时点「📎 插入今日足迹」，可一键汇总当天的课程、专注时长、睡眠三环与花销快照',
        '写了日记的日期在日历上会有心情色点；连续两天心情疲惫时还会联动计划页温和减负',
        '收藏的诗词单词与月末目标复盘卡都可以一键写进当天日记'
      ]
    },
    {
      view: 'settings', icon: I.settings, title: '标签与设置',
      desc: '标签是贯穿所有模块的分类方式；外观、模块排序与跨设备同步都在「设置」里管理。',
      tips: [
        '标签与外观：常用标签自带图标配色，可在「设置 → 标签」统一改名换色；外观提供 20 套主题配色与自定义背景图',
        '导航架构：默认启用「方案 A：六大核心分区整合模式」（今日 / 课表 / 待办 / 计划 / 专注 / 我的），顶部胶囊直达全部子板块；也可在「设置」中一键切换为经典多模块模式',
        '数据管理：支持同步码、二维码分片同步与完整文件备份；手机上「添加到主屏幕」后长按图标可直达「今日课表 / 写日记 / 待办」'
      ]
    },

    /* ===================== 以下为非核心功能介绍（core: false），按模块归并、从前到后 ===================== */
    {
      core: false, view: 'schedule', icon: I.calendar, title: '课程单次调整与考前备考',
      desc: '某一节的课临时有变？打开「课程表」里那门课，或今日页课程卡上的「调整」，可以停掉这一节、临时换教室，或把课调到别的日期。',
      tips: [
        '只改那一天，整学期的课表不受影响；停课当天会从节数、提醒、统计里消失，调课补课会在目标日期标注「调自 X/X」',
        '切到「🎯 考试周备考看板」，距离期末考 ≤14 天的课程可一键生成每日备考打卡计划，并自动拆解一轮复习/真题/冲刺三阶段待办'
      ]
    },
    {
      core: false, view: 'calendar', icon: I.check, title: '待办计划块与智能排程',
      desc: '「日历」选中某一天，卡片下方有「待办」抽屉：点一条待办，会在当天的空档自动划出一段「计划学习」的时间块，并关联上它。',
      tips: [
        '虚线框是「计划」，真正专注后记录成实线——计划不等于已经做了，不会算进统计',
        '需要跨天或连续几小时的大块时间？直接在待办弹窗里用「⚡ 一键智能分配时间」，自动按睡眠精力波峰与空档排好并支持「换一批时段」'
      ]
    },
    {
      core: false, view: 'tasks', tab: 'quadrant', icon: I.quadrant, title: '每日长条时间轴（过去与未来）',
      desc: '在「象限 → 一月」或「日历」中打开「📊 每日长条时间轴」，每天是一条完整的 00:00–24:00 时间带，支持横条与竖条双布局切换。',
      tips: [
        '过去的日期展示实心色块（睡眠、已上课程、专注与活动、三餐），一眼回看每天具体做了什么',
        '今天与未来的日期展示高透明虚线色块（待办计划时间块、待上课程、未来日程），并用红色「🚩」横线标出待办截止时间点（DDL）'
      ]
    },
    {
      core: false, view: 'schedule', icon: I.phone, title: '手势与离线更新',
      desc: '手机上在课表左右滑切周、在月历左右滑切月，单手就能翻。应用有新版时会弹「应用已更新」，点一下刷新即可，数据都在本地不会丢。',
      tips: [
        '滑动只在非滚动区域触发，不会和你正常的上下滚动打架',
        '用「添加到主屏幕」装成 App 后，离线也能打开'
      ]
    },
    {
      core: false, view: 'health', icon: I.heart, title: '健康三段看板与睡眠精力推算',
      desc: '「健康」模块分为「📊 概览」「🏃 活动」「🏋️ 锻炼」三段视图，呈现活力彩虹三环、睡眠动物画像与 11 种手环运动模式。',
      tips: [
        '支持 Health Connect 自动同步、小米运动健康 / Zepp Life CSV 批量导入、自然语言一句话速记与系统相册分享识图',
        '系统会根据昨晚真实入睡/起床时刻、深睡比例与睡眠债，基于双过程睡眠模型动态推算你今天 24 小时的精力波峰与午后低谷，供待办智能排程使用'
      ]
    },
    {
      core: false, view: 'tasks', tab: 'stats', icon: I.chart, title: '年度统计、森林与成就收集',
      desc: '「统计」页用「今天 / 本周 / 本月 / 本学期 / 今年」切换周期；专注种下的树木与里程碑成就则汇总在「收集」页。',
      tips: [
        '跨度超过 120 天，热力图会自动按月分组，还能和上一周期对比日均投入',
        '专注攒下的树都在「收集 → 我的森林」里，达成过的目标和里程碑会留在「成就」里随时回看'
      ]
    },

    /* ===================== 收尾 ===================== */
    {
      view: 'schedule', icon: I.leaf, title: '就这些了',
      desc: '先去课程表把课排上，其他功能用着用着就熟了。',
      tips: [
        '随时可以在「设置 → 新手教程」里再看一遍',
        '遇到问题也可以翻「设置 → 使用提示」，里面有各模块的细节',
        '每个模块都有自己的地址（#/today、#/goals 这种），在「设置 → 桌面与快捷」里可以复制出来存书签'
      ]
    }
  ];

  var GACHA_STEPS = [
    {
      view: 'collection', tab: 'ops', icon: I.star, title: '抽卡系统已解锁',
      desc: '你通过开发者选项开启了抽卡系统。专注和完成待办攒下的积分，可以按 1 积分 = 180 合成玉 折算成合成玉，用来寻访干员。',
      tips: [
        '两套机制的积分各自独立、不能混花；在「设置 → 奖励机制」里切换，切换时已攒的都保留',
        '抽到的干员会进入「收集 → 干员图鉴」，已获得的也会显示在首页'
      ]
    },
    {
      view: 'collection', tab: 'ops', icon: I.star, title: '合成玉与寻访',
      desc: '合成玉用来抽卡：600 合成玉单抽、6000 合成玉十连（单抽约需 3.33 积分）。抽到的干员按星级进入图鉴。',
      tips: [
        '六星基础概率 2%，50 抽后概率递增；每个自然天第一个十连保底至少一位五星',
        '重复干员提升潜能（0~5），满潜能后的多余复制会转化为积分',
        '可在「设置 → 奖励机制」中随时切换奖励玩法'
      ]
    }
  ];

  var currentSteps = STEPS;
  var firstNonCore = -1;
  function recalcNonCore() {
    firstNonCore = currentSteps.findIndex(function (s) { return s.core === false; });
  }

  var idx = 0;
  var root = null;
  var card = null;
  var fromView = null;
  var fromTab = null;
  var onDoneCb = null;

  function build() {
    root = el('div', { class: 'ob-mask' });
    card = el('div', { class: 'ob-card' });
    root.appendChild(card);
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey);
  }

  function remove() {
    document.removeEventListener('keydown', onKey);
    if (root) root.remove();
    root = null;
    card = null;
  }

  function onKey(e) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      go(idx + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(idx - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(true);
    }
  }

  function go(i) {
    if (i >= currentSteps.length) { finish(false); return; }
    idx = Math.max(0, i);
    var s = currentSteps[idx];
    if (s.view && global.App && App.go) App.go(s.view, s.tab ? { tab: s.tab } : null);
    draw(s);
  }

  function draw(s) {
    card.innerHTML = '';
    var isLast = idx === currentSteps.length - 1;
    var nonCore = s.core === false;
    var showNotice = nonCore && idx === firstNonCore;

    card.appendChild(el('div', { class: 'ob-head' }, [
      el('span', { class: 'ob-icon' }, [V.svg(s.icon, 20)]),
      el('div', { class: 'ob-title' }, [
        el('b', { text: s.title }),
        el('span', { text: '第 ' + (idx + 1) + ' / ' + currentSteps.length + ' 步' })
      ]),
      isLast ? null : el('button', {
        class: 'ob-skip', type: 'button', text: '跳过',
        onclick: function () { finish(true); }
      })
    ]));

    card.appendChild(el('p', { class: 'ob-desc', text: s.desc }));

    card.appendChild(el('ul', { class: 'ob-tips' }, s.tips.map(function (t) {
      return el('li', { text: t });
    })));

    // 可选的一键动作（仅 App 内、且该步骤声明了 cta 时出现）
    if (s.cta && (!s.cta.nativeOnly || global.Capacitor)) {
      card.appendChild(el('button', {
        class: 'btn btn-sm btn-primary',
        style: { marginTop: '4px', alignSelf: 'flex-start' },
        text: s.cta.text,
        onclick: function () {
          try { s.cta.onClick(); } catch (e) { /* 忽略 */ }
        }
      }));
    }

    if (showNotice) {
      card.appendChild(el('div', { class: 'ob-notice' }, [
        el('b', { text: '小提示：' }),
        el('span', { text: '以上是最近新增的功能，看不看都行。不想看直接点「关闭」，之后在「设置 → 新手教程」也能打开。' })
      ]));
    }

    var dots = el('div', { class: 'ob-dots' });
    currentSteps.forEach(function (_, i) {
      dots.appendChild(el('i', { class: 'ob-dot' + (i === idx ? ' on' : '') }));
    });
    card.appendChild(dots);

    var foot = el('div', { class: 'ob-foot' });
    if (idx > 0) {
      foot.appendChild(el('button', {
        class: 'btn btn-sm', text: '上一步',
        onclick: function () { go(idx - 1); }
      }));
    } else {
      foot.appendChild(el('span', { class: 'ob-step-hint', text: '点「下一步」继续' }));
    }

    if (nonCore) {
      foot.appendChild(el('button', {
        class: 'btn btn-sm', text: '关闭这些介绍',
        onclick: function () { finish(true, true); }
      }));
    }

    // 核心引导的最后一页：给想去深挖的人一个入口，不给就默认结束
    if (isLast && currentSteps === STEPS) {
      foot.appendChild(el('button', {
        class: 'btn btn-sm', text: '更多功能',
        onclick: function () { startFull({ from: 'core-tour' }); }
      }));
    }

    foot.appendChild(el('button', {
      class: 'btn btn-sm btn-primary',
      text: isLast ? '开始使用' : '下一步',
      onclick: function () { go(idx + 1); }
    }));
    card.appendChild(foot);

    if (nonCore) {
      card.appendChild(el('div', {
        class: 'ob-close-hint',
        text: '关闭后可在「设置 → 新手教程」再看'
      }));
    }
  }

  function finish(skipped, fromNonCore) {
    Store.updateSettings({ guided: true });
    remove();
    if (global.App && App.go) App.go(fromView || 'schedule', fromTab ? { tab: fromTab } : null);
    fromView = null;
    fromTab = null;
    V.toast(fromNonCore ? '已关闭新功能介绍，可在「设置 → 新手教程」再看'
                        : (skipped ? '已跳过，随时可以在设置里再看' : '教程看完了，先去排课吧'));
    var cb = onDoneCb;
    onDoneCb = null;
    if (cb) setTimeout(cb, 0);
  }

  function start(opts) {
    opts = opts || {};
    currentSteps = opts.steps || STEPS;
    recalcNonCore();
    fromView = opts.from || null;
    fromTab = opts.fromTab || null;
    onDoneCb = typeof opts.onDone === 'function' ? opts.onDone : null;
    idx = Math.max(0, Math.min(opts.startAt || 0, currentSteps.length - 1));
    if (!root) build();
    go(idx);
  }

  /** 完整功能导览：跳过欢迎页，从第 2 步开始 */
  function startFull(opts) {
    opts = opts || {};
    start({ from: opts.from || 'settings', fromTab: opts.fromTab || null, steps: FULL_STEPS, startAt: 1 });
  }

  function startGacha(opts) {
    opts = opts || {};
    start({ from: opts.from || 'settings', fromTab: opts.fromTab || null, steps: GACHA_STEPS });
  }

  global.Onboard = {
    start: start,
    startFull: startFull,
    startGacha: startGacha,
    steps: STEPS.length,          // 核心引导 5 步
    totalSteps: FULL_STEPS.length // 完整导览 24 步
  };
})(window);
