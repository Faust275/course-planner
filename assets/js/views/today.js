

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
      var todayStr = DateUtil.toStr(today);
      // 单次例外生效后的课表：停课/调走的不算节数，调进来的算
      var courses = Store.coursesOnDate(todayStr);
      // 「今日」只看顶层任务：子任务在父任务里展开看，避免同一件事刷两遍
      var todayTasks = Store.todayTasks().filter(function (t) { return !t.parentId; });
      var overdue = Store.overdueTasks().filter(function (t) { return !t.parentId; });

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
            el('div', { class: 'hero-sub', style: { fontSize: '12.5px', opacity: '.82', marginBottom: '4px' },
              text: greet + '，今天也要好好上课' }),
            el('div', { class: 'hero-title', style: { fontSize: '24px', fontWeight: '700', letterSpacing: '.4px', lineHeight: '1.25' },
              text: (today.getMonth() + 1) + ' 月 ' + today.getDate() + ' 日 · ' + Store.DAY_NAMES[dow - 1] }),
            el('div', { class: 'hero-desc', style: { fontSize: '12.5px', opacity: '.86', marginTop: '4px' },
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

      /* ---------- 健康联动快捷条（精力 / 净热量 / 步数） ---------- */
      (function () {
        var hh = Store.dayHealth(todayStr);
        var eInfo = hh.sleepQ >= 0.8 ? ['充沛', '#22c55e']
                   : hh.sleepQ >= 0.65 ? ['良好', '#84cc16']
                   : hh.sleepQ >= 0.5 ? ['一般', '#eab308']
                   : ['低电量', '#ef4444'];
        var netTxt = hh.netKcal != null
          ? ('净热量 ' + (hh.netKcal > 0 ? '+' : '') + hh.netKcal + ' kcal') : '净热量 —';
        var stepTxt = hh.steps >= hh.stepGoal
          ? ('步数达标 ' + hh.steps) : ('步数 ' + hh.steps + '/' + hh.stepGoal);
        root.appendChild(el('div', {
          class: 'card',
          style: { padding: '12px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }
        }, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            V.svg(V.icons.moon, 16),
            el('span', { style: { fontWeight: '700', color: eInfo[1] }, text: eInfo[0] }),
            el('span', { style: { fontSize: '11px', color: 'var(--text-3)' }, text: '精力' })
          ]),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            V.svg(V.icons.drop, 16),
            el('span', { style: { fontSize: '13px' }, text: netTxt })
          ]),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            V.svg(V.icons.heart, 16),
            el('span', { style: { fontSize: '13px' }, text: stepTxt })
          ])
        ]));
      })();

      /* ---------- 🎯 心愿干员到货备考动态 ---------- */
      (function () {
        if (!Store.pomodoro || Store.pomodoro.mode !== 'gacha' || !Store.wishlistForecast) return;
        var forecasts = Store.wishlistForecast();
        if (!forecasts.length) return;
        var near = forecasts.filter(function (f) { return f.isCurrent || (f.daysLeft > 0 && f.daysLeft <= 7); });
        if (!near.length) return;
        var f0 = near[0];
        var text = f0.isCurrent
          ? ('【' + f0.name + '】正在「' + f0.poolName + '」当期 UP 寻访中！当前备考合成玉进度 ' + f0.readyPct + '%。')
          : ('【' + f0.name + '】将在 ' + f0.daysLeft + ' 天后进入「' + f0.poolName + '」UP！当前备考合成玉进度 ' + f0.readyPct + '%。');

        root.appendChild(el('div', {
          class: 'card cp-wishlist-banner',
          style: {
            background: 'linear-gradient(135deg, #0f766e 0%, #115e59 100%)',
            color: '#fff',
            padding: '12px 16px',
            borderRadius: '10px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
          }
        }, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
            el('span', { style: { fontSize: '20px' } }, ['🎯']),
            el('div', {}, [
              el('div', { style: { fontWeight: 'bold', fontSize: '14px' }, text: '心愿干员到货预告' }),
              el('div', { style: { fontSize: '12px', opacity: 0.9, marginTop: '2px' }, text: text + ' 今日完成专注与作业即可加速攒玉！' })
            ])
          ]),
          el('button', {
            class: 'btn btn-sm',
            style: { background: '#fff', color: '#0f766e', fontWeight: 'bold', minWidth: '70px' },
            onclick: function () { App.go('gacha'); }
          }, ['去寻访 ›'])
        ]));
      })();


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
              onclick: function () { App.go('calendar', { tab: 'agenda' }); }
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
          if (!t.important || t.status === 'done' || t.parentId) return;
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
            else if (near.kind === 'event') App.go('calendar', { tab: 'agenda' });
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
      } else {
        // 生效课 + 被停/被调走的（灰显）一起进时间线；全被调走也不至于误以为没课
        var dayItems = buildDayItems(courses, todayStr, true);
        if (dayItems.length) section.appendChild(courseTimeline(dayItems, now));
        else section.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.today, '今天没有课', '可以安排自习，或者处理一下待办清单。')
        ]));
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

      /* ---------- 在办目标 ---------- */
      var activeGoals = (Store.state.goals || []).filter(function (g) { return !g.archivedAt; })
        .sort(function (a, b) { return String(a.endDate) < String(b.endDate) ? -1 : 1; });
      if (activeGoals.length) {
        var goalSec = el('div', { style: { marginTop: '18px' } });
        goalSec.appendChild(el('div', { class: 'section-title' }, [
          '在办目标',
          el('a', {
            class: 'more', href: 'javascript:void 0',
            onclick: function () { App.go('goals'); }
          }, ['全部目标 →'])
        ]));
        var gbox = el('div', { class: 'card', style: { padding: '10px 14px' } });
        activeGoals.slice(0, 3).forEach(function (g, idx) {
          var gpct = Store.goalProgressOf(g).pct;
          var left = DateUtil.diffDays(DateUtil.parse(g.endDate), today);
          var leftText = left < 0 ? ('已过期 ' + (-left) + ' 天')
            : (left === 0 ? '今天到期' : ('剩 ' + left + ' 天'));
          gbox.appendChild(el('div', {
            style: { padding: '8px 0', borderTop: idx === 0 ? 'none' : '1px solid var(--line)', cursor: 'pointer' },
            onclick: function () { App.go('goals'); }
          }, [
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' } }, [
              el('b', { style: { fontSize: '13px' }, text: g.title }),
              el('span', { style: { fontSize: '11.5px', color: left < 0 ? '#ef4444' : 'var(--text-3)' }, text: leftText })
            ]),
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' } }, [
              el('div', { style: { flex: '1', height: '7px', background: 'var(--line)', borderRadius: '4px', overflow: 'hidden' } }, [
                el('div', { style: { width: Math.max(0, Math.min(100, gpct)) + '%', height: '100%', background: 'var(--primary)' } })
              ]),
              el('span', { style: { fontSize: '11.5px', color: 'var(--text-2)', width: '34px', textAlign: 'right' }, text: gpct + '%' })
            ])
          ]));
        });
        goalSec.appendChild(gbox);
        rightCol.appendChild(goalSec);
      }

      /* ---------- 本周考试 ---------- */
      var wsExam = DateUtil.weekStart(today), weExam = DateUtil.addDays(wsExam, 6);
      var wsS = DateUtil.toStr(wsExam), weS = DateUtil.toStr(weExam);
      var weekExams = (Store.courses || []).filter(function (c) {
        return c.exam && c.exam.date && c.exam.date >= wsS && c.exam.date <= weS;
      }).sort(function (a, b) { return a.exam.date < b.exam.date ? -1 : 1; });
      if (weekExams.length) {
        var examSec = el('div', { style: { marginTop: '18px' } });
        examSec.appendChild(el('div', { class: 'section-title' }, ['本周考试']));
        var ebox = el('div', { class: 'card', style: { padding: '6px 8px' } });
        weekExams.forEach(function (c) {
          var ed = DateUtil.parse(c.exam.date);
          var tt = c.exam.start ? (c.exam.start + (c.exam.end ? '–' + c.exam.end : '')) : '';
          var loc = c.exam.location || c.location || '';
          ebox.appendChild(el('div', { class: 'rec-row', style: { borderTop: 'none' } }, [
            el('i', { class: 'rec-dot', style: { background: '#ef4444' } }),
            el('span', { class: 'rec-main' }, [
              el('b', { text: c.name }),
              el('span', { text: (ed.getMonth() + 1) + '/' + ed.getDate() + (tt ? ' · ' + tt : '') + (loc ? ' · ' + loc : '') })
            ]),
            el('span', { class: 'rec-val', text: '考试' })
          ]));
        });
        examSec.appendChild(ebox);
        rightCol.appendChild(examSec);
      }

      /* ---------- 今日记录 ---------- */
      var recSection = el('div', { style: { marginTop: '18px' } });
      recSection.appendChild(el('div', { class: 'section-title' }, [
        '今日记录',
        el('a', {
          class: 'more', href: 'javascript:void 0',
          onclick: function () { App.go('tasks', { tab: 'quadrant' }); }
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
          onclick: function () { App.go('tasks', { tab: 'quadrant' }); }
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

      /* ---------- 健康提示（阈值用户自定，可关） ---------- */
      var hc = Store.settings.health;
      if (hc && hc.on) {
        var hints = [];
        var smH = Store.sleepMinutes(todayStr0);
        if (hc.sleepMinH > 0 && smH > 0 && smH < hc.sleepMinH * 60) {
          hints.push('昨晚只睡了 ' + TimeUtil.humanMin(smH) + '，注意补觉');
        }
        var dietGoal = (Store.settings.diet && Store.settings.diet.goal) || 0;
        if (hc.kcalOver && dietGoal > 0) {
          var kcalToday = Store.mealSummary(todayStr0).kcal;
          if (kcalToday > dietGoal) hints.push('今天热量已超目标 ' + (kcalToday - dietGoal) + ' kcal');
        }
        if (hc.activityMinH > 0) {
          var amAct = 0;
          Store.activitiesOf(todayStr0).forEach(function (a) { amAct += TimeUtil.diffMin(a.start, a.end); });
          if (amAct < hc.activityMinH * 60) {
            hints.push('今天活动还差 ' + TimeUtil.humanMin(hc.activityMinH * 60 - amAct));
          }
        }
        if (hints.length) {
          var hintSec = el('div', { style: { marginTop: '18px' } });
          hintSec.appendChild(el('div', { class: 'section-title' }, ['健康提示']));
          var hBox = el('div', { class: 'card', style: { padding: '10px 14px' } });
          hints.forEach(function (t) {
            hBox.appendChild(el('div', { class: 'rec-row', style: { borderTop: 'none' } }, [
              el('i', { class: 'rec-dot', style: { background: '#14b8a6' } }),
              el('span', { class: 'rec-main' }, [el('span', { text: t })])
            ]));
          });
          hintSec.appendChild(hBox);
          rightCol.appendChild(hintSec);
        }
      }

      /* ---------- 统计入口（受 settings.statsOn 控制，关掉则首页卡片一起消失） ---------- */
      if (Store.settings.statsOn) {
        var ws = DateUtil.weekStart(DateUtil.today());
        var we = DateUtil.addDays(ws, 6);
        var wkRec = Store.rangeStat(DateUtil.toStr(ws), DateUtil.toStr(we)).recorded;
        var wkGain = Store.pointSeries('week').reduce(function (s, d) { return s + d.n; }, 0);
        var totalPts = Store.totalPoints();
        var statSec = el('div', { style: { marginTop: '18px' } });
        statSec.appendChild(el('div', { class: 'section-title' }, [
          '时间统计',
          el('a', {
            class: 'more', href: 'javascript:void 0',
            onclick: function () { App.go('tasks', { tab: 'stats' }); }
          }, ['查看 →'])
        ]));
        statSec.appendChild(el('div', {
          class: 'card', style: { padding: '8px 14px', cursor: 'pointer' },
          onclick: function () { App.go('tasks', { tab: 'stats' }); }
        }, [
          el('div', { class: 'rec-row', style: { borderTop: 'none' } }, [
            el('i', { class: 'rec-dot', style: { background: 'var(--primary)' } }),
            el('span', { class: 'rec-main' }, [
              el('b', { text: '本周已记录' }),
              el('span', { text: '睡眠 + 上课 + 日程 + 活动 + 用餐' })
            ]),
            el('span', { class: 'rec-val', text: TimeUtil.humanMin(wkRec) })
          ]),
          el('div', { class: 'rec-row' }, [
            el('i', { class: 'rec-dot', style: { background: 'var(--green)' } }),
            el('span', { class: 'rec-main' }, [
              el('b', { text: '本周获得积分' }),
              el('span', { text: '专注 + 待办 + 计划 + 目标 + 记录' })
            ]),
            el('span', { class: 'rec-val', text: Math.round(wkGain) + ' 分' })
          ]),
          el('div', { class: 'rec-row' }, [
            el('i', { class: 'rec-dot', style: { background: 'var(--amber)' } }),
            el('span', { class: 'rec-main' }, [
              el('b', { text: '累计总量' }),
              el('span', { text: '所有途径合计（含合成玉折算）' })
            ]),
            el('span', { class: 'rec-val', text: Math.round(totalPts) + ' 分' })
          ])
        ]));
        rightCol.appendChild(statSec);
      }

      /* ---------- 今日计划 ---------- */
      var planSec = planSection();
      if (planSec) rightCol.appendChild(planSec);

      /* ---------- 奖励区：森林 或 干员展示 ---------- */
      var rewardBlock = null;
      if (Store.gachaEnabled() && Store.pomodoro.mode === 'gacha' && global.Gacha) {
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
            : '森林还是空的 · 专注满 40 分钟就能在这里种下第一棵树'
        }));

        if (nTrees) {
          var strip = el('div', { class: 'forest-strip' });
          Store.pomodoro.trees.slice(-10).forEach(function (tr) {
            var mini = el('div', { class: 'tree-mini', title: speciesOf(tr.species).name });
            mini.appendChild(TreeArt.svg(tr.stage || 1, speciesOf(tr.species), tr.withered));
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
            text: '专注满 40 分钟，就能在这里种下第一棵小树。'
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
      var upcoming = Store.rootPending().filter(function (t) {
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
        text: '≈ ' + Math.round(pm.jade / POMO.JADE_PER_POINT) +
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

  /** 今日时间线：课程 + 一次性日程合并；withOff=true 时把被停/调走的课灰显带出来 */
  function buildDayItems(courses, dateStr, withOff) {
    var items = [];
    courses.forEach(function (c) {
      var t = Store.courseTime(c) || { start: '--:--', end: '--:--', label: '—' };
      items.push({
        kind: 'course', sort: t.start, start: t.start, end: t.end,
        title: c.name,
        sub: [c.location, c.teacher].filter(Boolean).join(' · ') || t.label,
        color: c.color, course: c,
        moveFrom: c._moveIn ? c._moveFrom : '',      // 调进来的：显示「调自 X/X」
        roomChanged: c._exRoom || ''                 // 换过教室的：显示「换教室」
      });
    });
    if (withOff) {
      Store.canceledLessonsOn(dateStr).forEach(function (c) {
        var t = Store.courseTime(c) || { start: '--:--', end: '--:--', label: '—' };
        items.push({
          kind: 'course-off', sort: t.start, start: t.start, end: t.end,
          title: c.name,
          sub: [c.location, c.teacher].filter(Boolean).join(' · ') || t.label,
          color: c.color, course: c,
          offType: c._off, moveTo: c._moveTo || ''
        });
      });
    }
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
      var isOff = it.kind === 'course-off';
      var state = isOff ? 'off' : (now < start ? 'future' : (now > end ? 'past' : 'now'));

      var stateChip;
      if (state === 'off') {
        // 停课 / 已调走：灰色说明chip，不再给倒计时
        stateChip = el('span', { class: 'chip', style: { background: 'var(--bg-2, #eef0f5)', color: 'var(--text-3)' },
          text: it.offType === 'move' ? ('已调走 · 调至 ' + (it.moveTo || '').slice(5).replace('-', '/')) : '本次停课' });
      } else if (state === 'now') stateChip = el('span', { class: 'chip chip-green', text: '进行中' });
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
          opacity: state === 'past' ? '.62' : (isOff ? '.55' : '1')
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
            if (it.kind === 'course' || isOff) global.__CourseDialog.detail(it.course.id);
            else if (it.kind === 'exam') { if (it.courseId) global.__CourseDialog.detail(it.courseId); }
            else global.EventDetail.open(it.event.id);
          }
        }, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
            el('b', {
              style: { fontSize: '14px', fontWeight: '650', textDecoration: isOff ? 'line-through' : 'none' },
              text: it.title
            }),
            it.kind === 'course' && it.moveFrom ? el('span', { class: 'chip chip-blue', text: '调自 ' + it.moveFrom.slice(5).replace('-', '/') }) : null,
            it.kind === 'course' && it.roomChanged ? el('span', { class: 'chip chip-amber', text: '换教室' }) : null,
            it.kind === 'event' ? el('span', { class: 'chip chip-primary', text: '日程' }) : null,
            it.kind === 'exam' ? el('span', { class: 'chip chip-red', text: '考试' }) : null,
            stateChip,
            // 单次调整入口：今天这节课 停课/换教室/调课 就在这里点
            (it.kind === 'course' || isOff) ? el('button', {
              class: 'chip lesson-adj-btn',
              text: '调整',
              onclick: function (e) {
                e.stopPropagation();
                if (global.__LessonDialog) global.__LessonDialog.open(it.course.id, DateUtil.toStr(DateUtil.today()));
              }
            }) : null
          ]),
          el('div', {
            style: {
              fontSize: '12px', color: 'var(--text-3)', marginTop: '2px',
              textDecoration: isOff ? 'line-through' : 'none'
            },
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


