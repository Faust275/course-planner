

/* ==========================================================
 * 视图：今日（今天有什么课 / 什么作业该交了）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  function timeToDate(hhmm) {
    var p = (hhmm || '00:00').split(':');
    var d = DateUtil.today();
    d.setHours(+p[0] || 0, +p[1] || 0, 0, 0);
    return d;
  }

  var view = {
    id: 'today',
    name: '今日',
    icon: V.icons.today,
    title: '今日',
    order: 5,
    nav: true,

    root: null,

    actions: function (host) {
      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () { TaskDialog.open(); }
      }, [V.svg(V.icons.plus, 16), '新建待办']));
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-today' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    render: function () {
      var root = this.root;
      root.innerHTML = '';

      var now = new Date();
      var today = DateUtil.today();
      var dow = DateUtil.isoDow(today);
      var weekNo = Store.currentWeek();
      var inTerm = weekNo >= 1 && weekNo <= Store.semester.weeks;
      var courses = Store.coursesOnDay(dow, weekNo);
      var todayTasks = Store.todayTasks();
      var overdue = Store.overdueTasks();

      /* ---------- 问候卡 ---------- */
      var hour = now.getHours();
      var greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
      var hero = el('div', {
        class: 'card hero',
        style: {
          color: '#fff', border: 'none',
          marginBottom: '16px'
        }
      }, [
        el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' } }, [
          el('div', { style: { flex: '1', minWidth: '180px' } }, [
            el('div', { style: { fontSize: '12.5px', opacity: '.82', marginBottom: '4px' },
              text: greet + '，今天也要好好上课' }),
            el('div', { style: { fontSize: '24px', fontWeight: '700', letterSpacing: '.4px', lineHeight: '1.25' },
              text: (today.getMonth() + 1) + ' 月 ' + today.getDate() + ' 日 · ' + Store.DAY_NAMES[dow - 1] }),
            el('div', { style: { fontSize: '12.5px', opacity: '.86', marginTop: '4px' },
              text: !inTerm ? '学期外 · 假期愉快' : (courses.length ? ('第 ' + weekNo + ' 周 · 今天 ' + courses.length + ' 节课') : ('第 ' + weekNo + ' 周 · 今天没有课')) })
          ]),
          el('div', { class: 'hero-stats', style: { display: 'flex', gap: '18px', textAlign: 'center' } }, [
            statBlock(courses.length, '今日课程'),
            statBlock(todayTasks.length + overdue.length, '待完成'),
            statBlock(doneTodayCount(), '今日已完成')
          ])
        ])
      ]);
      root.appendChild(hero);

      /* ---------- 倒数纪念日 ---------- */
      (function () {
        var anns = Store.anniversaries();
        if (!anns.length) return;
        // 只显示 60 天内的，或最近的 3 条
        var near = anns.filter(function (a) { return a.daysLeft <= 60; });
        if (!near.length) near = anns.slice(0, 3);
        near = near.slice(0, 4);

        var KIND_ICON = { birthday: '🎂', anniversary: '💝', countdown: '⏳' };
        root.appendChild(el('div', { class: 'card anniv-card' }, [
          el('div', { class: 'anniv-head' }, [
            el('span', { class: 'anniv-title', text: '倒数纪念日' }),
            el('button', {
              class: 'link-btn', text: '全部 ›',
              onclick: function () { App.go('agenda'); }
            })
          ]),
          el('div', { class: 'anniv-list' }, near.map(function (a) {
            var e = a.ev;
            var days = a.daysLeft;
            return el('div', {
              class: 'anniv-row' + (days === 0 ? ' is-today' : ''),
              dataset: { rec: 'event:' + e.id },
              onclick: function () { if (global.openAnnivDialog) global.openAnnivDialog(e.id); }
            }, [
              el('span', { class: 'anniv-ico', text: KIND_ICON[e.kind] || '🎉' }),
              el('div', { class: 'anniv-main' }, [
                el('div', { class: 'anniv-name', text: e.title }),
                el('div', { class: 'anniv-sub', text: a.next + (e.lunar ? ' · 农历' : '') + (e.repeat === 'yearly' && a.nth > 1 ? ' · 第 ' + a.nth + ' 年' : '') })
              ]),
              el('div', { class: 'anniv-days' + (days <= 7 ? ' near' : '') }, [
                el('b', { text: days === 0 ? '今天' : String(days) }),
                days === 0 ? null : el('span', { text: '天' })
              ])
            ]);
          }))
        ]));
      })();
      if (global.DailyCards) root.appendChild(DailyCards.section());

      /* ---------- 最近的重要日程倒计时 ---------- */
      (function () {
        var todayStr = DateUtil.toStr(today);
        var items = [];
        Store.tasks.forEach(function (t) {
          if (!t.important || t.status === 'done') return;
          var d = t.dueDate || todayStr;
          items.push({ kind: 'task', title: t.title, date: d, time: t.dueTime || '23:59' });
        });
        Store.events.forEach(function (e) {
          if (!e.important || e.done) return;
          items.push({ kind: 'event', title: e.title, date: e.date, time: e.start || '00:00' });
        });
        Store.plans.forEach(function (pl) {
          if (!pl.important || pl.done) return;
          var sd = DateUtil.parse(pl.startDate);
          var ed = sd ? DateUtil.addDays(sd, (pl.days || 1) - 1) : null;
          items.push({ kind: 'plan', title: pl.title, date: ed ? DateUtil.toStr(ed) : pl.startDate, time: '23:59' });
        });
        items = items.filter(function (x) { return x.date >= todayStr; })
          .sort(function (a, b) {
            var aa = a.date + ' ' + a.time, bb = b.date + ' ' + b.time;
            return aa < bb ? -1 : aa > bb ? 1 : 0;
          });
        var near = items[0];
        if (!near) return;
        function fmt() {
          var target = new Date(near.date.replace(/-/g, '/') + ' ' + near.time);
          var diff = target.getTime() - Date.now();
          if (diff <= 0) return '已到期';
          var dd = Math.floor(diff / 86400000);
          var hh = Math.floor((diff % 86400000) / 3600000);
          var mm = Math.floor((diff % 3600000) / 60000);
          if (dd > 0) return dd + ' 天 ' + hh + ' 时';
          if (hh > 0) return hh + ' 时 ' + mm + ' 分';
          return mm + ' 分钟';
        }
        var val = el('b', { style: { fontSize: '19px', color: 'var(--primary)' }, text: fmt() });
        var card = el('div', {
          class: 'card',
          style: { display: 'flex', alignItems: 'center', gap: '14px', padding: '13px 16px', marginBottom: '16px', cursor: 'pointer', borderLeft: '4px solid var(--primary)' },
          onclick: function () {
            if (near.kind === 'task') App.go('tasks');
            else if (near.kind === 'event') App.go('agenda');
            else App.go('plans');
          }
        }, [
          el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)' }, text: '★ 最近的重要日程' }),
            el('div', { style: { fontSize: '14.5px', fontWeight: '650', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, text: near.title }),
            el('div', { style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '2px' }, text: near.date + ' ' + near.time })
          ]),
          el('div', { style: { flex: '0 0 auto', textAlign: 'right' } }, [
            el('div', { style: { fontSize: '10.5px', color: 'var(--text-3)' }, text: '倒计时' }),
            val
          ])
        ]);
        root.appendChild(card);
        if (view._cdTimer) clearInterval(view._cdTimer);
        view._cdTimer = setInterval(function () { if (val.isConnected) val.textContent = fmt(); }, 30000);
      })();

      var leftCol = el('div', { class: 'today-left' });
      var rightCol = el('div', { class: 'today-right' });

      /* ---------- 今天的课 ---------- */
      var section = el('div', { style: { marginBottom: '18px' } });
      section.appendChild(el('div', { class: 'section-title' }, [
        '今天的课',
        el('a', {
          class: 'more', href: 'javascript:void 0',
          onclick: function () { App.go('schedule'); }
        }, ['查看完整课表 →'])
      ]));

      if (!inTerm) {
        section.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.calendar, '今天是学期外', '当前日期不在学期范围内，可在设置中调整学期起止日期。')
        ]));
      } else if (!Store.courses.length) {
        section.appendChild(el('div', { class: 'card' }, [
          V.empty(
            V.icons.book, '还没有添加课程',
            '先到课程表里排好每周的课，之后每天打开这里就能看到今天的安排。也可以先载入一份示例课表试试。',
            el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } }, [
              el('button', {
                class: 'btn btn-primary',
                onclick: function () { App.go('schedule'); }
              }, ['去添加课程']),
              el('button', {
                class: 'btn',
                onclick: function () {
                  if (global.__SampleData) global.__SampleData.load();
                }
              }, ['载入示例课表'])
            ])
          )
        ]));
      } else if (!courses.length) {
        section.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.today, '今天没有课', '可以安排自习，或者处理一下待办清单。')
        ]));
      } else {
        section.appendChild(courseTimeline(buildDayItems(courses, DateUtil.toStr(today)), now));
      }
      leftCol.appendChild(section);

      /* ---------- 作业 ---------- */
      var taskSection = el('div');
      taskSection.appendChild(el('div', { class: 'section-title' }, [
        '作业与待办',
        el('a', {
          class: 'more', href: 'javascript:void 0',
          onclick: function () { App.go('tasks'); }
        }, ['全部待办 →'])
      ]));

      var all = overdue.concat(todayTasks.filter(function (t) {
        return overdue.indexOf(t) < 0;
      }));
      if (!all.length) {
        taskSection.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.check, '今天没有要交的东西', '截止日期为今天或已逾期的任务会出现在这里。')
        ]));
      } else {
        var box = el('div', { class: 'card', style: { padding: '6px 8px' } });
        all.forEach(function (t) { box.appendChild(TaskRow.build(t)); });
        taskSection.appendChild(box);
      }
      rightCol.appendChild(taskSection);

      /* ---------- 今日记录 ---------- */
      var recSection = el('div', { style: { marginTop: '18px' } });
      recSection.appendChild(el('div', { class: 'section-title' }, [
        '今日记录',
        el('a', {
          class: 'more', href: 'javascript:void 0',
          onclick: function () { App.go('quadrant'); }
        }, ['打开象限 →'])
      ]));

      var todayStr0 = DateUtil.toStr(today);
      var showSleep = Store.settings.trackSleep;
      var showMeal = Store.settings.trackMeal;
      var recBox = el('div', { class: 'card', style: { padding: '8px 14px' } });
      var rowCount = 0;

      function pushRec(label, value, tone) {
        rowCount++;
        recBox.appendChild(el('div', {
          class: 'rec-row', style: { borderTop: rowCount === 1 ? 'none' : '1px solid var(--line)' },
          onclick: function () { App.go('quadrant'); }
        }, [
          el('i', { class: 'rec-dot', style: { background: tone } }),
          el('span', { class: 'rec-main' }, [el('b', { text: label })]),
          el('span', { class: 'rec-val', text: value })
        ]));
      }

      if (showSleep) {
        var sm = Store.sleepMinutes(todayStr0);
        pushRec('睡眠', sm ? TimeUtil.humanMin(sm) : '未记录', '#6366f1');
      }
      if (showMeal) {
        var ms = Store.mealSummary(todayStr0);
        pushRec('饮食', ms.count ? (ms.count + ' 餐 · ¥' + ms.cost + ' · ' + ms.kcal + ' kcal') : '未记录', '#ef4444');
      }
      var acts = Store.activitiesOf(todayStr0);
      var am = 0;
      acts.forEach(function (a) { am += TimeUtil.diffMin(a.start, a.end); });
      pushRec('活动', acts.length ? (acts.length + ' 项 · ' + TimeUtil.humanMin(am)) : '未记录', '#10b981');

      recSection.appendChild(recBox);
      rightCol.appendChild(recSection);

      /* ---------- 今日计划 ---------- */
      var planSec = planSection();
      if (planSec) rightCol.appendChild(planSec);

      /* ---------- 奖励区：森林 或 干员展示 ---------- */
      var rewardBlock = null;
      if (Store.pomodoro.mode === 'gacha' && global.Gacha) {
        rewardBlock = gachaBlock();
      } else if (global.TreeArt) {
        var fm = el('div', { style: { marginTop: '18px' } });
        fm.appendChild(el('div', { class: 'section-title' }, [
          '我的森林',
          el('a', {
            class: 'more', href: 'javascript:void 0',
            onclick: function () { App.go('pomodoro'); }
          }, ['去养树 →'])
        ]));

        var fc = el('div', { class: 'card forest-card', style: { padding: '12px 14px' } });
        var nTrees = Store.pomodoro.trees.length;

        fc.appendChild(el('div', {
          style: { fontSize: '12px', color: '#5a7a4a', marginBottom: '6px' },
          text: nTrees
            ? (nTrees + ' 棵树 · 累计专注 ' + Store.pomodoro.focusMinutes + ' 分钟')
            : '森林还是空的 · 专注攒够 ' + Store.plantCost('camphor') + ' 分就能种下第一棵树'
        }));

        if (nTrees) {
          var strip = el('div', { class: 'forest-strip' });
          Store.pomodoro.trees.slice(-10).forEach(function (tr) {
            var mini = el('div', { class: 'tree-mini', title: speciesOf(tr.species).name });
            mini.appendChild(TreeArt.svg(treeStage(tr.growth), speciesOf(tr.species)));
            strip.appendChild(mini);
          });
          if (nTrees > 10) {
            strip.appendChild(el('div', { class: 'forest-more', text: '+' + (nTrees - 10) }));
          }
          fc.appendChild(strip);
          fc.appendChild(el('div', { class: 'forest-ground' }));
        } else {
          // 空森林：三棵淡色剪影
          var ghost = el('div', { class: 'forest-strip' });
          [['camphor', 2], ['ginkgo', 2], ['maple', 2]].forEach(function (x) {
            var mini = el('div', { class: 'tree-mini', style: { opacity: '.22' } });
            mini.appendChild(TreeArt.svg(x[1], speciesOf(x[0])));
            ghost.appendChild(mini);
          });
          fc.appendChild(ghost);
          fc.appendChild(el('div', { class: 'forest-ground' }));
          fc.appendChild(el('div', {
            style: { fontSize: '12.5px', color: '#6b8f57', margin: '8px 0 8px' },
            text: '先专注一次，攒够积分就能在这里种下第一棵小树。'
          }));
          fc.appendChild(el('button', {
            class: 'btn btn-sm',
            onclick: function () { App.go('pomodoro'); }
          }, ['去专注']));
        }

        fm.appendChild(fc);
        rewardBlock = fm;
      }

      /* ---------- 即将到来 ---------- */
      var upcoming = Store.pendingTasks().filter(function (t) {
        var left = t.dueDate ? DateUtil.daysLeft(t.dueDate) : 999;
        return left > 0 && left <= 7;
      }).slice(0, 4);

      if (upcoming.length) {
        var up = el('div', { style: { marginTop: '18px' } });
        up.appendChild(el('div', { class: 'section-title' }, ['未来 7 天']));
        var upBox = el('div', { class: 'card', style: { padding: '6px 8px' } });
        upcoming.forEach(function (t) { upBox.appendChild(TaskRow.build(t, { compact: true })); });
        up.appendChild(upBox);
        rightCol.appendChild(up);
      }

      root.appendChild(el('div', { class: 'today-cols' }, [leftCol, rightCol]));
      if (rewardBlock) root.appendChild(rewardBlock);
    }
  };

  /** 抽卡机制下的首页区块：合成玉 + 寻访 + 已获得干员 */
  function gachaBlock() {
    var pm = Store.pomodoro;
    var wrap = el('div', { style: { marginTop: '18px' } });

    wrap.appendChild(el('div', { class: 'section-title' }, [
      '我的干员',
      el('a', {
        class: 'more', href: 'javascript:void 0',
        onclick: function () { Gacha.openOps(); }
      }, ['全部图鉴 →'])
    ]));

    var card = el('div', { class: 'card gacha-home', style: { padding: '12px 14px' } });

    /* 合成玉余额 + 寻访按钮 */
    var head = el('div', { class: 'gh-head' }, [
      Gacha.jadeTag(pm.jade),
      el('span', {
        class: 'gh-sub',
        text: '≈ ' + (Math.round(pm.jade / POMO.JADE_PER_POINT * 10) / 10) +
              ' 积分 · 可抽 ' + Math.floor(pm.jade / POMO.PULL_COST) + ' 次'
      }),
      el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: function () { Gacha.open(); }
      }, ['去寻访'])
    ]);
    card.appendChild(head);

    /* 已获得干员 */
    var owned = Store.gachaOwned();
    if (!owned.length) {
      card.appendChild(el('div', {
        style: { fontSize: '12.5px', color: 'var(--text-3)', margin: '4px 0 2px' },
        text: '还没有干员 · 攒够 ' + POMO.PULL_COST + ' 合成玉（1 积分）就能寻访一次'
      }));
    } else {
      card.appendChild(el('div', {
        style: { fontSize: '12px', color: 'var(--text-3)', margin: '2px 0 8px' },
        text: '已寻访到 ' + owned.length + ' 位干员 · 累计 ' + (pm.gacha.total || 0) + ' 抽'
      }));
      card.appendChild(Gacha.wall(12));
    }

    wrap.appendChild(card);
    return wrap;
  }

  /** 今日计划：未完成计划 + 一键打卡 */
  function planSection() {
    var list = Store.plans.filter(function (p) { return !p.done; });
    if (!list.length) return null;

    var sec = el('div', { style: { marginTop: '18px' } });
    sec.appendChild(el('div', { class: 'section-title' }, [
      '今日计划',
      el('a', {
        class: 'more', href: 'javascript:void 0',
        onclick: function () { App.go('plans'); }
      }, ['全部 →'])
    ]));

    var box = el('div', { class: 'card', style: { padding: '4px 8px' } });
    list.slice(0, 4).forEach(function (p) {
      var pg = Store.planProgress(p);
      var done = Store.planDoneToday(p);
      var isCheckin = p.type === 'checkin';

      var mark = el('button', {
        class: 'task-check' + (done ? ' done' : ''),
        title: isCheckin ? '点击打卡' : '查看进度',
        onclick: function (e) {
          e.stopPropagation();
          if (isCheckin) {
            var res = Store.togglePlanCheckin(p.id);
            if (res && res.completed) UI.toast('计划完成！+' + (res.gain || 0) + ' 积分');
            else if (res && res.gain) UI.toast('打卡成功，+' + res.gain + ' 积分');
          } else {
            App.go('plans');
          }
        }
      }, done ? [V.svg(V.icons.check, 13)] : []);

      var row = el('div', {
        class: 'task-row',
        onclick: function () { App.go('plans'); }
      }, [
        mark,
        el('div', { class: 'task-main' }, [
          el('div', { class: 'task-title', text: p.title }),
          el('div', { class: 'task-meta' }, [
            el('span', { text: isCheckin
              ? (done ? '今日已打卡' : '今日待打卡')
              : ('进度 ' + pg.value + ' / ' + pg.target + (p.unit ? ' ' + p.unit : '')) }),
            el('span', { class: 'plan-mini-bar' }, [
              el('i', { style: { width: pg.pct + '%', background: p.color } })
            ])
          ])
        ]),
        el('span', {
          style: { fontSize: '11.5px', fontWeight: '600', color: p.color, flex: '0 0 auto' },
          text: pg.pct + '%'
        })
      ]);
      box.appendChild(row);
    });
    sec.appendChild(box);
    return sec;
  }

  function statBlock(num, label) {
    return el('div', { style: { minWidth: '52px' } }, [
      el('div', { style: { fontSize: '21px', fontWeight: '700', lineHeight: '1.15' }, text: String(num) }),
      el('div', { style: { fontSize: '10.5px', opacity: '.78', marginTop: '2px' }, text: label })
    ]);
  }

  function doneTodayCount() {
    var todayStr = DateUtil.toStr(DateUtil.today());
    return Store.tasks.filter(function (t) {
      return t.status === 'done' && t.doneAt && t.doneAt.slice(0, 10) === todayStr;
    }).length;
  }

  /** 今日时间线：课程 + 一次性日程合并 */
  function buildDayItems(courses, dateStr) {
    var items = [];
    courses.forEach(function (c) {
      var t = Store.courseTime(c) || { start: '--:--', end: '--:--', label: '—' };
      items.push({
        kind: 'course', sort: t.start, start: t.start, end: t.end,
        title: c.name, sub: [c.location, c.teacher].filter(Boolean).join(' · ') || t.label,
        color: c.color, course: c
      });
    });
    Store.examsOf(dateStr).forEach(function (e) {
      items.push({
        kind: 'exam', sort: e.start || '08:00', start: e.start || '—', end: e.end || '—',
        title: e.name + ' 考试',
        sub: [e.location, '课程考试'].filter(Boolean).join(' · '),
        color: '#ef4444', courseId: e.courseId
      });
    });
    Store.eventsOf(dateStr).forEach(function (e) {
      items.push({
        kind: 'event', sort: e.start, start: e.start, end: e.end,
        title: e.title, sub: [e.location, e.note].filter(Boolean).join(' · ') || '一次性日程',
        color: '#ec4899', event: e
      });
    });
    items.sort(function (a, b) { return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0; });
    return items;
  }

  /** 今日时间线 */
  function courseTimeline(items, now) {
    var wrap = el('div', { class: 'card', style: { padding: '14px 16px' } });

    items.forEach(function (it, i) {
      var start = timeToDate(it.start);
      var end = timeToDate(it.end);
      var state = now < start ? 'future' : (now > end ? 'past' : 'now');

      var stateChip;
      if (state === 'now') stateChip = el('span', { class: 'chip chip-green', text: '进行中' });
      else if (state === 'past') stateChip = el('span', { class: 'chip', text: '已结束' });
      else {
        var mins = Math.round((start - now) / 60000);
        stateChip = el('span', {
          class: 'chip ' + (mins <= 60 ? 'chip-amber' : 'chip-blue'),
          text: mins <= 60 ? (mins + ' 分钟后') : ('约 ' + Math.round(mins / 60) + ' 小时后')
        });
      }

      var row = el('div', {
        style: {
          display: 'flex', gap: '12px', padding: '11px 0',
          borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--line)',
          opacity: state === 'past' ? '.62' : '1'
        }
      }, [
        el('div', { style: { width: '48px', flex: '0 0 48px', textAlign: 'right', paddingTop: '1px' } }, [
          el('div', { style: { fontSize: '13px', fontWeight: '650', color: state === 'now' ? 'var(--primary)' : 'var(--text)' }, text: it.start }),
          el('div', { style: { fontSize: '10.5px', color: 'var(--text-3)' }, text: it.end })
        ]),
        el('div', { style: { position: 'relative', width: '10px', flex: '0 0 10px' } }, [
          el('i', {
            style: {
              position: 'absolute', left: '2px', top: '6px', width: '8px', height: '8px',
              borderRadius: '50%', background: it.color,
              boxShadow: state === 'now' ? '0 0 0 4px ' + hexA(it.color, .18) : 'none'
            }
          })
        ]),
        el('div', {
          style: { flex: '1', minWidth: '0', cursor: 'pointer' },
          onclick: function () {
            if (it.kind === 'course') global.__CourseDialog.detail(it.course.id);
            else if (it.kind === 'exam') { if (it.courseId) global.__CourseDialog.detail(it.courseId); }
            else global.EventDetail.open(it.event.id);
          }
        }, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
            el('b', { style: { fontSize: '14px', fontWeight: '650' }, text: it.title }),
            it.kind === 'event' ? el('span', { class: 'chip chip-primary', text: '日程' }) : null,
            it.kind === 'exam' ? el('span', { class: 'chip chip-red', text: '考试' }) : null,
            stateChip
          ]),
          el('div', {
            style: { fontSize: '12px', color: 'var(--text-3)', marginTop: '2px' },
            text: it.sub
          })
        ])
      ]);
      wrap.appendChild(row);
    });

    return wrap;
  }

  function hexA(hex, a) {
    var h = (hex || '#4f46e5').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


