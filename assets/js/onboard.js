

/* ==========================================================
 * 新手教程：首次打开自动走一遍，之后可在「设置 → 新手教程」再看
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
        '不想看可以点「跳过」，之后在「设置 → 新手教程」里随时再看'
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
      view: 'agenda', icon: I.agenda, title: '日程与日历',
      desc: '「日程」把未来 7 天的课程和一次性安排放在一起，按天排列。',
      tips: [
        '会议、约饭这类一次性的事，直接加到日程里',
        '想看整月的情况，用「日历」的月视图，过去和未来都在上面'
      ]
    },
    {
      view: 'quadrant', icon: I.quadrant, title: '象限',
      desc: '用 24 小时的环形图看时间都花在哪，也可以自己补记活动。',
      tips: [
        '饮食和睡眠默认记录，不需要的话在「设置 → 记录偏好」里关掉',
        '可以切「今天 / 一周 / 一月 / 一季」，图表能在饼图和方形图之间切换',
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
      view: 'pomodoro', icon: I.tomato, title: '番茄钟',
      desc: '专心做一件事的计时器，时长可以自己定，也能关联一条待办。',
      tips: [
        '专注和完成待办都能拿积分。奖励有两种：森林（种树浇水）和抽卡（合成玉寻访干员）',
        '两种机制的积分各自独立、不能混花，在「设置 → 奖励机制」里切换，切换时已攒的都保留',
        '抽卡是 1 积分 = 600 合成玉，600 玉单抽、6000 玉十连，抽到的干员会显示在首页'
      ]
    },
    {
      view: 'plans', icon: I.flag, title: '计划',
      desc: '想长期坚持的事放这里，支持「打卡」和「进度条」两种方式。',
      tips: [
        '比如「每周跑步 3 次」「读完 12 本书」',
        '达标会自动标记完成，并奖励积分'
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
        '外观：9 套配色或自选颜色，也能传一张图做背景',
        '模块显示：关掉不用的模块，还能拖动排序；超过 5 个会自动收进「更多」',
        '数据管理：用同步码把数据搬到手机或电脑；手机上可以「添加到主屏幕」'
      ]
    },
    {
      view: 'schedule', icon: I.leaf, title: '就这些了',
      desc: '先去课程表把课排上，其他功能用着用着就熟了。',
      tips: [
        '随时可以在「设置 → 新手教程」里再看一遍',
        '遇到问题也可以翻「设置 → 使用提示」，里面有各模块的细节'
      ]
    }
  ];

  var idx = 0;
  var root = null;
  var card = null;
  var fromView = null;

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
    if (s.view && global.App && App.go) App.go(s.view);
    draw(s);
  }

  function draw(s) {
    card.innerHTML = '';
    var isLast = idx === STEPS.length - 1;

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

    var dots = el('div', { class: 'ob-dots' });
    STEPS.forEach(function (_, i) {
      dots.appendChild(el('i', { class: 'ob-dot' + (i === idx ? ' on' : '') }));
    });
    card.appendChild(dots);

    card.appendChild(el('div', { class: 'ob-foot' }, [
      idx > 0 ? el('button', {
        class: 'btn btn-sm', text: '上一步',
        onclick: function () { go(idx - 1); }
      }) : el('span', { class: 'ob-step-hint', text: '点「下一步」继续' }),
      el('button', {
        class: 'btn btn-sm btn-primary',
        text: isLast ? '开始使用' : '下一步',
        onclick: function () { go(idx + 1); }
      })
    ]));
  }

  function finish(skipped) {
    Store.updateSettings({ guided: true });
    remove();
    if (global.App && App.go) App.go(fromView || 'schedule');
    fromView = null;
    V.toast(skipped ? '已跳过，随时可以在设置里再看' : '教程看完了，先去排课吧');
  }

  /**
   * 开始教程
   * @param {Object} opts { from: 结束后回到哪个页面 }
   */
  function start(opts) {
    opts = opts || {};
    fromView = opts.from || null;
    idx = 0;
    if (!root) build();
    go(0);
  }

  global.Onboard = { start: start, steps: STEPS.length };
})(window);


