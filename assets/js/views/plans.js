

/* ==========================================================
 * 视图：计划（打卡 / 进度 / 时长）
 * ========================================================== */
(function (global) {
  'use strict';

  var V = UI;
  var el = V.el;

  /** 按天打勾的计划（打卡型 / 额度型）——额度型也要打卡格与打卡按钮 */
  function isTickPlan(p) {
    if (global.isCheckinLike) return global.isCheckinLike(p);
    return !!p && (p.type === 'checkin' || p.type === 'quota');
  }

  var state = {
    status: 'running',
    tag: '',
    tab: 'plans',
    monthCursor: null,
    monthSelected: '',
    monthPlanId: 'all'
  };
  var TABS = ['plans', 'month', 'goals'];

  /** 分页切换后把地址栏对齐（#/plans/goals）；默认分页不写尾巴 */
  function syncRoute() {
    if (global.App && App.renderHubBar) App.renderHubBar();
    if (!global.Router || !global.App || App.currentId !== 'plans') return;
    Router.set('plans', state.tab === 'plans' ? null : state.tab);
  }

  /** 右上角按钮跟着分页变，所以切页时要手动重建一次 */
  function refreshActions() {
    var host = document.getElementById('viewActions');
    if (!host || !global.App || App.currentId !== 'plans') return;
    host.innerHTML = '';
    view.actions(host);
  }
  var justDoneId = '';
  /** 今天的状态倾向：'ease'（缓一缓）/ 'push'（适合推）/ ''。render 时算一次，卡片共用 */
  var adviceMode = '';

  // 计划选色复用课程那套 20 色，保证全 App 同一套色卡
  var COLORS = (typeof Store !== 'undefined' && Store.COLORS) ||
               (typeof Palette !== 'undefined' && Palette.COURSE_COLORS) ||
               ['#4f46e5', '#0ea5e9', '#14b8a6', '#12b76a', '#e8930c', '#f04438', '#ec4899', '#7c3aed'];

  function fmtNum(n) {
    return String(Math.round(n * 100) / 100);
  }

  var view = {
    id: 'plans',
    name: '计划',
    icon: V.icons.flag,
    title: '我的计划',
    order: 24,
    nav: true,

    root: null,

    actions: function (host) {
      var onGoals = state.tab === 'goals';
      host.appendChild(el('button', {
        class: 'btn btn-primary',
        onclick: function () {
          if (onGoals) { if (global.openGoalDialog) openGoalDialog(); }
          else openPlanDialog();
        }
      }, [V.svg(V.icons.plus, 16), onGoals ? '新建目标' : '新建计划']));
    },

    /** 分页：计划 / 目标 */
    defaultTab: 'plans',
    getTab: function () { return state.tab; },
    setTab: function (tab) {
      state.tab = TABS.indexOf(tab) >= 0 ? tab : 'plans';
      if (this.root) this.render();
      refreshActions();
      syncRoute();
    },

    mount: function (host) {
      this.root = el('section', { class: 'view', id: 'view-plans' });
      host.appendChild(this.root);
      this.render();
      return this.root;
    },

    onEnter: function () { this.render(); },

    render: function () {
      var root = this.root;
      if (!root) return;
      root.innerHTML = '';

      /* ---- 计划 / 月视图 / 目标 分页 ---- */
      var nGoal = Store.goalsActive().length;
      var paneBar = el('div', { class: 'pane-tabs' });
      [
        { v: 'plans', l: '计划' },
        { v: 'month', l: '月视图' },
        { v: 'goals', l: nGoal ? '目标 ' + nGoal : '目标' }
      ].forEach(function (x) {
        paneBar.appendChild(el('button', {
          class: 'pane-tab' + (state.tab === x.v ? ' active' : ''),
          text: x.l,
          onclick: function () {
            if (state.tab === x.v) return;
            state.tab = x.v;
            view.render();
            refreshActions();
            syncRoute();
          }
        }));
      });
      root.appendChild(paneBar);

      if (state.tab === 'goals') {
        var goalHost = el('div', {});
        root.appendChild(goalHost);
        if (global.GoalsPane) GoalsPane.render(goalHost);
        return;
      }

      if (state.tab === 'month') {
        renderPlanMonthView(root, view);
        return;
      }

      var st = Store.planStats();

      /* ---------- 规划定位说明 ---------- */
      root.appendChild(el('div', {
        style: {
          padding: '8px 12px', marginBottom: '10px', borderRadius: '8px',
          background: 'rgba(16,185,129,0.06)', border: '1px dashed rgba(16,185,129,0.25)',
          fontSize: '11.5px', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px'
        }
      }, [
        el('span', { text: '🌱 习惯与规划中心 · 专注每日习惯打卡与长期目标推进（单次待做事项请见「待办」）' }),
        el('button', {
          class: 'btn btn-sm',
          style: { height: '22px', padding: '0 8px', fontSize: '11px', flex: '0 0 auto' },
          onclick: function () { if (global.App) App.go('plans', { tab: 'goals' }); }
        }, ['查看目标 OKR'])
      ]));

      /* ---------- 概览 ---------- */
      root.appendChild(el('div', { class: 'task-summary' }, [
        V.statCard(st.running, '进行中', 'var(--primary)'),
        V.statCard(st.todayPending, '今日待打卡', 'var(--amber)'),
        V.statCard(st.finished, '已完成', 'var(--green)'),
        V.statCard(st.total, '全部计划', 'var(--text-2)')
      ]));

      root.appendChild(el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '7px',
          fontSize: '11.5px', color: 'var(--text-3)', margin: '-6px 0 10px'
        }
      }, [
        V.svg(V.icons.tree, 14),
        el('span', { text: '可用积分 ' + Store.pomodoro.points }),
        V.ruleHelpBtn('计划积分规则', [
          { label: '+' + POMO.PLAN_CHECKIN + ' 积分', text: '每次计划打卡或记录一笔进度/时长' },
          { label: '+' + POMO.PLAN_DONE + ' 积分', text: '计划累计进度达到 100% 完成时额外奖励' },
          { label: '缓一缓保护', text: '在睡眠不足或疲惫时点击「缓一缓」，当日不扣分、不断连续打卡天数' }
        ], { label: '积分规则' })
      ]));

      /* ---------- 筛选 + 月视图快捷切换 ---------- */
      var tabBar = el('div', { class: 'filter-bar', style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' } }, [
        { v: 'running', n: '进行中' },
        { v: 'done', n: '已完成' },
        { v: 'all', n: '全部' }
      ].map(function (o) {
        return el('button', {
          class: 'filter-tab' + (state.status === o.v ? ' active' : ''),
          text: o.n,
          onclick: function () { state.status = o.v; view.render(); }
        });
      }).concat([
        el('button', {
          class: 'btn btn-sm',
          style: { marginLeft: 'auto' },
          onclick: function () {
            state.tab = 'month';
            view.render();
            refreshActions();
            syncRoute();
          }
        }, [V.svg(V.icons.calendar, 14), '月视图'])
      ]));
      root.appendChild(tabBar);

      var tagFilter = V.tagFilter(state.tag, function (v) {
        state.tag = v;
        view.render();
      }, ['plan']);
      if (tagFilter) root.appendChild(tagFilter);

      /* ---------- 昨晚睡得怎么样 → 今天该推哪个计划 ---------- */
      var adv = Store.planLoadAdvice ? Store.planLoadAdvice() : null;
      adviceMode = (adv && adv.has) ? adv.mode : '';
      var advCard = adv ? loadAdviceCard(adv) : null;
      if (advCard) root.appendChild(advCard);

      /* ---------- 列表 ---------- */
      var list = Store.plans.filter(function (p) {
        if (state.status === 'running' && p.done) return false;
        if (state.status === 'done' && !p.done) return false;
        if (state.tag && !hasTag(p.tags, state.tag)) return false;
        return true;
      });
      list.sort(function (a, b) {
        if (!!a.important !== !!b.important) return a.important ? -1 : 1;
        return 0;
      });

      if (!list.length) {
        root.appendChild(el('div', { class: 'card' }, [
          V.empty(V.icons.flag, state.tag ? '没有匹配的计划' : '还没有计划',
            state.tag ? '换个标签试试。'
              : '新建一个计划，比如「21 天早起打卡」「读完 3 本书」「本月专注 600 分钟」，用打卡或进度条追踪它。',
            el('button', {
              class: 'btn btn-primary',
              onclick: function () { openPlanDialog(); }
            }, ['新建计划']))
        ]));
        return;
      }

      root.appendChild(el('div', {
        style: { fontSize: '11.5px', color: 'var(--text-3)', margin: '0 0 10px' }
      }, ['长按卡片可拖动调整顺序']));
      var wrap = el('div', { class: 'plan-list' });
      list.forEach(function (p) { wrap.appendChild(planCard(p, view)); });
      root.appendChild(wrap);
    }
  };

  /* ==========================================================
   * 身体状态 × 计划：今天该推哪个、该缓哪个
   * 只提示，不算打卡、不动记录——「缓一缓」才是唯一的写操作。
   * ========================================================== */
  function todayStr() { return DateUtil.toStr(DateUtil.today()); }

  function loadAdviceCard(a) {
    // 有睡眠判定、有计划、但一个都没标档位 —— 给一句「怎么用」的提示，不喧宾夺主
    if (!a.has) {
      var known = a.level === 'low' || a.level === 'mild' || a.level === 'good';
      if (!known || !a.todo || a.tagged) return null;
      return el('div', {
        style: {
          display: 'flex', gap: '6px', alignItems: 'flex-start',
          fontSize: '11.5px', color: 'var(--text-3)', lineHeight: '1.6', margin: '-2px 0 10px'
        }
      }, [
        el('span', { style: { flex: 'none', display: 'flex', marginTop: '2px' } }, [V.svg(V.icons.moon, 13)]),
        el('span', { text: '给计划标一个耗能档位（点开计划 → 编辑），缺觉那天我就会告诉你哪几个该缓一缓。' })
      ]);
    }

    var ease = a.mode === 'ease';
    var tone = ease
      ? { c: '#f59e0b', bg: 'rgba(245,158,11,.10)', bd: 'rgba(245,158,11,.35)', icon: V.icons.moon }
      : { c: '#16a34a', bg: 'rgba(34,197,94,.09)', bd: 'rgba(34,197,94,.30)', icon: V.icons.sun };
    var title = (a.moodFatigue && !(a.total > 0))
      ? '最近连续 2 天日记心情疲惫/低落 · 这几个计划今天先缓一缓'
      : (ease ? '昨晚 ' : '昨晚 ') + TimeUtil.humanMin(a.total) +
        (ease ? (a.moodFatigue ? '（叠加连续疲惫心情）' : '') + ' · 这几个计划今天先缓一缓' : ' · 今天适合推这几个');
    var body = ease
      ? '不是让你放弃，是别在今天硬顶。缓一天不算断签，连续天数照旧。'
      : '状态在线，趁今天把这几个吃力的往前推一推。';

    var rows = [];
    a.heavy.forEach(function (p) {
      rows.push(el('div', {
        dataset: { id: p.id },
        style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0' }
      }, [
        el('span', {
          style: {
            flex: '1', minWidth: '0', fontSize: '13px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          },
          text: p.title, title: p.title
        }),
        ease ? el('button', {
          class: 'btn btn-sm',
          style: { flex: 'none', padding: '2px 8px', fontSize: '12px' },
          onclick: function () {
            var r = Store.togglePlanExempt(p.id, todayStr());
            V.toast('已缓一天 · 连续 ' + ((r && r.streak) || 0) + ' 天没断', 'ok');
            view.render();
          }
        }, ['今天缓一缓']) : el('button', {
          class: 'btn btn-sm btn-primary',
          style: { flex: 'none', padding: '2px 8px', fontSize: '12px' },
          onclick: function () {
            var res = Store.togglePlanCheckin(p.id, todayStr());
            V.toast(res && res.gain ? '打卡成功，+' + res.gain + ' 积分' : '已打卡', 'ok');
            view.render();
          }
        }, ['去打卡'])
      ]));
    });

    var kids = [
      el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '8px' } }, [
        el('span', { style: { color: tone.c, display: 'flex', flex: 'none', marginTop: '1px' } },
          [V.svg(tone.icon, 16)]),
        el('div', { style: { flex: '1', minWidth: '0' } }, [
          el('div', { style: { fontWeight: '700', fontSize: '13.5px', color: tone.c }, text: title }),
          el('div', {
            style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '2px', lineHeight: '1.5' },
            text: body
          })
        ])
      ])
    ];

    if (rows.length) {
      kids.push(el('div', { style: { marginTop: '6px' } },
        rows.concat(ease && a.heavy.length > 1 ? [
          el('button', {
            class: 'link-btn',
            style: { fontSize: '12px', marginTop: '2px' },
            onclick: function () {
              a.heavy.forEach(function (p) { Store.togglePlanExempt(p.id, todayStr()); });
              V.toast('已把 ' + a.heavy.length + ' 个计划缓一天，连续天数都没断', 'ok');
              view.render();
            }
          }, ['全部缓一缓 ›'])
        ] : [])
      ));
    }

    if (ease && a.light.length) {
      kids.push(el('div', {
        style: { fontSize: '11.5px', color: 'var(--text-3)', marginTop: '4px' },
        text: '今天做「' + a.light.slice(0, 2).map(function (p) { return p.title; }).join('」「') + '」这类轻的就够了。'
      }));
    }

    return el('div', {
      class: 'card cp-plan-advice',
      style: {
        padding: '12px 14px', marginBottom: '12px',
        background: tone.bg, border: '1px solid ' + tone.bd,
        borderLeft: '3px solid ' + tone.c
      }
    }, kids);
  }

  /* ==========================================================
   * 计划卡片
   * ========================================================== */
  function planCard(p, view) {
    var pg = Store.planProgress(p);
    var qs = pg.quota || null;
    var today = DateUtil.toStr(DateUtil.today());
    var doneToday = Store.planDoneToday(p);
    var isCheckin = isTickPlan(p);

    var card = el('div', {
      class: 'card plan-card' + (p.done ? ' is-done' : '') + (p.id === justDoneId ? ' plan-win' : ''),
      style: { '--pl-c': p.color },
      dataset: { id: p.id, rec: 'plan:' + p.id }   // rec 供全局搜索跳转定位
    });

    /* ---- 标题行 ---- */
    var top = el('div', { class: 'plan-top' }, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div', { class: 'plan-title', text: p.title }),
        el('div', { class: 'plan-meta' }, [
          el('span', { text: PLAN_TYPES[p.type].name + ' · ' + PLAN_PERIODS[p.period].name }),
          p.startDate ? el('span', { text: '始于 ' + p.startDate.slice(5) }) : null,
          qs ? el('span', {
            class: 'chip' + (qs.reached ? ' chip-green' : ''),
            text: (p.period === 'monthly' ? '本月 ' : '本周 ') + qs.count + '/' + qs.n
          }) : null,
          (global.PLAN_LOADS || {})[p.load] ? el('span', {
            class: 'chip' + (p.load === 'high' && adviceMode === 'ease' ? ' chip-amber' : ''),
            text: p.load === 'high' && adviceMode === 'ease'
              ? '吃力 · 今天缓' : global.PLAN_LOADS[p.load].name
          }) : null,
          Store.planStreak(p) >= 2 ? el('span', {
            class: 'chip chip-amber',
            text: '连续 ' + Store.planStreak(p) + (p.type === 'quota' ? (p.period === 'monthly' ? ' 月达标' : ' 周达标') : ' 天')
          }) : null
        ].concat(V.tagChips(p.tags)))
      ]),
      p.done ? el('span', { class: 'chip chip-green', text: '已完成' }) : null
    ]);
    top.addEventListener('click', function (e) {
      if (e.target.closest('.cp-plan-check-btn, .plan-check-btn')) return;
      openDetail(p, view);
    });
    card.appendChild(top);

    /* ---- 进度条 ---- */
    card.appendChild(el('div', { class: 'plan-bar' }, [
      el('i', { style: { width: pg.pct + '%' } })
    ]));

    var unit = p.unit ? ' ' + p.unit : '';
    card.appendChild(el('div', { class: 'plan-foot' }, [
      el('span', { class: 'plan-num', text: fmtNum(pg.value) }),
      el('span', { text: '/ ' + fmtNum(pg.target) + unit }),
      el('span', { style: { marginLeft: 'auto', fontWeight: '600', color: p.done ? 'var(--green)' : 'var(--text-2)' }, text: pg.pct + '%' }),
      (!p.done && pg.remain > 0) ? el('span', { style: { color: 'var(--text-3)' }, text: '还差 ' + fmtNum(pg.remain) + unit }) : null
    ]));

    /* ---- 打卡格子 ---- */
    if (isCheckin && (p.period !== 'once' || p.type === 'quota')) {
      var slots = Store.planSlots(p);
      card.appendChild(el('div', { class: 'plan-grid len-' + (slots.length <= 7 ? 7 : slots.length <= 21 ? 21 : 30) },
        slots.map(function (ds) {
          var rec = Store.planRecordOfDate(p, ds);
          var ex = !rec && Store.planExemptedOn(p, ds);
          return el('div', {
            class: 'plan-cell' + (rec ? ' on' : '') + (ex ? ' exempt' : '') +
                   (ds === today ? ' today' : '') + (ds > today ? ' future' : ''),
            title: ds + (rec ? ' 已打卡' : ex ? ' 已缓一缓（不算断签）' : ' 未打卡'),
            onclick: function (e) {
              e.stopPropagation();
              checkinWithAnim(p.id, ds, view, card);
            }
          });
        })));
    }

    /* ---- 操作（含「打卡日程」回顾按钮，随时查看过去多长时间内打了多少次卡） ---- */
    var row = el('div', { class: 'plan-foot', style: { marginTop: '11px', flexWrap: 'wrap', gap: '6px' } });
    if (!p.done) {
      var exemptToday = Store.planExemptedOn(p, today);
      if (isCheckin) {
        if (exemptToday) {
          // 今天已经缓过了：给一条「其实我还是想做」的回头路
          row.appendChild(el('button', {
            class: 'plan-check-btn',
            onclick: function (e) {
              e.stopPropagation();
              Store.togglePlanExempt(p.id, today);
              V.toast('已恢复今天的打卡');
              view.render();
            }
          }, ['今天已缓 · 仍要打卡']));
        } else {
          var todayChecked = !!Store.planRecordOfDate(p, today);
          row.appendChild(el('button', {
            class: 'plan-check-btn' + (todayChecked ? ' on' : ''),
            onclick: function (e) {
              e.stopPropagation();
              checkinWithAnim(p.id, today, view, card);
            }
          }, [
            todayChecked ? '今日已打卡 ✓'
              : (qs && qs.reached
                ? (p.period === 'monthly' ? '本月' : '本周') + '已达标 · 仍要打卡'
                : (qs
                  ? '今日打卡 · ' + (p.period === 'monthly' ? '本月 ' : '本周 ') + qs.count + '/' + qs.n
                  : '今日打卡'))
          ]));
        }
      } else {
        row.appendChild(el('button', {
          class: 'plan-check-btn',
          onclick: function (e) { e.stopPropagation(); openAddValueDialog(p, view); }
        }, ['+ 记一笔' + (p.type === 'duration' ? '时长' : '进度')]));
      }
      // 欠睡 + 吃力档 → 给一个「今天缓一缓」的出口（主按钮右边的小字）
      if (adviceMode === 'ease' && p.load === 'high' && !doneToday && !exemptToday && isCheckin) {
        row.appendChild(el('button', {
          class: 'plan-check-btn',
          style: { borderColor: 'var(--line)', color: 'var(--text-2)' },
          onclick: function (e) {
            e.stopPropagation();
            var r = Store.togglePlanExempt(p.id, today);
            V.toast('已缓一天 · 连续 ' + ((r && r.streak) || '0') + ' 天没断', 'ok');
            view.render();
          }
        }, ['缓一缓']));
      }
    }
    row.appendChild(el('button', {
      class: 'plan-check-btn plan-sched-btn',
      dataset: { action: 'checkin-schedule' },
      title: '查看过去一段时间内的打卡次数与日程流记录',
      style: { marginLeft: 'auto', borderColor: 'var(--line)', color: 'var(--text-2)' },
      onclick: function (e) {
        e.stopPropagation();
        openCheckinScheduleModal(p, view);
      }
    }, ['🗓️ 打卡日程 (' + (p.records ? p.records.length : 0) + ')']));
    card.appendChild(row);

  /* ---- 长按拖动排序（整卡可拖，按钮区不触发） ---- */
  if (global.DragGesture) {
    var beforeOrder = null;
    DragGesture.makeDraggable(card, {
      ignore: 'button, .plan-check-btn, .plan-cell, input, textarea, a, .icon-btn',
      menuTitle: '计划「' + p.title + '」',
      menu: function () { return DragGesture.orderMenuItems('plans', p.id); },
      onStart: function () {
        beforeOrder = DragGesture.orderedIds(card.parentNode, '.cp-plan-card');
      },
      onMove: function (c) {
        DragGesture.moveWithin(card.parentNode, card, c.overEl, c.evt.clientY, '.cp-plan-card');
        DragGesture.showDropHint(c.overEl, c.evt.clientY, '.cp-plan-card');
      },
      onEnd: function (c) {
        var ids = DragGesture.orderedIds(card.parentNode, '.cp-plan-card');
        if (ids.length > 1) {
          Store.reorderInView('plans', ids);
          if (beforeOrder && beforeOrder.join(',') !== ids.join(',')) {
            UI.toastAction('已调整计划顺序', {
              onAction: function () { Store.reorderInView('plans', beforeOrder); }
            });
          }
        }
      }
    });
  }

  return card;
}

  function checkinWithAnim(id, dateStr, view, card) {
    var res = Store.togglePlanCheckin(id, dateStr);
    if (!res) return;

    if (res.completed) {
      justDoneId = id;
      // 完成后切到「全部」，让卡片留在视野里展示完成态
      state.status = 'all';
      V.toast('计划完成！+' + (res.gain || 0) + ' 积分');
    } else if (res.gain) {
      V.toast('打卡成功，+' + res.gain + ' 积分');
    }
    view.render();

    if (res.completed) {
      var node = V.$('.cp-plan-card[data-id="' + id + '"]', view.root);
      if (node) {
        celebrate(node);
        if (node.scrollIntoView) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    setTimeout(function () { justDoneId = ''; }, 1200);
  }

  /** 完成撒花：从卡片底部弹出几个小圆点 */
  function celebrate(card) {
    var host = card;
    if (!host) return;
    var layer = el('div', { class: 'celebrate' });
    var colors = ['#12b76a', '#4f46e5', '#f59e0b', '#ec4899', '#0ea5e9'];
    for (var i = 0; i < 12; i++) {
      var d = el('i', { style: { background: colors[i % colors.length] } });
      d.style.left = (10 + Math.random() * 80) + '%';
      d.style.animationDelay = (Math.random() * 0.25).toFixed(2) + 's';
      d.style.setProperty('--dx', (Math.random() * 60 - 30).toFixed(0) + 'px');
      layer.appendChild(d);
    }
    host.appendChild(layer);
    setTimeout(function () { if (layer.parentNode) layer.remove(); }, 1400);
  }

  /* ==========================================================
   * 详情：记录明细
   * ========================================================== */
  function openDetail(p, view) {
    var pg = Store.planProgress(p);
    var m;
    var body = el('div', {});

    body.appendChild(el('div', { class: 'preview-box' }, [
      el('div', { text: '进度：' + fmtNum(pg.value) + ' / ' + fmtNum(pg.target) + (p.unit ? ' ' + p.unit : '') + '（' + pg.pct + '%）' }),
      el('div', { text: '类型：' + PLAN_TYPES[p.type].name + ' · ' + PLAN_PERIODS[p.period].name }),
      el('div', { text: '开始：' + p.startDate }),
      (global.PLAN_LOADS || {})[p.load]
        ? el('div', { text: '耗能：' + global.PLAN_LOADS[p.load].name })
        : null,
      Store.planStreak(p) ? el('div', { text: '连续打卡：' + Store.planStreak(p) + ' 天' }) : null,
      p.exemptDays && p.exemptDays.length
        ? el('div', { style: { color: 'var(--text-3)' }, text: '已缓 ' + p.exemptDays.length + ' 天（不算断签）' })
        : null,
      p.note ? el('div', { text: '备注：' + p.note }) : null,
      p.tags && p.tags.length ? el('div', { class: 'plan-meta', style: { marginTop: '6px' } }, V.tagChips(p.tags)) : null
    ]));

    if (p.records.length) {
      body.appendChild(el('div', { class: 'section-title', style: { marginTop: '14px' } }, [
        '记录明细', el('span', { class: 'q-count', text: p.records.length + ' 条' })
      ]));
      var list = el('div', { class: 'rec-list' });
      p.records.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (r) {
        list.appendChild(el('div', { class: 'rec-row' }, [
          el('span', { class: 'rec-main' }, [
            el('b', { text: r.date }),
            r.note ? el('span', { text: r.note }) : null
          ]),
          el('span', { class: 'rec-val' }, [el('em', { text: '+' + fmtNum(r.value) })]),
          el('button', {
            class: 'icon-btn',
            onclick: function () { Store.removePlanRecord(p.id, r.at); openDetailRefresh(p, view, m); }
          }, [V.svg(V.icons.close, 14)])
        ]));
      });
      body.appendChild(list);
    }

    function openDetailRefresh(plan, v, modal) {
      modal.close();
      setTimeout(function () { openDetail(Store.getPlan(plan.id), v); }, 180);
    }

    m = V.modal({
      title: p.title,
      body: body,
      footer: el('div', { class: 'modal-foot' }, [
        el('button', {
          class: 'btn btn-danger',
          onclick: function () {
            m.close();
            setTimeout(function () {
              V.confirm({ title: '删除计划', message: '确定删除「' + p.title + '」吗？记录会一并消失。', danger: true, okText: '删除' })
                .then(function (ok) { if (ok) { Store.removePlan(p.id); V.toast('已删除'); } });
            }, 200);
          }
        }, ['删除']),
        el('button', {
          class: 'btn', text: '🗓️ 打卡日程',
          onclick: function () { m.close(); setTimeout(function () { openCheckinScheduleModal(p, view); }, 180); }
        }),
        el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '编辑',
          onclick: function () { m.close(); setTimeout(function () { openPlanDialog(p.id); }, 180); }
        })
      ])
    });
  }

  /* ==========================================================
   * 累加型：记一笔
   * ========================================================== */
  function openAddValueDialog(p, view) {
    var unit = p.unit || (p.type === 'duration' ? '分钟' : '');
    var fVal = V.input({
      type: 'number', step: '0.5', min: '0',
      placeholder: p.type === 'duration' ? '例如 50' : '例如 20',
      style: 'font-size:18px;height:44px;font-weight:600'
    });
    var fNote = V.input({ placeholder: '备注（可选）' });
    var fDate = V.input({ type: 'date', value: DateUtil.toStr(DateUtil.today()) });

    var m;
    m = V.modal({
      title: '记一笔 · ' + p.title,
      body: [
        V.field('数量' + (unit ? '（' + unit + '）' : ''), fVal),
        V.field('备注', fNote),
        V.field('日期', fDate)
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '记录',
          onclick: function () {
            var res = Store.addPlanValue(p.id, parseFloat(fVal.value), fNote.value, fDate.value);
            if (!res) { V.toast('请填写大于 0 的数值', 'err'); return; }
            m.close();
            if (res.completed) {
              justDoneId = p.id;
              state.status = 'all';
              V.toast('计划完成！+' + (res.gain || 0) + ' 积分');
            } else {
              V.toast('已记录，+' + (res.gain || 0) + ' 积分');
            }
            view.render();
            if (res.completed) {
              var node = V.$('.cp-plan-card[data-id="' + p.id + '"]', view.root);
              if (node) celebrate(node);
            }
            setTimeout(function () { justDoneId = ''; }, 1200);
          }
        })
      ])
    });
  }

  /* ==========================================================
   * 新建 / 编辑
   * ========================================================== */
  function openPlanDialog(id) {
    var p = id ? Store.getPlan(id) : null;
    var type = p ? p.type : 'checkin';
    var period = p ? (PLAN_PERIODS[p.period] ? p.period : 'daily') : 'daily';
    var qPeriod = (p && p.type === 'quota' && p.period === 'monthly') ? 'monthly' : 'weekly';
    var color = p ? p.color : COLORS[0];

    var fTitle = V.input({ placeholder: '例如：21 天早起打卡', value: p ? p.title : '' });
    var fNote = V.input({ placeholder: '选填', value: p ? p.note : '' });
    var fTags = V.tagInput(p ? (p.tags || []).join(',') : '');
    var fStart = V.input({ type: 'date', value: p ? p.startDate : DateUtil.toStr(DateUtil.today()) });
    var fDays = V.input({
      type: 'number', min: '1', max: '365',
      value: p ? String(p.days) : (type === 'quota' ? '12' : '21')
    });
    var fQuotaN = V.input({ type: 'number', min: '1', max: '99', value: p && p.quotaN ? String(p.quotaN) : '3' });
    var fTarget = V.input({
      type: 'number', step: '0.5', min: '1',
      value: p ? String(p.target) : (type === 'duration' ? '600' : '100')
    });
    var fUnit = V.input({ placeholder: '页 / 章 / 个', value: p ? p.unit : '' });

    var impOn = p ? !!p.important : false;
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

    /* 耗能档位：只有显式标过才参与「缺觉那天缓一缓」的建议，不按标题猜 */
    var load = p ? (p.load || '') : '';
    var loadSeg = V.segment([
      { value: '', label: '不标' },
      { value: 'low', label: '轻松' },
      { value: 'mid', label: '一般' },
      { value: 'high', label: '吃力' }
    ], load, function (v) { load = v; });

    var colorBox = el('div', { class: 'theme-grid' });
    function drawColors() {
      colorBox.innerHTML = '';
      COLORS.forEach(function (c) {
        colorBox.appendChild(el('button', {
          class: 'theme-swatch' + (color === c ? ' active' : ''),
          style: { '--c': c },
          onclick: function () { color = c; drawColors(); }
        }));
      });
    }
    drawColors();

    /* 随类型切换显示的表单区 */
    var optBox = el('div', {});
    function drawOpts() {
      optBox.innerHTML = '';
      if (type === 'quota') {
        optBox.appendChild(V.field('周期', V.segment([
          { value: 'weekly', label: '每周' },
          { value: 'monthly', label: '每月' }
        ], qPeriod, function (v) { qPeriod = v; drawOpts(); }), '回答「每周 3 次」这类需求'));
        optBox.appendChild(V.field('每周/每月几次', fQuotaN, '达到这个次数，本周期就算达标'));
        optBox.appendChild(V.field('共多少个周期', fDays,
          qPeriod === 'monthly' ? '例如 6 个月；每周期达标算一格进度' : '例如 12 周；每周期达标算一格进度'));
      } else if (type === 'checkin') {
        optBox.appendChild(V.field('周期', V.segment([
          { value: 'daily', label: '每天' },
          { value: 'weekly', label: '每周' },
          { value: 'once', label: '单次' }
        ], period, function (v) { period = v; drawOpts(); })));
        if (period !== 'once') optBox.appendChild(V.field('计划天数', fDays, '总目标就是这么多次'));
        else optBox.appendChild(V.field('', el('div', {
          style: { fontSize: '12.5px', color: 'var(--text-3)' }, text: '单次计划：完成一次打卡即达成。'
        })));
      } else {
        optBox.appendChild(V.field('目标值', fTarget, type === 'duration' ? '累计多少分钟算完成' : '累计多少算完成'));
        optBox.appendChild(V.field('单位', fUnit, '比如：页、章、个、分钟'));
      }
    }
    drawOpts();

    var typeSeg = V.segment([
      { value: 'checkin', label: '打卡' },
      { value: 'quota', label: '额度' },
      { value: 'progress', label: '进度' },
      { value: 'duration', label: '时长' }
    ], type, function (v) {
      type = v;
      if (type === 'duration') fUnit.value = fUnit.value || '分钟';
      if (type === 'progress') fTarget.value = fTarget.value === '600' ? '100' : fTarget.value;
      if (type === 'quota' && !parseInt(fDays.value, 10)) fDays.value = '12';
      drawOpts();
    });

    var m;
    m = V.modal({
      title: p ? '编辑计划' : '新建计划',
      body: [
        V.field('计划名称', fTitle),
        V.field('类型', typeSeg, '打卡＝每天/每周打勾；额度＝每周期打满 N 次；进度＝累加数值；时长＝累计分钟'),
        optBox,
        V.field('开始日期', fStart),
        V.field('重要日程', fImp, '标记后置顶，并在「今日」页显示倒计时'),
        V.field('耗能档位', loadSeg,
          '标了才参与联动：缺觉那天「吃力」的会建议缓一缓，「轻松」的会被优先推荐。不标就不管。'),
        (function () {
          var ags = Store.goalsActive ? Store.goalsActive() : [];
          if (!ags.length) return null;
          var gOpts = [{ value: '', label: '不关联目标' }];
          ags.forEach(function (g) {
            gOpts.push({ value: g.id + '|', label: '🎯 ' + g.title });
            (g.krs || []).forEach(function (k) {
              gOpts.push({ value: g.id + '|' + k.id, label: '  └ KR：' + k.title });
            });
          });
          var initVal = (p && p.goalId) ? (p.goalId + '|' + (p.krId || '')) : '';
          var gSel = V.select(gOpts, initVal);
          gSel.id = 'fPlanGoalCombo';
          return V.field('关联目标 / KR', gSel, '作为第 4 级微行动，每次打卡自动计入大目标复利进度');
        })(),
        V.field('备注', fNote),
        V.field('标签', fTags, '支持二级标签，如「学习/英语」'),
        V.field('颜色', colorBox),
        el('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: '2px' }
        }, [
          V.ruleHelpBtn('计划积分规则', [
            { label: '+' + POMO.PLAN_CHECKIN + ' 积分', text: '每次打卡或记录一笔进度/时长' },
            { label: '+' + POMO.PLAN_DONE + ' 积分', text: '完成整个计划时自动奖励' }
          ], { label: '积分规则' })
        ])
      ],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '取消', onclick: function () { m.close(); } }),
        el('button', {
          class: 'btn btn-primary', text: '保存',
          onclick: function () {
            if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
              try { document.activeElement.blur(); } catch (e) {}
            }
            if (!fTitle.value.trim()) { V.toast('请填写计划名称', 'err'); fTitle.focus(); return; }
            var data = {
              title: fTitle.value.trim(),
              type: type,
              period: type === 'quota' ? qPeriod : (type === 'checkin' ? period : 'once'),
              days: parseInt(fDays.value, 10) || (type === 'quota' ? 12 : 21),
              startDate: fStart.value,
              note: fNote.value, tags: fTags.getValue(),
              color: color, important: impOn, load: load,
              goalId: (function () { var elG = document.getElementById('fPlanGoalCombo'); return elG && elG.value ? elG.value.split('|')[0] : (p && p.goalId || ''); })(),
              krId: (function () { var elG = document.getElementById('fPlanGoalCombo'); return elG && elG.value ? (elG.value.split('|')[1] || '') : (p && p.krId || ''); })()
            };
            if (type === 'quota') {
              data.quotaN = parseInt(fQuotaN.value, 10) || 3;
              data.unit = qPeriod === 'monthly' ? '月' : '周';
            } else if (type !== 'checkin') {
              data.target = parseFloat(fTarget.value) || 1;
              data.unit = fUnit.value.trim() || (type === 'duration' ? '分钟' : '');
            }
            if (p) { Store.updatePlan(p.id, data); V.toast('已更新'); }
            else { Store.addPlan(data); V.toast('计划已创建'); }
            if (Store.flushSave) Store.flushSave();
            m.close();
            var v = App.views.filter(function (x) { return x.id === 'plans'; })[0];
            if (v && App.currentId === 'plans') v.render();
          }
        })
      ])
    });
  }

  /* ==========================================================
   * 需求 6：计划专属月视图（按月查看所有计划打卡/进度、点击日期查看与补卡）
   * ========================================================== */
  function ensureMonthCursor() {
    if (!state.monthCursor) {
      var d = DateUtil.today();
      state.monthCursor = { y: d.getFullYear(), m: d.getMonth() };
    }
    if (!state.monthSelected) {
      state.monthSelected = DateUtil.toStr(DateUtil.today());
    }
  }

  function shiftPlanMonth(delta) {
    ensureMonthCursor();
    var d = new Date(state.monthCursor.y, state.monthCursor.m + delta, 1);
    state.monthCursor = { y: d.getFullYear(), m: d.getMonth() };
  }

  function renderPlanMonthView(root, view) {
    ensureMonthCursor();
    var y = state.monthCursor.y, m = state.monthCursor.m;
    var first = new Date(y, m, 1);
    var start = DateUtil.weekStart(first);
    var todayStr = DateUtil.toStr(DateUtil.today());
    var summary = Store.plansMonthSummary(y, m, state.monthPlanId);

    /* ---------- 月度统计概览 ---------- */
    root.appendChild(el('div', { class: 'task-summary' }, [
      V.statCard(summary.totalRecords, '本月打卡/记录', 'var(--primary)'),
      V.statCard(summary.activeDays, '本月活跃天数', 'var(--green)'),
      V.statCard(summary.activePlans, '有记录的计划', 'var(--amber)'),
      V.statCard(Store.planStats().running, '进行中计划', 'var(--text-2)')
    ]));

    /* ---------- 月份导航 + 计划筛选 ---------- */
    var planOpts = [{ value: 'all', label: '全部计划 (' + Store.plans.length + ')' }].concat(
      Store.plans.map(function (p) {
        return { value: p.id, label: p.title + (p.done ? ' (已完成)' : '') };
      })
    );
    var planSelect = V.select(planOpts, state.monthPlanId, function (val) {
      state.monthPlanId = val;
      view.render();
    });
    planSelect.style.maxWidth = '190px';

    var head = el('div', { class: 'week-bar', style: { marginBottom: '12px', flexWrap: 'wrap', gap: '8px' } }, [
      el('div', { class: 'week-nav' }, [
        el('button', {
          class: 'icon-btn',
          title: '上个月',
          onclick: function () { shiftPlanMonth(-1); view.render(); }
        }, [V.svg(V.icons.left)]),
        el('div', { class: 'week-label' }, [
          el('span', { text: y + ' 年 ' + (m + 1) + ' 月 · 计划月历' }),
          el('small', { text: '本月共打卡/记录 ' + summary.totalRecords + ' 次 · 覆盖 ' + summary.activeDays + ' 天' })
        ]),
        el('button', {
          class: 'icon-btn',
          title: '下个月',
          onclick: function () { shiftPlanMonth(1); view.render(); }
        }, [V.svg(V.icons.right)])
      ]),
      el('div', { class: 'week-meta', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
        planSelect,
        (y !== DateUtil.today().getFullYear() || m !== DateUtil.today().getMonth()) ? el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            var d = DateUtil.today();
            state.monthCursor = { y: d.getFullYear(), m: d.getMonth() };
            state.monthSelected = DateUtil.toStr(d);
            view.render();
          }
        }, ['回到本月']) : null,
        el('button', {
          class: 'btn btn-sm',
          onclick: function () {
            state.tab = 'plans';
            view.render();
            refreshActions();
            syncRoute();
          }
        }, ['📋 列表视图'])
      ])
    ]);
    root.appendChild(head);

    /* ---------- 42 格月历网格 ---------- */
    var cal = el('div', { class: 'card cal-card plan-month-card' });
    var weekRow = el('div', { class: 'cal-week' });
    Store.DAY_NAMES.forEach(function (n) {
      weekRow.appendChild(el('span', { text: n.slice(1) }));
    });
    cal.appendChild(weekRow);

    var grid = el('div', { class: 'cal-grid' });
    for (var i = 0; i < 42; i++) {
      var d = DateUtil.addDays(start, i);
      var ds = DateUtil.toStr(d);
      var inMonth = d.getMonth() === m;
      var isToday = ds === todayStr;
      var isSel = ds === state.monthSelected;
      var dayEntries = summary.byDate[ds] || [];
      var recEntries = dayEntries.filter(function (x) { return x.kind === 'record'; });
      var exEntries = dayEntries.filter(function (x) { return x.kind === 'exempt'; });

      var dotsWrap = el('div', { class: 'plan-month-dots' });
      recEntries.slice(0, 4).forEach(function (item) {
        dotsWrap.appendChild(el('span', {
          class: 'plan-month-pill',
          style: { background: item.plan.color || 'var(--primary)' },
          title: item.plan.title + (item.record && item.record.value ? ' +' + item.record.value : ''),
          text: item.plan.title.slice(0, 3)
        }));
      });
      if (recEntries.length > 4) {
        dotsWrap.appendChild(el('span', {
          class: 'plan-month-more',
          text: '+' + (recEntries.length - 4)
        }));
      }
      if (!recEntries.length && exEntries.length) {
        dotsWrap.appendChild(el('span', {
          class: 'plan-month-pill is-exempt',
          text: '缓'
        }));
      }

      var cell = el('div', {
        class: 'cal-cell plan-month-cell' +
               (inMonth ? '' : ' out') +
               (isToday ? ' today' : '') +
               (isSel ? ' selected' : '') +
               (recEntries.length ? ' has-plan-rec' : ''),
        dataset: { date: ds },
        onclick: function (targetDs, targetDate) {
          return function () {
            state.monthSelected = targetDs;
            if (targetDate.getMonth() !== m || targetDate.getFullYear() !== y) {
              state.monthCursor = { y: targetDate.getFullYear(), m: targetDate.getMonth() };
            }
            view.render();
          };
        }(ds, d)
      }, [
        el('div', { class: 'cal-num' }, [
          el('span', { text: String(d.getDate()) }),
          recEntries.length ? el('i', {
            class: 'plan-month-cnt',
            text: recEntries.length + '次'
          }) : null
        ]),
        dotsWrap
      ]);
      grid.appendChild(cell);
    }
    cal.appendChild(grid);
    root.appendChild(cal);

    /* ---------- 选中日详情：以日程流样式展示当日已打卡与待打卡计划 ---------- */
    if (state.monthSelected) {
      root.appendChild(renderPlanMonthDayDetail(state.monthSelected, summary.byDate[state.monthSelected] || [], view));
    }
  }

  function renderPlanMonthDayDetail(dateStr, entries, view) {
    var d = DateUtil.parse(dateStr) || DateUtil.today();
    var box = el('div', { class: 'card', style: { padding: '14px 16px', marginTop: '14px' } });
    box.appendChild(el('div', { class: 'section-title' }, [
      (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + DateUtil.weekdayCN(d) + ' · 计划打卡明细',
      el('span', { class: 'q-count', text: entries.length ? ('已记录 ' + entries.length + ' 项') : '暂无记录' })
    ]));

    // 1. 当日已有打卡/进度记录（日程风格卡片流）
    if (entries.length) {
      entries.forEach(function (it) {
        var p = it.plan;
        var r = it.record;
        var isEx = it.kind === 'exempt';
        var hm = '已打卡';
        if (r && r.at) {
          var dt = new Date(r.at);
          if (!isNaN(dt.getTime())) {
            hm = (dt.getHours() < 10 ? '0' + dt.getHours() : dt.getHours()) + ':' +
                 (dt.getMinutes() < 10 ? '0' + dt.getMinutes() : dt.getMinutes());
          }
        }
        box.appendChild(el('div', {
          class: 'ag-item',
          style: { cursor: 'pointer' },
          onclick: function () { openCheckinScheduleModal(p, view); }
        }, [
          el('span', { class: 'ag-bar', style: { background: isEx ? 'var(--amber)' : (p.color || 'var(--primary)') } }),
          el('span', { class: 'ag-time' }, [
            el('b', { text: isEx ? '缓一缓' : hm }),
            el('i', { text: PLAN_TYPES[p.type].name })
          ]),
          el('span', { class: 'ag-main' }, [
            el('span', { class: 'ag-title', text: p.title }),
            el('span', {
              class: 'ag-sub',
              text: isEx
                ? '当日标记为缓一缓（不扣分、不断连续天数）'
                : ('记录 +' + fmtNum(r.value || 1) + (p.unit ? ' ' + p.unit : '') + (r.note ? ' · ' + r.note : ''))
            })
          ]),
          el('div', { style: { display: 'flex', gap: '6px', flex: '0 0 auto' } }, [
            !isEx ? el('button', {
              class: 'btn btn-sm',
              title: isTickPlan(p) ? '取消该日打卡' : '删除这条进度记录',
              onclick: function (e) {
                e.stopPropagation();
                if (isTickPlan(p)) {
                  Store.togglePlanCheckin(p.id, dateStr);
                  V.toast('已取消 ' + dateStr.slice(5) + ' 的打卡');
                } else if (r && r.at) {
                  Store.removePlanRecord(p.id, r.at);
                  V.toast('已删除该条进度记录');
                }
                view.render();
              }
            }, [isTickPlan(p) ? '↩ 取消打卡' : '✕ 删除']) : null,
            el('button', {
              class: 'btn btn-sm',
              onclick: function (e) {
                e.stopPropagation();
                openCheckinScheduleModal(p, view);
              }
            }, ['🗓️ 打卡日程'])
          ])
        ]));
      });
    } else {
      box.appendChild(el('div', {
        style: { fontSize: '12.5px', color: 'var(--text-3)', marginBottom: '10px' },
        text: '这一天还没有计划打卡记录，可在下方直接为进行中的计划打卡或补卡。'
      }));
    }

    // 2. 进行中且当日尚未打卡的计划：提供一键打卡 / 补卡入口
    var recordedIds = {};
    entries.forEach(function (it) { if (it.kind === 'record') recordedIds[it.plan.id] = true; });
    var unCheckedPlans = Store.plans.filter(function (p) {
      if (p.done) return false;
      if (state.monthPlanId !== 'all' && p.id !== state.monthPlanId) return false;
      // 额度型：本周期已经打满，就别再天天挂「待打卡」了
      if (p.type === 'quota' && Store.planQuotaState) {
        var q = Store.planQuotaState(p);
        if (q && q.reached) return false;
      }
      return !recordedIds[p.id];
    });

    if (unCheckedPlans.length) {
      box.appendChild(el('div', {
        style: { fontSize: '12px', fontWeight: '600', color: 'var(--text-2)', margin: '12px 0 6px' },
        text: '当日待打卡 / 可补卡计划'
      }));
      unCheckedPlans.forEach(function (p) {
        box.appendChild(el('div', {
          class: 'ag-item'
        }, [
          el('span', { class: 'ag-bar', style: { background: p.color || 'var(--line)', opacity: '0.45' } }),
          el('span', { class: 'ag-time' }, [
            el('b', { text: '待完成' }),
            el('i', { text: PLAN_TYPES[p.type].name })
          ]),
          el('span', { class: 'ag-main' }, [
            el('span', { class: 'ag-title', text: p.title }),
            el('span', { class: 'ag-sub', text: '当前进度 ' + Store.planProgress(p).pct + '%' })
          ]),
          isTickPlan(p) ? el('button', {
            class: 'btn btn-sm btn-primary',
            onclick: function () {
              Store.togglePlanCheckin(p.id, dateStr);
              V.toast('已为 ' + dateStr.slice(5) + ' 打卡', 'ok');
              view.render();
            }
          }, [dateStr === DateUtil.toStr(DateUtil.today()) ? '今日打卡' : '补打卡']) : el('button', {
            class: 'btn btn-sm',
            onclick: function () { openAddValueDialog(p, view); }
          }, ['+ 记进度'])
        ]));
      });
    }

    return box;
  }

  /* ==========================================================
   * 需求 7：打卡任务历史回顾弹窗（查看过去多长时间内打了多少次卡，以类似日程的方式展示）
   * ========================================================== */
  function openCheckinScheduleModal(planOrId, view) {
    var p = (typeof planOrId === 'string') ? Store.getPlan(planOrId) : planOrId;
    if (!p) return;

    var curRange = 30;      // 默认查看过去 30 天（可切 7 / 14 / 30 / 90 / 'all'）
    var onlyChecked = false; // false = 按日程流展示全部日期，true = 仅看已打卡日程

    var host = el('div', { class: 'checkin-sched-wrap' });

    function draw() {
      p = Store.getPlan(p.id) || p;
      host.innerHTML = '';
      var hist = Store.planCheckinHistory(p, curRange);
      if (!hist) return;

      /* 1. 时间跨度切换条（去重：若自开始以来天数与预设相同，不重复显示两个相同天数标签） */
      var allSpan = Store.planCheckinHistory(p, 'all').daysSpan;
      var rangeOpts = [
        { v: 7, n: '近 7 天' },
        { v: 14, n: '近 14 天' },
        { v: 30, n: '近 30 天' },
        { v: 90, n: '近 90 天' },
        { v: 'all', n: '自开始以来' + ([7, 14, 30, 90].indexOf(allSpan) >= 0 ? '' : ' (' + allSpan + '天)') }
      ];
      var rangeBar = el('div', { class: 'dim-tabs', style: { marginBottom: '10px', flexWrap: 'wrap' } }, rangeOpts.map(function (o) {
        return el('button', {
          type: 'button',
          class: 'dim-tab' + (curRange === o.v ? ' active' : ''),
          text: o.n,
          onclick: function () { curRange = o.v; draw(); }
        });
      }));
      host.appendChild(rangeBar);

      /* 2. 核心统计横幅：过去多长时间中打了多少次卡 */
      var summaryBanner = el('div', {
        class: 'preview-box',
        style: {
          marginBottom: '10px',
          borderLeft: '4px solid ' + (p.color || 'var(--primary)'),
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }
      }, [
        el('div', {
          style: { fontSize: '14px', fontWeight: '700', color: 'var(--text-1)' },
          text: '过去 ' + hist.daysSpan + ' 天（' + hist.from.slice(5) + ' 至 ' + hist.to.slice(5) + '）共打卡 ' + hist.checkinCount + ' 次'
        }),
        el('div', {
          style: { fontSize: '12px', color: 'var(--text-2)' },
          text: '打卡天数 ' + hist.checkedDays + ' / ' + hist.daysSpan + ' 天 · 出勤率 ' + hist.ratePct + '%' +
                (hist.streak ? ' · 当前连续 ' + hist.streak + ' 天' : '') +
                (hist.exemptCount ? ' · 缓一缓 ' + hist.exemptCount + ' 天' : '')
        })
      ]);
      host.appendChild(summaryBanner);

      /* 3. 展示模式切换（全部日期日程流 vs 仅看已打卡） */
      var filterRow = el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }
      }, [
        el('span', {
          style: { fontSize: '12px', color: 'var(--text-3)' },
          text: '日程时间轴（点击未打卡日可直接补卡）'
        }),
        el('div', { class: 'dim-tabs' }, [
          { v: false, n: '全部日期 (' + hist.days.length + ')' },
          { v: true, n: '仅看已打卡 (' + hist.checkedDays + ')' }
        ].map(function (o) {
          return el('button', {
            type: 'button',
            class: 'dim-tab' + (onlyChecked === o.v ? ' active' : ''),
            text: o.n,
            onclick: function () { onlyChecked = o.v; draw(); }
          });
        }))
      ]);
      host.appendChild(filterRow);

      /* 4. 类似「日程 (Agenda)」的按日卡片流展示 */
      var listWrap = el('div', {
        class: 'checkin-agenda-list',
        style: { maxHeight: '340px', overflowY: 'auto', paddingRight: '2px' }
      });

      var visibleDays = onlyChecked
        ? hist.days.filter(function (d) { return d.checked || d.exempted; })
        : hist.days;

      if (!visibleDays.length) {
        listWrap.appendChild(el('div', {
          class: 'preview-box',
          style: { textAlign: 'center', color: 'var(--text-3)', padding: '20px 12px' },
          text: '这段时间内还没有打卡记录，点击下方按钮或切回「全部日期」即可打卡。'
        }));
      } else {
        visibleDays.forEach(function (day) {
          var mNum = day.d.getMonth() + 1;
          var dNum = day.d.getDate();
          var dayLabel = mNum + '月' + dNum + '日 ' + day.weekdayCN + (day.isToday ? ' · 今天' : '');

          var head = el('div', { class: 'group-head', style: { margin: '8px 0 4px' } }, [
            el('span', { text: dayLabel }),
            el('span', {
              class: 'group-count',
              style: { color: day.checked ? 'var(--green)' : (day.exempted ? 'var(--amber)' : 'var(--text-3)') },
              text: day.checked ? ('已打卡 ' + day.count + ' 次') : (day.exempted ? '已缓一缓' : '未打卡')
            })
          ]);
          listWrap.appendChild(head);

          var card = el('div', { class: 'card', style: { padding: '4px 6px', marginBottom: '8px' } });
          var barColor = day.checked ? (p.color || 'var(--green)') : (day.exempted ? 'var(--amber)' : 'var(--line)');

          card.appendChild(el('div', {
            class: 'ag-item' + (day.checked ? ' is-checked' : '')
          }, [
            el('span', { class: 'ag-bar', style: { background: barColor } }),
            el('span', { class: 'ag-time' }, [
              el('b', { text: day.timeStr }),
              el('i', { text: day.date.slice(5) })
            ]),
            el('span', { class: 'ag-main' }, [
              el('span', {
                class: 'ag-title',
                text: day.checked
                  ? (p.title + (!isTickPlan(p) ? (' +' + day.value + ' ' + hist.unit) : ' · 完成打卡'))
                  : (day.exempted ? (p.title + ' · 今日缓一缓') : (p.title + ' · 未打卡'))
              }),
              el('span', {
                class: 'ag-sub',
                text: day.note
                  ? day.note
                  : (day.checked ? '已计入计划进度与连续天数' : (day.exempted ? '豁免日，不打断连续打卡' : '当日暂无打卡记录'))
              })
            ]),
            day.checked
              ? el('span', {
                  class: 'chip chip-green',
                  style: { cursor: 'pointer' },
                  title: isTickPlan(p) ? '点击可取消该日打卡' : '点击可撤销该日最新一条记录',
                  onclick: function () {
                    if (isTickPlan(p)) {
                      Store.togglePlanCheckin(p.id, day.date);
                      V.toast('已取消 ' + day.date.slice(5) + ' 的打卡');
                    } else if (day.records && day.records.length) {
                      var lastRec = day.records[day.records.length - 1];
                      if (lastRec && lastRec.at) {
                        Store.removePlanRecord(p.id, lastRec.at);
                        V.toast('已撤销 ' + day.date.slice(5) + ' 的一条进度记录');
                      }
                    }
                    draw();
                    if (view) view.render();
                  },
                  text: isTickPlan(p) ? '✓ 已打卡' : '✓ 已记录'
                })
              : (day.exempted
                ? el('span', { class: 'chip chip-amber', text: '已豁免' })
                : (isTickPlan(p)
                  ? el('button', {
                      type: 'button',
                      class: 'btn btn-sm',
                      onclick: function () {
                        Store.togglePlanCheckin(p.id, day.date);
                        V.toast('已补打卡：' + day.date.slice(5), 'ok');
                        draw();
                        if (view) view.render();
                      }
                    }, [day.isToday ? '立即打卡' : '补打卡'])
                  : el('span', { class: 'chip', text: '无记录' })))
          ]));
          listWrap.appendChild(card);
        });
      }

      host.appendChild(listWrap);
    }

    draw();

    var m = V.modal({
      title: '🗓️ 打卡日程 · ' + p.title,
      width: '500px',
      body: [host],
      footer: el('div', { class: 'modal-foot' }, [
        el('button', {
          class: 'btn',
          text: '在月视图中查看',
          onclick: function () {
            m.close();
            state.tab = 'month';
            state.monthPlanId = p.id;
            if (global.App && App.currentId !== 'plans') App.go('plans', { tab: 'month' });
            else {
              view.render();
              refreshActions();
              syncRoute();
            }
          }
        }),
        el('button', {
          class: 'btn btn-primary',
          text: '关闭',
          onclick: function () { m.close(); }
        })
      ])
    });
  }

  global.openPlanDialog = openPlanDialog;
  global.openCheckinScheduleModal = openCheckinScheduleModal;

  // 计划列表有「进行中 / 已完成」筛选，跳转过来时先把筛选放宽
  view.focusRecord = function (type, id) {
    if (type === 'goal') {
      // 目标页可能根本没挂载过，先切过去再定位
      if (state.tab !== 'goals') {
        state.tab = 'goals';
        view.render();
        refreshActions();
        syncRoute();
      }
      return !!(global.GoalsPane && GoalsPane.focusRecord('goal', id));
    }
    if (type !== 'plan' || !global.Search) return false;
    if (state.tab !== 'plans') { state.tab = 'plans'; view.render(); refreshActions(); }
    var p = Store.getPlan(id);
    var dirty = false;
    if (p && state.status !== 'all' && ((state.status === 'running') === !!p.done)) {
      state.status = 'all';
      dirty = true;
    }
    if (p && state.tag && !hasTag(p.tags, state.tag)) { state.tag = ''; dirty = true; }
    if (dirty) this.render();
    return Search.flash(Search.findRec(type, id));
  };

  (window.VIEWS = window.VIEWS || []).push(view);
})(window);


