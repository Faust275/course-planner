

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
  var calTab = 'calendar';   // 分页：calendar 日历 / agenda 日程（日程来自 agenda.js 的 AgendaPane）

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
    setTab: function (t) { calTab = (t === 'agenda') ? 'agenda' : 'calendar'; this.render(); },

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
      root.innerHTML = '';
      ensureCursor();

      /* ---- 分页：日历 / 日程 ---- */
      var paneBar = el('div', { class: 'pane-tabs' });
      [
        { v: 'calendar', l: '日历' },
        { v: 'agenda', l: '日程' }
      ].forEach(function (x) {
        paneBar.appendChild(el('button', {
          class: 'pane-tab' + (calTab === x.v ? ' active' : ''),
          text: x.l,
          onclick: function () { calTab = x.v; view.render(); }
        }));
      });
      root.appendChild(paneBar);

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
            onclick: function () { App.go('calendar', { tab: 'agenda' }); }
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
    var courses = Store.coursesOnDate(ds);
    var events = Store.eventsOf(ds);
    var examCourses = (Store.courses || []).filter(function (c) { return c.exam && c.exam.date === ds; });

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
        events.length ? el('i', { class: 'dot event', title: events.length + ' 个日程' }) : null,
        examCourses.length ? el('i', {
          class: 'dot exam',
          title: '考试：' + examCourses.map(function (c) { return c.name; }).join('、')
        }) : null
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

    /* ---- 时间块补录 ---- */
    card.appendChild(blockEditor(ds));

    /* ---- 待办抽屉：点待办一键划计划块 ---- */
    card.appendChild(taskDrawer(ds));

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
        paintRange(slots, t.start, t.end, { kind: 'course', color: c.color, label: c.name });
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
      el('span', { class: 'tb-lg' }, [el('i', { style: { background: '#cbd5e1' } }), '课程'])
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
    // 今天到期 / 已逾期的排前面，其余按截止日期
    pend.sort(function (a, b) {
      var da = a.dueDate || '9999-99-99', db = b.dueDate || '9999-99-99';
      return da < db ? -1 : da > db ? 1 : 0;
    });
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
      wrap.appendChild(el('div', {
        class: 'tb-drawer-row',
        onclick: function () { paintPlanned(ds, t); }
      }, [
        el('i', { class: 'cal-color', style: { background: '#0ea5e9' } }),
        el('span', { class: 'tb-drawer-name', text: t.title }),
        t.dueDate ? el('span', { class: 'chip', text: DateUtil.human(t.dueDate) }) : null,
        tag.length ? el('span', { class: 'tb-drawer-tag', text: tag.join(' · ') }) : null
      ]));
    });
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

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


