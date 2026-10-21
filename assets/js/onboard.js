


/* ==========================================================
 * 新手教程：首次打开自动走一遍，之后可在「设置 → 新手教程」再看
 *  - 核心步骤（core 不写或 true）：走完整个流程
 *  - 非核心步骤（core: false）：介绍新增功能，卡片上直接给「关闭」按钮，
 *    第一次出现非核心步骤时高亮提醒「之后在设置也能打开」
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;
  var I = V.icons;

  /* 每一步：view = 讲解时要切到的页面 */
  var STEPS = [
    {
      view: 'today', icon: I.today, title: '欢迎使用课表',
      desc: '课程、日程、待办、专注、记账都放在这一个 App 里。数据只保存在这台设备的浏览器里，不会上传到任何服务器。',
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
        '往下滑是「每日一句」和「每日一词」，点一下可以换一条，单词还能做拼写小测验',
        '最下面是森林，专注得越久，树种得越多'
      ]
    },
    {
      view: 'schedule', icon: I.calendar, title: '课程表',
      desc: '按「星期几 + 第几节」排课。点任意空白格子，就能给那个时间安排一门课。',
      tips: [
        '添加课程时在「星期 × 节次」网格里点格子，可以一次选任意组合，比如周一第 1 节加周三第 2 节',
        '不想按节次排？切到「自定义时间」，直接填开始和结束时间',
        '右上角「导入课表」可以传截图或拍照，自动识别成表格'
      ]
    },
    {
      view: 'calendar', tab: 'agenda', icon: I.agenda, title: '日程与日历',
      desc: '「日程」把未来 7 天的课程和一次性安排放在一起，按天排列。',
      tips: [
        '会议、约饭这类一次性的事，直接加到日程里',
        '想看整月的情况，用「日历」的月视图，过去和未来都在上面'
      ]
    },
    {
      view: 'tasks', tab: 'quadrant', icon: I.quadrant, title: '象限',
      desc: '用 24 小时的环形图看时间都花在哪，也可以自己补记活动。',
      tips: [
        '饮食和睡眠默认记录，不需要的话在「设置 → 记录偏好」里关掉',
        '可以切「今天 / 一周 / 一月 / 一季 / 今年」，图表能在饼图和方形图之间切换',
        '专注记录会自动汇总到这里'
      ]
    },
    {
      view: 'tasks', icon: I.check, title: '待办',
      desc: '作业、杂事都记在这里，可以关联课程、设截止日期和优先级。',
      tips: [
        '设了截止日期后，到期会自动出现在「今日」页',
        '标签支持两级，写成「学习/英语」，就能按一级或二级分别统计',
        '顶部可以搜，点麦克风还能说话输入，日期和时间会自动填好'
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
      view: 'pomodoro', icon: I.tomato, title: '番茄钟',
      desc: '专心做一件事的计时器，时长可以自己定，也能关联一条待办。',
      tips: [
        '专注和完成待办都能拿积分。奖励有两种：森林（种树浇水）和抽卡（合成玉寻访干员）',
        '两种机制的积分各自独立、不能混花，在「设置 → 奖励机制」里切换，切换时已攒的都保留',
        '抽卡是 1 积分 = 180 合成玉，600 玉单抽、6000 玉十连（单抽约需 3.33 积分），抽到的干员会显示在首页'
      ]
    },
    {
      view: 'plans', icon: I.flag, title: '计划',
      desc: '想长期坚持的事放这里，支持「打卡」和「进度条」两种方式。',
      tips: [
        '比如「每周跑步 3 次」「读完 12 本书」',
        '达标会自动标记完成，并奖励积分',
        '页面顶部还能切到「目标」——计划是「每天都做」，目标是「这段时间要做到什么程度」'
      ]
    },
    {
      view: 'plans', tab: 'goals', icon: I.target, title: '目标',
      desc: '目标是给这个学期定个方向：一句「想变成什么样」，下面挂 2–4 条关键结果，每条都对应一个能算出来的数。',
      tips: [
        '关键结果有三种量法：挂一条计划（按打卡算）、挂一组待办（按完成率算）、自己填（出分后填一个数）',
        '总进度是几条关键结果的等权平均，没有权重——权重靠拍脑袋，拍出来的数比不填更误导',
        '同时在办最多 5 个；到期不会删除也不扣分，只是进「已归档」；达成 100% 并归档会奖励积分',
        '每月最后三天会出现复盘卡，点一下就能把进度写进当天日记'
      ]
    },
    {
      view: 'tasks', icon: I.idea, title: '灵感（在待办里）',
      desc: '待办页顶上切到「灵感」，想到什么先随手记下来，不用想放在哪。',
      tips: [
        '一句话、一段话都行，也支持打标签',
        '想变成待办时点一下「转待办」，不用重新输入'
      ]
    },
    {
      view: 'ledger', icon: I.wallet, title: '记账',
      desc: '记一笔收入和支出，带上分类和标签。',
      tips: [
        '饮食里填了价格，会自动生成一条账目，不用记两遍',
        '可以按分类或标签看这段时间的花销，同样支持今天 / 一周 / 一月 / 一季'
      ]
    },
    {
      view: 'grades', icon: I.chart, title: '成绩',
      desc: '课程表里填了学分的课会自动出现在这里，也能手动添加其他课程。',
      tips: [
        '可以按「当前学期 / 某个学期 / 全部」汇总，按学分加权算均分',
        '点进一门课能设多层占比：总评 → 平时（再拆作业、考勤）+ 期末，填完自动算出总评',
        '学分怎么折绩点由你定：去「设置 → 成绩与 GPA」改换算表；右上角「导出」能存 CSV 或打印成 PDF'
      ]
    },
    {
      view: 'settings', icon: I.tag, title: '标签',
      desc: '标签是贯穿所有模块的分类方式，可以带图标和颜色。',
      tips: [
        '常用标签（学习、生活、运动…）自带图标，不用设置就有',
        '在「设置 → 标签」里可以换图标、改颜色，改名会同步到所有记录'
      ]
    },
    {
      view: 'settings', icon: I.settings, title: '设置与同步',
      desc: '剩下这些，等用熟了再调也来得及。',
      tips: [
        '外观：20 套配色或自选颜色，也能传一张图做背景',
        '模块显示：关掉不用的模块，还能拖动排序；超过 5 个会自动收进「更多」',
        '数据管理：用同步码把数据搬到手机或电脑；手机上可以「添加到主屏幕」，装好后长按图标有「今日课表 / 写日记 / 待办」快捷入口'
      ]
    },

    /* ===================== 以下为非核心功能介绍（core: false） ===================== */
    {
      core: false, view: 'schedule', icon: I.calendar, title: '课程单次调整',
      desc: '某一节的课临时有变？打开「课程表」里那门课，或今日页课程卡上的「调整」，可以停掉这一节、临时换教室，或把课调到别的日期。',
      tips: [
        '只改那一天，整学期的课表不受影响，也不会影响提醒和日历',
        '停课当天，这节课会从节数、提醒、统计里消失，日历上显示为灰色「已调走」',
        '调课补课会在目标日期出现，并标注「调自 X/X」'
      ]
    },
    {
      core: false, view: 'calendar', icon: I.check, title: '待办计划块',
      desc: '「日历」选中某一天，卡片下方有「待办」抽屉：点一条待办，会在当天的空档自动划出一段「计划学习」的时间块，并关联上它。',
      tips: [
        '虚线框是「计划」，真正专注后记录成实线——计划不等于已经做了，不会算进统计',
        '时间块弹窗也能手动选「关联待办」和「仅作计划」'
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
      core: false, view: 'plans', tab: 'goals', icon: I.target, title: '目标与复盘',
      desc: '「计划」页第二个分页是「目标」：给这个学期定方向，下面挂 2–4 条关键结果，每条对应一个能算出来的数（挂计划、挂待办、或自己填）。',
      tips: [
        '总进度是几条关键结果的等权平均，没有权重——权重靠拍脑袋反而更误导',
        '同时在办最多 5 个；到期不删也不扣分，只是进「已归档」；每月最后三天有复盘卡'
      ]
    },
    {
      core: false, view: 'diary', icon: I.moon, title: '日记与心情',
      desc: '底部「日记」可以记每天的心情和随笔，心情用颜色标记，月末能回看自己的情绪走势。',
      tips: [
        '写了日记的日期在日历上会有小圆点',
        '目标复盘卡可以一键把进度写进当天日记'
      ]
    },
    {
      core: false, view: 'tasks', icon: I.search, title: '搜索与重复任务',
      desc: '顶部的搜索框能跨所有模块找内容：课程、待办、账目、日记都能搜。待办设了重复规则（每天 / 每周 / 自定义）后，完成后会自动生成下一次。',
      tips: [
        '农历生日、纪念日也能设成每年重复的提醒',
        '设置里能开启全局快捷键，电脑上更顺手'
      ]
    },
    {
      core: false, view: 'tasks', tab: 'stats', icon: I.chart, title: '统计与年度视角',
      desc: '「统计」页用「今天 / 本周 / 本月 / 本学期 / 今年」切换周期。选「今年」能从元旦看到现在的累计，还能和去年同期对比。',
      tips: [
        '跨度超过 120 天，热力图会自动按月分组',
        '象限里的「今年」档同样能看到整年投入'
      ]
    },
    {
      core: false, view: 'tasks', icon: I.idea, title: '待办与时间投入',
      desc: '一条待办可以和时间记录双向关联：专注或补录时选它，待办里就会显示「已投入」总时长和最近记录；月历计划块则显示「今日计划 vs 实际」。',
      tips: [
        '计划块不算「已投入」——计划是打算做，实际专注才计入',
        '点「已投入」里的记录，可直接跳到那天的象限查看'
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

  // 第一个非核心步骤的下标，用于「第一次」高亮提醒
  var firstNonCore = STEPS.findIndex(function (s) { return s.core === false; });

  var idx = 0;
  var root = null;
  var card = null;
  var fromView = null;
  var fromTab = null;      // 挂着深链接进来时，教程结束后要落回同一个分页

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
    if (i >= STEPS.length) { finish(false); return; }
    idx = Math.max(0, i);
    var s = STEPS[idx];
    // 有些步骤要落到某个分页（比如目标在计划页的第二个分页）
    if (s.view && global.App && App.go) App.go(s.view, s.tab ? { tab: s.tab } : null);
    draw(s);
  }

  function draw(s) {
    card.innerHTML = '';
    var isLast = idx === STEPS.length - 1;
    var nonCore = s.core === false;
    var showNotice = nonCore && idx === firstNonCore;

    card.appendChild(el('div', { class: 'ob-head' }, [
      el('span', { class: 'ob-icon' }, [V.svg(s.icon, 20)]),
      el('div', { class: 'ob-title' }, [
        el('b', { text: s.title }),
        el('span', { text: '第 ' + (idx + 1) + ' / ' + STEPS.length + ' 步' })
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

    // 第一次出现非核心功能时，高亮提醒「之后在设置也能打开」
    if (showNotice) {
      card.appendChild(el('div', { class: 'ob-notice' }, [
        el('b', { text: '小提示：' }),
        el('span', { text: '以上是最近新增的功能，看不看都行。不想看直接点「关闭」，之后在「设置 → 新手教程」也能打开。' })
      ]));
    }

    var dots = el('div', { class: 'ob-dots' });
    STEPS.forEach(function (_, i) {
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

    // 非核心功能：直接给「关闭」按钮，可一键跳过这批介绍
    if (nonCore) {
      foot.appendChild(el('button', {
        class: 'btn btn-sm', text: '关闭这些介绍',
        onclick: function () { finish(true, true); }
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
  }

  /**
   * 开始教程
   * @param {Object} opts { from: 结束后回到哪个页面, fromTab: 该页的哪个分页 }
   */
  function start(opts) {
    opts = opts || {};
    fromView = opts.from || null;
    fromTab = opts.fromTab || null;
    idx = 0;
    if (!root) build();
    go(0);
  }

  global.Onboard = { start: start, steps: STEPS.length };
})(window);
