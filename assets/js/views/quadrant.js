

/* ==========================================================
 * 视图：象限（全天 24 小时时间去向）
 * ========================================================== */
(function (global) {
  'use strict';

  /* 统计卡的状态：范围与图表类型 */
  var qRange = 'week';
  var qChart = 'pie';

  var V = UI;
  var el = V.el;

  var COLOR = {
    sleep: '#6366f1',
    course: '#f59e0b',
    event: '#ec4899',
    activity: '#10b981',
    meal: '#ef4444',
    idle: '#e9ebf2'
  };

  var view = {
    id: 'quadrant',
    name: '象限',
    icon: V.icons.quadrant,
    title: '时间去向',
    order: 17,
    nav: true,

    root: null,
    date: null,   // 'YYYY-MM-DD'

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'icon-btn', title: '记录设置',
        onclick: function () { SettingsDialog.open(); }
      }, [V.svg(V.icons.settings, 18)]));

      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () { openQuickAdd(); }
      }, [V.svg(V.icons.plus, 16), '记一笔']));
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-quadrant' });
      host.appendChild(this.root);
      if (!this.date) this.date = DateUtil.toStr(DateUtil.today());
      this.render();
      return this.root;
    },

    onEnter: function () {
      if (!this.date) this.date = DateUtil.toStr(DateUtil.today());
      this.render();
    },

    shiftDay: function (n) {
      var d = DateUtil.parse(this.date) || DateUtil.today();
      var next = DateUtil.addDays(d, n);
      if (DateUtil.diffDays(next, DateUtil.today()) > 0) {
        UI.toast('不能记录未来的时间去向');
        return;
      }
      this.date = DateUtil.toStr(next);
      this.render();
    },

    render: function () {
      var self = this;
      var root = this.root;
      root.innerHTML = '';

      var dateStr = this.date;
      var date = DateUtil.parse(dateStr) || DateUtil.today();
      var stat = Store.dayStat(dateStr);
      var isToday = dateStr === DateUtil.toStr(DateUtil.today());

      /* ================= 日期栏 ================= */
      var dateBar = el('div', { class: 'week-bar', style: { marginBottom: '12px' } }, [
        el('div', { class: 'week-nav' }, [
          el('button', { class: 'icon-btn', onclick: function () { self.shiftDay(-1); } }, [V.svg(V.icons.left)]),
          el('div', { class: 'week-label' }, [
            el('span', { text: (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日' }),
            el('small', { text: DateUtil.weekdayCN(date) + (isToday ? ' · 今天' : '') })
          ]),
          el('button', {
            class: 'icon-btn',
            style: isToday ? { opacity: '.35' } : {},
            onclick: function () { self.shiftDay(1); }
          }, [V.svg(V.icons.right)])
        ]),
        el('div', { class: 'week-meta' }, [
          !isToday ? el('button', {
            class: 'btn btn-sm', onclick: function () { self.date = DateUtil.toStr(DateUtil.today()); self.render(); }
          }, ['回到今天']) : null
        ])
      ]);
      root.appendChild(dateBar);

      /* ================= 环形时钟 ================= */
      var blocks = collectBlocks(dateStr);
      var recorded = 1440 - stat.idle;
      var percent = Math.round(recorded / 1440 * 100);

      var ringCard = el('div', { class: 'card ring-card' });
      ringCard.appendChild(ringSVG(blocks, percent, TimeUtil.humanMin(recorded)));
      ringCard.appendChild(legend(stat.segments, stat.idle));
      var leftCol = el('div', { class: 'quad-left' }, [ringCard, chartCard()]);
      var rightCol = el('div', { class: 'quad-right' });

      /* ================= 睡眠 ================= */
      if (Store.settings.trackSleep) {
        rightCol.appendChild(self.sleepCard(dateStr));
      }

      /* ================= 饮食 ================= */
      if (Store.settings.trackMeal) {
        rightCol.appendChild(self.mealCard(dateStr));
      }

      /* ================= 活动 ================= */
      rightCol.appendChild(self.activityCard(dateStr));

      /* ================= 课程 ================= */
      if (stat.courses.length) {
        var cbox = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });
        cbox.appendChild(el('div', { class: 'section-title' }, [
          '上课',
          el('span', { class: 'q-count', text: TimeUtil.humanMin(segMinutes(stat.segments, 'course')) })
        ]));
        stat.courses.forEach(function (c) {
          var t = Store.courseTime(c);
          cbox.appendChild(el('div', { class: 'rec-row', style: { cursor: 'pointer' },
            onclick: function () { global.__CourseDialog.detail(c.id); } }, [
            el('i', { class: 'rec-dot', style: { background: c.color } }),
            el('span', { class: 'rec-main' }, [
              el('b', { text: c.name }),
              el('span', { text: [t ? t.start + '–' + t.end : '', c.location].filter(Boolean).join(' · ') })
            ]),
            el('span', { class: 'rec-val', text: t ? TimeUtil.humanMin(TimeUtil.diffMin(t.start, t.end)) : '' })
          ]));
        });
        rightCol.appendChild(cbox);
      }

      /* ================= 说明 ================= */
      root.appendChild(el('div', { class: 'quad-cols' }, [leftCol, rightCol]));

      root.appendChild(el('div', {
        style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '14px', lineHeight: '1.7' }
      }, ['课程来自课程表自动统计；睡眠与用餐按类型估算时长；未记录的时段显示为浅灰色。']));
    },

    /* ---------- 睡眠卡 ---------- */
    sleepCard: function (dateStr) {
      var self = this;
      var list = Store.sleepsOf(dateStr);
      var total = Store.sleepMinutes(dateStr);
      var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });

      card.appendChild(el('div', { class: 'section-title' }, [
        V.svg(V.icons.moon, 16),
        '睡眠',
        el('span', { class: 'q-count', text: total ? TimeUtil.humanMin(total) : '未记录' }),
        el('button', {
          class: 'btn btn-sm', style: { marginLeft: 'auto' },
          onclick: function () { SleepDialog.open(dateStr); }
        }, ['记录'])
      ]));

      if (!list.length) {
        card.appendChild(el('div', { class: 'q-empty', text: '还没有记录睡眠，点右侧「记录」填写入睡和醒来时间。' }));
        return card;
      }

      // 跨午夜说明：这里的总时长是「实际落在这天内的时间」，不是那一觉的总长
      var crosses = list.some(function (r) {
        return TimeUtil.toMin(r.end) <= TimeUtil.toMin(r.start);   // 醒来时间不晚于入睡 = 跨了午夜
      });
      if (crosses) {
        card.appendChild(el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', margin: '2px 0 8px', lineHeight: '1.6' },
          text: '睡眠按实际时刻归属：23:00 睡、7:00 醒，昨天算 1 小时、今天算 7 小时，' +
                '所以这里显示的不是一觉的总长度。想看整晚总长请点开单条记录。'
        }));
      }

      list.forEach(function (r) {
        var dur = TimeUtil.diffMin(r.start, r.end);
        var qText = { good: '睡得好', normal: '一般', bad: '没睡好' }[r.quality] || '一般';
        card.appendChild(el('div', { class: 'rec-row', onclick: function () { SleepDialog.open(dateStr, r.id); } }, [
          el('i', { class: 'rec-dot', style: { background: COLOR.sleep } }),
          el('span', { class: 'rec-main' }, [
            el('b', { text: r.start + ' → ' + r.end }),
            el('span', { text: (r.note || qText) + (r.note ? ' · ' + qText : '') })
          ]),
          el('span', { class: 'rec-val', text: TimeUtil.humanMin(dur) })
        ]));
      });
      return card;
    },

    /* ---------- 饮食卡 ---------- */
    mealCard: function (dateStr) {
      var list = Store.mealsOf(dateStr);
      var sum = Store.mealSummary(dateStr);
      var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });

      card.appendChild(el('div', { class: 'section-title' }, [
        V.svg(V.icons.food, 16),
        '饮食',
        el('span', { class: 'q-count', text: list.length ? (list.length + ' 餐 · ¥' + sum.cost + ' · ' + sum.kcal + ' kcal') : '未记录' }),
        el('button', {
          class: 'btn btn-sm', style: { marginLeft: 'auto' },
          onclick: function () { MealDialog.open(dateStr); }
        }, ['记录'])
      ]));

      if (!list.length) {
        card.appendChild(el('div', { class: 'q-empty', text: '记录吃了什么、花了多少钱，并估算热量。' }));
        return card;
      }

      list.forEach(function (m) {
        var t = mealType(m.type);
        card.appendChild(el('div', { class: 'rec-row', onclick: function () { MealDialog.open(dateStr, m.id); } }, [
          el('i', { class: 'rec-dot', style: { background: COLOR.meal, opacity: '.55' } }),
          el('span', { class: 'rec-main' }, [
            el('b', { text: t.label + (m.content ? ' · ' + m.content : '') }),
            el('span', { text: m.time + (m.note ? ' · ' + m.note : '') })
          ]),
          el('span', { class: 'rec-val' }, [
            m.kcal ? el('em', { text: m.kcal + ' kcal' }) : null,
            m.cost ? el('em', { style: { color: 'var(--text-3)', fontWeight: '400' }, text: '¥' + m.cost }) : null
          ])
        ]));
      });

      if (list.length > 1 && (sum.kcal || sum.cost)) {
        card.appendChild(el('div', { class: 'rec-foot', text: '合计消费 ¥' + sum.cost + ' · 摄入约 ' + sum.kcal + ' 千卡' }));
      }

      /* ---- 热量目标进度 ---- */
      var diet = Store.dayDiet(dateStr);
      var goal = Number(Store.dietConfig().goal) || 0;
      if (goal) {
        var pct = Math.min(100, Math.round(diet.kcal / goal * 100));
        var left = Math.round(goal - diet.kcal);
        var over = left < 0;
        card.appendChild(el('div', { class: 'diet-progress' }, [
          el('div', { class: 'dp-head' }, [
            el('b', { text: Math.round(diet.kcal) + ' / ' + goal }),
            el('span', { text: over ? ('超出 ' + Math.abs(left) + ' 千卡') : ('还剩 ' + left + ' 千卡') }),
            over ? null : el('em', { text: pct + '%' })
          ]),
          el('div', { class: 'dp-bar' }, [
            el('i', { style: { width: pct + '%', background: over ? 'var(--red)' : 'var(--green)' } })
          ]),
          el('div', { class: 'dp-go' }, [
            el('button', {
              class: 'dp-link',
              onclick: function (e) {
                e.stopPropagation();
                App.go('settings');
                setTimeout(function () { if (global.SettingsView) SettingsView.go('diet'); }, 60);
              }
            }, ['改目标 →'])
          ])
        ]));
      }

      /* ---- 三大营养素 ---- */
      if (diet.kcal > 0) {
        var dcfg = Store.dietConfig();
        var macros = [
          { k: 'p', l: '蛋白', v: diet.p, goal: Number(dcfg.protein) || 0, cls: 'm-p' },
          { k: 'f', l: '脂肪', v: diet.f, goal: Number(dcfg.fat) || 0, cls: 'm-f' },
          { k: 'c', l: '碳水', v: diet.c, goal: Number(dcfg.carb) || 0, cls: 'm-c' }
        ];
        var box = el('div', { class: 'dp-macros' });
        macros.forEach(function (x) {
          box.appendChild(el('span', { class: 'macro ' + x.cls }, [
            x.l + ' ' + Math.round(x.v) + 'g' + (x.goal ? ' / ' + x.goal + 'g' : '')
          ]));
        });
        card.appendChild(box);
      }
      return card;
    },

    /* ---------- 活动卡 ---------- */
    activityCard: function (dateStr) {
      var list = Store.activitiesOf(dateStr);
      var total = 0;
      list.forEach(function (a) { total += TimeUtil.diffMin(a.start, a.end); });

      var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });
      card.appendChild(el('div', { class: 'section-title' }, [
        '活动记录',
        el('span', { class: 'q-count', text: list.length ? TimeUtil.humanMin(total) : '未记录' }),
        el('button', {
          class: 'btn btn-sm', style: { marginLeft: 'auto' },
          onclick: function () { ActivityDialog.open(dateStr); }
        }, ['记录'])
      ]));

      if (!list.length) {
        card.appendChild(el('div', { class: 'q-empty', text: '除了上课，时间都去哪儿了？记录自习、运动、娱乐等时间段。' }));
        return card;
      }

      list.forEach(function (a) {
        var t = actType(a.type);
        card.appendChild(el('div', { class: 'rec-row', onclick: function () { ActivityDialog.open(dateStr, a.id); } }, [
          el('i', { class: 'rec-dot', style: { background: t.color } }),
          el('span', { class: 'rec-main' }, [
            el('b', { text: a.name }),
            el('span', {
              text: [a.start + '–' + a.end, t.label,
                (a.tags && a.tags.length) ? a.tags.join(' / ') : '', a.note].filter(Boolean).join(' · ')
            })
          ]),
          el('span', { class: 'rec-val', text: TimeUtil.humanMin(TimeUtil.diffMin(a.start, a.end)) })
        ]));
      });
      return card;
    }
  };

  /* ==========================================================
   * 时间统计卡：范围 × 图表
   * ========================================================== */
  function hmText(min) {
    var h = Math.floor(min / 60), m = min % 60;
    if (h <= 0) return m + ' 分';
    return h + ' 小时 ' + (m ? m + ' 分' : '');
  }

  function hmShort(min) {
    if (min < 60) return Math.round(min) + 'm';
    var h = min / 60;
    return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
  }

  function chartCard() {
    var r = rangeDates(qRange);
    var st = Store.rangeStat(r.from, r.to);

    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });

    var head = el('div', { class: 'section-title' }, ['时间统计']);
    head.appendChild(V.rangeTabs(qRange, function (k) { qRange = k; rerender(); }));
    card.appendChild(head);
    card.appendChild(el('button', {
      class: 'cp-stats-more',
      onclick: function () { App.go('stats'); }
    }, ['看统计与复盘 →']));

    card.appendChild(el('div', {
      style: { fontSize: '11.5px', color: 'var(--text-3)', marginBottom: '10px' },
      text: r.from.slice(5) + ' – ' + r.to.slice(5) +
        ' · 共 ' + st.days + ' 天 · 已记录 ' + hmText(st.recorded)
    }));

    var tabs = el('div', { class: 'dim-tabs', style: { marginBottom: '12px' } }, [
      { v: 'pie', n: '饼状图' },
      { v: 'bar', n: '方形图' }
    ].map(function (o) {
      return el('button', {
        class: 'dim-tab' + (qChart === o.v ? ' active' : ''),
        text: o.n,
        onclick: function () { qChart = o.v; rerender(); }
      });
    }));
    card.appendChild(tabs);

    // 饼图只看「已记录」的构成；未记录单独说明，避免大面积灰色
    var recordedSegs = st.segments.filter(function (seg) { return seg.key !== 'idle' && seg.minutes > 0; });
    var items = recordedSegs.map(function (seg) {
      return { label: seg.label, value: seg.minutes, color: seg.color, key: seg.key };
    });
    var idleSeg = st.segments.filter(function (seg) { return seg.key === 'idle'; })[0];

    if (qChart === 'pie') {
      card.appendChild(V.chartPie(items, {
        centerTop: hmShort(st.recorded),
        centerSub: '已记录',
        fmt: hmText
      }));
      if (idleSeg && idleSeg.minutes > 0) {
        card.appendChild(el('div', {
          style: { fontSize: '11.5px', color: 'var(--text-3)', textAlign: 'center', marginTop: '-6px' },
          text: '另有 ' + hmText(idleSeg.minutes) + ' 未记录（占区间 ' + st.pct + '% 已记录）'
        }));
      }
    } else {
      card.appendChild(V.chartBars(items, { fmt: hmShort }));
      // 多日范围：额外给一张每日趋势
      if (r.days > 1) {
        card.appendChild(el('div', {
          style: { fontSize: '12px', fontWeight: '600', margin: '14px 0 6px' },
          text: '每天记录量'
        }));
        var daily = st.daily.map(function (d) {
          return { date: d.date, d: d.d, value: Math.round(d.recorded / 60) };
        });
        card.appendChild(V.chartDaily(daily, {
          color: 'var(--primary)',
          activeDate: DateUtil.toStr(DateUtil.today()),
          fmt: function (v) { return v + 'h'; }
        }));
      }
    }
    return card;
  }

  function rerender() {
    var v = App.views.filter(function (x) { return x.id === 'quadrant'; })[0];
    if (v && App.currentId === 'quadrant') v.render();
  }

  /* ==========================================================
   * 工具
   * ========================================================== */
  function segMinutes(segments, key) {
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].key === key) return segments[i].minutes;
    }
    return 0;
  }

  /** 收集当天所有时间段（用于环形时钟），已拆跨午夜 */
  function collectBlocks(dateStr) {
    var d = DateUtil.parse(dateStr) || DateUtil.today();
    var out = [];

    if (Store.settings.trackSleep) {
      Store.sleepsOf(dateStr).forEach(function (r) {
        TimeUtil.expand(r.start, r.end).forEach(function (p) {
          out.push({ s: p[0], e: p[1], color: COLOR.sleep });
        });
      });
    }

    if (Store.settings.trackMeal) {
      Store.mealsOf(dateStr).forEach(function (m) {
        var dur = mealType(m.type).min;
        TimeUtil.expand(m.time, TimeUtil.addMin(m.time, dur)).forEach(function (p) {
          out.push({ s: p[0], e: p[1], color: COLOR.meal });
        });
      });
    }

    Store.coursesOnDate(DateUtil.toStr(d)).forEach(function (c) {
      var t = Store.courseTime(c);
      if (!t) return;
      TimeUtil.expand(t.start, t.end).forEach(function (x) {
        out.push({ s: x[0], e: x[1], color: COLOR.course });
      });
    });

    Store.eventsOf(dateStr).forEach(function (e) {
      TimeUtil.expand(e.start, e.end).forEach(function (x) {
        out.push({ s: x[0], e: x[1], color: COLOR.event });
      });
    });

    Store.activitiesOf(dateStr).forEach(function (a) {
      TimeUtil.expand(a.start, a.end).forEach(function (x) {
        out.push({ s: x[0], e: x[1], color: COLOR.activity });
      });
    });

    return out;
  }

  /** 24 小时环形时钟 */
  function ringSVG(blocks, percent, recordedText) {
    var SIZE = 248, R = 96, SW = 20;
    var C = 2 * Math.PI * R;
    var NS = 'http://www.w3.org/2000/svg';

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + SIZE + ' ' + SIZE);
    svg.setAttribute('class', 'cp-ring-svg');

    // 底环
    var base = document.createElementNS(NS, 'circle');
    base.setAttribute('cx', SIZE / 2); base.setAttribute('cy', SIZE / 2);
    base.setAttribute('r', R);
    base.setAttribute('fill', 'none');
    base.setAttribute('stroke', COLOR.idle);
    base.setAttribute('stroke-width', SW);
    svg.appendChild(base);

    // 刻度：每 3 小时一格
    for (var h = 0; h <= 24; h += 3) {
      var ang = (h / 24) * Math.PI * 2 - Math.PI / 2;
      var r1 = R + SW / 2 + 3, r2 = R + SW / 2 + (h % 6 === 0 ? 9 : 5);
      var line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', SIZE / 2 + Math.cos(ang) * r1);
      line.setAttribute('y1', SIZE / 2 + Math.sin(ang) * r1);
      line.setAttribute('x2', SIZE / 2 + Math.cos(ang) * r2);
      line.setAttribute('y2', SIZE / 2 + Math.sin(ang) * r2);
      line.setAttribute('stroke', 'var(--line-strong)');
      line.setAttribute('stroke-width', '1.5');
      svg.appendChild(line);
    }

    // 各时间段
    blocks.forEach(function (b) {
      var len = Math.max(0.4, (b.e - b.s) / 1440 * C);
      var circ = document.createElementNS(NS, 'circle');
      circ.setAttribute('cx', SIZE / 2); circ.setAttribute('cy', SIZE / 2);
      circ.setAttribute('r', R);
      circ.setAttribute('fill', 'none');
      circ.setAttribute('stroke', b.color);
      circ.setAttribute('stroke-width', SW);
      circ.setAttribute('stroke-linecap', 'butt');
      circ.setAttribute('stroke-dasharray', len.toFixed(2) + ' ' + (C - len).toFixed(2));
      circ.setAttribute('stroke-dashoffset', (-((b.s / 1440) * C)).toFixed(2));
      circ.setAttribute('transform', 'rotate(-90 ' + (SIZE / 2) + ' ' + (SIZE / 2) + ')');
      svg.appendChild(circ);
    });

    // 中心文字
    var wrap = el('div', { class: 'ring-wrap' }, [svg]);
    var center = el('div', { class: 'ring-center' }, [
      el('span', { class: 'ring-pct', text: percent + '%' }),
      el('span', { class: 'ring-sub', text: '已记录 ' + recordedText })
    ]);
    wrap.appendChild(center);

    // 12 / 6 / 18 / 24 点标记
    [
      { a: 0, t: '0' }, { a: 6, t: '6' }, { a: 12, t: '12' }, { a: 18, t: '18' }
    ].forEach(function (m) {
      var ang = (m.a / 24) * Math.PI * 2 - Math.PI / 2;
      var rad = R + SW / 2 + 20;
      var lab = el('span', {
        class: 'ring-tick',
        text: m.t,
        style: {
          left: (49 + Math.cos(ang) * (rad / SIZE * 100)) + '%',
          top: (50 + Math.sin(ang) * (rad / SIZE * 100)) + '%'
        }
      });
      wrap.appendChild(lab);
    });

    return wrap;
  }

  /** 图例 */
  function legend(segments, idle) {
    var box = el('div', { class: 'ring-legend' });
    segments.forEach(function (s) {
      if (s.key === 'idle') return;
      if (!s.minutes) return;
      var pct = Math.round(s.minutes / 1440 * 1000) / 10;
      box.appendChild(el('div', { class: 'lg-item' }, [
        el('i', { class: 'lg-dot', style: { background: s.color } }),
        el('span', { class: 'lg-label', text: s.label }),
        el('b', { class: 'lg-val', text: TimeUtil.humanMin(s.minutes) }),
        el('em', { class: 'lg-pct', text: pct + '%' })
      ]));
    });
    var idlePct = Math.round(idle / 1440 * 1000) / 10;
    box.appendChild(el('div', { class: 'lg-item is-idle' }, [
      el('i', { class: 'lg-dot', style: { background: COLOR.idle } }),
      el('span', { class: 'lg-label', text: '未记录' }),
      el('b', { class: 'lg-val', text: TimeUtil.humanMin(idle) }),
      el('em', { class: 'lg-pct', text: idlePct + '%' })
    ]));
    return box;
  }

  /* ==========================================================
   * 快捷添加
   * ========================================================== */
  function openQuickAdd() {
    var dateStr = view.date;
    var m;
    var body = el('div', { style: { display: 'grid', gap: '9px' } }, [
      quickBtn('活动记录', '自习、运动、娱乐等时间段', function () { m.close(); setTimeout(function () { ActivityDialog.open(dateStr); }, 180); }),
      Store.settings.trackSleep ? quickBtn('睡眠', '入睡与醒来时间', function () { m.close(); setTimeout(function () { SleepDialog.open(dateStr); }, 180); }) : null,
      Store.settings.trackMeal ? quickBtn('饮食', '吃了什么 · 消费 · 卡路里', function () { m.close(); setTimeout(function () { MealDialog.open(dateStr); }, 180); }) : null,
      quickBtn('一次性日程', '班会、讲座、约饭等将来安排', function () { m.close(); setTimeout(function () { global.EventDialog.open(null, { date: dateStr }); }, 180); })
    ]);
    m = V.modal({ title: '记一笔', body: body });
  }

  function quickBtn(title, sub, fn) {
    return el('button', {
      class: 'quick-row', onclick: fn
    }, [
      el('span', { class: 'quick-main' }, [
        el('b', { text: title }),
        el('span', { text: sub })
      ]),
      V.svg(V.icons.right, 18)
    ]);
  }

  /* ==========================================================
   * 睡眠记录弹窗
   * ========================================================== */
  var SleepDialog = {
    open: function (dateStr, id) {
      var isEdit = !!id;
      var r = id ? Store.getSleep(id) : null;
      var quality = r ? r.quality : 'normal';

      var fStart = V.input({ type: 'time', value: r ? r.start : '23:30' });
      var fEnd = V.input({ type: 'time', value: r ? r.end : '07:00' });
      var fQuality = V.segment([
        { value: 'good', label: '睡得好' },
        { value: 'normal', label: '一般' },
        { value: 'bad', label: '没睡好' }
      ], quality, function (v) { quality = v; });
      var fNote = V.input({ placeholder: '可选，例如：睡前刷手机太久', value: r ? r.note : '' });

      var preview = el('div', { class: 'preview-box' });
      function refresh() {
        var m = TimeUtil.diffMin(fStart.value, fEnd.value);
        preview.innerHTML = '睡眠时长：<b>' + TimeUtil.humanMin(m) + '</b>' +
          (fEnd.value <= fStart.value ? '（跨夜）' : '');
      }
      fStart.addEventListener('input', refresh);
      fEnd.addEventListener('input', refresh);
      refresh();

      var m = V.modal({
        title: isEdit ? '编辑睡眠' : '记录睡眠',
        body: [
          el('div', { class: 'field-row' }, [
            V.field('入睡时间', fStart),
            V.field('醒来时间', fEnd)
          ]),
          preview,
          el('div', { style: { height: '14px' } }),
          V.field('睡眠质量', fQuality),
          V.field('备注', fNote)
        ],
        footer: el('div', { class: 'modal-foot' }, [
          isEdit ? el('button', {
            class: 'btn btn-danger', text: '删除',
            onclick: function () {
              m.close();
              setTimeout(function () {
                V.confirm({ title: '删除睡眠记录', message: '确定删除这条记录吗？', danger: true, okText: '删除' })
                  .then(function (ok) { if (ok) { Store.removeSleep(id); UI.toast('已删除'); } });
              }, 200);
            }
          }) : el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
          el('button', {
            class: 'btn btn-primary', text: '保存',
            onclick: function () {
              var d = { date: dateStr, start: fStart.value, end: fEnd.value, quality: quality, note: fNote.value };
              if (!d.start || !d.end) { UI.toast('请填写时间', 'err'); return; }
              if (isEdit) Store.updateSleep(id, d); else Store.addSleep(d);
              m.close();
              UI.toast(isEdit ? '已更新' : '睡眠已记录');
            }
          })
        ])
      });
    }
  };

  /* ==========================================================
   * 饮食记录弹窗
   * ========================================================== */
  /** 按当前时间猜是哪一餐 */
  function guessMealType() {
    var h = new Date().getHours();
    if (h < 9) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h < 21) return 'dinner';
    return 'snack';
  }

  /** 各餐次的默认时间 */
  function defaultMealTime(type) {
    if (type === 'breakfast') return '07:30';
    if (type === 'lunch') return '12:00';
    if (type === 'dinner') return '18:30';
    return '15:30';
  }

  var MealDialog = {
    open: function (dateStr, id) {
      var isEdit = !!id;
      var m0 = id ? Store.getMeal(id) : null;
      var type = m0 ? m0.type : guessMealType();

      /** 已选食物明细 */
      var items = (m0 && m0.items) ? JSON.parse(JSON.stringify(m0.items)) : [];
      var manual = m0 ? !!m0.kcalManual : false;

      var fType = V.segment(MEAL_TYPES.map(function (t) {
        return { value: t.value, label: t.label };
      }), type, function (v) { type = v; drawGoalHint(); });

      var fTime = V.input({ type: 'time', value: m0 ? m0.time : defaultMealTime(type) });
      var fContent = V.input({ placeholder: '例如：鸡腿饭 + 豆浆', value: m0 ? m0.content : '' });
      var fCost = V.input({ type: 'number', min: '0', step: '0.1', placeholder: '0', value: m0 ? (m0.cost || '') : '' });
      var fKcal = V.input({ type: 'number', min: '0', step: '10', placeholder: '0', value: m0 ? (m0.kcal || '') : '' });
      var fNote = V.input({ placeholder: '可选', value: m0 ? m0.note : '' });
      var fTags = V.tagInput(m0 ? (m0.tags || []).join(',') : '', {
        placeholder: '如 餐饮/正餐（会自动带到记账）'
      });

      /* ---------- 食物搜索 ---------- */
      var fSearch = V.input({ placeholder: '搜食物：米饭、鸡胸、奶茶…', class: 'input' });
      var resultBox = el('div', { class: 'food-results' });
      var pickedBox = el('div', { class: 'food-picked' });
      var sumBox = el('div', { class: 'food-sum' });
      var goalBox = el('div', { class: 'food-goal' });

      function drawResults() {
        resultBox.innerHTML = '';
        var kw = fSearch.value.trim();
        if (!kw) return;
        var list = Store.searchFoods(kw, 12);
        if (!list.length) {
          resultBox.appendChild(el('div', { class: 'q-empty', text: '库里没有这个，可以直接在下面填热量' }));
          return;
        }
        list.forEach(function (f) {
          resultBox.appendChild(el('button', {
            class: 'food-item', type: 'button',
            onclick: function () {
              items.push({ n: f.n, q: 1, kcal: f.kcal, p: f.p, f: f.f, c: f.c });
              manual = false;
              drawPicked();
              fSearch.value = '';
              drawResults();
            }
          }, [
            el('b', { text: f.n }),
            el('span', { text: f.unit }),
            el('i', { text: f.kcal + ' 千卡' })
          ]));
        });
      }

      function sumOf() {
        var s = { kcal: 0, p: 0, f: 0, c: 0 };
        items.forEach(function (it) {
          var q = Number(it.q) || 0;
          s.kcal += (Number(it.kcal) || 0) * q;
          s.p += (Number(it.p) || 0) * q;
          s.f += (Number(it.f) || 0) * q;
          s.c += (Number(it.c) || 0) * q;
        });
        return s;
      }

      function drawPicked() {
        pickedBox.innerHTML = '';
        if (!items.length) {
          pickedBox.appendChild(el('div', { class: 'q-empty', text: '还没有选食物，搜一下或直接在下面填热量' }));
        }
        items.forEach(function (it, i) {
          var q = Number(it.q) || 1;
          pickedBox.appendChild(el('div', { class: 'fp-row' }, [
            el('b', { text: it.n }),
            el('input', {
              type: 'number', min: '0.5', step: '0.5', value: q, class: 'input fp-q',
              oninput: function () {
                it.q = parseFloat(this.value) || 1;
                drawPicked();
              }
            }),
            el('span', { class: 'fp-x', text: '份' }),
            el('i', { class: 'fp-k', text: Math.round((Number(it.kcal) || 0) * (Number(it.q) || 1)) + ' 千卡' }),
            el('button', {
              class: 'icon-btn', title: '移除',
              onclick: function () {
                items.splice(i, 1);
                drawPicked();
              }
            }, [V.svg(V.icons.trash, 14)])
          ]));
        });
        drawSum();
        // 「吃了什么」跟着食物明细走（用户没自己写的情况下）
        if (items.length) {
          fContent.value = items.map(function (x) { return x.n; }).join(' + ');
        }
      }

      function drawSum() {
        var s = sumOf();
        if (!items.length) {
          sumBox.innerHTML = '';
          sumBox.style.display = 'none';
        } else {
          sumBox.style.display = '';
          sumBox.innerHTML =
            '<div class="cp-fs-line"><b>' + Math.round(s.kcal) + '</b><span>千卡（按食物自动估算）</span></div>' +
            '<div class="cp-fs-macros">' +
            '<span class="cp-macro cp-m-p">蛋白 ' + Math.round(s.p) + 'g</span>' +
            '<span class="cp-macro cp-m-f">脂肪 ' + Math.round(s.f) + 'g</span>' +
            '<span class="cp-macro cp-m-c">碳水 ' + Math.round(s.c) + 'g</span>' +
            '</div>';
        }
        if (!manual && items.length) {
          fKcal.value = String(Math.round(s.kcal));
        }
        drawGoalHint();
      }

      function drawGoalHint() {
        var quota = Store.mealQuota(type);
        if (!quota) { goalBox.style.display = 'none'; return; }
        var cur = Number(fKcal.value) || 0;
        var pct = Math.round(cur / quota * 100);
        var over = cur > quota;
        goalBox.style.display = '';
        goalBox.innerHTML =
          '<div class="cp-fg-row"><span>这一餐的目标</span><b>' + quota + ' 千卡</b></div>' +
          '<div class="cp-fg-bar"><i style="width:' + Math.min(100, pct) + '%;background:' +
          (over ? 'var(--red)' : 'var(--green)') + '"></i></div>' +
          '<div class="cp-fg-hint"' + (over ? ' style="color:var(--red)"' : '') + '>' +
          (over ? '超出 ' + Math.round(cur - quota) + ' 千卡' : ('还剩 ' + Math.round(quota - cur) + ' 千卡')) +
          '</div>';
      }

      fSearch.addEventListener('input', drawResults);
      fKcal.addEventListener('input', function () {
        if (items.length) manual = true;
        drawGoalHint();
      });

      var m = V.modal({
        title: isEdit ? '编辑饮食' : '记录饮食',
        width: '540px',
        body: [
          V.field('哪一餐', fType),
          el('div', { class: 'field-row' }, [
            V.field('时间', fTime),
            V.field('花费（元）', fCost)
          ]),
          el('div', { class: 'food-box' }, [
            el('div', { class: 'sub-title', text: '从食物库里选（自动算热量）' }),
            fSearch,
            resultBox,
            pickedBox,
            sumBox
          ]),
          V.field('吃了什么', fContent, '选了食物会自动填，也可以自己写'),
          el('div', { class: 'field-row' }, [
            V.field('热量（千卡）', fKcal, '选了食物自动估算，可以改'),
            el('div', { class: 'field' }, [goalBox])
          ]),
          V.field('标签', fTags, '填了花费时，标签会一并带到记账'),
          V.field('备注', fNote)
        ],
        footer: el('div', { class: 'modal-foot' }, [
          isEdit ? el('button', {
            class: 'btn btn-danger', text: '删除',
            onclick: function () {
              m.close();
              setTimeout(function () {
                V.confirm({ title: '删除饮食记录', message: '确定删除这条记录吗？', danger: true, okText: '删除' })
                  .then(function (ok) { if (ok) { Store.removeMeal(id); UI.toast('已删除'); } });
              }, 200);
            }
          }) : el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
          el('button', {
            class: 'btn btn-primary', text: '保存',
            onclick: function () {
              var d = {
                date: dateStr, time: fTime.value, type: type,
                content: fContent.value, cost: fCost.value, kcal: fKcal.value,
                note: fNote.value, tags: fTags.getValue(),
                items: items, kcalManual: manual
              };
              if (!d.content.trim()) { UI.toast('请填写吃了什么', 'err'); fContent.focus(); return; }
              if (isEdit) Store.updateMeal(id, d); else Store.addMeal(d);
              m.close();
              UI.toast(isEdit ? '已更新' : '饮食已记录');
            }
          })
        ])
      });

      drawPicked();
    }
  };

  global.MealDialog = MealDialog;
  /** 活动记录弹窗：一段时间在做什么 */
  var ActivityDialog = {
    open: function (dateStr, id) {
      var isEdit = !!id;
      var a0 = id ? Store.getActivity(id) : null;

      var type = a0 ? a0.type : 'study';
      var fType = V.segment(ACT_TYPES.map(function (t) {
        return { value: t.value, label: t.label };
      }), type, function (v) { type = v; });

      var fName = V.input({ placeholder: '例如：自习高数', value: a0 ? a0.name : '', dataset: { autofocus: '1' } });
      var fStart = V.input({ type: 'time', value: a0 ? a0.start : '19:00' });
      var fEnd = V.input({ type: 'time', value: a0 ? a0.end : '21:00' });
      var fNote = V.input({ placeholder: '可选', value: a0 ? a0.note : '' });
      var fTags = V.tagInput(a0 ? (a0.tags || []).join(',') : '', { placeholder: '如 学习/数学' });

      // 时间记录 → 待办 的这一头：挂上之后这段时间会算进那条待办的「已投入」
      var taskOpts = [{ value: '', label: '不关联待办' }].concat(
        (Store.tasks || []).filter(function (t) { return t.status !== 'done' && !t.parentId; })
          .slice(0, 80).map(function (t) { return { value: t.id, label: t.title }; })
      );
      var fTask = V.select(taskOpts, a0 ? (a0.taskId || '') : '');

      var m = V.modal({
        title: isEdit ? '编辑活动' : '记录活动',
        body: [
          V.field('在做什么', fName),
          V.field('类别', fType),
          el('div', { class: 'field-row' }, [
            V.field('开始', fStart),
            V.field('结束', fEnd)
          ]),
          V.field('标签', fTags),
          V.field('关联待办', fTask, '挂上后，这段时间会算进那条待办的「已投入」'),
          V.field('备注', fNote)
        ],
        footer: el('div', { class: 'modal-foot' }, [
          isEdit ? el('button', {
            class: 'btn btn-danger', text: '删除',
            onclick: function () {
              m.close();
              setTimeout(function () {
                V.confirm({ title: '删除活动', message: '确定删除这条记录吗？', danger: true, okText: '删除' })
                  .then(function (ok) { if (ok) { Store.removeActivity(id); UI.toast('已删除'); } });
              }, 200);
            }
          }) : el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
          el('button', {
            class: 'btn btn-primary', text: '保存',
            onclick: function () {
              var d = {
                date: dateStr, name: fName.value, type: type,
                start: fStart.value, end: fEnd.value,
                note: fNote.value, tags: fTags.getValue(), taskId: fTask.value
              };
              if (!d.name.trim()) { UI.toast('请填写在做什么', 'err'); fName.focus(); return; }
              if (d.end <= d.start) { UI.toast('结束时间要晚于开始时间', 'err'); return; }
              if (isEdit) Store.updateActivity(id, d); else Store.addActivity(d);
              m.close();
              UI.toast(isEdit ? '已更新' : '活动已记录');
            }
          })
        ])
      });
    }
  };

  global.ActivityDialog = ActivityDialog;

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


