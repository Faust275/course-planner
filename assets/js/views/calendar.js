

/* ==========================================================
 * 视图：日历（月视图 · 记录回顾 + 日程安排）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  var cursor = null;     // { y, m }
  var selected = null;   // 选中日期 YYYY-MM-DD
  var relayHighlight = null;  // 从待办页接力过来、需要在「待办抽屉」里高亮的待办 id
  var relayToastedId = null;  // 避免 mount + onEnter 双渲染时重复弹提示
  var calTab = 'calendar';   // 分页：calendar 日历 / agenda 日程（日程来自 agenda.js 的 AgendaPane）
  var calViewMode = 'grid';  // 'grid' 网格月历 | 'strip' 每日长条全景时间轴
  var stripDir = 'horiz';    // 'horiz' 横向长条（逐日上下排） | 'vert' 纵向长条（逐日左右排，横线代表截止点）
  var stripFilter = 'all';   // 'all' 全月 | 'active' 仅看有记录或规划 | 'near14' 围绕选中日前后14天
  var COURSE_COLOR = '#0ea5e9';   // 时间块里课程统一显示为该色（与「学习/课程」主色一致），不再用每门课各自颜色

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

    defaultTab: 'calendar',
    getTab: function () { return calTab; },
    setTab: function (t) { calTab = (t === 'agenda') ? 'agenda' : 'calendar'; this.render(); if (global.App && App.renderHubBar) App.renderHubBar(); },

    root: null,

    actions: function (host) {
      // 日程分页有自己的操作区（隐藏课程 / 纪念日 / 新建日程）
      if (calTab === 'agenda') {
        if (global.AgendaPane) global.AgendaPane.actions(host);
        return;
      }
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

      // 移动端横滑切月：左滑下个月，右滑上个月（与月份头箭头一致）
      // 在「日程」分页下不接管手势，避免误触
      V.addSwipe(this.root, {
        left: function () { if (calTab === 'agenda') return; shiftMonth(1); view.render(); },
        right: function () { if (calTab === 'agenda') return; shiftMonth(-1); view.render(); }
      });

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
      if (!root) return;
      root.innerHTML = '';
      ensureCursor();

      /* 跨视图接力：从待办页拖到「日历」入口过来时，定位到今天并在待办抽屉里高亮它。
         进入视图时 mount + onEnter 会连续渲染两次，所以这里不立刻清标记，
         而是保留 500ms，让两次渲染都能命中；之后再清掉避免误高亮。 */
      (function () {
        var bus = (global.App && global.App.bus) ? App.bus : null;
        var relay = bus ? bus.peekRelay(8000) : null;
        if (relay) {
          var id = relay.taskId, at = relay.at;
          var d = today0();
          selected = DateUtil.toStr(d);
          cursor = { y: d.getFullYear(), m: d.getMonth() };
          relayHighlight = id;
          setTimeout(function () { if (bus) bus.clearRelay(at); }, 500);
        }
      })();

      /* ---- 仅经典模式显示内部二级栏；六大分区模式下由顶部 #hubBar 统一承载 ---- */
      if (Store.getNavLayout && Store.getNavLayout() === 'classic') {
        var paneBar = el('div', { class: 'pane-tabs' });
        [
          { v: 'schedule_table', l: '📅 周课表', go: function () { if (global.App) App.go('schedule', { tab: 'table' }); } },
          { v: 'calendar', l: '日历', go: function () { calTab = 'calendar'; view.render(); } },
          { v: 'schedule_exam', l: '🎯 备考看板', go: function () { if (global.App) App.go('schedule', { tab: 'exam' }); } }
        ].forEach(function (x) {
          paneBar.appendChild(el('button', {
            class: 'pane-tab' + (calTab === x.v ? ' active' : ''),
            text: x.l,
            onclick: x.go
          }));
        });
        root.appendChild(paneBar);
      }

      // 日程分页：由 agenda.js 的 AgendaPane 渲染（未来 7 天安排 + 一次性日程）
      if (calTab === 'agenda') {
        var agHost = el('div', {});
        root.appendChild(agHost);
        if (global.AgendaPane) global.AgendaPane.render(agHost);
        return;
      }

      var y = cursor.y, m = cursor.m;
      var first = new Date(y, m, 1);
      var start = DateUtil.weekStart(first);
      var todayStr = DateUtil.toStr(today0());

      /* ================= 月份头 ================= */
      var head = el('div', { class: 'week-bar', style: { marginBottom: '12px' } }, [
        el('div', { class: 'week-nav' }, [
          el('button', { class: 'icon-btn', dataset: { calNav: 'prev' }, title: '上个月（把日程拖到这里可改到上月同日）', onclick: function () { shiftMonth(-1); view.render(); } }, [V.svg(V.icons.left)]),
          el('div', { class: 'week-label' }, [
            el('span', { text: y + ' 年 ' + (m + 1) + ' 月' }),
            el('small', { text: monthSummary(y, m) })
          ]),
          el('button', { class: 'icon-btn', dataset: { calNav: 'next' }, title: '下个月（把日程拖到这里可改到下月同日）', onclick: function () { shiftMonth(1); view.render(); } }, [V.svg(V.icons.right)])
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

      /* ================= 模式切换条：网格月历 | 每日长条时间轴 ================= */
      var modeSwitchBar = el('div', {
        class: 'cal-mode-bar',
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }
      }, [
        el('div', { class: 'dim-tabs', style: { marginBottom: '0' } }, [
          el('button', {
            class: 'dim-tab' + (calViewMode === 'grid' ? ' active' : ''),
            text: '🗓️ 网格月历',
            onclick: function () { calViewMode = 'grid'; view.render(); }
          }),
          el('button', {
            class: 'dim-tab' + (calViewMode === 'strip' ? ' active' : ''),
            text: '📊 每日长条时间轴（回看记录 + 未来规划 + DDL 线）',
            onclick: function () { calViewMode = 'strip'; view.render(); }
          })
        ]),
        calViewMode === 'strip' ? el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
          el('div', { class: 'dim-tabs', style: { marginBottom: '0' } }, [
            el('button', {
              class: 'dim-tab' + (stripDir === 'horiz' ? ' active' : ''),
              text: '↔️ 横向长条',
              title: '每天一条横向 24h 时间带，从上往下按日期排列',
              onclick: function () { stripDir = 'horiz'; view.render(); }
            }),
            el('button', {
              class: 'dim-tab' + (stripDir === 'vert' ? ' active' : ''),
              text: '↕️ 纵向长条 (横线DDL)',
              title: '每天一条纵向 24h 时间柱，横线代表截止时间点',
              onclick: function () { stripDir = 'vert'; view.render(); }
            })
          ]),
          el('div', { class: 'dim-tabs', style: { marginBottom: '0' } }, [
            { k: 'all', n: '全月' },
            { k: 'active', n: '仅看有内容' },
            { k: 'near14', n: '近 14 天' }
          ].map(function (f) {
            return el('button', {
              class: 'dim-tab' + (stripFilter === f.k ? ' active' : ''),
              text: f.n,
              onclick: function () { stripFilter = f.k; view.render(); }
            });
          }))
        ]) : null
      ]);
      root.appendChild(modeSwitchBar);

      /* ================= 月历网格 / 每日长条全景轴 ================= */
      if (calViewMode === 'strip') {
        root.appendChild(renderMonthStripCard({
          year: y,
          month: m,
          selectedDate: selected,
          dir: stripDir,
          filter: stripFilter,
          onSelectDate: function (ds) {
            var pd = DateUtil.parse(ds);
            if (pd) cursor = { y: pd.getFullYear(), m: pd.getMonth() };
            selected = ds;
            view.render();
          },
          onDirChange: function (nextDir) {
            stripDir = nextDir;
            view.render();
          },
          onFilterChange: function (nextFilter) {
            stripFilter = nextFilter;
            view.render();
          }
        }));
      } else {
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
      }

      /* ================= 选中日详情 ================= */
      if (selected) root.appendChild(dayDetail(selected));

      /* ================= 未来 7 天日程与待办（合流展示） ================= */
      var to7Str = DateUtil.toStr(DateUtil.addDays(today0(), 6));
      var upcomingEvs = Store.upcomingEvents(7).filter(function (e) { return !e.done; }).map(function (e) {
        return { kind: 'event', id: e.id, date: e.date, sort: e.start || '08:00', title: e.title, meta: e.start + '–' + e.end + (e.location ? ' · ' + e.location : ''), raw: e };
      });
      var upcomingTasks = (Store.tasks || []).filter(function (t) {
        return t && !t.parentId && t.status !== 'done' && t.dueDate && t.dueDate >= todayStr && t.dueDate <= to7Str;
      }).map(function (t) {
        var cObj = t.courseId ? Store.getCourse(t.courseId) : null;
        return { kind: 'task', id: t.id, date: t.dueDate, sort: t.dueTime || '23:59', title: t.title, meta: (t.dueTime ? ('截止 ' + t.dueTime) : '全天待办') + (cObj ? (' · 📚' + cObj.name) : ''), raw: t };
      });
      var upcoming = upcomingEvs.concat(upcomingTasks).sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.sort < b.sort ? -1 : (a.sort > b.sort ? 1 : 0);
      }).slice(0, 8);
      if (upcoming.length) {
        var up = el('div', { style: { marginTop: '16px' } });
        up.appendChild(el('div', { class: 'section-title' }, [
          '未来 7 天日程与待办',
          el('a', {
            class: 'more', href: 'javascript:void 0',
            onclick: function () { App.go('calendar', { tab: 'agenda' }); }
          }, ['去日程 →'])
        ]));
        var box = el('div', { class: 'card', style: { padding: '4px 8px' } });
        upcoming.forEach(function (it) {
          var d = DateUtil.parse(it.date);
          var row = el('div', {
            class: 'task-row',
            onclick: function () {
              cursor = { y: d.getFullYear(), m: d.getMonth() };
              selected = it.date;
              view.render();
            }
          }, [
            el('span', { class: 'cal-up-date', text: (d.getMonth() + 1) + '/' + d.getDate() }),
            el('span', { class: 'task-main' }, [
              el('span', { class: 'task-title', text: it.title }),
              el('span', { class: 'task-meta' }, [
                el('span', { text: it.meta })
              ])
            ]),
            el('span', {
              class: 'chip ' + (it.kind === 'task' ? 'chip-amber' : 'chip-primary'),
              style: { cursor: 'pointer' },
              title: '点击直接标为完成',
              onclick: function (evClick) {
                evClick.stopPropagation();
                if (it.kind === 'task') Store.toggleTask(it.id);
                else Store.toggleEvent(it.id);
                view.render();
              }
            }, [it.kind === 'task' ? '待办' : '日程'])
          ]);
          if (it.kind === 'task') dragTaskToCell(row, it.raw);
          else dragEventToCell(row, it.id, it.date);
          box.appendChild(row);
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
    var courses = Store.coursesOnDate(ds);
    var events = Store.eventsOf(ds);
    var examCourses = Store.examsOf ? Store.examsOf(ds) : (Store.courses || []).filter(function (c) { return c.exam && c.exam.date === ds; });
    var hol = (global.HolidayCN && Store.settings.showHoliday !== false)
      ? HolidayCN.lookup(ds) : null;

    // 当天已记录的时间（分钟）
    var st = Store.dayStat(ds);
    var recorded = 1440 - st.idle;
    var pct = Math.max(0, Math.min(100, Math.round(recorded / 1440 * 100)));

    var cell = el('button', {
      class: 'cal-cell' +
        (inMonth ? '' : ' out') +
        (isToday ? ' today' : '') +
        (isSel ? ' sel' : '') +
        (isFuture ? ' future' : '') +
        (hol && hol.type === 'holiday' ? ' holiday' : ''),
      dataset: { date: ds },
      onclick: function () {
        selected = ds;
        if (d.getMonth() !== cursor.m) {
          cursor = { y: d.getFullYear(), m: d.getMonth() };
        }
        view.render();
      }
    }, [
      el('span', { class: 'cal-day', text: String(d.getDate()) }),
      hol ? el('span', {
        class: 'cal-hol-badge ' + (hol.type === 'holiday' ? 'cal-hol' : 'cal-work'),
        title: hol.name, text: hol.type === 'holiday' ? '休' : '班'
      }) : null,
      (function () {
        var dueTasks = (Store.tasks || []).filter(function (t) { return !t.parentId && t.dueDate === ds && t.status !== 'done'; });
        var plannedActs = (Store.activitiesOf(ds) || []).filter(function (a) { return a && a.planned; });
        return el('span', { class: 'cal-dots' }, [
          (courses.length && !hol) ? el('i', { class: 'dot course', title: courses.length + ' 节课' }) : null,
          events.length ? el('i', { class: 'dot event', title: events.length + ' 个日程' }) : null,
          plannedActs.length ? el('i', { class: 'dot plan', style: { background: '#10b981' }, title: plannedActs.length + ' 个计划时间块' }) : null,
          dueTasks.length ? el('i', { class: 'dot ddl', style: { background: '#f59e0b' }, title: dueTasks.length + ' 项待办截止' }) : null,
          examCourses.length ? el('i', {
            class: 'dot exam',
            title: '考试：' + examCourses.map(function (c) { return c.name; }).join('、')
          }) : null
        ]);
      })(),
      el('span', { class: 'cal-rec' }, [
        el('i', { style: { width: pct + '%' } })
      ])
    ]);
    return cell;
  }

  /* ==========================================================
   * 拖动：把事件拖到别的日格 → 改期
   * 拖动源：选中日详情里的日程行 / 未来 7 天日程行
   * 落点：月格（cp-cal-cell，带 data-date）
   * ========================================================== */
  function clearCellHint() {
    var ns = document.querySelectorAll('.cp-cal-cell.cp-drop-cell');
    for (var i = 0; i < ns.length; i++) ns[i].classList.remove('cp-drop-cell');
  }

  /* ---- 拖到月份导航 ‹ › 松手：改到相邻月同一天（边缘翻月的可落地形态） ---- */
  function dropNavDir(overEl) {
    var b = overEl && overEl.closest && overEl.closest('[data-cal-nav]');
    return b ? b.getAttribute('data-cal-nav') : null;
  }
  function clearNavHot() {
    var ns = document.querySelectorAll('.cp-cal-nav-hot');
    for (var i = 0; i < ns.length; i++) ns[i].classList.remove('cp-cal-nav-hot');
  }
  function navHotButton(overEl) {
    clearNavHot();
    var b = overEl && overEl.closest && overEl.closest('[data-cal-nav]');
    if (b) b.classList.add('cp-cal-nav-hot');
    return b;
  }
  function sameDayShiftMonth(srcDate, dir) {
    var base = srcDate ? DateUtil.parse(srcDate) : null;
    if (!base) base = today0();
    var ny = base.getFullYear(), nm = base.getMonth() + (dir === 'next' ? 1 : -1);
    var dim = new Date(ny, nm + 1, 0).getDate();
    var day = Math.min(base.getDate(), dim);
    var d = new Date(ny, nm, day);
    return { ds: DateUtil.toStr(d), y: ny, m: nm };
  }

  function dragEventToCell(node, eventId, sourceDate) {
    if (!global.DragGesture) return;
    var oldDate = sourceDate;
    DragGesture.makeDraggable(node, {
      ignore: '.cal-color',
      menuTitle: '日程',
      menu: function () { return DragGesture.dateMenuItems('event', eventId); },
      onMove: function (c) {
        clearCellHint();
        if (navHotButton(c.overEl)) return;   // 悬停翻月按钮时只高亮按钮
        var cell = c.overEl && c.overEl.closest('.cp-cal-cell');
        var ds = cell && cell.getAttribute('data-date');
        if (ds && ds !== sourceDate) cell.classList.add('cp-drop-cell');
      },
      onEnd: function (c) {
        clearCellHint(); clearNavHot();
        var dir = dropNavDir(c.overEl);
        if (dir) {
          var t = sameDayShiftMonth(sourceDate, dir);
          Store.updateEvent(eventId, { date: t.ds });
          cursor = { y: t.y, m: t.m }; selected = t.ds; view.render();
          V.toastAction('已改期到 ' + t.ds.slice(5).replace('-', '/'), {
            onAction: function () { if (oldDate) { var od = DateUtil.parse(oldDate); cursor = { y: od.getFullYear(), m: od.getMonth() }; selected = oldDate; } Store.updateEvent(eventId, { date: oldDate }); }
          });
          return;
        }
        var cell = c.overEl && c.overEl.closest('.cp-cal-cell');
        var targetDs = cell && cell.getAttribute('data-date');
        if (targetDs && targetDs !== sourceDate) {
          Store.updateEvent(eventId, { date: targetDs });
          V.toastAction('已改期到 ' + targetDs.slice(5).replace('-', '/'), {
            onAction: function () { Store.updateEvent(eventId, { date: oldDate }); }
          });
        }
      }
    });
  }

  /** 待办抽屉 → 拖到日期格，直接改这条待办的截止日期（待办↔日历桥接） */
  function dragTaskToCell(node, task) {
    if (!global.DragGesture) return;
    var src = task.dueDate || '';
    DragGesture.makeDraggable(node, {
      ignore: '.cal-color',
      menuTitle: '待办「' + task.title + '」',
      menu: function () { return DragGesture.dateMenuItems('task', task.id); },
      onMove: function (c) {
        clearCellHint();
        if (navHotButton(c.overEl)) return;
        var cell = c.overEl && c.overEl.closest('.cp-cal-cell');
        var ds = cell && cell.getAttribute('data-date');
        if (ds && ds !== src) cell.classList.add('cp-drop-cell');
      },
      onEnd: function (c) {
        clearCellHint(); clearNavHot();
        var dir = dropNavDir(c.overEl);
        if (dir) {
          var t = sameDayShiftMonth(src || '', dir);
          Store.updateTask(task.id, { dueDate: t.ds });
          cursor = { y: t.y, m: t.m }; selected = t.ds; view.render();
          V.toastAction('「' + task.title + '」截止日改到 ' + t.ds.slice(5).replace('-', '/'), {
            onAction: function () {
              if (src) { var od = DateUtil.parse(src); cursor = { y: od.getFullYear(), m: od.getMonth() }; selected = src; }
              Store.updateTask(task.id, { dueDate: src });
            }
          });
          return;
        }
        var cell = c.overEl && c.overEl.closest('.cp-cal-cell');
        var ds = cell && cell.getAttribute('data-date');
        if (ds && ds !== src) {
          Store.updateTask(task.id, { dueDate: ds });
          V.toastAction('「' + task.title + '」截止日改到 ' + ds.slice(5).replace('-', '/'), {
            onAction: function () { Store.updateTask(task.id, { dueDate: src }); }
          });
        }
      }
    });
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
    var courses = Store.coursesOnDate(ds);
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
          el('i', { class: 'cal-color', style: { background: COURSE_COLOR } }),
          el('span', {
            class: 'cal-name',
            text: c.name + (c.location ? ' · ' + c.location : '') +
                  (c._moveIn ? '（调自 ' + (c._moveFrom || '').slice(5).replace('-', '/') + '）' : '')
          }),
          c._exRoom ? el('span', { class: 'chip chip-amber', text: '换教室' }) : null
        ]));
      });
    }

    /* ---- 日程 ---- */
    if (events.length) {
      card.appendChild(el('div', { class: 'cal-sub' }, ['日程（可勾选完成 / 拖动改期）']));
      events.forEach(function (e) {
        var evCourse = e.courseId ? Store.getCourse(e.courseId) : null;
        var row = el('div', { class: 'cal-line', onclick: function () {
          if (global.EventDetail) global.EventDetail.open(e.id);
        } }, [
          el('span', { class: 'cal-time', text: e.start }),
          el('i', { class: 'cal-color', style: { background: '#ec4899' } }),
          el('span', {
            class: 'cal-name',
            style: e.done ? { textDecoration: 'line-through', opacity: '0.65' } : null,
            text: e.title + (evCourse ? ' · 📚' + evCourse.name : '') + (e.location ? ' · ' + e.location : '')
          }),
          el('span', {
            class: 'chip ' + (e.done ? 'chip-green' : 'chip-primary'),
            style: { cursor: 'pointer' },
            title: e.done ? '点击标为未完成' : '点击标为完成',
            onclick: function (evClick) {
              evClick.stopPropagation();
              Store.toggleEvent(e.id);
              view.render();
            }
          }, [e.done ? '已完成' : '完成'])
        ]);
        dragEventToCell(row, e.id, ds);
        card.appendChild(row);
      });
    }

    /* ---- 当日截止待办（日程待办深度合流：在日历日详情中直接展示并支持勾选/拖动改期） ---- */
    var dueTasks = (Store.tasks || []).filter(function (t) { return t && !t.parentId && t.dueDate === ds; });
    if (dueTasks.length) {
      card.appendChild(el('div', { class: 'cal-sub' }, ['当日待办（可勾选完成 / 拖动改期）']));
      dueTasks.forEach(function (t) {
        var cObj = t.courseId ? Store.getCourse(t.courseId) : null;
        var isDone = t.status === 'done';
        var row = el('div', {
          class: 'cal-line cal-task-line',
          onclick: function () {
            if (global.TaskDialog && TaskDialog.open) TaskDialog.open(t.id);
          }
        }, [
          el('span', { class: 'cal-time', text: t.dueTime || '全天' }),
          el('i', { class: 'cal-color', style: { background: isDone ? '#10b981' : '#f59e0b' } }),
          el('span', {
            class: 'cal-name',
            style: isDone ? { textDecoration: 'line-through', opacity: '0.65' } : null,
            text: t.title + (cObj ? ' · 📚' + cObj.name : '')
          }),
          el('span', {
            class: 'chip ' + (isDone ? 'chip-green' : 'chip-amber'),
            style: { cursor: 'pointer' },
            title: isDone ? '点击标为未完成' : '点击完成待办',
            onclick: function (evClick) {
              evClick.stopPropagation();
              Store.toggleTask(t.id);
              view.render();
            }
          }, [isDone ? '已完成' : '待办'])
        ]);
        dragTaskToCell(row, t);
        card.appendChild(row);
      });
    }

    /* ---- 时间块补录 ---- */
    card.appendChild(blockEditor(ds));

    /* ---- 待办抽屉：点待办一键划计划块 ---- */
    card.appendChild(taskDrawer(ds));

    if (!courses.length && !events.length && !dueTasks.length && !(mins.sleep + focus + mins.meal + mins.activity)) {
      card.appendChild(el('div', { class: 'q-empty', text: '这一天没有课程、日程、待办或时间记录。' }));
    }

    /* ---- 操作 ---- */
    card.appendChild(el('div', { class: 'cal-actions' }, [
      el('button', {
        class: 'btn btn-sm',
        onclick: function () {
          if (global.openQuadrantAt) global.openQuadrantAt(ds);
          else App.go('tasks', { tab: 'quadrant' });
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

  /* ==========================================================
   * 当天时间块（半小时一格，事后补录）
   * ----------------------------------------------------------
   * 学块时间的做法：不用点「开始 / 结束」，睡前几分钟把一天涂完。
   * 只管「活动」这一类记录；睡眠、用餐、课程画出来但不可改，
   * 免得一次补录把之前在象限里认真填的名字和备注冲掉。
   * ========================================================== */
  var SLOT_N = 48;                 // 一天 48 个半小时

  function hmOfSlot(i) {
    var m = i * 30, h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function slotOfMin(min) {
    var i = Math.floor(min / 30);
    return i < 0 ? 0 : (i > SLOT_N - 1 ? SLOT_N - 1 : i);
  }

  /** 把 [start, end) 涂进槽位；end 早于 start 视为跨到 24:00 */
  function paintRange(slots, start, end, val) {
    var a = TimeUtil.toMin(start), b = TimeUtil.toMin(end);
    if (b <= a) b = 1440;
    var i0 = slotOfMin(a), i1 = slotOfMin(b - 1);
    for (var i = i0; i <= i1 && i < SLOT_N; i++) slots[i] = val;
  }

  function actOf(type) {
    var list = global.ACT_TYPES || [];
    for (var i = 0; i < list.length; i++) if (list[i].value === type) return list[i];
    return { value: type, label: '活动', color: '#94a3b8' };
  }

  /** 读出这一天的槽位：block = 可改，其余只读 */
  function readSlots(ds) {
    var slots = new Array(SLOT_N);
    for (var i = 0; i < SLOT_N; i++) slots[i] = null;
    var d = DateUtil.parse(ds);

    /* 课程：最底层，只读（单次例外生效后的课表，停课/调走的不画） */
    Store.coursesOnDate(ds).forEach(function (c) {
      var t = Store.courseTime(c);
      if (t && t.start && t.end) {
        paintRange(slots, t.start, t.end, { kind: 'course', color: COURSE_COLOR, label: c.name });
      }
    });

    /* 睡眠：跨午夜按所属日切开，只读 */
    var prev = DateUtil.toStr(DateUtil.addDays(d, -1));
    (Store.sleeps || []).forEach(function (r) {
      if (!r.start || !r.end) return;
      if (r.date === ds) paintRange(slots, r.start, r.end, { kind: 'sleep', color: '#6366f1', label: '睡眠' });
      else if (r.date === prev && TimeUtil.toMin(r.end) <= TimeUtil.toMin(r.start)) {
        paintRange(slots, '00:00', r.end, { kind: 'sleep', color: '#6366f1', label: '睡眠' });
      }
    });

    /* 用餐：占开始时间那一格，只读 */
    (Store.meals || []).forEach(function (m) {
      if (m.date !== ds || !m.time) return;
      slots[slotOfMin(TimeUtil.toMin(m.time))] = { kind: 'meal', color: '#ef4444', label: '用餐' };
    });

    /* 活动：象限里手动记的只读，时间块补录/计划块的可改 */
    Store.activitiesOf(ds).forEach(function (a) {
      if (!a.start) return;
      var isBlock = a.from === 'block';
      paintRange(slots, a.start, a.end, {
        kind: isBlock ? 'block' : 'act',
        color: actOf(a.type).color,
        label: (isBlock && a.planned ? '计划 · ' : '') + (isBlock ? actOf(a.type).label : (a.name || '活动')),
        type: a.type,
        taskId: a.taskId || '',
        planned: !!a.planned
      });
    });
    return slots;
  }

  /** 把「时间块」那一层写回 Store（只动 from === 'block' 的记录）。
   *  同类型 + 同关联待办 + 同计划/实际才合并成一条。 */
  function saveBlocks(ds, slots) {
    var runs = [];
    var i = 0;
    while (i < SLOT_N) {
      if (!slots[i] || slots[i].kind !== 'block') { i++; continue; }
      var j = i;
      while (j < SLOT_N && slots[j] && slots[j].kind === 'block' &&
             slots[j].type === slots[i].type &&
             (slots[j].taskId || '') === (slots[i].taskId || '') &&
             !!slots[j].planned === !!slots[i].planned) j++;
      var lbl = actOf(slots[i].type).label;
      runs.push({
        start: hmOfSlot(i), end: hmOfSlot(j),
        type: slots[i].type,
        name: slots[i].planned ? '计划 · ' + lbl : lbl,
        taskId: slots[i].taskId || '',
        planned: !!slots[i].planned
      });
      i = j;
    }
    Store.saveTimeBlocks(ds, runs);
  }

  function blockEditor(ds) {
    var slots = readSlots(ds);
    var bar = el('div', { class: 'tb-bar' });
    var info = el('div', { class: 'tb-info' });
    var wrap = el('div', { class: 'tb-wrap' });

    function blockMin() {
      var n = 0;
      slots.forEach(function (s) { if (s && s.kind === 'block') n++; });
      return n * 30;
    }

    function draw() {
      bar.innerHTML = '';
      for (var i = 0; i < SLOT_N; i++) {
        (function (idx) {
          var s = slots[idx];
          var cls = 'tb-cell' + (idx % 2 === 0 ? ' is-hour' : '') +
                    (s ? ' has' : '') + (s && s.kind === 'block' ? ' editable' : '') +
                    (s && s.planned ? ' plan' : '');
          bar.appendChild(el('div', {
            class: cls,
            style: s ? { background: s.color } : null,
            title: hmOfSlot(idx) + (s ? ' · ' + (s.label || '') : ' · 空'),
            dataset: { slot: String(idx) },
            onclick: function () { pick(idx); }
          }));
        })(i);
      }
      var mins = blockMin();
      info.textContent = mins
        ? '时间块已记 ' + TimeUtil.humanMin(mins) + '（虚线格是计划块，点格子可改或清除）'
        : '点格子补录：一次半小时，也可以一次涂 1 / 2 / 4 小时';
    }

    function apply(idx, span, type, taskId, planned) {
      for (var k = idx; k < idx + span && k < SLOT_N; k++) {
        // 只改「空」和「时间块」这两类格子，课程 / 睡眠 / 手动记录不动
        var cur = slots[k];
        if (cur && cur.kind !== 'block') continue;
        slots[k] = type ? {
          kind: 'block', color: actOf(type).color,
          label: (planned ? '计划 · ' : '') + actOf(type).label,
          type: type, taskId: taskId || '', planned: !!planned
        } : null;
      }
      saveBlocks(ds, slots);
      slots = readSlots(ds);      // 以 Store 为准重画，底层信息才不会被抹掉
      draw();
      view.render();              // 让上面的「记录摘要」跟着变
    }

    function pick(idx) {
      var span = 1;
      var taskId = '';
      var planned = false;
      var m;
      var spanSeg = V.segment([
        { value: '1', label: '半小时' },
        { value: '2', label: '1 小时' },
        { value: '4', label: '2 小时' },
        { value: '8', label: '4 小时' }
      ], '1', function (v) { span = parseInt(v, 10) || 1; });

      var typeBox = el('div', { class: 'tb-types' });
      (global.ACT_TYPES || []).forEach(function (t) {
        typeBox.appendChild(el('button', {
          class: 'tb-type',
          onclick: function () { m.close(); apply(idx, span, t.value, taskId, planned); }
        }, [el('i', { style: { background: t.color } }), t.label]));
      });

      // 关联待办（可选）：划出来的时间就记在这条待办头上
      var pend = Store.pendingTasks().filter(function (t) { return !t.parentId; }).slice(0, 30);
      var taskSel = V.select(
        [{ value: '', label: '不关联待办' }].concat(pend.map(function (t) {
          return { value: t.id, label: t.title };
        })), '');
      taskSel.addEventListener('change', function () { taskId = taskSel.value; });

      // 仅作计划：还没发生的时间安排，不进统计与已投入
      var modeSeg = V.segment([
        { value: 'act', label: '实际投入' },
        { value: 'plan', label: '仅作计划' }
      ], 'act', function (v) { planned = v === 'plan'; });

      m = V.modal({
        title: '这段时间在做什么',
        body: [
          el('div', {
            style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '4px' },
            text: hmOfSlot(idx) + ' 起，选完立刻生效'
          }),
          V.field('涂多久', spanSeg, '半小时一格；一次涂多格会自动合并成一条记录'),
          V.field('类型', typeBox),
          pend.length ? V.field('关联待办', taskSel, '关联后这段时长会记进待办的「已投入」') : null,
          V.field('性质', modeSeg, '「仅作计划」画成虚线格，不进统计，事后可点格子改成实际')
        ].filter(Boolean),
        footer: el('div', { class: 'modal-foot' }, [
          el('button', {
            class: 'btn btn-danger', text: '清除这段',
            onclick: function () { m.close(); apply(idx, span, ''); }
          }),
          el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } })
        ])
      });
    }

    function clearAll() {
      V.confirm({
        title: '清空这天的时间块？',
        message: '只清用时间块补录的部分；在象限里手动记的活动、睡眠、用餐、课程都不动。',
        danger: true, okText: '清空'
      }).then(function (ok) {
        if (!ok) return;
        Store.saveTimeBlocks(ds, []);
        slots = readSlots(ds);
        draw();
        view.render();
        UI.toast('已清空这天的时间块');
      });
    }

    draw();

    wrap.appendChild(el('div', { class: 'cal-sub' }, [
      '时间块',
      el('span', { class: 'q-count', text: '半小时一格 · 事后补录' })
    ]));
    wrap.appendChild(bar);
    wrap.appendChild(info);
    wrap.appendChild(el('div', { class: 'tb-legend' }, [
      (global.ACT_TYPES || []).map(function (t) {
        return el('span', { class: 'tb-lg' }, [el('i', { style: { background: t.color } }), t.label]);
      }),
      el('span', { class: 'tb-lg' }, [el('i', { style: { background: '#6366f1' } }), '睡眠']),
      el('span', { class: 'tb-lg' }, [el('i', { style: { background: '#ef4444' } }), '用餐']),
      el('span', { class: 'tb-lg' }, [el('i', { style: { background: COURSE_COLOR } }), '课程'])
    ]));
    wrap.appendChild(el('div', { class: 'tb-acts' }, [
      el('button', { class: 'btn btn-sm', onclick: clearAll }, ['清空这天的时间块'])
    ]));
    return wrap;
  }

  /* ==========================================================
   * 待办抽屉：点一条待办，就在这天的时间轴上划一块计划
   * 「我想在今天下午专门做待办 A」——不用想半天从几点开始，
   * 先划 1 小时占住，实际做了多少由专注和补录说话。
   * ========================================================== */
  function taskDrawer(ds) {
    var wrap = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });
    var pend = Store.pendingTasks().filter(function (t) { return !t.parentId; });
    // 今天到期 / 已逾期的排前面，同日按截止时间（精确到小时/分钟）排序
    pend.sort(function (a, b) {
      var da = a.dueDate || '9999-99-99', db = b.dueDate || '9999-99-99';
      if (da !== db) return da < db ? -1 : 1;
      var ta = a.dueTime || '23:59', tb = b.dueTime || '23:59';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    // 接力进来的待办优先展示，避免被挤到 8 条之外
    if (relayHighlight) {
      for (var ri = 0; ri < pend.length; ri++) {
        if (pend[ri].id === relayHighlight) {
          pend.unshift(pend.splice(ri, 1)[0]);
          break;
        }
      }
    }
    pend = pend.slice(0, 8);

    wrap.appendChild(el('div', { class: 'section-title' }, [
      '待办抽屉',
      el('span', { class: 'q-count', text: pend.length ? '点一条，划 1 小时计划块' : '' })
    ]));

    if (!pend.length) {
      wrap.appendChild(el('div', { class: 'q-empty', text: '没有未完成的待办，去待办页加一条吧。' }));
      return wrap;
    }

    function actualOn(t) {
      var min = 0;
      (Store.activitiesOfTask(t.id) || []).forEach(function (a) {
        if (a.date === ds && !a.planned) min += TimeUtil.diffMin(a.start, a.end);
      });
      return min;
    }

    pend.forEach(function (t) {
      var planned = Store.taskPlannedOn(t.id, ds);
      var actual = actualOn(t);
      var tag = [];
      if (planned) tag.push('计划 ' + TimeUtil.humanMin(planned));
      if (actual) tag.push('实际 ' + TimeUtil.humanMin(actual));
      var isRelay = relayHighlight && t.id === relayHighlight;
      var row = el('div', {
        class: 'tb-drawer-row' + (isRelay ? ' relay-hl' : ''),
        onclick: function () { paintPlanned(ds, t); }
      }, [
        el('i', { class: 'cal-color', style: { background: '#0ea5e9' } }),
        el('span', { class: 'tb-drawer-name', text: t.title }),
        t.dueDate ? el('span', { class: 'chip', text: DateUtil.human(t.dueDate) + (t.dueTime ? ' ' + t.dueTime : '') }) : null,
        tag.length ? el('span', { class: 'tb-drawer-tag', text: tag.join(' · ') }) : null
      ]);
      // 跨视图桥接：把待办拖到上方任意日期格 → 直接改截止日期
      dragTaskToCell(row, t);
      wrap.appendChild(row);
    });

    if (relayHighlight) {
      var hl = relayHighlight;
      relayHighlight = null;
      var rt = Store.getTask(hl);
      if (rt && relayToastedId !== hl) {
        relayToastedId = hl;
        V.toast('已把「' + rt.title + '」带到日历：拖到某天改期，或点一下排今天', 'info');
      }
      setTimeout(function () {
        var n = wrap.querySelector('.cp-relay-hl');
        if (n && n.scrollIntoView) { try { n.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
      }, 80);
    }
    return wrap;
  }

  /** 在 ds 这天给待办 t 找第一个连续 1 小时空档，划一块「学习」计划块 */
  function paintPlanned(ds, t) {
    var slots = readSlots(ds);
    var now = new Date();
    var startIdx = (ds === DateUtil.toStr(DateUtil.today()))
      ? Math.max(0, slotOfMin(now.getHours() * 60 + now.getMinutes()))
      : slotOfMin(8 * 60);
    var found = -1;
    for (var i = startIdx; i + 1 < SLOT_N; i++) {
      var a = slots[i], b = slots[i + 1];
      if ((!a || a.kind === 'block') && (!b || b.kind === 'block')) { found = i; break; }
    }
    if (found < 0) { UI.toast('这天找不到连续 1 小时的空档', 'err'); return; }
    for (var k = found; k < found + 2; k++) {
      slots[k] = {
        kind: 'block', type: 'study',
        color: actOf('study').color, label: '计划 · 学习',
        taskId: t.id, planned: true
      };
    }
    saveBlocks(ds, slots);
    view.render();
    UI.toast('已为「' + (t.title.length > 10 ? t.title.slice(0, 10) + '…' : t.title) + '」划 1 小时计划块');
  }

  /* ==========================================================
   * 每日长条全景时间轴渲染器（支持「↔️ 横向日条」与「↕️ 纵向日条·横线DDL」双模式）
   * 供日历月视图与四象限月程复用
   * ========================================================== */
  function renderMonthStripCard(opts) {
    opts = opts || {};
    var y = opts.year != null ? opts.year : today0().getFullYear();
    var m = opts.month != null ? opts.month : today0().getMonth();
    var selDs = opts.selectedDate || DateUtil.toStr(today0());
    var dir = opts.dir || 'horiz';
    var filter = opts.filter || 'all';
    var todayStr = DateUtil.toStr(today0());
    var daysInMonth = new Date(y, m + 1, 0).getDate();

    // 汇总当月每一天的 24h 时间轴数据
    var dayList = [];
    var sumRecordedMin = 0, sumPlannedMin = 0, sumSleepMin = 0, sumStudyMin = 0;
    var sumDeadlines = 0, sumPendingDdl = 0;

    for (var d = 1; d <= daysInMonth; d++) {
      var ds = y + '-' + pad(m + 1) + '-' + pad(d);
      var tl = Store.dayTimeline ? Store.dayTimeline(ds) : {
        date: ds, isToday: ds === todayStr, isPast: ds < todayStr, isFuture: ds > todayStr,
        pastBlocks: [], futureBlocks: [], deadlines: [],
        stats: { recordedMin: 0, plannedMin: 0, sleepMin: 0, studyMin: 0, deadlineCount: 0, pendingDeadlines: 0 }
      };
      sumRecordedMin += tl.stats.recordedMin || 0;
      sumPlannedMin += tl.stats.plannedMin || 0;
      sumSleepMin += tl.stats.sleepMin || 0;
      sumStudyMin += tl.stats.studyMin || 0;
      sumDeadlines += tl.stats.deadlineCount || 0;
      sumPendingDdl += tl.stats.pendingDeadlines || 0;
      dayList.push(tl);
    }

    // 过滤要展示的日期行
    var shownDays = dayList.filter(function (tl) {
      if (filter === 'active') {
        return tl.isToday || tl.date === selDs || tl.pastBlocks.length > 0 || tl.futureBlocks.length > 0 || tl.deadlines.length > 0;
      }
      if (filter === 'near14') {
        var diff = Math.abs(DateUtil.diffDays(DateUtil.parse(tl.date), DateUtil.parse(selDs || todayStr)));
        return diff <= 7;
      }
      return true;
    });
    if (!shownDays.length) shownDays = dayList;

    var wrap = el('div', { class: 'card strip-timeline-card', style: { padding: '14px 16px' } });

    // 1. 顶部月程全景统计摘要 + 图例说明
    var summaryGrid = el('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
        gap: '8px',
        marginBottom: '12px'
      }
    }, [
      el('div', { style: { padding: '8px 10px', borderRadius: '8px', background: 'var(--surface-2)', borderLeft: '3px solid #10b981' } }, [
        el('div', { style: { fontSize: '11px', color: 'var(--text-3)' }, text: '回看过去 · 实际记录' }),
        el('b', { style: { fontSize: '15px', color: 'var(--text-1)' }, text: Math.round(sumRecordedMin / 60 * 10) / 10 + ' 小时' }),
        el('div', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: '睡眠 ' + Math.round(sumSleepMin / 60) + 'h · 专注 ' + Math.round(sumStudyMin / 60 * 10) / 10 + 'h' })
      ]),
      el('div', { style: { padding: '8px 10px', borderRadius: '8px', background: 'var(--surface-2)', borderLeft: '3px solid #0ea5e9' } }, [
        el('div', { style: { fontSize: '11px', color: 'var(--text-3)' }, text: '展望将来 · 时间规划' }),
        el('b', { style: { fontSize: '15px', color: 'var(--text-1)' }, text: Math.round(sumPlannedMin / 60 * 10) / 10 + ' 小时' }),
        el('div', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: '排课 + 计划专注块 + 日程' })
      ]),
      el('div', { style: { padding: '8px 10px', borderRadius: '8px', background: 'var(--surface-2)', borderLeft: '3px solid #ef4444' } }, [
        el('div', { style: { fontSize: '11px', color: 'var(--text-3)' }, text: '截止时间点 (DDL)' }),
        el('b', { style: { fontSize: '15px', color: 'var(--text-1)' }, text: sumDeadlines + ' 个截止点' }),
        el('div', { style: { fontSize: '11px', color: sumPendingDdl > 0 ? 'var(--amber)' : 'var(--green)' }, text: sumPendingDdl > 0 ? ('待完成 ' + sumPendingDdl + ' 项') : '全部按期推进' })
      ])
    ]);
    wrap.appendChild(summaryGrid);

    // 2. 图例栏
    var legendBar = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
        padding: '7px 10px', borderRadius: '8px', background: 'var(--bg-2)',
        fontSize: '11.5px', color: 'var(--text-2)', marginBottom: '12px'
      }
    }, [
      el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, [
        el('i', { style: { width: '12px', height: '10px', borderRadius: '3px', background: '#10b981', display: 'inline-block' } }),
        '实心块 = 过去实际做了什么'
      ]),
      el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, [
        el('i', {
          style: {
            width: '12px', height: '10px', borderRadius: '3px',
            border: '1.5px dashed #0ea5e9',
            background: 'repeating-linear-gradient(45deg, rgba(14,165,233,0.12), rgba(14,165,233,0.12) 2px, transparent 2px, transparent 4px)',
            display: 'inline-block'
          }
        }),
        '斜纹虚线块 = 将来计划做什么'
      ]),
      el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, [
        el('i', { style: { width: '14px', height: '2px', background: '#ef4444', display: 'inline-block', position: 'relative' } }),
        '🚩 截止线 = 任务/考试截止时间点'
      ]),
      el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } }, [
        el('i', { style: { width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' } }),
        '当下时刻 (NOW)'
      ])
    ]);
    wrap.appendChild(legendBar);

    if (dir === 'vert') {
      /* ================= 模式 B：纵向每日长条（每天一纵列，横线代表截止时间点 ───🚩───） ================= */
      var vertScroll = el('div', {
        class: 'strip-vert-scroll',
        style: {
          display: 'flex', overflowX: 'auto', gap: '0',
          border: '1px solid var(--line)', borderRadius: '10px', background: 'var(--surface)'
        }
      });

      // 左侧固定 24h 刻度尺
      var rulerCol = el('div', {
        style: {
          flex: '0 0 46px', position: 'sticky', left: '0', zIndex: '4',
          background: 'var(--surface)', borderRight: '1px solid var(--line)',
          paddingTop: '48px', height: '508px', boxSizing: 'border-box'
        }
      });
      var rulerInner = el('div', { style: { position: 'relative', height: '440px' } });
      [0, 4, 8, 12, 16, 20, 24].forEach(function (h) {
        var topPct = (h / 24) * 100;
        rulerInner.appendChild(el('div', {
          style: {
            position: 'absolute', top: topPct + '%', left: '0', right: '4px',
            transform: 'translateY(-50%)', textAlign: 'right',
            fontSize: '10.5px', color: 'var(--text-3)', fontFamily: 'monospace'
          },
          text: pad(h) + ':00'
        }));
      });
      rulerCol.appendChild(rulerInner);
      vertScroll.appendChild(rulerCol);

      shownDays.forEach(function (tl) {
        var dObj = DateUtil.parse(tl.date);
        var isSel = tl.date === selDs;
        var col = el('div', {
          class: 'strip-vert-col' + (tl.isToday ? ' is-today' : '') + (isSel ? ' is-sel' : ''),
          dataset: { date: tl.date },
          style: {
            flex: '0 0 118px', minWidth: '118px',
            borderRight: '1px solid var(--line)',
            background: isSel ? 'rgba(79,70,229,0.04)' : (tl.isToday ? 'rgba(16,185,129,0.03)' : 'transparent'),
            cursor: 'pointer'
          },
          onclick: function () {
            if (opts.onSelectDate) opts.onSelectDate(tl.date);
          }
        });

        // 顶部日期头
        col.appendChild(el('div', {
          style: {
            height: '48px', padding: '4px 6px', borderBottom: '1px solid var(--line)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: tl.isToday ? 'var(--primary-weak)' : 'var(--surface-2)'
          }
        }, [
          el('b', {
            style: { fontSize: '12.5px', color: tl.isToday ? 'var(--primary)' : 'var(--text-1)' },
            text: (dObj.getMonth() + 1) + '/' + dObj.getDate() + ' ' + DateUtil.weekdayCN(dObj).replace('星期', '周')
          }),
          el('span', {
            style: { fontSize: '10px', color: 'var(--text-3)' },
            text: (tl.stats.recordedMin ? ('记' + Math.round(tl.stats.recordedMin / 60 * 10) / 10 + 'h ') : '') +
                  (tl.stats.plannedMin ? ('规' + Math.round(tl.stats.plannedMin / 60 * 10) / 10 + 'h') : (tl.stats.recordedMin ? '' : '空闲'))
          })
        ]));

        // 纵向 24h 画布 (440px 高)
        var track = el('div', {
          style: { position: 'relative', height: '440px', margin: '10px 6px' }
        });

        // 水平参考网格线
        [4, 8, 12, 16, 20].forEach(function (h) {
          track.appendChild(el('div', {
            style: {
              position: 'absolute', top: (h / 24 * 100) + '%', left: '0', right: '0',
              borderTop: '1px dashed var(--line)', opacity: '0.55', pointerEvents: 'none'
            }
          }));
        });

        // 1) 过去实心块
        tl.pastBlocks.forEach(function (b) {
          var topPct = Math.max(0, Math.min(100, b.startMin / 1440 * 100));
          var hPct = Math.max(1.8, Math.min(100 - topPct, b.duration / 1440 * 100));
          track.appendChild(el('div', {
            class: 'strip-blk past',
            title: '[过去记录] ' + b.start + '–' + b.end + ' ' + b.title,
            style: {
              position: 'absolute', top: topPct + '%', height: hPct + '%',
              left: '2px', right: '2px', borderRadius: '4px',
              background: b.color || '#10b981', color: '#fff',
              fontSize: '10px', lineHeight: '1.2', padding: '2px 4px',
              overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.12)', zIndex: '1'
            }
          }, [
            b.duration >= 40 ? el('span', { text: b.start + ' ' + b.title }) : null
          ]));
        });

        // 2) 将来规划虚线块
        tl.futureBlocks.forEach(function (b) {
          var topPct = Math.max(0, Math.min(100, b.startMin / 1440 * 100));
          var hPct = Math.max(2.2, Math.min(100 - topPct, b.duration / 1440 * 100));
          track.appendChild(el('div', {
            class: 'strip-blk future',
            title: '[将来规划] ' + b.start + '–' + b.end + ' ' + b.title,
            style: {
              position: 'absolute', top: topPct + '%', height: hPct + '%',
              left: '2px', right: '2px', borderRadius: '4px',
              border: '1.5px dashed ' + (b.color || '#0ea5e9'),
              background: 'repeating-linear-gradient(45deg, rgba(14,165,233,0.13), rgba(14,165,233,0.13) 3px, rgba(255,255,255,0.6) 3px, rgba(255,255,255,0.6) 6px)',
              color: 'var(--text-1)', fontWeight: '600',
              fontSize: '10px', lineHeight: '1.2', padding: '2px 4px',
              overflow: 'hidden', zIndex: '2'
            }
          }, [
            b.duration >= 35 ? el('span', { text: '⏳ ' + b.start + ' ' + b.title }) : null
          ]));
        });

        // 3) 截止时间点横线（横线代表截止时间点 ───🚩───）
        tl.deadlines.forEach(function (ddl) {
          var topPct = Math.max(1, Math.min(98, ddl.timeMin / 1440 * 100));
          track.appendChild(el('div', {
            class: 'strip-ddl-hline',
            title: '🚩 截止时间点：' + ddl.time + ' · ' + ddl.title + (ddl.done ? '（已完成）' : '（待完成）'),
            style: {
              position: 'absolute', top: topPct + '%', left: '-4px', right: '-4px',
              height: '0', borderTop: '2px solid ' + (ddl.color || '#ef4444'),
              zIndex: '3', display: 'flex', alignItems: 'center', justifyContent: 'flex-end'
            }
          }, [
            el('span', {
              style: {
                background: ddl.color || '#ef4444', color: '#fff',
                fontSize: '9.5px', fontWeight: '700', padding: '1px 4px', borderRadius: '3px',
                transform: 'translateY(-50%)', maxWidth: '106px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
              },
              text: '🚩' + ddl.time + ' ' + ddl.title
            })
          ]));
        });

        // 4) 今日当下时刻横线 (NOW)
        if (tl.isToday && tl.nowMin != null) {
          var nowPct = Math.max(0, Math.min(100, tl.nowMin / 1440 * 100));
          track.appendChild(el('div', {
            title: '当前时刻 ' + tl.nowTime,
            style: {
              position: 'absolute', top: nowPct + '%', left: '-4px', right: '-4px',
              borderTop: '2px solid #22c55e', zIndex: '4'
            }
          }, [
            el('span', {
              style: {
                position: 'absolute', left: '0', top: '-8px',
                background: '#22c55e', color: '#fff', fontSize: '9px',
                fontWeight: '700', padding: '0 4px', borderRadius: '3px'
              },
              text: 'NOW ' + tl.nowTime
            })
          ]));
        }

        col.appendChild(track);
        vertScroll.appendChild(col);
      });

      wrap.appendChild(vertScroll);
      return wrap;
    }

    /* ================= 模式 A：横向每日长条（每天一条 00:00 → 24:00 长条，从上往下排列） ================= */
    var axisHeader = el('div', {
      style: {
        display: 'flex', alignItems: 'center', padding: '0 8px 6px',
        borderBottom: '1px solid var(--line)', fontSize: '11px', color: 'var(--text-3)'
      }
    }, [
      el('div', { style: { flex: '0 0 92px', fontWeight: '600' }, text: '日期 / 负荷' }),
      el('div', { style: { flex: '1', position: 'relative', height: '16px' } }, [0, 6, 12, 18, 24].map(function (h) {
        return el('span', {
          style: {
            position: 'absolute', left: (h / 24 * 100) + '%',
            transform: h === 24 ? 'translateX(-100%)' : (h === 0 ? 'none' : 'translateX(-50%)'),
            fontFamily: 'monospace'
          },
          text: pad(h) + ':00'
        });
      }))
    ]);
    wrap.appendChild(axisHeader);

    var listBox = el('div', {
      class: 'strip-horiz-list',
      style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px', maxHeight: '560px', overflowY: 'auto', paddingRight: '2px' }
    });

    shownDays.forEach(function (tl) {
      var dObj = DateUtil.parse(tl.date);
      var isSel = tl.date === selDs;
      var hol = (global.HolidayCN && Store.settings.showHoliday !== false) ? HolidayCN.lookup(tl.date) : null;

      var rowCard = el('div', {
        class: 'strip-day-row' + (tl.isToday ? ' is-today' : '') + (isSel ? ' is-sel' : ''),
        dataset: { date: tl.date },
        style: {
          padding: '7px 8px', borderRadius: '8px',
          border: '1px solid ' + (isSel ? 'var(--primary)' : (tl.isToday ? '#10b981' : 'var(--line)')),
          background: isSel ? 'var(--primary-weak)' : 'var(--surface-2)',
          cursor: 'pointer'
        },
        onclick: function () {
          if (opts.onSelectDate) opts.onSelectDate(tl.date);
        }
      });

      var topLine = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });

      // 左侧日期与状态标签
      var dateCol = el('div', { style: { flex: '0 0 92px', minWidth: '0' } }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
          el('b', {
            style: { fontSize: '12.5px', color: tl.isToday ? 'var(--primary)' : 'var(--text-1)' },
            text: pad(dObj.getMonth() + 1) + '/' + pad(dObj.getDate())
          }),
          el('span', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: DateUtil.weekdayCN(dObj).replace('星期', '周') }),
          tl.isToday ? el('span', {
            style: { fontSize: '9.5px', background: 'var(--primary)', color: '#fff', padding: '0 4px', borderRadius: '3px' },
            text: '今'
          }) : null,
          hol ? el('span', {
            style: { fontSize: '9.5px', background: hol.type === 'holiday' ? '#ef4444' : '#64748b', color: '#fff', padding: '0 3px', borderRadius: '3px' },
            text: hol.type === 'holiday' ? '休' : '班'
          }) : null
        ]),
        el('div', {
          style: { fontSize: '10.5px', color: 'var(--text-3)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          text: (tl.stats.recordedMin ? ('已记 ' + Math.round(tl.stats.recordedMin / 60 * 10) / 10 + 'h') : '') +
                (tl.stats.recordedMin && tl.stats.plannedMin ? ' · ' : '') +
                (tl.stats.plannedMin ? ('规划 ' + Math.round(tl.stats.plannedMin / 60 * 10) / 10 + 'h') : '') +
                (!tl.stats.recordedMin && !tl.stats.plannedMin ? '暂无记录/规划' : '')
        })
      ]);
      topLine.appendChild(dateCol);

      // 右侧 24 小时横向长条轨道
      var barTrack = el('div', {
        class: 'strip-horiz-track',
        style: {
          flex: '1', position: 'relative', height: '28px',
          borderRadius: '6px', background: 'var(--surface)',
          border: '1px solid var(--line)', overflow: 'visible'
        }
      });

      // 6h / 12h / 18h 刻度参考线
      [6, 12, 18].forEach(function (h) {
        barTrack.appendChild(el('div', {
          style: {
            position: 'absolute', left: (h / 24 * 100) + '%', top: '0', bottom: '0',
            borderLeft: '1px dashed var(--line)', opacity: '0.6', pointerEvents: 'none'
          }
        }));
      });

      // 1) 过去实心时间段
      tl.pastBlocks.forEach(function (b) {
        var leftPct = Math.max(0, Math.min(100, b.startMin / 1440 * 100));
        var widthPct = Math.max(1.2, Math.min(100 - leftPct, b.duration / 1440 * 100));
        barTrack.appendChild(el('div', {
          class: 'strip-hblk past',
          title: '[过去实录] ' + b.start + '–' + b.end + ' · ' + b.title,
          style: {
            position: 'absolute', left: leftPct + '%', width: widthPct + '%',
            top: '2px', bottom: '2px', borderRadius: '4px',
            background: b.color || '#10b981', color: '#fff',
            fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', whiteSpace: 'nowrap', padding: '0 3px', zIndex: '1'
          }
        }, [
          b.duration >= 75 ? el('span', { text: b.title }) : null
        ]));
      });

      // 2) 将来虚线/斜纹规划段
      tl.futureBlocks.forEach(function (b) {
        var leftPct = Math.max(0, Math.min(100, b.startMin / 1440 * 100));
        var widthPct = Math.max(1.5, Math.min(100 - leftPct, b.duration / 1440 * 100));
        barTrack.appendChild(el('div', {
          class: 'strip-hblk future',
          title: '[将来规划] ' + b.start + '–' + b.end + ' · ' + b.title,
          style: {
            position: 'absolute', left: leftPct + '%', width: widthPct + '%',
            top: '2px', bottom: '2px', borderRadius: '4px',
            border: '1.5px dashed ' + (b.color || '#0ea5e9'),
            background: 'repeating-linear-gradient(45deg, rgba(14,165,233,0.15), rgba(14,165,233,0.15) 3px, rgba(255,255,255,0.5) 3px, rgba(255,255,255,0.5) 6px)',
            color: 'var(--text-1)', fontWeight: '600',
            fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', whiteSpace: 'nowrap', padding: '0 3px', zIndex: '2'
          }
        }, [
          b.duration >= 65 ? el('span', { text: b.title }) : null
        ]));
      });

      // 3) 截止时间点标记线 (DDL Cutoff)
      tl.deadlines.forEach(function (ddl) {
        var leftPct = Math.max(1, Math.min(99, ddl.timeMin / 1440 * 100));
        barTrack.appendChild(el('div', {
          class: 'strip-ddl-vline',
          title: '🚩 截止时间点：' + ddl.time + ' · ' + ddl.title + (ddl.done ? '（已完成）' : '（待完成）'),
          style: {
            position: 'absolute', left: leftPct + '%', top: '-4px', bottom: '-4px',
            width: '0', borderLeft: '2.5px solid ' + (ddl.color || '#ef4444'),
            zIndex: '4'
          }
        }, [
          el('span', {
            style: {
              position: 'absolute', top: '-12px', right: '-2px',
              background: ddl.color || '#ef4444', color: '#fff',
              fontSize: '9px', fontWeight: '700', padding: '0 4px', borderRadius: '3px',
              whiteSpace: 'nowrap', boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
            },
            text: '🚩' + ddl.time
          })
        ]));
      });

      // 4) 今日当下时刻刻线 (NOW)
      if (tl.isToday && tl.nowMin != null) {
        var nowPct = Math.max(0, Math.min(100, tl.nowMin / 1440 * 100));
        barTrack.appendChild(el('div', {
          title: '当下时刻 ' + tl.nowTime,
          style: {
            position: 'absolute', left: nowPct + '%', top: '-3px', bottom: '-3px',
            borderLeft: '2px solid #22c55e', zIndex: '5'
          }
        }));
      }

      topLine.appendChild(barTrack);
      rowCard.appendChild(topLine);

      // 若该日有具体事项或被选中，在长条下方展示精炼的「回看做了什么 / 将来做什么 / 截止点」微标签行
      var nonSleepPast = tl.pastBlocks.filter(function (b) { return b.kind !== 'sleep'; });
      if (isSel || nonSleepPast.length || tl.futureBlocks.length || tl.deadlines.length) {
        var detailChips = el('div', {
          style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '5px', paddingLeft: '96px' }
        });
        nonSleepPast.slice(0, 4).forEach(function (b) {
          detailChips.appendChild(el('span', {
            style: { fontSize: '10.5px', padding: '1px 6px', borderRadius: '4px', background: (b.color || '#10b981') + '20', color: 'var(--text-1)' },
            text: '✓ ' + b.start + '-' + b.end + ' ' + b.title
          }));
        });
        tl.futureBlocks.slice(0, 4).forEach(function (b) {
          detailChips.appendChild(el('span', {
            style: { fontSize: '10.5px', padding: '1px 6px', borderRadius: '4px', border: '1px dashed ' + (b.color || '#0ea5e9'), color: 'var(--text-1)' },
            text: '⏳ ' + b.start + '-' + b.end + ' ' + b.title
          }));
        });
        tl.deadlines.forEach(function (ddl) {
          detailChips.appendChild(el('span', {
            style: { fontSize: '10.5px', padding: '1px 6px', borderRadius: '4px', background: (ddl.color || '#ef4444') + '22', color: ddl.color || '#ef4444', fontWeight: '600' },
            text: '🚩 ' + ddl.time + ' 截止：' + ddl.title + (ddl.done ? ' ✓' : '')
          }));
        });
        if (detailChips.childNodes.length) rowCard.appendChild(detailChips);
      }

      listBox.appendChild(rowCard);
    });

    wrap.appendChild(listBox);
    return wrap;
  }

  global.MonthStripTimeline = { render: renderMonthStripCard };

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


