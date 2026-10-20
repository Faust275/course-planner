

/* ==========================================================
 * 视图：日程（未来 7 天安排 + 一次性日程）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;
  var DAYS = 7;

  var viewState = { showCourses: true };

  var view = {
    id: 'agenda',
    name: '日程',
    icon: V.icons.agenda,
    title: '未来 7 天',
    order: 15,
    nav: true,

    root: null,

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'btn', title: viewState.showCourses ? '隐藏课程' : '显示课程',
        onclick: function () {
          viewState.showCourses = !viewState.showCourses;
          view.render();
        }
      }, [V.svg(V.icons.calendar, 16), viewState.showCourses ? '隐藏课程' : '显示课程']));

      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () { EventDialog.open(); }
      }, [V.svg(V.icons.plus, 16), '新建日程']));
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-agenda' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    render: function () {
      var root = this.root;
      root.innerHTML = '';

      var today = DateUtil.today();
      var upcoming = Store.upcomingEvents(DAYS);
      var rows = [];

      for (var i = 0; i < DAYS; i++) {
        var date = DateUtil.addDays(today, i);
        var dateStr = DateUtil.toStr(date);
        var items = [];

        // 课程
        if (viewState.showCourses) {
          Store.coursesOnDay(DateUtil.isoDow(date), Store.weekOf(date)).forEach(function (c) {
            var t = Store.courseTime(c);
            items.push({
              kind: 'course', sort: t ? t.start : '00:00',
              title: c.name, sub: c.location || (c.teacher || ''),
              start: t ? t.start : '—', end: t ? t.end : '—', color: c.color, course: c
            });
          });
        }

        // 考试（由课程里的考试日期自动带过来）
        Store.examsOf(dateStr).forEach(function (e) {
          items.push({
            kind: 'exam', sort: e.start || '08:00',
            title: e.name + ' 考试',
            sub: [e.location, '课程考试'].filter(Boolean).join(' · '),
            start: e.start || '—', end: e.end || '—',
            color: '#ef4444', courseId: e.courseId
          });
        });

        // 一次性日程
        Store.eventsOf(dateStr).forEach(function (e) {
          items.push({
            kind: 'event', sort: e.start, eventId: e.id, done: e.done, important: !!e.important,
            title: e.title, sub: [e.location, e.note].filter(Boolean).join(' · '),
            start: e.start, end: e.end, color: '#ec4899'
          });
        });

        items.sort(function (a, b) {
          if (!!a.important !== !!b.important) return a.important ? -1 : 1;
          return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0;
        });
        rows.push({ date: date, dateStr: dateStr, index: i, items: items });
      }

      /* ---- 概览 ---- */
      var totalEvents = upcoming.length;
      var todayNum = rows[0].items.length;
      var pending = upcoming.filter(function (e) { return !e.done; }).length;

      root.appendChild(el('div', { class: 'task-summary' }, [
        V.statCard(todayNum, '今天安排', 'var(--primary)'),
        V.statCard(totalEvents, '7 天日程', 'var(--blue)'),
        V.statCard(pending, '未完成', 'var(--amber)'),
        V.statCard(DAYS - rows.filter(function (r) { return r.items.length; }).length, '空闲天数', 'var(--green)')
      ]));

      var emptyDays = rows.filter(function (r) { return r.items.length; }).length === 0;

      if (emptyDays) {
        root.appendChild(el('div', { class: 'card' }, [
          V.empty(
            V.icons.agenda, '未来 7 天还很空',
            '可以在这里添加一次性的日程，比如班会、讲座、约饭。每周重复的课请在「课程表」里排。',
            el('button', { class: 'btn btn-primary', onclick: function () { EventDialog.open(); } },
              [V.svg(V.icons.plus, 16), '新建日程'])
          )
        ]));
        return;
      }

      rows.forEach(function (row) {
        var head = el('div', { class: 'group-head' }, [
          el('span', { text: dayTitle(row.date, row.index) }),
          el('span', { class: 'group-count', text: row.items.length ? String(row.items.length) : '空' })
        ]);
        root.appendChild(head);

        if (!row.items.length) {
          root.appendChild(el('div', { class: 'card day-empty' }, [
            el('span', { text: '今天没有安排' })
          ]));
          return;
        }

        var box = el('div', { class: 'card', style: { padding: '4px 6px', marginBottom: '14px' } });
        row.items.forEach(function (it) {
          box.appendChild(el('button', {
            class: 'ag-item' + (it.kind === 'event' && it.done ? ' is-done' : ''),
            onclick: function () {
              if (it.kind === 'course') global.__CourseDialog.detail(it.course.id);
              else if (it.kind === 'exam') { if (it.courseId) global.__CourseDialog.detail(it.courseId); }
              else EventDetail.open(it.eventId);
            }
          }, [
            el('span', { class: 'ag-bar', style: { background: it.color } }),
            el('span', { class: 'ag-time' }, [
              el('b', { text: it.start }),
              el('i', { text: it.end })
            ]),
            el('span', { class: 'ag-main' }, [
              el('span', { class: 'ag-title', text: it.title }),
              it.sub ? el('span', { class: 'ag-sub', text: it.sub }) : null
            ]),
            it.kind === 'course'
              ? el('span', { class: 'chip', text: '课程' })
              : it.kind === 'exam'
                ? el('span', { class: 'chip chip-red', text: '考试' })
                : (it.done ? el('span', { class: 'chip chip-green', text: '已完成' })
                  : el('span', { class: 'chip chip-primary', text: '日程' }))
          ]));
        });
        root.appendChild(box);
      });
    }
  };


  function dayTitle(date, index) {
    var map = ['今天', '明天', '后天'];
    var base = (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + DateUtil.weekdayCN(date);
    if (index < 3) return base + ' · ' + map[index];
    return base;
  }

  /* ==========================================================
   * 日程弹窗：新建 / 编辑
   * ========================================================== */
  var EventDialog = {
    open: function (eventId, preset) {
      var isEdit = !!eventId;
      var e = eventId ? Store.getEvent(eventId) : null;
      var today = DateUtil.toStr(DateUtil.today());

      var fTitle = V.input({
        placeholder: '例如：班会 / 讲座 / 约饭',
        value: e ? e.title : '', dataset: { autofocus: '1' }
      });
      var fDate = V.input({ type: 'date', value: e ? e.date : (preset && preset.date) || today });
      var nowHM = DateUtil.nowHM();
      var fStart = V.input({ type: 'time', value: e ? e.start : nowHM });
      var fEnd = V.input({ type: 'time', value: e ? e.end : TimeUtil.addMin(nowHM, 60) });
      var fLoc = V.input({ placeholder: '可选', value: e ? e.location : '' });
      var fNote = V.textarea({ placeholder: '可选', value: e ? e.note : '' });

      var impOn = e ? !!e.important : false;
      var fImp = el('button', {
        class: 'chip', type: 'button',
        style: impOn ? { background: 'var(--primary)', color: '#fff' } : null,
        text: impOn ? '★ 已标记重要' : '标记为重要',
        onclick: function () {
          impOn = !impOn;
          this.style.background = impOn ? 'var(--primary)' : '';
          this.style.color = impOn ? '#fff' : '';
          this.textContent = impOn ? '★ 已标记重要' : '标记为重要';
        }
      });

      // 快捷选择：今天 / 明天 / 后天
      var quick = el('div', { style: { display: 'flex', gap: '6px', marginTop: '7px' } },
        [{ l: '今天', d: 0 }, { l: '明天', d: 1 }, { l: '后天', d: 2 }, { l: '一周后', d: 7 }].map(function (q) {
          return el('button', {
            class: 'chip', style: { cursor: 'pointer' }, text: q.l,
            onclick: function () { fDate.value = DateUtil.toStr(DateUtil.addDays(DateUtil.today(), q.d)); }
          });
        })
      );

      var body = [
        V.field('日程标题', fTitle),
        V.field('日期', el('div', {}, [fDate, quick])),
        el('div', { class: 'field-row' }, [
          V.field('开始时间', fStart),
          V.field('结束时间', fEnd)
        ]),
        V.field('地点', fLoc),
        V.field('重要日程', fImp, '标记后置顶，并在「今日」页显示倒计时'),
        V.field('备注', fNote)
      ];

      var m = V.modal({
        title: isEdit ? '编辑日程' : '新建一次性日程',
        body: body,
        autofocus: true,
        footer: el('div', { class: 'modal-foot' }, [
          isEdit ? el('button', {
            class: 'btn btn-danger', text: '删除',
            onclick: function () {
              m.close();
              setTimeout(function () {
                V.confirm({ title: '删除日程', message: '确定删除「' + e.title + '」吗？', danger: true, okText: '删除' })
                  .then(function (ok) { if (ok) { Store.removeEvent(eventId); UI.toast('日程已删除'); } });
              }, 220);
            }
          }) : el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
          el('button', {
            class: 'btn btn-primary', text: '保存',
            onclick: function () {
              var d = {
                title: fTitle.value, date: fDate.value,
                start: fStart.value, end: fEnd.value,
                location: fLoc.value, note: fNote.value,
                important: impOn
              };
              if (!d.title.trim()) { UI.toast('请填写日程标题', 'err'); fTitle.focus(); return; }
              if (!d.date) { UI.toast('请选择日期', 'err'); return; }
              if (TimeUtil.toMin(d.end) <= TimeUtil.toMin(d.start)) {
                UI.toast('结束时间需晚于开始时间', 'err'); return;
              }
              if (isEdit) Store.updateEvent(eventId, d);
              else Store.addEvent(d);
              m.close();
              UI.toast(isEdit ? '日程已更新' : '日程已添加');
            }
          })
        ])
      });
    }
  };

  /* ==========================================================
   * 日程详情
   * ========================================================== */
  var EventDetail = {
    open: function (id) {
      var e = Store.getEvent(id);
      if (!e) return;
      var d = DateUtil.parse(e.date);

      var info = el('div', { class: 'preview-box' }, [
        el('div', { style: { fontSize: '15px', fontWeight: '650', marginBottom: '6px' }, text: e.title }),
        el('div', { text: '时间：' + (d ? DateUtil.mdShort(d) + ' ' + DateUtil.weekdayCN(d) : e.date) + ' ' + e.start + '–' + e.end }),
        e.location ? el('div', { text: '地点：' + e.location }) : null,
        e.note ? el('div', { style: { marginTop: '6px' }, text: '备注：' + e.note }) : null,
        el('div', { style: { marginTop: '6px' }, text: '时长：' + TimeUtil.humanMin(TimeUtil.diffMin(e.start, e.end)) })
      ]);

      var m = V.modal({
        title: '日程详情',
        body: [info],
        footer: el('div', { class: 'modal-foot' }, [
          el('button', {
            class: 'btn',
            text: e.done ? '标为未完成' : '标为完成',
            onclick: function () {
              Store.updateEvent(id, { done: !e.done });
              m.close();
              UI.toast(e.done ? '已标为未完成' : '已完成，做得好');
            }
          }),
          el('button', {
            class: 'btn btn-primary', text: '编辑',
            onclick: function () { m.close(); setTimeout(function () { EventDialog.open(id); }, 200); }
          })
        ])
      });
    }
  };

  global.EventDialog = EventDialog;
  global.EventDetail = EventDetail;

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


