/* ==========================================================
 * 视图：课程表（核心排课）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /** 选格模式：在课表上直接点格子排课 */
  var pickMode = false;
  var picked = {};        // 'day|periodId' -> 1

  function pickKey(day, pid) { return day + '|' + pid; }
  function pickCount() { return Object.keys(picked).length; }
  function clearPick() { picked = {}; pickMode = false; }

  /** 顶栏按钮跟着选格模式变化（App.go 只在切页时调 actions，所以手动刷新一次） */
  function refreshActions() {
    var box = V.$('#viewActions');
    if (box) { box.innerHTML = ''; view.actions(box); }
  }

  function togglePick(day, pid) {
    if (!pid) return;
    var k = pickKey(day, pid);
    if (picked[k]) delete picked[k];
    else picked[k] = 1;
    view.render();
  }

  /** 选格模式底部的操作条 */
  function pickBar() {
    var n = pickCount();
    return el('div', { class: 'pick-bar' }, [
      el('div', { class: 'pb-info' }, [
        el('b', { text: n ? ('已选 ' + n + ' 个时段') : '点格子选上课时间' }),
        el('span', { text: n ? '再点一次格子可以取消' : '可以选多天多节，比如周一第 1 节 + 周三第 2 节' })
      ]),
      el('button', {
        class: 'btn btn-sm', text: '取消',
        onclick: function () { clearPick(); view.render(); refreshActions(); }
      }),
      el('button', {
        class: 'btn btn-sm btn-primary', text: '填课程信息',
        onclick: function () {
          var cells = Object.keys(picked).map(function (k) {
            var a = k.split('|');
            return { day: parseInt(a[0], 10), periodId: a[1] };
          });
          if (!cells.length) { UI.toast('先在课表上点几个格子', 'err'); return; }
          CourseDialog.open(null, {
            cells: cells,
            onDone: function () { clearPick(); view.render(); refreshActions(); }
          });
        }
      })
    ]);
  }

  var view = {
    id: 'schedule',
    name: '课程表',
    icon: V.icons.calendar,
    title: '课程表',
    order: 10,
    nav: true,

    root: null,
    week: null,

    /** 顶栏右侧操作按钮（由 App.go 每次切页时调用） */
    actions: function (host) {
      host.appendChild(
        el('button', {
          class: 'btn',
          onclick: function () { App.go('calendar'); }
        }, [V.svg(V.icons.calendar, 16), '月历'])
      );
      host.appendChild(
        el('button', {
          class: 'btn' + (pickMode ? ' btn-on' : ''),
          onclick: function () {
            pickMode = !pickMode;
            if (!pickMode) picked = {};
            view.render();
            var box = V.$('#viewActions');
            if (box) { box.innerHTML = ''; view.actions(box); }
          }
        }, [V.svg(V.icons.grid || V.icons.calendar, 16), pickMode ? '退出选择' : '按节次添加'])
      );
      host.appendChild(
        el('button', {
          class: 'btn',
          onclick: function () { if (global.OcrDialog) global.OcrDialog.open(); }
        }, [V.svg(V.icons.camera, 16), '导入课表'])
      );
      host.appendChild(
        el('button', {
          class: 'btn btn-primary',
          onclick: function () { CourseDialog.open(); }
        }, [V.svg(V.icons.plus, 16), '自定义添加'])
      );
    },

    mount: function (host) {
      var self = this;
      if (this.week == null) this.week = Store.currentWeek();
      this.root = el('section', { class: 'view', id: 'view-schedule' });
      host.appendChild(this.root);

      this.render();
      return this.root;
    },

    onEnter: function () {
      this.week = Store.currentWeek();
      this.render();
    },

    goWeek: function (n) {
      this.week = Math.max(1, n);
      this.render();
    },

    render: function () {
      var self = this;
      var root = this.root;
      root.innerHTML = '';

      var weekNo = this.week;
      var totalWeeks = Store.semester.weeks;
      var weekStart = Store.weekStartDate(weekNo);
      var weekEnd = DateUtil.addDays(weekStart, 6);
      var inTerm = weekNo >= 1 && weekNo <= totalWeeks;

      /* ---- 周切换条 ---- */
      var label = el('div', { class: 'week-label' }, [
        el('span', { text: inTerm ? ('第 ' + weekNo + ' 周') : '假期周' }),
        el('small', { text: DateUtil.mdShort(weekStart) + ' – ' + DateUtil.mdShort(weekEnd) +
          (inTerm ? ('  · 共 ' + totalWeeks + ' 周') : '') })
      ]);

      var weekBar = el('div', { class: 'week-bar' }, [
        el('div', { class: 'week-nav' }, [
          el('button', { class: 'icon-btn', onclick: function () { self.goWeek(weekNo - 1); } }, [V.svg(V.icons.left)]),
          label,
          el('button', { class: 'icon-btn', onclick: function () { self.goWeek(weekNo + 1); } }, [V.svg(V.icons.right)])
        ]),
        el('div', { class: 'week-meta' }, [
          el('span', { class: 'chip ' + (weekNo === Store.currentWeek() ? 'chip-primary' : ''),
            text: weekNo === Store.currentWeek() ? '本周' : '非本周' }),
          el('button', {
            class: 'btn btn-sm', onclick: function () { self.goWeek(Store.currentWeek()); }
          }, ['回到本周'])
        ])
      ]);
      root.appendChild(weekBar);

      /* ---- 学分统计 ---- */
      var crNow = Store.currentCredits();
      var crOld = Store.historyCredits();
      root.appendChild(el('div', { class: 'credit-bar' }, [
        el('div', { class: 'cr-item' }, [
          el('b', { text: String(crNow) }),
          el('span', { text: '本学期学分' })
        ]),
        el('div', { class: 'cr-sep' }),
        el('div', { class: 'cr-item' }, [
          el('b', { text: String(crOld) }),
          el('span', { text: '历史学期学分' })
        ]),
        global.App && App.views.some(function (v) { return v.id === 'grades'; })
          ? el('button', {
              class: 'cr-go',
              onclick: function () { App.go('grades'); }
            }, ['查看成绩 →'])
          : null
      ]));

      /* ---- 本周考试 ---- */
      var exams = Store.examsOfWeek(weekNo);
      if (exams.length) {
        root.appendChild(el('div', { class: 'exam-card' }, [
          el('div', { class: 'exam-title' }, ['本周考试']),
          exams.map(function (e) {
            var tm = e.start ? (e.start + (e.end ? '–' + e.end : '')) : '时间待定';
            return el('div', {
              class: 'exam-row',
              onclick: function () { if (e.courseId) CourseDialog.detail(e.courseId); }
            }, [
              el('i', { class: 'exam-dot', style: { background: e.color || '#ef4444' } }),
              el('b', { text: e.name }),
              el('span', {
                text: Store.DAY_NAMES[e.day - 1] + ' ' + e.date.slice(5) + ' · ' + tm +
                      (e.location ? ' · ' + e.location : '')
              })
            ]);
          })
        ]));
      }

      /* ---- 表格 ---- */
      var matrix = Store.weekMatrix(weekNo);
      var todayStr = DateUtil.toStr(DateUtil.today());

      var thead = el('thead', { class: 'tt-head' });
      var trh = el('tr');
      trh.appendChild(el('th', { class: 'col-time' }));
      for (var d = 1; d <= 7; d++) {
        var date = Store.dateOf(weekNo, d);
        var isToday = DateUtil.toStr(date) === todayStr;
        trh.appendChild(el('th', { class: isToday ? 'today' : '' }, [
          el('div', { class: 'day-cell' }, [
            el('span', { class: 'dow', text: Store.DAY_NAMES[d - 1] }),
            el('span', { class: 'date', text: DateUtil.mdShort(date) })
          ])
        ]));
      }
      thead.appendChild(trh);

      /* 自定义时间的课程：先算出它落在哪几行，用跨行格子显示 */
      var customAt = {};    // 'day|行号' -> { course, span } 或 'covered'
      Store.courses.forEach(function (c) {
        if (c.timeMode !== 'custom' || !c.startTime) return;
        if (!Store.courseInWeek(c, weekNo)) return;
        var first = -1, last = -1;
        Store.periods.forEach(function (p, i) {
          var e = c.endTime || c.startTime;
          if (TimeUtil.toMin(p.start) < TimeUtil.toMin(e) &&
              TimeUtil.toMin(c.startTime) < TimeUtil.toMin(p.end)) {
            if (first < 0) first = i;
            last = i;
          }
        });
        if (first < 0) return;
        var clash = false;
        for (var r = first; r <= last; r++) {
          if (customAt[c.day + '|' + r]) clash = true;
        }
        if (clash) return;                       // 同一天同一时段已有自定义课程
        customAt[c.day + '|' + first] = { course: c, span: last - first + 1 };
        for (var r2 = first + 1; r2 <= last; r2++) customAt[c.day + '|' + r2] = 'covered';
      });

      var tbody = el('tbody', { class: 'tt-body' });
      Store.periods.forEach(function (p, ri) {
        var tr = el('tr');
        tr.appendChild(el('td', { class: 'col-time' }, [
          el('b', { text: p.name }),
          el('span', { text: p.start }),
          document.createElement('br'),
          el('span', { text: p.end })
        ]));

        for (var d = 1; d <= 7; d++) {
          var blk = customAt[d + '|' + ri];
          if (blk === 'covered') continue;       // 被上面的跨行格子占住了

          if (blk) {
            (function (b) {
              var ctd = el('td', {
                class: 'cell has-custom',
                rowspan: b.span,
                onclick: function () { CourseDialog.detail(b.course.id); }
              });
              ctd.appendChild(el('div', { class: 'tcell' }, [self.block(b.course)]));
              tr.appendChild(ctd);
            })(blk);
            continue;
          }

          var key = d + '|' + p.id;
          var list = matrix[key] || [];
          var weekend = d >= 6;
          var isPicked = !!picked[pickKey(d, p.id)];
          var cell = el('td', {
            class: 'cell' + (weekend ? ' we-off' : '') +
                   (pickMode ? ' pickable' : '') + (isPicked ? ' picked' : ''),
            dataset: { day: d, period: p.id },
            onclick: function (e) {
              if (pickMode) {
                if (!e.target.closest('.course-block')) togglePick(+this.dataset.day, this.dataset.period);
                return;
              }
              if (e.target.closest('.course-block')) return;
              CourseDialog.open(null, {
                day: +this.dataset.day,
                periodId: this.dataset.period
              });
            }
          });
          if (pickMode) {
            cell.appendChild(el('span', { class: 'cell-pick' }, [V.svg(V.icons.check, 15)]));
          }

          var holder = el('div', { class: 'tcell' });
          if (list.length) {
            list.forEach(function (c) {
              holder.appendChild(self.block(c));
            });
          } else {
            holder.appendChild(el('div', { class: 'cell-add' }, [V.svg(V.icons.plus, 16)]));
          }
          cell.appendChild(holder);
          tr.appendChild(cell);
        }
        tbody.appendChild(tr);
      });

      var table = el('table', { class: 'tt' }, [thead, tbody]);

      /* ---- 空状态 ---- */
      if (!Store.courses.length) {
        root.appendChild(el('div', { class: 'grid-scroll' }, [table]));
        if (pickMode) root.appendChild(pickBar());
        root.appendChild(V.empty(
          V.icons.book, '还没有课程',
          pickMode
            ? '直接在上面点格子选上课时间，选完点底部「填课程信息」。'
            : '点顶部的「按节次添加」可以在课表上直接选格子排课；也可以先载入一份示例课表看看效果。',
          pickMode ? null : el('button', {
            class: 'btn btn-primary', onclick: function () { Sample.load(); }
          }, [V.svg(V.icons.download, 16), '载入示例课表'])
        ));
        return;
      }

      root.appendChild(el('div', { class: 'grid-scroll' }, [table]));
      if (pickMode) root.appendChild(pickBar());

      /* ---- 图例 ---- */
      var seen = {};
      var uniq = Store.courses.filter(function (c) {
        if (seen[c.name]) return false;
        seen[c.name] = 1; return true;
      }).sort(function (a, b) {
        var ta = Store.courseTime(a), tb = Store.courseTime(b);
        var sa = ta ? ta.start : '99:99', sb = tb ? tb.start : '99:99';
        return a.day - b.day || (sa < sb ? -1 : sa > sb ? 1 : 0);
      });

      var legend = el('div', { class: 'card course-legend' },
        uniq.map(function (c) {
          return el('div', {
            class: 'legend-item', title: '点击查看课程详情',
            style: { cursor: 'pointer' },
            onclick: function () { CourseDialog.detail(c.id); }
          }, [
            el('i', { class: 'legend-dot', style: { background: c.color } }),
            el('b', { text: c.name, style: { fontWeight: '600' } }),
            el('span', { text: (c.location || '—'), style: { color: 'var(--text-3)' } })
          ]);
        })
      );
      root.appendChild(legend);
    },

    block: function (c) {
      var t = Store.courseTime(c);
      var meta = [];
      if (c.location) meta.push(c.location);
      if (t && t.mode === 'custom') meta.unshift(t.start + '-' + t.end);
      else if (t) meta.push(t.start);

      var hasBadge = (c.weekType !== 'all' || c.startWeek > 1 || c.endWeek < Store.semester.weeks);
      var hasExam = !!(c.exam && c.exam.date);

      return el('button', {
        class: 'course-block' + ((hasExam || hasBadge) ? ' has-marks' : ''),
        style: { '--c': c.color },
        title: c.name + ' · ' + (c.teacher || '') + ' · ' + (c.location || '') +
               (hasExam ? '\n考试：' + c.exam.date + ' ' + (c.exam.start || '') : ''),
        onclick: function (e) {
          e.stopPropagation();
          if (pickMode) { togglePick(c.day, c.periodId || ''); return; }
          CourseDialog.detail(c.id);
        }
      }, [
        (hasExam || hasBadge) ? el('span', { class: 'cb-marks' }, [
          hasExam ? el('span', { class: 'cb-exam', text: '考', title: '考试 ' + c.exam.date }) : null,
          hasBadge ? el('span', { class: 'cb-badge', text: Store.weekTypeText(c.weekType).slice(0, 1) }) : null
        ]) : null,
        el('span', {
          class: 'cb-name',
          style: (hasExam || hasBadge) ? { paddingRight: (hasExam ? 21 : 16) + 'px' } : null,
          text: c.name
        }),
        meta.length ? el('span', { class: 'cb-meta', text: meta.join(' · ') }) : null
      ]);
    }
  };

  /* ==========================================================
   * 课程新增 / 编辑 / 详情弹窗
   * ========================================================== */
  var CourseDialog = {
    open: function (courseId, preset) {
      preset = preset || {};
      var isEdit = !!courseId;
      var c = courseId ? Store.getCourse(courseId) : null;
      var data = {
        name: c ? c.name : '',
        teacher: c ? c.teacher : '',
        location: c ? c.location : '',
        color: c ? c.color : Store.COLORS[Store.courses.length % Store.COLORS.length],
        day: c ? c.day : (preset.day || 1),
        periodId: c ? c.periodId : (preset.periodId || (Store.periods[0] && Store.periods[0].id)),
        startWeek: c ? c.startWeek : 1,
        endWeek: c ? c.endWeek : Store.semester.weeks,
        weekType: c ? c.weekType : 'all',
        note: c ? c.note : '',
        credit: c ? (c.credit || 0) : 0,
        exam: c ? c.exam : null
      };

      var timeMode = c ? (c.timeMode || 'period') : 'period';

      /* ---------- 按节次：在「星期 × 节次」网格里直接点格子 ---------- */
      var picked = {};      // 'day|periodId' -> 1
      if (preset.cells && preset.cells.length) {
        // 课表上直接选的格子
        preset.cells.forEach(function (cc) { picked[cellKey(cc.day, cc.periodId)] = 1; });
      } else {
        var startKey = data.day + '|' + data.periodId;
        if (data.periodId && (timeMode === 'period' || isEdit)) picked[startKey] = 1;
      }

      var gridRedraws = [];

      function cellKey(day, pid) { return day + '|' + pid; }

      function toggleCell(day, pid) {
        var k = cellKey(day, pid);
        if (picked[k]) {
          if (isEdit) return;                 // 编辑时至少留一格
          delete picked[k];
        } else {
          if (isEdit) picked = {};            // 编辑：换成新选的这一格
          picked[k] = 1;
        }
        redrawGrid();
        updateCount();
      }

      function toggleCol(day) {
        if (isEdit) return;
        var all = true;
        Store.periods.forEach(function (p) { if (!picked[cellKey(day, p.id)]) all = false; });
        Store.periods.forEach(function (p) {
          var k = cellKey(day, p.id);
          if (all) delete picked[k]; else picked[k] = 1;
        });
        redrawGrid();
        updateCount();
      }

      function toggleRow(pid) {
        if (isEdit) return;
        var all = true;
        for (var d = 1; d <= 7; d++) { if (!picked[cellKey(d, pid)]) all = false; }
        for (var d2 = 1; d2 <= 7; d2++) {
          var k = cellKey(d2, pid);
          if (all) delete picked[k]; else picked[k] = 1;
        }
        redrawGrid();
        updateCount();
      }

      function countEl() { return V.$('#fPickCount'); }

      function updateCount() {
        var n = Object.keys(picked).length;
        var e = countEl();
        if (e) e.textContent = n ? ('已选 ' + n + ' 个时段') : '还没有选时段';
      }

      /** 网格：行首点整行、列头点整列、格子单独选 */
      function buildGridPick() {
        var wrap = el('div', { class: 'grid-pick' });

        var head = el('div', { class: 'gp-head' });
        head.appendChild(el('span', { class: 'gp-corner' }));
        Store.DAY_NAMES.forEach(function (n, i) {
          head.appendChild(el('button', {
            class: 'gp-col', type: 'button', text: n,
            title: '选中/取消这一整天',
            onclick: function () { toggleCol(i + 1); }
          }));
        });
        wrap.appendChild(head);

        Store.periods.forEach(function (p) {
          var row = el('div', { class: 'gp-row' });
          row.appendChild(el('button', {
            class: 'gp-row-label', type: 'button',
            title: '选中/取消这一整节',
            onclick: function () { toggleRow(p.id); }
          }, [
            el('b', { text: p.name }),
            el('span', { text: p.start })
          ]));
          for (var d = 1; d <= 7; d++) {
            (function (day, pid) {
              var cell = el('button', {
                class: 'gp-cell' + (picked[cellKey(day, pid)] ? ' on' : ''),
                type: 'button',
                dataset: { k: cellKey(day, pid) },
                title: Store.DAY_NAMES[day - 1] + ' ' + p.name,
                onclick: function () { toggleCell(day, pid); }
              }, [V.svg(V.icons.check, 12)]);
              row.appendChild(cell);
            })(d, p.id);
          }
          wrap.appendChild(row);
        });
        return wrap;
      }

      function redrawGrid() {
        gridRedraws.forEach(function (fn) { fn(); });
      }

      var gridPick = buildGridPick();
      gridRedraws.push(function () {
        V.$$('.gp-cell', gridPick).forEach(function (b) {
          b.classList.toggle('on', !!picked[b.dataset.k]);
        });
      });

      var pickCount = el('div', { class: 'ocr-hint', id: 'fPickCount', text: '' });

      var periodBox = el('div', { class: 'tm-sub' }, [
        gridPick,
        pickCount,
        el('div', {
          class: 'ocr-hint',
          text: isEdit
            ? '点格子可以把这门课挪到别的时间。'
            : '想上几节课就点几个格子，比如「周一第 1 节」加「周三第 2 节」。点顶部的「周一」选中一整天，点左边的「第1节」选中这一节的七天。'
        })
      ]);

      /* ---------- 自定义时间：星期多选 + 起止时间 ---------- */
      var selDays = [data.day];
      var dayRedraws = [];

      function chipPick(items, selected, opts) {
        opts = opts || {};
        var wrap = el('div', { class: 'chip-pick' + (opts.grid ? ' ' + opts.grid : '') });
        items.forEach(function (it) {
          var b = el('button', {
            class: 'cp-item' + (selected.indexOf(it.value) >= 0 ? ' on' : ''),
            type: 'button',
            onclick: function () {
              var i = selected.indexOf(it.value);
              if (i >= 0) {
                if (opts.minOne && selected.length <= 1) return;
                selected.splice(i, 1);
              } else {
                if (opts.single) selected.length = 0;
                selected.push(it.value);
              }
              dayRedraws.forEach(function (fn) { fn(); });
            }
          }, [
            el('span', { class: 'cp-label', text: it.label }),
            it.sub ? el('span', { class: 'cp-sub', text: it.sub }) : null
          ]);
          b._v = it.value;
          wrap.appendChild(b);
        });
        dayRedraws.push(function () {
          V.$$('.cp-item', wrap).forEach(function (b) {
            b.classList.toggle('on', selected.indexOf(b._v) >= 0);
          });
        });
        return wrap;
      }

      var dayPick = chipPick(
        Store.DAY_NAMES.map(function (n, i) { return { value: i + 1, label: n }; }),
        selDays, { minOne: true, single: isEdit, grid: 'days' }
      );

      var fStart = V.input({ type: 'time', value: (c && c.startTime) || '08:00' });
      var fEnd = V.input({ type: 'time', value: (c && c.endTime) || '09:40' });

      var customBox = el('div', { class: 'tm-sub' }, [
        V.field('星期几（可多选）', dayPick),
        el('div', { class: 'field-row' }, [V.field('开始时间', fStart), V.field('结束时间', fEnd)]),
        el('div', {
          class: 'ocr-hint',
          text: '不受「设置 → 课程时间」里的节次限制，比如 09:10-10:30 的实习课，课表里会按时间跨行显示。'
        })
      ]);

      var fMode = V.segment(
        [{ value: 'period', label: '按节次' }, { value: 'custom', label: '自定义时间' }],
        timeMode,
        function (v) {
          timeMode = v;
          periodBox.style.display = v === 'period' ? '' : 'none';
          customBox.style.display = v === 'custom' ? '' : 'none';
        }
      );
      periodBox.style.display = timeMode === 'period' ? '' : 'none';
      customBox.style.display = timeMode === 'custom' ? '' : 'none';

      var fName = V.input({ placeholder: '例如：高等数学 A', value: data.name, dataset: { autofocus: '1' } });
      var fTeacher = V.input({ placeholder: '可选', value: data.teacher });
      var fLocation = V.input({ placeholder: '例如：教三 301', value: data.location });
      var fNote = V.textarea({ placeholder: '可选，例如：需要带教材', value: data.note });
      var colorBox = V.colorPicker(data.color, function (v) { data.color = v; });
      var fWT = V.segment(
        [{ value: 'all', label: '每周' }, { value: 'odd', label: '单周' }, { value: 'even', label: '双周' }],
        data.weekType, function (v) { data.weekType = v; }
      );

      var fCredit = V.input({
        type: 'number', min: '0', max: '30', step: '0.5',
        value: data.credit || '', placeholder: '例如：3'
      });
      var fExamDate = V.input({ type: 'date', value: (data.exam && data.exam.date) || '' });
      var fExamStart = V.input({ type: 'time', value: (data.exam && data.exam.start) || '' });
      var fExamEnd = V.input({ type: 'time', value: (data.exam && data.exam.end) || '' });

      var body = [
        V.field('课程名称', fName),
        el('div', { class: 'field-row' }, [
          V.field('任课教师', fTeacher),
          V.field('上课地点', fLocation)
        ]),
        V.field('上课时间', el('div', { class: 'tm-box' }, [fMode, periodBox, customBox])),
        el('div', { class: 'field-row' }, [
          V.field('学分', fCredit, '填了会自动出现在「成绩」里'),
          V.field('考试日期', fExamDate, '会同时显示在课程表和日程上')
        ]),
        el('div', { class: 'field-row' }, [
          V.field('考试开始', fExamStart),
          V.field('考试结束', fExamEnd)
        ]),
        el('div', { class: 'field-row' }, [
          V.field('起始周', V.input({ type: 'number', id: 'fSW', min: '1', max: String(Store.semester.weeks), value: data.startWeek })),
          V.field('结束周', V.input({ type: 'number', id: 'fEW', min: '1', max: String(Store.semester.weeks), value: data.endWeek }))
        ]),
        el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', margin: '-8px 0 14px' },
          text: '学期共 ' + Store.semester.weeks + ' 周，填 1 与 ' + Store.semester.weeks + ' 即整学期' }),
        V.field('单 / 双周', fWT),
        V.field('课程颜色', colorBox),
        V.field('备注', fNote)
      ];

      var m = V.modal({
        title: isEdit ? '编辑课程' : '添加课程',
        body: body,
        width: '560px',
        autofocus: true,
        footer: el('div', { class: 'modal-foot' }, [
          isEdit ? el('button', {
            class: 'btn btn-danger', text: '删除',
            onclick: function () {
              m.close();
              setTimeout(function () {
                V.confirm({ title: '删除课程', message: '确定删除「' + (Store.getCourse(courseId) || {}).name + '」吗？该操作不可撤销。', danger: true, okText: '删除' })
                  .then(function (ok) { if (ok) { Store.removeCourse(courseId); UI.toast('已删除课程'); } });
              }, 220);
            }
          }) : el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
          el('button', { class: 'btn btn-primary', text: '保存', onclick: function () { save(); } })
        ])
      });

      updateCount();

      function weekPair() {
        var sw = Math.max(1, parseInt(V.$('#fSW').value, 10) || 1);
        var ew = Math.min(Store.semester.weeks, parseInt(V.$('#fEW').value, 10) || Store.semester.weeks);
        return sw > ew ? { startWeek: ew, endWeek: sw } : { startWeek: sw, endWeek: ew };
      }

      function save() {
        var name = fName.value.trim();
        if (!name) { UI.toast('请填写课程名称', 'err'); fName.focus(); return; }
        var wk = weekPair();

        var examDate = fExamDate.value;
        var base = {
          name: name,
          teacher: fTeacher.value.trim(),
          location: fLocation.value.trim(),
          color: data.color,
          credit: Math.max(0, parseFloat(fCredit.value) || 0),
          exam: examDate ? { date: examDate, start: fExamStart.value || '', end: fExamEnd.value || '' } : null,
          weekType: data.weekType,
          note: fNote.value.trim(),
          startWeek: wk.startWeek,
          endWeek: wk.endWeek
        };

        if (timeMode === 'custom') {
          var st = fStart.value, en = fEnd.value;
          if (!st || !en) { UI.toast('请填写开始和结束时间', 'err'); return; }
          if (en <= st) { UI.toast('结束时间要晚于开始时间', 'err'); return; }
          if (!selDays.length) { UI.toast('请至少选一天', 'err'); return; }
          if (isEdit) {
            Store.updateCourse(courseId, Object.assign({}, base, {
              day: selDays[0], timeMode: 'custom', startTime: st, endTime: en, periodId: ''
            }));
            m.close();
            UI.toast('课程已更新');
          } else {
            selDays.forEach(function (day) {
              Store.addCourse(Object.assign({}, base, {
                day: day, timeMode: 'custom', startTime: st, endTime: en
              }));
            });
            m.close();
            UI.toast('已添加 ' + selDays.length + ' 节课');
            if (preset.onDone) preset.onDone();
          }
          return;
        }

        // 按节次：每个选中的格子生成一节课
        var combos = Object.keys(picked).map(function (k) {
          var parts = k.split('|');
          return { day: parseInt(parts[0], 10), periodId: parts[1] };
        });
        if (!combos.length) { UI.toast('请先选至少一个时段', 'err'); return; }

        var order = Store.periods.map(function (p) { return p.id; });
        combos.sort(function (a, b) {
          return a.day - b.day || order.indexOf(a.periodId) - order.indexOf(b.periodId);
        });

        if (isEdit) {
          Store.updateCourse(courseId, Object.assign({}, base, {
            day: combos[0].day, timeMode: 'period',
            periodId: combos[0].periodId, startTime: '', endTime: ''
          }));
          m.close();
          UI.toast('课程已更新');
        } else {
          combos.forEach(function (cb) {
            Store.addCourse(Object.assign({}, base, {
              day: cb.day, timeMode: 'period', periodId: cb.periodId
            }));
          });
          m.close();
          UI.toast('已添加 ' + combos.length + ' 节课');
          if (preset.onDone) preset.onDone();
        }
      }
    },

    /** 课程详情（只读卡 + 编辑入口 + 相关作业入口） */
    detail: function (courseId) {
      var c = Store.getCourse(courseId);
      if (!c) return;
      var t = Store.courseTime(c);
      var p = t ? { name: t.label, start: t.start, end: t.end } : { name: '—', start: '', end: '' };
      var tasks = Store.tasks.filter(function (t) { return t.courseId === courseId; });
      var timeLine = Store.DAY_NAMES[c.day - 1] + ' ' +
        (t && t.mode === 'custom' ? (t.start + '–' + t.end) : (p.name + '　' + p.start + '–' + p.end));

      var info = el('div', {
        class: 'preview-box',
        html:
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
          '<i style="width:12px;height:12px;border-radius:4px;background:' + c.color + ';display:inline-block"></i>' +
          '<b style="font-size:15px">' + V.escapeHTML(c.name) + '</b></div>' +
          '<div>时间：' + timeLine + '</div>' +
          '<div>周次：第 ' + c.startWeek + '–' + c.endWeek + ' 周（' + Store.weekTypeText(c.weekType) + '）</div>' +
          (c.credit > 0 ? '<div>学分：' + c.credit + '</div>' : '') +
          (c.exam && c.exam.date
            ? '<div>考试：' + c.exam.date + (c.exam.start ? ' ' + c.exam.start + (c.exam.end ? '–' + c.exam.end : '') : '') + '</div>'
            : '') +
          (c.teacher ? '<div>教师：' + V.escapeHTML(c.teacher) + '</div>' : '') +
          (c.location ? '<div>地点：' + V.escapeHTML(c.location) + '</div>' : '') +
          (c.note ? '<div style="margin-top:6px">备注：' + V.escapeHTML(c.note) + '</div>' : '')
      });

      var taskList = el('div', { class: 'card', style: { padding: '10px 12px' } });
      if (!tasks.length) {
        taskList.appendChild(el('div', { text: '这门课暂无作业/待办', style: { fontSize: '12.5px', color: 'var(--text-3)' } }));
      } else {
        tasks.forEach(function (t) {
          taskList.appendChild(el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', fontSize: '13px' }
          }, [
            el('i', { style: { width: '6px', height: '6px', borderRadius: '50%', background: UI.hStatusColor(t), flex: '0 0 6px' } }),
            el('span', { text: t.title, style: { flex: '1', textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--text-3)' : 'var(--text)' } }),
            el('span', { text: t.dueDate ? DateUtil.human(t.dueDate) : '—', style: { fontSize: '11.5px', color: 'var(--text-3)' } })
          ]));
        });
      }

      var m = V.modal({
        title: '课程详情',
        body: [
          info,
          V.field('作业与待办', taskList)
        ],
        footer: el('div', { class: 'modal-foot' }, [
          el('button', {
            class: 'btn btn-danger', text: '删除',
            onclick: function () {
              m.close();
              setTimeout(function () {
                V.confirm({
                  title: '删除课程',
                  message: '确定删除「' + c.name + '」吗？该课程下的作业会保留，但不再关联课程。',
                  danger: true, okText: '删除'
                }).then(function (ok) { if (ok) { Store.removeCourse(courseId); UI.toast('已删除课程'); } });
              }, 220);
            }
          }),
          el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } }),
          el('button', { class: 'btn btn-primary', text: '编辑课程', onclick: function () { m.close(); setTimeout(function () { CourseDialog.open(courseId); }, 200); } })
        ])
      });
    }
  };

  /* ==========================================================
   * 示例数据
   * ========================================================== */
  var Sample = {
    load: function () {
      var ps = Store.periods;
      var W = Store.semester.weeks;
      if (ps.length < 8) { UI.toast('节次太少，无法载入示例', 'err'); return; }
      var rows = [
        ['高等数学 A', '王敏', '教三 301', 1, 0, '#4f46e5', 'all'],
        ['大学英语', '李娜', '外语楼 204', 1, 2, '#0ea5e9', 'all'],
        ['数据结构', '陈昊', '信息楼 A105', 2, 0, '#10b981', 'all'],
        ['数据结构实验', '陈昊', '机房 3-12', 2, 4, '#10b981', 'odd'],
        ['线性代数', '周涛', '教二 108', 3, 2, '#f59e0b', 'all'],
        ['计算机网络', '吴桐', '信息楼 B203', 4, 0, '#8b5cf6', 'all'],
        ['体育（篮球）', '赵刚', '体育馆', 4, 6, '#14b8a6', 'all'],
        ['马克思主义基本原理', '孙玉', '教四 402', 5, 2, '#ef4444', 'all'],
        ['操作系统', '林峰', '信息楼 A307', 5, 4, '#ec4899', 'even']
      ];
      rows.forEach(function (r) {
        Store.addCourse({
          name: r[0], teacher: r[1], location: r[2], day: r[3],
          periodId: ps[r[4]].id, startWeek: 1, endWeek: W, weekType: r[6], color: r[5]
        });
      });
      UI.toast('已载入示例课表');
      setTimeout(function () {
        var host = document.getElementById('views');
        if (host) host.scrollTop = 0;
      }, 60);
    }
  };

  global.UI.hStatusColor = function (t) {
    return t.status === 'done' ? 'var(--text-3)' : (t.status === 'doing' ? 'var(--amber)' : 'var(--primary)');
  };

  global.__CourseDialog = CourseDialog;
  global.__SampleData = Sample;

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);
