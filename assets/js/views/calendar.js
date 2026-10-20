

/* ==========================================================
 * 视图：日历（月视图 · 记录回顾 + 日程安排）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  var cursor = null;     // { y, m }
  var selected = null;   // 选中日期 YYYY-MM-DD
  var onlyMine = false;  // 是否只看有内容的日子（预留）

  function today0() { return DateUtil.today(); }

  function ensureCursor() {
    if (!cursor) {
      var d = today0();
      cursor = { y: d.getFullYear(), m: d.getMonth() };
    }
    if (!selected) selected = DateUtil.toStr(today0());
  }

  function shiftMonth(n) {
    var d = new Date(cursor.y, cursor.m + n, 1);
    cursor = { y: d.getFullYear(), m: d.getMonth() };
  }

  function focusMinutesOf(dateStr) {
    return (Store.pomodoro.sessions || []).reduce(function (sum, s) {
      return s.date === dateStr ? sum + (s.minutes || 0) : sum;
    }, 0);
  }

  var view = {
    id: 'calendar',
    name: '日历',
    icon: V.icons.calendar,
    title: '日历',
    order: 18,
    nav: true,

    root: null,

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () {
          if (global.EventDialog) global.EventDialog.open();
        }
      }, [V.svg(V.icons.plus, 16), '新建日程']));
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-calendar' });
      host.appendChild(this.root);
      ensureCursor();
      this.render();
      return this.root;
    },

    onEnter: function () {
      ensureCursor();
      this.render();
    },

    render: function () {
      var root = this.root;
      root.innerHTML = '';
      ensureCursor();

      var y = cursor.y, m = cursor.m;
      var first = new Date(y, m, 1);
      var start = DateUtil.weekStart(first);
      var todayStr = DateUtil.toStr(today0());

      /* ================= 月份头 ================= */
      var head = el('div', { class: 'week-bar', style: { marginBottom: '12px' } }, [
        el('div', { class: 'week-nav' }, [
          el('button', { class: 'icon-btn', onclick: function () { shiftMonth(-1); view.render(); } }, [V.svg(V.icons.left)]),
          el('div', { class: 'week-label' }, [
            el('span', { text: y + ' 年 ' + (m + 1) + ' 月' }),
            el('small', { text: monthSummary(y, m) })
          ]),
          el('button', { class: 'icon-btn', onclick: function () { shiftMonth(1); view.render(); } }, [V.svg(V.icons.right)])
        ]),
        el('div', { class: 'week-meta' }, [
          (y !== today0().getFullYear() || m !== today0().getMonth()) ? el('button', {
            class: 'btn btn-sm',
            onclick: function () {
              var d = today0();
              cursor = { y: d.getFullYear(), m: d.getMonth() };
              selected = DateUtil.toStr(d);
              view.render();
            }
          }, ['回到本月']) : null
        ])
      ]);
      root.appendChild(head);

      /* ================= 月历 ================= */
      var cal = el('div', { class: 'card cal-card' });

      var weekRow = el('div', { class: 'cal-week' });
      Store.DAY_NAMES.forEach(function (n) {
        weekRow.appendChild(el('span', { text: n.slice(1) }));
      });
      cal.appendChild(weekRow);

      var grid = el('div', { class: 'cal-grid' });
      for (var i = 0; i < 42; i++) {
        var d = DateUtil.addDays(start, i);
        grid.appendChild(dayCell(d, y, m, todayStr));
      }
      cal.appendChild(grid);
      root.appendChild(cal);

      /* ================= 选中日详情 ================= */
      if (selected) root.appendChild(dayDetail(selected));

      /* ================= 未来 7 天日程 ================= */
      var upcoming = Store.upcomingEvents(7).filter(function (e) { return !e.done; }).slice(0, 6);
      if (upcoming.length) {
        var up = el('div', { style: { marginTop: '16px' } });
        up.appendChild(el('div', { class: 'section-title' }, [
          '未来 7 天日程',
          el('a', {
            class: 'more', href: 'javascript:void 0',
            onclick: function () { App.go('agenda'); }
          }, ['去日程 →'])
        ]));
        var box = el('div', { class: 'card', style: { padding: '4px 8px' } });
        upcoming.forEach(function (e) {
          var d = DateUtil.parse(e.date);
          box.appendChild(el('div', {
            class: 'task-row',
            onclick: function () {
              cursor = { y: d.getFullYear(), m: d.getMonth() };
              selected = e.date;
              view.render();
            }
          }, [
            el('span', { class: 'cal-up-date', text: (d.getMonth() + 1) + '/' + d.getDate() }),
            el('span', { class: 'task-main' }, [
              el('span', { class: 'task-title', text: e.title }),
              el('span', { class: 'task-meta' }, [
                el('span', { text: e.start + '–' + e.end + (e.location ? ' · ' + e.location : '') })
              ])
            ]),
            el('span', { class: 'chip chip-primary', text: '日程' })
          ]));
        });
        up.appendChild(box);
        root.appendChild(up);
      }
    }
  };

  /* ==========================================================
   * 日期格
   * ========================================================== */
  function dayCell(d, y, m, todayStr) {
    var ds = DateUtil.toStr(d);
    var inMonth = d.getMonth() === m;
    var isToday = ds === todayStr;
    var isSel = ds === selected;
    var isFuture = ds > todayStr;

    var dow = DateUtil.isoDow(d);
    var wk = Store.weekOf(d);
    var courses = Store.coursesOnDay(dow, wk);
    var events = Store.eventsOf(ds);

    // 当天已记录的时间（分钟）
    var st = Store.dayStat(ds);
    var recorded = 1440 - st.idle;
    var pct = Math.max(0, Math.min(100, Math.round(recorded / 1440 * 100)));

    var cell = el('button', {
      class: 'cal-cell' +
        (inMonth ? '' : ' out') +
        (isToday ? ' today' : '') +
        (isSel ? ' sel' : '') +
        (isFuture ? ' future' : ''),
      onclick: function () {
        selected = ds;
        if (d.getMonth() !== cursor.m) {
          cursor = { y: d.getFullYear(), m: d.getMonth() };
        }
        view.render();
      }
    }, [
      el('span', { class: 'cal-day', text: String(d.getDate()) }),
      el('span', { class: 'cal-dots' }, [
        courses.length ? el('i', { class: 'dot course', title: courses.length + ' 节课' }) : null,
        events.length ? el('i', { class: 'dot event', title: events.length + ' 个日程' }) : null
      ]),
      el('span', { class: 'cal-rec' }, [
        el('i', { style: { width: pct + '%' } })
      ])
    ]);
    return cell;
  }

  function monthSummary(y, m) {
    var days = new Date(y, m + 1, 0).getDate();
    var total = 0, active = 0;
    for (var i = 1; i <= days; i++) {
      var ds = y + '-' + pad(m + 1) + '-' + pad(i);
      var st = Store.dayStat(ds);
      var rec = 1440 - st.idle;
      total += rec;
      if (rec > 0) active++;
    }
    return active + ' 天有记录 · 共 ' + Math.round(total / 60) + ' 小时';
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /* ==========================================================
   * 选中日详情
   * ========================================================== */
  function dayDetail(ds) {
    var d = DateUtil.parse(ds);
    var dow = DateUtil.isoDow(d);
    var wk = Store.weekOf(d);
    var courses = Store.coursesOnDay(dow, wk);
    var events = Store.eventsOf(ds);
    var st = Store.dayStat(ds);
    var mins = {};
    st.segments.forEach(function (s) { mins[s.key] = s.minutes; });
    var focus = focusMinutesOf(ds);

    var card = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });

    card.appendChild(el('div', { class: 'section-title' }, [
      (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + DateUtil.weekdayCN(d),
      el('span', { class: 'q-count', text: ds === DateUtil.toStr(today0()) ? '今天' : '' })
    ]));

    /* ---- 记录摘要 ---- */
    var recRow = el('div', { class: 'cal-rec-row' });
    function recChip(label, value, color) {
      recRow.appendChild(el('span', { class: 'cal-rec-chip' }, [
        el('i', { style: { background: color } }),
        el('b', { text: String(value) }),
        el('span', { text: label })
      ]));
    }
    recChip('睡眠', TimeUtil.humanMin(mins.sleep || 0), '#6366f1');
    recChip('专注', TimeUtil.humanMin(focus || 0), '#10b981');
    recChip('用餐', TimeUtil.humanMin(mins.meal || 0), '#ef4444');
    recChip('活动', TimeUtil.humanMin(mins.activity || 0), '#0ea5e9');
    card.appendChild(recRow);

    /* ---- 课程 ---- */
    if (courses.length) {
      card.appendChild(el('div', { class: 'cal-sub' }, ['课程']));
      courses.forEach(function (c) {
        var t = Store.courseTime(c);
        card.appendChild(el('div', { class: 'cal-line', onclick: function () {
          if (global.__CourseDialog) global.__CourseDialog.detail(c.id);
        } }, [
          el('span', { class: 'cal-time', text: t ? t.start : '--:--' }),
          el('i', { class: 'cal-color', style: { background: c.color } }),
          el('span', { class: 'cal-name', text: c.name + (c.location ? ' · ' + c.location : '') })
        ]));
      });
    }

    /* ---- 日程 ---- */
    if (events.length) {
      card.appendChild(el('div', { class: 'cal-sub' }, ['日程']));
      events.forEach(function (e) {
        card.appendChild(el('div', { class: 'cal-line', onclick: function () {
          if (global.EventDetail) global.EventDetail.open(e.id);
        } }, [
          el('span', { class: 'cal-time', text: e.start }),
          el('i', { class: 'cal-color', style: { background: '#ec4899' } }),
          el('span', { class: 'cal-name', text: e.title + (e.location ? ' · ' + e.location : '') }),
          e.done ? el('span', { class: 'chip chip-green', text: '已完成' }) : null
        ]));
      });
    }

    if (!courses.length && !events.length && !(mins.sleep + focus + mins.meal + mins.activity)) {
      card.appendChild(el('div', { class: 'q-empty', text: '这一天没有课程、日程或时间记录。' }));
    }

    /* ---- 操作 ---- */
    card.appendChild(el('div', { class: 'cal-actions' }, [
      el('button', {
        class: 'btn btn-sm',
        onclick: function () {
          var v = App.views.filter(function (x) { return x.id === 'quadrant'; })[0];
          if (v) { v.date = ds; }
          App.go('quadrant');
        }
      }, ['查看象限']),
      el('button', {
        class: 'btn btn-sm',
        onclick: function () {
          if (global.EventDialog) global.EventDialog.open(null, { date: ds });
        }
      }, ['这天加日程'])
    ]));

    return card;
  }

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


