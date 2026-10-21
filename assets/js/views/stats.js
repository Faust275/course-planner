
/* ==========================================================
 * 视图：统计与复盘（nav:false，从「象限 → 时间统计 → 看统计」进入）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /** 周期：今天 / 本周 / 本月 / 本学期（自然日历口径，见 store.js 的 RANGES） */
  var RANGE_KEYS = ['day', 'week', 'month', 'term', 'year'];
  var curRange = 'week';
  /** 图表类型：pie 饼状图 / bar 方形图 */
  var chartType = 'bar';
  /** 是否展开对比 */
  var showCompare = false;

  function hmText(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    if (h <= 0) return m + ' 分';
    return h + ' 小时 ' + (m ? m + ' 分' : '');
  }

  function hmShort(min) {
    if (min < 60) return Math.round(min) + 'm';
    var h = min / 60;
    return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
  }

  function md(s) { return s ? s.slice(5).replace('-', '/') : ''; }

  var view = {
    id: 'stats',
    name: '统计',
    icon: V.icons.chart,
    title: '统计与复盘',
    order: 60,
    nav: false,

    root: null,

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-stats' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    render: function () {
      var root = this.root;
      root.innerHTML = '';

      var r = rangeDates(curRange);
      // 学期还没开学：「本学期」区间会退化成今天，需要单独说清楚
      var sem = Store.currentSemester();
      var semStart = sem && sem.startDate ? sem.startDate : '';
      var termNotStarted = curRange === 'term' && semStart && semStart > DateUtil.toStr(DateUtil.today());

      /* ---------- 周期切换 ---------- */
      var bar = el('div', { class: 'week-bar', style: { marginBottom: '12px' } }, [
        el('div', { class: 'week-label' }, [
          el('span', { text: RANGES[curRange].name + '统计' }),
          el('small', { text: md(r.from) + ' – ' + md(r.to) + ' · ' + r.days + ' 天' })
        ]),
        V.rangeTabs(curRange, function (k) { curRange = k; view.render(); }, RANGE_KEYS)
      ]);
      root.appendChild(bar);

      if (termNotStarted) {
        root.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.calendar, '本学期还没开始',
            '学期开始日是 ' + semStart + '，现在统计不到任何东西。可以在「设置 → 学期」里改一下开学日期。')
        ]));
        return;
      }

      var st = Store.compareStat(curRange, r);

      /* ---------- 顶部四个数 ---------- */
      var rec = st.cmp ? st.cmp.recorded : null;
      var cards = [
        { label: '已记录', value: hmText(st.cur.recorded), color: 'var(--primary)', big: true,
          cmp: rec, unit: 'min' },
        { label: '日均记录', value: hmText(perDay(st.cur.recorded, st.cur.days)), color: 'var(--primary)',
          cmp: rec, unit: 'perday' },
        { label: '睡眠日均', value: hmText(perDay(segMinutes(st.cur.segments, 'sleep'), st.cur.days)),
          color: '#6366f1', cmp: st.cmp && st.cmp.sleep, unit: 'perday' },
        { label: '上课日均', value: hmText(perDay(segMinutes(st.cur.segments, 'course'), st.cur.days)),
          color: '#f59e0b', cmp: st.cmp && st.cmp.course, unit: 'perday' }
      ];
      var grid = el('div', { class: 'cp-stat-grid' });
      cards.forEach(function (c) {
        var card = el('div', { class: 'cp-stat-cell' }, [
          el('div', { class: 'cp-stat-label', text: c.label }),
          el('div', { class: 'cp-stat-value', style: { color: c.color }, text: c.value })
        ]);
        if (showCompare && c.cmp) {
          card.appendChild(cmpChip(c.cmp, c.unit));
        }
        grid.appendChild(card);
      });
      root.appendChild(grid);

      /* ---------- 对比开关 ---------- */
      var cmpRow = el('div', { class: 'cp-cmp-row' });
      var canCompare = !!st.cmp;
      cmpRow.appendChild(el('button', {
        class: 'cp-cmp-toggle' + (showCompare ? ' is-on' : '') + (canCompare ? '' : ' is-off'),
        onclick: function () {
          if (!canCompare) return;
          showCompare = !showCompare;
          view.render();
        }
      }, [
        el('i'),
        showCompare ? '正在对比' : '与上一周期对比',
        canCompare ? '' : '（本学期没有可比的上一段）'
      ]));
      root.appendChild(cmpRow);

      if (showCompare && st.prevRange) {
        root.appendChild(el('div', {
          class: 'cp-cmp-hint',
          text: '参照区间：' + md(st.prevRange.from) + ' – ' + md(st.prevRange.to) +
                '（' + st.prevRange.days + ' 天）。两段天数不一样，所以只比日均，不比总量。'
        }));
      }

      /* ---------- 时间去向 ---------- */
      root.appendChild(chartCard(st));

      /* ---------- 对比明细 ---------- */
      if (showCompare && st.cmp) {
        root.appendChild(compareTable(st));
      }

      /* ---------- 周热力条 ---------- */
      root.appendChild(heatCard(st));

      /* ---------- 逐日记录量 ----------
         只在 8–35 天时给：更短的话上面已经有逐日热力条，更长的话
         chartDaily 会自动聚合成周，和上面的周热力条重复，还容易被误读成「一天 69 小时」。 */
      if (st.cur.days >= 8 && st.cur.days <= 35) {
        root.appendChild(dailyCard(st.cur));
      }

      /* ---------- 口径说明 ---------- */
      root.appendChild(el('div', { class: 'card cp-stats-note' }, [
        el('div', { class: 'cp-stats-note-title', text: '这些数字是怎么算的' }),
        el('div', { class: 'cp-stats-note-body' }, [
          el('p', { text: '「已记录」= 睡眠 + 上课 + 日程 + 活动 + 用餐的总时长。一天 1440 分钟，剩下的算未记录。' }),
          el('p', { text: '上课按「当前课表 + 当天是第几周」推算。所以改了课表以后，过去几周的上课时长会跟着变——这是推算的代价，不是 bug。' }),
          el('p', { text: '睡眠按实际时刻归属：23:00 睡、7:00 醒，前一天算 1 小时、后一天算 7 小时。这样「今天睡了多久」和现实一致，代价是单看某天不会显示整觉长度。' }),
          el('p', { text: '「今天」只算到此刻之前的整天数据，不会把还没过的时间算成未记录。' })
        ])
      ]));
    },

    focusRecord: function (type, id) {
      return global.Search ? Search.flash(Search.findRec(type, id)) : false;
    }
  };

  function segMinutes(segments, key) {
    for (var i = 0; i < segments.length; i++) if (segments[i].key === key) return segments[i].minutes;
    return 0;
  }

  /** 对比小标签：涨红跌绿不合适（时间不是股票），统一用「多了/少了」+ 中性色 */
  function cmpChip(c, unit) {
    var diff = unit === 'min' ? null : c.diffPerDay;
    var pct = c.pct;
    if (unit === 'min') {
      // 总量卡片：换算成日均再比，否则「本月 30 天 vs 上月 28 天」永远显示变多
      return el('div', { class: 'cp-cmp-chip is-flat', text: '区间不同，请看日均' });
    }
    var flat = Math.abs(diff) < 1;
    var up = diff > 0;
    var text = flat ? '与上期持平'
      : (up ? '日均多 ' : '日均少 ') + hmText(Math.abs(diff));
    if (!flat && pct !== null) text += '（' + (up ? '+' : '') + pct + '%）';
    return el('div', {
      class: 'cp-cmp-chip ' + (flat ? 'is-flat' : (up ? 'is-up' : 'is-down')),
      text: text
    });
  }

  /* ==========================================================
   * 时间去向
   * ========================================================== */
  function chartCard(st) {
    var cur = st.cur;
    var card = el('div', { class: 'card cp-chart-card' });

    var head = el('div', { class: 'section-title' }, ['时间去向']);
    head.appendChild(el('div', { class: 'dim-tabs' }, [
      { v: 'bar', n: '方形图' },
      { v: 'pie', n: '饼状图' }
    ].map(function (o) {
      return el('button', {
        class: 'dim-tab' + (chartType === o.v ? ' active' : ''),
        text: o.n,
        onclick: function () { chartType = o.v; view.render(); }
      });
    })));
    card.appendChild(head);

    card.appendChild(el('div', {
      class: 'cp-chart-sub',
      text: '已记录 ' + hmText(cur.recorded) + ' · 占区间 ' + cur.pct + '%'
    }));

    var recordedSegs = cur.segments.filter(function (s) { return s.key !== 'idle' && s.minutes > 0; });
    var items = recordedSegs.map(function (s) {
      return { label: s.label, value: s.minutes, color: s.color, key: s.key };
    });

    if (!items.length) {
      card.appendChild(V.empty(V.icons.chart, '这段时间还没有任何记录',
        '在「象限」里记录睡眠、饮食和活动，这里就会长出东西来。'));
      return card;
    }

    if (chartType === 'pie') {
      card.appendChild(V.chartPie(items, {
        centerTop: hmShort(cur.recorded), centerSub: '已记录', fmt: hmText
      }));
    } else {
      card.appendChild(V.chartBars(items, { fmt: hmShort, maxCols: 6 }));
    }
    // 两种图都给一份图例：饼图只靠悬停太隐蔽，方形图本身也不显示占比
    card.appendChild(legendOf(items, cur.recorded));
    return card;
  }

  /** 图例：色块 + 名称 + 时长 + 占比 */
  function legendOf(items, total) {
    var base = total || 1;
    var box = el('div', { class: 'cp-legend' });
    items.forEach(function (it) {
      box.appendChild(el('div', { class: 'cp-legend-row' }, [
        el('i', { style: { background: it.color } }),
        el('span', { class: 'cp-legend-name', text: it.label }),
        el('span', { class: 'cp-legend-val', text: hmText(it.value) }),
        el('span', { class: 'cp-legend-pct', text: Math.round(it.value / base * 100) + '%' })
      ]));
    });
    return box;
  }

  /* ==========================================================
   * 对比明细表
   * ========================================================== */
  function compareTable(st) {
    var keys = [
      { k: 'sleep', n: '睡眠' }, { k: 'course', n: '上课' },
      { k: 'event', n: '日程' }, { k: 'activity', n: '活动' }, { k: 'meal', n: '用餐' }
    ];
    var card = el('div', { class: 'card cp-chart-card' });
    card.appendChild(el('div', { class: 'section-title' }, ['和上一周期比']));

    var tbl = el('div', { class: 'cp-cmp-table' });
    tbl.appendChild(el('div', { class: 'cp-cmp-tr cp-cmp-th' }, [
      el('span', { text: '项目' }),
      el('span', { text: '本期日均' }),
      el('span', { text: '上期日均' }),
      el('span', { text: '差' })
    ]));
    keys.forEach(function (o) {
      var c = st.cmp[o.k];
      if (!c) return;
      var diff = c.diffPerDay;
      var flat = Math.abs(diff) < 1;
      tbl.appendChild(el('div', { class: 'cp-cmp-tr' }, [
        el('span', { text: o.n }),
        el('span', { text: hmText(c.curPerDay) }),
        el('span', { class: 'is-dim', text: hmText(c.prevPerDay) }),
        el('span', {
          class: 'is-diff' + (flat ? ' is-flat' : (diff > 0 ? ' is-up' : ' is-down')),
          text: flat ? '—' : (diff > 0 ? '+' : '−') + hmText(Math.abs(diff))
        })
      ]));
    });
    card.appendChild(tbl);
    card.appendChild(el('div', {
      class: 'cp-stats-note-inline',
      text: '只比日均。两段天数不同（比如 2 月和 3 月），比总量会把「多了一天」误读成「花得更多」。'
    }));
    return card;
  }

  /**
   * 热力等级 0–4。
   * 用**绝对刻度**（按一天记满 16 小时算满格）而不是「本次最大值归一化」：
   * 归一化的问题是各周都差不多时，全都会顶到最深一档，看着像「每周都记满了」。
   * 绝对刻度下颜色本身就是「这天记录得多不多」的信息，跨周期也稳定。
   */
  function heatLevel(perDayMin) {
    if (perDayMin <= 0) return 0;
    var ratio = perDayMin / (16 * 60);
    if (ratio < 0.2) return 1;
    if (ratio < 0.4) return 2;
    if (ratio < 0.65) return 3;
    return 4;
  }

  /* ==========================================================
   * 热力条
   *   跨度够长（>=2 周）→ 按周分组，一格一周
   *   跨度短（本周 / 今天）→ 按天分组，一格一天，否则只有一格没什么可看
   * 颜色一律按**日均**着色：首尾的不满周如果按总量算会显得特别浅，误导。
   * ========================================================== */
  function heatCard(st) {
    var card = el('div', { class: 'card cp-chart-card' });
    var days = st.cur.daily;
    var byMonth = days.length >= 120;   // 半年以上：一格一个月，52 个周格子挤在一起没法看
    var byWeek = !byMonth && days.length >= 14;

    card.appendChild(el('div', { class: 'section-title' }, [
      byMonth ? '每月记录了多少' : (byWeek ? '每周记录了多少' : '每天记录了多少')
    ]));

    var groups = [];
    if (byMonth) {
      var curM = null;
      days.forEach(function (d) {
        // d.d 是 Date 对象（不是字符串），别用 String() 拼键
        var mKey = d.d.getFullYear() + '-' + d.d.getMonth();
        if (!curM || curM.key !== mKey) {
          curM = { key: mKey, cells: [] };
          groups.push(curM);
        }
        curM.cells.push(d);
      });
      groups.forEach(function (g) {
        var d0 = g.cells[0].d;
        var full = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
        g.partial = g.cells.length < full;
      });
    } else if (byWeek) {
      var curW = null;
      days.forEach(function (d) {
        var dow = DateUtil.isoDow(d.d);
        if (!curW || dow === 1) { curW = { cells: [] }; groups.push(curW); }
        curW.cells.push(d);
      });
      if (groups.length && groups[0].cells.length < 7) groups[0].partial = true;
      if (groups.length > 1 && groups[groups.length - 1].cells.length < 7) {
        groups[groups.length - 1].partial = true;
      }
    } else {
      days.forEach(function (d) { groups.push({ cells: [d], partial: false }); });
    }

    groups.forEach(function (g) {
      var sum = g.cells.reduce(function (a, b) { return a + b.recorded; }, 0);
      g.perDay = sum / g.cells.length;
    });

    var strip = el('div', { class: 'cp-heat' + (byMonth ? ' cp-is-monthly' : (byWeek ? '' : ' cp-is-daily')) });
    groups.forEach(function (g, i) {
      var level = heatLevel(g.perDay);
      var label = byMonth ? (g.cells[0].d.getMonth() + 1) + ' 月'
        : (byWeek ? '第 ' + (i + 1) + ' 周' : md(g.cells[0].date));
      var tip = label + '：日均 ' + hmText(g.perDay) +
        (g.partial ? '（不完整周，只有 ' + g.cells.length + ' 天）' : '');
      strip.appendChild(el('div', {
        class: 'cp-heat-week cp-lv-' + level + (g.partial ? ' cp-is-partial' : ''),
        title: tip
      }, [
        el('b', { text: g.perDay > 0 ? Math.round(g.perDay / 60 * 10) / 10 + 'h' : '—' }),
        el('span', { text: byMonth ? g.cells.length + '天' : (byWeek ? g.cells.length + '天' : String(g.cells[0].d.getDate())) })
      ]));
    });
    card.appendChild(strip);

    // 一格代表什么，说清楚
    card.appendChild(el('div', {
      class: 'cp-stats-note-inline',
      text: byMonth
        ? '一格一个月，颜色深浅按这一个月的每天平均记录量算，刻度固定（一天记满 16 小时为最深）。' +
          '最后一个多月还没过完，用虚线框标出来。'
        : (byWeek
          ? '一格一周，颜色深浅按这一周的每天平均记录量算，刻度固定（一天记满 16 小时为最深）。' +
            '首尾两周天数不满 7 天，用虚线框标出来。'
          : '一格一天，颜色深浅按当天的记录量算，刻度固定（记满 16 小时为最深）。' +
            '跨度短的时候按周分组只剩一两格，看不出趋势，所以改成逐日。')
    }));

    if (byWeek && groups.length > 1 && groups[0].partial && groups[groups.length - 1].partial) {
      card.appendChild(el('div', {
        class: 'cp-stats-note-inline',
        text: '这段区间跨了 ' + groups.length + ' 个自然周，头尾都不满 7 天，中间几周才是完整的。'
      }));
    }
    return card;
  }

  /* ==========================================================
   * 每日记录量柱状
   * ========================================================== */
  function dailyCard(cur) {
    var card = el('div', { class: 'card cp-chart-card' });
    card.appendChild(el('div', { class: 'section-title' }, ['逐日记录量']));
    var daily = cur.daily.map(function (d) {
      return { date: d.date, d: d.d, value: Math.round(d.recorded / 60 * 10) / 10 };
    });
    card.appendChild(V.chartDaily(daily, {
      color: 'var(--primary)',
      activeDate: DateUtil.toStr(DateUtil.today()),
      fmt: function (v) { return v + 'h'; }
    }));
    return card;
  }

  /* ==========================================================
   * 入口：从别处调用（象限页「看统计」）
   * ========================================================== */
  global.heatLevel = heatLevel;

  global.openStats = function (key) {
    if (key && RANGES[key]) curRange = key;
    App.go('stats');
  };

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);
