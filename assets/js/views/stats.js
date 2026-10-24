
/* ==========================================================
 * 视图：统计与复盘（nav:false，从「象限 → 时间统计 → 看统计」进入）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /* 统计已不再是独立底部模块，改挂到「待办」页的「统计」分页 */
  var sHost = null;   // 当前宿主（任务页里的统计分页）

  /** 周期：今天 / 本周 / 本月 / 本学期（自然日历口径，见 store.js 的 RANGES） */
  var RANGE_KEYS = ['day', 'week', 'month', 'term', 'year'];
  var curRange = 'week';
  /** 图表类型：pie 饼状图 / bar 方形图 */
  var chartType = 'bar';
  /** 是否展开对比 */
  var showCompare = false;
  /** 积分曲线模式：daily 每日获得 / cumulative 累计 */
  var curveMode = 'daily';
  /** 热力图关联计划筛选：'all' 或具体 plan.id */
  var heatPlanId = 'all';

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

  /* 统计已不再是独立底部模块，改挂到「待办」页的「统计」分页 */
  var StatsPane = {
    render: function (host) { renderStats(host); }
  };

  function renderStats(host) {
    sHost = host;
    host.innerHTML = '';
    var root = host;
    var W = Store.settings.statsWidgets || { time: true, curve: true, sources: true };

      // 学业生活白皮书全景横幅
    var wpBanner = el('div', {
      style: {
        background: 'linear-gradient(135deg, var(--primary) 0%, #1e40af 100%)',
        color: '#fff',
        padding: '14px 18px',
        borderRadius: '10px',
        marginBottom: '14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
      }
    }, [
      el('div', {}, [
        el('div', { style: { fontWeight: 'bold', fontSize: '15px' }, text: '📊 学业生活全景白皮书' }),
        el('div', { style: { fontSize: '12px', opacity: 0.9, marginTop: '2px' }, text: '一键生成本学期学业GPA、作息健康、消费与心态综合总结长图' })
      ]),
      el('button', {
        class: 'btn',
        style: { background: '#ffffff', color: 'var(--primary)', fontWeight: 'bold', fontSize: '13px' },
        onclick: function () {
          if (global.WhitePaper) WhitePaper.openDialog();
        }
      }, ['生成白皮书'])
    ]);
    root.appendChild(wpBanner);

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
        V.rangeTabs(curRange, function (k) { curRange = k; StatsPane.render(sHost); }, RANGE_KEYS)
      ]);
      root.appendChild(bar);

      if (termNotStarted) {
        root.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.calendar, '本学期还没开始',
            '学期开始日是 ' + semStart + '，现在统计不到任何东西。可以在「设置 → 学期」里改一下开学日期。')
        ]));
        return;
      }

      if (W.time) {
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
          StatsPane.render(sHost);
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

      /* ---------- 计划 vs 实际偏差 ---------- */
      root.appendChild(planDeviationCard());

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
      } // end if statsWidgets.time

      /* ---------- 积分曲线 ---------- */
      if (W.curve) root.appendChild(pointCurveCard(curRange));

      /* ---------- 积分来源构成 ---------- */
      if (W.sources) root.appendChild(pointSourceCard());

      /* ---------- 消费构成 ---------- */
      if (W.spend) root.appendChild(spendCard(curRange));

      /* ---------- 课程投入 ---------- */
      if (W.course) root.appendChild(courseInvestCard(curRange));

      /* ---------- 睡眠与活动（健康看板没开就不占地方） ---------- */
      if (W.health !== false && (!Store.healthEnabled || Store.healthEnabled())) {
        root.appendChild(healthCard(curRange));
      }

  }

  /* ==========================================================
   * 睡眠与活动（健康数据进统计）
   * ----------------------------------------------------------
   * 只读 dayHealth 用到的两样底层数据（nightStats / getMetric），不调
   * dayHealth 本身 —— 它每条都要算 TDEE 和当日饮食，一学期上百天太浪费。
   * ========================================================== */
  function healthCard(rangeKey) {
    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
    card.appendChild(el('div', { class: 'section-title' }, ['睡眠与活动']));

    var r = rangeDates(rangeKey);
    var minH = (Store.settings.health && Store.settings.health.sleepMinH) || 6;
    var goal = Number(Store.settings.stepGoal) || 8000;

    var sleepN = 0, sleepSum = 0, qSum = 0, metN = 0;
    var stepSum = 0, stepN = 0, activeN = 0;

    for (var d = DateUtil.parse(r.from); d && DateUtil.toStr(d) <= r.to; d = DateUtil.addDays(d, 1)) {
      var ds = DateUtil.toStr(d);
      var st = Store.nightStats(ds);
      if (st && st.total) {
        sleepN++; sleepSum += st.total;
        if (st.q != null) qSum += st.q;
        if (st.total >= minH * 60) metN++;
      }
      var m = Store.getMetric(ds);
      if (m) {
        var s = Number(m.steps) || 0;
        stepN++; stepSum += s;
        if (s >= goal) activeN++;
      }
    }

    var ws = (Store.weightSeries ? Store.weightSeries() : [])
      .filter(function (w) { return w.date >= r.from && w.date <= r.to; });
    var wDelta = ws.length >= 2 ? Math.round((ws[ws.length - 1].kg - ws[0].kg) * 10) / 10 : null;

    if (!sleepN && !stepN && ws.length < 2) {
      card.appendChild(el('div', {
        style: { fontSize: '12px', color: 'var(--text-3)', lineHeight: '1.75' },
        text: '这个区间还没有睡眠 / 步数 / 体重数据。在「健康」页记录几次，或者让健康联动同步一下就会出现在这里。'
      }));
      return card;
    }

    var cells = [
      { label: '平均睡眠', value: sleepN ? hmShort(sleepSum / sleepN) : '—', color: '#6366f1' },
      { label: '睡眠达标夜', value: sleepN ? (metN + '/' + sleepN) : '—', color: 'var(--green)' },
      { label: '日均步数', value: stepN ? Math.round(stepSum / stepN).toLocaleString() : '—', color: 'var(--primary)' },
      { label: '体重变化', value: wDelta == null ? '—' : ((wDelta > 0 ? '+' : '') + wDelta + 'kg'),
        color: wDelta == null ? 'var(--text-2)' : (wDelta > 0 ? 'var(--red)' : 'var(--green)') }
    ];
    var grid = el('div', { class: 'cp-stat-grid' });
    cells.forEach(function (c) {
      grid.appendChild(el('div', { class: 'cp-stat-cell' }, [
        el('div', { class: 'cp-stat-label', text: c.label }),
        el('div', { class: 'cp-stat-value', style: { color: c.color }, text: c.value })
      ]));
    });
    card.appendChild(grid);

    var bits = [];
    if (sleepN) {
      var avgQ = qSum / sleepN;
      bits.push('平均睡眠质量 ' + Math.round(avgQ * 100) + '%');
      bits.push('达标线 ' + minH + ' 小时');
    }
    if (stepN) bits.push('步数达标 ' + activeN + ' 天（目标 ' + goal + ' 步）');
    if (ws.length >= 2) bits.push('体重 ' + ws[0].kg + ' → ' + ws[ws.length - 1].kg + ' kg');
    if (bits.length) {
      card.appendChild(el('div', {
        style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '10px', lineHeight: '1.7' },
        text: bits.join(' · ')
      }));
    }
    card.appendChild(el('div', {
      style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '4px', lineHeight: '1.7' },
      text: '睡眠按「醒来日」归到当天；只统计有记录的夜，没记的不算进分母，避免漏记被读成「睡得少」。'
    }));
    return card;
  }

  function segMinutes(segments, key) {
    for (var i = 0; i < segments.length; i++) if (segments[i].key === key) return segments[i].minutes;
    return 0;
  }

  /* ==========================================================
   * 积分曲线（每日获得 / 累计，可在分页内切换）
   * ========================================================== */
  function pointCurveCard(rangeKey) {
    var src = Store.pointSeries(rangeKey);
    var max = Math.max(1, src.reduce(function (m, d) { return Math.max(m, d.n); }, 0));
    var total = src.reduce(function (s, d) { return s + d.n; }, 0);
    var cum = 0;
    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
    card.appendChild(el('div', { class: 'section-title' }, [
      '积分曲线',
      el('div', { class: 'dim-tabs' }, [
        { v: 'daily', n: '每日获得' },
        { v: 'cumulative', n: '累计' }
      ].map(function (o) {
        return el('button', {
          class: 'dim-tab' + (curveMode === o.v ? ' active' : ''),
          text: o.n,
          onclick: function () { curveMode = o.v; StatsPane.render(sHost); }
        });
      }))
    ]));
    card.appendChild(el('div', {
      style: { fontSize: '12px', color: 'var(--text-3)', margin: '2px 0 10px' },
      text: '本区间共获得 ' + Math.round(total) + ' 积分'
    }));
    var chart = el('div', {
      style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '88px', marginTop: '4px' }
    });
    src.forEach(function (d) {
      cum += d.n;
      var val = curveMode === 'cumulative' ? cum : d.n;
      var barH = val > 0 ? Math.max(2, Math.round(val / max * 82)) : 0;
      chart.appendChild(el('div', {
        style: { flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
      }, [
        el('div', {
          style: {
            width: '100%', height: barH + 'px', borderRadius: '3px 3px 0 0',
            background: 'var(--primary)', opacity: val > 0 ? 1 : 0.15,
            title: md(d.date) + '：' + Math.round(val) + ' 分'
          }
        }),
        el('div', { style: { fontSize: '9px', color: 'var(--text-3)', marginTop: '2px' }, text: md(d.date).split('/')[1] || '' })
      ]));
    });
    card.appendChild(chart);
    if (total === 0) {
      card.appendChild(el('div', {
        style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '8px' },
        text: '这个区间还没有积分记录（积分流水从升级当天开始统计）。'
      }));
    }
    return card;
  }

  /* ==========================================================
   * 积分来源构成（各渠道累计）
   * ========================================================== */
  var SRC_LABELS = {
    focus: '专注', task: '完成待办', plan: '计划', goal: '目标 / KR',
    ach: '成就', sleep: '睡眠', meal: '饮食', activity: '活动', card: '月卡', other: '其他'
  };
  var SRC_ORDER = ['focus', 'task', 'plan', 'goal', 'ach', 'sleep', 'meal', 'activity', 'card', 'other'];

  /* ==========================================================
   * 消费构成（账本 → 统计）：每日支出小柱 + 分类构成
   * ========================================================== */
  function spendCard(rangeKey) {
    var b = Store.ledgerBreakdown(rangeKey, 'expense');
    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
    card.appendChild(el('div', { class: 'section-title' }, ['消费构成']));
    card.appendChild(el('div', {
      style: { fontSize: '12px', color: 'var(--text-3)', margin: '2px 0 10px' },
      text: '本区间支出 ¥' + b.total
    }));
    if (!b.total) {
      card.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-3)' }, text: '这个区间还没有支出记录。' }));
      return card;
    }
    // 每日支出小柱（日期序列借 pointSeries 的有序日期）
    var dates = Store.pointSeries(rangeKey).map(function (x) { return x.date; });
    var maxDay = Math.max(1, dates.reduce(function (m, d) { return Math.max(m, b.daily[d] || 0); }, 0));
    var chart = el('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '64px', marginBottom: '10px' } });
    dates.forEach(function (d) {
      var v = b.daily[d] || 0;
      var h = v > 0 ? Math.max(2, Math.round(v / maxDay * 58)) : 0;
      chart.appendChild(el('div', { style: { flex: '1 1 0', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', height: '100%' } }, [
        el('div', { style: { width: '100%', height: h + 'px', background: 'var(--amber)', borderRadius: '3px 3px 0 0', opacity: v > 0 ? 1 : 0.12 },
          title: md(d) + '：¥' + v })
      ]));
    });
    card.appendChild(chart);
    // 分类构成
    var cats = (global.LEDGER_CATS && LEDGER_CATS.expense) || [];
    cats.forEach(function (c) {
      var amt = b.byCategory[c.key] || 0;
      if (!amt) return;
      var pct = Math.round(amt / b.total * 100);
      card.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' } }, [
        el('span', { style: { width: '48px', fontSize: '12px', color: 'var(--text-2)' }, text: c.name }),
        el('div', { style: { flex: '1', height: '8px', background: 'var(--bg-2)', borderRadius: '4px', overflow: 'hidden' } }, [
          el('div', { style: { width: pct + '%', height: '100%', background: c.color } })
        ]),
        el('span', { style: { width: '84px', textAlign: 'right', fontSize: '12px', color: 'var(--text-2)' },
          text: '¥' + Math.round(amt) + ' · ' + pct + '%' })
      ]));
    });
    return card;
  }

  /* ==========================================================
   * 课程投入（时间记录 → 按课程汇总）
   * ========================================================== */
  function courseInvestCard(rangeKey) {
    var map = Store.courseInvest(rangeKey);
    var keys = Object.keys(map);
    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
    card.appendChild(el('div', { class: 'section-title' }, ['课程投入']));
    if (!keys.length) {
      card.appendChild(el('div', {
        style: { fontSize: '12px', color: 'var(--text-3)', lineHeight: '1.7' },
        text: '这段时间还没有关联课程的时间记录。记录活动时选一门课，或专注时关联到挂课的待办。'
      }));
      return card;
    }
    keys.sort(function (a, b) { return map[b] - map[a]; });
    var total = keys.reduce(function (s, k) { return s + map[k]; }, 0);
    card.appendChild(el('div', {
      style: { fontSize: '12px', color: 'var(--text-3)', margin: '2px 0 10px' },
      text: '合计 ' + hmText(total)
    }));
    var max = map[keys[0]] || 1;
    keys.slice(0, 8).forEach(function (k) {
      var mins = map[k];
      var pct = Math.round(mins / max * 100);
      card.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' } }, [
        el('span', { style: { width: '84px', fontSize: '12px', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: k }),
        el('div', { style: { flex: '1', height: '8px', background: 'var(--bg-2)', borderRadius: '4px', overflow: 'hidden' } }, [
          el('div', { style: { width: pct + '%', height: '100%', background: 'var(--primary)' } })
        ]),
        el('span', { style: { width: '72px', textAlign: 'right', fontSize: '12px', color: 'var(--text-2)' }, text: hmShort(mins) })
      ]));
    });
    return card;
  }

  function pointSourceCard() {
    var map = Store.pointSources();
    var total = 0;
    SRC_ORDER.forEach(function (k) { if (map[k]) total += map[k]; });
    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
    card.appendChild(el('div', { class: 'section-title' }, ['积分来源']));
    card.appendChild(el('div', {
      style: { fontSize: '12px', color: 'var(--text-3)', margin: '2px 0 10px' },
      text: '累计获得 ' + Math.round(Store.pomodoro.earned) + ' 积分（按行为计，不含合成玉折算）'
    }));
    if (!total) {
      card.appendChild(el('div', {
        style: { fontSize: '12px', color: 'var(--text-3)' },
        text: '还没有任何积分记录。'
      }));
      return card;
    }
    SRC_ORDER.forEach(function (k) {
      if (!map[k]) return;
      var pct = total ? Math.round(map[k] / total * 100) : 0;
      card.appendChild(el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' }
      }, [
        el('span', { style: { width: '64px', fontSize: '12px', color: 'var(--text-2)' }, text: SRC_LABELS[k] || k }),
        el('div', { style: { flex: '1', height: '8px', background: 'var(--bg-2)', borderRadius: '4px', overflow: 'hidden' } }, [
          el('div', { style: { width: pct + '%', height: '100%', background: 'var(--primary)' } })
        ]),
        el('span', { style: { width: '96px', textAlign: 'right', fontSize: '12px', color: 'var(--text-2)' },
          text: Math.round(map[k]) + ' · ' + pct + '%' })
      ]));
    });
    return card;
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
        onclick: function () { chartType = o.v; StatsPane.render(sHost); }
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
  /* ==========================================================
   * 计划 vs 实际偏差
   * ----------------------------------------------------------
   * 复用 Store.planProgress 的 target（计划量）与 value（实际量）。
   * 复盘时真正有用的往往不是「完成率 78%」这种漂亮数字，
   * 而是「还差 5 次」这种缺口，所以这里把差值直接摆出来，按差距大到小排。
   * ========================================================== */
  function planDeviationCard() {
    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginBottom: '14px' } });
    card.appendChild(el('div', { class: 'section-title' }, ['计划 vs 实际']));

    var plans = (Store.state.plans || []).filter(function (p) { return p && p.target > 0; });
    if (!plans.length) {
      card.appendChild(el('div', {
        style: { fontSize: '12px', color: 'var(--text-3)' },
        text: '还没有带目标的计划。建一个打卡或累加型计划，这里就能看到它差多少。'
      }));
      return card;
    }

    var rows = plans.map(function (p) {
      var pg = Store.planProgress(p);
      return { p: p, plan: pg.target, actual: pg.value, diff: pg.value - pg.target, pct: pg.pct };
    }).sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });   // 差距最大的在前

    var sumPlan = 0, sumActual = 0;
    rows.forEach(function (r) { sumPlan += r.plan; sumActual += r.actual; });
    var sumDiff = sumActual - sumPlan;
    var sumPct = sumPlan ? Math.round(sumActual / sumPlan * 100) : 0;

    card.appendChild(el('div', {
      style: { fontSize: '12px', color: 'var(--text-3)', margin: '2px 0 10px' },
      text: '合计 计划 ' + sumPlan + ' / 实际 ' + sumActual +
            '（' + (sumDiff >= 0 ? '+' : '') + sumDiff + '，达成 ' + sumPct + '%）'
    }));

    rows.forEach(function (r) {
      var over = r.diff >= 0;
      card.appendChild(el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0',
          borderTop: '1px solid rgba(128,128,128,0.18)'
        }
      }, [
        el('div', { style: { flex: '1', minWidth: '0' } }, [
          el('div', {
            style: { fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            text: r.p.title
          }),
          el('div', {
            style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' },
            text: '计划 ' + r.plan + ' · 实际 ' + r.actual
          })
        ]),
        el('span', {
          class: 'chip',
          style: { color: over ? '#10b981' : '#ef4444', flex: 'none' },
          text: (over ? '+' : '') + r.diff + '（' + r.pct + '%）'
        })
      ]));
    });
    return card;
  }

  function heatCard(st) {
    var card = el('div', { class: 'card cp-chart-card' });
    var allPlans = (Store.state.plans || []).filter(function (p) { return p && p.id; });
    var activePlan = heatPlanId !== 'all' ? allPlans.filter(function (p) { return p.id === heatPlanId; })[0] : null;
    if (heatPlanId !== 'all' && !activePlan) heatPlanId = 'all';

    var planRecMap = {};
    if (activePlan && Array.isArray(activePlan.records)) {
      activePlan.records.forEach(function (rec) {
        if (!rec || !rec.date) return;
        planRecMap[rec.date] = (planRecMap[rec.date] || 0) + (Number(rec.value) || 1);
      });
    }

    var days = st.cur.daily.map(function (d) {
      if (!activePlan) return d;
      var val = planRecMap[d.date] || 0;
      // 映射到热力刻度分钟当量（有打卡至少 1 级，按计划单日均值或固定梯度着色）
      var eqMin = val <= 0 ? 0 : (activePlan.type === 'checkin' ? 16 * 60 : Math.min(16 * 60, Math.max(200, val * 12)));
      return { date: d.date, d: d.d, recorded: eqMin, planVal: val };
    });

    var byMonth = days.length >= 120;   // 半年以上：一格一个月，52 个周格子挤在一起没法看
    var byWeek = !byMonth && days.length >= 14;

    var headEl = el('div', { class: 'section-title', style: { flexWrap: 'wrap', gap: '6px' } }, [
      byMonth ? '每月记录了多少' : (byWeek ? '每周记录了多少' : '每天记录了多少')
    ]);
    if (allPlans.length) {
      var tabs = [{ id: 'all', title: '全部记录' }].concat(allPlans.slice(0, 4).map(function (p) {
        return { id: p.id, title: '🎯 ' + (p.title || '计划').slice(0, 8) };
      }));
      headEl.appendChild(el('div', { class: 'dim-tabs' }, tabs.map(function (t) {
        return el('button', {
          class: 'dim-tab' + (heatPlanId === t.id ? ' active' : ''),
          text: t.title,
          onclick: function () { heatPlanId = t.id; StatsPane.render(sHost); }
        });
      })));
    }
    card.appendChild(headEl);

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

  global.StatsPane = StatsPane;
})(window);
